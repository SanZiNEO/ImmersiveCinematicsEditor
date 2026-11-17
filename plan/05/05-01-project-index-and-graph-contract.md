# 05-01 脚本索引与前置关系契约

## 目标

把脚本页需要的数据一次扫出来，形成唯一索引：脚本、触发器、前置条目、边、诊断、版本。图视图、布局、悬停、图上改前置、刷新都从这份索引取数，不各自再扫目录、不再各自解析脚本。

**这份索引表达的唯一关系是「前置依赖」**：脚本 A 的某个触发器要求「脚本 B 已经播放/开始/结束过」，就有一条边 B → A。B 自己又有前置时继续向上游延伸，形成整张图。

## 唯一扫描源

新增 `ScriptIndexService`（`editor.webui` 包），它是脚本页的唯一扫描入口：

```java
public final class ScriptIndexService {
    public static IndexSnapshot snapshot();                  // 全量
    public static IndexSnapshot snapshot(long sinceVersion); // 增量判定
}
```

规则：

- 只调用一次 `Files.walk(SCRIPTS_DIR, MAX_SCRIPT_DEPTH)`；深度沿用 `ScriptManager.MAX_SCRIPT_DEPTH = 5`，不另设。
- 文件：常规文件、后缀 `.json`；目录：所有目录；根目录 `""` 始终存在。
- 相对路径统一 `/` 分隔；拒绝 `..`、绝对路径、符号链接逃逸；路径安全复用 `ScriptFileService.resolveSafe` 的口径。
- 每个脚本记录 `path`、`size`、`mtime`、`readable`、`parseable`、`scriptId`、`error`。`parseable=false` 的脚本仍进图，节点标红，不因一个坏文件丢整张图。
- 一次扫描产出 `version`：单调递增的 `long`，每次全量成功后加一；进程重启从 1 开始。前端只比较版本，不持久化版本。
- `sinceVersion` 等于当前版本且缓存有效 → 返回 `unchanged=true`，不序列化 nodes/edges；否则返回全量。缓存失效条件：保存/删除/新建/重命名/图上改前置/手动刷新。

## 前置关系的真实形状（事实基准）

`requires` 是**触发器自己的字段**（`meta.triggers[i].requires[]`），不是脚本级字段，也不是独立的关系文件。事实基准：

- `TriggerRequirement`：一个前置 = `type` + `data`（`JsonObject`）。
- 内置类型三种，`data` 只读 `script`：`script_played`（播放过）、`script_started`（开始过）、`script_completed`（结束过）。
- 字符串简写 `"a"` 等价于 `{"type":"script_played","data":{"script":"a"}}`。
- 自定义类型（`modid:name`）由 `PrerequisiteRegistry` 注册，`data` 由该类型自己解释；编辑器不认识，只读保留。

因此：

- **改一条前置只写依赖方脚本这一个文件**（改它的某个触发器的 `requires` 数组），不需要打开、更不需要修改目标脚本。
- 目标脚本只被 `meta.id` 引用；目标缺失时前置条目仍然存在，只是不满足。
- 图上的边由「触发器 + 该触发器里的一条内置前置」产生；一条 `requires` 对应一条边，不按脚本对合并。

## 图数据契约

`script.graph` 的 data：

```ts
interface GraphData {
  version: number
  unchanged?: boolean
  nodes: GraphNode[]
  edges: GraphEdge[]
  folders: GraphFolder[]      // 仅用于按目录分组显示，不提供目录 CRUD
  warnings: GraphWarning[]
  stats: GraphStats
}

interface GraphStats {
  nodeCount: number
  edgeCount: number
  folderCount: number
  invalidCount: number
  warningCount: number         // 截断前的真实总数
  warningsTruncated: boolean
  scanMillis: number
}

interface GraphFolder {
  path: string                 // "" = scripts 根
  parent: string | null
  depth: number
  directScriptCount: number
  totalScriptCount: number
}

interface GraphNode {
  id: string                   // 相对路径，唯一
  path: string
  folder: string
  scriptId?: string | null     // meta.id；缺失/写坏时为 null
  name: string
  author: string
  description: string
  dimension: string
  priority: number
  duration: number             // 秒；无限时为 0，必须同时看 infinite
  infinite: boolean
  valid: boolean
  error?: string
  tracks: { type: string; clips: number }[]
  triggers: GraphTrigger[]
  requiresTargets: string[]    // 本脚本全部内置前置的目标 id，去重（悬停/上游高亮用）
  inCycle?: boolean            // 前端布局算，后端不填
  isolated?: boolean           // 前端算：无前置且无入边；后端不填
}

interface GraphTrigger {
  identity: string             // 触发器稳定身份；缺失时后端生成 `type#index`
  index: number                // 在 meta.triggers[] 的下标
  type: string
  repeatable: boolean
  delay: number                // 秒，0 表示未设
  requirements: GraphRequirement[]
  requiresFingerprint: string  // 该触发器 requires 数组的稳定哈希
}

