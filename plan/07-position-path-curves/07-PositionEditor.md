# 07-PositionEditor：位置模式、空间与原点

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案设计）
> 合同：C09 路径与数值辅助
> 依赖：02（模型/命令）、06-ClipEffectControlsPanel / 06-EffectControlsRows / 06-PropertyValueForm（效果控件行、局部标尺与统一值控件）、07-PointSourceForms
> 下游：07-OrientationEditor（依赖 `position_space=base` 的方向源）、07-PathCollectionEditor（端点来源）
> 证据前缀见 [README](../02-model-contracts/README.md) 开头

## 一、摘要

实现"位置"这一组属性的编辑界面：`position_mode`、`position_space`、`position_origin`、`position_origin_x/y/z`、`position_origin_freeze`、`position.x/y/z`，以及它们与 `facing_*` 的联动。

本文件的核心是**合法组合**与**切换对齐**：`absolute` 只能配 `world` 且原点为空；`base` 才有方向源；任何在 `t>0` 的切换都必须在同刻补三轴位置关键帧。

## 二、为什么做

### 2.1 现状与运行时

| 事实 | 证据 |
|---|---|
| `PositionMode` 只有 `RELATIVE`/`ABSOLUTE`；`absolute` 必须配 `world`、原点为空（validator 保证） | `J:script/object/position/PositionMode.java（1–9）`；`PositionEvaluator.evaluate（62–64）`；`ObjectValidator.checkCamera（500–516）` |
| `PointSpace` 只有 `WORLD`/`BASE`；`base` 的三轴读作 `(fwd, up, right)` | `PointSpace.java（1–10）`；`PointOffset.base（21–23）`；`PositionEvaluator.evaluate（78–90）` |
| 空原点：`world` = 玩家激活位置（`PointKind.WORLD`，静态）；`base` = 隐式 `@p`（`PointKind.SELECTOR`） | `PointSourceSpec.positionOrigin（60–72）` |
| `position_origin_freeze` 只对实体选择器有意义（validator 告警），但求值层对任何来源都会冻结含偏移世界点 | `ObjectValidator.checkFreezes（568–582）`；`PositionEvaluator.evaluate（74、85–89）` |
| 参考系切换必须与三轴位置关键帧对齐 | `ObjectValidator.checkSwitches（602–636）`、`SPACE_SWITCH_FIELDS（41–43）` |
| `facing_*` 只在 `base` 读取 | `ObjectValidator.checkCamera（541–549）`；`PositionEvaluator.frame（113–129）` |
| `base` 的参考系上轴固定世界竖直 | `PositionEvaluator` 常量 `UP（42）`；`entityFrame（154–173）`、`lineFrame（176–194）` |
| 编辑器旧 `PositionField.vue` 只编辑 `{dx,dy,dz}` | `EDITOR:src/components/fields/PositionField.vue`；`types.ts — PositionData（11–23）` |

### 2.2 目标

1. 组合非法时 UI 直接禁止（不是保存后才报错）。
2. 切换 `position_mode`/`position_space`/`position_origin`/`position_origin_freeze`/`facing_source` 时，若在 `t>0`，强制检查并提示补三轴帧。
3. 三轴编辑：位置组在效果控件内同时列出 `position.x/y/z` 三行（各自的值、秒表、节点），并提供显式的"三轴同时打帧"命令；该视图不是独占页，选中一行不会隐藏同片段其他已展开组。
4. `base` 空间下显示坐标轴语义提示（`(x,y,z) = (fwd, up, right)`），避免作者按世界轴理解。
5. 原点为坐标时显示 `position_origin_x/y/z`；原点为空时显示"默认"说明（world = 玩家激活位置；base = @p）。
6. 界面承载：本文件是 `clip.effects` 中 CAMERA 位置组的渲染器，随片段选中自动出现；不得注册成独立检查器 tab，也不得要求主时间轴展开属性行。

### 2.3 非目标

- 不解析实体/方块/结构（运行时 `WorldContext` 的职责）。
- 不做飞控取景（12/13）。
- 不做朝向（07-OrientationEditor）。

## 三、方案

### 3.1 位置组结构（效果控件内）

