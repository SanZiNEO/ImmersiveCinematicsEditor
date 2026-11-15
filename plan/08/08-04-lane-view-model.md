# 08-04 lane 视图模型

## 目标

定义编辑期的 lane 视图。lane 是运行时每帧从活跃 CAMERA 片段产出的画面快照，不是脚本里的持久轨道。08 只在编辑器里按片段区间、叠化重叠区和参数过渡窗口列出“当前播放头会产出哪些 lane、顺序、来源、合成参数摘要”，不计算相机状态、不采样画面、不写运行时快照。

## 运行时事实

```text
getLaneSnapshots()
  按轨道内 clip 顺序返回
  最后一个 = 本轨本帧最上层 lane
  空列表 = 间隙 / 目标不可用 / 编辑器直控

单片段
  → 该片段一条 lane

重叠片段
  → 多个活跃片段各一条 lane；先捕获下层，顶层最后加入
  → 叠化就是这种多 lane 形态：A 在下、B 在上

叠化 / crossfade
  → A、B 两个全屏片段各一条 lane
  → A 的 composite.opacity 在重叠区保持 1
  → B 的 composite.opacity 从本地 0 的 0 到本地 D 的 1
  → 运行时没有 crossfade 专用字段；编辑器按 start_time + opacity 识别
  → 不要求 A 的 transition=cut；A 的 morph 字段只在自己的窗口内优先

morph 窗口
  → 前后两个片段只产出一条 lane
  → CameraLane.clip = next（进入的片段）
  → 合成参数取 next 侧
  → 本轨本帧不再捕获其他下层 lane

覆盖链
  Base 先选一个整帧六参数来源
  Modifier 再按 modifierPriority 升序作用在覆盖链输出
  Modifier 不作用 lane 快照
```

`CameraLane` 是 record：

```text
(state, clip, sample, composite)
```

`CameraLaneComposite` 字段：

```text
opacity
destX / destY / destW / destH
sourceX / sourceY / sourceW / sourceH
maskShape / maskX / maskY / maskWidth / maskHeight / maskRadius
```

缺省 `DEFAULT`：全屏、不透明、`mask_shape=full`；矩形为 0–1 归一化。

## 视图数据

```ts
type LaneRole = 'single' | 'morph' | 'crossfade'

type ValueSummary =
  | { kind: 'static'; value: number }
  | { kind: 'animated'; keyframes: number }

interface RectSummary {
  x: number
  y: number
  w: number
  h: number
}

interface MaskSummary {
  shape: 'full' | 'rect' | 'circle'
  x: number
  y: number
  width: number
  height: number
  radius: number
}

interface CompositeSummary {
  opacity: ValueSummary
  dest: RectSummary
  source: RectSummary
  mask: MaskSummary
  dimension: string
}

interface LaneView {
  key: string                 // 仅当前播放头有效，不写盘
  clipKey: ClipKey
  morphFromKey?: ClipKey
  crossfadeFromKey?: ClipKey
  role: LaneRole
  order: number
  top: boolean
  start: number
  end: number
  boundary?: number           // A→B 交界
  morphStart?: number         // morph 窗口起点
  morphEnd?: number           // morph 窗口终点
  crossfadeStart?: number     // 叠化重叠区起点 B.start_time
  crossfadeEnd?: number       // 叠化重叠区终点 A.end
  composite: CompositeSummary
  colorOwner: ClipKey
  morphSuppress: boolean
}

interface LaneViewSet {
  time: number
  lanes: LaneView[]
  gap: boolean
  notes: LaneNote[]
}

interface LaneNote {
  code:
    | 'gap'
    | 'morph_no_next'
    | 'crossfade_invalid'
    | 'crossfade_shadowed_by_morph'
    | 'crossfade_declared_outside_morph'
    | 'target_runtime'
    | 'animated_summary'
  text: string
}
```

- `LaneView` 是派生对象；不进入 `ScriptDoc`，不参与保存/撤销，不作为选区身份。
- `key` 只在当前 `time + docRevision` 下稳定；播放头变化后重新生成。
- `composite` 摘要只读 `objects` 的声明值/关键帧数量；不按播放头采样，不计算最终透明度/矩形。
- `colorOwner` 指向该 lane 的片段；调色值仍在 08-01 的调色行，不在 lane 视图复制。

