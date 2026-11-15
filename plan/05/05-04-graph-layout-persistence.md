# 05-04 图布局与持久化

## 目标

图布局分两层：自动布局算默认坐标，作者手摆的节点坐标作为覆盖持久化。移动/重命名脚本后，布局能按路径优先、`scriptId` 兜底重绑定；坏文件、越界坐标、重复/缺失节点都不能把图打崩。布局文件独立于脚本、独立于 04 的 `layout.json`。

## 数据模型

```ts
interface GraphLayoutFile {
  version: 1
  projectKey: string                 // 固定 "immersive_cinematics/scripts"
  revision: number                   // 每次成功写入 +1
  nodes: Record<string, GraphNodeLayout>  // key = 相对 path
  view: GraphViewState
  collapsed: string[]                // 折叠的文件夹 path；"" 表示根
  updatedAt: string                  // ISO-8601，仅诊断
}

interface GraphNodeLayout {
  x: number
  y: number
  scriptId?: string | null           // 写入时的 meta.id；用于 path 失效后的兜底
}

interface GraphViewState {
  scale: number                      // 0.15–2.5
  tx: number
  ty: number
}
```

- `nodes` 的 key 是相对 `scripts` 的 path；同一 path 只能一条。
- `x/y` 是画布世界坐标，有限数；`|x|,|y| <= 1_000_000`；超出丢弃该条覆盖并记 warning。
- `scriptId` 只用于重绑定，不参与节点身份；不带 `meta` 其余字段。
- `view.scale` 夹 0.15–2.5；`tx/ty` 有限，超出 ±1e6 夹回。
- `collapsed` 去重，只保留当前存在的 folder path；根 `""` 可折叠但默认不折叠。
- 文件大小上限 5 MB；`nodes` 条目上限 5000；超过拒绝写入并保留原文件。
- 布局文件不写脚本、不写 `meta.version`、不写 `layout.json`、不写 `localStorage`。

## 服务端落点

`GraphLayoutStore`（`editor.shared` 或 `editor.webui`，按 01 包边界落）：

```text
<game>/immersive_cinematics/editor/graph-layout.json
```

- 与脚本同盘，跨 WebUI/AUI、跨机器拷贝项目时布局一起走；不放在 Electron `userData`。
- `projectKey` 固定 `immersive_cinematics/scripts`；不按服务器/世界名分文件。
- 读：文件不存在 → `{version:1, revision:0, nodes:{}, view:默认, collapsed:[], updatedAt:null}`；不创建文件。
- 写：先写 `graph-layout.json.tmp`，再 `Files.move(tmp, target, ATOMIC_MOVE, REPLACE_EXISTING)`；不支持原子移动时回退普通 move，并写 `.bak`。
- 写前校验：JSON 可解析、`version===1`、`projectKey` 正确、`nodes` 是对象、坐标有限、`view` 合法；非法项逐条丢弃，不因一条坏坐标丢整份文件。
- 并发：`graph.layout.put` 可带 `baseRevision`；服务端当前 `revision` 不等于 `baseRevision` → `conflict`，不写；前端重新拉取后由作者再决定是否覆盖。
- 坏文件/未知版本：把原文件复制为 `graph-layout.corrupt.<timestamp>.json`，内存用自动布局，状态区提示“图布局已恢复默认”；不删原文件。

## 消息

```text
graph.layout.get  {} 
  → { layout: GraphLayoutFile, exists: boolean }

graph.layout.put  { layout: GraphLayoutFile, baseRevision?: number }
  → { ok: true, revision: number }
  → error { code: "conflict" | "invalid_layout" | "too_large", message }
```

- `get` 不做图数据扫描；只读布局文件。
- `put` 不触发 `script.graph` 重扫；布局变化不影响节点/边数据。
- 写入成功 → `revision+1`；返回新 revision。
- 前端 500ms 防抖：连续拖动只提交最后一次；切页/关闭前 flush 一次。

## 自动布局与手摆覆盖

1. 先跑 `computeLayout(graph)` 得到每个节点的自动坐标 `auto[node.path]`。
2. 读布局覆盖 `overrides[node.path]`：
   - path 命中 → 用覆盖坐标；`scriptId` 仅用于校验/重绑定。
   - path 未命中但 `scriptId` 唯一匹配 → 把覆盖条目重绑定到新 path，使用坐标；保存时写新 key。
   - path 未命中且 `scriptId` 不唯一/为空 → 不重绑定，节点用自动坐标；既有条目保留为孤儿。
