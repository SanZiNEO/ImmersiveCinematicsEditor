# 02-01 总纲与源码读取规则

## 目标

给 02 定一条硬规则：字段目录的唯一来源是**主模组 Java 源码**，不是导出的 schema 快照，不是运行时的 `schema.get` 响应。本文件说明读哪些文件、怎么登记、什么算完成。

## 六段与权威文件

| 段 | 权威文件 / 方法 | 产出 |
|---|---|---|
| `meta` | `MetaSchemas.all()`（17–48） | 21 个 meta 字段 |
| `tracks` | `TrackSchemas` 的 `playControl()` + 各轨 `objects()`；`ObjectDef`（36–52） | 7 条内置轨 + 注册扩展；每轨 playControl 5 字段 + objects 表 |
| `triggers` | `TriggerSchemas`（23–53）；`TriggerDefinition` / `ContinuitySpec` | 27 种触发器 + conditions + triggerFields |
| `models` | `MathModelRegistry`（105–117） | 11 种模型 + 参数 + 值域 + 上限 |
| `curveTypes` | `PathCurveRegistry`（62–218）；`PathCapability` / `PathParamKind` | 11 种曲线 + 能力 + 参数形态 |
| `script_structure` | `SchemaExporter.scriptStructure()`（151–246） | clips / rules / rule_bindings / paths + 4 组枚举 |

辅助校验文件（只读，用来核对，不用来生成字段）：

- `ObjectSchemaValidator` — 声明自检规则。
- `ObjectCodec` — 值类型规则。
- `SampledProperty` — 三形态构造期硬校验。
- `ObjectParser` — 脚本解析期规则。
- `ScriptValidator` — 文档级与触发器 conditions 检查。
- `ScreenLayer` / `HudLayerRegistry` — `screen_layers` 键域。

## 读取规则

1. **逐字段带 `sourceRef`**：`类名#方法:行号`。没有 `sourceRef` 的字段不进目录。
2. **读 Java 声明，不读快照**。`schema.snapshot.json` 只能用来对照，不能作为字段的来源；快照里没有的字段以源码为准。
3. **wire 值小写**。`PropertyType` / `PropertyMode` / `Interp` 的 Java 枚举名转成 wire 值：`FLOAT→float`、`NULLABLE_FLOAT→nullable_float`、`EVENT_RECORD→event_record`、`VALUE→value`、`ANIMATED→animated`、`EVENT→event`、`NONE→none`、`ANGLE→angle`、`GEOMETRIC→geometric`、`STEP→step`。
4. **禁止组装 MC classpath**。不写 `export-schema.mjs` 一类脚本去 `import` Minecraft 的 `Vec3` / Mojang `Codec`；不为了导出字段而启动游戏或加载模组类。
5. **`schema.get` 只做对账**。连接真实游戏实例时拿到的六段数据用于比对本地目录（见 02-09），不作为目录生成源；离线快照只做缓存。
6. **不发明字段**。源码没有的字段不写；第三方轨道/触发器只在目录里登记「已发现」的类型名与来源，不替它编字段。
7. **同名字段以所在段为准**。`id` 在 meta、triggers、script_structure 里含义不同，目录按段隔离，不做全局同名字段合并。

## 目录的形态

目录是编辑器仓库里的**只读数据模块**（建议 `src/core/schema/catalog/`），由人手按源码登记，带：

- `catalogHash`：目录内容指纹（六段排序后哈希）。
- `sourceCommit`：登记时的主模组提交号（可选，但要有）。
- 每段的 `fields` / `objects` / `types` 表。
- 每条的 `sourceRef`。

它不是运行时导出产物，不参与构建期代码生成，不依赖游戏类。

## 目录职责

- 本目录只描述字段声明：路径、类型、形态、默认值、范围、枚举、可空、必填。
- 文档模型、选择、保存从本目录查询字段，不复制第二份 `enumValues` / `min` / `max` / `default`。

## 验收标准

- 六段字段全部有 `sourceRef`；抽查 20 条与源码行号一致。
- `grep` 目录源码：`Vec3`、`export-schema`、`schema.snapshot` 0 命中（除非注释里说明「禁止」）。
- 目录里的 `type` / `mode` / `interp` 全是小写 wire 值，没有 `FLOAT` / `ANIMATED` 这类 Java 名。
- 断网、不启动游戏，目录仍能完整加载并回答查询。
- 与真实 `schema.get` 对比：字段名/类型/枚举/默认值差异全部有记录（见 02-09）。
