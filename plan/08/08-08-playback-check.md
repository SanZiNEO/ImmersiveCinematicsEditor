# 08-08 回放检查

## 目标

把“写脚本 → 推给游戏 → 游戏播放结果”做成一个可操作闭环：

```text
当前文档
  → 本地校验 + script.validate
  → serializeDoc 完整 JSON
  → editor.pushScript
  → editor.seek（当前主时间轴播放头）
  → editor.play / pause / stop
  → playback.state 回执
  → 游戏预览画面显示真实结果
```

08 不新增消息、不做本地渲染、不做带位置直控、不改模组 `.java`。

## 消息面

只使用现有消息：

| 方向 | type | data | 用途 |
|---|---|---|---|
| C→S | `script.validate` | `{ doc: object }` | 服务端校验完整脚本 |
| S→C | `script.validate.result` | `{ ok: boolean, issues: string[] }` | 校验结果 |
| C→S | `editor.pushScript` | `{ script: string }` | 推送完整脚本 JSON 字符串 |
| C→S | `editor.seek` | `{ time: number }` | 暂停并跳到指定时间 |
| C→S | `editor.play` | 无 | 继续播放 |
| C→S | `editor.pause` | 无 | 暂停 |
| C→S | `editor.stop` | 无 | 停止 |
| S→C | `playback.state` | `{ time: number, playing: boolean }` | 播放头/播放状态 |
| S→C | `error` | `{ error: string }` | 传输/服务端错误 |

- `editor.pushScript` 的 `script` 是**字符串**，不是对象；发送前 `JSON.stringify`。
- `script.validate` 的 `doc` 是对象；不要先字符串化再塞进 `doc`。
- `pushScript` 保留当前播放头；推送后显式 `seek`，不依赖服务端自动跳转。
- `seek` 内部先暂停再设时间；`play` 恢复播放；`stop` 停止。
- `playback.state` 的 `playing` 表示“用户正在播放且未暂停”，不是“脚本已加载”。
- `editor.pushScript` / `editor.play` 走编辑器预览通道（PreviewChannel），不是正常游戏实例；镜头、lane、叠化、参数过渡、呼吸得到真实游戏渲染结果，玩家移动在预览通道不驱动。
- 这些消息已存在；08 不注册 `camera.push`、`camera.direct`、`camera.frame` 等新类型。

## 状态机

```text
disconnected
  ↓ 连接建立
ready
  ↓ 校验
validating
  ├─ error → invalid
  └─ ok → valid
valid
  ↓ 推送
pushing
  ↓ seek 已发送
seeking
  ↓ playback.state 到达
playing / paused
  ↓ stop
stopped
任意状态 → error（传输/服务端 error）
```

| 状态 | 按钮 | 说明 |
|---|---|---|
| `disconnected` | 全部禁用 | 显示“未连接游戏” |
| `ready` | 校验、推送并跳转 | 有文档、有路径 |
| `validating` | 禁用 | 等待 `script.validate.result` |
| `invalid` | 校验可重试；推送禁用 | 显示 issues；定位字段 |
| `valid` | 推送并跳转、播放、暂停、停止 | 本地+服务端都通过 |
| `pushing` / `seeking` | 禁用重复推送 | 显示“等待回执” |
| `playing` | 暂停、停止、重新推送 | 时间来自 `playback.state` |
| `paused` | 播放、停止、重新推送 | 时间来自 `playback.state` |
| `stopped` | 推送并跳转、播放 | 停止后保留时间 |
| `error` | 重试/重新校验 | 显示错误原因 |

- 推送无独立回执；`editor.pushScript` 自身也会广播一次当前 `playback.state`，`editor.seek` 再广播一次。回放检查以 `seek` 之后到达的最新状态为准；中间状态不提前结束 `seeking`。
- 2 秒内没有 `seek` 之后的 `playback.state`：显示“未收到状态回执”，保持 `seeking`；不自动重复推送。
- 重复点“推送并跳转”在 `pushing/seeking` 禁用；避免并发。
- 断线时清空 `pushing/seeking`，显示 `disconnected`；不清文档。

## 校验

推送前必须同时通过：

1. 03 本地校验桥：字段类型/范围/引用/叠化本地规则/参数过渡本地规则。
2. `script.validate`：服务端 `ScriptValidator` 的完整脚本校验。

