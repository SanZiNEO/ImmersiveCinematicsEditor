# 08-07 玩家移动预演

## 目标

在 `camera.inspect` 的“玩家移动”tab 读取 EVENT 轨的 `Position` 记录，画出 XZ 目标点、折线和播放头位置；显示相对基准、目标时间、到达阈值和宏循环复位。只读，事件记录的编辑仍由 06-07 承担。

## 运行时口径

`PlayerMoveController` 只读 EVENT 轨：

```text
遍历 script.timeline.tracks 中 type=EVENT 的轨道
逐 clip 编译 objects.event 的记录
只取带 Position 的记录
target.time = clip.start_time + record.time()
target.x/z = relative ? originPos + dx/dz : x/z
targets 按全局时间排序
targets.size() >= 2 → 从 targets[0] 走向 targets[1]
```

- `originPos` 是脚本启动时捕获的玩家位置；相对目标以它为基准。
- 相对基准不是某条事件的触发点；同一脚本内所有相对目标共用同一个 `originPos`。
- `ARRIVE_EPS=0.05` 格；到达判定用平方距离，小于 `0.05²` 即视为到达。
- 首个目标是起始锚点，不是传送点；玩家从当前位置走向第二个目标，首个目标只提供时间起点。
- 目标时间早于当前段起点时不动；目标到达后 `destIndex` 前进，可连续跳过多个已到达目标。
- 被方块挡住时停在被挡处；预演不模拟碰撞、跳跃、寻路。
- 脚本停止/打断/结束清空目标；宏循环折返把 `destIndex` 复位到 1，目标表不清空。
- `MOD_EVENT` 的 `objects.mod_event` 不参与玩家移动；只看 EVENT。
- 编辑器预览（`CameraManager.isEditorPlayback()==true`）不驱动玩家移动：`PlayerMoveController.onRenderFrame` 直接返回。本 tab 只画目标；真实移动在游戏正常播放脚本时发生。

## 数据模型

```ts
interface PreviewOrigin {
  x: number
  z: number
  source: 'runtime' | 'preview'
}

interface PlayerTargetView {
  key: string
  sourceClipKey: ClipKey
  eventIndex: number
  localTime: number
  globalTime: number
  relative: boolean
  authoredX: number
  authoredZ: number
  worldX: number
  worldZ: number
  role: 'anchor' | 'target'
}

interface PlayerRouteView {
  origin: PreviewOrigin
  targets: PlayerTargetView[]
  segments: Array<{ from: PlayerTargetView; to: PlayerTargetView }>
  startAnchor: PlayerTargetView | null
  moving: boolean
  arriveEps: number
  notes: PlayerMoveNote[]
}

interface PlayerMoveNote {
  code:
    | 'no_event_track'
    | 'no_position'
    | 'single_target'
    | 'relative_preview_origin'
    | 'dropped_out_of_range'
    | 'mod_event_ignored'
    | 'collision_runtime'
    | 'editor_preview_no_move'
  text: string
}
```

- `PlayerTargetView` 是派生对象；不写文档，不写 `authoring`，不进入撤销栈。
- `origin.source='runtime'` 表示“运行时基准是脚本启动时的玩家位置”；编辑器无法读取该值。
- `origin.source='preview'` 表示面板里手填的预览原点，只影响画图/世界坐标显示，不写脚本。

## 读取规则

1. 只遍历 `type='EVENT'` 的轨道；`MOD_EVENT` 跳过并给 note。
2. 逐 clip 读 `objects.event` 的记录数组；记录体必须有 `position`。
3. `record.time > clip.duration` 的记录在运行时编译期被丢弃；预演同样丢弃，并给 `dropped_out_of_range` note。
4. 片段 `loop` 不复制目标；目标只按片段在时间轴上的区间出现一次。
5. `globalTime = clip.start_time + record.time()`，裁剪到 `6` 位小数。
6. `relative=true`：`worldX = previewOrigin.x + authoredX`、`worldZ = previewOrigin.z + authoredZ`；`relative=false`：world = authored。
7. 排序：`globalTime` 升序；同刻按轨道数组顺序 → 片段数组顺序 → 记录下标，保证稳定。
8. 第一个目标 `role='anchor'`；其余 `role='target'`；`moving = targets.length >= 2`。
9. 目标事件所在 clip 的 `start/end` 用于定位；目标本身不改变主时间轴的片段区间。