3. 手摆节点不改变拓扑层；它只是覆盖坐标。自动布局的泳道外框仍按泳道计算，节点可以拖出泳道，外框不跟随单节点扩张。
4. 拖动节点：
   - pointer down 在卡片主体，移动超过 4px 才进入拖拽；4px 内抬起仍是单击选中。
   - 拖动中只更新内存坐标；松手写一次覆盖，500ms 防抖落盘。
   - 拖到泳道标题上不触发文件夹移动；移动脚本走 05-02 的显式确认。
   - `Esc` 取消拖动，坐标回到拖动前。
5. 重置：
   - `project.resetLayout` 清空当前项目 `nodes` 覆盖，保留 `view/collapsed`；二次确认。
   - `project.fitView` 只改 `view`，不删手摆坐标。

## 重绑定规则

| 场景 | 行为 |
|---|---|
| 脚本移动到新文件夹 | path 变、`meta.id` 不变 → `scriptId` 唯一匹配，覆盖坐标跟随；保存时 key 改为新 path |
| 改 `meta.id` | path 不变、`scriptId` 变 → path 命中，坐标保留；更新条目的 `scriptId` |
| 删除脚本 | path 不存在 → 条目成为孤儿；下次保存清理，或 `project.resetLayout` 清空 |
| 复制脚本 | 新 path、同 `scriptId` 可能重复 → 不自动复用坐标；新节点自动布局，避免重叠 |
| 两个脚本同 `meta.id` | `scriptId` 不唯一 → 不兜底重绑定；只按 path 命中；诊断提示重复 id |
| 路径大小写/分隔符变化 | 统一 `/`；大小写原样；不做大小写不敏感匹配 |

## 视图状态

- `scale/tx/ty` 存在 `view`；图打开时恢复；首次无文件才 `fit()`。
- 刷新/保存后图数据变化，不自动 fit；保留当前视图，除非节点全部消失。
- 折叠集合存 `collapsed`；折叠状态跨重启保留；过滤条件不持久化。
- 窗口尺寸变化不写 `view`；只夹画布可视范围，避免图完全移出屏幕。
- 切页/切文档不重置图视图；重新进入项目页按保存视图恢复。

## 验收标准

- 首次打开无布局文件：自动布局 + fit；不创建空文件；关掉再开仍自动布局。
- 拖动 3 个节点后重启：3 个坐标恢复；未拖动节点仍自动布局；边按新坐标重画。
- 移动 `chapter/a.json` 到 `boss/a.json`：`scriptId` 唯一 → 坐标跟随；保存后 key 变为新 path；原 key 清理。
- 改 `a.json` 的 `meta.id`：path 不变 → 坐标保留；条目 `scriptId` 更新。
- 复制出同 `meta.id` 的第二个脚本：不按 id 兜底；两个节点都不重叠在原坐标；诊断提示重复 id。
- 删除脚本：既有条目成为孤儿；下次保存清理；图不报错。
- 手改 `graph-layout.json`：`x=NaN`/`1e9`/`version=2`/`nodes` 不是对象 → 该条/整份回退；原文件备份为 `graph-layout.corrupt.*`。
- 两个窗口同时 `put`，第二个带过期 `baseRevision` → `conflict`，不覆盖；重新拉取后作者再决定。
- 折叠 `chapter` 后重启：折叠恢复；节点隐藏、边吸附标题条；展开恢复。
- `grep localStorage`：图布局 0 命中；`grep layout.json`：图布局不写 04 的 `layout.json`。
- 文件 5MB/5000 节点上限：超限拒绝写入，原文件仍在；状态区提示原因。

## 存储与操作约束

- 图布局只写 `graph-layout.json`；脚本、`meta`、`layout.json`、`preferences.json` 不承载布局。
- `baseRevision` 只做覆盖检测。
- 手摆只覆盖节点坐标；其余节点由自动布局排。
- 画布支持平移、缩放、拖节点。
- 文件夹泳道位置由顺序计算，不单独持久化。
- 松手/防抖后写盘；拖动过程中不写盘。
- 布局文件坏时备份原文件并回自动布局；图数据独立恢复。
