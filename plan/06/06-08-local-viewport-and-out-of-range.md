# 06-08 效果面板局部视口与轴外节点

## 目标

为效果面板建立独立的局部时间视口：只服务 `clip.effects` 内的动画组，不改变主时间轴几何。支持缩放、平移、适配片段/全部节点、轴外节点和无限片段；属性面板没有时间轴，不参与该视口。

## 视口模型

```ts
interface EffectViewport {
  originLocalSeconds: number
  pxPerSecond: number
  scrollLeft: number
  scrollTop: number
  width: number
  height: number
}
```

- `originLocalSeconds`：视口左边缘对应的片段局部秒；可为负（查看 `t<0` 的非法数据）或大于 `duration`（查看轴外）。
- `pxPerSecond`：`24..2400`；指数缩放，每档 ×1.25。
- `scrollLeft`：横向滚动像素；与 `originLocalSeconds` 二选一作为真实源，推荐以 `originLocalSeconds` 为源，`scrollLeft` 仅存滚动条位置。
- `scrollTop`：组列表纵向滚动；与行布局共用。
- `width/height`：内容区像素；由面板尺寸和分隔条计算。
- 视口状态存 `session.effectPanels[clipKey].viewport`，不写 `doc`。

## 坐标

```ts
x = (time - originLocalSeconds) * pxPerSecond
time = originLocalSeconds + x / pxPerSecond
```

- 所有效果组共用 `originLocalSeconds/pxPerSecond`；组不能独立缩放。
- 标尺与节点轨道使用同一 `x`；左右列共用 `rowTop/height`。
- 缩放锚点：鼠标下的时间保持不动；键盘缩放以播放头为锚点。
- 拖动空白/中键拖动：平移 `originLocalSeconds`；不改变选择。
- 滚轮：`Ctrl/Cmd` 缩放，普通滚轮纵向滚动；`Shift` 滚轮横向平移。

## 适配

| 命令 | 计算 |
|---|---|
| 适配片段 | `originLocalSeconds=0`；`pxPerSecond=(width-32)/duration`；无限片段用当前窗口末端 |
| 适配全部节点 | 取所有动画节点最小/最大时间，含轴外；两侧留 24px |
| 适配选中节点 | 取选中节点最小/最大时间；无选中则禁用 |
| 重置 | `originLocalSeconds=0`、`pxPerSecond=80`、`scrollTop=0` |

- 适配结果 `pxPerSecond` 钳到 `24..2400`；超出范围时保留钳制值并允许后续手动缩放。
- 有限片段 `duration<=0` 时“适配片段”禁用；不除零。
- 适配全部节点在无动画行时禁用；空态不显示标尺。
- 适配不改变播放头、不改变选择、不写文档。

## 标尺

- 局部秒标签，不是全局时间；不显示片段 `start_time` 偏移。
- 刻度按 `pxPerSecond` 选 1/2/5 序列：`0.1/0.2/0.5/1/2/5/10/30/60/300s`。
- 主刻度带单位 `s`；`originLocalSeconds` 非整数时首标签可为负/小数，避免误导。
- 片段起止：有限片段在 `0` 和 `duration` 画边界线；无限片段不画右边界。
- 播放头：1px 线 + 顶部三角；位置由 `playheadLocal` 计算。
- 标记：05 片段标记在此只读显示；点击标记把播放头移到标记时间，不编辑标记。
- 轴外区域：有限片段 `t>duration` 背景加 45° 斜纹；`t<0` 红色斜纹；节点仍可操作。

## 轴外节点

- 有限片段：`0 ≤ t ≤ duration` 轴内；`t > duration` 轴外；`t < 0` 非法。
- 轴外节点保留原始时间、可查看、可拖动、可改值、可删除、可复制；不钳制、不裁掉、不隐藏。
- 轴外节点样式：50% 透明、虚线外框；选中后实心 + 外环。
- 主时间轴片段宽度只按 `duration`；轴外节点不撑宽片段、不生成第二片段。
- “只看轴外”过滤只隐藏轴内行；组头保留；不影响轴外节点数据。
- 把轴外节点拖回 `[0,duration]` 后恢复轴内样式；一次撤销恢复原时间。
- 保存时轴外节点合法；不因轴外阻止保存；服务端校验按 L 系列给 warn/error。

## 无限片段

- 无限片段 `duration` 为空/无限标记；`t ≥ 0` 全部轴内，不画右边界。
- 视口窗口有限：`originLocalSeconds` 非负，`originLocalSeconds+width/pxPerSecond` 只是可视末端，不是片段时长。
- 不写 `Infinity`、不把可视末端写进 `duration`、不生成“虚拟末帧”。
- 横向平移可到任意大时间；滚动条使用相对窗口，不按绝对时长计算。
- `t<0` 仍非法；无限片段也不接受负时间节点。
- 适配片段对无限片段使用“当前窗口末端 + 10% 余量”；不尝试适配到无穷。

## 行与节点虚拟化

- 组列表只布局可见行：按 `scrollTop/rowHeight` 取窗口，上下各留 5 行缓冲。
- 每行只为可见节点生成 `NodeGeometry`；视口外节点用计数占位，不生成 DOM。
- 500+ 节点、100+ 行时滚动保持 60fps；缩放后重算可见节点，不重建文档。
- 行展开/折叠后重算 `rowTop`，保持滚动锚点（当前选中行/播放头行）。
- 搜索/过滤后重算可见集合；滚动条按过滤后行数。

## 会话状态

```ts
interface EffectPanelSession {
  viewport: EffectViewport
  collapsedGroups: Record<string, boolean>
  filter: { text: string; outOfRangeOnly: boolean }
  splitRatio: number
  expandedRows: Record<string, boolean>
}
```

- 以 `clipKey` 为键；切片段恢复各自视口。
- 文档关闭清空；撤销恢复的 `clipKey` 重新绑定，视口回默认。
- 不写 `doc`、不进 `serializeDoc`、不进预览推送。

## 验收

1. 打开效果面板：标尺从 0s 开始；有限片段在 duration 画右边界；播放头与主时间轴一致。
2. `Ctrl+滚轮` 缩放：鼠标下时间不动；所有组同步缩放；节点位置正确。
3. 拖动空白平移：标尺和节点一起移动；选择不变；文档不变。
4. 适配片段：`duration=5s` 时 0–5s 填满内容区；无限片段不尝试适配无穷。
5. 适配全部节点：包住轴外节点；两侧留 24px；`pxPerSecond` 不越界。
6. 轴外节点 `t=6.2`：斜纹区可见、节点半透明、可拖动；主时间轴片段宽度不变。
7. `t=-0.5` 非法节点：红色斜纹区可见、只读告警；不能通过拖动提交负时间。
8. 无限片段：平移到 `t=120s` 可查看；不显示 `Infinity`；不写 `duration`。
9. 500+ 节点：只渲染可见节点；滚动/缩放不卡死；组头计数正确。
10. 切换片段：视口/折叠/过滤按 clipKey 恢复；不串用。
11. 属性面板：没有标尺、没有节点轴、没有视口控制；只显示静态值/在效果面板入口。
