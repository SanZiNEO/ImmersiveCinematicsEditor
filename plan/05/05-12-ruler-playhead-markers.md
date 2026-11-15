# 05-12 标尺、播放头、标记、A-B、缩放

## 目标

把四件容易混的事分开：**播放头**是会话位置；**脚本 A-B**是文档字段 `timeline.loop_start/loop_end`；**UI 预览范围**是会话临时范围；**标记**是会话标注。标尺只负责刻度/点击/拖动；缩放只改视图；播放头不靠前端定时器自增。

## 状态划分

```ts
interface TimelineSession {
  playheadTime: number        // 会话；不写文档
  markers: number[]           // 会话；排序去重；不写文档标记字段
  previewRange: { start: number; end: number } | null // 会话；UI 预览
  scale: TimelineScale        // 05-09；会话
  snapEnabled: boolean
}

interface ScriptLoopRange {   // 文档字段，来自 doc.timeline.loop_start/loop_end
  start: number
  end: number
}
```

| 概念 | 存储 | 写入 | 显示 |
|---|---|---|---|
| 播放头 | session | 点击标尺/拖动/transport | 一条竖线 + 时间气泡 |
| 脚本 A-B | `doc.timeline.loop_start/loop_end` | `timeline.setScriptLoop` 文档命令 | 标尺下方 A/B 三角 + 区间条 |
| UI 预览范围 | session | `session.setPreviewRange` | 标尺上方虚线区间 |
| 标记 | session | `session.addMarker/removeMarker` | 标尺上小旗 |
| 缩放/滚动 | session | `TimelineScale` | 标尺/轨道同步 |

- 脚本 A-B 与 UI 预览范围不得互写：`session.previewRange` 变化不碰 `doc.timeline.loop_*`；`timeline.setScriptLoop` 不碰 `previewRange`。
- 播放头不写 `loop_start/loop_end`；A-B 不移动播放头（除非作者点击）。
- 标记只存 session，不写文档。

## 标尺

- 刻度档：`0.1s / 0.5s / 1s / 2s / 5s / 10s / 30s / 60s`；根据 `pxPerSecond` 选择标签不重叠的最小档。
- 主刻度带时间文本；次刻度不带文本；`displayRange.end` 之外不画内容。
- 无限内容：有限末端之后画 `∞` 斜纹区；刻度继续按当前视图生成，不显示 `Infinity`。
- 点击标尺：设置播放头；拖动：scrub；松手提交一次会话变化（不写文档、不撤销）。
- `Shift+拖动`：设置 UI 预览范围；起点/终点排序；小于 0.1s 视为取消。
- A-B 手柄：标尺下方两个三角；拖动改 `loop_start/loop_end`；松手发 `timeline.setScriptLoop`；`Esc` 取消。
- A-B 区间：`loop_start` 到 `loop_end` 高亮；无 A-B 时不画；A/B 各自可单独显示。
- 标尺不画关键帧/对象/属性节点；只画刻度、标记、A-B、预览范围、播放头。

### 脚本 A-B 校验

- `0 <= loop_start < loop_end`；否则不写，显示原因。
- 有限内容：`loop_end <= finiteEnd + 0.001`；超出夹到 finiteEnd；finiteEnd=0 时禁用 A-B 编辑。
- 无限内容：`loop_end >= loop_start + 0.5`，上限为当前 `displayRange.end`；滚动后上限变化，不改已存值。
- 文档命令走 03 `EditorCommand`；一次拖动一条命令；`commit` 后文档变脏；保存由 03-07 负责。
- 右键标尺：`循环入 = 播放头`、`循环出 = 播放头`、`清除 A-B`；分别发 `timeline.setScriptLoop {start}` / `{end}` / `timeline.clearScriptLoop`；写 `doc.timeline.loop_*`，不是 session previewRange。
- `timeline.setScriptLoop` 接受 `{start?, end?}` 局部更新：只改给出的端点，另一端点保留；两端都给出时整体校验；`clearScriptLoop` 删除两字段（或写 null，按 03 序列化口径）。
- 文档里已有 `loop_start/loop_end`：打开时读入文档模型；不合法只显示 warning，不自动修、不阻塞打开。

## 播放头

- 显示：竖线 + 顶部时间气泡（`12.3s`）；播放时气泡跟随但不遮挡片段。
- 设置来源只有：
  1. 点击/拖动标尺；
  2. 点击轨道空白（05-09）；
  3. `playback.time` transport 事件；
  4. 命令 `timeline.seek`（跳转到指定秒）。
- 不做 `playhead += dt`、不做 `setInterval` 自增、不做本地时钟推算；`requestAnimationFrame` 只重绘，不累加时间。
- 播放：
  - `timeline.play` 发 `preview.play {start, end}` 给模组/播放端；服务端回 `playback.started`；
  - `playback.time` 消息带权威时间；前端只 `playheadTime = msg.time`；
  - `timeline.pause/stop` 发对应命令；断连时播放按钮 disabled，显示“未连接播放端”。
