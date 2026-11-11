# 10-01 音频轨道面板（AudioTrackPanel）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：10-audio-color-media
> 关联：`02-AudioListenerAndMix.md`、`03-ExternalAudioDecode.md`、`07-MediaResourceDrawer.md`、`../06-async-objects/README.md`

## 1. 职责

编辑 AUDIO 片段的全部字段：`sound`、`source`、`category`、`position_mode`、`attenuation`、`volume/x/y/z`、`pitch`、`file_loop`、`fade_in/out`；把 `music` 与 `ambient` 的语义差异、`fade` 超时长、`sound` 缺失在提交前呈现。不实现监听者（02）、外部解码（03）、视频音轨（04）。

承载按[C17](../shared/effect-controls-workspace.md)：AUDIO片段在主轴只编排，在clip.effects中显示音源/播放/空间等适用组。AudioTrackPanel是嵌入组的专门字段组件，不是05新注册的独占音频页；volume/x/y/z各自节点使用06共享局部标尺，其他已展开参数组保持可见。快捷属性复用同一值控件/目标解析，不能添加PR音频效果或本地播放器。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| AUDIO 对象表 | `J:script/schema/TrackSchemas.java — audioObjects（358-379）` | 4 个 ANIMATED + 9 个 VALUE |
| 轨道装配 | `TrackSchemas.java — audio（53）`、`PLAY_CONTROL（84）` | `TrackTypeSchema(objects, PLAY_CONTROL)` |
| 动画字段 | `TrackSchemas.java:360-363` | `volume/x/y/z` ANIMATED/LINEAR，默认 1/0/0/0 |
| 声音 | `TrackSchemas.java:365` | `sound` STRING required |
| 源 | `TrackSchemas.java:366-367` | `source` enum `file/minecraft`，默认 file |
| 音高 | `TrackSchemas.java:368` | `pitch` 默认 1 |
| 循环 | `TrackSchemas.java:369` | `file_loop` 默认 false |
| 淡入淡出 | `TrackSchemas.java:370-371` | `fade_in/fade_out` 默认 0，min 0 |
| 衰减 | `TrackSchemas.java:372-373` | `attenuation` enum `none/linear`，默认 linear |
| 位置模式 | `TrackSchemas.java:374-375` | `position_mode` enum `relative/absolute`，默认 relative |
| 类别 | `TrackSchemas.java:376-377` | `category` enum `music/ambient`，默认 music |
| 驱动 | `J:script/AudioTrackPlayer.java — onRenderFrame（109-173）`、`startClipInstance（288-360）`、`updateClipInstance（361-380）`、`fadeEnvelope（381-395）`、`resolveAudioPosition（396-404）` | 三模式语义 |
| 类别解析 | `AudioTrackPlayer.java — parseCategory（444-450）` | `ambient` 才 AMBIENT，其余归 MUSIC |
| music 语义 | `AudioTrackPlayer.java:326-334` | `setRelative(true)` + `setAttenuation("none")` + 玩家位置 |
| ambient 语义 | `AudioTrackPlayer.java:335-343` | `setAttenuation(attenuation)` + `resolveAudioPosition(position_mode, offset)` |
| fade 超时长 | `AudioTrackPlayer.java:305-311` | 整 clip 跳过 + warn |
| 校验 | `J:script/object/ObjectValidator.java — checkAudio（722-736）` | `fade_in + fade_out > duration` 报错 |
| 旧编辑器 | `EDITOR:src/components/ClipPanel.vue:8-20` | 通用表单；无三模式语义 |

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| `source` | 文本 | `file/minecraft` 二选一 + 路径/注册名提示 |
| `category` | 文本 | `music/ambient` + 语义说明 |
| `position_mode` | 文本 | `relative/absolute`；music 下置灰 |
| `attenuation` | 文本 | `none/linear`；music 下置灰 |
| `volume/x/y/z` | 数字框 | 动画属性控件（06） |
| `pitch` | 数字框 | 0.5–2 提示（以运行时为准，不硬 clamp） |
| `file_loop` | 布尔 | 布尔 + 与片段循环的区别 |
| `fade_in/out` | 数字框 | 时间轴/条带可视化 + 超时长红条 |
| `sound` | 文本 | 资源/注册表选择 + 缺失提示 |