- 不读取 EVENT 的其它记录字段做移动判断；`Position` 为 `null` 的记录跳过。
- 不把 `relative` 当成“相对触发点”；所有相对目标共用 `originPos`。
- 不把目标时间转换成片段局部时间显示为全局时间；表里两者都给。
- 目标点只有 X/Z；没有 Y 目标，不画高度。

## 预演原点

```text
预览原点 X [0.000]  Z [0.000]  [复位 0,0]
运行时基准：脚本启动时的玩家位置（预览值不写盘）
```

- 默认 `0,0`，按 `docKey` 存 session；不写 JSON、不进撤销。
- 相对目标存在时，若未设置预览原点，使用 0,0 并给 `relative_preview_origin` note。
- 绝对目标不依赖预览原点；图中世界坐标直接使用 authored x/z。
- 预览原点只用于画图和表内世界坐标；不声称等于运行时 `originPos`。
- 切换文档清空预览原点；同一文档切 tab 保留。

## 画布

```text
┌ XZ 预演 ──────────────────────────────────────────────┐
│  Z ↑                                                 │
│    │        ● target 2                                │
│    │       /                                         │
│    │  ○───● target 1                                  │
│    │  anchor                                         │
│    └────────────→ X                                   │
│  原点 (0,0)  ·  0.05 到达圈（示意放大）               │
└───────────────────────────────────────────────────────┘
```

- 俯视 XZ 平面；X 向右、Z 向上；坐标轴标注世界方向。
- 自动取所有目标 + 原点的包围盒，留 12% 边距；单点/零跨度时给最小 8 格视野。
- 首个目标画空心圆 `anchor`；其余实心圆 `target`，标序号。
- 折线按目标顺序连线；段线宽 1.5px；不画曲线、不画插值。
- 0.05 到达圈在屏幕上至少 4px；图例写“示意放大”，不按真实比例。
- 播放头所在段高亮；播放头早于锚点时间不高亮；晚于最后目标显示“已到末目标”。
- 目标悬停显示：片段名、局部时间、全局时间、相对/绝对、authored XZ、world XZ。
- 目标点击：选中来源 EVENT 片段 + `TimelineApi.seek(globalTime)`；不修改事件记录。
- 画布不渲染 Minecraft 地图、不读资源包、不采样画面。

## 目标表

| # | 片段 | 局部 | 全局 | 模式 | 写入 X/Z | 世界 X/Z | 角色 |
|---|---|---|---|---|---|---|---|
| 1 | walk_A | 0.80 | 2.80 | relative | +2.0 / +0.0 | 2.0 / 0.0 | anchor |
| 2 | walk_A | 2.00 | 4.00 | relative | +4.0 / +2.0 | 4.0 / 2.0 | target |
| 3 | walk_B | 0.50 | 5.50 | absolute | 10.0 / 5.0 | 10.0 / 5.0 | target |

- 数值保留 3 位小数；世界坐标按预览原点计算，表头标注“预览世界坐标”。
- `relative` 行显示 `+dx / +dz`；`absolute` 行显示 `x / z`。
- 目标表按 `globalTime` 排序；同刻稳定顺序。
- `anchor` 行没有入段线；`target` 行显示“从上一目标到本目标”。
- 低于 2 个目标：显示“只有锚点，不驱动移动”；不画折线。
- 没有 EVENT/Position：显示空态；不伪造目标。

## 时间与循环

- 目标时间 = `clip.start + record.time()`；不按播放头缩放。
- 播放头在 `[anchor.time, target[1].time)`：第一段尚未开始或正在走向 target 1；画布标“段未开始/进行中”按时间判断。
- 播放头在 `[target[i-1].time, target[i].time)`：高亮第 i 段。
- 播放头超过最后目标：显示“已到末目标”；不继续画移动。
- 宏循环：`PlayerMoveController.onScriptLoop` 把 `destIndex=1`；面板显示“宏循环折返复位到第一段”的 note，不模拟第二圈位置。
- 片段循环：不复制目标；片段内部循环不改变目标全局时间。
- 目标时间落在片段外（超界）已被丢弃；面板显示丢弃数量，不画越界点。