interface GraphRequirement {
  index: number                // 在 requires[] 的下标
  type: string                 // script_played / script_started / script_completed / 自定义
  data: Record<string, unknown> // 原样透传（内置只有 { script }）
  role: 'builtin' | 'custom'   // 内置三种 = builtin；其余 = custom
  scriptId?: string            // 内置前置的目标 id；自定义为 undefined
  resolved?: boolean           // 目标脚本存在且 id 唯一
  editable: boolean            // 仅 builtin 且目标可解析 → true
  editableReason?: string      // 不可编辑原因：自定义前置 / 目标缺失 / 目标 id 重复 / 当前脚本无 id
}

interface GraphEdge {
  key: string                  // `${to}>${from}|${triggerIdentity}|${requirementIndex}`
  from: string                 // 被依赖脚本的 path（上游）
  to: string                   // 依赖方脚本的 path（下游，边从这里发出）
  fromScriptId: string
  toScriptId: string
  triggerIdentity: string
  triggerIndex: number
  requirementIndex: number
  requirementType: string      // script_played / script_started / script_completed
}

interface GraphWarning {
  kind: 'invalid' | 'duplicate_id' | 'dangling' | 'self_reference' | 'unknown_trigger' | 'cycle'
  severity: 'error' | 'warn'
  path: string
  nodeId?: string
  triggerIdentity?: string
  requirementIndex?: number
  message: string
}
```

### 触发器身份

- `identity` 优先读 `meta.triggers[i].id`；这是触发器的稳定身份。
- 缺失时后端生成 `type#index`，只用于图内定位；不写回脚本，不改文档。
- `triggerIndex` 是当前 JSON 数组下标，只在同一次快照内有效；图上改前置必须同时提交 `triggerIdentity + requiresFingerprint`，不能只靠 index。
- `requiresFingerprint` 是对该触发器 `requires` 数组做稳定哈希（对象键排序、字符串原样、数字按 JSON 表示）；用于并发检测。

### 边语义

- 只把 `role='builtin'` 且 `resolved=true` 的前置解析成边；自定义前置、缺失目标不建边。
- 边方向固定：**被依赖 → 依赖方**（`from` = 上游脚本，`to` = 下游脚本），箭头读作「`to` 需要 `from`」。
- 同一 `(to, triggerIdentity, requirementIndex)` 只产生一条边；同一对脚本的多条前置（不同触发器/不同类型）保留多条边，不合并。
- 自引用：目标 id 等于当前节点 `scriptId` → `self_reference` warning，不产生边，不阻断保存。
- 目标不存在 → `dangling` warning，不产生边，`resolved=false`；前置条目仍显示在悬停里。
- 重复 `meta.id`：先扫到的节点占用 id；后续节点 `duplicate_id` warning，不覆盖前一个节点的解析结果；指向该 id 的前置全部标 `resolved=false`（歧义），`editable=false`。
- 未知触发器类型：节点仍显示，`unknown_trigger` warning，`requires` 照常解析；不猜字段。
- 环（A→B→A）：合法数据，不阻止保存、不自动修；后端产出 `cycle` warning（每个环一条，带成员 path），前端同时标 `inCycle`。

### 按目录分组

