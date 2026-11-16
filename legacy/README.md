# legacy/src —— 0.3.6 之前的旧前端

`legacy/src/` 是编辑器在 0.3.6 之前的完整 WebUI 前端（Vue 3 + Vite），整体从原 `src/` 迁入。旧界面仍从这里构建（`index.html` → `/legacy/src/main.ts`，`tsconfig.json` 的 `include` 覆盖 `legacy/src/**`），因此 `npm run build` 产物与迁移前一致。

新代码在 `src/`（当前为 `src/core/schema/`）。`src/` 下的任何文件不得 `import` `legacy/src/` 里的类型或模块；旧结构与主模组的 Java schema 形状不一致，混用会把旧模型带进新目录。

## 1. 旧结构与旧 schema 消费层的位置

|文件|内容|
|---|---|
|`legacy/src/types.ts`|编辑器全部类型。`Schema` / `SchemaField` / `TrackSchema` 在 `:216-244`；`TrackType` 在 `:8`；`ScriptDoc` / `Timeline` / `Track` / `Clip` / `Keyframe` / `TriggerDefinition` / `ScriptMeta` 是脚本文档模型，与 Java `CinematicScript` 一一对应|
|`legacy/src/demo.ts`|`DEMO_SCHEMA: Schema`（`:10`）与离线演示脚本，未连接游戏时自动加载，让界面完整可见|
|`legacy/src/schema.ts`|旧 schema 消费层：`groupBySection` / `getFieldsForSection` 分组，`fillDefaults` / `fillClipDefaults` / `fillKeyframeDefaults` / `fillMetaDefaults` 按 schema 补默认值（对应 Java `EditorDefaults`），`stripDefaults` / `stripScriptDefaults` 保存前删除等于默认值的字段|

旧 `Schema` 的形状（`types.ts:236-244`）：

```ts
export interface Schema {
  meta: Record<string, SchemaField>
  tracks: Record<string, TrackSchema>
  triggers?: {
    types: string[]
    conditions: Record<string, Record<string, SchemaField>>
  }
  [key: string]: unknown
}
```

## 2. 旧结构与主模组 Java 的差异

### 2.1 轨道容器：`{clips, keyframes}` 对 `{playControl, objects}`

- 旧 `TrackSchema`（`legacy/src/types.ts:225-228`）是两表：`clips: Record<string, SchemaField>` + `keyframes: Record<string, SchemaField>`。旧前端按 `tracks[TYPE].clips[key]` / `tracks[TYPE].keyframes[key]` 取字段。
- Java `SchemaExporter.exportAll()`（`script/schema/SchemaExporter.java:47-55`）对每个轨道类型输出 `tracks[TYPE] = {playControl, objects}`：`playControl` 是 5 个片段播放控制字段，`objects` 是对象模型字段表（键为 `path`）。
- 差别不只是键名：`clips` 把播放控制（`transition`、`loop` …）与镜头参数混在一张表里，`objects` 用 `path` + `mode` 区分「值字段 / 可动画字段 / 事件字段」，一条 `objects` 条目对应脚本里的一个 `path` 节点。旧模型没有 `path` 概念，无法表达 `position.x` 这类分层路径。

### 2.2 轨道类型：旧 6 个，主模组 7 个（缺 `ADJUST`）

旧 `TrackType`（`legacy/src/types.ts:8`）：

```ts
export type TrackType = 'CAMERA' | 'LETTERBOX' | 'AUDIO' | 'EVENT' | 'MOD_EVENT' | 'OVERLAY'
```

主模组 `spi/TrackTypeId`（`:19-37`）注册 7 个：`CAMERA` / `LETTERBOX` / `AUDIO` / `EVENT` / `MOD_EVENT` / `OVERLAY` / `ADJUST`。

`ADJUST` 是 master 级整体调色轨：作用于合成输出，`clip` 级只定义曲线 / LUT，关键帧控强度；lane 级调色写在 `CAMERA` 片段，两者不是同一层（`script/schema/TrackSchemas.java:68-77`）。

### 2.3 字段声明：旧 5 项，Java `ObjectDef` 16 项

