# 10-02 AUDIO 播放、循环与包络

## 目标

把 `AUDIO` 片段的播放语义写清：

- 一条 `AUDIO` 轨同一时刻只有一个逻辑活跃片段；
- 同轨重叠片段不会各自起播；
- `fade_out` 的尾音可以在片段结束后继续，和新片段短时重叠；
- `file_loop` 是文件循环，不是片段循环；
- 包络超时长、音源失败、同轨重叠必须在编辑器里提前可见。

编辑器只写字段，不做音频混音；实际播放、暂停、解码、衰减由游戏完成。

## 源码事实

`AudioTrackPlayer.findActiveClip()` 按 `clips` 数组顺序返回第一个活跃片段。`onRenderFrame()` 只对这一个逻辑活跃片段创建/更新实例；其他片段不创建实例。

`onRenderFrame()` 对已经不在活跃位置的实例：

- 无限片段：直接 `cleanup`，没有片段结束，不淡出；
- 有限片段且 `fade_out > 0`、`elapsedSinceEnd >= 0` 且 `elapsedSinceEnd < fade_out`：继续按 `1 - elapsedSinceEnd/fade_out` 降音量，尾音保留；
- 其他情况：直接 `cleanup`。

这意味着：

- 同一轨的“逻辑活跃片段”只有一个；
- 前一片段的 `fade_out` 尾音可以和后一片段的正片同时存在；
- 这不是双活跃片段，也不是 crossfade；只是前一片段的收尾。

`fadeEnvelope(localTime, dur, infinite, fadeIn, fadeOut)`：

- `fade_in > 0` 且 `localTime < fade_in`：乘 `localTime / fade_in`；
- 有限片段剩余时间 `< fade_out`：乘 `remaining / fade_out`；
- `fade_out` 覆盖 `fade_in`；
- 无限片段不执行 `fade_out`。

`startClipInstance()` 在 `dur > 0 && fade_in + fade_out > dur` 时直接跳过整段，不创建实例。

## 同轨语义

| 情况 | 结果 |
|---|---|
| 同轨两个片段不重叠 | 前片段结束，后片段在起点起播 |
| 同轨两个片段重叠，且后片段在 `clips` 数组更后 | 只有第一个活跃片段起播；后片段不会因为重叠而叠加 |
| 同轨两个片段重叠，后片段在 `clips` 数组更前 | 后一个片段不成为活跃片段；仍按数组顺序取第一个 |
| 前片段结束、后片段活跃 | 前片段可按 `fade_out` 留尾音；后片段正常起播 |
| 需要两段同时完整播放 | 必须拆到两条 `AUDIO` 轨，不能靠同轨重叠 |

“第一个活跃片段”按 `clips` 数组顺序，不按 `start_time` 重排；这是运行时口径，编辑器不能按时间线视觉顺序猜。

## 循环

### `file_loop`

- 控制音频实例在 PCM 数据读完时是否回到开头。
- 只影响文件流的循环；不延长片段时长，不改变片段执行循环。
- 片段有限时长结束时，`fade_out` 仍按片段剩余时间计算；`file_loop` 不会让片段继续存在。

### 片段执行循环

- `playControl.loop` / `loop_count` / `loop_mode` 决定片段执行是否重复；
- 片段循环由时间线片段头编辑，不放进音源组；
- `loop_count = -1` 表示无限循环；`loop_mode` 是 `repeat` / `pingpong`；
- `loop_mode=pingpong` 时音频片段执行会反向重播；`AUDIO` 字段本身不写 `loop_mode`。

### 同时开启

`file_loop=true` 且片段 `loop=true` 时，两层循环各自生效：

- 文件流在音频文件末尾回到开头；
- 片段执行在片段末尾重新开始；
- 编辑器在 `file_loop` 行显示“文件循环”，在片段头显示“片段循环 ×N”，不合并成一个“循环”开关。

## 包络

### 计算

- 包络是片段本地时间的线性系数，乘在 `volume` 采样值上。
- `fade_in` 从片段本地时间 0 开始，到 `fade_in` 秒达到 1。
- `fade_out` 从片段结束前 `fade_out` 秒开始，到片段结束降到 0。
- 两者重叠时，`fade_out` 覆盖 `fade_in`；不做相加、不做交叉混合。
- 无限片段没有片段结束，`fade_out` 不生效。
- `volume=0` 时仍可起播；音频实例允许静音启动，不因 0 音量跳过。

### 包络预览