## 诊断

| 代号 | 条件 | 级别 | 文案 |
|---|---|---|---|
| `no_event_track` | 无 EVENT 轨道 | info | 没有 EVENT 轨道，玩家不会按 Position 移动 |
| `no_position` | 有 EVENT，但无 Position 记录 | info | EVENT 记录没有 Position，不驱动移动 |
| `single_target` | 目标数 = 1 | warning | 只有起始锚点，至少两个目标才驱动移动 |
| `relative_preview_origin` | 有 relative 目标，且预览原点为默认/未设置 | info | 预览世界坐标以 0,0 为基准，运行时以脚本启动位置为准 |
| `dropped_out_of_range` | 有 `time > duration` 记录 | warning | N 条记录超出片段时长，运行时编译期丢弃 |
| `mod_event_ignored` | 存在 MOD_EVENT Position | info | MOD_EVENT 不参与玩家移动 |
| `collision_runtime` | 有折线 | info | 预演不模拟碰撞/跳跃；实际可能被挡停 |
| `editor_preview_no_move` | 编辑器预览态 | info | 编辑器预览不驱动玩家移动；真实移动在游戏正常播放时发生 |

- 诊断不阻止保存/推送；玩家移动是运行时行为。
- 诊断按 warning → info 排序；0 条时显示“没有玩家移动提示”。
- 不显示“预计到达时间”；速度/碰撞/地形未知。

## 组件

```text
src/camera/playerMove/
  playerRoute.ts            读取 EVENT/Position/排序/世界坐标
  playerRouteGeometry.ts    包围盒/段线/播放头段
  playerMoveDiagnostics.ts  诊断
src/components/camera/
  PlayerMoveTab.vue         tab 容器
  PlayerRouteCanvas.vue     XZ 画布
  PlayerTargetTable.vue     目标表
  PreviewOriginField.vue    预览原点
  PlayerMoveNoteList.vue
```

- `playerRoute` 纯函数；输入 doc + previewOrigin，输出 `PlayerRouteView`。
- `PlayerRouteCanvas` 用 SVG/Canvas 2D 画点线；不引入地图/游戏资源。
- `PreviewOriginField` 只改 session；不调用文档命令。
- 目标点击定位调用 `TimelineApi.seek` + `requestSelect`；不写事件记录。
- 事件记录编辑入口仍由 06-07 提供；本 tab 不改 `objects.event`。

## 验收

1. 有一个 EVENT `Position(x=2,z=0,relative=false)`：目标表 1 行；`anchor`；`moving=false`；提示“只有锚点”。
2. 两个绝对目标 `(2,0)`、`(4,2)`：折线 1 段；第 2 行 `target`；播放头在第二段时间高亮该段。
3. 两个相对目标 `+2/+0`、`+4/+2`，预览原点 0/0：world 2/0、4/2；表头标“预览世界坐标”。
4. 预览原点改为 10/5：相对目标 world 12/5、14/7；写盘 JSON 不变。
5. `relative` 目标 + 未设预览原点：使用 0/0，提示“运行时以脚本启动位置为准”。
6. 目标数为 0：空态“没有 Position 记录”；画布不画假点。
7. 目标数 1：`moving=false`；不画折线；提示至少两个目标。
8. `record.time > clip.duration`：该记录不入表、不入图；提示丢弃 N 条。
9. 同刻两个目标：按轨道/片段/记录顺序稳定排列；不合并点。
10. 播放头早于 anchor：不高亮段；显示“首段未开始”。
11. 播放头晚于最后目标：显示“已到末目标”；不继续画。
12. 点击目标：选中 EVENT 片段并 seek 到全局时间；事件 JSON 不变。
13. 宏循环存在：显示“折返复位到第一段”提示；不伪造第二圈目标。
14. MOD_EVENT 有 Position：不进入目标表；提示“MOD_EVENT 不参与”。
15. 编辑器预览态：显示“编辑器预览不驱动玩家移动”；不把预演当真实位移。
16. 画布/表没有编辑控件；`grep objects.event` 在本 tab 写命令 0 命中。
16. 目标表/画布不读运行时 `PlayerMoveController`；刷新由 `docRevision` + 播放头触发。
