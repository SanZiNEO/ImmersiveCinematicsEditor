# 02-AnimObject：属性容器与值模型

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案设计）
> 合同：C02 标准脚本文档
> 依赖：[02-ScriptDocument](02-ScriptDocument.md)、[02-SchemaSnapshot](02-SchemaSnapshot.md)
> 下游：06（属性面板/关键帧）、07（位置/朝向/路径）
> 证据前缀见 [README](README.md) 开头

## 一、摘要

定义 `AnimObject`（一个采样属性）、`ObjectKeyframe`（一个属性的一帧）、三种形态（`value` / `animated` / `event`）、九种值类型在编辑器里的表示，以及"值 → JSON"的严格映射。

本文件是 06 与 07 的共同地基：06 管"怎么编辑"，07 管"具体字段是什么意思"，本文件管"字段在文档里长什么样、什么算合法"。

## 二、为什么做

### 2.1 现状与运行时

| 事实 | 证据 |
|---|---|
| 前端关键帧是整帧快照（一帧带 `position`/`yaw`/`fov`/`opacity`…） | `EDITOR:src/types.ts — Keyframe（103–141）` |
| 运行时关键帧只带 `time` + `value`，只属于一个属性 | `J:script/object/ObjectKeyframe.java（12）` |
| 运行时容器是 `Map<path, SampledProperty>` | `J:script/object/ClipObjects.java（26–38）` |
| 三种形态在构造期硬校验 | `J:script/object/SampledProperty.java（60–96）` |
| 值类型 9 种，严格转换、拒绝非有限 | `J:spi/PropertyType.java（9–31）`；`J:script/object/ObjectCodec.java — fromJson（43–58）` |
| `struct` 只允许 `mode=value`、不允许 keyframes | `SampledProperty（63–72）`；`ObjectValidator.validateMode`（`J:script/schema/ObjectSchemaValidator.java 130–168`） |
| 事件记录形状由路径末段决定（`event` / `mod_event`） | `ObjectCodec.readEventRecord（101–113）`、`readEvent（115–145）`、`readModEvent（146–164）` |
| 编辑器当前用 `interpolateNewKeyframe` 跨字段复制/插值 | `EDITOR:src/operations.ts（190–215）`、`copyKeyframeProperties（713–739）`、`interpolateKeyframe（740–768）` |

结论：前端"一帧多字段"的容器与运行时"一属性一序列"直接冲突；`interpolateNewKeyframe` 会把别的属性的值带进新帧，在 `objects` 模型下就是数据污染。

### 2.2 目标

1. `AnimObject` 与 `SampledProperty` 同形；字段集合恰好 `value` / `keyframes`（+ 内存 `authoring`）。
2. 形态由 schema 决定，编辑器**不推断**、**不切换**：`mode=value` 的路径不允许出现 `keyframes` 控件。
3. 值严格按类型序列化：不做字符串数字、不做模糊枚举、不写非有限数、`null` 只用于 `nullable_float` 与 `event_record`。
4. `struct` 值原样透传（不做编辑器侧重排/补默认），因为运行时会在解析期把它换成强类型对象（见 §3.5）。
5. 关键帧时间语义：局部秒、`>= 0`、同属性严格递增、超界保留。

### 2.3 非目标

- 不定义每个字段的业务含义（07）。
- 不定义 UI 交互（06）。
- 不定义路径条目/规则的结构（它们不是 `AnimObject`）。

## 三、方案

### 3.1 类（提案）

```ts
// EDITOR:src/model/AnimObject.ts（提案）
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }

export interface AnimObject {
  value?: JsonValue
  keyframes?: ObjectKeyframe[]
  authoring?: ObjectAuthoring        // 不写盘
}

export interface ObjectKeyframe {
  time: number                        // 片段局部秒
  value: JsonValue
}

export interface ObjectAuthoring {
  /** 属性段缓动（只作用于本属性相邻关键帧）；保存时烘焙后删除 */
  easing?: { fromTime: number; type: 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out' }[]
  /** 编辑器合成标记：该对象是"启用动画"时自动建的，值为空 */
  synthetic?: boolean
  /** 折叠/展开（纯 UI） */
  expanded?: boolean
}
```

