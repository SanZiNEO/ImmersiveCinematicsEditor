# 02 图数据契约改造

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：04-project-graph
> 关联：`01-script-index.md`、`07-dependency-edge-semantics.md`、`10-refresh-scale-diagnostics.md`

## 1. 职责

把 `ScriptGraphService` 的产物从「只够画一张只读图」提升为「够做项目入口」：补空文件夹与父子关系、补节点摘要所需字段、把依赖边的来源信息补全到能跳转编辑、把警告分级。不改变「容错扫描、不依赖 `ScriptParser`」这条口径。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| 图入口 | `MOD:webui/ScriptGraphService.java:53`（`buildGraph`） | 返回 `{nodes, edges, folders, warnings}` |
| 节点读取 | `ScriptGraphService.java:159-245`（`readNode`） | `meta` 摘要 + `timeline.tracks` 统计 + 时长/无限性 |
| 触发器清单 | `ScriptGraphService.java:247-275`（`readTriggers`） | 每项 `{type, repeatable, requires[]}`；`requires[]` 元素 `{type, script}` |
| 前置条件归一 | `ScriptGraphService.java:277-295`（`readRequirement`） | 字符串 → `{"type":"script_played","script":id}`；对象仅内置 `script_*` 带脚本 id |
| 内置脚本型前置 | `ScriptGraphService.java:36-38` | `Set.of("script_played","script_started","script_completed")` |
| 字符串简写口径 | `ScriptGraphService.java:42-45` | `LEGACY_REQUIREMENT_TYPE = "script_played"` |
| 边构造 | `ScriptGraphService.java:108-140` | 被依赖 → 依赖方；键 = `from>to|trigger|reqType` 去重；自引用/悬空只进 warnings |
| 分区 | `ScriptGraphService.java:142-158` | 由节点 `folder` 反推 `{path,count}` |
| 警告 | `ScriptGraphService.java:302-310`、`:41` | `MAX_WARNINGS = 200` |
| 时长口径 | `ScriptGraphService.java:196-243` | `clipWindowEnd` / `isClipInfinite` / `isMacroLoopInfinite` 与 `Clip#getWindowEnd` / `#isEffectivelyInfinite` 同口径（注释声明） |
| 文本资源解析 | `ScriptGraphService.java:170-172` | `description` 走 `LangResources.resolve` |

**关键事实**：`readRequirement` 只在 `SCRIPT_REQUIREMENT_TYPES` 命中时保留 `script`；自定义类型（含其它模组注册的前置条件）没有脚本 id，不成边（`ScriptGraphService.java:32-35` 注释）。这与 `ScriptManager.scriptIdOfRequirement`（`MOD:script/ScriptManager.java:175-190`）同口径。

## 3. 差异与提案

### 3.1 现状 vs 目标

| 字段/能力 | 现状 | 目标 | 原因 |
|---|---|---|---|
| `folders[]` | `{path,count}`，由节点反推 | `{path,parent,count,empty,depth}`，由目录扫描给出 | 空文件夹要上图；嵌套要能表达 |
| `nodes[].id` | 相对路径 | 不变 | 图内唯一、稳定 |
| `nodes[].scriptId` | `meta.id` 或 `null` | 不变 | 依赖解析键 |
| `nodes[].triggers[]` | `{type,repeatable,requires}` | 增加 `identity`（`id ?? type#index`）、`onEnter`、`hasContinuity`、`pollInterval` | 悬停要能看出「这个触发器会不会重复、是不是仅进入一次」 |
| `nodes[].tracks[]` | `{type,clips}` | 不变 | 已够摘要 |
| `nodes[].refsOut` | 无 | 去重后的「本脚本引用到的脚本 id」+ 每项计数 | 悬停与选中高亮需要方向化 |
| `edges[]` | `from/to/fromScript/toScript/trigger/requirement` | 增加 `triggerIdentity`、`triggerIndex`、`line?`（可选，不做） | 点击边要能定位到 `meta.triggers[i]` |
| `warnings[]` | 4 类 | 增加 `severity`（`error`/`warn`）与 `nodeId` | 图内定位 |
| `version` | 无 | 有（来自索引） | 刷新判定 |

### 3.2 拟新建（提案）

