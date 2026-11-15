# 06-04 关键帧组与节点几何

## 目标

每个进入效果面板的动画叶子拥有一个独立关键帧组。组内画该属性自己的节点、段线、播放头和事件记录；不合并同刻节点、不跨属性连线、不生成整帧汇总行。属性面板没有关键帧组。

## 组件与状态

```text
src/components/effects/EffectKeyframeGroup.vue
src/components/effects/KeyframeNode.vue
src/components/effects/KeyframeTrack.vue
src/components/effects/EventRecordStrip.vue
src/effects/keyframeGroupLayout.ts
src/effects/nodeGeometry.ts
src/effects/keyframeSelection.ts
```

```ts
interface KeyframeGroupProps {
  row: EffectRow & { hasKeyframeGroup: true }
  viewport: EffectViewport
  selected: KeyframeSelection[]
  groupCollapsed: boolean
  readonly: boolean
}

interface KeyframeGroupLayout {
  path: string
  rowTop: number
  rowHeight: number
  trackLeft: number
  trackWidth: number
  baselineY: number
  originLocalSeconds: number
  pxPerSecond: number
}
```

## 哪些行有组

| 行 | 有节点组 | 说明 |
|---|---|---|
| `ANIMATED`，`keyframes.length>0` | 是 | 标准节点组 |
| `EVENT`，`keyframes.length>0` | 是 | 记录条样式，不是单值节点 |
| `ANIMATED`，`keyframes=[]` | 否 | 留在属性面板 |
| `VALUE` | 否 | 默认留属性面板；`group` 模式可作静态伴随行 |
| `STRUCT` | 否 | 只能静态值；默认留属性面板，`group` 模式可作静态伴随行 |
| 未知路径，有非空 `keyframes` | 是 | 只读节点组 |
| `group` 策略的静态伴随行 | 否 | 右侧显示“组内静态值” |

默认 `leaf` 模式下，效果面板中不存在空关键帧组，也不存在 `VALUE` / `STRUCT` 行；`group` 模式的静态伴随行同样没有节点组。每行至多一个组，组只服务本行。

## 局部坐标

效果面板所有组共用一条局部标尺和一个 `EffectViewport`：

```ts
interface EffectViewport {
  originLocalSeconds: number
  pxPerSecond: number
  scrollLeft: number
  scrollTop: number
  width: number
}
```

- `x = (time - originLocalSeconds) * pxPerSecond`。
- `pxPerSecond` 范围 `24..2400`；指数缩放，锚点保持鼠标下的时间不变。
- 标尺刻度按缩放选 1/2/5 序列：`0.1/0.2/0.5/1/2/5/10/30/60s`。
- 所有组共享 `originLocalSeconds/pxPerSecond`；组不各自缩放。
- 左右列共用 `rowTop/rowHeight`；`baselineY = rowTop + 26`。
- 行展开只改本行高度，后续行下移；标尺不动。

## 节点几何

```ts
interface NodeGeometry {
  path: string
  time: number
  x: number
  y: number
  kind: 'animated' | 'event-start' | 'event-end' | 'event-instant'
  inRange: boolean
  selected: boolean
  atPlayhead: boolean
}
```

- 动画节点：8px 菱形，中心 `(x, baselineY)`；选中 10px + 外环；播放头命中 10px + 内点。
- 事件区间：起止各一个端点，中间 2px 横条；瞬时事件用 8px 竖菱形。
- 同刻多节点在同一行内只可能一个（同属性同刻重复被拒绝）；不同属性同刻不合并。
- 节点可拖；拖动预览用 `translateX`，提交后重算 `x`。
- 轴外节点 `inRange=false`：50% 透明、虚线外框、保留在轨道上；拖回轴内恢复实心。
- 节点 tooltip：`路径 @ 2.35s = 1.2`；事件显示 `事件 名称 @ 1.0s`。
- 节点无可访问名称时使用 `aria-label="position.x 关键帧 2.35 秒"`。

## 段线与采样

