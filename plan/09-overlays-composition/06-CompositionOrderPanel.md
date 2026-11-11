# 09-06 合成顺序面板（CompositionOrderPanel）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：09-overlays-composition
> 关联：`01-OverlayTrackSurface.md`、`05-LetterboxPanel.md`、`../08-camera-transitions/03-LaneCompositionPanel.md`、`../05-timeline-workspace/README.md`

## 1. 职责

把全屏层的合成顺序变成可读可调的界面：按 zIndex 升序列出 OVERLAY 层与 LETTERBOX，显示默认层建议、同值冲突、owner 生命周期；编辑 `z_index` 字段并跳转到片段。**不**处理 CAMERA lane 的 `dest/source/mask`（08-03）。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| 管理器 | `J:overlay/OverlayManager.java — render（43-65）`、`addLayer（66-76）`、`removeLayer（77-89）`、`getLayers（90-106）`、`update（107-131）`、`isAnimating（132-142）`、`isAnyAnimating（143-154）`、`startFadeOut（155-168）`、`removeLayersOf（169-187）`、`reset（188-）` | 按 zIndex 升序渲染 |
| 层接口 | `J:overlay/OverlayLayer.java` | `render（23）`、`isVisible（28）`、`getZIndex（38）`、`owner（47）`、`reset（53）`、`tick（61）`、`setTime（71）`、`startFadeOut（77）`、`isAnimating（83）`、`close（92）` |
| zIndex 建议 | `OverlayLayer.java:30-38`（javadoc） | 0 = 画幅层（LETTERBOX，内置常量、不在脚本口径内）；10 = 脚本层默认；10+ = 显式压层（如字幕 30、转场遮罩 200） |
| 默认 z | `J:overlay/CanvasTransform.java:38` | `DEFAULT_Z_INDEX = 10` |
| OVERLAY z 字段 | `J:script/schema/TrackSchemas.java:455` | `z_index` INT 默认 10 |
| LETTERBOX Z | `J:overlay/LetterboxLayer.java:21` | `Z_INDEX = 0`，固定 |
| 层创建/删除 | `J:script/OverlayTrackPlayer.java — onRenderFrame（62-97）`、`cleanupCurrentLayer（112-120）` | clip 切换建层/删层；`removeLayer` 调 `close` |
| 淡出 | `OverlayManager.startFadeOut（155-168）`、`removeLayersOf（169-187）` | 按 owner；`PlaybackLifecycle.deactivate（231-253）` 调 `startFadeOut` |
| 旧编辑器 | `EDITOR:src/components/Timeline.vue:166/178/191` | 只有色条/标签，无顺序 |

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 层列表 | 无 | 按 zIndex 升序（越小越底） |
| 默认层 | 无 | 0/10/30/200 建议 + 当前值 |
| 同值冲突 | 无 | 标注「同值，最终顺序由运行时插入实现决定」 |
| 编辑 z | 无 | 数字输入（OVERLAY）；LETTERBOX 固定 0 |
| 生命周期 | 无 | owner/close/startFadeOut 说明 |
| 跳转 | 无 | 点击跳到片段/字段 |
| 与 lane | 无 | 明确分工（全屏层 vs CAMERA lane） |

### 3.2 拟新建（提案）

- `EDITOR:src/components/overlay/CompositionOrderPanel.vue`（提案）：层列表 + 建议 + 冲突。
- `EDITOR:src/components/overlay/LayerOrderRow.vue`（提案）：单层行 + z 编辑 + 跳转。
- `EDITOR:src/lib/layerOrder.ts`（提案）：按 zIndex 排序、同值分组、默认层建议；**不**模拟 `OverlayManager` 的插入顺序。

## 4. 输入输出与字段约束

**输入**：当前时间活跃的 OVERLAY/LETTERBOX 片段及其 `z_index`、`layer_type`、`path`/`text` 摘要；LETTERBOX 固定 Z=0。

**输出**：对 OVERLAY `z_index` 的编辑意图；跳转到片段。

| 项 | 约束 |
|---|---|
| 排序 | zIndex 升序；越小越先绘制（越底） |
| `z_index` | INT 默认 10；OVERLAY 可编辑；LETTERBOX 不可编辑（固定 0） |
| 同值 | 分组显示；不承诺最终顺序（由 `OverlayManager.addLayer` 的插入实现决定） |
| 默认建议 | 0 遮幅、10 脚本默认、30 字幕、200 转场遮罩（`OverlayLayer` javadoc） |
| 生命周期 | 层由 `OverlayTrackPlayer` 创建/删除；`removeLayer` 调 `close`；`startFadeOut` 按 owner |
| 不活跃 | 当前时间无活跃 clip 的层不显示；不伪造「常驻层」 |