```text
script.validate
  request:  { "type":"script.validate", "id":"...", "data": { "doc": <完整文档对象> } }
  response: { "type":"script.validate.result",
              "data": { "ok": false, "issues": ["clips[2].transition_params.yaw.duration: 需要有限正数"] } }
```

- `ok=false`：进入 `invalid`；显示前 8 条 issues，其余折叠；点击 issue 尝试定位 `clips[i]` / `objects[path]`。
- `ok=true`：进入 `valid`；记录校验时间和 issue 数（0）。
- `script.validate` 传输失败/超时：进入 `error`；不允许跳过校验直接推送。
- 本地校验 error 时不发 `script.validate`；避免把已知非法脚本送到服务端。
- 校验只读文档；不保存、不推送、不改播放头。

## 推送

```text
const json = serializeDoc(doc)          // 03-04，完整脚本
send({ type:'editor.pushScript', data:{ script: json } })
send({ type:'editor.seek', data:{ time: playheadTime } })
```

- `serializeDoc` 输出完整脚本；不发送增量、不发送 UI 状态、不发送 lane 视图。
- `playheadTime` 取主时间轴当前播放头；不新开独立时间输入。
- 推送前不自动保存文件；dirty 徽标保留，作者自行保存。
- 推送后不自动 `play`；由作者点“播放”。`推送并跳转` 只 seek，不改变播放/暂停意图：
  - 推送前在播放：seek 会暂停；随后自动 `play` 恢复。
  - 推送前已暂停：seek 后保持暂停，显示新时间画面。
- `pushScript` 只发一次；不重试、不轮询、不发送第二条“刷新”消息。
- 脚本 id/路径只在摘要显示；不拼接到 `script` 字符串之外。

## 播放控制

| 按钮 | 消息 | 行为 |
|---|---|---|
| 播放 | `editor.play` | 从当前时间继续；状态等 `playback.state` |
| 暂停 | `editor.pause` | 停在当前帧；状态等 `playback.state` |
| 停止 | `editor.stop` | 停止并清播放状态；时间保留最后值 |
| 推送并跳转 | `pushScript` + `seek` | 推完整脚本，跳主时间轴播放头 |

- 校验失败时全部播放控制禁用，避免播放上一版脚本误判为新结果。
- `push` 成功后播放的是刚推送的脚本；如果校验后文档又改，状态回到 `ready`/`valid` 需重新校验。
- `docRevision` 变化时：已 `valid` → 回 `ready`；`playing` 保持，但显示“脚本已修改，需重新推送”；不自动推。
- 播放头变化不触发推送；`seek` 只在“推送并跳转”或手动定位时发。

## 面板

```text
┌ 回放检查 ─────────────────────────────────────────────┐
│ ● 已连接 · path scripts/opening.json · 未保存修改 2   │
│ 状态 [valid]  校验 0 issue  上次推送 14:22:31         │
│                                                       │
│ 脚本 12 片段 · CAMERA 4 · 叠化 1 · 参数过渡 2 · 共存 1 · lane 规则 3 条 │
│                                                       │
│ [校验] [推送并跳转] [播放] [暂停] [停止]              │
│                                                       │
│ 播放头 4.20s   游戏状态 playing · 4.21s               │
│ 画面：游戏预览视口（本面板不渲染）                     │
│                                                       │
│ 校验问题                                              │
│  ! clips[2].transition_params.yaw.duration ...        │
└───────────────────────────────────────────────────────┘
```

- 顶部状态点：连接、dirty、校验、播放四类，不用颜色单独表达。
- 摘要计数从当前文档只读统计；不计算 lane 画面、不采样相机。叠化按“A/B 重叠 + B opacity 0→1”计数；参数过渡按 `transition=morph` 的片段计数；同一交界同时有两者的单独计“共存”，三项分开。
- 播放头显示主时间轴时间；游戏状态时间来自 `playback.state`，两者不一致时显示差值。
- “画面”行只说明真实画面在预览视口；面板内不放第二块 WebGL/Canvas 渲染。
- 校验问题列表可滚动；点击 issue 定位到片段/字段；定位失败显示原文。
- 错误条显示 `error` 文本 + 重试；不吞错误。

## 真实结果检查