## 活跃判定

`buildLaneViewSet(track, time)`：

1. 取轨道内 `clips` 数组顺序；不按 `start_time` 重排。
2. 找 morph 对：从后往前找第 `i` 个片段，满足：
   - `clips[i].objects['transition'].value='morph'`
   - 片段不是 effectively infinite
   - `clips[i]` 有下一片段 `clips[i+1]`
   - `windowStart(boundary) <= time < windowEnd(boundary)`
3. 找到 morph 对 → 只产出一条 lane：
   - `clipKey = clips[i+1]`
   - `morphFromKey = clips[i]`
   - `role='morph'`
   - `order=0`、`top=true`
   - `start/end` = 窗口起止
   - `boundary = clips[i].start_time + clips[i].duration`
   - `composite` 取 `clips[i+1]`
   - `colorOwner = clips[i+1]`
   - 若同一交界存在有效叠化，追加 `crossfade_shadowed_by_morph` note，写明 `morph 窗口内只有这一条 lane`；不伪造 A/B 两条 lane。
4. 没有 morph 对 → 取所有 `start_time <= time < end` 的片段：
   - 每个片段一条 lane，默认 `role='single'`
   - `order` = 片段在轨道数组中的下标顺序，从 0 递增；最后一个 `top=true`
   - `start/end` = 片段区间
   - `composite/colorOwner` 取该片段
5. 在活跃片段里识别叠化：若 A 在下、B 在上，且：
   - B 是 A 的下一片段（同一轨道数组相邻）
   - `B.start_time < A.end`，重叠 `D = A.end - B.start_time`
   - A 的 `composite.opacity` 恒为 1
   - B 的 `composite.opacity` 在本地 0 为 0、本地 D 为 1
   - A/B 都是有限、非片段内循环、全屏
   - B 的 `mask_shape=full`
   则 B 在重叠区内 `role='crossfade'`、`crossfadeFromKey=A`、`crossfadeStart=B.start_time`、`crossfadeEnd=A.end`；A 仍是 `single`。两条 lane 都保留，不合并。重叠区结束后 B 回到 `single`。
   - **不要求** A 的 `transition=cut`；A 的 `transition=morph` 只影响它自己的 morph 窗口。
6. 没有一个活跃片段 → `gap=true`，`lanes=[]`。
7. 最后片段 `transition=morph` 但没有下一片段 → 不产生 morph lane；按单片段规则处理，并给 `morph_no_next` note。
8. 叠化结构不满足（A 非 1、B 两端不是 0/1、顺序不对等）→ 仍按普通重叠列出多条 lane，并给 `crossfade_invalid` note；不伪造 crossfade lane。
9. 若存在有效叠化、但当前不在 morph 窗口：保留 A/B 两条 lane，给 `crossfade_declared_outside_morph` note（仅当同一交界也声明了 morph）。

- 活跃区间按主时间轴上的片段区间；片段内部循环 `loop` 不扩展 lane 的全局区间。
- `transition=cut` 不产生 morph lane；交界两侧按各自片段区间出现/消失。
- morph 窗口只产出一条 lane，即使还有第三个重叠片段；这与运行时“morph 后直接 return”一致。
- 叠化是“两条全屏 lane”，不是一条“crossfade lane”；`role='crossfade'` 只是编辑器对上层 B 的标注，运行时不识别这个名字。
- 叠化不要求 A 的 `transition=cut`；同一交界 A 有 morph 时，morph 窗口内只列 morph lane，窗口外仍按叠化两条 lane 列出。两种数据可以共存。
- 叠化重叠区的终点是 `A.end`；B 的 lane 可以继续到 `B.end`，之后 B 是普通 `single` lane。
- 目标可用性（实体是否存在、点源是否可解析）属于运行时；编辑器只给 `target_runtime` note，不伪造空 lane。
- 编辑器直控时运行时不产 lane；08 的回放检查不使用直控，视图不模拟该状态。