- `folders` 只用于「按目录分组显示」；05 不做目录新建/重命名/删除，也不做脚本拖入目录。
- 分组顺序：根 `""` 第一，其余按 `parent/depth` 先序，同层按路径字典序。
- 空目录不出现在图里（没有脚本就没有节点，分组也没有意义）；`directScriptCount=0` 的目录可以不渲染。

### warnings

- 上限 200 条，超过后 `warningsTruncated=true`，`stats.warningCount` 仍是真实总数。
- `severity`：`invalid` 为 `error`；`duplicate_id`、`dangling`、`self_reference`、`unknown_trigger`、`cycle` 为 `warn`。
- warning 尽量带 `triggerIdentity` / `requirementIndex`，让前端能点到具体触发器/前置；不能只给一行文本。
- 节点 `error` 是节点级摘要；warning 是项目级列表；两者不互相替代。

## 消息

```text
script.graph  请求 { sinceVersion?: number }
              响应 { version, unchanged?, nodes, edges, folders, warnings, stats }
```

- `sinceVersion` 缺省 → 全量。
- `sinceVersion` 等于当前版本且缓存有效 → `{version, unchanged:true}`；前端保留当前图，不重排。
- 服务端只返回全量快照；`sinceVersion` 只做「要不要重发全量」的短路，不提供增量补丁。
- 响应大小上限（**实现变更**）：`nodes 100000`、`edges 300000`、`warnings 200`；超过上限截断并置 `truncated` 标记，前端显示「脚本过多，已截断」，不假装完整。渲染侧由三层 LOD 控制（见 05-08）。

## 验收标准

- 空 `scripts` 目录：`nodes=[]`、`edges=[]`，前端显示真实空态，不显示假节点。
- 一个坏 JSON、一个缺 `meta.id`、一个正常脚本：三个节点都在；坏节点 `valid=false`、warning 有 `invalid`；正常节点仍可打开。
- 两个脚本同 `meta.id`：两条 `duplicate_id` warning；只有先扫到的节点参与前置解析；指向该 id 的前置 `resolved=false`、`editable=false`；不自动改 id。
- `A.meta.triggers[0].requires = ["b"]` 且 B 存在：一条边 `from=B.path, to=A.path`，`requirementType="script_played"`，`requirementIndex=0`。
- `A.requires = [{"type":"script_started","data":{"script":"b"}}]`：一条边，`requirementType="script_started"`，`data.script="b"`。
- 同一对 A/B，A 的两个触发器都 require B：两条边（`triggerIdentity` 不同），不合并。
- 同一触发器两条相同 requires：两条边（`requirementIndex` 0/1）；`GraphRequirement` 两条都保留。
- 自定义前置 `{"type":"weather","data":{"value":"rain"}}`：`role="custom"`、无边、`editable=false`、`editableReason="自定义前置"`；不把 weather 猜成脚本 id。
- 前置指向不存在的 id：`dangling` warning、`resolved=false`、无边；悬停仍显示该条目并标「缺失」。
- A 需要 B、B 需要 A：两条边 + `cycle` warning；两个节点 `inCycle=true`；不阻断保存。
- `sinceVersion=当前`：响应 `unchanged=true`，无 nodes/edges；`sinceVersion=较早`：全量。
- `stats.warningCount` 超过 200：列表截 200，计数仍为真实值，`warningsTruncated=true`。
- `grep Files.walk`：只有 `ScriptIndexService`（或 `ScriptFileService` 的底层实现）一处；`ScriptGraphService` 不再自行 walk。
- `grep 总时长字段`：图数据里没有该字段，节点时长只来自 `contentEnd` / `infinite`。

## 数据边界

- 索引解析节点摘要、触发器、前置条目；轨道对象、关键帧、字段值不进入图数据。
- 边只从内置三种前置产生；自定义前置、命令文本、`play_mode` 不建边。
- 节点只携带摘要；不返回脚本全文，不携带 `doc`。
- `version` 只出现在图响应和布局文件头部；不写进脚本。
- 坏文件保留为 `valid=false` 的节点；整图继续返回，坏文件不被静默删除。
- 图数据**不缓存前置副本**：图上改前置后必须重新取 `script.graph`（或按返回的该触发器 `requirements` 局部更新），不维护第二份关系表。
