# 07-MathModelEditor：数学模型编辑

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案设计）
> 合同：C09 路径与数值辅助
> 依赖：02-SchemaSnapshot（`models` 段）、02-AnimObject（STRUCT 值）
> 下游：08（转场曲线复用）、13（WebUI 验收）
> 证据前缀见 [README](../02-model-contracts/README.md) 开头

## 一、摘要

`objects.motion_position` / `motion_yaw` / `motion_pitch` / `motion_roll` / `motion_fov` / `motion_zoom`（以及 `transition_curve`）是 **value-only STRUCT**，值是"数学模型定义"。模型类型与参数由 `MathModelRegistry` 注册表导出到 `schema.get` 的 `models` 段。

本文件定义：7 个挂载点、11 种已注册模型、组合子（`chain`/`blend`）、值域（`domain`）、以及**与路径表单不同的容错口径**（未知参数忽略、未知类型回落 `linear`）。

## 二、为什么做

### 2.1 现状与运行时

| 事实 | 证据 |
|---|---|
| `motion_*` 六通道是 `value` + `struct` | `J:script/schema/TrackSchemas.java（288–291）` |
| `transition_curve` 也是 `value` + `struct` | `TrackSchemas（308）` |
| 解析期把这 7 条替换成 `MathModel`（强类型） | `J:script/ScriptParser.java — structKindOf（505–543）`、`normalizeStructs（545–580）` |
| 已注册 11 种：`linear`/`smoothstep`/`ease_in`/`ease_out`/`ease_in_out`/`cubic_bezier`/`exponential_smooth`/`spring`/`inertia`/`chain`/`blend` | `J:script/schema/MathModelRegistry.java — static 块（105–117）` |
| 未注册类型 → 限频告警 + 回落 `linear`，**不阻断加载** | `DEFAULT_TYPE="linear"（48）`、`create（201–205）` |
| 未知参数 → 忽略 + 告警 | `normalizeParams（243–248）` |
| 参数非有限/类型不符 → 缺省 + 告警 | `numberParam（253–264）` |
| 越界参数 → 钳制 + 告警 | `warnIfClamped（363–368）`、各 `clamp*` |
| 定义树深度上限 8、节点上限 32；超限整链回落 `linear` | `MODEL_MAX_DEPTH（51）`、`MODEL_MAX_NODES（54）`、`create（148–158）` |
| 值域：`scalar`/`angle`/`vector`/`color`；组合域不匹配 → 子模型回落 `linear` | `J:math/ValueDomain.java（10–15）`；`build（186–207）` |
| 通道默认域：`motion_position=VECTOR`、`motion_yaw/pitch/roll=ANGLE`、`motion_fov/zoom=SCALAR`；其余 SCALAR | `CHANNEL_DOMAINS（68–74）`、`channelDomain（174–177）` |
| 运行时守门：输入/输出非有限 → `reset()` + 本帧输出 = 输入 | `GuardedInstance（466–491）` |
| `dt` 上限 0.25 秒；负 dt 按 0 | `J:math/MathModelInstance.java（16）`；`StatefulInstance（22–30）` |
| 编辑器无模型编辑 | — |

### 2.2 目标

1. 7 个挂载点各一个入口；表单按 `models.<type>` 参数表渲染。
2. 组合子可视化：`chain.models[]`（有序链）、`blend.a`/`blend.b`（两个子模型）+ `weight`。
3. `domain` 可选；不填时按通道默认域（`channelDomain`）。
4. **必须显示回落警告**：未知类型、未知参数、越界钳制、超深/超节点 → "运行时已回落/忽略/钳制"，否则作者以为生效。
5. 深度/节点计数在编辑时提示（接近上限时警告）。

### 2.3 非目标

- 不实现模型求值（运行时 `MathModelInstance.step`）。
- 不做"参数曲线可视化"（可选，非本轮验收项）。
- 不改注册表。

