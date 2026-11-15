# 08-02 叠化与参数过渡模型

## 目标

把“转场”定义成 **A→B 片段交界上的操作**，不是某个片段的属性，也不是脚本里的独立转场对象。08 处理三类交界：

- **叠化 / crossfade**：两个全屏 CAMERA 片段在时间轴上真实重叠；下层 A 保持不透明，上层 B 从 0 淡入到 1。
- **参数过渡**：`transition=morph` 时，运行时在片段交界附近按六通道混合两份相机六参数；只产出一条 morph lane。
- **硬切**：两段首尾相接，不做画面叠化、不做参数混合。

08 只读写现有固定脚本字段，不新增转场轨、转场数组或转场字段；叠化的时长和曲线由关键帧本身表达，参数过渡使用既有 `transition*` 字段。编辑器不造本地运行时。

## 当前代码事实

| 事实 | 来源 | 结论 |
|---|---|---|
| 叠化已实现，不新增转场轨/字段/生成器 | `plans/0.3.6/D-transition/scene-transition.md` | 叠化 = 两段相机画面重叠；下层 A 全程不透明，上层 B 在重叠窗口 0→1；时长与曲线就是关键帧数据 |
| 叠化是同一套合成参数的特例 | `plans/0.3.6/F-playback/camera-composition.md` | 两个全屏 lane；下层 A `opacity=1`，上层 B 在重叠窗口 0→1；没有独立转场轨/字段/生成代码 |
| 合成 alpha 契约 | `client/lane/LaneCompositor.java` | 写出 alpha = `opacity × coverage`；不读 lane 纹理 alpha；`opacity≤0` 是正常不可见路径 |
| lane 叠放顺序 | `client/lane/ScriptLaneDriver.java` | 注册顺序即合成顺序；实例启动顺序 → 轨道顺序 → 轨道内片段顺序，后面的在上 |
| 合成参数快照 | `script/CameraLaneComposite.java` | `opacity / dest / source / mask`；`DEFAULT` 全屏、不透明、full mask |
| 相机状态过渡字段 | `script/Clip.java`、`camera/transition/TransitionSpec.java` | `transition` / `transition_duration` / `transition_curve` / `transition_params` / `transition_interrupt` 只描述相机六参数混合 |
| morph 配对与单 lane | `script/CameraTrackPlayer.java` | `transitionPairAt` 从 prev→next 取对；morph 分支只产出一条 lane，合成参数取 next |

叠化没有专用脚本字段；参数过渡的 `transition*` 字段也不产生画面层。两者不是同一个东西，但可以在同一个 A→B 交界上同时存在，运行时按各自规则执行。

## 边界操作

```ts
interface TransitionBoundary {
  trackId: string
  fromClipKey: string          // A：出场片段
  toClipKey: string            // B：进入片段
  atTime: number               // A.end，交界时刻
  effect: 'cut' | 'crossfade' | 'morph' | 'both' | 'unmanaged'
  source: 'manual' | 'field' | 'none' | 'mixed'
}
```

- `TransitionBoundary` 是编辑器派生对象；不写 `doc`、不写 `authoring`、不参与保存和撤销。
- 同一轨道内相邻片段每两个之间有一个 boundary；N 个片段有 N-1 个，最后一个片段没有出场交界。
- 选中对象是“A→B 这个交界”，不是 A 或 B 单个片段。
- `effect` 由片段字段与落点推导：

```text
cut       无叠化、无 morph；两段首尾相接或明确硬切
crossfade 重叠区成立，B 的 opacity 两端为 0/1，A 恒 1
morph     A 的 transition=morph，且存在下一片段、窗口有效
both      同一交界同时满足 crossfade 与 morph
unmanaged 有重叠/间隙但不符合上述任一结构；只诊断，不自动改
```