- `MOD:webui/ScriptGraphService.java` 内新增私有 `record GraphNode(...)` 与 `record GraphEdge(...)`（提案），替换当前的 `Node` 内部类（`ScriptGraphService.java:346-392`）。理由：当前 `Node` 混装「扫描中间态」与「输出形态」，加字段会让 `toJson` 变成巨型方法。
- 新增 `public static JsonObject buildGraph(long sinceVersion)`（提案）：`sinceVersion == 当前索引版本` 时返回 `{unchanged:true, version}`，否则返回全量。**这是新增消息语义，需先在 `shared/contracts.md` 登记**。
- 新增 `private static JsonObject buildFolders(ScriptIndex index, List<GraphNode> nodes)`（提案）。

**不新建**：图数据的前端类型独立包。前端类型继续放 `ED:graphLayout.ts:16-118`，与 Java 字段一一对应即可。

## 4. 输入输出与字段约束

`script.graph` 回执（全量）：

```json
{
  "version": 12,
  "nodes": [{
    "id": "chapter/a.json", "path": "chapter/a.json", "folder": "chapter",
    "scriptId": "a", "name": "A", "author": "", "description": "", "dimension": "",
    "priority": 0, "duration": 12.5, "infinite": false, "valid": true,
    "tracks": [{"type":"CAMERA","clips":3}],
    "triggers": [{
      "identity": "trg_a", "index": 0, "type": "location", "repeatable": false,
      "onEnter": true, "hasContinuity": true, "pollInterval": 10,
      "requires": [{"type":"script_played","script":"b","resolved":true}]
    }],
    "refsOut": [{"script":"b","count":1}],
    "requires": ["b"]
  }],
  "edges": [{
    "from": "chapter/b.json", "to": "chapter/a.json",
    "fromScript": "b", "toScript": "a",
    "trigger": "location", "triggerIdentity": "trg_a", "triggerIndex": 0,
    "requirement": "script_played"
  }],
  "folders": [{"path":"","parent":null,"count":0,"empty":false,"depth":0}],
  "warnings": [{"kind":"dangling","severity":"error","nodeId":"chapter/a.json","path":"chapter/a.json","message":"…"}]
}
```

字段约束：

- `identity`：`meta.triggers[i].id` 存在且非空 → 用它；否则 `type + "#" + i`（与 `MOD:script/TriggerDefinition.java:87` 的 `getIdentity()` 完全同构，不得另立规则）。
- `index`：声明下标（0 起）。
- `pollInterval`：只读 `triggers[i].poll_interval`；缺失 → `null`（**不要**在这里回落 `meta.trigger_poll_interval` 或类型默认值，回落归运行时，见 `MOD:spi/TriggerType.java:63-70`）。
- `hasContinuity`：`continuity` 对象存在且不是全默认（`sweep=false, dwell=0, window=0`）→ `true`。
- `refsOut[].count`：本脚本所有触发器里指向该脚本 id 的 `requires` 元素数（去重前计数）。
- `folders[].parent`：根为 `null`；其余为父路径（`""` 表示父是根）。
- `folders[].empty`：`count == 0 && childCount == 0`。
- `warnings[].severity`：`dangling`/`duplicate_id`/`invalid` = `error`；`self_reference` = `warn`（自引用是作者可能故意为之的写法，`MOD:script/ScriptManager.java:129` 只记日志不拒绝）。

## 5. 修改步骤

1. 引入 `ScriptIndexService.snapshot()`，替换 `buildGraph` 内的 `ScriptFileService.listScripts()`（`ScriptGraphService.java:54`）。
2. 把 `Node` 拆成 `GraphNode`（输出）+ 局部 `ScanState`（中间态），`readNode` 返回 `ScanState`。
3. `readTriggers` 补 `identity` / `index` / `onEnter` / `hasContinuity` / `pollInterval`（锚点 `ScriptGraphService.java:247-275`）。
4. 新增 `refsOut` 聚合（在第二遍边构造时顺手累加，避免第三遍）。
5. `buildFolders` 改为消费 `ScriptIndex.folders()`；`count` 用该文件夹的直接子脚本数（与现有 `folderCounts` 口径一致）。
6. `addWarning` 增加 `severity` 与 `nodeId` 参数（`ScriptGraphService.java:302`）。
7. 回执增加 `version`；支持 `sinceVersion` 短路。
8. 前端 `ED:graphLayout.ts:16-118` 的类型同步加字段；`ED:components/ScriptGraph.vue:52`（`folders`）改为读新结构。