## 三、方案

### 3.1 挂载点

| 路径 | 通道域（默认） | 语义 |
|---|---|---|
| `motion_position` | `vector`（3 通道） | 位置运动模型 |
| `motion_yaw` | `angle`（1） | yaw 运动模型 |
| `motion_pitch` | `angle`（1） | pitch 运动模型 |
| `motion_roll` | `angle`（1） | roll 运动模型 |
| `motion_fov` | `scalar`（1） | fov 运动模型 |
| `motion_zoom` | `scalar`（1） | zoom 运动模型 |
| `transition_curve` | `scalar`（1，`channelDomain` 未列 → SCALAR） | 转场曲线（08 轮消费） |

来源：`MathModelRegistry.CHANNEL_DOMAINS（68–74）`、`channelDomain（174–177）`。

### 3.2 11 种模型与参数

> `FieldDef.type` 只出现三种：`float`、`model`、`model_list`（`MathModelRegistry` 的 `params(...)` 构造，78–103）。

| 类型 | 参数 | 类型 | 默认 | 备注 |
|---|---|---|---|---|
| `linear` | — | — | — | 恒等；也是所有回落的终点 |
| `smoothstep` | — | — | — | `3t²-2t³`（`J:math/Curves.java 19–22`） |
| `ease_in` | — | — | — | `t²`（25–28） |
| `ease_out` | — | — | — | `1-(1-t)²`（31–34） |
| `ease_in_out` | — | — | — | 两段二次（37–44） |
| `cubic_bezier` | `x1` | float | `1/3` | 钳制 `clampX`（`CubicBezierCurve 51–57`） |
| | `y1` | float | `1/3` | 钳制 `clampY`（59–65） |
| | `x2` | float | `2/3` | |
| | `y2` | float | `2/3` | |
| `exponential_smooth` | `tau` | float | `0.15` | 钳制 `clampTau` |
| `spring` | `stiffness` | float | `8.0` | 钳制 |
| | `damping` | float | `0.75` | 钳制 |
| | `initial_velocity` | float | `0.0` | 钳制 |
| `inertia` | `stiffness` | float | `8.0` | 钳制 |
| | `damping` | float | `0.75` | 钳制 |
| | `initial_velocity` | float | `0.0` | 钳制 |
| `chain` | `models` | model_list | 空 | 空 = 恒等（`modelListParam 267–287`） |
| `blend` | `a` | model | 缺失 = `linear` | `identity（345–347）` |
| | `b` | model | 缺失 = `linear` | 同上 |
| | `weight` | float | `0.5` | 钳制 `clampWeight` |

默认值来源：`CUBIC_BEZIER_PARAMS（78–82）`、`EXPONENTIAL_SMOOTH_PARAMS（84–85）`、`SPRING_PARAMS（87–90）`、`INERTIA_PARAMS（92–95）`、`CHAIN_PARAMS（97–98）`、`BLEND_PARAMS（100–103）`；常量见 `J:math/CubicBezierCurve.java（12–15）`、`ExponentialSmoothModel.java（18、20）`、`SpringModel.java（20–27）`、`InertiaModel.java（21–28）`、`BlendModel.java（16–17）`。

### 3.3 组合子的编辑形态

```text
┌ motion_yaw（angle）─────────────────────────────┐
│ 类型 [ blend ▾ ]                                │
│   a      [ spring ▾ ]                           │
│            stiffness [ 8.0 ] damping [ 0.75 ]   │
│            initial_velocity [ 0.0 ]             │
│   b      [ chain ▾ ]                            │
│            models:                              │
│              [1] ease_in                        │
│              [2] cubic_bezier x1[0.33] …        │
│            [+ 添加子模型]                        │
│   weight [ 0.5 ]                                │
│ domain [ （继承 angle） ▾ ]                      │
│ 深度 3 / 8   节点 5 / 32                        │
└─────────────────────────────────────────────────┘
```

