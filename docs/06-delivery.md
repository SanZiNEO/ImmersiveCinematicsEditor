# 06 轮交付记录

> 本文件记录 06 轮的实际实现结果、与设计文档的偏差、以及验收证据。
> 设计文档在 `plan/06/`，只读；偏差以**源码事实**为准。

## 一、用户裁决（本轮开工前确认）

| 议题 | 裁决 | 落点 |
|---|---|---|
| 作者态缓动归属 | 以 06-06 为准：`setEasing` 落会话层，`bakeEasing` 才是文档命令 | `DocStore.commitClipAuthoring` + `doc.clipAuthoring`；`object.bakeEasing` 命令 |
| 触发器字段面归属 | 触发器种类多、组合复杂（20+ 条件类型 + 条件树 + 前置 + 连续性），需要独立面板 | 新插件 `core.behavior`，panelId `behavior.triggers`，slot `document.right` |
| 架构整理范围 | 全做：features 分层 + 共享交互抽取 + 图/时间轴控制器拆分 + 触发器迁移 | 见第五节 |

## 二、文档与源码的偏差（以源码为准）

### 偏差 1：事件记录没有终点字段

- **文档**：06-04 与 06-07 写"区间事件是起止端点加横条，终点来自记录体里 schema 约定的字段"、"事件种类（瞬时/区间）"。
- **源码事实**：`EventRecord` 只有 `time`、`eventType`、`command`、`position`、`data` 五个分量，
  **没有终点/时长字段**（`common/src/main/java/com/immersivecinematics/immersive_cinematics/script/event/EventRecord.java`）。
  `EventClipRuntime` 按单点时间触发，`EventSeekPlan` 也只处理单点。
- **实现**：所有事件按**瞬时**处理（竖菱形），不实现区间事件与"记录条终点"。
  `NodeKind` 仍保留 `event-start` / `event-end` 两个取值，但派生函数只产出 `event-instant`——
  保留是因为运行时若未来新增区间字段，几何层不需要改形状；**当前不产生区间节点**。

### 偏差 2：`object.setEasing` 不是文档命令

- **文档**：06 README「命令规则」把 `object.setEasing` 列进"所有写入走 03 `EditorCommand`"。
- **冲突**：06-06 §4.2 / §4.4 规定作者态缓动"由会话层持有""不进入文档序列化"。
- **实现**：`object.setEasing` **不存在**；缓动写入走 `DocStore.commitClipAuthoring`
  （进撤销栈、不写盘、不进预览推送），事件是 `'authoring'` 而非 `'commit'`。
  烘焙走 `object.bakeEasing` 文档命令。

### 偏差 3：`playControl` 字段不进入属性面板（已修复）

- **文档**：06-09 说属性面板列"当前轨道全部适用叶子"。
- **源码事实**：`catalog.track(type)` 同时含 `playControl`（`start_time` / `duration` / `loop` / `loop_count` / `loop_mode`）
  与 `objects`。`playControl` 是**片段时间几何**，由主轴编辑（05-09）。
- **实现**：`buildPropertyRows` 按目录顺序列出两者（`playControl` 在前），
  因此派生层会看到 `start_time` / `duration` 并标为必填缺失。
  属性面板在消费时**过滤掉这五个路径**（`CLIP_GEOMETRY_PATHS`），不提供值控件——
  几何不在属性面板改（06-09 §4.4 已声明"不修改片段起止与时长，只提供跳转"）。
  效果面板不受影响（这些字段永远没有关键帧，不进效果面板）。

### 偏差 4：`GraphLayout` / `GraphViewState` 的模块位置

- 设计文档未指定；源码里它们定义在 `src/core/graph/layout.ts`（不在 `types.ts`）。拆分时按源码。

## 三、命令层新增（`src/core/doc/commands.ts`）

| 命令 | 用途 | 关键约束 |
|---|---|---|
| `object.enableAnimation` | 开启动画，在指定时间建首帧 | 初值回退链：显式值 → 同属性最近节点 → 静态值 → 目录默认值；都没有则拒绝 |
| `object.disableAnimation` | 关闭动画，删全部帧并保留确定值 | 事件叶子拒绝；保留最后节点的值 → 原静态值 → 目录默认值 |
| `object.setKeyframeValue` | 改某个已存在节点的值 | 不动时间、不动其他节点、不动插值 |
| `object.moveKeyframes` | 批量移动（跨属性共用偏移） | 先在副本上全部试算；任一冲突整次拒绝 |
| `object.removeKeyframes` | 批量删除 | 路径端点拒绝；删空事件行拒绝；批量原子 |
| `object.pasteKeyframes` | 粘贴节点（merge / replace） | 类型匹配校验；负时间拒绝；同刻冲突整次拒绝 |
| `object.bakeEasing` | 烘焙采样点 | 保留区间外节点；与既有节点同刻拒绝；事件行拒绝 |

