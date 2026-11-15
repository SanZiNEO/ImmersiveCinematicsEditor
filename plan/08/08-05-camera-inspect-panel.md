# 08-05 镜头检查面板

## 目标

新增文档级 `camera.inspect` 面板，承载 lane 列表、连续性诊断、玩家移动预演和回放检查四个只读 tab。面板默认挂在 `document.drawer`，不复制属性值、不写脚本、不造第二个播放头。

## 插件

```text
src/plugins/core.camera-inspect/
  manifest.ts
  panels/CameraInspectPanel.vue
  panels/LaneInspectTab.vue
  panels/ContinuityTab.vue
  panels/PlayerMoveTab.vue
  panels/PlaybackTab.vue
```

manifest：

| 项 | 值 |
|---|---|
| `pluginId` | `core.camera-inspect` |
| `panelId` | `camera.inspect` |
| `defaultSlot` | `document.drawer` |
| `titleKey` | `panel.cameraInspect` |
| `minWidth` | 360 |
| `minHeight` | 240 |
| `closable` | true |
| `singleton` | true |
| `keepAlive` | true |
| `available` | `pageId==='document' && hasDoc` |

`builtin.ts` 增加一行 `coreCameraInspect`，顺序在 `core.selection-properties` 之后。04 的 `PanelHost`、布局树、drawer 内核不改；加这个面板不新增第二种面板宿主。

布局默认宽度 420 由 `document.drawer` 的默认布局给，不写进 manifest；manifest 只声明 `minWidth/minHeight`。

面板默认收起，由命令 `view.cameraInspect` 打开/聚焦；不自动抢占 `document.drawer` 的当前 tab。

## 外壳

```text
┌ 镜头检查 ─────────────────────────────────────────────┐
│ CAMERA 1 条 · lane 2 · 连续性 1 条提示 · 播放头 4.20s │
│ [Lane] [连续性] [玩家移动] [回放]                     │
├───────────────────────────────────────────────────────┤
│ tab 内容                                              │
│                                                       │
│ 只读视图；值编辑回属性/效果面板                       │
└───────────────────────────────────────────────────────┘
```

- 标题右侧显示当前文档名与 CAMERA 轨道数量；无 CAMERA 轨道显示“无 CAMERA 轨道”。
- tab 状态存 session，按 `panelId` 保留；切页/重开面板恢复上次 tab。
- 顶部时间显示“跟随主时间轴：4.20s”，不提供独立时间输入。
- 面板滚动在内容区；标题/tab 固定。
- 窄宽度 <480 时，lane 表折叠为卡片行；不横向滚动整页。

## 数据来源

`CameraInspectPanel` 只用：

```text
PanelContext.selection        当前选区
PanelContext.docRevision      文档修订号
PanelContext.commands         03 文档命令（只用于定位/打开，不写值）
PanelContext.services         TimelineApi（含只读播放头）/ DocumentApi / StatusApi
PanelContext.requestSelect    选中片段
PanelContext.requestFocus     聚焦属性/效果面板
PanelContext.requestRevealInEffectControls  定位已有关键帧
```

- 播放头由 `core.timeline` 的 `TimelineApi` 提供；08 只调用 `getPlayheadTime()` / `subscribePlayhead()` 只读接口，`seek` 仍由主时间轴或回放检查发；不创建第二个时钟。
- `TimelineApi` 的这两个只读方法由主时间轴实现，播放头所有权、写入路径和生命周期不变；08 不新增第二个播放头服务。
- 文档轨道/片段从 `DocumentApi` 取只读快照；不直接读 store。
- `docRevision` 变化时重建 `LaneViewSet`、连续性诊断、玩家目标、回放状态摘要；不缓存跨 revision 的数组。
- 播放头变化只重建派生视图；不产生文档 revision，不进撤销栈。
- `selection` 变化只影响“当前片段”高亮和定位按钮，不改变 tab 内容的数据源。

## Lane tab