### 3.2 三种形态（与 `PropertyMode` 一一对应）

| 形态 | `value` | `keyframes` | 编辑器允许的操作 | 运行时约束来源 |
|---|---|---|---|---|
| `value` | 必填 | **禁止出现** | 只能改 `value` | `SampledProperty（61–67）`；`ObjectParser.parseProperty（107–109）` |
| `animated` | 可选 | 可选（可为空数组） | 改 `value`、增删移关键帧、改插值（只读显示） | `SampledProperty（85–92）`；`ObjectParser.interpOf（199–208）` |
| `event` | 禁止 | **必须非空** | 增删事件记录 | `SampledProperty（73–84）`；`ObjectParser.parseProperty（111–113）` |

补充事实：

- `animated` 的 `interp` 由 schema 决定；schema 声明 `none` 时按 `Interp.infer` 推导（`ObjectParser.interpOf 199–208`；`J:spi/Interp.java — infer（44–64）`）。编辑器**只显示**，不提供逐属性改插值。
- `event` 的 `value` 恒为 `none` 插值；事件不插值（`SampledProperty（73–84）`）。
- `struct` 类型的属性只能是 `value` 形态（`SampledProperty（63–72）`），即使 schema 误写成 `animated` 也会在 schema 自检期被拒（`ObjectSchemaValidator.validateMode（130–168）`）。

### 3.3 值类型表（编辑器必须逐条实现）

| 类型 | JSON 形态 | 编辑器控件 | 拒绝条件 |
|---|---|---|---|
| `float` | JSON number，有限 | 数字输入（可带单位 `unit`） | 字符串数字、NaN/±Inf、超出 `min`/`max`（`ObjectValidator.checkRange 408–422`） |
| `int` | JSON number，整数值 | 整数输入 | `2.5`、超 int 范围（`ObjectCodec.readInt 75–85`） |
| `bool` | `true`/`false` | 开关 | 字符串 `"true"` |
| `string` | 字符串 | 文本框 | 数字 |
| `enum` | 字符串，必须 ∈ `enumValues` | 下拉（值来自 schema） | 不在枚举内（`ObjectCodec.readString 94–99` + `ObjectValidator.checkTyped 384–406` 的枚举检查） |
| `ref` | 字符串（选择器 / 结构 id / 形态串） | **受约束的文本框/下拉**（见 07-PointSourceForms） | 非字符串；**形态合法性不在此层判**（见冲突 C-02-10） |
| `nullable_float` | number 或 `null` | 开关 + 数字 | `null` 以外的空值 |
| `struct` | 任意嵌套 JSON（对象/数组/标量） | 结构化子表单或原文编辑器 | 非有限数（`ObjectCodec.readData 165–193`） |
| `event_record` | 对象，形状由路径末段决定 | 事件记录编辑器（06） | 形状不符（`readEventRecord 101–113`） |

### 3.4 事件记录形状（逐字段）

`event`（EVENT 轨的 `objects.event`）：

| 键 | 类型 | 约束 |
|---|---|---|
| `command` | string | — |
| `event_type` | string | — |
| `id` | string | — |
| `position` | object | 恰好 `{x,z}` 或 `{dx,dz}`，数字有限 |

`mod_event`（MOD_EVENT 轨的 `objects.mod_event`）：

| 键 | 类型 | 约束 |
|---|---|---|
| `event_type` | string | — |
| `data` | object | 递归 `Map/List/String/Boolean/Float/null` |

依据：`J:script/object/ObjectCodec.java — readEvent（115–145）`、`readModEvent（146–164）`、`readData（165–193）`。注意 `readEventRecord` 用**路径末段**判形状（`lastSegment 196–200`），所以属性路径必须恰好以 `event` / `mod_event` 结尾。

### 3.5 STRUCT 的解析期替换（编辑器必须知道的事实）

运行时在解析片段后会把四类 STRUCT 路径换成强类型对象：

