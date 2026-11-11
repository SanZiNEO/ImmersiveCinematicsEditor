# 06-StepNullableAndEnum：step、可空与离散值

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案设计）
> 合同：C08 异步属性身份
> 依赖：[06-PropertyValueForm](06-PropertyValueForm.md)、02-AnimObject（插值只读）
> 下游：07-PositionEditor（step 切换对齐）、06-EasingAuthoringBake（step 不烘焙）
> 证据前缀见 [README](../02-model-contracts/README.md) 开头

## 一、摘要

处理三类"不连续"的值：

1. **step插值**：识别仍按真实schema.interp；在效果控件对应属性行显示台阶标记/离散值、禁止连续缓动。主时间轴不画属性节点或台阶。
2. **可空数值**（`nullable_float`）：`null` = 不锁/不启用，是语义不是"空"；编辑器必须能表达"这一帧显式不锁"。
3. **离散枚举/引用**：值必须 ∈ `enumValues` 或用受约束的形态输入。

## 二、为什么做

### 2.1 现状

| 事实 | 证据 |
|---|---|
| `Interp` 有 `STEP`，`infer` 对 `int/bool/string/enum/ref/nullable_float` 默认 step | `J:spi/Interp.java（20–21、44–64）` |
| `accepts` 允许 `STEP` 用于除 `event_record`/`struct` 外的所有类型 | `Interp.accepts（75–86）` |
| step 采样语义：区间内保持前一帧 | `J:script/object/SampledProperty.java — sampleInt（361–383）、sampleBool（385–407）、sampleString（409–434）`；`interpolateFloat（515–525）` 的 `case STEP` |
| `nullable_float` 的 `null` 用 `present[]` 表达，采样时输出"无值" | `SampledProperty.compile（168–181）`、`sampleNullableFloat（437–475）`、`writeNullable（492–499）` |
| `yaw_lock`/`pitch_lock` 用"本时刻是否有值"决定是否锁 | `J:camera/source/ObjectCameraEvaluator.java — nullable（604–607）` |
| 前端旧控件是 `tristate`（三态），与 `nullable_float` 不是一回事 | `EDITOR:src/components/fields/TristateField.vue`；`types.ts（216–222）` 的 `SchemaField.type` 含 `tristate` |
| 前端缓动支持判定按轨道（不按属性） | `EDITOR:src/operations.ts — easingSupport（356–369）` |

问题：

1. 没有"step 属性"的概念；缓动可以套到 `position_mode` 上，烘焙后产生无意义帧。
2. `nullable_float` 的"显式 null 帧"无法表达（旧 `tristate` 是另一套语义）。
3. 枚举/引用的非法值只能等服务端报错。

### 2.2 目标

1. step属性：效果控件同行显示台阶而非斜坡，无连续缓动入口；快捷属性复用同一离散值控件，不另建节点轴。
2. `nullable_float`：每帧可以是"有值"或"null"；两者之间按 step；面板提供"不锁"开关。
3. 枚举：下拉严格来自 `enumValues`；引用：按 06-PropertyValueForm §3.4 的形态输入。
4. 切换类 step 字段（`position_mode`/`position_space`/`position_origin`/`position_origin_freeze`/`facing_source`）必须与 `position.x/y/z` 关键帧对齐（运行时校验，见 02-ValidationBridge L24）。

### 2.3 非目标

- 不实现插值算法（运行时采样，编辑器不复制）。
- 不改变 schema 的 `interp`（只读）。
- 不做"逐属性改插值"（`MOD:plans/0.3.6/Z-editor/object-model.md §3.5` 明确作者不能改）。

## 三、方案

### 3.1 step 属性的识别

```ts
const isStep = (def: ObjectDefView) => def.interp === 'step'
```

来源：`schema.get` 的 `interp`（`SchemaExporter.exportObject（369）` 导出 `scriptName(def.interp())`）。**不**在编辑器里重算 `Interp.infer`（那是 schema 的职责）。

注意：`mode=value` 的 `interp` 恒为 `none`，不是 `step`；它们没有关键帧，不参与本节。

### 3.2 step 属性在 UI 上的表现

| 位置 | 表现 |
|---|---|
| 属性列表 | 行尾显示台阶图标（`⌐`） |
| 效果控件节点/详情 | 每节点值用同一枚举/开关控件；无连续段缓动入口，其他展开组仍可见 |
| 效果控件属性行 | 右侧对应行可示意水平+竖直跳变，与左值控件同一布局；主时间轴不显示 |
| 播放头值显示 | 取"最后一个 `time <= t` 的帧"（不是插值） |
| 复制粘贴 | 允许（离散值） |
| 烘焙 | 禁止（见 06-EasingAuthoringBake §3.3） |

