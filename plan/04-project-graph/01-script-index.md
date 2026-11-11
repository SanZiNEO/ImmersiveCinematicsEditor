# 01 项目索引服务

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：04-project-graph
> 关联：`README.md`、`02-graph-data-contract.md`、`08-move-rename-transaction.md`

## 1. 职责

为「项目入口」提供唯一事实源：一次扫描给出全部脚本条目与全部文件夹条目，附带足够做图、做摘要、做引用事务的元信息。图的节点、分区、悬停摘要、移动目标列表、重命名影响面都从这一份索引派生，禁止各处各自 `Files.walk`。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| 脚本列举 | `MOD:webui/ScriptFileService.java:32-49`（`listScripts`） | `Files.walk(SCRIPTS_DIR, 5)`，过滤 `.json`，`/` 分隔，字典序；根不存在返回空表不抛错 |
| 脚本读写删 | `ScriptFileService.java:52-84` | `loadScript` / `saveScript`（父目录按需创建）/ `deleteScript` / `newScriptJson` |
| 越界防护 | `ScriptFileService.java:86-93`（`resolveSafe`） | `normalize` 后必须 `startsWith(base)`，否则 `IOException("invalid script path: …")` |
| 脚本根 | `ScriptFileService.java:22` | `Paths.get("immersive_cinematics","scripts")`，相对进程 CWD |
| 深度上限 | `MOD:script/ScriptManager.java:37`（`MAX_SCRIPT_DEPTH = 5`）、`:64` | 与 `listScripts` 的 `5` 同口径 |
| 运行期身份 | `ScriptManager.java:52-90`（`loadFromDir`） | 以 `meta.id` 为键装入 `scripts`；`requires` 引用按 id 查（`:121-131`） |
| 默认 id | `MOD:script/schema/MetaSchemas.java:19` | `id` 默认值 `"untitled"`；`ScriptTemplate.build()` 直接照抄 schema 默认值（`MOD:script/ScriptTemplate.java:37-46`） |
| 图当前扫描 | `MOD:webui/ScriptGraphService.java:53-90` | 复用 `listScripts` + `loadScript`，逐文件 `JsonParser` 容错解析 |

**关键事实**：目录扫描只返回「文件」，不返回「目录」。因此当前分区表由节点反推（`ScriptGraphService.java:142-151`），空文件夹必然缺席。

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 条目范围 | 只有 `.json` 文件 | 文件 + 目录（含空目录） |
| 身份 | 路径；`scriptId` 从 JSON 里尽力读 | 路径 + `scriptId` + 「可解析」状态三者并列 |
| 元信息 | 无 mtime / 无大小 | `mtime`、`bytes`（用于刷新判定与「外部改动」提示） |
| 目录 | 不扫描 | `folder` 条目：`path`、`parent`、`scriptCount`、`childCount` |
| 缓存 | 无（每次全量） | 进程内快照 + 版本号；`script.save` / `script.move` 后失效 |

### 3.2 拟新建（提案）

- `MOD:webui/ScriptIndexService.java`（提案）
  - `public static ScriptIndex snapshot()` — 返回不可变快照（文件表 + 目录表 + 版本号）。
  - `public static long version()` — 单调递增；每次 `invalidate()` 后变化。
  - `public static void invalidate()` — 保存/移动/删除/新建后调用。
  - 内部 `record Entry(String path, String folder, String scriptId, long mtime, long bytes, boolean parseable, String error)`。
  - 内部 `record Folder(String path, String parent, int scriptCount, int childCount)`。
- `MOD:webui/ScriptIndexService.java` 内的 `scanFolders(Path base)`（提案，私有）：`Files.walk(base, MAX_DEPTH)` 只取 `Files.isDirectory`，`base.relativize(...)` 后 `/` 归一，`""` 表示根；不进入符号链接。

**不新建**：独立的「项目服务」「资源树服务」。索引只有一份，图与引用事务共享。

## 4. 输入输出与字段约束

输入：无（读取固定根 `immersive_cinematics/scripts`）。

输出 `ScriptIndex`：

| 字段 | 类型 | 约束 |
|---|---|---|
| `version` | `long` | 每次 `invalidate()` 后严格递增；用于前端判定「图是否需要重取」 |
| `files[]` | `Entry[]` | 按 `path` 字典序；`path` 非空、以 `.json` 结尾、`/` 分隔 |
| `folders[]` | `Folder[]` | 根在前（`""`），其余按 `path` 字典序；`parent` 为 `""` 表示挂在根下 |
| `Entry.scriptId` | `String \| null` | `meta.id` 缺失/非字符串/空串 → `null`（不伪造） |
| `Entry.parseable` | `boolean` | JSON 可解析且 `meta` 是对象且 `meta.id` 存在 → `true`；否则 `false` 且 `error` 非空 |
| `Entry.mtime` | `long` | 文件最后修改毫秒；读失败 → `0` |
| `Entry.bytes` | `long` | 文件字节数；读失败 → `0` |
| `Folder.scriptCount` | `int` | 直接子文件数（不递归） |
| `Folder.childCount` | `int` | 直接子目录数 |

