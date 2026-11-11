# 08-06 取景直控（FramingDirectControl）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：08-camera-transitions
> 关联：`01-CameraTrackSurface.md`、`../12-templates-flight-tools/README.md`、`../03-host-transport/README.md`、`../14-aui-forge-migration/README.md`

## 1. 职责

在编辑器预览上提供「取景」能力：进入直控后用预览通道接管相机，设置位置与角度/视场，读回当前值，退出恢复脚本播放。直控**不写脚本**；它服务于「先站到某个机位看构图，再决定关键帧」。飞控（12）是另一套交互，二者互斥。取景的目标属性/节点来自**片段效果控件（`clip.effects`）的共享 Selection**；主时间轴只提供片段选择，不因取景而展开对象行或关键帧。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| 直控入口（消息） | `J:webui/WebEditorApi.java:75-78`（`editor.setCamera`）、`handleSetCamera（289-295）` | 只接受 yaw/pitch/roll/fov/zoom，**无位置** |
| 预览通道 | `J:camera/PreviewChannel.java — setPreviewDirectControl（100-114）`、`pushScript（115-126）`、`applyPreviewScript（127-154）`、`setTime（155-175）`、`resume（176-194）`、`pause（195-199）`、`stop（200-211）`、`exitPreview（212-）` | 编辑器播放的时钟源 |
| 相机管理器转发 | `J:camera/CameraManager.java:182-190`（`pushScript`/`setTime`/`resume`/`pause`/`stop`/`exitPreview`/`setPreviewDirectControl`） | |
| 直控写入 | `CameraManager.java — setCameraDirect（303-309）`、`setCameraDirect（310-318）` | 第二个重载含 `Vec3 position` |
| 直控判定 | `CameraManager.java — isDirectControlWinner（299-302）`、`getActiveBaseProvider（282-298）` | Base 优先级 200 |
| 覆盖链 | `J:camera/cover/CameraCoverChain.java — register/unregister（46-71）`、`evaluate（83-99）` | 直控是 Base provider |
| 预览直控状态 | `PreviewChannel.java:46`（`previewDirectControl`）、`isPreviewDirectControl（-）` | 与编辑器播放实例分开 |
| 预览画面 | `J:webui/WebEditorApi.java:299-312`（`handlePreviewConfig`） | 固定 1920×1080@60；`PreviewStreamer` |
| 飞控 | `J:webui/WebEditorApi.java:85-87`（`editor.enter_flight_mode`/`exit_flight_mode`/`cancel_flight_mode`） | 归 12 |
| 旧编辑器 | `EDITOR:src/components/Preview.vue:3`（`flightMode`、`sendPreviewConfig`）、`:308`（`sendPreviewConfig`） | 无直控面板；飞控按钮已有 |

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 直控开关 | 无 UI（只有 store 的 `flightMode`） | 预览上方「取景」按钮，明确状态 |
| 参数 | `editor.setCamera` 只有角度 | 角度 + 位置；读回当前相机状态 |
| 位置 | 不支持 | 需要协议扩展或复用现有 `setCameraDirect` 重载（见 §4） |
| 与飞控 | 飞控独立 | 互斥：进入一个时退出另一个 |
| 与脚本 | 直控不写脚本 | 明确「取景值不保存到文档」 |
| 退出 | 无 | 恢复 `pushScript`/`setTime` 的脚本态 |
| 与效果控件 | 无关系 | 取景的目标属性/节点通过共享 Selection 在 `clip.effects` 行上选定；结束后在该行给出结果提示，不要求主时间轴展开 |

### 3.2 协议缺口与提案

`handleSetCamera` 当前只读 `yaw/pitch/roll/fov/zoom`（`WebEditorApi.java:289-295`），而 `CameraManager.setCameraDirect(Vec3, float, float, float, float, float)` 已存在（`:310-318`）。两条路：