### 3.2 拟新建（提案）

- EDITOR:src/components/audio/AudioTrackPanel.vue（提案）：片段效果控件中音频组的内部组合组件，不单独注册audio页或第二节点轴。
- `EDITOR:src/components/audio/AudioModeGroup.vue`（提案）：`source/category/position_mode/attenuation` 组合。
- `EDITOR:src/components/audio/AudioFadeBar.vue`（提案）：`fade_in/out` 与片段时长。
- `EDITOR:src/lib/audioSemantics.ts`（提案）：`music/ambient` 的有效字段判定与提示；**不**计算音频。

## 4. 输入输出与字段约束

**输入**：当前AUDIO片段clipKey与只读对象、schema.tracks.AUDIO.objects、02共享Selection/局部时间和真实资源/注册表回执。

**输出**：沿同一02命令的叶子编辑/sound选择意图与fade专门示意；不持有另一份文档、选择或节点视口。

| 字段 | 约束 |
|---|---|
| `sound` | 必填；`source=file` 时是资源相对路径（ogg/wav/外部格式）；`source=minecraft` 时是声音注册 id |
| `source` | `file/minecraft`；默认 file |
| `category` | `music/ambient`；music = 非空间背景音；ambient = 空间环境音 |
| `position_mode` | `relative/absolute`；仅 ambient 有效；relative 锚点 = 听者（玩家/相机，见 02） |
| `attenuation` | `none/linear`；仅 ambient 有效 |
| `volume` | ANIMATED；默认 1 |
| `x/y/z` | ANIMATED；默认 0；relative 时是听者偏移，absolute 时是世界坐标 |
| `pitch` | 默认 1；运行时交给 `SoundInstance`，UI 不做硬 clamp |
| `file_loop` | 默认 false；文件级循环，不是片段循环 |
| `fade_in/fade_out` | ≥0；`fade_out` 覆盖 `fade_in`；`fade_in+fade_out > duration` 时整 clip 跳过 |

**必须显示的边界**：

- `category=music`：`position_mode`/`attenuation`/`x/y/z` 被运行时忽略（强制 relative + none + 玩家位置）；UI 置灰并说明。
- `category=ambient`：`position_mode`/`attenuation` 生效；relative 锚点 = `AudioListenerController.getListenerPosition`（玩家或相机）。
- `source=minecraft`：`sound` 是注册 id；`file_loop`/外部格式不适用（以 `CinematicAudioInstance.decode` 为准）。
- `fade_in+fade_out > duration`：运行时跳过整个 clip；UI 红条 + 文案。
- 片段 `loop`（`playControl`）与 `file_loop` 不同层：前者重复片段，后者循环文件。
- `pitch` 的极端值可能被原版钳制；UI 不承诺。

## 5. 修改步骤

1. 新建 `audioSemantics.ts`：输入 `category/position_mode/attenuation/source`，输出「有效/被忽略」与原因。
2. 新建 `AudioTrackPanel`：顶部 `sound`（资源选择/注册表补全/路径输入）+ `source`；中部 `AudioModeGroup`；下部 `volume/x/y/z`（06 控件）、`pitch`、`file_loop`、`AudioFadeBar`。
3. `AudioModeGroup`：`category=music` 时置灰 `position_mode/attenuation/x/y/z`，显示「music 强制非空间」；`ambient` 时启用并显示 relative 锚点说明（链接 02）。
4. `AudioFadeBar`：以片段时长为宽度画 `fade_in/out` 条带；超时长红条 + 文案「运行时跳过该 clip」。
5. `sound` 缺失/路径不存在：红条；`source=minecraft` 时用 `registry.query(kind=sound)` 校验注册 id（若宿主提供）。
6. 在clip.effects注册AUDIO适用组并挂上述组件，选中AUDIO片段显示完整组而非切到独占音频页；节点/参数与其他展开组同行，快捷属性只提供常用参数/定位。
7. 删除旧 `ClipPanel` 对 AUDIO 的通用分支；迁移调用方。
8. 保存后重载：字段逐值一致；游戏内发声/位置/衰减与 UI 一致。

