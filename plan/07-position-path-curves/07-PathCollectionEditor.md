# 07-PathCollectionEditor：脚本级路径集合编辑

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案设计）
> 合同：C09 路径与数值辅助
> 依赖：02-ScriptDocument（顶层 `paths[]`）、02-SelectionIdentity（端点引用）、06-ClipEffectControlsPanel / 06-EffectControlsRows（在效果控件位置组中定位端点节点）、07-PointSourceForms（无直接依赖，但同属位置组）
> 下游：07-PathGeometryForms、07-PathTimingEditor、07-CurvePathPreview
> 证据前缀见 [README](../02-model-contracts/README.md) 开头

## 一、摘要

实现脚本级 `paths[]` 的列表与条目编辑：**先选目标片段，再选两个相邻位置节点**，然后选轴集合、几何、时间映射。

本文件负责"条目"这一层（`id`/`clip`/`from`/`to`/`axes`），几何与 timing 的字段由 07-PathGeometryForms / 07-PathTimingEditor 负责。

## 二、为什么做

### 2.1 现状与运行时

| 事实 | 证据 |
|---|---|
| `paths[]` 是脚本级数组，条目键 `id`/`clip`/`from`/`to`/`axes`/`geometry`/`timing` | `J:script/path/PathCollectionParser.ENTRY_KEYS（58–59）` |
| `id` 必填、匹配 `^[A-Za-z0-9_]{1,64}$`、脚本内唯一 | `ID_PATTERN（48）`、`parseEntry（120–127）` |
| `clip` 必须解析到有 `objects` 的片段 | `parseEntry（129–138）` |
| `from < to`，且都命中目标片段 `position.x/y/z` 关键帧时间的并集，且相邻 | `parseEntry（140–168）`、`positionNodeTimes（336–374）`、`indexOfTime（381–390）` |
| 端点匹配容差 `1e-4` 秒 | `TIME_EPSILON（54）` |
| 同一片段端点对不能重复；部分重叠合法 | `parseEntry（178–186）` |
| `axes` 可省（缺省三轴）、至少一项、去重、顺序无关 | `parseAxes（200–225）`；`PathEntry` 构造（41–43） |
| 多条路径同时覆盖时"起点更晚者优先" | `J:script/path/PathBindingResolver.bindingFor（45–56）` |
| 运行期按 `片段 → 条目[]` 索引，不扫全集合 | `PathCollection`（26–49、79–83）、`PathCollectionSource（30–47）` |
| 编辑器无路径集合概念（旧 `clip.curve`） | `EDITOR:src/types.ts（151）`；`operations.ts` 无 paths |

### 2.2 目标

1. 条目只能通过下拉选端点，不提供自由时间输入。
2. 端点选项 = 目标片段 `position.x/y/z` 关键帧时间的并集（去重升序）；端点 B = A 的下一个节点。
3. `id` 自动生成（`p_<clipId>_<n>`）但可改；校验格式与唯一性。
4. `clip` 只能选"有 `objects` 的片段"；无 `id` 的片段不能作为目标（先设置 id）。
5. `axes` 三个复选框；至少一项。
6. 同一片段的端点对重复时拒绝（在添加时就判定，不等服务端）。
7. 界面承载：路径列表是脚本级文档面板（可停靠），不属于片段效果控件组；选端点时经共享 Selection 在 `clip.effects` 的位置组里高亮对应属性与节点，不要求主时间轴展开关键帧。

### 2.3 非目标

- 不定义 `geometry` 参数（07-PathGeometryForms）。
- 不定义 `timing` 点（07-PathTimingEditor）。
- 不做"路径与未选轴合成"的运行时求值。

## 三、方案

### 3.1 列表与编辑器

路径面板是**脚本级文档面板**（与 `clip.effects` 并列，可停靠在 05 布局树的任何位置），列表跨片段；它不是"当前片段效果控件"的一个组，也不能退回旧常驻左栏。

