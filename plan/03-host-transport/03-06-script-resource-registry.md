# 03-06 脚本、资源、注册表与 schema 服务

> 状态：未实现（仅计划）
> 轮次：03-host-transport
> 关联：`README.md`、`03-05-message-router.md`、`../01-baseline-schema/README.md`、`../04-project-graph/README.md`

## 1. 职责

冻结编辑器通过宿主读写「脚本文件、资源文件、注册表候选、脚本图、字段 schema」的路径、身份、缓存与失效规则。本任务不定义脚本字段语义（01/02 轮）与图 UI（04 轮），只定义服务端提供什么、编辑器怎么用。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| 脚本根 | `MOD:webui/ScriptFileService.java:22` | `Paths.get("immersive_cinematics","scripts")`，相对进程 CWD |
| 列举 | `ScriptFileService.java:32-49` | `Files.walk(SCRIPTS_DIR,5)`；`.json`；相对路径 `/` 分隔；字典序；根不存在返回空表 |
| 加载 | `ScriptFileService.java:52-56` | `resolveSafe` + `Files.readString` |
| 保存 | `ScriptFileService.java:62-73` | 父目录按需创建；`Files.writeString` |
| 删除 | `ScriptFileService.java:75-79` | `resolveSafe` + `delete` |
| 新建 | `ScriptFileService.java:81-84` | `ScriptTemplate.newScriptJson()` |
| 越界防护 | `ScriptFileService.java:86-93` | `normalize` 后必须 `startsWith(base)`，否则 `IOException` |
| 资源根 | `MOD:webui/ResourceFileService.java:65-66` | `ResourcePath.getBasePath()`（客户端绑定） |
| kind | `ResourceFileService.java:36-46` | `lang/image/audio/all`；`IMAGE_EXT={png,gif}`；`AUDIO_EXT={ogg,wav}` |
| 列举实现 | `ResourceFileService.java:74-98` | `lang` 默认 `lang/`；其它 `listFiles` |
| 文件过滤 | `ResourceFileService.java:139-161` | `Files.walk(scope,5)`；上限 2000；按扩展名 |
| 路径安全 | `ResourceFileService.java:168-195` | 拒绝绝对路径/盘符/`..` 逃逸 |
| 语言列举 | `ResourceFileService.java:100-134` | `languages[]` + `entries[]`（key 并集 + 各语言译文） |
| 注册表 kind | `MOD:webui/WebRegistryService.java:33-63` | `item/block/entity(entity_type)/sound/target/biome/dimension(from_dimension)/structure/advancement/stage(空)` |
| 注册表限制 | `WebRegistryService.java:24-25,65-68` | `DEFAULT_LIMIT=50`、`MAX_LIMIT=500`；`getAll` = `query("",500)` |
| 图数据 | `MOD:webui/ScriptGraphService.java:53-130` | 两遍：读文件建 id→节点；解析 `requires` 建边；`duplicate_id/self_reference/dangling/invalid` 警告 |
| 节点字段 | `ScriptGraphService.java:159-221` | 路径/文件夹/脚本 id/名称/时长/轨道/触发器/requires/valid/error |
| 边字段 | `ScriptGraphService.java:104-120` | `from/to/fromScript/toScript/trigger/requirement` |
| 分区 | `ScriptGraphService.java:129-151` | 按文件夹汇总；空文件夹缺席（只从节点反推） |
| 警告上限 | `ScriptGraphService.java:47` | `MAX_WARNINGS=200` |
| schema 导出 | `MOD:script/schema/SchemaExporter.java`（`exportAll` 42-141） | meta/tracks/objects/triggers/models/curveTypes/script_structure |
| 前端脚本列表 | `ED:store.ts:344-348` | `script.list` |
| 前端加载 | `store.ts:402-418` | `script.load` → 设 doc、重置历史、选中首个 CAMERA、`pushScript`、`seek(0)` |
| 前端新建 | `store.ts:421-433` | `script.new` → `bootstrapScript`、`pushScript`、`seek(0)` |
| 前端保存 | `store.ts:436-457` | 深拷贝 → 烘焙 easing → 精简默认 → `validateScriptDocument` → `script.save` |
| 前端删除 | `store.ts:459-462` | `script.delete` + `refreshScripts` |
| 前端校验 | `store.ts:381-397` | 前端简化校验 + `script.validate` 合并去重 |
| 前端注册表 | `store.ts:357-365` | `registry.query/get` |
| 前端资源 | `store.ts:372-374` | `resource.list` |
| 资源字段 | `ED:components/fields/ResourceStringField.vue`、`resourceHint.ts` | 语言 key/图片/音频选择与缺失提示 |

**已核对的缺口**：