## 6. 禁止修改

- 不得让 `buildGraph` 依赖 `ScriptParser`（写坏脚本必须仍上图）。
- 不得把自定义前置条件（非 `script_*`）画成边。它们没有脚本 id，画出来就是伪造关系。
- 不得把 `pollInterval` 的回落逻辑搬进图数据；图只呈现「声明值」。
- 不得改边的方向（必须「被依赖 → 依赖方」）。
- 不得提高 `MAX_WARNINGS` 之外再新增第二套截断。

## 7. 两分支承载

- Forge 1.20.1：common 代码，直接生效。
- WebUI→Fabric与WebUI→Forge均为正常验收目标；common同源不是实机通过证明。仅游戏内Fabric+AUI适配暂缓，不因AUI跳过WebUI的Fabric图数据通路。

## 8. 前置

- `01-script-index.md` 完成（需要 `ScriptIndex.folders()`）。
- `shared/contracts.md` 登记 `script.graph` 的 `version` / `sinceVersion` / `unchanged` 语义。
- `11-triggers-rules-events/01-trigger-identity.md` 确认 `identity` 的合成规则与 UI 展示口径（两轮共用同一字符串，不得各算一套）。

## 9. 验收

**正例**

- 脚本 `a.json`（`meta.id = "a"`）有两个触发器，第一个显式 `id = "trg_a"`，第二个无 `id` 且 `type = "biome"`：`triggers[0].identity = "trg_a"`，`triggers[1].identity = "biome#1"`。
- `a.json` 的触发器 `requires: ["b", {"type":"script_started","script":"c"}]`：`edges[]` 出现两条（`b→a|…|script_played`、`c→a|…|script_started`），`refsOut` = `[{script:"b",count:1},{script:"c",count:1}]`。
- 触发器 `requires: [{"type":"my_mod:quest","quest":"q1"}]`：`refsOut` 不含该项，`edges[]` 无对应边，`warnings` 无 dangling。
- 空文件夹 `chapter/` 无任何脚本：`folders[]` 有 `{"path":"chapter","count":0,"empty":true}`，`nodes[]` 无对应项。
- 同一对脚本被两个触发器各自 `requires`：`edges[]` 两条（`trigger`/`triggerIdentity` 不同），不是一条。

**反例**

- 自定义前置条件出现在 `edges[]` → 失败。
- `folders[]` 里出现没有对应目录的路径 → 失败。
- 空文件夹在 `folders[]` 缺席 → 失败。
- 写坏脚本被从 `nodes[]` 剔除 → 失败。
- `identity` 用了「声明下标从 1 开始」或「type 单独」→ 失败（必须与 `TriggerDefinition.getIdentity()` 同构）。

## 10. 真实冒烟

1. 在 `scripts/` 造三个脚本：`a`（requires `b`）、`b`、`c`（无依赖），再加空目录 `empty/`。
2. `script.graph`：`nodes = 3`、`edges = 1`、`folders` 含 `""`、`empty`（`empty=true`）。
3. 把 `a.json` 里 `requires` 改成 `["missing"]`：刷新后 `warnings` 出现 `dangling`（`severity=error`），`edges = 0`，`a` 节点仍在。
4. 把 `b.json` 的 `meta.id` 改成 `a`：刷新后 `warnings` 出现 `duplicate_id`，且 `requires` 解析到「先扫到的那个」——记录实际结果，作为 `08-move-rename-transaction.md` 的输入约束。
5. 连续两次调用（中间不保存）：第二次带 `sinceVersion` 应返回 `unchanged`。

## 11. 完成定义

- 上表「现状 vs 目标」每一行的字段都在实际回执里可观察。
- 三类边界（空文件夹、坏脚本、自定义前置条件）行为与验收一致。
- `ED:graphLayout.ts` 的 `GraphData` 与 Java 回执字段一一对应，无前端自造字段。
- 未新增未登记消息。
