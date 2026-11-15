# 05-09 主轴几何、显示范围与选择

## 目标

主时间轴的“坐标/范围/吸附/命中/选择”由可测试的纯函数和会话状态构成：全局秒、有限末端、无限片段、8px 吸附、片段级命中、稳定 `clipKey` 选择。主轴只处理片段，不处理对象、属性、关键帧。

## 数据模型

```ts
interface TimelineScale {
  pxPerSecond: number        // 5–500
  scrollLeft: number         // 画布世界坐标的左边界，像素
  viewportWidth: number      // 可视宽度，像素
}

interface DisplayRange {
  finiteEnd: number | null   // 有限内容末端；无限时可为 null
  infinite: boolean
  start: number              // 显示起点，通常 0
  end: number                // 显示终点，不是脚本总时长
}

interface TimelineSelection {
  primary: Selection         // 03-03 的共享主选区
  clipKeys: readonly string[]// 会话批选；不含属性/关键帧
}

interface TimelineHit {
  kind: 'clip' | 'clip-edge-left' | 'clip-edge-right' | 'track-empty' | 'ruler' | 'none'
  clipKey?: string
  trackId?: string
  time: number
}
```

### 坐标

- 世界坐标 = `time * pxPerSecond`；屏幕坐标 = `time * pxPerSecond - scrollLeft`。
- `timeToScreenX(t)` / `screenXToTime(x)` 是纯函数；不在组件里重复算。
- `contentWidth = displayRange.end * pxPerSecond + tailPadding`；`tailPadding = max(120, viewportWidth * 0.5)`，由视口与内容末端推导。
- 缩放锚点：指针位置对应的时间不变；`scrollLeft` 按 `(anchorWorldX - pointerX)` 重算。
- 不允许负 `pxPerSecond`、`NaN`、`Infinity`；夹到 5–500。

### 有限末端与无限

- `finiteEnd`：所有片段 `clipWindowEnd` 的最大值；`clipWindowEnd = start + duration * (loop ? max(1, loop_count) : 1)`。
- `infinite=true` 当任一：
  - 片段 `duration < 0`；
  - 片段 `loop=true && loop_count < 0`；
  - `meta.macro_loop=true && macro_loop_count < 0`（脚本级无限，主轴也必须知道）。
- 无限时 `finiteEnd` 仍可记录已知有限内容末端，但 `displayRange.end` 不能固定；显示到 `max(有限末端, 当前视口末端, 60s)`，滚动时继续延伸。
- 有限时 `displayRange.end = max(finiteEnd ?? 0, 30s) + tailPadding/pxPerSecond`；不写、不读总时长字段。
- 无限片段在轨道上画成“∞ 条纹”到当前显示末端；不伪造固定宽度结束点；不显示 `Infinity` 文本。

### 吸附

```ts
interface SnapContext {
  enabled: boolean
  thresholdPx: 8
  playhead: number
  clipEdges: number[]
  markers: number[]        // session
  loopStart/loopEnd: number | null   // 脚本 A-B
  previewStart/previewEnd: number | null // UI 预览范围
  gridInterval: number     // 0.5s；可关闭
}
```

优先级从高到低：

1. 播放头；
2. 当前拖动片段的相邻片段边界；
3. 标记；
4. 脚本 A-B 端点；
5. UI 预览范围端点；
6. 0 点；
7. 0.5s 栅格。

- 阈值固定 8px（屏幕像素），缩放后换算成秒；不是固定 0.5s。
- 多候选在阈值内 → 取优先级最高；同优先级取距离最近。
- 按住 `Alt` 临时关闭吸附；工具栏吸附开关是持久会话状态。
- 吸附只改拖动结果，不写文档；提交时用吸附后的时间。

### 命中

- 只命中片段、片段左右 8px 手柄、轨道空白、标尺；不命中关键帧/对象行/属性节点。
- `clip-edge-left/right` 命中优先于 `clip` 主体；手柄视觉 4px、命中 8px。
- 轨道头不参与画布命中；标尺单独 `ruler`。
- 空白点击：移动播放头到点击时间；不创建片段；**不清选择**（避免误清）。清选择用 `Esc` 或点击标尺外区域。
- 空白拖动：scrub 播放头；不是框选。片段框选只产生片段集合，不产生属性节点选择。
- `Shift+拖动` 轨道空白：进入框选（marquee），只选中与矩形相交的片段；`Ctrl/Cmd` 可叠加；松手提交一次选择变化；不移动播放头、不改文档。
- `Esc` 取消框选；框选期间不触发片段拖动。
- 折叠/隐藏轨道不参与命中；锁定轨道可命中但拖动被拒绝。
- 命中使用 `clipKey` 和 track id，不用 `{trackIndex,clipIndex}`。