| 路径 | 目标类型 | 依据 |
|---|---|---|
| `modifier`（CAMERA） | `ClipModifier` | `J:script/ScriptParser.java — structKindOf（505–543）`、`normalizeStructs（545–580）` |
| `transition_params`（CAMERA） | `TransitionParams` | 同上 |
| `transition_curve`、`motion_position`、`motion_yaw`、`motion_pitch`、`motion_roll`、`motion_fov`、`motion_zoom`（CAMERA） | `MathModel` | 同上 |
| 10 条调色曲线（CAMERA + ADJUST） | `ColorCurve` | 同上 |

对编辑器的含义：

- 文档里这些路径的 `value` 是**原始 JSON**，编辑器按原文编辑/透传，不做"规范化重写"。
- 但保存后运行时会按上表解析；解析失败会让整个脚本解析失败。因此编辑器必须调用服务端 `script.validate` 才能确认这些值合法（本地不做模型/曲线语义校验）。
- `gradient`、`data`、`lut` 等未列出的 STRUCT 保持原始 `Map/List`（`structKindOf` 默认返回 `null`），编辑器同样透传。

### 3.6 关键帧与时间

| 规则 | 说明 | 依据 |
|---|---|---|
| 局部秒 | `time` 相对片段起点，不是全局秒 | `MOD:docs/SCRIPT_FORMAT.md §3.2（106–117）` |
| `time >= 0` | 负数解析期报错 | `ObjectParser.parseKeyframes（152–155）` |
| 严格递增 | 相等或倒序报错；不排序"帮忙" | `ObjectParser.parseKeyframes（156–161）`、`SampledProperty（97–110）` |
| 超界保留 | `time > duration` 不报错，编译期过滤 | `SampledProperty.compile（153–162）` |
| 空数组 | `animated` 允许；`event` 不允许 | `SampledProperty（61–84）`；文档与实现的表述差异见冲突 C-02-02 |
| 首帧前 / 末帧后 | 取首值 / 末值，不回落 `value` | `SampledProperty.Compiled.sampleFloat（333–359）` 等；`MOD:plans/0.3.6/I-script-core/object-model.md §3.4` |
| 无帧有值 | 用 `value` | 同上（`times.length == 0` 分支） |
| 无帧无值 | 用 schema 默认 | `ObjectParser.hasEffectiveKeyframe（211–218）` 与 required 检查；采样 fallback 由消费方传（`ClipSampler.Channel` 的 `floatFallback` 等，`J:script/object/ClipSampler.java 179–200`） |

**插值方式只读**：`linear` / `angle` / `geometric` / `step` 由 schema 决定（`J:spi/Interp.java（11–21）`）。`geometric` 只用于 `zoom`（`TrackSchemas` 253）；`angle` 用于 `unit=degree` 或 `yaw`/`roll`/`yaw_lock`/`pitch_lock`（`Interp.infer 44–64`，注意 `pitch` 靠显式声明，见冲突 C-02-08）。

### 3.7 编辑器不做的三件事

1. **不补帧**：不在作者没要求的时间点插入关键帧（除 06 的"启用动画"显式命令，且该命令只插当前播放头一帧）。
2. **不跨属性插值**：删掉 `interpolateNewKeyframe` 的语义（`EDITOR:src/operations.ts 190–215`）；新帧的值由作者输入或从本属性相邻帧插值（同属性）。
3. **不剥离等于默认值的值**（见 [02-SerializationLossless](02-SerializationLossless.md) §3.2）。

## 四、技术细节

### 4.1 输入输出

| 函数（提案） | 输入 | 输出 | 失败 |
|---|---|---|---|
| `readAnimObject(def: ObjectDef, raw: unknown): AnimObject` | schema 声明 + 原始 JSON | 文档对象 | 成员非白名单 / 形态不符 / 类型不符 → `ObjectShapeError(path, msg)` |
| `writeAnimObject(def, obj): unknown` | 文档对象 | JSON | `mode=value` 带 keyframes / `mode=event` 空 keyframes → 抛（保存前拦截） |
| `checkObject(def, obj): Issue[]` | 同上 | 结构 issue | 不抛 |

### 4.2 修改步骤（WebUI）