## 顺序与层级

- 顺序只由轨道数组决定，不由 z-index、opacity 或开始时间决定。
- `order=0` 是最下层，最后一个 `order` 是最上层；`top=true` 只在最后一个。
- 上层片段不删除下层 lane；合成阶段仍逐 lane 处理。
- 叠化两条 lane：A 在下 `opacity=1`，B 在上 `opacity 0→1`；B 的 `role='crossfade'`，A 仍是 `single`。
- morph lane 只有一条，`order=0` 且 `top=true`。
- 叠化 + morph 共存时，窗口内是单条 morph lane；窗口外是普通多 lane（可能是 crossfade 两行）。视图按当前播放头显示，不把两个区间拼成一个。
- lane 视图不提供“置顶/置底”按钮；层级由片段顺序决定，调整顺序走主时间轴的片段移动。

## 合成参数摘要

| 字段 | 摘要 | 动画时 |
|---|---|---|
| `opacity` | 静态数值 / `动画 N 帧` | 不给当前帧值；显示“动画”并定位效果行 |
| `dest` | 四项归一化矩形 | 任一轴有帧 → “动画” |
| `source` | 四项归一化矩形 | 任一轴有帧 → “动画” |
| `mask` | 形状 + 启用几何 | 几何有帧 → “动画” |
| `dimension` | 空 = 当前维度；非空显示字符串 | `VALUE`，不采样 |

- 静态值直接读 `objects[path].value`；关键帧计数读 `keyframes.length`。
- 所有字段都用 `source` 片段的对象路径；morph lane 用 `next` 片段；叠化两条 lane 各用自己的片段。
- 叠化行额外显示重叠区 `[B.start_time, A.end)` 与 B 的两端 opacity 摘要；不显示“当前混合值”。
- 不把 `dest/source/mask` 换算成像素；不计算窗口裁剪。
- 摘要与属性面板同源；面板不缓存第二份值，`docRevision` 变化时重建。

## 覆盖链

`camera.inspect` 的 lane 页固定显示覆盖链说明，不假装知道游戏内当前胜出层：

| 档位 | 值 | 来源 | 编辑器可见性 |
|---|---|---|---|
| `EXTERNAL` | 400 | 外部接管 | 运行时态，编辑器只列档位 |
| `FLIGHT` | 300 | 飞行取景 | 运行时态 |
| `EDITOR_DIRECT` | 200 | 编辑器直控，位置不动 | 08 回放检查不使用 |
| `SCRIPT_DIRECTOR` | 100 | 脚本导演（CAMERA 轨道） | lane 页的默认来源 |

- Base 层高优先级胜，同优先级后注册者胜；Base 层之间 Cut 切换。
- Modifier 是独立优先级域，按 `modifierPriority` 升序作用在覆盖链输出；不与 Base 优先级数值比较。
- `modifier` 不进入 lane 快照，不在 lane 行显示为“第 N 层”。
- lane 页只显示“脚本导演档位 100；外部/飞行/直控可覆盖”，不显示伪造的 winner。
- lane 行只显示“本片段是否声明 suppress_modifiers”；不推断最终是否生效。

## 颜色归属

- 57 个调色通道和 10 条曲线属于片段，随该片段产出 lane。
- lane 行只显示 `colorOwner` 片段；不复制调色值。
- 叠化两条 lane 各自归属自己的片段：A 行 `colorOwner=A`，B 行 `colorOwner=B`；不把 B 的调色算到 A 上。
- morph lane 的颜色归属是 `next` 片段；`prev` 的颜色在窗口内不单独成 lane。
- 调色编辑仍在 `selection.properties` / `clip.effects`；lane 页只提供定位入口。

## 不写盘

- 不写 `lane`、`lanes`、`lane_order`、`lane_opacity`、`lane_rect`、`lane_mask` 到脚本。
- 不写 `laneKey`、`top`、`role`、`order` 到 `authoring`。
- 不把 `CameraLane` / `CameraLaneComposite` 序列化到文档。
- 保存 JSON 的 CAMERA 片段只含 `objects` 与片段字段；lane 视图是 UI 派生层。