1. **资源扩展名白名单与运行时媒体能力不一致**：运行时支持视频（`MOD:plans/0.3.6/J-media/playback.md`）与更多音频，但 `kind=image` 只列 PNG/GIF、`kind=audio` 只列 OGG/WAV（`ResourceFileService.java:44-46,155-161`）。前端资源选择器看不到视频。
2. **脚本根相对 CWD**：`Paths.get("immersive_cinematics","scripts")` 相对进程工作目录；Forge dev run 的 CWD 是 `run/`，生产是游戏目录。编辑器无法得知绝对路径，只能使用相对路径；跨实例/多存档时语义依赖 CWD。
3. **无缓存/失效**：`script.list`、`script.graph`、`resource.list` 每次全量扫描；`script.save` 后不通知前端刷新（前端自己 `refreshScripts`）。大包/大资源目录慢。
4. **图分区不含空文件夹**：只从节点反推（`ScriptGraphService.java:142-151`），空文件夹无法在图里出现（04 轮需要目录表）。
5. **路径即身份**：脚本节点 id 用相对路径；边按 `meta.id` 解析；两者不同（`ScriptGraphService.java:20-27`）。移动文件不会自动改 `meta.id`，重命名 `meta.id` 不会改文件名——需要 04 轮的事务。
6. **`script.new` 不落盘**：返回 `path:"untitled.json"`，保存前不创建文件；前端直接 `pushScript`（`store.ts:421-433`）。多客户端同时新建会得到同一路径，保存时互相覆盖。
7. **`script.save` 不校验路径扩展名**：`resolveSafe` 只防越界，不强制 `.json`；前端可保存任意文件名（服务端会写）。
8. **`resource.list` 无总大小/深度提示**：只限 2000 条与深度 5；超出静默截断，前端不知道还有更多。
9. **schema 无版本/哈希**：`SchemaExporter.exportAll()` 每次全量；前端无法判断字段是否变化（见 03-05）。
10. **`registry.stage` 恒空**：`WebRegistryService.java:47` 返回空列表；前端若展示 gamestage 候选会误导。

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 资源扩展名 | PNG/GIF、OGG/WAV | 与运行时媒体能力对齐：图片 `png/gif/jpg/jpeg/webp`（按运行时实际支持）、音频 `ogg/wav/mp3/flac`（按 `VideoFiles`/`AudioReader` 实际支持）、视频 `mp4/mkv/mov/webm` 单独 `kind=video`（提案） |
| 脚本根 | 相对 CWD | 保持相对路径协议；服务端在 `hello_ack` 暴露 `scriptRoot`（绝对路径仅诊断，不参与请求） |
| 缓存 | 无 | `ScriptIndexService`（04 轮）提供版本号；`script.save/delete` 后失效 |
| 空文件夹 | 缺席 | 目录表包含空目录（04 轮） |
| 新建冲突 | 同一 `untitled.json` | 提案：`script.new` 返回唯一临时名（`untitled-<n>.json`）或前端保存时先查重 |
| 扩展名 | 不强制 | `script.save` 要求 `.json`；否则 `error` |
| 截断提示 | 静默 | `resource.list` 返回 `truncated:boolean` 与 `total`（提案） |
| stage | 空 | 明确标注「无候选」，不显示误导性空列表 |

### 3.2 拟新建/修改（提案）

- `MOD:webui/ResourceFileService.java`（提案）
  - `KIND_VIDEO="video"`；`IMAGE_EXT`/`AUDIO_EXT`/`VIDEO_EXT` 与运行时对账；`list` 返回 `truncated`。
- `MOD:webui/ScriptFileService.java`（提案）
  - `saveScript` 校验 `.json`；`listScripts` 与 `ScriptIndexService` 共享扫描结果（04 轮）。
- `MOD:webui/WebEditorApi.java`（提案）
  - `hello_ack` 增加 `scriptRoot`、`schemaHash`、`capabilities`。
- `ED:store.ts`（修改）
  - `newScript` 处理唯一名；`saveScript` 失败时保留 dirty；`resourceList` 处理 `truncated`。
- **不新建**第二套文件服务；不把脚本解析搬到前端。

## 4. 输入输出与字段约束

### 4.1 脚本

- 请求路径：相对脚本根，`/` 分隔，不得以 `/` 开头、不得含 `..`、不得含盘符。
- 返回路径：与请求同一形式；`script.list` 按字典序。
- 脚本内容：原始 JSON 字符串（`script.load` 返回解析后的 `doc` 对象；`script.save` 接收 `doc` 对象）。
- 保存成功才清 dirty；失败/断连不清（前端 `store.ts:436-457`）。

### 4.2 资源

- `kind`：`lang|image|audio|video|all`（`video` 为提案）。
- `dir`：相对资源根的子目录，空 = 整棵树；`lang` 默认 `lang/`。
- `lang` 返回 `{kind,dir,languages[],entries[]}`；`entries[i] = {key, translations:{lang:value}}`（以 `LangResources` 实际结构为准）。
- 其它返回 `{kind,dir,files[]}`；文件路径相对资源根。
- 所有路径经 `resolveSafe`；越界 → `error`。