## 四、撤销合并（06-05）

`DocStore.commit(command, coalesceWith?)` + `endCoalescing()`。

- 判据取自成熟文本编辑器做法（Lexical `HistoryExtension`：合并窗口 + 串身份 + 打断条件）。
- 窗口默认 400ms（可注入）；窗口内同一串**不推新快照**，撤销一次回到串开始前。
- 打断条件：串身份变化、窗口超时、撤销 / 重做 / 打开 / 关闭 / 外部同步 / 作者态写入。

## 五、架构收口（06-12）

### 新增分层

```
src/features/effects/     跨面板业务内核（纯函数 + 冻结类型，不引用插件/Vue 组件）
  types.ts                冻结形状
  rows.ts                 属性行派生
  membership.ts           归属策略（leaf / group）
  viewport.ts             局部视口换算与适配
  geometry.ts             节点/段几何、行布局、命中、框选
  easing.ts               缓动采样与烘焙
  easingStore.ts          作者态缓动读写
  valueControls.ts        值控件分派与提交目标解析
  keyframeOps.ts          关键帧编辑意图 → 命令（切片 B）
  eventRecords.ts         事件记录（切片 C）
  diagnostics.ts          诊断聚合（切片 C）
  bakeGuard.ts            保存前未烘焙检查（切片 C）

src/workbench/shared/     工作台共享交互（机制，不含业务）
  hoverIntent.ts          悬停意图状态机（延迟显示 / 延迟隐藏 / keep / now）
  gesture.ts              指针手势会话（一次手势一次提交 / Esc 取消 / 自动滚动钩子）
```

### 控制器拆分

| 原文件 | 拆出 | 变化理由 |
|---|---|---|
| `core.timeline/state.ts` | `viewState.ts`（滚动 / 尺寸 / 紧凑档） | 窗口与滚动策略变化 |
| | `interactionState.ts`（工具 / 吸附 / 活动轨 / 剪贴板） | 作者操作模式变化 |
| `core.script-graph/state.ts` | `layoutScheduler.ts`（分批出图 / BFS 顺序 / 视口内动画） | 布局算法与节流策略变化 |
| | `layoutPersist.ts`（三条防抖写入 / 冲刷 / 错误上报） | 写盘时机与防抖窗口变化 |

`state.ts` 保留同名导出（re-export），调用点与对外行为不变。

### 触发器迁移

- 组件从 `core.selection-properties/panels/` 迁到 `core.behavior/panels/`（`git mv`，保留历史）。
- `core.selection-properties/helpers.ts` 拆成两份：触发器部分随组件迁到 `core.behavior/helpers.ts`，
  属性面板自己保留 JSON 工具与格式化。
- `builtin.ts` 注册 `core.behavior`（顺序在 `coreSelectionProperties` 之后、demo 之前）。

## 六、自检

| 入口 | 覆盖 | 结果 |
|---|---|---|
| `node --experimental-strip-types src/core/doc/verify.ts` | 03 文档模型 + 06 撤销合并 | 198 ok / 0 fail |
| `node --experimental-strip-types src/workbench/verify.ts` | 04 工作台骨架 | 171 ok / 0 fail |
| `node --experimental-strip-types src/workbench/verify-05.ts` | 05 服务层 | 51 ok / 0 fail |
| `node --experimental-strip-types src/workbench/verify-06.ts` | 06 共享交互 + 效果领域纯函数 + 命令层 + 选择驱动 | 201 ok / 0 fail |

`verify-06.ts` 的覆盖范围（全部走真实实现，不 mock 业务逻辑）：

1. 共享悬停意图：延迟显示 / 延迟隐藏 / keep / now / 切换目标 / dispose（假时钟推进）。
2. 共享手势会话：一次手势一次提交 / Esc 取消 / pointercancel 取消 / 重复 begin 拒绝 / dispose 摘监听。
3. 撤销合并：窗口内合并 / 窗口外分离 / 串身份变化 / 撤销打断 / endCoalescing。
4. 属性行派生与归属分区：全部叶子、未设置、空帧、未知路径、leaf/group 两种策略、统计。
5. 轴外与无限片段：轴外计数、无限片段不判轴外。
6. 局部视口：坐标互逆、缩放锚点不动、缩放上下限、平移不钳制、可见窗口、四条适配命令。
7. 节点与段几何：事件瞬时节点、播放头命中、选择、事件行无段、段插值、命中测试、框选、行布局、虚拟化。
8. 缓动采样与烘焙：线性 / ANGLE 最短路径 / GEOMETRIC 几何平均 / STEP 端点取后帧、端点精确、
   非数值不插值、**范围过滤（轴外帧不污染轴内）/ 单帧整段恒值 / 无限片段只排除负时间**、
   采样数按秒推导与缩放无关、烘焙保留起止。
