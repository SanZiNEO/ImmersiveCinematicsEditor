# 05-08 图刷新与规模诊断

## 目标

图数据变了，前端要知道“该刷新了”，但不能每次保存都跳视图、不能每次编辑都全量重扫。大批项目要能降级显示，统计和 warnings 要诚实，不能假装完整。刷新只做全量快照，不做未定义的 `graph.patch`。

## 失效广播

### 服务端

新增广播：

```text
script.graph.invalidated {
  version: number,
  kind: "save" | "delete" | "new" | "move" | "refactor" | "folder" | "layout",
  paths?: string[],
  folders?: string[]
}
```

- `save`：`script.save` 成功后广播该 path；`version` 先自增。
- `delete`：`script.delete` 成功后广播。
- `new`：新建脚本落盘后广播。
- `move`：`script.move` 成功后广播 from/to。
- `refactor`：`script.refs.apply` 成功后广播全部受影响 path。
- `folder`：`script.folder.*` 成功后广播 folder。
- `layout`：只影响布局，不广播图失效；`graph.layout.put` 自己返回 revision。
- 同一次请求内多个 path 合并成一条广播；不逐文件发。
- 广播只给已连接 WebUI 会话；断连不补发；重连后前端主动拉全量。
- 服务端维护 `version`：与 `ScriptIndexService` 同一计数器；保存/删除/移动等成功后 `version++`。

### 前端

- 图面板订阅 `script.graph.invalidated`；收到后：
  - 图可见且无拖动/无打开菜单 → 150ms 合并后请求 `script.graph {sinceVersion: currentVersion}`；
  - 图不可见 → 只设置 `stale=true`，不发请求；
  - 正在拖动节点/框选/菜单打开 → 延后到交互结束，避免图跳。
- 请求返回 `unchanged=true` → 清 stale，不重排。
- 请求返回全量 → 保留 `view.scale/tx/ty` 和选中节点（按 path/id 找回）；不自动 fit；不重置过滤器。
- 保存当前文档时，文档侧只标“图有更新”，不把图视图切走；用户点刷新/重新进入项目页再拉。
- 外部进程直接改文件：没有文件监听，图不会自动知道；工具栏“刷新”是唯一入口；状态区可显示“上次扫描时间”。

## 刷新入口

| 入口 | 行为 |
|---|---|
| 首次挂载 | 全量；骨架屏；`sinceVersion` 不传 |
| 手动刷新 | 全量或带 `sinceVersion`；保留视图/选中/过滤 |
| 收到 invalidated（可见） | 合并 150ms，带 `sinceVersion` |
| 收到 invalidated（不可见） | 只标 stale；下次进入项目页拉 |
| 文档保存成功 | 服务端广播；图侧按上面规则 |
| 文件夹/移动/重命名/依赖维护 | 服务端广播；图侧局部更新或全量 |
| 断线重连 | 全量；清 stale；不保留“正在加载”假状态 |
| 外部文件改动 | 不自动；手动刷新 |

## 过期状态

- `stale=true` 时工具栏显示“有更新”角标 + 刷新按钮高亮；统计数字旁加“*”。
- 不自动把既有节点删掉；当前图仍可交互（打开脚本可能失败，失败按 05-03 处理）。
- 过期状态不写盘、不进撤销、不影响文档。
- 刷新失败：保留当前图，角标变红，错误条显示原因；不白屏。
- 刷新中：保留当前图 + 顶部细进度条；不显示空图/0 节点。

## 规模降级

后端上限（05-01）：

| 项 | 上限 | 超出 |
|---|---|---|
| nodes | 800 | 截断，`stats.nodeCount` 真实，`truncated=true` |
| edges | 2000 | 截断，`stats.edgeCount` 真实 |
| folders | 500 | 截断 |
| warnings | 200 | 截断，`stats.warningCount` 真实 |

前端降级：

| 节点数 | 渲染 |
|---|---|
| ≤200 | 全量：节点卡片完整、边全量、悬停摘要完整、触发器 chip 最多 3 |
| 201–800 | 简化：节点卡片隐藏路径第二行、触发器 chip 最多 2、边不画箭头装饰；坐标/选择/命中不变 |
| >800 | 只渲染前 800（按 folder 前序 + path）；顶部“已截断”条；搜索/过滤只作用于已加载节点；不假装搜索全项目 |
| 边>2000 | 只画前 2000；其余边不画但 warnings/统计保留；悬停提示“边已截断” |

