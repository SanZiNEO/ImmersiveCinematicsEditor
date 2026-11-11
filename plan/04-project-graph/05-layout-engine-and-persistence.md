# 05 布局引擎与布局持久化

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：04-project-graph
> 关联：`03-graph-view-shell.md`、`04-folder-partitions.md`、`07-dependency-edge-semantics.md`

## 1. 职责

把「自动布局」与「作者手摆的位置」分成两层：自动布局永远可重算（无状态、可重复），手摆位置是可覆盖的编辑器元数据。定义布局文档格式、读写时机、失效与降级规则。不定义依赖语义（07），也不定义节点卡片内容（06）。

**参考输入**：[Olive项目浏览与节点画布](../references/05-project-graph-navigation.md) G2–G4/G6。布局拖动保存起始世界坐标，过程中只更新几何，松手一次提交；Esc/失焦/指针取消恢复，零位移不建历史。布局历史与脚本内容命令分域，不能发script.save或隐式移动文件。位置变化同步刷新边/包围盒，不改依赖含义。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| 布局入口 | `ED:graphLayout.ts:147-293`（`computeLayout`） | 纯函数：`GraphData → GraphLayout` |
| 节点尺寸 | `graphLayout.ts:129-137` | `NODE_W=196`、`NODE_H=64`、`GAP_X=76`、`GAP_Y=18`、`ISOLATED_ROWS=3` |
| 分层 | `graphLayout.ts:367-390`（`condenseLayers`） | 缩点 DAG 上最长路径分层 |
| 环处理 | `graphLayout.ts:304-365`（`tarjan`） | 迭代 Tarjan；`size>1` 或自环 → `cyclic` |
| 同层排序 | `graphLayout.ts:295-302`（`barycenter`） | 父节点平均行号，减少交叉 |
| 孤立收拢 | `graphLayout.ts:255-267` | 分层区右侧 3 行网格 |
| 边几何 | `graphLayout.ts:262-283` | 三次贝塞尔；`dx = max(36, |x2-x1|*0.5)` |
| 回边判定 | `graphLayout.ts:281-282` | `back = to.layer >= 0 && from.layer >= 0 && to.layer <= from.layer` |
| 画布适配 | `ED:components/ScriptGraph.vue:156-167` | 首次加载后 `fit()` |
| 布局持久化 | 无 | `plans/0.3.6/Z-editor/script-graph.md` §七 步骤 5 标「⬜ 未做」；`§六` 记「布局持久化存储位置待定」 |

**关键事实**：当前布局是「每次进入视图都重算」，作者的调整不可能保留；`LaidOutNode` 的 `x/y` 只存在于内存（`graphLayout.ts:88-105`）。

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 位置来源 | 只有自动布局 | 自动布局 + 手摆覆盖（覆盖优先） |
| 持久化 | 无 | 布局文档落盘，跨会话保留 |
| 身份键 | 无 | `path` 优先、`scriptId` 兜底 |
| 失效 | 无 | 节点消失即丢弃其位置；新增节点用自动位置 |
| 自动布局 | 每次全量 | 保持纯函数；手摆节点不参与分层（但要参与避让） |
| 视图状态 | 内存 | 与布局同存（`scale/tx/ty`、折叠集合） |

### 3.2 存储位置的选择

三个候选，本轮选 **B**：

| 方案 | 位置 | 优点 | 缺点 |
|---|---|---|---|
| A | 浏览器 `localStorage` | 零后端改动 | Electron 与浏览器不一致；换机器丢失；与「项目」概念脱节 |
| **B** | `immersive_cinematics/editor/graph-layout.json`（模组侧读写） | 与脚本同盘、可备份、跨入口一致；不污染 `scripts/` | 需新增两条消息；多客户端并发写需后写覆盖 |
| C | 写进每个脚本的 `meta` | 单文件自包含 | 污染脚本格式；影响 diff；进服务端解析；重命名路径即丢 |

选 B 的理由：布局是「这个项目怎么看」的属性，不是「这个脚本是什么」的属性；放脚本里等于让编辑器元数据进运行时格式。

### 3.3 拟新建（提案）

- `MOD:webui/GraphLayoutStore.java`（提案）
  - `public static JsonObject load()` — 文件不存在返回 `{"version":1,"nodes":{},"view":{}}`（不抛错）。
  - `public static void save(JsonObject layout)` — 原子写：先写 `graph-layout.json.tmp` 再 `Files.move(REPLACE_EXISTING)`。
  - `private static final Path LAYOUT_FILE = Paths.get("immersive_cinematics","editor","graph-layout.json")`。
  - 上限：`nodes` 条目 > 5000 时拒绝保存并返回错误（防前端 bug 写爆磁盘）。
- 消息（提案，需登记）：`graph.layout.get` → `graph.layout.result {layout}`；`graph.layout.put {layout}` → `graph.layout.saved {version}`。
- `ED:graphLayout.ts` 新增 `applyOverrides(layout: GraphLayout, overrides: Map<string,{x,y}>, nodes: GraphNode[]): GraphLayout`（提案）：返回新对象，不改入参；对被覆盖节点标记 `manual: true`。
- `ED:store/graphLayout.ts`（提案）：加载/合并/节流保存（500ms 防抖 + 卸载时 flush）。

**不新建**：布局算法库（d3/cytoscape/G6）。理由与 `Z-editor/script-graph.md` §五 一致：依赖体积、样式难贴合文件夹泳道语义。

## 4. 输入输出与字段约束

布局文档：