位置组是 `clip.effects` 中 CAMERA 片段的一个处理组；下图只画该组自身的行，不表示它独占整个面板。同一片段的其他组（朝向、光学、合成……）与它同时可见、各自折叠。

```text
┌ 效果控件 · 位置组 ─────────────────────────────┐
│ 模式   (•) relative   ( ) absolute             │
│ 空间   (•) world      ( ) base                  │
│ 原点   [ 默认（玩家激活位置）        ▾ ]        │
│        ├ player                                 │
│        ├ coordinate   x[ 0 ] y[ 64 ] z[ 0 ]     │
│        ├ block:id[:radius]  [ minecraft:stone ] │
│        ├ @selector / uuid:…  [ @p            ]  │
│        └ structure:<id>      [ village_plains ] │
│ 冻结   [ ] position_origin_freeze（仅实体选择器）│
│ ── 偏移 ─────────────────────────────────────── │
│ position.x [ 0 ]  ◇ 节点列                      │
│ position.y [ 2 ]  ◇ 节点列                      │
│ position.z [ 0 ]  ◇ 节点列   (world: dx,dy,dz)   │
│                              (base: fwd,up,right)│
│ [在三轴同时打帧]（显式命令，不自动联动）        │
└────────────────────────────────────────────────┘
```

三行共享该片段效果控件的局部秒标尺与播放头；行内编辑只作用于该属性，其他组的行不受影响。

控件来源：`position.x/y/z` 是 `animated` + `Interp.LINEAR`（`TrackSchemas 113–118`）；`position_mode`/`position_space` 是 `animated` + `STEP` + `enumValues`（`119–122`）；`position_origin` 是 `animated` + `STEP` + `REF`（`123–124`）；`position_origin_x/y/z` 是 `animated` + `LINEAR` + 默认 `null`（`125–130`）；`position_origin_freeze` 是 `animated` + `STEP` + `BOOL`（`131–132`）。

### 3.2 组合规则（UI 强制）

| 条件 | 行为 |
|---|---|
| `position_mode=absolute` | `position_space` 锁定 `world`；原点控件禁用并显示"absolute 不使用原点"；`facing_*` 全部隐藏 |
| `position_mode=absolute` 且文档里已有原点/方向源 | 显示"存在将被忽略的字段"，提供"清除"（显式命令，不自动删） |
| `position_space=base` 且 `position_mode=relative` | 显示 `facing_source` + 载荷 |
| `position_space=world` | `facing_*` 隐藏；若文档里有 → 提示"写了但 world 不读取"（`checkCamera 541–549` 同口径） |
| 原点 = `coordinate` | 显示 `position_origin_x/y/z`（必填语义：缺省 `null` → 运行时按 0 处理，见 §3.4） |
| 原点 = 其他 | 隐藏 `position_origin_x/y/z`（写了会被忽略，不报错） |
| `position_origin_freeze=true` 且原点不是实体选择器 | 提示"该开关对静态来源无效果"（`checkFreezes 569–577`） |

### 3.3 切换对齐（关键）

```ts
function onSwitchFieldChange(path, newValue, atTime) {
  if (atTime <= 0) { commit(setValue) ; return }          // t=0 的初始值不算变化
  const missing = ['position.x','position.y','position.z']
      .filter(p => !hasKeyframeAt(p, atTime))
  if (missing.length) {
    showDialog({
      title: '参考系切换需要三轴位置关键帧',
      missing,
      actions: [
        { label: '在切换点补齐（近似值）', run: insertApproxFrames(missing, atTime) },
        { label: '取消修改', run: noop },
      ],
    })
    return
  }
  commit(setValue)
}
```

规则来源：

- `SPACE_SWITCH_FIELDS = position_mode, position_space, position_origin, position_origin_freeze, facing_source`（`ObjectValidator 41–43`）。
- `BASE_SWITCH_FIELDS = facing_target, facing_target_freeze, facing_entity, look_at_freeze, yaw_base_from_freeze, yaw_base_to_freeze`（`46–48`），**只在 `position_space=base`** 时要求对齐（`checkSwitches 604–623`）。
- `t <= 0` 的帧只更新"上一个值"，不算变化（`collectChanges 641–650`）。
- 检查三轴**全部**存在（`hasKeyframeAt` 逐个查，`674–689`）。