`AudioEnvelopeField` 在属性面板画一条 0–时长、0–1 的折线：

```text
volume
1 ┤        ┌────────────┐
  │       /              \
0 ┤──────/                \──────
  └──── fade_in ──── fade_out ──── 时间
```

- 横轴是片段本地秒；无限片段只画 `fade_in`，不画 `fade_out`。
- 折线只表示包络，不画音频波形、不采样声音。
- `fade_in + fade_out > duration` 时，折线在中段没有平台，显示警告“运行时会整段跳过”。
- `category=music` 时包络仍有效；`music` 只改空间语义，不改音量包络。

## 音源失败与重试

- 文件不存在、扩展名不支持、`source=minecraft` 资源不存在、外部解码失败，都会让该片段在游戏里失败。
- 失败片段只报一次并跳过，不会每帧重试。
- 编辑器可判定：`sound` 为空、文件不在资源列表、扩展名不支持、`source` 与取值域不匹配。
- 编辑器不判定：ffmpeg 是否存在、外部解码是否成功、OGG/WAV 文件内部是否损坏；这些不在编辑器资源清单里。
- `onScriptReplaced()` 会按 `sound + start_time + duration` 重映射已有实例；编辑音源后，旧实例是否保留取决于这三个值是否一致。

## 试听、暂停与定位

- 编辑器试听沿用现有播放通道：`editor.play` / `editor.pause` / `editor.stop` / `editor.seek`。
- 暂停使用原版 `SoundManager.pause()`；恢复使用 `resume()`。
- seek 时 `repositionAudio(target)` 只保留目标时间的活跃片段实例，其余清理。
- 不新增“音频试听”消息、不新增独立音频预览器、不做本地音频混音。

## 同轨重叠提示

属性面板在片段头显示：

```text
AUDIO 1 · 0.0–5.0s
⚠ 与同轨 clip_2 重叠 1.2s：同轨只播第一个活跃片段
[定位重叠] [拆到新 AUDIO 轨]
```

- 重叠检测按 `clips` 数组顺序和 `start_time/duration` 计算，不按视觉排序。
- 提示只说明“后片段不会起播”，不自动改片段时长或起点。
- `拆到新 AUDIO 轨` 是编辑器便利命令：新建一条 `AUDIO` 轨，把选中的重叠片段移到新轨；写的是现有轨道结构，不新增字段。
- 不自动拆分；作者点按钮才执行。

## 本地校验

| 检查 | 级别 | 处理 |
|---|---|---|
| `fade_in + fade_out > duration` | warn | 包络行警告；运行时会整段跳过 |
| `fade_in` / `fade_out` 为负 | block | schema min 0，拒绝提交 |
| `volume` 非有限 | block | 拒绝提交 |
| `file_loop=true` 且片段无限循环 | info | 两层循环各自生效 |
| 同轨片段重叠 | warn | 片段头重叠提示；后片段不叠加 |
| `source=minecraft` 且 `file_loop` | info | 文件流循环仍有效 |
| 音源失败（可判定） | error/warn | 按 10-01 的音源检查分级 |

## 验收标准

1. 同轨两个片段 `0–3s` / `3–6s`：顺序播放，无重叠提示。
2. 同轨两个片段 `0–5s` / `2–7s`：只第一个片段起播；第二段显示“同轨只播第一个活跃片段”；点“拆到新 AUDIO 轨”后两段可同时播放。
3. 同轨 `0–5s` / `4–8s`，前段 `fade_out=2`：4–5s 后段起播，5–7s 前段尾音与后段重叠；UI 不把这标成双活跃片段。
4. `file_loop=true`、片段 `duration=3`、`fade_out=1`：文件循环只循环 PCM；片段 3s 后仍按 `fade_out` 收尾，不延长片段。
5. 片段 `loop=true`、`loop_count=2`：时间线显示 ×2；`file_loop` 行仍只显示文件循环。
6. `fade_in=2`、`fade_out=3`、`duration=4`：包络预览显示无平台段，警告“运行时会整段跳过”。
7. `fade_in=1`、`fade_out=1`、`duration=3`：包络 0–1 上升、1–2 平台、2–3 下降；`fade_out` 覆盖末端。
8. `duration<0` 无限片段：包络只画 `fade_in`，不画 `fade_out`；`fade_out` 值保留但不生效。
9. `volume=0`：包络仍显示；片段可起播，不显示“音量 0 跳过”。
10. 编辑器 seek 到片段中段：预览从该点播放；不重建整条脚本、不弹音频错误。