### 3.3 可空数值（`nullable_float`）

数据形态：

```json
"yaw_lock": { "keyframes": [ {"time": 0, "value": null}, {"time": 2, "value": 45}, {"time": 4, "value": null} ] }
```

含义（运行时）：

- `t < 2`：无值 → 不锁（`ObjectCameraEvaluator.nullable` 返回 null → `OrientationSpec.yawLock(null)` → 跟基准）。
- `2 <= t < 4`：锁 45°。
- `t >= 4`：不锁。

编辑器规则：

| 项 | 规则 |
|---|---|
| 帧值控件 | "不锁"开关 + 数字；关 = `null` |
| `value`（静态） | 同样可以是 `null` 或数字 |
| 插值 | `step`（`Interp.infer` 对 `nullable_float` 返回 `STEP`；`TrackSchemas（165–168）` 显式声明 `Interp.ANGLE`，见冲突 C-02-08 说明） |
| 空值显示 | 列表显示 `—（不锁）`，不显示 `0` |
| 禁止 | 把 `null` 显示成 `0` 或反之 |

**注意冲突**：`TrackSchemas` 给 `yaw_lock`/`pitch_lock` 显式声明 `Interp.ANGLE`（`165–168`），而 `Interp.infer` 对 `nullable_float` 默认 `STEP`。两者不一致时**以 schema 显式声明为准**（`ObjectParser.interpOf（199–208）` 优先取声明值）。后果：两个数值之间按角度插值，`null` 与数值之间由 `sampleNullableFloat` 的 `present` 判定处理（`437–475`）。编辑器只显示 `interp=angle`，不解释边界行为。

### 3.4 枚举与引用

| 类型 | 控件 | 校验 |
|---|---|---|
| `enum` | 下拉（`enumValues`） | 值必须在列表内（`ObjectValidator.checkTyped 384–406` 同口径） |
| `ref` | 形态下拉 + 载荷（见 06-PropertyValueForm §3.4） | 形态字符串非空；具体形态合法性由运行时解析（冲突 C-02-10） |

`enum` 的 `enumValues` 为空（schema 声明错误）→ 控件禁用并报"schema 缺少枚举值"（不落到自由文本）。

### 3.5 切换对齐（与 07 的接口）

step 字段里有一组是"参考系切换"：

```text
SPACE_SWITCH_FIELDS = position_mode, position_space, position_origin, position_origin_freeze, facing_source
BASE_SWITCH_FIELDS  = facing_target, facing_target_freeze, facing_entity,
                      look_at_freeze, yaw_base_from_freeze, yaw_base_to_freeze
```

来源：`J:script/object/ObjectValidator.java（41–48）`。

规则（运行时强制，`checkSwitches（602–636）`）：

- `SPACE_SWITCH_FIELDS` 任一在 `t > 0` 变化 → 该时刻必须同时存在 `position.x`、`position.y`、`position.z` 三轴关键帧。
- `BASE_SWITCH_FIELDS` 只在 `position_space=base` 时要求同样对齐。
- `t=0` 的初始值不算"变化"（`collectChanges（638–655）` 里 `frame.time() <= 0f` 只更新 previous）。

编辑器责任（本文件只定义"提示与一键补齐"，不实现位置面板）：

1. 当作者改这些 step 字段（在 `t>0`）时，若三轴缺帧 → 弹出"参考系切换需要三轴位置关键帧"，提供：
   - "在切换点补齐三轴关键帧"（值 = 切换前一刻的采样近似，**明确标注为近似**）
   - "取消修改"
2. 不允许静默只改 step 值（否则 `script.validate` 必报）。

## 四、技术细节

### 4.1 输入输出

| 函数（提案） | 输入 | 输出 |
|---|---|---|
| `isStep(def)` | 声明 | boolean |
| `stepValueAt(row, t)` | 行 + 时间 | 该时刻生效值（左帧） |
| `switchImpact(doc, clipKey, path, time)` | 文档 + 待改字段 | `{needsPositionFrames: boolean, missing: string[]}` |

### 4.2 修改步骤（WebUI）

