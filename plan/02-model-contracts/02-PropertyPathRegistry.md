# 02-PropertyPathRegistry：属性路径表与消费索引

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案设计）
> 合同：C01 Schema 能力快照、C02 标准脚本文档
> 依赖：01（`schema.get` 快照）、02-SchemaSnapshot
> 下游：06（属性列表/表单）、07（位置/朝向/路径）
> 证据前缀见 [README](README.md) 开头

## 一、摘要

把 `schema.get` 导出的 `tracks.<type>.objects` 编译成编辑器可用的**路径注册表**：路径 → 声明（`mode`/`type`/`interp`/`default`/`requires`/`min`/`max`/`enumValues`/`section`/`group`/`appliesTo`/`unit`/`labelKey`），并按 `section`、`group`、`requires`、`appliesTo` 建索引。

本文件不做 UI。它提供 06/07 需要的查询：某轨道有哪些路径、某路径的控件类型、某路径此刻是否可用（`requires`/`appliesTo`）、哪些路径属于同一组（切换对齐用）。

## 二、为什么做

### 2.1 现状

| 事实 | 证据 |
|---|---|
| 前端把 schema 读成 `{clips, keyframes}` 两张表 | `EDITOR:src/types.ts — TrackSchema（225–228）` |
| 导出器实际给 `{playControl, objects}` | `J:script/schema/SchemaExporter.java — exportAll（43–56，track.add("playControl") 51、track.add("objects") 52）` |
| 对象声明含 16 个字段 | `J:spi/ObjectDef.java（36–52）`；导出字段见 `SchemaExporter.exportObject（364–395）` |
| 前端靠手写显隐表补 `requires` 语义 | `EDITOR:src/components/DynamicForm.vue — VISIBILITY_RULES（23–44）` |
| 运行时按 `SchemaRegistry.getObjects(type)` 的插入顺序编译槽位 | `J:script/object/ObjectSlotLayout.java（35–53）`、`TrackRegistry.compileSlots（276+）` |
| 第三方轨道注册时会做 schema 自检（含 `requires` 环） | `J:script/track/TrackRegistry.java — register（98–124）`、`ensureBuiltins（66–90）`；`ObjectSchemaValidator.validateOrThrow（66–71）`、`reportCycles（247–277）` |
| 前端轨道类型只有 6 个（缺 ADJUST） | `EDITOR:src/types.ts — TrackType（8）`；运行时 7 个 `J:spi/TrackTypeId（19–37）` |

结论：字段表的形状错了；`requires` 被硬编码而不是读 schema；轨道类型少一个；第三方轨道无法出现。

### 2.2 目标

1. 路径表 100% 来自 `schema.get`，编辑器不写死任何字段名（除位置/朝向等**语义组**在 07 里按路径名引用，见 §3.4 的白名单例外）。
2. 提供 4 个查询：`def(type, path)`、`paths(type)`、`sectionGroups(type)`、`availability(def, sampleValues)`。
3. `requires` 用运行时同一语法求值：只支持 `path=value` / `path!=value`（`J:script/object/ObjectValidator.java — evalRequires（455–473）`）。
4. `appliesTo` 按当前层类型（如 `layer_type`）过滤（`TrackSchemas（406–413、416–417、418–441）`）。
5. 轨道类型列表来自 schema 的 `tracks` 键，不来自前端枚举。

### 2.3 非目标

- 不定义字段语义（07）。
- 不生成表单控件（06）。
- 不校验第三方 schema（那是 `ObjectSchemaValidator` 的职责，运行时启动期做）。

## 三、方案

### 3.1 类（提案）

```ts
// EDITOR:src/model/PropertyPathRegistry.ts（提案）
export interface ObjectDefView {
  path: string
  mode: 'value' | 'animated' | 'event'
  type: 'float' | 'int' | 'bool' | 'string' | 'enum' | 'ref' | 'nullable_float' | 'struct' | 'event_record'
  interp: 'none' | 'linear' | 'angle' | 'geometric' | 'step'
  default: unknown
  required: boolean
  enumValues: string[]
  nullable: boolean
  min: number | null
  max: number | null
  requires: string | null
  section: string | null
  group: string | null
  appliesTo: string[]
  labelKey: string | null
  unit: string | null
}

export interface TrackView {
  type: string
  playControl: Record<string, FieldDefView>
  objects: Map<string, ObjectDefView>          // 保持导出顺序
  sections: Map<string, ObjectDefView[]>       // section → 声明（顺序 = 导出顺序）
  groups: Map<string, ObjectDefView[]>         // group → 声明
}

export interface PathRegistry {
  tracks: Map<string, TrackView>
  track(type: string): TrackView | null
  def(type: string, path: string): ObjectDefView | null
  sectionOf(type: string, path: string): string
  /** requires / appliesTo 求值；返回 { available, reason } */
  availability(type: string, path: string, values: Record<string, unknown>): { available: boolean; reason?: string }
  /** 同组路径（切换对齐用；见 07-PositionEditor） */
  group(type: string, group: string): ObjectDefView[]
}
```