### 选择

- 单击片段：`primary.clipKey=key`，`clipKeys=[key]`；不自动切面板，不改面板归属。
- `Ctrl/Cmd+单击`：切换该 `clipKey`；`Shift+单击`：按当前可见轨道顺序做区间选择；区间只含片段。
- `Esc` 或点击标尺外区域：清空 `clipKeys`，`primary` 回 `none`；不自动选第一个片段。
- 多选状态是 `clipKeys` 会话数组；主选区是 03 `Selection`；两者同源，不另存 `selectedClips: {track,clip}[]`。
- 选中变化只改会话/主选区，不进文档撤销，不弄脏。
- 选中的片段被删除/撤销后失效 → `primary=invalid`；不自动跳邻片段，由 04-05 的 `invalid` 态处理。

### 轨道视图状态

- `trackView: Record<trackId, {visible, locked, muted}>` 存 session；不写文档。
- 隐藏轨道不参与布局高度/命中；锁定轨道可选中但不可拖动/裁切/删除。
- 静音只影响预览推送（AUDIO 轨 `clips=[]` 的 payload 裁剪），不改文档、不影响主轴显示。

## 实现边界

- 时间轴几何只由片段起止、循环窗口、视口推导；不保存整条时间轴总时长缓存。
- 对象/帧编辑不触发总时长回写；时间轴编辑才改片段末端。
- 主轴不挂载关键帧拖动/选择模式；关键帧编辑归 06。
- 选择只用 `clipKey` + `trackId`，不用 `selection.track/clip/keyframe` 下标。
- 吸附点覆盖片段起止、标记、循环、预览范围与栅格。
- `pxPerSecond/scrollLeft` 只属于主轴 `TimelineViewState`；不共享给其他面板。

## 验收标准

- 3 个片段末端 12.5s：`finiteEnd=12.5`；`displayRange.end` 至少 30s + 尾部；不读总时长字段。
- 一个 `duration<0` 片段：`infinite=true`；显示“∞”条纹到当前视口末端；滚动后继续延伸；不写 `Infinity`。
- `loop=true, loop_count=3, duration=2, start=4`：`clipWindowEnd=10`；`finiteEnd` 取 10，不取 6。
- 缩放 5→500：指针锚点时间不变；`timeToScreenX` 与 `screenXToTime` 互逆；不出现 NaN。
- 拖动片段靠近播放头 3px、片段边界 5px：吸附播放头（优先级更高）；`Alt` 关闭后不吸附。
- 标记/循环/预览范围在 8px 内：各自吸附；没有标记时不产生假吸附点。
- 点击片段左 6px：命中 `clip-edge-left`；点击主体：`clip`；点击空白：`track-empty` + 播放头移动、保留已有选择；`Esc` 才清选择；不命中关键帧。
- 多选 3 个片段：`clipKeys` 3 个稳定 key；重排/跨轨后仍指同一片段；`primary` 是最后点击的。
- `Shift+拖动` 框选跨两轨的 4 个片段：4 个都被选中；矩形外的片段不选；不移动播放头；`Esc` 取消不变更。
- 选中片段：面板归属不变；不自动切属性/效果面板；`selection.track/clip/keyframe` 0 命中。
- 锁定轨道：可选中，拖动/裁切/删除被拒绝；隐藏轨道不参与命中。
- 拖动 100px 再松手：只提交一次 `EditorCommand`，撤销一次；拖动中不产生 100 次撤销。
- `grep 总时长字段`：主轴几何/提交路径 0 命中（注释除外）。
- `grep keyframe`：主轴视图/几何 0 命中（注释除外）。

## 主轴几何约束

- 显示范围从片段起止/循环窗口/视口推导，不读、不写、不派生总时长字段。
- 主轴只画轨道与片段；对象行、属性节点、关键帧菱形、曲线汇总点不进入主轴。
- 时间单位用秒；不引入帧号/帧栅格。
- 轨道按单层顺序排列。
- 拖动只在松手时提交一条 `EditorCommand`。
- `clipKeys` 与 03 `Selection` 同源，不建第二套选择模型。
- 主轴缩放/滚动状态独立，不共享可变对象给其他面板。
- 标记只存 session，不写文档。