- `source` 只用于面板分组：`manual` = 作者手动加的叠化；`field` = 既有 `transition*` 字段承载的参数过渡；`mixed` = 两者同时存在。
- “手动加”不是说新增一个持久字段，而是说作者通过交界操作建立叠化布局；落盘仍只写现有 `start_time` 与 `composite.opacity`。

## 叠化布局

给定同一 CAMERA 轨道内相邻的 A、B，叠化时长 `D`：

```text
A.start_time 不动
A.duration   不动
B.start_time = A.end - D
B.duration   不动
A.end        = A.start_time + A.duration
重叠区       = [B.start_time, A.end)
```

```text
时间轴
A   [==============================]          A 位置不动
B                    [==============================]
                      ← D →                      B 前移 D
重叠区               [==========]
```

- `D` 同时是 B 的前移量、重叠长度和 B 的不透明度从 0 到 1 的片段内时长。
- A 的最后 `D` 秒与 B 的最前 `D` 秒真实重叠；B 的最前 `D` 秒就是它的淡入段。
- B 在重叠区开头执行自己的本地第 0 秒，在重叠区结尾执行本地第 `D` 秒。
- B 的 `duration` 不变；B 的 `start_time` 前移后，B 的 `end` 也随之前移。后续片段不自动移动。
- A 的 `duration`、`start_time`、内容都不裁切。
- 需要 `0 < D <= min(A.duration, B.duration)`，且 `B.start_time >= A.start_time`；否则不成立。
- A/B 必须有限、非无限、非片段内循环；`loop=true`、`loop_count=-1`、`duration<=0` 或非有限都不进入叠化。
- 不自动生成重叠区；`D` 来自作者写下的关键帧区间，运行时只执行。

## 叠化画面

同一轨道里 B 在片段数组中的下标必须晚于 A；运行时按数组顺序叠放，B 是上层，A 是下层。

```text
下层 A：composite.opacity = 1，全屏
上层 B：composite.opacity 从 0 到 1，全屏
```

重叠区合成：

```text
out = A * (1 - w) + B * w
w = clamp((t - B.start_time) / D, 0, 1)
```

- A 保持 1，避免两层同时半透明时漏出第三层基画面。
- B 的 `composite.opacity` 在片段本地 0 为 0、本地 `D` 为 1；两端之间默认线性；关键帧曲线可继续编辑。
- 重叠区外：A 按自己的片段播放，B 按自己的片段播放；B 在 `D` 之后保持 1。
- A 结束时刻 = B 的重叠结束时刻；之后只有 B 继续（若 B 的 `duration` 大于 `D`）。
- 这是“下层不透明、上层淡入”的 crossfade，不是“两层同时变半透明”的互补 alpha。

## 叠化落盘

| 写入 | 路径 | 形态 |
|---|---|---|
| B 前移 | `clips[B].start_time` | 数字，等于 `A.start_time + A.duration - D` |
| B 上层淡入 | `B.objects['composite.opacity']` | 关键帧组：本地 0 = 0，本地 D = 1 |
| A 保持不透明 | `A.objects['composite.opacity']` | 不写；缺省 1；已有帧必须恒为 1 |
| A 的参数过渡 | `A.objects['transition']` 等 | **不自动改**；由作者在转场面板显式选择 |

- 不新增 `crossfade`、`overlap`、`crossfade_duration` 等字段；叠化是 `start_time + composite.opacity` 的组合结果。
- B 已有的 `composite.opacity` 关键帧：只替换本地时间 `(0, D)` 内的帧，保留区间外帧；两端帧写成 0 和 1。
- A 的 `composite.opacity` 不改写；没有帧时默认 1；有帧时必须恒为 1，出现任何非 1 帧就校验报错。
- A 的 `transition*` 原样保留；叠化不为了“独占交界”把 A 改成 `cut`。
- B 自己的 `transition` 只在 B 的出场交界生效；不参与 A/B 的叠化窗口。
- 一次应用是一个 `EditorCommand`：`B.start_time` 与 B 的 opacity 关键帧一起提交，一次撤销回退。

