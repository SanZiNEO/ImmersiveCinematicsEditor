# 10-02 监听者与混音（AudioListenerAndMix）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（仅计划）
> 轮次：10-audio-color-media
> 关联：`01-AudioTrackPanel.md`、`03-ExternalAudioDecode.md`、`../01-baseline-schema/04-ScriptMetaPanel.md`、`../05-timeline-workspace/README.md`

## 1. 职责

把 `meta.listener`（player/camera）与它影响的听者锚点、全局暂停/恢复、多实例混音、一次性音效生命周期做成可读可控的界面。`meta.listener` 的写入口复用 01 的 meta 面板（同一命令）；本文件提供音频语义视图与混音说明，不新增字段。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| 监听者字段 | `J:script/schema/MetaSchemas.java:26` | `listener` enum `player/camera`，默认 player，section runtime |
| 控制器 | `J:script/AudioListenerController.java — shouldOverride（29-42）`、`isCameraListener（43-49）`、`getListenerPosition（50-59）`、`playerCamera（60-74）`、`cameraListener（75-89）`、`listenerMode（90-）` | 玩家/相机听者 |
| 相对锚点 | `J:script/AudioTrackPlayer.java — resolveAudioPosition（396-404）` | `relative` 锚点 = `AudioListenerController.getListenerPosition()` |
| music/ambient | `AudioTrackPlayer.java:326-343` | music 强制 relative+none+玩家位置；ambient 用位置/衰减 |
| 全局暂停 | `AudioTrackPlayer.java — pauseAll（219-226）`、`resumeAll（227-244）` | 每实例暂停/恢复 |
| 帧驱动暂停 | `J:script/ScriptPlayer.java — onRenderFrame（603-）`、`pauseAudio（-）`/`resumeAudio（-）` | 与游戏暂停/编辑器暂停相关 |
| 一次性音效 | `AudioTrackPlayer.java — playOneShot（245-266）`、`pruneOneShots（267-279）`、`stopOneShots（280-287）`、`oneShots（83）` | 不属任何 clip；随实例生命周期 |
| 一次性调用点 | `J:camera/rule/RuleActions.java:321` | 规则动作 `play_sound` → `playOneShot`（归 11） |
| 实例隔离 | `J:script/ScriptPlayer.java:182`（`oneShotHost`）、`J:camera/PlaybackInstance.java:50`（`player`） | 每播放实例一份 |
| 混音 | 原版 `SoundEngine`/`SoundManager`；`CinematicAudioInstance` 每 clip 一个实例 | 无自定义总线 |
| 旧编辑器 | `EDITOR:src/components/PropertyPanel.vue:4-18`（meta 全量） | 无监听者语义/混音说明 |

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| `meta.listener` | 通用下拉 | 二选一 + 锚点说明 + 跳 01 |
| 相对锚点 | 无 | 显示「玩家/相机」与影响范围 |
| 全局暂停 | 无 | 说明 `pauseAll/resumeAll` 与预览控制 |
| 多实例混音 | 无 | 说明每实例一份、音量叠加、无总线 |
| 一次性音效 | 无 | 说明 `playOneShot` 生命周期；编辑归 11 |
| 与规则 | 无 | 链接 11 的 `play_sound` |

### 3.2 拟新建（提案）

- `EDITOR:src/components/audio/ListenerMixPanel.vue`（提案）：监听者/混音说明。
- `EDITOR:src/components/audio/OneShotNote.vue`（提案）：一次性音效说明 + 链接 11。
- `EDITOR:src/lib/audioRouting.ts`（提案）：根据 `listener/category/position_mode` 推导「锚点/是否空间」的纯函数；**不**计算声学。

## 4. 输入输出与字段约束

**输入**：`meta.listener`、AUDIO 片段的 `category/position_mode/attenuation`、当前预览播放状态。

**输出**：`meta.listener` 的编辑（复用 01 的 meta 命令）；无其他写操作。

| 项 | 约束 |
|---|---|
| `listener` | `player/camera`；默认 player；脚本级 |
| 锚点 | `relative` 时 = 听者位置；`listener=camera` 时相机，`player` 时玩家 |
| music | 强制玩家位置（即使 `listener=camera`？以 `startClipInstance` 为准：music 用 `Minecraft.player.position()`，不随 listener 变） |
| ambient | `relative` 用听者（玩家/相机）；`absolute` 用世界点 |
| 暂停 | `pauseAll`/`resumeAll` 由播放/暂停驱动；一次性音效由 `stopOneShots` 单独处理 |
| 混音 | 每实例一份 `AudioTrackPlayer`；音量叠加；无自定义总线/限幅 |

**必须显示的边界**：