### 3.2 导出 → 注册表的字段映射

| 导出键（`exportObject`） | 注册表字段 | 备注 |
|---|---|---|
| `path` | `path` | 必须与 `Map` 的键一致（`ObjectSchemaValidator.validateTrack 92–93` 检查） |
| `mode` | `mode` | 小写脚本名（`SchemaExporter.scriptName 397–399`） |
| `type` | `type` | 同上 |
| `interp` | `interp` | 同上；`none` 出现在 `value`/`event`/`struct` 上 |
| `default` | `default` | 可能是 `null` / 数字 / 布尔 / 字符串 |
| `required` | `required` | — |
| `enumValues` | `enumValues` | 仅 `enum` 非空 |
| `nullable` | `nullable` | `type=nullable_float` 时恒 `true`（`ObjectDef（66）`） |
| `min` / `max` | 同 | `null` = 不限 |
| `requires` | 同 | `null` = 无条件；语法见 §3.3 |
| `section` | 同 | `null` 归 `info`（`FieldDef` 的归一在 `J:spi/FieldDef.java 23–28`；对象侧 `ObjectDef` 不归一，可能为 null） |
| `group` | 同 | 运行时组名；不参与采样，只用于切换对齐校验（`ObjectValidator.checkSwitches 602–636`） |
| `appliesTo` | 同 | 空 = 全部 |
| `labelKey` | 同 | `null` = 用 `path` |
| `unit` | 同 | 只认 `degree`（`Interp.infer 49–51`） |

**注意**：`FieldDef` 的 `section` 归一为 `info`（`J:spi/FieldDef.java 23–28`），但 `ObjectDef.section` 不归一（`J:spi/ObjectDef.java 54–67` 只归一 `interp`/`requires`/`enumValues`/`appliesTo`/`nullable`）。导出时 `section` 可能为 `null`（`SchemaExporter.exportObject 383`）。编辑器必须自己归一到 `info`，否则 06 的分组会出现 `null` 组。

### 3.3 `requires` 求值（与运行时同语法）

运行时实现：`ObjectValidator.evalRequires（455–473）`。

- 语法：`<path>=<literal>` 或 `<path>!=<literal>`；`path` 必须是合法属性路径（`PropertyPath.isValid`）；`literal` 非空。
- 取值：被引用字段的 `t=0` 有效值 = keyframes 首帧 > `value` > schema 默认（`ObjectValidator.staticValue 482–498`）。
- 语义：不满足时**字段仍可存在**，但运行时不读取（`checkRequiresAndRequired 424–443` 只报"写了但前置条件不满足"）。
- 编辑器：不满足时置灰 + 提示，**不删除字段**；已有关键帧保留（作者切回条件时数据还在）。

当前 schema 里唯一使用 `requires` 的是 `yaw_offset` / `pitch_offset`（`TrackSchemas（244–249）`，`requires("orient=tangent")`）。

### 3.4 编辑器允许按路径名引用的白名单（语义组）

注册表是通用层，但 07 需要知道"哪些路径构成位置组/朝向组/点源"。这些**不是**字段语义表，而是**组名**：

| 组 | 成员（路径） | 依据 |
|---|---|---|
| `position` | `position.x/y/z`、`position_mode`、`position_space`、`position_origin`、`position_origin_x/y/z`、`position_origin_freeze`、`facing_source`、`facing_target`、`facing_target_x/y/z`、`facing_target_offset.*`、`facing_target_freeze`、`facing_entity` | `TrackSchemas.cameraObjects（113–156）` 的 `group("position")` |
| `orientation` | `yaw`、`pitch`、`roll`、`yaw_lock`、`pitch_lock`、`yaw_base`、`pitch_base`、`yaw_base_selector`、`orient`、`yaw_offset`、`pitch_offset` | `TrackSchemas（159–174、242–249）` |
| `yaw_base_from` / `yaw_base_to` / `look_at` | 各自成员 | `TrackSchemas（175–241）` |
| 无组 | 其余（光学、合成、调色、选择器、breath、transition、modifier） | 无 `group(...)` 调用 |