## 6. 禁止修改

- 不得改 `audioObjects()` 的字段名/默认值/枚举。
- 不得改 `AudioTrackPlayer` 的 music/ambient 强制语义。
- 不得把 `music` 下的 `position_mode/attenuation` 写成「生效」。
- 不得把 `file_loop` 与片段 `loop` 混为一个控件。
- 不得在前端解码/播放音频或画波形。
- 不得新增音频字段（如 `loop_count`/`audio_offset`）。

## 7. 两分支承载

- **WebUI**：效果控件音频组+原三模式语义；共用值/节点命令，主轴只有音频片段。
- **游戏内Forge 1.20.1（14 迁移要求）**：14 实施时实现同音频字段面板与公共端口联动，不重写播放/混音；本轮 WebUI 跨 Forge/Fabric 正常，仅游戏内Fabric AUI暂缓，不构成本轮出口。
- 两分支的权威都是 `AudioTrackPlayer` + `CinematicAudioInstance`。

## 8. 前置

- 01：`audio.objects` schema。
- 02：对象叶子路径 + 原子提交。
- 05：检查器宿主。
- 06：异步属性控件（`volume/x/y/z`）。
- 07：资源抽屉（`sound` 选择）。
- 09：视频层边界（视频音轨归 04）。

## 9. 验收

**正例**

- `category=music`：`position_mode/attenuation/x/y/z` 置灰；游戏内声音非空间、跟随玩家。
- `category=ambient`、`position_mode=relative`、`attenuation=linear`、`x=10`：游戏内声音在听者 +10 处、随距离衰减；`listener=camera` 时锚点变相机。
- `position_mode=absolute`、`x/y/z=(100,64,200)`：声音在世界点。
- `fade_in=1`、`fade_out=1`、`duration=5`：条带正确；游戏内渐入渐出。
- `fade_in=3`、`fade_out=3`、`duration=5`：红条；游戏内整 clip 跳过；与 `ObjectValidator` 一致。
- `source=minecraft`、`sound=minecraft:block.note_block.pling`：注册 id 有效；`file_loop` 置灰。
- `file_loop=true`：文件循环；片段 `loop` 仍独立。

**反例**

- music 下允许编辑 `position_mode` 并声称生效 → 失败。
- 把 `file_loop` 当片段循环 → 失败。
- fade 超时长仍显示「正常」→ 失败。
- 前端播放音频/画波形 → 失败。
- 新增 `audio_offset` 字段 → 失败。
- `sound` 缺失仍允许保存且无提示 → 失败。

## 10. 真实冒烟

1. 造 music 片段（`sound` 文件、volume 1、fade 1/1）：游戏内非空间播放、渐入渐出。
2. 造 ambient 片段（relative、linear、x=10）：游戏内从听者 +10 处发声、衰减。
3. 切 `meta.listener=camera`：ambient 锚点变相机；music 不变。
4. 造 fade 超时长：编辑器红条；游戏内跳过；`/icinematics validate` 报错一致。
5. 造 `source=minecraft`：注册声音播放；`file_loop` 置灰。
6. 造 absolute 片段：世界点发声；移动玩家听感正确。

## 11. 完成定义

- AUDIO 全部字段可编辑；三模式语义与 `AudioTrackPlayer` 一致。
- 音频组可与同片段其他适用组同时展开，左右行对齐，快捷属性同值同步；主轴无属性节点，专门组件不另建独占页。
- music 下无效控件置灰；ambient 的 relative 锚点可解释。
- fade 超时长、`sound` 缺失、`source` 差异都有提示。
- 不新增字段；不做本地音频播放/波形。
- 正例/反例/冒烟全部通过。