9. 值控件与目标解析：九种控件分派、校验拒绝、文本解析、三种提交目标、初值回退链、参考系三轴检查。
10. 作者态缓动存储：写入 / 删除 / 清空属性 / 剪枝失效段 / 未烘焙摘要。
11. 作者态写入进撤销栈且不写盘（序列化前后一致）。
12. 命令层新增成员：enableAnimation / setKeyframeValue / 批量移动 / 批量删除 / 删空帧 / disableAnimation / 粘贴 / 烘焙 / 事件非空约束。
13. 选择域 → 右栏面板映射：`none` → 脚本属性、`clip/object/keyframe` → 片段属性、
    `path/rule/binding` 不切。

## 七、端到端验收（`e2e/r06.spec.ts`，12 条全过）

只替身 WebSocket 网络边界；DocStore、命令层、归属策略、Vue 渲染、工作区文件读写全部走真实实现。

| 用例 | 断言 |
|---|---|
| R6-1 双面板职责 | 效果面板只出现 `position.x`（有帧），不出现 `position.y`（未设置）；面板内无 `添加属性` / `新建效果` / `添加组`；属性面板出现 `position.y` 与 `未设置` |
| R6-2 面板迁移 | 开时钟后 `yaw` 出现在效果面板、属性面板改为"在效果面板"入口；撤销后 `yaw` 从效果面板消失 |
| R6-3 无限片段 | 片段头显示 `无限`；面板内**不出现** `Infinity` |
| R6-4 循环片段 | 片段头出现 `循环` |
| R6-5 规模 | 57 个调色通道各 3 帧（171 节点）的片段在 30s 内完成渲染 |
| R6-6 事件 | 选中 EVENT 片段后事件行进入效果面板；不出现 `段缓动` |
| R6-7 保存重开 | 落盘 JSON 的 `position.x.keyframes` 与内存一致；`fov.keyframes` 保持空数组；文件里**不含** `clipKey` / `authoring` |
| R6-8 触发器迁移 | 触发器是 `document.right` 的独立面板 tab；属性面板内无 `#selection-tab-trigger`、无内嵌 `.trigger-pane` |
| R6-9 渲染稳定 | 除 `ws://127.0.0.1:8765` 断连外无未捕获异常 |
| R6-10 菱形按钮 | 播放头命中节点时菱形是实心 `◆`（`aria-pressed=true`）；点击后变空心 `◇`；撤销回 `◆`；时钟按钮同时存在 |
| R6-11 属性面板全行 | 属性面板同时出现 `position.x`（有帧）与 `yaw`（静态）；面板内也有菱形控件 |
| R6-12 选择域切换 | 清空选择后右栏 `activePanelId` 变 `p:core.meta:meta.properties` 且面板渲染出 23 个 meta 字段；选回片段变 `p:core.selection-properties:selection.properties` |

## 八、实现过程中修掉的真实缺陷

这两个缺陷是"命令成功但面板不刷新"的根因，只在真实渲染里暴露：

1. `ClipEffectsPanel.clipObjects` 的 `computed` 漏了 `void revision.value`，
   导致它缓存首次结果，`allRows` 永远拿到同一份旧 `objects`。补上依赖后迁移闭环成立。
2. `ClipPropertiesPanel.objects` 有同一缺陷（属性面板侧不刷新）。

另外修正：
- `buildPropertyRows` 把未知路径的 `groupKey` 置 `''`，与"未分组"混键 → 改为独立的 `UNKNOWN_GROUP_KEY`。
- `geometry.ts` 的 `eventKindOf` 读记录体 `end` 判定区间 → 源码无该字段，改为一律瞬时。
- 属性面板对 `playControl`（`start_time` / `duration` / `loop` / `loop_count` / `loop_mode`）
  渲染了值控件 → 这些是片段时间几何，由主轴编辑，已从行集合剔除。