### 4.3 注册表

- `kind` 见 2 表；`query` 为空返回全量（受 `limit`）；`limit` 上限 500。
- 返回 `matches[]`/`values[]` 为字符串 id；不返回对象/描述（当前无）。
- `stage` 返回空；前端应显示「无候选」而不是「加载中」。

### 4.4 图

- `nodes[]`：`path/folder/scriptId/name/duration/tracks/triggers/requires/valid/error`（以 `ScriptGraphService` 实际字段为准）。
- `edges[]`：`from/to/fromScript/toScript/trigger/requirement`。
- `folders[]`：当前从节点反推；04 轮改为目录表。
- `warnings[]`：`kind/path/message`；上限 200。

### 4.5 schema

- `schema.data{schema}` 为 `SchemaExporter.exportAll()` 原文；编辑器不裁剪、不硬编码。
- 缺失字段 = 能力未知/不可用，不用旧默认写入（见 `shared/contracts.md` C01）。

## 5. 修改步骤

1. 资源扩展名与运行时对账：读 `MOD:media/video/VideoFiles.java`、`MOD:media/audio/*`、`MOD:overlay/ImageLayer.java` 的实际支持列表，更新 `IMAGE_EXT/AUDIO_EXT/VIDEO_EXT`；新增 `kind=video`。
2. `resource.list` 返回 `truncated/total`；前端资源字段显示「还有更多」。
3. `script.save` 强制 `.json`；`script.new` 返回唯一名或前端保存前查重。
4. `hello_ack` 增加 `scriptRoot/schemaHash/capabilities`（与 03-05 同批）。
5. 前端 `store.ts` 处理新字段；`resourceList` 类型扩展。
6. 04 轮接入 `ScriptIndexService` 后，`script.graph` 复用索引，不重复 `Files.walk`。

## 6. 禁止修改

- 不改脚本根/资源根（`immersive_cinematics/scripts`、`immersive_cinematics/resource`）。
- 不绕过 `resolveSafe`；不放宽到绝对路径。
- 不在前端解析脚本或重写 `requires`。
- 不把 `schema` 裁剪成前端需要的子集（权威在服务端）。
- 不把 `stage` 伪造成有候选。

## 7. 两分支承载

| 分支 | 承载 |
|---|---|
| 编辑器 `webui` | `store.ts`、资源字段组件 |
| 编辑器 `1.20.1` | 进程内宿主复用同一服务类（13-04）；不复制文件读写 |
| 主模组 `main` | `ScriptFileService.java`、`ResourceFileService.java`、`WebRegistryService.java`、`ScriptGraphService.java`、`script/schema/SchemaExporter.java` |

## 8. 前置

- 01 轮的 schema 能力快照（C01）。
- 02 轮的标准文档与序列化（C02）。
- 04 轮的 `ScriptIndexService`（缓存/目录表）。

## 9. 正反例验收

**正例 A**：`script.list` 返回 `intro/a.json`、`b.json`；`script.load` 返回 doc；`script.save` 后重新 list 可见。
**正例 B**：`resource.list{kind:"lang"}` 返回 `languages` 与 `entries`；`kind:"image"` 返回 PNG/GIF；新增 `kind:"video"` 返回 MP4/MKV。
**正例 C**：`registry.query{kind:"item",query:"diamond"}` 返回含 `minecraft:diamond`；`limit` 生效。
**正例 D**：`script.graph` 的边按 `meta.id` 解析；悬空/自引用/重复 id 有 warning。
**正例 E**：`schema.get` 返回 `objects` 结构；前端按 `mode/type/interp` 渲染。

**反例 A**：`script.load{path:"../secret.json"}` → `error`，不读文件。
**反例 B**：`script.save{path:"a.txt"}` → `error`（提案；现状会写）。
**反例 C**：`resource.list{kind:"nope"}` → `error`。
**反例 D**：资源目录超过 2000 文件 → 返回截断标记（提案），不静默。
**反例 E**：`stage` → 空列表，前端显示「无候选」。

## 10. 真实冒烟（未执行）

前置：Forge 1.20.1 dev run + Electron + 真实资源目录。

1. 新建/保存/重载/删除脚本，确认文件系统与 UI 一致。
2. 资源字段选择语言 key、图片、音频；新增视频资源后确认 `kind=video` 可见。
3. 打开 04 轮的图，确认节点/边/分区与文件一致。
4. 越界路径/非法 kind/超大目录，确认错误/截断提示。

本次未执行；未来03当轮验证WebUI脚本/资源/schema真实往返，13全量复核，不等待AUI。

## 11. 完成定义

- 资源 kind/扩展名与运行时能力对账完成，缺口有明确记录。
- 脚本路径/身份/保存失败语义与 02/04 轮一致。
- `hello_ack` 的 `scriptRoot/schemaHash/capabilities` 与 03-05 同批定义。
- 未执行的真实冒烟明确标注。