编辑器**必须**用注册表的 `group` 字段做分组，不能把上表硬编码成第二份；上表只用于说明"存在哪些组"与 07 的归属。切换对齐所需的组来自 schema 的 `group`（07-PositionEditor §3.4）。

### 3.5 轨道类型与 `playControl`

- 轨道类型：`Object.keys(schema.tracks)`；不校验大小写（第三方 id 逐字匹配，见 `J:spi/TrackTypeId` 类注释与 `ScriptParser.parseTrackType 1089–1098`）。
- `playControl`：7 轨共用同一份（`TrackSchemas.PLAY_CONTROL（84–94）`：`start_time`/`duration`/`loop`/`loop_count`/`loop_mode`），导出时每轨各带一份（`SchemaExporter.exportAll 51`）。编辑器读当前轨的那份，不假设全局唯一。
- 轨道面板（05）显示轨道列表时，用 `TrackRegistry.registered()` 的顺序（`J:script/track/TrackRegistry.java 227`），但编辑器只能看到 `schema.tracks` 的键顺序（JSON 对象键顺序），两者一致因为导出按 `registered()` 迭代（`SchemaExporter.exportAll 48`）。

### 3.6 `ref` 类型的表达力缺口（记录，不在本轮修）

`position_origin`、`facing_target`、`facing_entity`、`yaw_base_selector`、`yaw_base_from`、`yaw_base_to` 都是 `PropertyType.REF`（`TrackSchemas（123、137、155、173、175、193）`），schema 里没有 `enumValues`，也没有形态元数据。而运行时的形态判据是字符串前缀（`J:script/object/position/PointKinds.java — kindOf（38–45）`）：

```text
"@"… / "uuid:"…  → 实体选择器
"block:"…        → 方块
"player"         → 玩家激活位置
"coordinate"     → 固定坐标
其余非空字符串    → 结构 id
```

后果：拼错 `coordinate` 会被当成结构 id，解析期不报错，运行期 `structureCenter` 找不到 → 片段不可用。

**本轮裁决**：编辑器为这 6 个路径提供**固定形态下拉 + 载荷输入**（07-PointSourceForms），不提供自由文本；schema 不变。若后续要给 schema 加 `format` 元数据，属主模组变更，不在本轮。

## 四、技术细节

### 4.1 输入输出

| 函数（提案） | 输入 | 输出 | 失败 |
|---|---|---|---|
| `buildRegistry(schema: unknown): PathRegistry` | `schema.get` 的 `data` | 注册表 | 缺 `tracks` → 抛；某轨缺 `objects` → 该轨标记 `unsupported`（不抛，界面提示） |
| `availability(...)` | 路径 + 当前采样值表 | `{available, reason}` | `requires` 语法非法 → `available:false, reason:'requires 表达式非法'`（与运行时 issue 文案一致） |

### 4.2 修改步骤（WebUI）

1. 新建 `EDITOR:src/model/PropertyPathRegistry.ts`（提案）。
2. 改 `EDITOR:src/types.ts`：`TrackSchema` 换成 `TrackView`（`playControl` + `objects`）；删除 `SchemaField.type` 的旧取值（`position`/`bezier_curve`/`tristate`/`map`）——新 schema 的 `type` 只有 9 种值类型（`J:spi/PropertyType`）。
3. 改 `EDITOR:src/schema.ts`：`groupBySection`（12–22）、`getFieldsForSection`（25–30）保留但改吃 `ObjectDefView`；`fillDefaults`（40–56）、`stripDefaults`（95–115）、`stripScriptDefaults`（118–142）删除（见 02-SerializationLossless）。
4. 改 `EDITOR:src/components/DynamicForm.vue`：删除 `VISIBILITY_RULES`（23–44），改为 `availability()`；`isVisible` 用注册表。
5. 改 `EDITOR:src/store.ts — getSchema（350–357）`：缓存 `PathRegistry`，`schema.get` 只在连接时取一次。
6. 改 `EDITOR:src/components/KeyframePanel.vue（16）`：字段表来源换成 `registry.track(type).objects`。

### 4.3 未来 14 迁移参考：游戏内 Forge 1.20.1 实现

> 本节仅 14 迁移参考，不构成本轮 WebUI 出口；本轮 WebUI 只对接主模组 Forge/Fabric，不等待游戏内 Java/AUI 实现。