```text
┌ 路径（脚本级 · 3 条）────────────────────────────────┐
│ p1  c1   0.000 → 3.000   axes x,z      bezier   linear │
│ p2  c1   3.000 → 6.000   axes x,y,z    arc      keyframes│
│ p3  c2   0.000 → 2.000   axes x        line     linear │
│ [+ 添加路径]                                           │
└────────────────────────────────────────────────────────┘

编辑 p1：
  目标片段  [ c1（CAMERA，2 个位置节点） ▾ ]
  起点 A    [ 0.000 ▾ ]    终点 B [ 3.000 ▾ ]（B 只能选 A 的下一个节点）
  轴        [x] [y] [z]   （至少一项）
  几何      → 07-PathGeometryForms
  时间映射  → 07-PathTimingEditor
  id        [ p1 ]
```

### 3.2 端点选择流程（固定顺序）

```text
1. 选目标片段（下拉：所有有 objects 且有 id 的片段；显示轨道类型与节点数）
2. 若节点数 < 2 → 提示"该片段没有两个位置节点，无法建路径"，禁用后续
3. 选 A（下拉：全部节点时间；选中时在效果控件位置组高亮对应属性行与节点）
4. 选 B（下拉：A 的下一个节点；若 A 是最后一个 → 无 B，提示"请选更早的 A"）
5. 校验端点对不与该片段已有条目重复
6. 选 axes（默认三轴）
7. 选 geometry（默认 line？见下）
8. 选 timing（默认 linear）
```

**默认几何**：`PathCurveRegistry.DEFAULT_TYPE = "bezier"`（`48`）只在 `type` 缺失时生效，而 `paths[].geometry.type` 是**必填**（`parseGeometry 244–246`）。所以编辑器必须显式给一个类型。建议默认 `line`（最简单、无参数），并在 UI 上说明"line 是直线，可换其他 10 种"。

**默认 id**：`p_<clipId>_<n>`，`n` 从 1 递增到不重复。若 `clipId` 含非法字符（不可能，`ClipIdentity.PATTERN` 允许 `[A-Za-z0-9_]`）→ 直接用。

### 3.3 端点时间的精度

- 下拉显示的文本用节点的**原始 float32 值**格式化（例如 `0.1`、`3.3333333`）。
- 写盘时写该 float32 值的十进制最短表示（`String(Math.fround(v))` 的等价形式）；不四舍五入到 3 位小数（会偏离节点，`indexOfTime` 容差 1e-4 可能刚好越过）。
- 显示可截断（`toFixed(3)`）但**存储**用精确值；UI 上悬浮显示完整值。

### 3.4 与"位置关键帧变更"的联动（硬约束）

| 变更 | 编辑器行为 |
|---|---|
| 删除某位置节点，且它是某条路径的 A 或 B | 阻止删除，提示"该节点是路径 p1 的端点，请先删除/重绑该路径" |
| 修改某位置节点的时间，且它是端点 | 阻止，同上 |
| 在 A、B 之间插入新节点 | 阻止（会破坏相邻性）并提示；提供"同时删除该路径"或"取消" |
| 删除整个片段（被路径引用） | 阻止，提示引用列表 |
| 重命名片段 id | 一次命令同步改所有 `paths[].clip`（02-SelectionIdentity §3.4） |

这些检查与 02-SelectionIdentity §3.4 同一实现（`checkRefsBefore`）。

### 3.5 多条目与重叠

- 同一片段可有多条；端点对不同即可。
- 区间部分重叠合法（`parseEntry 178–186` 只拒"完全相同"）。
- 运行期裁决："起点更晚者优先"（`PathBindingResolver.bindingFor 51–53`）。编辑器必须在列表上标注"重叠时以起点更晚者为准"，避免作者以为两条同时生效。
- 端点对完全相同 → 添加时拒绝（本地判定，不等服务端）。

### 3.6 轴集合