"近似值"= 该属性在 `atTime` 之前最后一个帧的值（step/线性外推不承诺），UI 必须标注"近似，请在预览中确认"。

### 3.4 缺省与 `null`

| 字段 | 缺省 | 编辑器显示 |
|---|---|---|
| `position.x/y/z` | `0`（`TrackSchemas 113–118`） | `0` |
| `position_mode` | `relative` | relative |
| `position_space` | `world` | world |
| `position_origin` | `""`（`123–124`） | "默认" |
| `position_origin_x/y/z` | `null`（`125–130`） | 空（占位 `0`），提示"未写 = 0" |
| `position_origin_freeze` | `false` | 关 |

注意：`position_origin_x/y/z` 的 schema 默认是 `null`，但 `ObjectCameraEvaluator` 用 `f(...)` 读 float，`floatDefaults` 对 `null` 默认值取 `0f`（`ObjectCameraEvaluator` 构造 191–198）。所以"未写 = 0"是运行期事实；编辑器显示占位 0 并说明来源。

### 3.5 三轴联动视图（组内布局，非独占页）

- 位置组在效果控件中同时列出 `position.x/y/z` 三行，共用该片段的一条局部标尺；每行有自己的秒表、前后节点与节点列（由 06-EffectControlsRows 提供）。
- 同时展开的位置组与朝向组、光学组等互不遮挡：选中 `position.y` 只改高亮与编辑目标，`yaw` 等行仍可见可编辑。
- 提供"在三轴同时打帧"按钮（显式命令）：一次 `commit` 给三个属性各加一帧，值分别取当前值。
- **不**自动三轴联动：作者只改 x 时 y/z 不动（与运行时一致：三轴是独立属性）。
- 不提供"只显示三轴"的切换；需要聚焦某轴时用效果控件的行过滤/滚动，不切走整个片段的其他组。

## 四、技术细节

### 4.1 输入输出

| 函数（提案） | 输入 | 输出 |
|---|---|---|
| `positionCombination(doc, clipKey)` | 文档 | `{mode, space, originKind, visiblePaths, disabledPaths, warnings}` |
| `switchImpact(doc, clipKey, path, time)` | 文档 + 待改字段 | `{needsFrames, missing}`（与 06-StepNullableAndEnum §4.1 同一函数） |
| `insertApproxFrames(clipKey, paths, time)` | — | `DocCommand` |

### 4.2 修改步骤（WebUI）

1. 新建 `EDITOR:src/components/objects/PositionEditor.vue`（提案）：作为 `clip.effects` 中 `section=position` 的组渲染器。
2. 新建 `EDITOR:src/model/positionCombination.ts`（提案）：§3.2 的组合规则（纯函数，便于测试）。
3. 改 `EDITOR:src/components/fields/FieldRenderer.vue`：删除 `position` 类型分支（新 schema 无此类型）。
4. 删除 `EDITOR:src/components/fields/PositionField.vue`。
5. 改 `EDITOR:src/types.ts`：删除 `PositionData`（11–23）。
6. 在 06-ClipEffectControlsPanel 的组表注册 `section=position` 的组渲染器；叶子行交给 06-EffectControlsRows/06-PropertyValueForm。不新增独立检查器 tab，不在主时间轴加入口。

### 4.3 未来 14 迁移参考：游戏内 Forge 1.20.1 实现

> 本节仅 14 迁移参考，不构成本轮 WebUI 出口；本轮 WebUI 只对接主模组 Forge/Fabric，不等待游戏内 Java/AUI 实现。

1. `INGAME:common/.../editor/ui/PositionEditorScreen.java`（提案）。
2. 组合规则同 `positionCombination`；切换对齐同 `switchImpact`。

### 4.4 禁止修改

- 不把 `absolute` 与 `base` 组合（validator 会拒）。
- 不在 `world` 空间显示 `facing_*`（会误导）。
- 不自动清除"将被忽略的字段"。
- 不自动三轴联动打帧（除显式"三轴同时打帧"命令）。
- 不把 `position_origin_x/y/z` 的缺省 `null` 显示成"未设置且无默认"（运行期是 0）。
- 不把位置组做成独立检查器 tab 或以"三轴视图"名义切走同片段其他已展开组。
- 不为效果控件行另建关键帧数据或第二份 Selection；节点读写仍走 02/06 的同一命令与局部标尺。
- 不在主时间轴新增位置属性行、节点或汇总入口。