**必须显示的边界**：

- LETTERBOX 的 Z=0 是内置常量，不在脚本 `z_index` 口径内；不能编辑。
- 同 zIndex 的最终顺序由运行时插入实现决定；UI 只分组，不承诺。
- `z_index` 只影响全屏层；CAMERA lane 的顺序由片段顺序决定（08-03）。
- 层删除会 `close()` 释放资源（fade 的 shader、image 的纹理引用、video 的解码器）；UI 不持有资源。
- `startFadeOut` 是退出动画，不是删除；`removeLayersOf` 才移除。

## 5. 修改步骤

1. 新建 `layerOrder.ts`：输入活跃片段列表，输出按 zIndex 升序的行 + 同值分组 + 建议偏差。
2. 新建 `CompositionOrderPanel`：顶部「越小越底」说明 + 默认层建议；中部列表；底部生命周期说明。
3. `LayerOrderRow`：类型/来源/`z_index`/摘要；OVERLAY 可编辑 z，LETTERBOX 固定 0 并标注；点击跳片段。
4. 同值冲突：分组标题「z=10（3 层）」+ 说明「最终顺序由运行时插入实现决定」。
5. 在 05 的抽屉或检查器注册「合成顺序」页；选中 OVERLAY/LETTERBOX 时可见。
6. 与 08-03 互链：CAMERA lane 的顺序/遮罩跳 08-03；本页只管全屏层。
7. 不显示本地合成预览；真实画面来自 03。
8. 删除旧 `Timeline.vue` 中任何「轨道顺序 = 合成顺序」的文案。

## 6. 禁止修改

- 不得改 `OverlayManager` 的排序/插入/删除/淡出语义。
- 不得在前端模拟 `OverlayManager` 的同值插入顺序并写回。
- 不得让 LETTERBOX 的 Z 可编辑或参与脚本 `z_index`。
- 不得把 CAMERA lane 的 `dest/source/mask` 放进本页。
- 不得本地合成/渲染层预览。
- 不得新增 `z_index` 之外的顺序字段（如 `order`/`priority`）。

## 7. 两分支承载

- **WebUI**：层列表 + z 编辑 + 跳转；提交走 02 命令。
- **游戏内Forge 1.20.1（14 迁移要求）**：14 实施时实现同层顺序/生命周期面板，沿用主模组真实排序结果，不另造排序器；本轮 WebUI 跨 Forge/Fabric 正常，仅游戏内Fabric AUI暂缓，不构成本轮出口。
- 两分支的权威都是 `OverlayManager` + `OverlayLayer`。

## 8. 前置

- 01：OVERLAY `z_index` 字段。
- 05：抽屉/检查器宿主、片段选区。
- 06：异步属性控件（`z_index` 是 VALUE，不进关键帧）。
- 08-03：CAMERA lane 边界。
- 03：真实画面。

## 9. 验收

**正例**

- 三个 OVERLAY（z=10/30/200）+ LETTERBOX：列表顺序 0(LETTERBOX)→10→30→200；字幕在 30、转场遮罩在 200。
- 两个层同为 z=10：分组「z=10（2 层）」+ 说明「最终顺序由运行时决定」。
- 改 OVERLAY z 10→5：列表位置下移；游戏内层级变化。
- LETTERBOX 行 Z=0 不可编辑；点击跳 09-05。
- 当前时间无活跃层：列表空 + 「当前无活跃层」；不显示常驻假层。
- 点击层跳片段；返回列表同步。

**反例**

- 前端按同值插入顺序写回脚本 → 失败。
- LETTERBOX 的 Z 可编辑 → 失败。
- 把 CAMERA lane 放进本页 → 失败。
- 本地合成预览 → 失败。
- 新增 `order` 字段 → 失败。
- 无活跃层时显示「遮幅层常驻」→ 失败。

## 10. 真实冒烟

1. 造 OVERLAY fade（z=10）、subtitle（z=30）、image（z=200）+ LETTERBOX。
2. 游戏内：遮幅最底、fade 次之、字幕再上、image 最上；与列表一致。
3. 改 fade z=50：层级变化；与列表一致。
4. 两个 z=10：游戏内顺序由插入实现决定；UI 不承诺，观察一致。
5. 片段结束：层淡出/移除；列表不再显示。
6. 停止脚本：`reset` 清空；再次播放重建。

## 11. 完成定义

- 全屏层按 zIndex 升序可读；OVERLAY z 可编辑；LETTERBOX 固定 0。
- 同值冲突、默认层建议、生命周期都可解释；不承诺运行时插入顺序。
- 与 08-03 的 CAMERA lane 边界清晰，不重复字段。
- 不本地合成；真实画面来自游戏。
- 正例/反例/冒烟全部通过。