1. `INGAME:common/.../editor/model/PathRegistry.java`（提案）：直接消费主模组 `SchemaExporter.exportAll()` 的 `JsonObject`（同进程可用，不需要走 WebSocket），转成与 WebUI 同形状的视图。
2. 未来14的Requires适配消费同一公开schema/规则合同，不调用运行时私有方法；人工用相同条件编辑/保存/播放检查，不新增对照测试工程。
3. Forge 侧初始化在 `INGAME:forge/.../EditorMod.java` 里调 `EditorCommon.init()` 之后注册（提案）。

### 4.4 禁止修改

- 不硬编码任何字段名表（除 §3.4 的组名说明，且运行时应从 `group` 读）。
- 不修改 `SchemaExporter` / `TrackSchemas` / `ObjectDef`。
- 不把 `ref` 当成自由字符串输入。
- 不假设 `section` 非空。
- 不假设轨道类型只有 7 个。

## 五、正反例验收

### 5.1 正例

1. `buildRegistry(schema)` 后，`track('CAMERA').objects.size` 等于 `TrackSchemas.cameraObjects()` 的条目数（当前 57 调色 + 位置/朝向/合成/选择器等；实现时用导出 JSON 计数，不写死数字）。
2. `sectionOf('CAMERA','yaw')` = `orientation`；`sectionOf('CAMERA','fov')` = `camera`；`sectionOf('CAMERA','exposure')` = `color`。
3. `availability('CAMERA','yaw_offset',{orient:'manual'})` = `{available:false, reason:'requires=orient=tangent'}`；`{orient:'tangent'}` = `{available:true}`。
4. `track('ADJUST')` 存在（前端旧枚举缺它）。
5. `group('CAMERA','position')` 返回 23 个成员（`TrackSchemas（113–156）` 的 `group("position")` 条目数；实现时按导出计数，不写死）。

### 5.2 反例

| 输入 | 期望 |
|---|---|
| schema 里某轨只有 `clips`/`keyframes`（旧形状） | `buildRegistry` 该轨 `unsupported`，界面提示"schema 版本不匹配"，**不**做兼容转换 |
| `requires: "orient = tangent"`（带空格） | 与运行时一致：`evalRequires` 会 trim（`455–473`），应判为可用 |
| `requires: "orient~tangent"` | `available:false` + `reason:'requires 表达式非法'`（运行时 `requiresSyntaxIssue 475–479` 同口径） |
| `section: null` | 归 `info`，不产生 `null` 分组 |
| `appliesTo: ["image"]` 且当前 `layer_type='fade'` | `available:false`，不显示该字段（`TrackSchemas（406–413）`） |
| 第三方轨道 `modid:foo` | 出现在 `tracks` 里即可编辑；不因"不在枚举里"被过滤 |

### 5.3 异步关键帧专项

**正例**：`availability` 变化（`orient` 从 `manual` 改成 `tangent`）不改变任何 `keyframes`。

- 期望：`yaw_offset` 从置灰变可用，其 `keyframes` 数量不变；撤销一次回到置灰且帧不变。

**反例**：条件不满足时把 `yaw_offset` 的 keyframes 删掉"清理"。

- 期望：禁止。运行时不读取但保留数据；删除会让作者切回条件时丢帧（`ObjectValidator.checkRequiresAndRequired 424–443` 只警告不删）。

## 六、真实冒烟（真游戏校验）

1. Forge 1.20.1 + 主模组启动，F9，编辑器连接。
2. `schema.get` 后，编辑器属性列表出现 7 条轨道；打开一个 CAMERA 片段，属性列表按 `section` 分组显示（`position`/`orientation`/`camera`/`composite`/`color`/`motion`/`breath`/`transition`/`modifier`/`selector`）。
3. 把 `orient` 设为 `manual`，确认 `yaw_offset`/`pitch_offset` 置灰；设为 `tangent` 后可用。
4. 保存并 `script.validate` → `ok: true`（说明置灰没有误删字段）。
5. 在游戏里播放，确认无"未知对象路径"错误。

通过判定：属性列表分组与 `section` 一致；置灰/可用切换不改变任何 `keyframes`；validate 通过。

## 七、完成定义

1. `EDITOR:src/model/PropertyPathRegistry.ts` 存在，四个查询可用。
2. `EDITOR:src/types.ts` 的 `TrackSchema` 改为 `playControl` + `objects`。
3. `EDITOR:src/components/DynamicForm.vue` 不再有 `VISIBILITY_RULES`。
4. §5.1 五条正例、§5.2 六条反例全部通过。
5. §6 冒烟通过并记录 `script.validate` 原文。
6. （14 迁移要求，本轮不作为出口）游戏内 Forge 载体对同一 schema JSON 得到相同 `PathRegistry`（键集合与 `availability` 结果一致）。