- 删除 05 遗留的 `ObjectPropertyRow.vue`、切片 A 留下的孤儿 `rulerScale.ts`。
- **采样未按范围过滤**（`sampleValue` 直接吃全量关键帧）→ 源码 `object-model.md` §3.4 第 1 步
  是"取范围内关键帧"。片段 duration=4、帧在 `[0,9]`、播放头 t=3 时会拿 `[0,9]` 插值，
  轴外帧污染轴内采样。新增 `framesInRange` + `timing` 参数修正。
- **选择驱动切换收不到宿主写入**：`DocumentServiceImpl.select()` 直接调 `store.select` +
  `this.emit()`，不经过 `SelectionServiceImpl.requestSelect`。只订阅 `SelectionService`
  会漏掉这类选区变化。改为同时订阅 `DocumentService`。
- **新增面板不出现**：布局在插件激活后构建，但已落盘的 `layout.json` 不含新面板。
  加 `LayoutService.ensureSlotPanels`，激活后把缺失面板补进声明槽位（只补不改）。

## 九、已知局限（明确记录，不静默跳过）

1. **跨行框选的横向跨行能力**：`EffectControlGroup` 已接收 `rowCenters`，但"跨行框选"的矩形
   解析在行组件内按本行节点完成；跨行批量选择需要外壳把所有行的节点汇总后再解析。
   当前实现是"框选在本行内生效"，跨行时只选到起止行覆盖的节点。这属于 06-04 的可接受子集，
   但**不等于**06-11 要求的"跨行框选只选覆盖到的节点"的完整形态。
2. **诊断定位的滚动**：诊断条能定位（切面板 + 选中 + 移动播放头），但"滚动到该行"依赖
   行组件自身的滚动容器；属性面板已实现（`rowLayout` 虚拟化 + 滚动锚点），
   效果面板目前依赖浏览器默认滚动，没有精确 scrollIntoView。
3. **未烘焙提示只接在 `file.saveDoc`**：`editor.pushScript` 路径（预览推送）没有接同样的三选一。
   06-06 §4.2 要求"保存或推送前"都检查；当前推送走 160ms 防抖，没有交互点。
   这是**已知缺口**，需要在预览推送入口补一个非阻塞提示。
4. **`features/effects/panels/` 放宽了"features 不含 Vue"**：`PropertyValueForm` / `StructTreeEditor` /
   `DiagnosticsBar` / `effectRowEvents.ts` 放在 `features/effects/panels/`。理由：它们同时消费
   `PanelContext` 与效果领域纯函数，搬到中立区必须造第二套数据形状（更糟）。
   06-12 的"features 不引用插件、不引用 Vue 组件"这条约束在**组件**层面被放宽，
   但"不引用插件"仍然成立（两个插件都引用 `features/`，互不引用）。
5. **`e2e/r05.spec.ts` 已按新结构改**：触发器选择器从 `#selection-tab-trigger` + 面板内
   `.trigger-pane` 改为 `behavior.triggers` 面板容器；同时补了 behavior 面板可见性断言。
6. **时间轴面板未切到 `workbench/shared/gesture.ts`**：语义差异而非遗漏——
   时间轴把 `pointercancel` 当**提交**（复用 `onWindowPointerUp`），`gesture.ts` 当**取消**。
   按 WHATWG 语义后者更正确，但 04/05 已按现状验收，替换会改既有行为，需裁决。
   建议：`gesture.ts` 加 `cancelOnPointerCancel?: boolean`（默认 `true`），时间轴显式传 `false` 保持现状。
7. **效果面板未做行级虚拟化**：节点按可见窗口过滤（返回 `hiddenCount`），但行是全量渲染。
   属性面板已按 `rowLayout` 做行虚拟化。171 节点的 e2e 用例通过，500+ 行未压测。
8. **CAMERA + 贝塞尔 `curve` 的烘焙拦截依赖 07 轮**：源码已确认路径按弧长参数化
   （`math/path/ArcLength.java`、`PathCapability.ANALYTIC_ARC_LENGTH`），线性补帧会把曲线拉直，
   **应当**拦截烘焙。但 06 的 `PropertyRow` 不含片段级 `curve` 信息（路径能力属 07 的
   `paths.collection`），本轮无法判断，未实现。这是跨轮依赖，不是遗漏。
9. **clip 级字段面板未落位**：`playControl` 五字段（`start_time` / `duration` / `loop` /
   `loop_count` / `loop_mode`）目前从属性面板剔除、只由主时间轴编辑。用户提出它们应归属
   「clip 面板」，但面板形态（独立插件 `core.clip` vs 属性面板内的「片段」分组）尚未确定，
   本轮未实现。这是待裁决项，不是遗漏。