## 叠化前提与校验

| 代号 | 条件 | 级别 | 处理 |
|---|---|---|---|
| `crossfade_next_missing` | A 没有下一片段 | error | 不显示应用 |
| `crossfade_not_adjacent` | A/B 不在同一 CAMERA 轨道，或数组下标不相邻 | error | 阻止 |
| `crossfade_b_before_a` | `B.start_time < A.start_time` | error | 阻止 |
| `crossfade_duration_invalid` | `D` 非有限或 `<= 0` | error | 阻止 |
| `crossfade_duration_too_long` | `D > min(A.duration, B.duration)` | error | 阻止 |
| `crossfade_a_infinite` | A 无限或片段内循环 | error | 阻止 |
| `crossfade_b_infinite` | B 无限或片段内循环 | error | 阻止 |
| `crossfade_a_not_fullscreen` | A 的 `dest`/`source` 有帧或非全屏 | error | 阻止 |
| `crossfade_b_not_fullscreen` | B 的 `dest`/`source` 有帧或非全屏 | error | 阻止 |
| `crossfade_a_not_opaque` | A 的 `composite.opacity` 静态值非 1，或有非 1 帧 | error | 阻止 |
| `crossfade_b_mask_not_full` | B 的 `mask_shape != full` | error | 阻止 |
| `crossfade_b_order` | B 不在 A 之后的上层位置 | error | 阻止 |
| `crossfade_opacity_keys_replaced` | B 的 `(0,D)` 内已有 opacity 帧 | info | 应用时替换为 0→1 两端 |
| `crossfade_b_transition_overlap` | B 自己的参数过渡窗口与重叠区相交 | warning | 可应用；回放可能先走 B 的 morph lane |
| `crossfade_morph_both` | 同一交界同时有叠化与 A 的 morph | info | 允许；面板显示共存和优先区间 |
| `crossfade_shadowed_by_morph` | Morph 窗口覆盖整个叠化重叠区 | warning | 可保存；回放中该区间只有 morph lane |
| `crossfade_partially_shadowed` | Morph 窗口只覆盖部分重叠区 | warning | 可保存；窗口外仍可能出 A/B 两条 lane |

- 以上错误在转场面板阻止“应用叠化”；保存/推送前仍由 03 校验桥统一拦截。
- `warning` 不阻止保存；它提示作者当前组合的视觉结果可能不是纯叠化。
- 未知字段、错误类型、坏引用不在转场面板里静默删除；保留原值并显示诊断。

## 参数过渡

参数过渡写在**出场片段**的 `objects` 上，作用于它到下一片段的交界：

```text
clip A（objects['transition'] = morph，objects['transition_params'] = ...）
  └─ 交界 A.end / B.start → 参数过渡窗口
clip B（自己的 transition 作用于 B.end / C.start）
```

- 只有相邻 `prev → next` 才可能产生参数过渡；轨道最后一个片段没有下一片段，字段可以保留，但不产生窗口。
- 运行时从后往前找最近一个满足 `prev.isMorph()`、`prev` 非 effectively infinite、`spec.covers(now, finiteWindowEnd(prev))` 的片段对；后开始的过渡优先。
- 参数过渡只产出一条 morph lane；`CameraLane.clip = next`，合成参数取 next 侧；这与叠化的两条 lane 不同。
- 参数过渡可以在两个片段已经重叠时继续取值：它按 prev/next 两侧的相机六参数求值，不要求先消除重叠；只是画面 lane 会被 morph 单 lane 取代。

## 参数过渡字段

```text
objects['transition']            "cut" | "morph"
objects['transition_duration']   number
objects['transition_curve']      MathModel
objects['transition_params']     { <channel>: { mode?, duration?, curve? } }
objects['transition_interrupt']  "blend" | "snap"
```