- 叠化：在重叠区起点、中央、终点各 seek 一次；确认游戏画面同时存在 A/B 两层，B 的可见度从 0 到 1，A 在重叠区保持不透明；面板只提供 seek/play，不采样像素。
- 参数过渡：在片段交界前后各 seek 一次，比较游戏画面是否按 `blend/hold/cut` 变化；它是一条 morph lane 的六参数混合，不是叠化。
- 共存：同一交界叠化 + morph 时，在 morph 窗口内 seek：只观察 morph lane 结果，叠化画面不可见；在窗口外 seek：观察 A/B 两条 lane 是否仍在合成。面板显示 `morph 优先区间` / `叠化仍可见区间`，不以“两者同时可见”作为通过条件。
- lane：重叠片段区间内 seek，观察游戏画面是否出现多层合成；面板的 lane 表只作结构对照。叠化区应有 2 行（A `single`、B `crossfade`）；morph 区应有 1 行；共存区按当前区间显示 1 或 2 行。
- 呼吸/玩家移动：`play` 一段时间，观察游戏画面/玩家移动；面板不模拟。玩家移动只在游戏正常播放脚本时驱动，编辑器预览（`CameraManager.isEditorPlayback()`）下 `PlayerMoveController` 直接返回；回放检查不声称预览会产生真实位移。
- 调色：比较片段内或叠化/参数过渡前后的调色变化；面板不渲染。
- 若游戏画面与 lane 表不一致：以游戏结果为准；lane 表标注“结构视图”，不自动改写脚本。

## 组件

```text
src/camera/playback/
  playbackCheck.ts          状态机/消息编排/超时
  playbackCommands.ts       validate/push/seek/play/pause/stop
  playbackStatus.ts         playback.state/error 归并
src/components/camera/
  PlaybackTab.vue           回放 tab
  PlaybackStatusBar.vue     连接/dirty/校验/播放
  PlaybackActions.vue       五个按钮
  PlaybackIssueList.vue     校验问题
  PlaybackScriptSummary.vue 片段/相机/叠化/参数过渡/共存计数
```

- `playbackCheck` 不直接 import WebSocket；通过 01 的消息路由/连接服务发送。
- `playbackCommands` 只发固定消息；不新增 type。
- `PlaybackTab` 只在打开时订阅 `playback.state`；关闭 tab 取消订阅，不停止播放。
- `docRevision` 变化只更新 dirty/valid 状态；不自动重发。
- 组件不读写 `state.doc`；`serializeDoc` 走 03 服务。

## 验收

1. 连接建立、有文档：状态 `ready`；五个按钮按表启用/禁用。
2. 点“校验”：发 `script.validate`，`doc` 是对象；收到 `ok=true` 后状态 `valid`。
3. `ok=false`：状态 `invalid`；显示 issues；推送/播放禁用；不发送 `editor.pushScript`。
4. 本地校验 error：不发 `script.validate`；显示本地错误；推送禁用。
5. 点“推送并跳转”：发一次 `editor.pushScript`，`script` 是字符串；随后发一次 `editor.seek`，time 为主时间轴播放头。
6. 推送前在播放：seek 后自动 `play`；`playback.state` 的 `playing=true` 恢复。
7. 推送前已暂停：seek 后保持暂停；画面刷新一帧；不自动 `play`。
8. 点“播放/暂停/停止”：只发对应消息；状态以 `playback.state` 为准；不本地推断。
9. 2 秒无 `playback.state`：显示“未收到状态回执”；不重复推送；不无限轮询。
10. 收到 `error`：显示错误文本；状态 `error`；可重试校验/推送。
11. 文档 revision 变化：`valid` 回 `ready`；`playing` 保留但提示“脚本已修改，需重新推送”；不自动推。
12. 播放头变化：不发 `seek`；不触发推送；lane/连续性 tab 不因回放变化重算文档。
13. 断线：状态 `disconnected`；按钮禁用；文档与播放头保留；重连后可重新校验。
14. 面板内 0 个 WebGL/Canvas 画面；真实画面只在游戏预览视口。
15. 消息类型清单只有 `script.validate`/`editor.pushScript`/`editor.seek`/`editor.play`/`editor.pause`/`editor.stop`；无新增 type。
16. 回放能看到叠化/参数过渡/共存/lane/呼吸/玩家移动的真实结果；容器不因面板存在而重绘。
17. 叠化 + morph 共存时，窗口内 seek 只看到 morph 单 lane，窗口外 seek 仍能看到 A/B 两条 lane；面板不声称两者同时可见。
18. 模组 `.java` 零改动；`editor.setCamera`、`editor.enter_flight_mode` 不被本 tab 调用。