## 组件

```text
src/camera/lane/
  laneViewModel.ts         buildLaneViewSet / 活跃判定 / 顺序
  laneSummary.ts            composite 静态/动画摘要
  laneCoverChain.ts         覆盖链档位表
  laneCoexist.ts            叠化重叠区 × morph 窗口、可视化 note
src/components/camera/
  LaneTable.vue              lane 行
  LaneRow.vue                来源/角色/顺序/摘要
  LaneCompositeSummary.vue   合成参数摘要
  LaneCoverChainNote.vue     覆盖链说明
  LaneCoexistNote.vue        共存/遮蔽说明
```

- `laneViewModel` 纯函数；输入 `track` + `time`，输出 `LaneViewSet`。
- `LaneTable` 不调用运行时求值器、不读 `CameraManager`、不读预览画面。
- `laneSummary` 只读对象路径和 `keyframes.length`；不采样曲线。
- `LaneRow` 的点击定位走 08-05 的 `requestReveal`；不直接改选区。
- `laneCoexist` 只算区间重叠，不删除任何 lane 行；遮蔽说明是 note，不是过滤。

## 验收

1. 单 CAMERA 片段在区间内：`lanes=1`、`role=single`、`top=true`、`order=0`。
2. 两个重叠片段：`lanes=2`；数组后面的片段 `order=1/top=true`；两个来源片段正确。
3. 重叠三个片段：`lanes=3`；顺序按轨道数组，不从开始时间重排。
4. 叠化 A 0–6、B 3–7，重叠区 3–6：`lanes=2`；A `single` 在下、opacity 静态 1；B `role=crossfade` 在上、`crossfadeFromKey=A`、`opacity` 摘要为“动画/0→1”；不出现 morph lane；不要求 A 的 `transition=cut`。
5. `transition=morph` 且播放头在窗口内：`lanes=1`、`role=morph`、`clipKey=next`、`morphFromKey=prev`；即使第三个片段重叠也不出现第三条 lane。
6. `transition=morph` 但窗口外：按普通活跃片段列出，不保留 morph lane；若同交界有有效叠化，`lanes=2`，B `crossfade`，并给 `crossfade_declared_outside_morph` note。
7. `transition=cut`：交界两侧不合并；按片段区间出现/消失。
8. 播放头落片段间隙：`gap=true`、`lanes=[]`；不伪造 lane。
9. 最后一个片段 `transition=morph` 且无下一片段：按单片段列出；note `morph_no_next`；不产生空 morph lane。
10. 叠化结构不完整（A 非 1、B 两端不是 0/1、B 不在上层）：按普通重叠列出；note `crossfade_invalid`；不伪造 `role=crossfade`。
11. `opacity` 静态 1：摘要 `1.000`；给 opacity 打帧后摘要 `动画 N 帧`，不显示当前帧采样值。
12. `dest/source/mask` 任一轴有帧：摘要显示“动画”；mask 形状和启用几何仍可见。
13. morph lane 的 `composite/colorOwner` 取 `next`；`prev` 只作为 `morphFromKey`。
14. 叠化两条 lane 的 `composite/colorOwner` 各取 A/B；B 的 opacity 摘要显示 0→1，A 的显示 1。
15. 叠化 + morph 同交界，播放头在 morph 窗口：`lanes=1`、`role=morph`，note `crossfade_shadowed_by_morph`；不把叠化行删掉或改成伪 lane。
16. 叠化 + morph 同交界，播放头在 morph 窗口外：`lanes=2`，A `single`、B `crossfade`；不因 A 有 `transition=morph` 就拒绝 crossfade。
17. lane 页显示覆盖链档位 400/300/200/100；不显示伪造 winner；Modifier 说明“不作用 lane 快照”。
18. 保存/重开 JSON 无 lane 键；UI 状态不写盘；`grep lane` 在序列化输出 0 命中。
19. 面板切换播放头只重建 `LaneViewSet`，不产生文档 revision、不进撤销栈。
20. 共存 note 只出现在 lane 视图，不写 `authoring`；关闭面板不改变文档。