| 字段 | 类型 | 缺省 | 说明 |
|---|---|---|---|
| `transition` | enum `cut / morph` | `cut` | `morph` 才可能打开窗口 |
| `transition_duration` | float | `0.5` | 片段级缺省时长；`0` = 无窗口 |
| `transition_curve` | MathModel | 无 | 片段级缺省权重曲线；无 = 线性 |
| `transition_params` | struct | 无 | 分通道覆盖；内部对象，不拆成六个字段 |
| `transition_interrupt` | enum `blend / snap` | `blend` | 被新过渡打断时的续接方式 |

- 这些字段都是 `objects` 路径下的 `VALUE` 对象；`transition_params` 只占一个路径。
- `transition` 缺省 `cut`；`transition=morph` 且未声明其他字段时，仍按全通道默认生成一个窗口。
- `transition_params` 的通道键只能是 `position / yaw / pitch / roll / fov / zoom`；不接受大小写变体、别名或位序数字。
- 每个通道对象只允许 `mode / duration / curve` 三个键；未知键由解析器拒绝。
- 分通道 `duration` 必须是有限正数；`0` 和负数不允许写在分通道覆盖里。片段级 `transition_duration` 可以是 `0`。
- `mode` 只接受 `blend / hold / cut`，缺省 `blend`。
- `curve` 是 07-09 的 `MathModelDoc`；缺省取 `transition_curve`；两者都没有 = 线性。
- `transition_interrupt` 只接受 `blend / snap`，缺省 `blend`。

## 参数过渡六通道

| 通道 | 位序 | 缺省合成 | 参数过渡语义 |
|---|---|---|---|
| `position` | 0 | `add` | 相机位置三轴 |
| `yaw` | 1 | `add` | 偏航角 |
| `pitch` | 2 | `add` | 俯仰角 |
| `roll` | 3 | `add` | 翻滚角 |
| `fov` | 4 | `multiply` | 视场角 |
| `zoom` | 5 | `multiply` | 变焦倍率 |

位序只用于运行时数组下标和诊断排序；脚本键名始终是字符串，不写数字下标。

## 参数过渡默认与窗口

```text
片段缺省：transition_duration / transition_curve
通道覆盖：transition_params.<channel>.duration / .curve / .mode
通道模式缺省：blend
```

解析顺序：

```text
mode     = channel.mode ?? blend
duration = (channel.duration 有限且 > 0) ? channel.duration
         : (transition_duration 有限且 > 0) ? transition_duration
         : 0
curve    = channel.curve ?? transition_curve ?? null（线性）
```

- `cut` 通道不占窗口；即使 `duration` 有值也不进入 `maxDuration`。
- `hold` 通道占窗口，但在窗口内保持 A 侧；窗口结束后随片段切换为 B 侧。
- `blend` 通道按 `curve` 的权重混合 A/B。
- 所有非 `cut` 通道的 `maxDuration` 最大值决定窗口总宽；窗口以交界为中心：

```text
windowStart = boundary - maxDuration / 2
windowEnd   = boundary + maxDuration / 2
covers(now) = maxDuration > 0 && now >= start && now < end
```

- `maxDuration=0`（全通道 `cut` 或全部时长 0）= 无窗口；`transition=morph` 也只有硬切。
- 进入窗口时按片段级/通道级曲线实例化一次；不在逐帧路径重建曲线。

## 参数过渡打断

- `transition_interrupt=blend`：新过渡开始时，以当前混合中间态为新 A 侧继续接，时长重新计算。
- `transition_interrupt=snap`：新过渡立即完成，直接切到新目标。
- `transition_interrupt` 只在 `transition=morph` 时有意义；`cut` 时表折叠，值保留但不参与。
- 播放头 seek、脚本替换、宏观循环折返都会复位过渡状态；不把上一轮的混合中间态带进新播放。

## 参数过渡的编辑器语义