- 树结构由 `model`/`model_list` 递归渲染。
- 深度/节点计数实时显示（`measure` 的口径：深度含根 = 1，`385–401`）。
- 超限时**不阻止**保存（运行时会整链回落），但必须显示 `block` 级提示"运行时将整链回落为 linear"。

### 3.4 `domain`

| 值 | 通道数 | 说明 |
|---|---|---|
| `scalar` | 1 | — |
| `angle` | 1 | 度；差值/混合取最短路径（`ValueDomain` 注释 7–8） |
| `vector` | 3 | — |
| `color` | 4 | — |

规则：

- 顶层不填 → 用通道默认域（§3.1）。
- 子模型不填 → 继承父定义域（`build（187–200）`）。
- 子模型显式填了**不同于父**的域 → 该子模型回落 `linear`（`build 193–196`），编辑器必须警告"域不匹配，子模型将回落 linear"。
- 未知域字符串 → 忽略 + 告警（`build 191–192`）。

### 3.5 容错口径（与路径表单相反，必须显式提示）

| 情况 | 运行时 | 编辑器 UI |
|---|---|---|
| 未知 `type` | 回落 `linear` + 限频告警 | 下拉不提供；已有文档出现 → **warn**"运行时回落 linear"，不阻断保存 |
| 未知参数 | 忽略 + 告警 | 不提供；已有文档出现 → **warn**"运行时忽略该参数" |
| 参数类型不符 | 用默认 + 告警 | 本地拒绝输入 |
| 参数越界 | 钳制 + 告警 | 显示钳制后的值 + warn |
| 深度 > 8 / 节点 > 32 | 整链回落 `linear` | **block**（保存前必须提示；不阻止保存但明确告知） |

对比：`paths[].geometry` 的未知参数是**报错**（`PathCurveRegistry.create 277–284`）。两个面板的文案必须区分，不能复用同一套提示。

### 3.6 运行时守门（编辑器不需要模拟，但要说明）

- 输入或输出非有限 → 实例 `reset()`，本帧输出 = 输入（`GuardedInstance 479–490`）。
- `dt < 0` 按 0；`dt > 0.25` 按 0.25（`MathModelInstance.MAX_DT 16`、`StatefulInstance 26–28`）。
- 有状态模型（`spring`/`inertia`/`exponential_smooth`）首步以输入为初值（`StatefulInstance.seed`）。
- 编辑器不显示"模型输出值"（无法在不运行游戏的情况下求值）；只显示定义。

## 四、技术细节

### 4.1 输入输出

| 函数（提案） | 输入 | 输出 |
|---|---|---|
| `modelTypes(schema): string[]` | `models` 段 | 类型列表（注册顺序） |
| `paramsOf(schema, type): FieldDefView[]` | 类型 | 参数表 |
| `measureModel(def): {depth, nodes}` | 定义 | 计数（与 `measure` 同口径） |
| `validateModel(schema, def, channelDomain): Issue[]` | 定义 + 默认域 | 本地 issue |

### 4.2 修改步骤（WebUI）

1. 新建 `EDITOR:src/components/objects/MathModelEditor.vue`（提案，递归组件）。
2. 新建 `EDITOR:src/model/mathModel.ts`（提案）：`modelTypes` / `paramsOf` / `measureModel` / `validateModel`。
3. 在 06-PropertyValueForm 的 `StructField` 挂载点里，对 7 条路径挂 `MathModelEditor`。
4. 在 08 轮的转场面板里复用同一组件编辑 `transition_curve`。

### 4.3 未来 14 迁移参考：游戏内 Forge 1.20.1 实现

> 本节仅 14 迁移参考，不构成本轮 WebUI 出口；本轮 WebUI 只对接主模组 Forge/Fabric，不等待游戏内 Java/AUI 实现。