## 五、正反例验收

### 5.1 正例

1. `mode=relative`、`space=world`、原点默认 → 三轴可见；`facing_*` 隐藏；`script.validate` 通过。
2. 切到 `absolute` → `space` 锁 `world`、原点控件禁用；保存后 validator 通过（原点为空）。
3. `space=base`、原点 `@p`、`facing_source=entity` → `facing_entity` 可见（可空，缺省回落原点）。
4. 原点 `coordinate` → 出现 `position_origin_x/y/z`；填 `(10,64,-5)`；保存通过。
5. `position_space` 在 `t=3` 从 `world` 切 `base`，三轴 `t=3` 已有帧 → 直接提交。
6. `position_space` 在 `t=3` 切换但缺 `position.y/z` → 弹窗列出缺失；选"补齐"后三轴都有帧。
7. 同一 CAMERA 片段同时展开位置组与朝向组：选中 `position.y` 行时 `yaw/pitch` 行仍在，右侧各自节点列对齐；修改 `position.y` 不改 `yaw`。
8. 在快捷属性里改 `position.x` 当前值 → 效果控件同一行同步，标准文档只变一处；主时间轴片段高度不变。

### 5.2 反例

| 场景 | 期望 |
|---|---|
| `absolute` + `base` | UI 禁止（下拉禁用） |
| `absolute` 且保留原点 `@p` | 提示"将被忽略"并提供清除，不静默删 |
| `world` 下显示 `facing_target` | 禁止（隐藏 + 若存在则提示） |
| 切换 `facing_source` 但不补三轴帧 | 阻止（`checkSwitches` 会报） |
| 把 `position_origin_x` 显示成"必填" | 禁止（schema 无 required） |
| 改 `position.x` 时自动改 `y` | 禁止 |
| 打开位置组后其他已展开组消失，或位置组被做成独立页 | 禁止（违反效果控件多组同时可见） |
| 主时间轴出现 `position.x` 行/节点 | 禁止 |

### 5.3 异步关键帧专项

**正例**：`position.x` 帧 `[0,3]`、`position.y` 帧 `[0,3]`、`position.z` 只有 `value`。在 `t=3` 把 `position_space` 改 `base` → 弹窗缺 `position.z`；补齐后 `position.z` 有 `[3]` 一帧（值 = 当前 `value`）。

**反例**：只给 `position.x` 补帧就提交 → 服务端 `checkSwitches` 报"参考系切换缺少 position.x/y/z 关键帧"。

## 六、真实冒烟（真游戏校验）

1. Forge 1.20.1 + 主模组；CAMERA 片段 `duration=6`。
2. 设 `relative` + `world` + 原点 `@p` + 三轴 `(0,2,0)`；保存；播放确认相机在玩家上方 2 格。
3. 在 `t=3` 切 `base`，补三轴帧；保存；播放确认 `t>=3` 后偏移沿玩家朝向（fwd/up/right）。
4. 切 `absolute` 并清空原点；保存；播放确认相机固定在绝对坐标。
5. 原点改 `coordinate (100,70,100)`；保存；播放确认相对该坐标偏移。

通过判定：第 2/3/4/5 步画面位置符合预期；`script.validate` 全通过；日志无"缺少 position"错误。

## 七、完成定义

1. `PositionEditor.vue` + `positionCombination.ts` 存在，并在 `clip.effects` 的组表注册。
2. `PositionField.vue` / `PositionData` 已删除。
3. §3.2 组合规则与 §3.3 切换对齐在 UI 上生效。
4. §5 的 8 条正例、8 条反例通过。
5. §6 冒烟 5 步通过。
6. 位置组与同片段其他组同时可见；无独立检查器页、无主时间轴对象行入口。
7. （14 迁移要求，本轮不作为出口）游戏内 Forge 载体同组合规则与同弹窗（缺失项一致）。