- 三个复选框（`x`/`y`/`z`）；至少一项（`parseAxes 205–207`、`PathEntry` 41–43）。
- 顺序无关（`AxisConstraint` 是三个布尔，`J:math/path/AxisConstraint.java 7–14`）。
- 语义提示（必须显示，否则作者误解）：
  - 选中的轴由路径决定；未选轴仍按自身 `SampledProperty` 插值（`ObjectCameraEvaluator.positionSpec 324–336`）。
  - 2 轴只保证该平面内 2D 弧长，不承诺 3D 匀速（`MOD:plans/0.3.6/I-script-core/path-collection.md §3.3`）。
- **命名陷阱**：`AxisConstraint` 在 `math.path` 里是"约束"语义（`true` = 保留曲线分量），而 `PathEntry.axes` 是"路径覆盖该轴"（`PathEntry.java 17–19` 明确注释两者相反）。编辑器 UI 文案必须写"路径覆盖的轴"，不写"约束"。

## 四、技术细节

### 4.1 输入输出

| 函数（提案） | 输入 | 输出 |
|---|---|---|
| `positionNodes(doc, clipKey): number[]` | 文档 + 片段 | 升序去重节点时间（与 `positionNodeTimes` 同口径） |
| `endpointOptions(nodes, fromTime): number[]` | 节点 + A | B 的候选 |
| `validatePathEntry(doc, entry, index): Issue[]` | 条目 | 本地 issue（L25–L30，02-ValidationBridge） |
| `nextPathId(doc, clipId): string` | 文档 | 不重复 id |

### 4.2 修改步骤（WebUI）

1. 新建 `EDITOR:src/components/paths/PathList.vue`、`PathEntryEditor.vue`（提案）。
2. 新建 `EDITOR:src/model/paths.ts`（提案）：`positionNodes` / `endpointOptions` / `validatePathEntry` / `nextPathId`。
3. 在 05 布局树注册文档级"路径"面板（可停靠、可隐藏恢复；不与 `clip.effects` 合并，也不恢复旧左栏）。面板标题明确是脚本级 `paths[]`。
4. 改 `EDITOR:src/types.ts`：新增 `PathEntryDoc`（与 02-ScriptDocument §3.1 一致）；删除 `BezierCurve`（37–41）与 `Clip.curve`（151）。
5. 改 `EDITOR:src/operations.ts`：删除任何 `clip.curve` 相关逻辑（若存在）。
6. 在 02-EditorStore 的命令集里加 `path.add` / `path.update` / `path.remove`。
7. 端点选择与高亮通过共享 Selection 定位到 `clip.effects` 的位置组行与节点；不新增主时间轴对象行入口。

### 4.3 未来 14 迁移参考：游戏内 Forge 1.20.1 实现

> 本节仅 14 迁移参考，不构成本轮 WebUI 出口；本轮 WebUI 只对接主模组 Forge/Fabric，不等待游戏内 Java/AUI 实现。

1. `INGAME:common/.../editor/ui/PathListScreen.java`（提案）。
2. 端点选项来自 `PathCollectionParser.positionNodeTimes(Clip)`（同进程可直接调用，属只读）。
3. 校验用 `PathCollectionParser.parseEntry` 的**规则**（不直接调私有方法；`positionNodeTimes`/`indexOfTime`/`parseAxes`/`parseGeometry`/`parseTiming` 是 public static，可直接复用）。

### 4.4 禁止修改

- 不手输端点时间。
- 不把端点存成"第 N 个关键帧"。
- 不把 `axes` 语义写成"约束"。
- 不允许无 `id` 的片段作为目标。
- 不允许端点对重复。
- 不在删除端点/片段时静默删路径条目。
- 不把路径列表做成片段效果控件组或独立"关键帧页"；它是脚本级文档面板。
- 不在主时间轴新增路径端点标记/对象行；端点定位只走共享 Selection + `clip.effects` 行。

## 五、正反例验收

### 5.1 正例