1. `INGAME:common/.../editor/ui/MathModelEditor.java`（提案）。
2. 参数表来自 `MathModelRegistry.params(type)`；可用 `MathModelRegistry.create` 做"试构造"并对比 `type()` 是否被回落（若 `create` 返回的 `type()` 与请求不同 → 说明回落，UI 警告）。注意 `create` 有副作用（限频告警日志），试构造时需接受这一点。

### 4.4 禁止修改

- 不硬编码模型参数名（读 `models`）。
- 不把未知类型当错误阻止保存（运行时回落）。
- 不把 `chain.models` 排序（顺序即执行顺序）。
- 不自动补 `domain`（继承是运行时语义）。
- 不把 `transition_curve` 当普通 `struct` 原文编辑（它有专用模型语义）。

## 五、正反例验收

### 5.1 正例

1. `motion_yaw` 选 `spring`，参数默认 → 保存；`ScriptParser.normalizeStructs` 解析成 `SpringModel`；`script.validate` 通过。
2. `motion_position` 选 `chain`，两个子模型 `ease_in` + `cubic_bezier(x1=0.4,y1=0,y2=1,x2=0.6)` → 深度 2、节点 3；通过。
3. `motion_fov` 选 `blend`，`a=spring`、`b=linear`、`weight=0.3` → 通过。
4. `motion_roll` 选 `cubic_bezier`，`x1=2`（越界）→ 编辑器显示钳制后的值（`clampX`）并 warn。
5. `motion_yaw` 的 `domain` 留空 → 继承 `angle`（`CHANNEL_DOMAINS`）。
6. 在 `blend.a` 上显式写 `domain:"scalar"`（父为 `angle`）→ warn"域不匹配，子模型将回落 linear"。

### 5.2 反例

| 输入 | 期望 |
|---|---|
| `motion_yaw` 的 `type:"wobble"` | warn"运行时回落 linear"，不阻断保存 |
| `spring` 多一个参数 `"foo":1` | warn"运行时忽略该参数" |
| `stiffness:"8"`（字符串） | 本地拒绝 |
| 深度 9 的 `chain` 嵌套 | block 提示"运行时整链回落 linear" |
| `chain.models` 为空 | 允许（= 恒等） |
| 把 `transition_curve` 当普通 struct 原文编辑 | 禁止（用模型表单） |
| `motion_yaw` 选 `vector` 域的模型（若某模型强制 vector） | 警告域不匹配 |

### 5.3 异步关键帧专项

**正例**：`motion_yaw` 是 `value-only`，**不能**有 `keyframes`。作者想"让模型参数随时间变" → 编辑器拒绝并提示"`motion_*` 是 value-only，模型参数不随时间变化；要逐帧控制请用 `yaw` 关键帧"。

**反例**：给 `motion_yaw` 写 `keyframes` → 运行时 `ObjectParser.parseProperty（107–109）` 拒绝（`mode=value` 不允许 keyframes）。

## 六、真实冒烟（真游戏校验）

1. Forge 1.20.1 + 主模组；CAMERA 片段，`yaw` 两帧 0→90。
2. `motion_yaw` 设 `spring`（默认参数）→ 播放：yaw 有过冲/回弹（弹簧特征）。
3. 改成 `linear` → 播放：无过冲。
4. 设 `chain: [ease_in, spring]` → 播放：先缓入再弹簧。
5. 设未知类型 `"wobble"` → 播放：等同 `linear`；编辑器已 warn。

通过判定：第 2 步过冲可见；第 4 步两段特征可见；第 5 步行为与警告一致。

## 七、完成定义

1. `MathModelEditor.vue` + `mathModel.ts` 存在；参数表来自 `models`。
2. 深度/节点计数与回落警告可见。
3. 7 个挂载点都可进入模型编辑。
4. §5 的 6 条正例、7 条反例通过。
5. §6 冒烟 5 步通过。
6. （14 迁移要求，本轮不作为出口）游戏内 Forge 载体同参数表与同回落提示。
