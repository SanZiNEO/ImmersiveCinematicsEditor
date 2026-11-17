# 05-04 脚本页视图与布局持久化

## 目标

脚本页的布局分两层：自动分层布局算默认坐标，作者手摆的节点坐标作为覆盖持久化。视图（缩放/平移）与折叠的分组一起存。重命名脚本 id、改前置后布局不丢；坏文件、越界坐标、重复/缺失节点都不能把图打崩。布局文件独立于脚本、独立于 04 的 `layout.json`。

## 数据模型

```ts
interface GraphLayoutFile {
  version: 1
  projectKey: string                      // 固定 "immersive_cinematics/scripts"
  revision: number                        // 每次成功写入 +1
  nodes: Record<string, GraphNodeLayout>  // key = 相对 path
  view: GraphViewState
  collapsed: string[]                     // 折叠的分组（目录 path；"" = 根组）
  updatedAt: string                       // ISO-8601，仅诊断
}

interface GraphNodeLayout {
  x: number                               // 世界坐标
  y: number
  scriptId?: string | null                // 写入时的 meta.id，用于 path 失效后的兜底
}

interface GraphViewState {
  scale: number                           // 0.15–2.5
  tx: number
  ty: number
}
```

- 只存世界坐标；屏幕坐标由 `view` 换算，不落盘。
- 不存节点尺寸、颜色、选中、悬停、过滤条件；这些是运行期状态。
- 不存边；边走索引，布局只关心节点位置。
- 文件路径：`immersive_cinematics/editor/graph-layout.json`。

## 自动布局与覆盖

1. 自动布局（05-02）：按前置层级 + 目录分组算出每个节点默认坐标。
2. 覆盖：`nodes[path]` 存在 → 用它的坐标；不存在 → 用自动坐标。
3. 手摆：拖动节点松手后写覆盖；拖动过程中只改内存，不写盘。
4. 「重置布局」：清空 `nodes` 与 `collapsed`，保留 `view`；确认后执行。
5. 自动布局是纯函数，输入相同输出相同；不引入随机抖动，刷新后节点不跳位。

## 重绑定

脚本文件被重命名/移动（外部工具或后续轮次）后，按以下顺序重绑定：

1. **路径命中**：`nodes[newPath]` 已存在 → 直接用它。
2. **scriptId 命中**：在旧记录里找 `scriptId === 该节点 scriptId` 且未被占用的记录 → 迁移到新路径。
3. 都没有 → 用自动布局坐标，并把旧记录标记为 orphan。
4. orphan 记录保留 30 天（按 `updatedAt`），下次写入时清理；不在界面上提示。

- 重绑定只改内存里的 key，**不因为重绑定而写盘**；下一次正常写入时一起落盘。
- 同一 `scriptId` 出现在两条记录里 → 保留路径命中的那条，另一条标 orphan；不合并坐标。
- 节点被删除（脚本文件没了）→ 记录变 orphan，不立刻删。

## 写入

- 时机：
  - 手摆结束 → 500ms debounce；
  - 视图变化（缩放/平移/适配）→ 500ms debounce；
  - 折叠分组切换 → 500ms debounce；
  - 应用退出 / 关闭窗口前 → flush。
- 写法：`graph-layout.json.tmp` → `Files.move(tmp, path, REPLACE_EXISTING)`；写前把原文件复制为 `graph-layout.json.bak`。
- 上限 1 MB；超过拒绝写入并提示「布局文件过大」，保留内存值。
- 写失败：保留内存值，状态区提示「布局未保存」；下次变更重试；不阻塞编辑。
- 并发：同一时刻只允许一个写入；后到的变更合并到下一次写。
- `revision` 每次成功写入 +1；不参与冲突检测（单实例编辑器，不做多窗口合并）。

## 读取与容错

| 情况 | 行为 |
|---|---|
| 文件不存在 | 用自动布局 + 默认视图（不 fit，按 05-02 首开规则） |
| JSON 坏 | 复制为 `graph-layout.corrupt.<ISO>.json`，用默认布局；状态区提示「图布局已恢复默认」；不删原文件 |
| `version` 不是 1 | 按坏文件处理（备份 + 默认） |
| 坐标非有限数 / 绝对值 > 1e6 | 该节点覆盖丢弃，用自动坐标；不整份丢弃 |
| `scale` 越界 | 夹到 0.15–2.5 |
| `collapsed` 含不存在的目录 | 忽略该条，不写回 |
| 记录指向不存在的脚本 | 标 orphan，不参与渲染；30 天后清理 |
| 文件超过 1 MB | 按坏文件处理（备份 + 默认） |

- 坏布局只影响图布局：不重置主题、快捷键、窗口、草稿、脚本。
- 读取在脚本页首次挂载时做一次；之后只在写入失败时重读（不做文件监听）。

## 与 04 布局的关系

- 04 的 `layout.json` 管「面板在哪个槽、多大」；本文件管「图里的节点在哪个世界坐标、视图缩放多少」。两者互不写入。
- 脚本页的面板尺寸变化由 04 处理；图不会因此重置 `view`。
- 图布局文件不写进 `layout.json`，也不写进 `preferences.json`。

## 验收标准

- 首次打开无布局文件：节点按自动分层布局；`view` 为默认（scale 1，tx/ty 0）；不自动 fit（除非配置为首次 fit）。
- 拖动一个节点 100px 后松手，500ms 后文件出现该节点的 `x/y`；刷新页面位置保持。
- 缩放/平移到某状态，刷新后恢复同一 `view`；`scale` 越界被夹住。
- 折叠一个分组后刷新，仍是折叠状态。
- 改脚本 `meta.id`（05-06）：节点位置不变（路径命中）；`scriptId` 更新为新 id。
- 外部重命名脚本文件（path 变、id 不变）：位置按 `scriptId` 迁移到新 path。
- 删除脚本文件：记录变 orphan，不渲染；不报错；再次创建同名文件时若 path 命中则复用坐标。
- 手写坏 JSON：备份为 `graph-layout.corrupt.*`，图用默认布局，状态区提示；原文件保留。
- 坐标写 `1e9` 或 `"abc"`：该节点回自动坐标，其他节点坐标保留。
- 文件写失败（只读目录）：内存布局仍生效，状态区提示；不阻塞拖动。
- 超过 1 MB：拒绝写入并提示，内存值不丢。
- `grep layout.json`：本模块只引用 `graph-layout.json`，不读写 04 的 `layout.json`。
- `grep 脚本内容`：布局文件里没有脚本正文、没有 `requires`、没有触发器数据。

## 边界

- 不做多窗口 / 多实例合并；不做云端同步。
- 不做「导出/导入图布局」。
- 不存边、不存选中、不存过滤条件。
- 不因为布局变化触发脚本保存、不改脚本内容、不进文档撤销栈。