```text
播放头 4.20s    lane 2    轨道顺序：下 → 上
┌──┬──────────────────┬────────┬──────────────┬──────────────┐
│# │ 来源片段          │ 角色   │ 区间          │ 合成摘要      │
├──┼──────────────────┼────────┼──────────────┼──────────────┤
│0 │ shot_A           │ single │ 2.00–5.00     │ 1.0 / 全屏     │
│1 │ shot_B           │ crossfade│ 4.00–7.00    │ 0→1 / 全屏     │
└──┴──────────────────┴────────┴──────────────┴──────────────┘
重叠区 4.00–5.00；B 在重叠区从 0 淡入到 1
```

列：

| 列 | 内容 | 交互 |
|---|---|---|
| `#` | `order`，从 0 开始 | 无 |
| 来源 | `clip.name` + 轨道序号 | 点击选中该片段 |
| 角色 | `single` / `morph` / `crossfade`；`top` 是层级徽标，不是角色 | `morph` 显示 `prev → next`；`crossfade` 显示 `A → B 淡入` |
| 区间 | lane 的 `start–end`；`morph` 显示参数过渡窗口；`crossfade` 额外显示重叠区 | 不拖拽 |
| 合成 | opacity / dest / source / mask / dimension 摘要 | 点击“属性”定位；动画字段点击“效果”定位 |
| 调色 | `colorOwner` 片段名 + 调色徽标 | 点击选中该片段 |
| 标记 | `suppress` / `target_runtime` / `animated` | 悬停显示说明 |

- 行高亮：当前选区片段对应的 lane 有左侧标记；`top` lane 用“顶层”徽标，不改颜色层级。
- 叠化两行：A 行角色 `single`、合成 `opacity=1`；B 行角色 `crossfade`、合成 `opacity 0→1`、调色归属 B。B 行额外显示重叠区 `[B.start_time, A.end)`。
- 点击行只选中片段；不创建 lane 选区、不把 lane 变成文档对象。
- “属性”按钮：`requestSelect({kind:'clip', clipKey})` + `requestFocus('selection.properties')`；不自动滚动到具体行。
- “效果”按钮：有动画摘要时 `requestRevealInEffectControls({clipKey,objectPath})`；没有动画不显示。
- 空态：
  - 无 CAMERA 轨道：`无 CAMERA 轨道` + “打开主时间轴添加”。
  - 播放头在间隙：`当前播放头无活跃镜头片段`。
  - morph 但无下一片段：`末尾片段不产生参数过渡 lane`。
  - 叠化结构不完整：`当前重叠不满足叠化，按普通多 lane 显示`。
- 脚注固定显示覆盖链说明，来源 `laneCoverChain.ts`；不显示伪 winner。
- lane 表不显示具体相机位置/角度/画面；这些由回放 tab 的真实画面承担。
- `camera.inspect` 不提供转场编辑 tab、不提供“应用叠化/参数过渡”按钮；转场编辑只在独立 `transition.panel`，本面板只读显示 lane 结果。

## 定位与选区

- `requestSelect` 的目标是片段，不是 lane；选择后属性/效果面板按 06 正常显示。
- 定位不修改 `selection` 的剪贴板/批选；只发单选。
- 定位到属性面板只聚焦面板，不强行展开某个组；作者自己展开。
- 定位到效果面板只在动画字段存在时可用；不伪造节点。
- 面板内不提供“编辑 lane”，不提供“添加 lane”，不提供“保存 lane 快照”。

## tab 摘要

| tab | 数据来源 | 空态 | 计数徽标 |
|---|---|---|---|
| Lane | `LaneViewSet` | 无轨道/间隙 | lane 数 |
| 连续性 | 08-06 诊断 | 无 CAMERA/无元字段 | warning/error 数 |
| 玩家移动 | 08-07 目标列表 | 无 EVENT/无 Position | 目标数 |
| 回放 | 08-08 状态 | 未连接/未推送 | `idle/pushing/playing/paused/error` |