| 方案 | 做法 | 代价 |
|---|---|---|
| **A（推荐）** | 扩展 `editor.setCamera` 的可选字段 `x/y/z`（缺省 = 不改位置），服务端调用带位置的重载 | 主模组一行分支；消息形状向后兼容 |
| B | 新增 `editor.setCameraPose` | 新消息；03 要加路由；两套语义 |
| C | 前端只发角度，位置靠飞控 | 无法静态取景；与目标不符 |

本轮按 **A** 写合同：`editor.setCamera` 增加可选 `x/y/z`（有限数，世界坐标）；缺省不改位置。在 A 落地前，UI 只提供角度直控，位置控件禁用并标注「需协议扩展」；**不得**假装已支持位置。

## 4. 输入输出与字段约束

**输入**：用户输入的位置 `(x,y,z)`、`yaw/pitch/roll`（度）、`fov`、`zoom`；当前相机状态（从 `CameraManager.getCameraState()` 经 03 回执，若可用）。

**输出**：`editor.setCamera` 请求（现有字段 + 提案的可选 `x/y/z`）；不写文档、不进历史。

| 字段 | 约束 |
|---|---|
| `yaw/pitch/roll` | 度；`yaw` 归一化到 [-180,180] 或 [0,360) 由 UI 显示决定，发原值 |
| `fov` | 默认 70；有限数 |
| `zoom` | 默认 1；>0 |
| `x/y/z` | 世界坐标；有限数；仅方案 A 落地后可用 |
| 直控状态 | `previewDirectControl`；进入时暂停脚本播放（或保持暂停），退出时恢复 |
| 飞控互斥 | `flightMode=true` 时禁用直控；进入直控时先 `exit_flight_mode` |

**必须显示的边界**：

- 直控是 Base provider（优先级 200），会覆盖脚本相机（100），但不改脚本。
- 直控期间 `editor.seek/play/pause/stop` 的语义：seek/play 会退出直控或与直控冲突；UI 必须先退出直控再播放（或明确提示）。
- 预览画面固定 1920×1080@60（`handlePreviewConfig` 注释），直控不改变编码尺寸。
- 位置直控在方案 A 落地前不可用；按钮禁用 + 文案。
- 取景本身不新增属性面板：目标叶子在 `clip.effects` 中保持选中/高亮；`selection.properties` 只显示同一选择的摘要与「去效果控件」定位。主时间轴不带任何取景节点或对象行。
- 直控读回/显示的状态是宿主回执，不写进文档，也不进撤销栈。

## 5. 修改步骤

1. 在 `Preview.vue` 上方增加「取景」按钮与状态徽标；进入时调用 `setPreviewDirectControl(true)`（经 03 的现有消息/转发）。
2. 新建 `EDITOR:src/components/preview/FramingPanel.vue`（提案）：位置/角度/视场/缩放输入；「读回当前」按钮；「退出取景」。
3. 进入直控：先 `exit_flight_mode`（若在飞控），再 `setPreviewDirectControl(true)`；暂停脚本播放。
4. 角度/视场/缩放改动 → 发 `editor.setCamera`（现有字段）。
5. 位置输入：方案 A 落地后发 `x/y/z`；未落地时禁用并显示「需协议扩展（08-06 §3.2）」。
6. 退出：`setPreviewDirectControl(false)`；恢复 `pushScript` + `setTime` 到当前播放头；不清文档、不进历史。
7. 与 12 的飞控：在 store 里加互斥断言（进入一个前退出另一个）；飞控按钮在直控态禁用，反之亦然。
8. 读回：若 03 提供 `CameraManager.getCameraState()` 回执，填充输入；没有则显示「未知」。
9. 删除旧 `Preview.vue` 中任何「直控值写回片段」的隐藏路径（若有）。
10. 目标定位：进入/退出取景都从共享 Selection 读 `clipKey + objectPath`（片段来自主时间轴或 `clip.effects`，属性/节点只来自 `clip.effects` 行）；退出后在对应行显示「直控值未写入文档」的提示，不新增面板、不在主时间轴放节点。