| `transition` | 表状态 | 窗口 | 写盘 |
|---|---|---|---|
| `cut` | 折叠；显示“保留 N 条分通道声明” | 无 | `transition_params` 可保留，不删；显式“清除分通道声明”才删 |
| `morph` | 展开六行 | 有；`maxDuration=0` 时显示“无窗口” | 只写显式覆盖，未覆盖键不写 |

- 切到 `cut` 不自动删除已有分通道值；数据仍可见、可审计。
- 切回 `morph` 恢复上一组覆盖，不需要重新输入。
- `transition_params` 为空对象 `{}` 等价于无覆盖；编辑器不写空对象，清除最后一个覆盖时删除该路径。
- `transition_curve` 清除后回到“线性”；不写 `{type:'linear'}` 作为缺省。

## 参数过渡本地校验

`ScriptValidator` 当前没有参数过渡专用检查，08 的本地校验必须自己兜住解析器的拒绝条件。

| 代号 | 条件 | 级别 | 处理 |
|---|---|---|---|
| `transition_type_invalid` | `transition` 不是 `cut/morph` | error | 阻止提交/推送 |
| `transition_duration_invalid` | `transition_duration` 非有限或 `<0` | error | 阻止 |
| `transition_interrupt_invalid` | 不是 `blend/snap` | error | 阻止 |
| `transition_params_not_object` | `transition_params` 不是对象 | error | 阻止 |
| `transition_channel_unknown` | 通道键不在六通道 | error | 阻止 |
| `transition_key_unknown` | 通道对象含 `mode/duration/curve` 之外的键 | error | 阻止 |
| `transition_mode_invalid` | `mode` 不是 `blend/hold/cut` | error | 阻止 |
| `transition_channel_duration_invalid` | 分通道 `duration` 非有限或 `<=0` | error | 阻止 |
| `transition_curve_invalid` | 片段级/通道级曲线不符合 07-09 模型 | error | 阻止 |
| `transition_no_next` | `morph` 但无下一片段 | warning | 可提交；回放不产生窗口 |
| `transition_no_window` | 全部通道 `cut` 或有效时长全 0 | warning | 可提交；回放硬切 |
| `transition_cut_params_retained` | `cut` 仍保留分通道声明 | info | 可提交；表折叠显示 |

- 校验路径写到 `transition_params.<channel>.<key>`，不聚合为一条大错误。
- `transition_params` 里的未知键不自动删除；block 后由作者决定删除或改写。
- 关闭参数过渡/删除片段时不因校验失败而丢数据；保存/推送前统一跑校验。

## 共存规则

同一 A→B 交界允许同时存在叠化与参数过渡；编辑器不强制二选一，也不自动删除任一方。

```text
叠化区间   = [A.end - D, A.end)
morph 窗口 = [boundary - maxDuration/2, boundary + maxDuration/2)
boundary   = A.end
```

| 区间关系 | 运行时结果 | 编辑器 |
|---|---|---|
| 只有叠化 | 两条全屏 lane，A 不透明、B 淡入 | `effect=crossfade`，正常 |
| 只有 morph | 一条 morph lane，合成参数取 next | `effect=morph`，正常 |
| 两者同时存在，morph 窗口只覆盖部分重叠 | morph 窗口内一条 lane；窗口外仍可能出 A/B 两条 lane | `effect=both`，显示“部分遮蔽” |
| 两者同时存在，morph 窗口覆盖整个重叠 | 整个重叠区只有 morph lane；叠化画面不可见 | `effect=both`，显示“叠化被 morph 完全遮蔽” |
| morph 的 `maxDuration=0` | 没有 morph 窗口，叠化仍按两条 lane 执行 | 视为无 morph 效果，不报遮蔽 |