```json
{
  "version": 1,
  "projectKey": "immersive_cinematics/scripts",
  "nodes": {
    "chapter/a.json": { "x": 120, "y": 340, "scriptId": "a" }
  },
  "view": { "scale": 1.0, "tx": 0, "ty": 0 },
  "collapsed": ["chapter/boss"]
}
```

| 字段 | 类型 | 约束 |
|---|---|---|
| `version` | `int` | 当前 `1`；不识别的高版本 → 只读不写（避免降级破坏） |
| `projectKey` | `string` | 固定 `immersive_cinematics/scripts`；不匹配 → 忽略整份布局（防串项目） |
| `nodes` 键 | `string` | 节点 id = 相对路径 |
| `nodes[].x/y` | `number` | 有限数；`|x|,|y| ≤ 1e6`（越界丢弃该条） |
| `nodes[].scriptId` | `string \| null` | 用于路径变化后的重绑定 |
| `view.scale` | `number` | `0.15..2.5` |
| `view.tx/ty` | `number` | 有限数 |
| `collapsed` | `string[]` | 必须是已知文件夹路径；未知项忽略 |

重绑定规则（**顺序固定**）：

1. 先按 `path` 精确匹配。
2. 未命中时按 `scriptId` 匹配，且**仅当**该 `scriptId` 在当前图里唯一（`duplicate_id` 存在时禁用此步，避免把两个节点吸到同一位置）。
3. 都未命中 → 丢弃该条，节点用自动布局。

约束：
- 保存必须原子（tmp + move），避免半截文件导致下次启动整份布局丢失。
- 布局保存**不得**阻塞编辑操作：前端防抖 500ms，失败只记日志 + 顶部一次性提示，不弹模态。
- 手摆节点的坐标是「世界坐标」，与 `scale` 无关；`view.tx/ty` 才是视口偏移。

## 5. 修改步骤

1. 新建 `GraphLayoutStore`（common），两条消息挂到 `WebEditorApi` switch（锚点 `WebEditorApi.java:41-88`）。
2. `computeLayout` 增加可选第三参 `collapsed`（04 轮已加）与第四参 `overrides`；返回的 `LaidOutNode.manual` 标记手摆项。
3. 实现 `applyOverrides`：**只改坐标，不改 `layer`**（`layer` 仍由自动分层给出，用于边流向判定与「回边」着色）。
4. 前端 `store/graphLayout.ts`：`load()` 时 `graph.layout.get`，与 `computeLayout` 结果合并；`dragEnd` 时写 `overrides` 并调度保存。
5. 节点拖拽：`ScriptGraph.vue` 增加 `mousedown` 在节点上的拖拽分支（当前只在空白处平移，`ScriptGraph.vue:206-213` 用 `closest('.node')` 排除节点）。
6. `fit()`（`ScriptGraph.vue:156-167`）在存在保存视图状态时跳过。

## 6. 禁止修改

- 不得把布局写进脚本文件或 `meta`。
- 不得让手摆坐标改变依赖方向、分层语义或边的 `back` 判定。
- 不得在 `computeLayout` 内部读写存储（纯函数必须保持纯）。
- 不得用 `scriptId` 覆盖 `path` 作为唯一键（重命名 id 会丢布局）。
- 不得为了「整齐」在每次加载时把 `overrides` 清空。

## 7. 两分支承载

- Forge 1.20.1：`GraphLayoutStore` 在 common，`Files.move` + `ATOMIC_MOVE`（不支持时回落 `REPLACE_EXISTING`）。
- Fabric：同源，未实机验证。

## 8. 前置

- `02-graph-data-contract.md`（节点 id 与 `scriptId` 语义）。
- `04-folder-partitions.md`（`collapsed` 需要文件夹路径集合）。
- `shared/contracts.md` 登记 `graph.layout.get` / `graph.layout.put`。

## 9. 验收

**正例**

- 拖动 `a.json` 到任意位置，重开编辑器：位置保留，节点标 `manual`。
- 把 `a.json` 从根移到 `chapter/`（路径变化，`scriptId` 不变）：布局按 `scriptId` 重绑定，位置保留。
- 把 `a.json` 的 `meta.id` 改名（`scriptId` 变化，路径不变）：布局按 `path` 匹配，位置保留。
- 删除 `a.json`：再次加载时该条被丢弃，不产生幽灵节点。
- 新增 `c.json`：用自动布局位置，已有手摆节点不动。
- 两个脚本 `meta.id` 都是 `dup`：按 `scriptId` 的重绑定被禁用，两节点都用自动布局（不重叠到一点）。

**反例**

- 布局文件写坏（截断 JSON）：加载回落空布局并继续工作，不崩、不覆盖原文件（除非用户再次拖动）。
- 手摆坐标 `1e9`：被丢弃，节点用自动位置。
- 不同 `projectKey` 的布局被套用 → 失败。
- 保存时直接 `Files.write`（非原子）导致断电后文件损坏 → 失败。

## 10. 真实冒烟

1. 进入图，拖动 3 个节点到不同位置，等 1 秒（防抖），关闭编辑器。
2. 检查 `immersive_cinematics/editor/graph-layout.json` 存在且含三条 `nodes`。
3. 重开编辑器：三个节点位置与关闭前一致；其余节点仍自动布局。
4. 用编辑器把其中一个脚本移到子文件夹，重开：位置跟随（`scriptId` 命中）。
5. 手工把布局文件改成 `{`（损坏），重开：图正常，节点全自动布局，控制台有一次性告警。

## 11. 完成定义

- 布局文档格式、原子写、重绑定顺序、降级规则全部落地并与验收一致。
- `computeLayout` 仍是纯函数（无 I/O、无全局状态）。
- 手摆不改变分层与边流向语义。
- 未新增未登记消息。