1. 新建 `EDITOR:src/model/AnimObject.ts`（提案），实现上表三个函数。
2. 新建 `EDITOR:src/model/valueCodec.ts`（提案），按 §3.3 实现九种类型的读写；错误信息格式对齐运行时：`<path>: 需要有限数字` / `需要整数` / `需要布尔值` / `需要字符串` / `需要对象（事件记录）`（抄 `ObjectCodec` 的文案，便于和服务端 issue 对照）。
3. 删 `EDITOR:src/operations.ts` 的 `interpolateNewKeyframe`（190–215）、`copyKeyframeProperties`（713–739）、`interpolateKeyframe`（740–768）、`interpolateSegment`（817–830）、`resolveSegment`（779–816）、`lerpZoom`（773–777）、`lerpAngle`（831+）；这些函数的语义（整帧插值）在新模型下无对象。若 06 需要"从相邻帧取值"，用 `valueCodec` 的按类型插值（仅同属性、仅连续类型）。
4. 删 `EDITOR:src/operations.ts` 的 `continuousChannels`（854–897）与 `sampleBakedKeyframe`（902–945）；烘焙改由 06 按属性段实现（`EasingAuthoringBake`）。
5. 改 `EDITOR:src/operations.ts — keyframes(clip)`（45–53）：删除；所有调用点改读 `clip.objects[path].keyframes`。
6. 改 `EDITOR:src/components/KeyframePanel.vue`：本轮先停止读 `clip.keyframes`（16 行）与 `schema.tracks[type].keyframes`（16 行），改为占位；完整面板在 06。

### 4.3 未来 14 迁移参考：游戏内 Forge 1.20.1 实现

> 本节仅 14 迁移参考，不构成本轮 WebUI 出口；本轮 WebUI 只对接主模组 Forge/Fabric，不等待游戏内 Java/AUI 实现。

1. `INGAME:common/.../editor/model/AnimObject.java`（提案）：`record AnimObject(JsonElement value, List<ObjectKeyframe> keyframes)` + `record ObjectKeyframe(float time, JsonElement value)`。
2. `INGAME:common/.../editor/model/ValueCodec.java`（提案）：与 WebUI `valueCodec` 同判定的读写。
3. 未来14人工操作同一标准场景，观察对象类型/时间/保存重载与游戏结果一致，不新建对照执行器；ObjectCodec只是运行时来源参考，不绕过编辑器文档层直接依赖内部类。

### 4.4 禁止修改

- 不改 `J:script/object/*`、`J:spi/PropertyType.java`、`J:spi/Interp.java`。
- 不在 `AnimObject` 上加 `type`/`mode`/`interp` 字段（类型由 schema 决定，重复写会漂移）。
- 不把 `struct` 值展开成 `objects` 子路径（`struct` 是单个属性的嵌套值，不是可关键帧的叶子）。
- 不给 `mode=value` 的属性生成 `keyframes: []`（会被 `ObjectParser.parseProperty 107–109` 拒绝）。

## 五、正反例验收

### 5.1 正例

```json
"objects": {
  "position.x": { "value": 0, "keyframes": [{"time": 0, "value": 0}, {"time": 3, "value": 12}] },
  "position.y": { "value": 2 },
  "yaw": { "keyframes": [{"time": 1, "value": 0}, {"time": 2, "value": 90}] },
  "orient": { "value": "tangent" },
  "yaw_offset": { "keyframes": [{"time": 1, "value": 0}, {"time": 2, "value": 5}] },
  "rgb_curve": { "value": {"points": [[0,0],[1,1]]} }
}
```

期望：

- `position.x` / `yaw` / `yaw_offset` 为 `animated`；`position.y` 为 `animated` 无帧；`orient` 为 `value`；`rgb_curve` 为 `struct`。
- 编辑器显示 `position.y` 有值、无关键帧行；`orient` 没有"添加关键帧"按钮；`yaw_offset` 显示但按 `requires=orient=tangent` 置灰判定（`TrackSchemas 244–249`）。
- `writeAnimObject` 输出与输入逐字段相等（含 `[[0,0],[1,1]]` 数组嵌套）。

### 5.2 反例（逐条必须有明确拒绝/告警）