- 相邻节点之间画 1px 段线；`interp==='step'` 画台阶，`linear` 直线，`bezier` 曲线。
- 段线只表达 `interp`，不画值曲线；值曲线入口在 06-06。
- 首个节点前、末个节点后不画外推段；只显示端点。
- 段线颜色按 `interp`：`linear` 中性、`step` 虚线、`bezier` 主题强调色。
- `EVENT` 行不画段线，只画记录条；记录与记录之间空白。

## 播放头与当前节点

- 每个组的轨道上画一条 1px 播放头，位置由 `playheadLocal` 计算；多条组共用同一时间。
- 播放头精确命中节点（`<=1e-4`）时，该节点显示 `atPlayhead`；不自动选中。
- 点击组内空白：把播放头移到该局部时间；不新增节点。
- 点击节点：选中该节点；选择身份 `{clipKey, objectPath, time}`；不切单属性页。
- `Shift` 点击：同属性内范围选择；`Ctrl/Cmd` 点击：跨属性增删选择。
- 框选：只选矩形覆盖的节点；不选组头、不选段线。

## 选择与高亮

```ts
interface KeyframeSelection {
  clipKey: string
  objectPath: string
  time: number
}
```

- 选择可跨属性；效果面板只高亮本面板内节点。
- 属性面板里对应叶子显示“已选中 1 个节点”状态；不复制节点组。
- 选中的节点被删除/移出面板：选择移除；若没有节点，选择退回 `{clipKey, objectPath}`。
- 选择不使用数组下标；撤销后按 `objectPath+time` 重新解析。

## 事件记录条

- `EVENT` 行右侧显示记录条，不显示通用节点。
- 区间事件：起止端点 + 横条；瞬时事件：竖菱形。
- 记录条宽度按起止时间；最小 6px，避免零宽。
- 点击记录条打开 06-07 记录编辑器；不直接改值。
- `EVENT` 记录不允许空数组；效果面板不会出现空事件组。

## 轴外与无限片段

- 有限片段：`0 ≤ t ≤ duration` 轴内；`t > duration` 轴外；`t < 0` 非法，保存校验报 L 系列。
- 轴外节点仍画在轨道上，视口可平移查看；不钳制、不裁掉、不并到末帧。
- 主时间轴片段宽度只按 `duration`，不因轴外节点变宽。
- 无限片段：`t ≥ 0` 都轴内；局部视口有限，`originLocalSeconds` 可为任意非负值；不写 `Infinity`。
- `duration` 变化不移动节点时间；只改轴内/轴外标记。

## 布局与虚拟化

```ts
interface KeyframeGroupLayout {
  path: string
  rowTop: number
  rowHeight: number
  baselineY: number
  nodes: NodeGeometry[]
  segments: SegmentGeometry[]
  visible: boolean
}
```

- 只为可见行生成 `nodes/segments`；滚动时按 `rowTop` 取窗口。
- 节点数 500+ 时仍只渲染可见节点；视口外的节点用聚合计数占位，不生成 DOM。
- 组折叠时只保留组头；展开时恢复本行节点。
- 行高 52px；详情展开 +52px；事件记录展开 +76px。

## 验收

1. 三个属性各有 2 帧：三行、三个独立节点组；同刻节点不合并、不连线。
2. `position.x` 有帧、`position.y/z` 无帧：效果面板只有 x 组；y/z 在属性面板。
3. `ANIMATED` 的 `yaw` 有 `keyframes=[]`：效果面板没有 yaw 组；属性面板显示“动画轨道无帧”。
4. `VALUE` 的 `opacity` 和 `STRUCT` 的 `modifier`：效果面板不出现，也没有空组。
5. `EVENT` 记录：显示记录条；点击打开记录编辑器；不显示通用菱形。
6. 轴外节点 `t=6.2`（duration=5）：半透明、可拖动、tooltip 正确；主时间轴片段不变宽。
7. 无限片段：`t=120` 可在局部视口查看；不显示 `Infinity`；不把视口末端当片段时长。
8. 框选跨三行：只选覆盖节点；不选段线；`Shift/Ctrl` 行为正确。
9. 500+ 节点：只渲染可见节点；滚动、缩放、选中不卡死。
10. 撤销删除节点后：节点、选择和面板归属恢复；不依赖数组下标。
