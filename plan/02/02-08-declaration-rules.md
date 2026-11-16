# 02-08 声明自检规则

## 目标

检查**字段声明本身**是否合法：路径唯一、`mode/type/interp` 兼容、默认值类型匹配、枚举默认值在枚举内、`min<=max`、`requires` 引用存在且无环。检查对象是 02 目录中的声明，每条规则读取 `sourceRef` 对齐源码。

## `ObjectSchemaValidator` 的判定

### 路径

- 路径必须匹配 `[a-z][a-z0-9_]*` 的点分段。
- 同一轨道内路径唯一；重复 → 报错。
- `id` 末段与字段 `key` 一致；同轨 map 键与 `ObjectDef.path` 一致；不一致 → 报错。
- `position` 这种中间名不是合法叶子；只有 `position.x` 这类完整路径才登记。

### `mode` / `type` / `interp` 组合

| mode | 允许的 type | 允许的 interp | 备注 |
|---|---|---|---|
| `value` | 全部九种 | 只能是 `none` | 禁止 keyframes；`struct` 只能走这一行 |
| `animated` | 除 `event_record` / `struct` 外 | 不能是 `none` | 必须有插值方式 |
| `event` | 只能是 `event_record` | 只能是 `none` | keyframes 必须非空 |

- `animated` + `struct` → 报错（struct 只能 value）。
- `event` + 非 `event_record` → 报错。
- `value` + 非 `none` 的 interp → 报错。
- `nullable_float` 可以出现在 `value` / `animated`，不能出现在 `event`。

### 默认值

- `default` 的类型必须与 `type` 匹配：`float` 不能给字符串，`int` 不能给 `2.5`，`bool` 不能给 `0`，`enum` 必须在 `enumValues` 内。
- `enum` 的 `enumValues` 必须非空；`default` 必须在枚举内。
- `nullable` 只允许 `nullable_float`；`nullable_float` 的默认值可以是 `null`。
- `min` / `max` 必须是有限数，且 `min <= max`；只给一个也合法。
- `min` / `max` 只能出现在数值类型（`float` / `int` / `nullable_float`）；其他类型出现 → 报错。

### `requires`

- 格式只允许 `<path>=<value>` 或 `<path>!=<value>`；多条件、布尔组合、函数调用 → 报错。
- 引用的 `<path>` 必须在同一轨道已登记；不存在 → 报错。
- `requires` 图必须无环；A 依赖 B、B 依赖 A → 报错。
- `requires` 的值必须能按被引用字段的 `type` 解析；`orient=tangent` 合法，`orient=1` 对 enum 字段非法。

### 其他

- `section` / `group` 若出现必须非空字符串；空串归一为 `null`。
- `unit` 只允许源码登记过的单位（当前只有 `degree`）；不自己发明单位。
- `appliesTo` 里的项必须是 02-04 的轨道类型、层类型与轨道子类型（`fade` / `image` / `subtitle`）或 `modid:xxx` 形式。
- `labelKey` 只做展示键，不参与类型检查。

## 注册期检查

### `PathCurveRegistry`

- 重复注册同一 `type` → 报错，不静默覆盖。
- 参数名重复 → 报错。
- 参数名与保留键冲突 → 报错。
- 参数默认值的 `kind` 与声明不一致 → 报错。
- 必填参数不能同时缺默认值又标 optional；至少给一个来源。

### `MathModelRegistry`

- 同一 `type` 重复注册 → 覆盖 + 告警（`MathModelRegistry.register`，`MathModelRegistry.java:128-134`）；目录里一种模型只有一条声明。
- 参数类型与 `FieldEntry` 的 `type` 一致。
- 值域必须是 `scalar` / `angle` / `vector` / `color` 之一。

### 目录整体

- `catalogHash` 由整个目录（六段 + `screenLayers` + `sourceCommit`）去掉 `catalogHash` 后的规范形式 SHA-256 计算；任何字段增删改都变（`src/core/schema/hash.ts:43-46`）。
- 同一段内 `id` 唯一；跨段同名不合并。
- 每条 `FieldEntry` 必须有 `sourceRef`；缺失 → 加载期报错。

## 检查对象

- 检查对象是字段目录中的声明。
- 每条规则直接读取 `sourceRef` 对齐源码。
- 运行时世界状态和界面呈现不进入本检查。
- 不把「源码构造期已经保证的事」重复写成运行期检查；目录只补源码没有显式断言的跨字段一致性。

## 验收标准

- 构造一条 `position`（无 `.x`）→ 报错；`position.x` + `key:"y"` → 报错。
- `mode:'value'` + `interp:'linear'` → 报错；`mode:'animated'` + `type:'struct'` → 报错；`mode:'event'` + `type:'float'` → 报错。
- `enum` 的 `enumValues:[]` → 报错；`default` 不在枚举内 → 报错。
- `min:10, max:5` → 报错；`min` 给 `bool` 字段 → 报错。
- `requires:'a=1 && b=2'` → 报错；引用不存在路径 → 报错；A↔B 环 → 报错。
- `PathCurveRegistry` 重复 `type` / 重复参数名 → 报错。
- 缺 `sourceRef` 的条目 → 目录加载失败，不静默跳过。
