# 05-01 项目索引与图数据契约

## 目标

把项目图需要的数据一次性扫出来，形成唯一索引：脚本、文件夹（含空目录）、触发器身份、`requires`、边、warnings、版本。图视图、布局、移动/重命名、依赖维护、刷新都从这份索引取数，不各自再扫目录、不再各自解析脚本。

## 唯一扫描源

新增 `ScriptIndexService`（`editor.webui` 包），它是项目图的唯一扫描入口：

```java
public final class ScriptIndexService {
    public static IndexSnapshot snapshot();          // 全量
    public static IndexSnapshot snapshot(long sinceVersion); // 增量判定
}
```

规则：

- 只调用一次 `Files.walk(SCRIPTS_DIR, MAX_SCRIPT_DEPTH)`；深度沿用 `ScriptManager.MAX_SCRIPT_DEPTH = 5`，不另设。
- 文件：常规文件、后缀 `.json`；目录：所有目录，包含空目录；根目录 `""` 始终存在。
- 相对路径统一 `/` 分隔；拒绝 `..`、绝对路径、符号链接逃逸；路径安全复用 `ScriptFileService.resolveSafe` 的口径。
- 每个脚本记录 `path`、`size`、`mtime`、`readable`、`parseable`、`scriptId`、`error`。`parseable=false` 的脚本仍进图，节点标红，不因一个坏文件丢整张图。
- 每个目录记录 `path`、`parent`（根为 `null`）、`depth`、`directScriptCount`、`childCount`、`totalScriptCount`、`empty`。`empty=true` 只表示没有直接脚本且没有子目录（`directScriptCount===0 && childCount===0`）；有子目录但没脚本不是空目录。
- 一次扫描产出 `version`：单调递增的 `long`，每次 `snapshot()` 全量成功后加一；进程重启从 1 开始。前端只比较版本，不持久化版本。
- `sinceVersion` 等于当前版本且索引缓存有效 → 返回 `unchanged=true`，不序列化 nodes/edges；否则返回全量。缓存失效条件：保存/删除/新建/移动/文件夹变更/重命名事务/手动刷新。

## 图数据契约

`script.graph` 的 data 扩展为：

```ts
interface GraphData {
  version: number
  unchanged?: boolean
  nodes: GraphNode[]
  edges: GraphEdge[]
  folders: GraphFolder[]
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
  childCount: number           // 直接子目录数
  totalScriptCount: number
  empty: boolean
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
  requires: string[]           // 全部内置 requires 目标 id，去重
  inCycle?: boolean            // 前端布局算，后端不填
  isolated?: boolean           // 前端算：无 requires 且无入边；后端不填
}

interface GraphTrigger {
  identity: string             // 触发器稳定身份；缺失时后端生成 `type#index`
  index: number                // 在 meta.triggers[] 的下标
  type: string
  repeatable: boolean
  requires: GraphRequirement[]
  requiresFingerprint: string  // 该触发器 requires 数组的稳定哈希
}

interface GraphRequirement {
  index: number                // 在 requires[] 的下标
  type: string
  script: string               // 自定义前置为空串
  resolved?: boolean
  editable: boolean            // 内置 script_* 且目标存在 → true；其余 false
  editableReason?: string
}

interface GraphEdge {
  key: string                  // `${from}>${to}|${triggerIdentity}|${requirementIndex}`
  from: string                 // 被依赖脚本的 path
  to: string                   // 依赖方脚本的 path
  fromScript: string
  toScript: string
  triggerIdentity: string
  triggerIndex: number
  requirementIndex: number
  trigger: string
  requirement: string
}

interface GraphWarning {
  kind: 'invalid' | 'duplicate_id' | 'dangling' | 'self_reference' | 'unknown_trigger'
  severity: 'error' | 'warn'
  path: string
  nodeId?: string
  triggerIdentity?: string
  requirementIndex?: number
  message: string
}
```

### 触发器身份

- `identity` 优先读 `meta.triggers[i].identity`；这是触发器的稳定身份。
- 缺失时后端生成 `type#index`，只用于图内定位；不写回脚本，不改文档。
- `triggerIndex` 是当前 JSON 数组下标，只在同一次快照内有效；依赖维护必须同时提交 `triggerIdentity + requiresFingerprint`，不能只靠 index。
- `requiresFingerprint` 是对该触发器 `requires` 数组做稳定哈希（对象键排序、字符串原样、数字按 JSON 表示）；用于依赖维护的并发检测。

### 边语义