- `music` 的定位是玩家位置，**不**随 `listener=camera` 改变（`startClipInstance` 明确用 `player.position()`）。
- `ambient + relative` 才随 `listener` 改变锚点。
- `listener` 只影响声音听者，不影响相机渲染/画面。
- 多实例同时播放时声音叠加；没有「总音量」字段。
- 一次性音效不属任何 clip，不随片段结束停止；由 `pruneOneShots`/`onStop`/`stopOneShots` 管理。
- 规则 `play_sound` 的编辑归 11；本面板只解释音频侧生命周期。

## 5. 修改步骤

1. 新建 `audioRouting.ts`：输入 `{listener, category, positionMode}`，输出 `{anchor:'player'|'camera'|'world', spatial:boolean}`；与 `AudioTrackPlayer` 的语义一致。
2. 新建 `ListenerMixPanel`：`meta.listener` 二选一（写 01 的命令）；下方显示当前 AUDIO 片段的锚点/是否空间；链接 01 的 meta 面板。
3. 暂停/恢复说明：`pauseAll/resumeAll` 与预览 `pause/play` 的关系；不新增按钮（复用预览控制）。
4. 混音说明：每实例一份、叠加、无总线；不显示伪造的「主音量」滑杆。
5. 一次性音效：说明 `playOneShot` 生命周期 + 链接 11 的规则动作；不提供播放按钮。
6. meta.listener编辑留在文档级脚本属性/音频说明工具，复用01命令；当前AUDIO效果组可显示锚点说明并链接同一工具，不复制为片段字段或新的音频独占页。选择片段参数仍用clip.effects与独立快捷属性。
7. 保存后重载：`listener` 值一致；游戏内听者锚点与说明一致。

## 6. 禁止修改

- 不得改 `AudioListenerController` 的 `shouldOverride/isCameraListener/getListenerPosition`。
- 不得改 `AudioTrackPlayer` 的 music/ambient 定位规则。
- 不得新增 `master_volume`/`bus`/`ducking` 字段。
- 不得把 `listener` 做成全局设置（它是脚本字段）。
- 不得在前端播放/混合音频。
- 不得编辑规则 `play_sound`（归 11）。

## 7. 两分支承载

- **WebUI**：监听者/混音说明；`listener` 写走 01 命令。
- **游戏内Forge 1.20.1（14 迁移要求）**：14 实施时实现同meta.listener界面与真实状态，经公共端口消费听者结果；本轮 WebUI 跨 Forge/Fabric 正常，仅游戏内Fabric AUI暂缓，不构成本轮出口。
- 两分支的权威都是 `AudioListenerController` + `AudioTrackPlayer` + 原版 `SoundEngine`。

## 8. 前置

- 01：`meta.listener` 字段与 meta 面板写入口。
- 02：文档命令。
- 05：检查器/抽屉宿主。
- 11：规则 `play_sound`（链接目标）。

## 9. 验收

**正例**

- `listener=player`、ambient relative：锚点玩家；游戏内声音随玩家移动。
- 切 `listener=camera`：ambient relative 锚点变相机；music 仍跟随玩家（说明正确）。
- `listener=camera`、ambient absolute：锚点世界点，不随听者变。
- 暂停预览：`pauseAll` 停所有 clip 声音；恢复继续；一次性音效按 `stopOneShots` 规则处理（说明一致）。
- 两个脚本实例同时播放：声音叠加；无「总音量」控件。
- 规则 `play_sound`：链接 11；本面板不提供编辑。

**反例**

- 声称 music 随 `listener=camera` 变锚点 → 失败。
- 新增 `master_volume` 字段 → 失败。
- 把 `listener` 写成全局设置 → 失败。
- 前端混合音频 → 失败。
- 在本面板编辑规则动作 → 失败。
- 暂停时一次性音效行为与说明不符 → 失败。

## 10. 真实冒烟

1. 造 ambient relative 片段 + `listener=player`：玩家移动，声音随听者。
2. 切 `listener=camera`：相机移动，声音随相机；切回玩家恢复。
3. 造 music 片段：无论 listener，声音跟随玩家。
4. 暂停/恢复：clip 声音停/续；一次性音效按规则。
5. 两个实例：叠加；无总线。
6. 规则 `play_sound`：声音播放；生命周期与说明一致。

## 11. 完成定义

- `meta.listener` 可切换；锚点/空间语义与 `AudioTrackPlayer` 一致。
- music 不随 listener 变锚点的边界明确。
- 暂停/恢复、多实例混音、一次性音效生命周期可解释。
- 不新增字段；不做本地混音；规则动作归 11。
- 正例/反例/冒烟全部通过。