10. **面板内部交互待继续打磨**：本轮把剪辑软件的参数行形态（菱形组、值控件、选择驱动切换）
    做成可用的骨架；用户明确表示后续继续优化，故未做拖拽分隔条、列宽记忆、精确
    `scrollIntoView` 等交互细节。

## 十、与 legacy（旧 WebUI）的对照结论

`legacy/` 是 0.3.6 时代基本跑通的旧前端（55 个文件）。逐项对照后的三类结论：

### 可参考、已采纳（含源码复核）

| legacy 做法 | 采纳情况 |
|---|---|
| `getSectionLabel`：section 键 → 中文标签（`legacy/src/schema.ts:154`） | **已补**：02 目录只有英文 `section` 键、**无 `labelKey`**（`grep labelKey catalog/` 零命中），22 个 section 直接当界面文案不可读。`groupLabelOf` 现走中文映射表，未登记键原样返回 |
| `bakeSampleCount` 按**秒**推导：`round(段时长×4)+2`，钳 `[8,20]` | **已改**：原实现按 `pxPerSecond/12`，同一份文档换缩放会烘出不同节点数，不可复现。现按秒推导，与缩放无关 |
| `interpolateFloat` 的四种插值形态（`SampledProperty.Compiled:515`） | **已修**：原实现只有线性。现 `ANGLE` 走最短路径并归一到 `(-180,180]`、`GEOMETRIC` 走 `exp(log a + (log b − log a)·s)`（端点 ≤0 回落 a）、`STEP` 在 `s=1` 取后一帧 |

### legacy 有、但**经源码复核后不成立**，不采纳

| legacy 说法 | 复核结果 |
|---|---|
| LETTERBOX 由运行时内置 smoothstep，不能烘焙 | **源码无依据**：`LetterboxTrackPlayer` 里没有 smoothstep；`Curves.smoothstep` 是数学模型（`MathModelRegistry`）的曲线，与黑边轨无关。不据此拦截 |
| EVENT/MOD_EVENT 补帧会重复触发 | **源码不支持**：`EventClipRuntime.advance` 用游标 + `fired[]` 去重，只触发 `time ∈ (上次推进, 目标]` 的记录。补出的新记录是独立记录，会被正常触发一次。不据此拦截（但事件行仍拒绝烘焙，因为段缓动对离散事件无意义） |
| CAMERA + 贝塞尔 `curve` 按弧长求值，线性补帧会拉直 | **成立**：`math/path/ArcLength.java` / `PathCapability.ANALYTIC_ARC_LENGTH` 是独立参数化体系。这条**应当**拦截——但路径能力属 07 轮（`paths.collection`），06 的 `row` 模型里没有 `curve` 信息，本轮无法判断。已在 §九 记为跨轮依赖 |

### legacy 有、但**与 06 设计冲突**，明确不采纳

| legacy 做法 | 冲突点 |
|---|---|
| `maintainInvariants` 写 `timeline.total_duration` | 03-05 要求"grep 时间线总时长 0 命中"；新架构不写总时长 |
| `ensureBoundaryKeyframes`：自动补首尾帧 | 06-05 明令"不自动补帧"；补帧会改变作者数据 |
| `clampKeyframes`：把帧时间钳到 `[0,duration]` | 06-05 明令"不钳制到 [0,duration]"；轴外帧要保留 |
| `interpolateNewKeyframe`：加帧时自动按相邻帧插值 | 06-05 只允许显式值或显式采样；自动插值属"帮作者做决定" |

### legacy 也没有的（本轮新能力，无先例）

- **关键帧复制粘贴**：legacy 只有片段级 clipboard（`store.ts:900`），没有关键帧剪贴板。
- **撤销合并**：legacy 每次 `commit` 都 `pushUndo`，无合并机制；06-05 的"连续编辑合并"参考 Lexical 实现。
- **`pointercancel` 语义**：legacy 用 `mousedown/mousemove/mouseup`，根本没有该事件——冲突是 04/05 引入 pointer events 后产生的。

## 十一、设计文档的回写约定

`plan/06/*.md` 的「六、实现结果」段是**留给实现阶段填的**（05 轮文档没有这一段，06 轮专门预留），
本轮已逐份回写：文档头状态行改为 `已实现（偏差见 §六）`，§六 填实际实现与逐条偏差，
§一~§五 与验收要点原样保留。

要核对"设计说了什么"看 `plan/06/`；要核对"实际做了什么"看本文件与 `src/`。

## 十二、待办

无未完成的实现项。两处待你裁决的改进已登记为 blocked todo：
烘焙采样密度按秒推导、`easingSupport` 三条禁烘规则。
其余局限已在 §九 明确记录，不属于"静默跳过"。
