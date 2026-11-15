# 03-02 属性对象与值模型

## 目标

定义 `AnimObject`（一个叶子属性）和 `ObjectKeyframe`（一帧）在**文档里**长什么样、什么形态合法、编辑器怎么严格读写值。字段的 `type` / `mode` / `interp` 由 02-04 的 objects 表给出；本轮只定义文档侧的容器形状和值处理，不重列字段表。

**这套模型对所有对象通用**：不区分位置、朝向、光学、事件、调色——任何一个对象都是同一个 `AnimObject`，差别只在 02 目录里各自声明的 `mode`（value / animated / event）和 `type`（九种值类型）。位置 x/y/z 只是「animated + float」的一类例子，不是特例。

## 核心形状

```text
AnimObject
  value?: JsonValue          // 固定值
  keyframes?: ObjectKeyframe[]  // 关键帧组
  authoring?: ...            // 仅内存（缓动、展开状态、合成标记），不写盘

ObjectKeyframe = { time: number, value: JsonValue }
```

源码确认：`ObjectKeyframe.java` 就是 `record ObjectKeyframe(float time, Object value)`——一帧只带 `time` + `value`，只属于一个属性，不带全字段快照。

## 三种形态（与 `PropertyMode` 一一对应）

| 形态 | `value` | `keyframes` | 允许操作 |
|---|---|---|---|
| `value`（固定值） | 必填 | **禁止出现** | 只能改 `value` |
| `animated`（动画） | 可选 | 可选（可为空数组） | 改 `value`、增删移关键帧 |
| `event`（事件） | 禁止 | **必须非空** | 增删事件记录 |

源码锚点：`SampledProperty.java:66-94` 构造期硬校验；`ObjectParser.parseProperty`。

补充硬规则：

- `struct`（复合结构）类型的属性**只能是 `value` 形态**，且 `interp=none`、禁止 keyframes（`SampledProperty.java:55-65`）。所以 `modifier` / `transition_params` / 调色曲线这类结构值，编辑器按原文透传，不展开成子路径、不做重排。
- `animated` 的插值方式（`linear` / `angle` / `geometric` / `step`）由 02 目录决定，编辑器**只显示不改**。
- `event` 的事件记录形状由路径末段决定（`event` vs `mod_event`，`ObjectCodec.readEventRecord`），形状表见 02-04。

## 九种值类型（文档侧严格转换）

`float` / `int` / `bool` / `string` / `enum` / `ref` / `nullable_float` / `struct` / `event_record`。类型名和取值范围来自 02-04；这里是编辑器读写时的转换规则：

- 不做字符串↔数字转换：`"90"` 不是 90，拒绝。
- 不做模糊枚举：枚举值必须 ∈ 02 目录给出的 `enumValues`。
- 拒绝非有限数：`NaN` / `±Inf` 一律拒绝。
- `null` 只用于 `nullable_float` 与 `event_record`：`yaw_lock: null` 合法（不锁），`opacity: null` 拒绝。
- `int` 必须是整数值：`2.5` 拒绝。
- `min` / `max` 从 02 目录取；越界值拒绝，不自动夹取。

## 关键帧与时间

| 规则 | 说明 |
|---|---|
| 局部秒 | `time` 相对片段起点，不是全局秒 |
| `time >= 0` | 负数报错 |
| 严格递增 | 相等或倒序报错，**不排序「帮忙」** |
| 超界保留 | `time > duration` 不报错，编译期过滤（越界帧保留、忽略） |
| 空数组 | `animated` 允许（无帧用 `value`）；`event` 不允许 |
| 无帧有值 | 用 `value` |
| 无帧无值 | 用 02 目录给出的 `default` |

## 编辑器职责

1. **补帧只由作者命令触发**：不在作者没要求的时间点插入关键帧。
2. **插值只在本属性内**：新帧的值由作者输入，或从本属性相邻帧插值；不把别的属性或整帧快照的值带进来。
3. **保留显式值**：作者显式写出的 `0` 和「没写」是两种语义（见 03-04）。

## 验收标准

- 同一 CAMERA 片段：`position.x` 有 `{0,3}` 两帧、`yaw` 有 `{1,2}` 两帧、`fov` 只有 `value`——保存重载后三者帧数不变，`fov` 无关键帧行。
- `yaw` 在 `t=2` 加帧，`position.x` 帧数不变；撤销一次回到原状。
- 反例逐条拒绝：`mode=value` 带 keyframes、`event` 空 keyframes、时间相等/倒序、负数时间、`"90"` 字符串数字、`2.5` 给 int、`NaN`、越界 `min/max`。
- 保存重载后 `writeAnimObject(readAnimObject(x))` 语义相等。
- 任意轨道任意叶子属性（不限于 position）都走同一套读写；换轨道类型不换代码路径。