- 没有播放端实现时：播放按钮 disabled，播放头仍可手动拖；不伪造本地播放。
- 播放头到达 `displayRange.end` 不自动跳回 0；循环由脚本 A-B/播放端决定；前端不自己循环。
- 播放头不在任何片段上：允许；工具栏显示当前时间；不自动选片段。

## 标记

- `markers: number[]`，单位秒；排序、去重（0.001s 精度）。
- 添加：`M` 在播放头添加；工具栏“添加标记”；重复时间不新增，只高亮已有。
- 删除：`Shift+M` 删除最近标记（8px 内）；右键标记“删除”；`session.clearMarkers` 清空（二次确认）。
- 拖动标记：改时间；只改 session，不写文档、不进撤销。
- 标记不参与文档校验、不参与保存；关闭文档/重启编辑器后消失。

## UI 预览范围

- 用途：只影响预览播放/试听，不写文档、不做脚本 A-B。
- 设置：`Shift+拖动标尺`；或工具栏“设置预览范围”后拖动；或命令 `session.setPreviewRange`。
- 显示：标尺上方虚线括号 + 半透明区间；不与 A-B 的实线三角混用。
- 清除：点击预览范围外/`Esc`/工具栏“清除预览”；关闭文档清空。
- 播放：`timeline.play` 若 `previewRange` 存在，优先用它作为 `start/end`；否则用 0..displayRange.end；不把 previewRange 写进 `preview.play` 的持久字段。
- 不自动把预览范围同步到 A-B；反之亦然。

## 缩放

- 范围 5–500 px/s；默认 80。
- 按钮 −/+：按 1.25 倍步进；夹取；以视口中心为锚点。
- `Ctrl+滚轮`：以指针为锚点；`deltaY` 映射为指数缩放；一次滚轮事件一次更新。
- 指针锚定：缩放前后指针下的时间不变；`scrollLeft = anchorTime*newPps - pointerX`；夹到 `[0, maxScroll]`。
- 适配：`fit` 按 `displayRange`（无限按已知有限末端或 60s）算 pps；不重置 A-B/标记/选择。
- 缩放不改 `clip.duration`、不改 `start`、不改文档；只改 session。
- 缩放后吸附阈值仍是 8 屏幕像素；换算成秒变化。
- 缩放后标尺档位重算；片段块最小宽度 8px；极小时仍可命中（最小命中 8px）。

## 验收标准

- 点击标尺 7.2s：播放头 7.2s；不选片段；不弄脏文档。
- `Shift+拖动` 2s→8s：`previewRange={2,8}`；`doc.timeline.loop_start/loop_end` 不变；保存后文档没有 preview 字段。
- 拖动 A 三角到 3s：`loop_start=3`；文档变脏；`previewRange` 不变；撤销恢复。
- 右键“循环入”在 2s：`loop_start=2`；右键“循环出”在 8s：`loop_end=8`；右键“清除 A-B”：两字段删除或 null；文档变脏；预览范围不变。
- 拖动 B 超过 finiteEnd：夹到 finiteEnd；不写非法值；提示原因。
- 打开既有文档：session markers 为空；文档不脏；保存 JSON 无标记字段。
- 添加标记在播放头：markers 排序去重；文档里不出现标记字段；关闭重开消失。
- `M`/`Shift+M`：添加/删除最近标记；输入框内不触发。
- 播放：只有 `playback.time` 更新播放头；`grep setInterval` / `grep playhead +=` 0 命中；`requestAnimationFrame` 不累加时间。
- 断连：播放按钮 disabled；手动拖播放头仍可用；不伪造播放。
- 缩放 80→500 指针在 10s：缩放后指针下仍是 10s；`scrollLeft` 合法；不出现负值。
- 缩放 500→5：标尺档位从 0.5s 变 60s；标签不重叠；片段最小宽度 8px。
- 适配无限内容：按 finiteEnd 或 60s 适配；不按 `Infinity`；不报 NaN。
- `grep 标记持久化`：保存路径 0 命中；标记只存 session。
- `grep 总时长字段`：标尺/播放头/缩放 0 命中。

## 播放与标记约束

- 播放头只由 scrub 或 `playback.time` 更新；不用本地定时器自增。
- 标记只存 session，不写文档标记字段。
- UI 预览范围只存 session，不写 `timeline.loop_*`。
- 脚本 A-B 与 UI 预览范围分开；不自动同步。
- 时间刻度用秒；不做帧号/帧率刻度。
- 标记只存时间点；不做命名/颜色/分组。
- transport 只做 seek/play/pause；不做速度/倒放/逐帧。
- 循环由脚本 A-B/播放端负责；不自动循环。
- 缩放只在首次打开或手动适配时 fit；刷新不自动 fit。