## 6. 禁止修改

- 不得把直控值写入文档/历史/脚本。
- 不得在前端模拟相机矩阵或本地渲染预览。
- 不得改 `PreviewChannel`/`CameraManager` 的直控语义或 Base 优先级。
- 不得把直控与飞控合并成一个状态机（12 拥有飞控）。
- 不得在方案 A 未落地时声称位置直控可用。
- 不得新增 `editor.*` 消息（除方案 A 的字段扩展合同）。
- 不得为取景新建"相机属性面板"或要求主时间轴展开属性行/关键帧；目标只在 `clip.effects` 行上定位。

## 7. 两分支承载

- **WebUI**：直控 UI + 现有 `editor.setCamera`；位置字段等协议扩展。
- **游戏内Forge 1.20.1（14 迁移要求）**：14 实施时交付同义直控UI并通过03稳定公共控制端口执行，不能直接依赖CameraManager内部方法；位置控制所需接口前置真实闭合，不以骨架为由只交合同。本轮 WebUI 跨 Forge/Fabric 不受 AUI 故障影响，不构成本轮出口。
- 两分支共用「直控是 Base provider、不写脚本」的语义。

## 8. 前置

- 03：`editor.setCamera` 路由与回执；`editor.previewConfig`；直控状态消息（若有）。
- 12：飞控入口与互斥约定。
- 01：相机字段（用于「从当前取景创建关键帧」的后续动作，不在本文件实现）。
- 13：Forge 进程内直控的实证。

## 9. 验收

**正例**

- 点击「取景」：脚本暂停，预览由直控接管；改 yaw/pitch/fov，画面实时变化；退出后回到脚本播放头，文档未变脏。
- 飞控中点击「取景」：先退出飞控，再进入直控；两个按钮不会同时激活。
- 方案 A 落地后：输入位置 `(100,64,200)`，相机移到该点；退出后脚本相机恢复。
- 方案 A 未落地：位置输入禁用，提示「需协议扩展」；角度仍可用。
- 读回：进入直控时输入框显示当前 `yaw/pitch/roll/fov/zoom`；无回执时显示「未知」。
- 从 `clip.effects` 的 `position.x` 行进入取景：该行保持高亮，退出后行内显示「直控值未写入」；其他已展开组仍在，主时间轴片段高度不变。

**反例**

- 直控后文档出现未保存修改 → 失败。
- 直控值进入撤销栈 → 失败。
- 直控与飞控同时激活 → 失败。
- 本地渲染一张「预览图」冒充真实画面 → 失败。
- 方案 A 未落地却允许输入位置并假装生效 → 失败。
- 退出直控后播放头跳到 0 → 失败（应恢复进入前位置）。
- 为显示取景目标而在主时间轴展开属性行/节点，或新建专用相机面板 → 失败。

## 10. 真实冒烟

1. 打开一个 CAMERA 脚本，播放到 3s，暂停。
2. 进入取景：改 yaw 30°、pitch -10°、fov 50；画面变化；文档脏标记不变。
3. 退出取景：画面回到脚本 3s 的相机；继续播放正常。
4. 进入飞控再点取景：飞控退出，直控进入；反向同理。
5. 方案 A 落地后：设位置 `(0,70,0)`，画面从该点看；退出恢复。
6. 关闭预览/断连：直控状态清理，不残留输入捕获。

## 11. 完成定义

- 直控可进入/退出，状态可见；不写文档、不进历史。
- 角度/视场/缩放可用；位置在协议扩展后可用，未扩展时明确禁用。
- 与飞控互斥；与脚本播放的切换不丢播放头。
- 预览画面始终来自真实游戏帧；不本地渲染。
- 取景目标定位只走共享 Selection + `clip.effects` 行；主时间轴无对象行/节点，快捷属性无第二套时间轴。
- 正例/反例/冒烟全部通过；位置直控的协议状态如实标注。