- 计数徽标只显示当前 tab 的真实数量；0 时不显示。
- tab 切换不触发网络请求；回放 tab 只有在打开时才订阅 `playback.state`。

## 命令

| commandId | 标题 | 启用 | 行为 |
|---|---|---|---|
| `view.cameraInspect` | 镜头检查 | 有文档 | 打开/聚焦 `camera.inspect`，默认 Lane tab |
| `camera.inspect.revealClip` | 在镜头检查中定位片段 | 有 CAMERA 片段选中 | 切到 Lane tab，选中该片段行 |
| `camera.inspect.openPlayback` | 打开回放检查 | 有文档 | 切到回放 tab；不自动推送 |

- 命令不直接改文档；`revealClip` 只发 `requestSelect`/tab 切换。
- 命令出现在命令面板；`enabled` 原因可见。
- 不注册第二个“打开 lane 面板”命令，避免多个入口指向不同状态。

## 组件

```text
src/plugins/core.camera-inspect/
  manifest.ts
  panels/CameraInspectPanel.vue      外壳/tab/计数
  panels/LaneInspectTab.vue          Lane tab
src/components/camera/
  LaneTable.vue                      复用 08-04 的行表
  LaneRow.vue
  LaneCompositeSummary.vue
  LaneCoverChainNote.vue
```

- 面板组件只 import `@workbench/api`、08 的 `src/camera/*` / `src/components/camera/*`；不 import 文档 store、不 import 另一个面板组件。
- `LaneTable` 行数据来自 `laneViewModel`；不直接读运行时 `CameraLane`。
- 面板不渲染像素、不采样属性曲线；动画摘要只显示“动画 N 帧”。

## 验收

1. `builtin.ts` 加载后注册表出现 `core.camera-inspect` / `camera.inspect`；重复 ID、缺依赖、坏 manifest 启动报错。
2. 文档页打开 `view.cameraInspect`：drawer 出现“镜头检查”；默认 Lane tab；不抢占其他 drawer tab。
3. 无 CAMERA 轨道：Lane tab 显示“无 CAMERA 轨道”；不伪造 lane 行。
4. 单片段播放头在区间：Lane tab 1 行；来源、区间、`single/top` 正确。
5. 重叠两片段：2 行；顺序按轨道数组；`top` 在最后一行；点击第二行选中对应片段。
6. morph 窗口：1 行；角色 `morph`；显示 `prev → next`；合成/调色来源为 `next`。
7. 叠化 A 0–6、B 3–7，重叠区 3–6：2 行；A 角色 `single`、`opacity=1`；B 角色 `crossfade`、显示 `A → B 淡入`、`opacity 0→1`、重叠区 3.00–6.00；调色归属各自己的片段；A 的 `transition` 不需要是 `cut`。
8. 播放头在间隙：`lanes=0`；显示“当前播放头无活跃镜头片段”；不保留上一帧 lane。
9. 选中片段变化：对应 lane 行左侧标记更新；tab 数据不因选区变化重算。
10. “属性”按钮：选中片段 + 聚焦属性面板；不修改字段、不展开组。
11. “效果”按钮：仅动画摘要出现；`requestRevealInEffectControls` 目标为 `{clipKey,objectPath}`，不携带值。
12. 播放头拖动：lane 表按 16ms 节流重建；文档 revision 不变；撤销栈不增长。
13. 切换 tab/关闭重开：保留上次 tab；不保留“加载中”假状态。
14. 面板只读：没有值输入、没有关键帧控件、没有保存 lane 按钮；`grep lane` 在序列化输出 0 命中。
15. 窄宽度 360–480：lane 表变卡片行；不横向滚动整页；标题/tab 仍可见。
16. 覆盖链脚注显示 400/300/200/100 与“Modifier 不作用 lane 快照”；不伪造 winner。
17. 叠化 + morph 同交界：morph 窗口内 1 行 `morph` 并显示 `crossfade_shadowed_by_morph` note；窗口外 2 行 `single/crossfade`；本面板没有转场编辑控件。