- 运行时 `CameraTrackPlayer.transitionPairAt` 先判 morph；命中后 `CameraTrackPlayer` 只产出 `CameraLane(morphState, next, ...)` 并返回，不再捕获下层 lane。
- 因此“共存”不等于“同时看到两种画面效果”；它表示**数据可以同时存在、运行时不崩、按优先区间执行**。窗口外的重叠区仍可能按普通多 lane 合成。
- 编辑器必须显示 `morph 优先区间` 和 `叠化仍可见区间`；不把“共存”写成“两种效果同时叠加”。
- 为了让保存/推送始终可运行，保留以下限制：叠化必须满足 08-02 的全部叠化前提；morph 必须满足 `transition` 字段、下一片段、有限窗口等全部前提；任一方结构无效时，面板阻止应用对应操作，但保留已有数据。
- 解决共存只提供显式动作，不自动改字段：
  - **仅保留叠化**：把 A 的 `transition` 写成 `cut`，保留 `transition_params` 等值；这是作者点击后的显式命令。
  - **仅保留参数过渡**：仅在 A 的 `transition=morph` 时可用；移除叠化布局（B 移回 A.end，删除两端 opacity 帧）；不自动改 A 的 `transition`。
  - **两者保留**：不改任何字段；面板显示遮蔽区间和 warning。

## 模型接口

```ts
type CameraChannel = 'position' | 'yaw' | 'pitch' | 'roll' | 'fov' | 'zoom'
type TransitionModeName = 'blend' | 'hold' | 'cut'
type TransitionInterruptName = 'blend' | 'snap'

interface CrossfadeLayoutDoc {
  aClipKey: string
  bClipKey: string
  duration: number
  aStart: number
  aEnd: number
  bStart: number
  bEnd: number
  overlapStart: number
  overlapEnd: number
}

interface ResolvedCrossfade {
  layout: CrossfadeLayoutDoc
  bOpacityKeys: { time: number; value: number }[]
  aOpacityAtStart: number
  aOpacityAtEnd: number
  shadowedSegments: Array<{ start: number; end: number; by: 'morph' }>
  warnings: string[]
}

interface TransitionChannelDoc {
  mode?: TransitionModeName
  duration?: number
  curve?: MathModelDoc | null
}

interface CameraTransitionDoc {
  transition: 'cut' | 'morph'
  duration: number
  curve: MathModelDoc | null
  channels: Partial<Record<CameraChannel, TransitionChannelDoc>>
  interrupt: TransitionInterruptName
}
```

纯函数：

```text
readBoundary(doc, trackId, fromClipKey, toClipKey)  派生一个交界；不是文档对象
readCrossfade(clipA, clipB)                         识别当前叠化布局；缺失返回 null
resolveCrossfade(clipA, clipB, duration, morphWindow) 计算落点、opacity 键、遮蔽区间
validateCrossfade(doc, boundary)                    返回 error/warning/info
applyCrossfade(doc, layout, commands)               写 B.start_time + B opacity 键
removeCrossfade(doc, layout, commands)              把 B 移回 A.end，删除两端键
readTransitionDoc(clip)                             从 objects 读并保留未知键
writeTransitionDoc(clip, doc)                       只写显式覆盖；一次 commit
resolveChannel(doc, channel)                        套用片段缺省/通道覆盖
resolveWindow(doc, boundary)                        返回 start/end/maxDuration
validateTransitionDoc(doc, context)                 返回 error/warning/info
```

- `readBoundary` 只按同轨数组顺序取相邻片段；不跨轨、不按开始时间重排。
- `resolveCrossfade` 只用 `start_time` / `duration` / `composite.opacity` 和 morph 窗口；不采样相机。
- `applyCrossfade` 一次 commit；不修改 A 的 `start_time`、A/B 的 `duration`、A 的 opacity、A 的 `transition*`。
- `removeCrossfade` 只删除能被识别为叠化两端帧的 opacity 键；B 的区间外帧保留；A 的 `transition*` 保持原样。
- `writeTransitionDoc` 删除最后一个通道覆盖时移除该通道键；通道对象为空时也移除。
- 未知通道/未知键保留供诊断，UI 不静默改写。

## 组件