| 输入 | 期望行为 | 依据 |
|---|---|---|
| `"orient": {"value":"manual","keyframes":[{"time":0,"value":"manual"}]}` | 拒绝：`mode=value 不允许 keyframes` | `ObjectParser.parseProperty（107–109）` |
| `"event": {"value": {}}` | 拒绝：`mode=event 必须有 keyframes` | `ObjectParser.parseProperty（111–113）` |
| `"yaw": {"keyframes": []}` 且 `mode=animated` | 允许（空数组 = 无帧，用 `value`） | `SampledProperty（85–92）`；与文档表述冲突见 C-02-02 |
| `"yaw": {"keyframes":[{"time":1,"value":0},{"time":1,"value":1}]}` | 拒绝：时间必须严格递增 | `ObjectParser.parseKeyframes（156–161）` |
| `"yaw": {"keyframes":[{"time":-1,"value":0}]}` | 拒绝：不能为负数 | `ObjectParser.parseKeyframes（152–155）` |
| `"yaw": {"value":"90"}` | 拒绝：字符串数字不转换 | `ObjectCodec.readFiniteFloat（60–73）` |
| `"yaw_lock": {"value":null}` | 允许（不锁） | `ObjectCodec.fromJson（52–54）` |
| `"opacity": {"value":null}` | 拒绝：`float` 不接受 null | 同上（48） |
| `"look_at_part.x": {"value":150}` | 允许（schema 无 min/max）；运行时钳到 100 | `EntityPoint.clampPercent（24–29）` |
| `"cam_breath_intensity": {"keyframes":[...]}` | 拒绝：`cam_breath_*` 是 `mode=value` | `TrackSchemas（294–301）` |
| `"event": {"keyframes":[{"time":0,"value":{"position":{"x":1}}}]}` | 拒绝：`position` 必须恰好 `{x,z}` 或 `{dx,dz}` | `ObjectCodec.readEvent（115–145）` |
| `"modifier": {"value":{"mode":"add"}}` | 本地不判；`script.validate` 报 | `ScriptParser.parseClipModifier（677–700）` |

### 5.3 异步关键帧专项

**正例**：给 `yaw` 在 `t=2` 加帧，`position.x` 不动。

- 期望：`yaw.keyframes` 变 3 帧；`position.x.keyframes` 数量不变；撤销一次回到 2 帧且 `position.x` 完全不变。

**反例**：在 `t=2` 给 `yaw` 加帧时，"顺手"把 `position.x` 在 `t=2` 也补一帧。

- 期望：不发生在同一个用户命令里；若产品要"多属性同时打帧"，必须是独立的显式命令（06 定义），且在撤销里可单独回退。

## 六、真实冒烟（真游戏校验）

前置：Forge 1.20.1 + 主模组；脚本 `anim_smoke.json` 覆盖 §5.1 的六个对象 + 一条 `event` 对象。

1. 打开脚本，确认属性列表显示 6 个对象、`orient` 无关键帧入口。
2. 给 `yaw` 在播放头 `t=2.5` 加一帧，值 `45`；保存。
3. 重载；确认 `yaw` 3 帧、其余对象帧数不变。
4. `script.validate` → `ok: true`。
5. 推送预览，把播放头拖到 `t=2.5`，确认相机 yaw 为 45°（可用飞控状态或预览画面判断）。
6. 把 `yaw` 第二帧与第三帧时间改成相同，保存；确认 `script.validate` 报 `关键帧时间必须单调递增`，且编辑器在保存前已本地拦截。

通过判定：第 3、4、5 步符合期望；第 6 步出现明确错误且错误定位到 `objects.yaw.keyframes[2].time`。

## 七、完成定义

1. `EDITOR:src/model/AnimObject.ts`、`EDITOR:src/model/valueCodec.ts` 存在并通过 §5.2 全部反例。
2. `EDITOR:src/operations.ts` 不再有 `interpolateNewKeyframe`、`continuousChannels`、`sampleBakedKeyframe`。
3. `EDITOR:src/components/KeyframePanel.vue` 不再读 `clip.keyframes` / `schema.tracks[type].keyframes`。
4. §5.1 正例往返无损（`writeAnimObject(readAnimObject(x))` 语义相等）。
5. §6 冒烟 6 步通过并记录 `script.validate` 原文。
6. （14 迁移要求，本轮不作为出口）游戏内 Forge 载体对同一向量集结果一致。