约束：
- 任何路径必须过 `ScriptFileService.resolveSafe` 同款归一校验；索引层不重复实现第二套校验，直接复用。
- 索引**不解析**完整脚本（不调 `ScriptParser`），只做「JSON 可解析 + `meta.id` 可读」这一层；时长/轨道/触发器仍由 `ScriptGraphService` 按 JSON 直读（保持容错口径）。
- 索引不缓存文件内容（避免与保存路径产生两份真值）。

## 5. 修改步骤

1. 新建 `ScriptIndexService`，把 `ScriptFileService.listScripts()` 的逻辑内联为 `scanFiles`，新增 `scanFolders`。
2. `ScriptGraphService.buildGraph()` 改为从 `ScriptIndexService.snapshot()` 取 `files`，删除自己那次 `listScripts()` 调用（`ScriptGraphService.java:54`）。
3. `WebEditorApi.handleScriptSave` / `handleScriptDelete` / `handleScriptNew` 成功后调用 `ScriptIndexService.invalidate()`（锚点 `MOD:webui/WebEditorApi.java:125-151`、`:202-212`、`:214-219`）。
4. `script.graph` 回执增加 `version` 字段（`WebEditorApi.java:232-242`）。
5. 前端 `ED:components/ScriptGraph.vue:168-183` 的 `load()` 记录 `version`，用于刷新判定（见 `10-refresh-scale-diagnostics.md`）。

## 6. 禁止修改

- 不得改 `ScriptFileService` 的路径语义（相对 `immersive_cinematics/scripts`、`/` 分隔、越界抛 `IOException`）。索引是消费者，不是替代品。
- 不得把索引根改成 `ScriptManager` 的 `server.getServerDirectory()` 基准。编辑器侧走进程 CWD（`ScriptFileService.java:22`），两套基准是既有事实，本轮不统一。
- 不得在索引里做 `ScriptParser` 解析（会让写坏的脚本从图上消失）。
- 不得给索引加写能力。

## 7. 两分支承载

- Forge 1.20.1：`MOD:webui/` 属 common，两分支共用；索引服务无平台 API 依赖，直接可用。
- WebUI对接主模组Fabric与Forge均需真实验证索引/打开/校验行为；两者使用相同common能力不等于已验证。仅游戏内Fabric+AUI适配暂缓，不能因AUI故障跳过WebUI→Fabric。

## 8. 前置

- `01-baseline-schema` 确认 `meta.id` 的必填性与默认值口径（`MetaSchemas.java:19`）。
- `shared/contracts.md` 已登记 `script.graph` 的 `version` 字段扩展。

## 9. 验收

**正例**

- 在 `immersive_cinematics/scripts/` 下建 `chapter/`（空目录），调用 `script.graph`：`folders[]` 含 `{"path":"chapter","parent":"","scriptCount":0,"childCount":0}`。
- 建 `chapter/a.json`（`meta.id = "a"`），再取索引：`folders[]` 的 `chapter` 条目 `scriptCount = 1`；`files[]` 出现 `chapter/a.json` 且 `scriptId = "a"`、`parseable = true`。
- 写坏 `chapter/b.json`（缺 `meta`）：`files[]` 仍有该条，`parseable = false`，`error` 含 `meta 缺失`；图节点 `valid = false`。
- 保存 `chapter/a.json` 后立即取索引：`version` 大于保存前。

**反例**

- `chapter/../../evil.json` 出现在任何输出里 → 失败（越界必须被 `resolveSafe` 挡住）。
- `meta.id = ""` 被当成有效 `scriptId` → 失败（必须 `null`）。
- 空目录不出现在 `folders[]` → 失败。
- 索引缓存导致保存后 `version` 不变 → 失败。

## 10. 真实冒烟

1. 启动游戏内 WebUI 服务，连上编辑器。
2. `script.list` 返回的文件数与 `script.graph` 的 `nodes.length` 一致（同一根、同一过滤）。
3. 手动在磁盘上建空目录 `smoke/`，刷新图：分区出现且 `count = 0`。
4. 用编辑器保存任意脚本，再刷新图：`version` 增加，节点 `duration` 反映新内容。
5. 手工把某脚本改成非法 JSON，刷新图：节点仍在，`valid = false`，`warnings` 出现 `invalid`。

## 11. 完成定义

- `ScriptIndexService` 存在且是图与引用事务的唯一扫描入口；仓库内不存在第二处 `Files.walk(SCRIPTS_DIR…)`。
- `script.graph` 回执带 `version`；保存/删除/新建后 `version` 变化。
- 空目录、坏脚本、缺 `meta.id` 三种边界在上述验收下行为确定。
- 未新增任何未登记消息。