```text
src/camera/transition/
  boundaryModel.ts            交界派生、相邻判定、effect 推导
  crossfadeDoc.ts             叠化布局/快照/读写
  crossfadeValidation.ts     叠化校验
  crossfadeLayout.ts          重叠区/落点几何
  crossfadeOpacity.ts         B opacity 两端帧
  coexistWindow.ts            叠化重叠区 × morph 窗口、遮蔽区间
  transitionDoc.ts            参数过渡读写/缺省/归一
  transitionValidation.ts     解析器镜像校验
  transitionWindow.ts         窗口/通道条几何

src/components/camera/
  CrossfadeLayoutStrip.vue    重叠布局条
  CrossfadeOpacityPreview.vue 0→1 预览
  CoexistNote.vue             共存/遮蔽说明
  TransitionTable.vue         六通道表
  TransitionRow.vue           模式/时长/曲线
  TransitionWindowStrip.vue   参数过渡窗口示意
  TransitionInterruptField.vue
```

- `TransitionBoundaryList.vue` / `CrossfadeDetail.vue` 是 08-03 转场面板的插件内组件；不进入片段属性面板。
- `TransitionTable` 不移动片段落点；`CrossfadeDetail` 不读写六通道表。
- `CrossfadeLayoutStrip` 是示意，不是主时间轴节点；拖布局条不改 `start_time`。
- 曲线编辑复用 07-09 的 `ModelEditorSheet`，值域传 `transition`；不复制模型目录。

## 验收

1. 3 秒叠化：A 0–6 不动，B 3–7，重叠区 3–6；`B.start_time=3`；A/B `duration` 都不变。
2. 叠化落盘只有两项：`B.start_time`、B 的两端 opacity 关键帧；不写 A 的 `transition`；JSON 无 `crossfade` 字段。
3. 重叠区起止：A 的 opacity 解析为 1；B 的 opacity 在本地 0 为 0、本地 D 为 1；两端之间默认线性。
4. 两条 lane：A 在下、B 在上；B 的合成参数和调色归属都是 B；不出现 morph lane。
5. `D > min(A.duration,B.duration)`：本地 error；应用按钮禁用。
6. A/B 非相邻或跨轨道：error；不移动 `start_time`。
7. A 或 B 无限/loop：error；不显示应用。
8. A 的 opacity 有非 1 帧：error；不自动改写 A。
9. A/B 非全屏或 B 非 `mask_shape=full`：error；提示“叠化要求全屏两条 lane”。
10. A 当前 `transition=morph`：应用叠化不自动改 A；面板显示 `both` 和 morph 优先区间。
11. B 的 opacity 在 `(0,D)` 内已有帧：应用后只剩 0/1 两端；区间外帧保留。
12. 移除叠化：B.start_time 回到 A.end；删除两端叠化帧；区间外帧保留；A 的 `transition` 保持原样；一次撤销回退。
13. `transition=cut` 参数过渡表：折叠；显示“保留 N 条分通道声明”；不产生窗口。
14. `transition=morph` 无覆盖：六通道 `blend`、`0.5s`、线性、`interrupt=blend`；窗口宽 `0.5`。
15. 分通道覆盖：只写显式键；`cut` 不占 `maxDuration`；`hold` 窗口内保持 A；`blend` 按曲线混合。
16. 未知通道/未知键/分通道 `duration<=0`：本地 error；保存/推送阻止。
17. 末尾 `morph` 无下一片段：warning；可保存；回放不产生窗口。
18. 叠化与参数过渡同一交界：允许共存；不自动删除；morph 窗口内只列 morph lane，窗口外仍可能出 A/B 两条 lane。
19. `transition_params` 在效果面板 0 行；转场面板只出现一个参数过渡表；不出现六个独立叶子。
20. 模组 `.java` 零改动；`TransitionSpec` / `TransitionParams` / `CameraChannels` / `CameraTrackPlayer` 的求值规则不被编辑器改写。