- 只把内置 `script_played` / `script_started` / `script_completed` 的 `script` 字段解析成边；字符串简写 `requires:["a"]` 等价 `script_played`。
- 自定义类型没有 `script` 字段，不成边，`editable=false`，但保留在 `GraphRequirement` 里，供浮层/维护面板显示“自定义前置，只读”。
- 同一对 `from/to/triggerIdentity/requirementIndex` 只产生一条边；重复 `requires` 不重复画线。
- 自引用：目标 id 等于当前节点 `scriptId` → `self_reference` warning，不产生边，不阻断打开。
- 目标不存在 → `dangling` warning，不产生边，`resolved=false`。
- 重复 `meta.id`：先扫到的节点占用 id；后续节点 `duplicate_id` warning，不覆盖前一个节点的解析结果。
- 未知触发器类型：节点仍显示，`unknown_trigger` warning，`requires` 照常解析；不猜字段。

### 文件夹模型

- `folders` 来自目录扫描，不是“有脚本的文件夹才出现”；空目录必须出现。
- `empty` 的判定：`directScriptCount===0 && childCount===0`。
- 根目录 `path=""`、`parent=null`、`depth=0`；根永远不空（即使没有脚本，它仍是项目根）。
- 文件夹路径大小写原样保留；排序：根在前，其余按 `/` 分段字典序，父目录在子目录前。

### warnings

- 上限 200 条，超过后 `warningsTruncated=true`，`stats.warningCount` 仍是真实总数。
- `severity`：`invalid`（读失败/JSON 坏/meta 缺失/timeline 缺失）为 `error`；`duplicate_id`、`dangling`、`self_reference`、`unknown_trigger` 为 `warn`。
- warning 尽量带 `triggerIdentity` / `requirementIndex`，让前端能点到具体触发器/前置；不能只给一行文本。
- 节点 `error` 是节点级摘要；warning 是项目级列表；两者不互相替代。

## 消息

```text
script.graph  请求 { sinceVersion?: number }
              响应 { version, unchanged?, nodes, edges, folders, warnings, stats }
```

- `sinceVersion` 缺省 → 全量。
- `sinceVersion` 等于当前版本且缓存有效 → `{version, unchanged:true}`；前端保留当前图，不重排。
- 服务端只返回全量快照；`sinceVersion` 只做“要不要重发全量”的短路，不提供增量补丁。
- 响应大小上限：nodes 800、edges 2000、folders 500、warnings 200；超过上限截断并置 `truncated` 标记，前端显示“项目过大，已截断”，不假装完整。

## 验收标准

- 空 `scripts` 目录：`folders=[{path:"",...}]`，`nodes=[]`，`unchanged=false`，前端显示真实空态，不显示假节点。
- 只有空文件夹 `chapter/`：`folders` 含 `chapter`，`empty=true`，`directScriptCount=0`，图不报错。
- 一个坏 JSON、一个缺 `meta.id`、一个正常脚本：三个节点都在；坏节点 `valid=false`、warning 有 `invalid`；正常节点仍可打开。
- 两个脚本同 `meta.id`：两条 `duplicate_id` warning；只有先扫到的节点参与 requires 解析；不自动改 id。
- 自定义前置 `requires:[{"type":"weather","value":"rain"}]`：节点 `requires` 为空、无边、`editable=false`、`editableReason="自定义前置"`；不把 weather 猜成脚本 id。
- `requires:["a"]` 指向存在脚本：一条边，`triggerIdentity` 与触发器 identity 一致，`requirementIndex=0`。
- 同一触发器两条相同 requires：一条边；`GraphRequirement` 两条都保留，index 0/1。
- `sinceVersion=当前`：响应 `unchanged=true`，无 nodes/edges；`sinceVersion=较早`：全量。
- `stats.warningCount` 超过 200：列表截 200，计数仍为真实值，`warningsTruncated=true`。
- `grep Files.walk`：只有 `ScriptIndexService`（或 `ScriptFileService` 的底层实现）一处；`ScriptGraphService` 不再自行 walk。
- `grep 总时长字段`：图数据里没有该字段，节点时长只来自 `contentEnd` / `infinite`。

## 数据边界

- 图索引解析节点摘要和 `requires`；轨道对象、关键帧、字段值不进入图数据。
- 依赖边只从内置三种 `requires` 生成；自定义前置、命令文本、`play_mode` 不建边。
- 节点只携带摘要；不返回脚本全文，不携带 `doc`。
- `version` 只出现在图响应和布局文件头部；不写进脚本。
- 坏文件保留为 `valid=false` 的节点；整图继续返回，坏文件不被静默删除。
