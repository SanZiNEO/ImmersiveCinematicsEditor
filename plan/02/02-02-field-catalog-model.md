# 02-02 字段目录数据模型与查询索引

## 目标

把六段字段表统一成一种可查询的结构。所有段共用同一个 `FieldEntry`，差异只放在 `scope` 与少量段专用字段里。目录是只读的，加载后建索引，查询 O(1)。

## `FieldEntry`（通用字段条目）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 全局稳定键，如 `meta.id`、`track.CAMERA.object.position.x`、`trigger.location.condition.position` |
| `segment` | enum | `meta` / `tracks` / `triggers` / `models` / `curveTypes` / `script_structure` |
| `scope` | string[] | 段内定位：轨道类型、触发器类型、模型类型、曲线类型、结构段名 |
| `key` | string | 字段名（wire 名） |
| `type` | enum | `float` / `int` / `bool` / `string` / `enum` / `ref` / `nullable_float` / `struct` / `event_record` / `object` / `array` / `model` / `model_list` / `point` / `point_list` / `number_list` / `vector` / `integer` / `text` / `boolean` |
| `mode` | enum? | 仅 objects：`value` / `animated` / `event` |
| `interp` | enum? | 仅 objects：`none` / `linear` / `angle` / `geometric` / `step` |
| `default` | JsonValue? | 源码默认值；没有默认写 `null` 并标 `hasDefault:false` |
| `required` | bool | 必填 |
| `enumValues` | string[]? | `enum` 类型专用 |
| `nullable` | bool | 仅 `nullable_float` 可为 `true` |
| `min` / `max` | number? | 数值范围；没有就不写 |
| `requires` | string? | 仅 objects：`path=value` / `path!=value` |
| `appliesTo` | string[]? | 仅 objects：适用轨道或场景 |
| `section` / `group` | string? | 仅 objects：界面分组标签，不是嵌套结构 |
| `labelKey` / `unit` | string? | 展示用；`unit` 如 `degree` |
| `doc` | string? | 源码注释里的说明，原样抄，不扩写 |
| `sourceRef` | string | `类名#方法:行号` |

**wire 值规则**：`type` / `mode` / `interp` / `enumValues` 全部小写；Java 枚举名不进目录。

`type` 的命名按段：`meta` / `tracks` / `triggers` / `script_structure` 用 `FieldDef` 的 `float` / `int` / `bool` / `string` / `enum` / `object` / `array`；`curveTypes` 用 `PathParamKind` 的 `number` / `integer` / `boolean` / `text` / `point` / `point_list` / `number_list` / `vector`；`models` 用 `model` / `model_list`。同名不同段不合并。

## 六段的形状

```text
FieldCatalog
  catalogHash: string
  sourceCommit?: string
  meta:
    fields: FieldEntry[]                    // 21 条
  tracks:
    [trackType]:
      playControl: FieldEntry[]             // 5 条
      objects: ObjectFieldEntry[]           // path + 16 项声明
  triggers:
    types: string[]                         // 27 种
    conditions: { [type]: FieldEntry[] }
    triggerFields: FieldEntry[]             // id + continuity（含 3 个子字段）
  models:
    [modelType]:
      params: FieldEntry[]
      domains: string[]                     // scalar/angle/vector/color
      maxDepth: int                         // 8
      maxNodes: int                         // 32
      fallback: string                      // linear
  curveTypes:
    [curveType]:
      capabilities: string[]                // ANALYTIC_ARC_LENGTH 等 5 个
      params: CurveParamEntry[]             // key + paramKind + required + default
  script_structure:
    [section]:
      fields: FieldEntry[]
    enums: { [enumName]: string[] }
```

`ObjectFieldEntry` 在 `FieldEntry` 基础上固定带 `ObjectDef` 的 16 项（含 `path`）：`path`、`mode`、`type`、`interp`、`default`、`required`、`enumValues`、`nullable`、`min`、`max`、`requires`、`section`、`group`、`appliesTo`、`labelKey`、`unit`、`sourceRef`——共 17 个键（16 项声明 + `sourceRef`）。

`CurveParamEntry` 带 `key`、`paramKind`（`NUMBER` / `INTEGER` / `BOOLEAN` / `ENUM` / `TEXT` / `POINT` / `POINT_LIST` / `NUMBER_LIST` / `VECTOR`）、`required`、`default`、`enumValues`、`sourceRef`。

## 查询索引

加载时一次性建索引，之后只读：

| 查询 | 返回 |
|---|---|
| `meta(key)` | 一条 `FieldEntry` |
| `track(type)` | `{playControl, objects}` |
| `playControl(type, key)` | 一条 `FieldEntry` |
| `objectDef(type, path)` | 一条 `ObjectFieldEntry` |
| `paths(type)` | 该轨所有对象路径，保持声明顺序 |
| `sectionGroups(type)` | 按 `section` / `group` 聚合的路径列表 |
| `availability(type, path, values)` | `{available, reason}`，用 `requires` 求值 |
| `trigger(type)` | 该类型 conditions 字段表 |
| `triggerField(key)` | `id` / `continuity` 及其子字段 |
| `model(type)` | 参数、值域、上限、回落 |
| `curveType(type)` | 能力、参数形态 |
| `scriptSection(section)` | 该段字段 + 枚举 |
| `search({segment, scope?, key?})` | 匹配条目，按 `id` 稳定排序 |

`availability` 只实现 `path=value` / `path!=value` 两种语法（与 `ObjectValidator.evalRequires` 一致），不支持表达式、布尔组合、函数调用。

## 索引键

- 主键：`id`。
- 轨道对象：`trackType + ':' + path`。
- 触发器条件：`triggerType + ':' + conditionKey`。
- 模型/曲线参数：`type + ':' + paramKey`。
- 结构段：`section + ':' + fieldKey`。

同键重复 → 加载期直接报错，不允许「后者覆盖前者」。

## 目录变化

- 任何一段增删字段 → 重算 `catalogHash`，重建索引。
- 索引重建不改文档数据；文档侧按路径重新绑定。
- 目录不可变；运行时对账产生的是「差异报告」，不是原地改目录。

## 验收标准

- 六段都能按上表查询；`meta('id')`、`objectDef('CAMERA','position.x')`、`trigger('location')`、`model('spring')`、`curveType('nurbs')`、`scriptSection('clips')` 各返回一条。
- `paths('CAMERA')` 保持源码声明顺序，`position.x/y/z` 是三条独立条目。
- `sectionGroups('ADJUST')` 按 `section` 聚合，不把 `group` 当成嵌套对象。
- 重复键加载即报错，不静默覆盖。
- `catalogHash` 在字段增删后变化，纯查询不变。
- `grep` 目录：没有大写 `FLOAT` / `ANIMATED` / `VALUE` 作为 wire 值。