旧 `SchemaField`（`legacy/src/types.ts:216-222`）：

```ts
export interface SchemaField {
  type: string // string / int / float / bool / tristate / enum / position / bezier_curve / map / object
  default: unknown
  required: boolean
  enumValues: string[]
  section: string
}
```

Java `ObjectDef`（`spi/ObjectDef.java:36-52`）的 16 个分量：`path`、`mode`、`type`、`defaultValue`、`interp`、`requires`、`required`、`enumValues`、`nullable`、`min`、`max`、`section`、`group`、`appliesTo`、`labelKey`、`unit`。构造期归一化（`:54-68`）：`interp` 缺省 `NONE`；`requires` 空白归一 `null`；`type == NULLABLE_FLOAT` 时 `nullable` 强制为 `true`。

旧 `SchemaField.type` 是自由字符串，没有 `mode` / `interp` / `min` / `max` / `requires` / `appliesTo`，因此旧界面无法按「值字段 / 动画字段 / 事件字段」分派控件，也无法表达字段级依赖与取值域。

## 3. 旧 → 新映射

新结构在 `src/core/schema/`，字段目录由 Java 源码逐条抄录，`FieldEntry` 是唯一字段条目类型。

|旧（`legacy/src/`）|新（`src/core/schema/`）|差异|
|---|---|---|
|`SchemaField`|`FieldEntry`|新增 `id` / `segment` / `scope` / `sourceRef`；`type` 从 `string` 收窄为联合字面量；补 `mode` / `interp` / `min` / `max` / `requires` / `appliesTo` / `labelKey` / `unit` / `nullable`|
|`TrackSchema.clips`|`track.<TYPE>.playControl`|片段播放控制 5 字段：`start_time` / `duration` / `loop` / `loop_count` / `loop_mode`（`TrackSchemas.java:86-94`，section `playback`）|
|`TrackSchema.keyframes`|`track.<TYPE>.objects`|对象模型条目：`{path, mode, type, interp, default, ...}`，按 `path` 而非扁平键索引|
|`TrackType`（6 个）|7 轨（含 `ADJUST`）|`ADJUST` 是 master 级整体调色轨，作用于合成输出；缺失时旧前端读不到该轨 schema|

### 3.1 字段级转换要点

- 旧 `clips[key]` 里的 `loop` / `loop_count` / `loop_mode` 搬到新 `playControl`，其余（`transition`、`curve`、`orient`、`yaw_offset` …）搬到 `objects` 并补 `path` / `mode` / `interp`。
- 旧 `keyframes[key]` 的键多是一维名字（如 `position`），新 `objects` 用分层路径（`position.x` / `position.y` / `position.z`），旧键到新路径的展开要靠 Java `TrackSchemas` 的 `cameraObjects()` 等函数，不能靠键名推断。
- 旧 `triggers.conditions[type][field]` → 新 `triggers.conditions[type]` 是 `FieldEntry[]`，每条带 `sourceRef`；旧表没有字段来源信息。
- 旧 `Schema` 的 `[key: string]: unknown` 兜底索引在新 `FieldCatalog` 中不存在：六段（`meta` / `tracks` / `triggers` / `models` / `curveTypes` / `script_structure`）各是固定字段。

## 4. 约束

- `legacy/src/` 是 0.3.6 之前的旧前端，只作旧 → 新转换参考，不再演进。
- `src/` 下的新代码不得 `import` `legacy/src/` 中的任何类型、组件或模块。
- 旧前端自身的构建入口保留在 `legacy/src/main.ts`，由 `index.html` 引用；迁移新界面时替换入口即可，不需要先删除旧代码。

## 5. 新目录的入口

新字段目录的查询入口是 `src/core/schema/index.ts` 的 `buildCatalog` / `indexCatalog`，验收入口是 `src/core/schema/verify.ts`。`src/core/schema/catalog/` 下的七个文件（`meta` / `screenLayers` / `tracks` / `triggers` / `models` / `curveTypes` / `scriptStructure`）是字段数据的唯一副本，其他文件只负责组装、校验与查询。