1. 新建 `EDITOR:src/model/stepFields.ts`（提案）：`isStep`、`stepValueAt`、`SWITCH_FIELDS` 常量（与运行时同名同集合）。
2. 改 `EDITOR:src/components/objects/KeyframeRow.vue`：step 属性用下拉/开关/可空开关。
3. 改 `EDITOR:src/components/Timeline.vue`：step 属性行画台阶。
4. 改 `EDITOR:src/operations.ts — easingSupport（356–369）`：删除（缓动入口由 06-EasingAuthoringBake 按属性 `interp` 判定）。
5. 删除 `EDITOR:src/components/fields/TristateField.vue`（若未被 `meta` 使用；`meta.hide_*` 已移除）。
6. 在 07-PositionEditor 里实现 §3.5 的补齐对话框（本文件提供 `switchImpact`）。

### 4.3 未来 14 迁移参考：游戏内 Forge 1.20.1 实现

> 本节仅 14 迁移参考，不构成本轮 WebUI 出口；本轮 WebUI 只对接主模组 Forge/Fabric，不等待游戏内 Java/AUI 实现。

1. `INGAME:common/.../editor/model/StepFields.java`（提案）：同常量与判定。
2. 补齐对话框在 07 的界面里。

### 4.4 禁止修改

- 不重算 `interp`（读 schema）。
- 不把 `null` 与 `0` 互转。
- 不给 step 属性提供缓动。
- 不静默改 step 值而不检查三轴对齐。
- 不把 `enum` 退化成自由文本。

## 五、正反例验收

### 5.1 正例

1. `position_mode`（step）在 `t=2` 从 `relative` 改 `absolute`，且 `t=2` 有 `position.x/y/z` 三帧 → 允许；`script.validate` 通过。
2. 同上但 `t=2` 只有 `position.x` → 阻止并提示缺 `position.y`、`position.z`。
3. `yaw_lock` 帧 `[{0,null},{2,45},{4,null}]`：面板显示 `—`/`45`/`—`；`t=3` 显示 45；`t=5` 显示 `—`。
4. `look_at`（enum）下拉只有 `none/player/coordinate/entity/block`（`TrackSchemas 211–213`）。
5. `layer_type`（enum）下拉 `fade/image/subtitle`（`443–444`）；改成 `image` 后 `source.*` 出现（`appliesTo`）。

### 5.2 反例

| 场景 | 期望 |
|---|---|
| 给 `position_mode` 设缓动并烘焙 | 禁止（step 不烘焙） |
| `yaw_lock` 关闭写成 `{"value":0}` | 禁止（应为 `null`） |
| `attenuation` 输入 `inverse` | 拒绝（schema 只有 `none`/`linear`，`TrackSchemas 372–373`） |
| `layer_type` 输入 `pip` | 拒绝（`443–444`） |
| `t=2` 改 `position_space` 但不补三轴帧 | 阻止（`checkSwitches` 会报） |
| 枚举字段 `enumValues` 为空时给自由文本 | 禁止（禁用控件） |

### 5.3 异步关键帧专项

**正例**：`position_space` 在 `t=0` 是 `world`、在 `t=3` 切 `base`；`position.x/y/z` 在 `t=3` 各有 1 帧。→ 无 issue。

**反例**：只在 `t=3` 给 `position.x` 加帧（作者以为"x 是主要轴"）→ 本地 `block`，且服务端同样报错（`ObjectValidator.checkSwitches 626–633`）。

## 六、真实冒烟（真游戏校验）

1. Forge 1.20.1 + 主模组；打开 CAMERA 片段，`duration=6`。
2. `position_space` 在 `t=3` 从 `world` 改 `base`；按提示补齐三轴帧；保存。
3. `script.validate` → `ok:true`。
4. 游戏内播放：`t<3` 世界轴偏移、`t>=3` 基准系偏移（观察相机轨迹在切换点后方向改变）。
5. 给 `yaw_lock` 设 `[{0,null},{2,45},{4,null}]`；播放确认 `2~4s` 锁 45°、其余跟基准。

通过判定：第 3 步通过；第 4 步轨迹可见变化；第 5 步锁/不锁行为正确。

## 七、完成定义

1. `stepFields.ts` 存在；`SWITCH_FIELDS` 与运行时同名同集合。
2. step属性无连续缓动入口；台阶仅画在效果控件对应行，主时间轴保持片段编排。
3. `nullable_float` 的 `null` 全程不被写成 `0`。
4. §5 的 5 条正例、6 条反例通过。
5. §6 冒烟 5 步通过。
6. （14 迁移要求，本轮不作为出口）游戏内 Forge 载体同判定（同一文档得到相同 `switchImpact`）。