1. `c1` 有 `position.x` 帧 `[0,3]`、`position.y` 帧 `[3,6]` → 节点并集 `[0,3,6]`；可选 A=0/B=3、A=3/B=6；不能选 A=0/B=6（不相邻）。
2. 添加 `p1: c1 0→3 axes[x,z] geometry line timing linear` → `script.validate` 通过。
3. 再添加 `p2: c1 3→6` → 允许（端点对不同）。
4. 再添加 `p3: c1 0→3` → 拒绝（端点对重复）。
5. 添加 `p4: c1 0→6`（跨一个节点）→ 拒绝（不相邻）。
6. `axes` 全不选 → 拒绝（至少一项）。
7. 删除 `t=3` 的 `position.x` 帧（它是 `p1` 的 B）→ 阻止。
8. 重命名 `c1` 为 `hero` → `paths[].clip` 同步改；撤销一次全部回退。
9. 在路径面板选中 A=0 → 主时间轴仍只高亮 `c1` 片段，效果控件位置组的 `position.x/y/z` 对应节点行被定位选中；不展开任何主时间轴对象行。

### 5.2 反例

| 场景 | 期望 |
|---|---|
| 手输端点 `2.5`（不在节点并集） | 不可能（下拉） |
| 选 A=0/B=6（中间有 3） | 拒绝（不相邻，`parseEntry 160–165`） |
| 目标片段无 `id` | 下拉不显示该片段（或显示但禁用 + 提示设置 id） |
| 两条路径端点对相同 | 拒绝 |
| 把 `axes` 显示成"轴约束" | 禁止（文案错误） |
| 删除被引用片段 | 阻止 |
| 在 A/B 之间插帧 | 阻止并提示 |
| 为选端点而在主时间轴展开对象行/关键帧 | 禁止（必须用 `clip.effects` 行） |

### 5.3 异步关键帧专项

**正例**：`c1` 的 `position.x` 帧 `[0,3]`，`position.y` 帧 `[3,6]`。路径 `p1: 0→3`（轴 x,z）。在 `t=1` 给 `position.x` 加帧（不在 A/B 之间？实际在 0..3 之间 → 会破坏相邻性）→ **阻止**并提示。

若在 `t=4` 给 `position.x` 加帧（不在任何端点之间）→ 允许；`p1` 端点仍是 0/3（节点并集变成 `[0,3,4,6]`，但 0→3 仍相邻）。

**反例**：在 `t=1` 插帧后静默保留 `p1` → 加载期报"端点必须与 from 相邻"（`parseEntry 160–165`）。

## 六、真实冒烟（真游戏校验）

1. Forge 1.20.1 + 主模组；`c1` 有位置节点 `[0,3,6]`。
2. 添加 `p1: 0→3`（bezier，两控制点）、`p2: 3→6`（line）；保存。
3. `script.validate` → `ok:true`；游戏内播放确认 0~3 沿曲线、3~6 直线。
4. 尝试添加 `p3: 0→3` → 被拒。
5. 删除 `t=3` 的位置帧 → 被阻止，提示 `p1`/`p2` 引用它。
6. 删除 `p1` 后再删 `t=3` → 允许（`p2` 仍引用它 → 实际仍阻止；需先删 `p2`）。

通过判定：第 3 步运动可见；第 4/5 步被拒；第 6 步按引用正确阻止。

## 七、完成定义

1. `PathList.vue` / `PathEntryEditor.vue` / `paths.ts` 存在；面板注册在 05 布局树，不与 `clip.effects` 合并。
2. 端点只能下拉选；端点对重复/不相邻在本地被拒。
3. `types.ts` 删除 `BezierCurve`/`Clip.curve`。
4. §5 的 9 条正例、8 条反例通过。
5. §6 冒烟 6 步通过。
6. 端点选择/高亮经共享 Selection 定位到效果控件位置组；主时间轴无对象行/节点。
7. （14 迁移要求，本轮不作为出口）游戏内 Forge 载体同端点选项与同拒绝集合。