- 降级不改变布局算法、不改变节点坐标、不改变选择身份；只减少装饰/文本。
- 降级阈值是常量，不做设置项；05 不引入虚拟滚动库。
- 节点 800/边 2000 时，扫描/布局必须在 200ms 内完成（普通开发机，SSD，脚本平均 <10KB）；超过记 `scanMillis` 并在诊断里显示。
- 不允许前端“只请求一部分节点”再拼图；刷新只有全量快照。

## 统计与诊断

`GraphToolbar` 显示：

```text
N 脚本 · M 依赖 · F 文件夹 · I 无效
扫描 xx ms · 版本 vX · 有更新/已截断
```

- `stats.nodeCount/edgeCount/folderCount/invalidCount` 来自服务端真实计数，不是前端数组长度。
- `stats.warningCount` 是截断前总数；`warningsTruncated` 决定是否显示“还有 N 条”。
- `scanMillis` 是服务端 `ScriptIndexService.snapshot()` 的耗时；不把网络/渲染时间算进去。
- 诊断抽屉（04-06）显示：版本、上次扫描、节点/边/文件夹、warnings 分组、截断标记、扫描耗时。
- warnings 分组：
  - `invalid`：坏文件/meta/timeline；每条带 path/error。
  - `duplicate_id`：两个 path + id。
  - `dangling`：path + triggerIdentity + requirementIndex + target。
  - `self_reference`：path + triggerIdentity。
  - `unknown_trigger`：path + trigger type。
- 每条可“定位”：选中节点/边、居中、打开浮层；不可定位的只显示原文 + 复制。
- “复制全部”生成 JSON 数组，包含 kind/severity/path/message/identity/index；不复制节点全文。

## 后端性能

- `ScriptIndexService.snapshot()` 只做一次 walk + 读 JSON；不调用 `ScriptParser` 全解析，不构造运行时对象。
- 每个文件只读一次；`ScriptGraphService` 复用索引里的 `JsonObject`/元数据，不二次读文件。
- 扫描在请求线程执行；超过 200ms 记录慢日志（path 数、字节数、耗时）；不做异步任务/进度协议。
- 扫描结果缓存：`version` 不变且无失效 → `sinceVersion` 短路；缓存上限 1 份，不按项目分多份。
- 大项目降级在后端截断前完成统计；不先构造 10 万节点再截断。
- 不引入数据库/索引文件；内存索引足够。

## 验收标准

- 保存一个脚本：图收到一条 `invalidated kind=save`，可见时 150ms 后请求 `sinceVersion`；返回 `unchanged=false` 时只更新变化节点/边，视图/选中不跳。
- 图不可见时保存：只标 stale；进入项目页才请求；不后台轮询。
- 连续保存 5 次：合并成一次刷新；不 5 次全量重扫。
- 拖动节点时收到失效：延后到松手；拖动坐标不被打断。
- 刷新返回 `unchanged=true`：不重排、不重绘节点；只清 stale。
- 删除脚本：节点消失，选中清空；其他节点位置不变；不自动 fit。
- 外部直接改文件：图不自动变；手动刷新后更新；状态区显示上次扫描时间。
- 201 节点：卡片简化，坐标/命中/选择不变；200 节点边界不突变。
- 801 节点：只显示 800，顶部截断条；`stats.nodeCount=801`；搜索只作用已加载节点。
- 2001 条边：只画 2000；统计真实；诊断显示边截断。
- warnings 201 条：列表 200，计数 201，复制全部仍只有 200（或明确“仅已加载”）；不谎报完整。
- `scanMillis` 与手动秒表偏差合理；慢扫描有日志。
- `grep graph.patch`：0 命中；没有增量补丁协议。
- `grep setInterval`：图组件没有轮询刷新定时器。

## 刷新与规模约束

- 图刷新用全量快照 + `sinceVersion` 短路；不提供 `graph.patch` 增量协议。
- 外部改动手动刷新；不文件系统 watcher。
- 不后台定时轮询。
- 800 节点上限内全量渲染；不分页/虚拟滚动。
- warnings 只显示；失效节点/重复 id 不自动删除或修复。
- `scanMillis` 只表示服务端扫描耗时，不是前端渲染性能。
- 刷新请求同步完成；不进度条百分比/取消扫描。
