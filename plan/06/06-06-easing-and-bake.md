# 06-06 段缓动与显式烘焙

## 目标

在效果面板为 `ANIMATED` 叶子的相邻节点段编辑缓动，并把作者态缓动显式烘焙成节点数据。属性面板只显示静态值，不出现缓动入口。保存/推送前如果还有未烘焙段，必须给出可操作的提示，不能把会话态 `authoring` 当成可发布数据。

## 数据结构

```ts
interface EasingAuthoring {
  path: string
  fromTime: number
  toTime: number
  mode: 'linear' | 'bezier'
  handles: { out: { x:number; y:number }; in: { x:number; y:number } }
  revision: number
}

interface SegmentView {
  path: string
  from: ObjectKeyframe
  to: ObjectKeyframe
  interp: 'linear' | 'step' | 'bezier'
  easing?: EasingAuthoring
  baked: boolean
}
```

- 缓动属于“段”，不是单个节点；首节点前、末节点后没有段，不给缓动入口。
- `interp==='step'` 的段不进入贝塞尔编辑；只显示台阶图标。
- `EVENT` 行没有段缓动；事件时长/记录由 06-07 负责。
- `authoring` 只存在 `session`，不写 `doc`、不进 `serializeDoc`。

## 段选择

- 点击两个节点之间的段线选中该段；段线高亮 2px。
- 选中节点不自动选中前后段；选中段不改变节点选择。
- 段选择身份：`{clipKey, objectPath, fromTime, toTime}`；时间变化后按新时间重新解析。
- 同属性段不跨节点；不同属性段不联选。
- 段选择只影响缓动详情，不切单属性页。

## 编辑面板

```text
段  position.x   2.0s → 4.0s
模式  [线性] [贝塞尔]
出把手  x 0.42  y 0.00
入把手  x 0.58  y 1.00
[重置] [应用到同属性后续段] [烘焙此段]
```

- 模式切换：`linear` 保留把手值但灰显；`bezier` 恢复上次把手或默认 `(0.42,0)(0.58,1)`。
- 把手 `x` 限制 `0..1`；`y` 允许 `-2..3`；不自动夹到曲线单调。
- 数值输入失焦提交；拖动把手实时预览，松手一次写 `authoring`。
- `应用到同属性后续段`：只改同属性、同 `interp` 的后续段；一次撤销。
- `重置`：删除该段 `authoring`，回退到节点 `interp` 的默认表现。
- 预览只影响画布/值采样；不写 `doc`、不改节点值。

## 采样

```ts
sampleAnimated(row, time, doc, authoring): number | null
```

- 无 `authoring` 且 `interp==='linear'`：线性插值。
- 无 `authoring` 且 `interp==='step'`：取左侧节点值。
- 有 `authoring`：三次贝塞尔 `x(t)` 求时间、`y(t)` 求值；端点精确返回节点值。
- 采样不修改节点、不生成临时节点、不写缓存到 `doc`。
- 预览播放头、值控件“当前值”、服务端预览共用同一 `sampleAnimated`。
- 采样结果 `null`（无节点/不可采样）时显示“无节点”，不显示 0。

## 烘焙

```ts
bakeSegment({ clipKey, path, fromTime, toTime, sampleRate? })
bakeAnimatedRow({ clipKey, path, sampleRate? })
```

- 烘焙是显式命令，不在保存/推送时自动执行。
- `bakeSegment`：在该段内按采样率插入节点，节点值来自当前 `authoring` 采样；保留原起止节点。
- 默认采样率：按 `pxPerSecond` 与段时长计算，保证每 2px 至少一个采样点；上限 240 点/段；用户可在详情里改 `4..120` 点/段。
- 插入节点后删除该段 `authoring`，段 `interp` 改为 `linear`；原起止节点值不变。
- 烘焙后节点仍属于同一属性、同一效果行；不改变面板归属。
- `bakeAnimatedRow` 烘焙该行全部有 `authoring` 的段；一次命令、一个撤销项。
- 烘焙失败（同刻冲突、类型错误）整次回滚，`authoring` 保留。
- 烘焙不自动改 `duration`、不移动片段、不改其他属性。

## 保存前提示

`serializeDoc` 前扫描 `session.easingAuthoring`：

- 有未烘焙段 → `status` 显示 `有 N 段缓动未烘焙`；保存/推送按钮弹出确认：
  - `烘焙后保存`：执行 `bakeAnimatedRow` 对应段，再序列化。
  - `仅保存节点（丢弃缓动会话）`：确认后清空对应 `authoring`，按节点当前 `interp` 保存。
  - `取消`：不保存、不推送。
- 不把 `authoring` 写进 JSON；保存后重开不恢复贝塞尔把手，只保留烘焙节点。
- 预览推送同样走该检查；不静默丢弃。
- 提示只列受影响的 `path` 和段数，不阻断其他片段保存。

## 与节点编辑的关系

- 增删节点会切断/重建相邻段；受影响段的 `authoring` 失效并从 `session` 移除。
- 拖节点改变段时长；保留把手比例，不自动重采样。
- 改节点值不改变 `authoring`；采样端点取新值。
- 撤销恢复节点和段 `authoring`；重做同样恢复。
- 关闭动画/删最后一帧：该行所有 `authoring` 清除；回属性面板后不再显示缓动。
- 面板归属变化不清除其他属性的 `authoring`。

## 验收

1. 选中 `position.x` 的 2s→4s 段：出现缓动详情；首节点前没有段入口。
2. 切到贝塞尔并拖出把手：预览曲线变化；`doc` 不变；撤销栈不增加（拖动中）。
3. 松手：一次 `authoring` 写入；撤销恢复上一组把手。
4. `interp==='step'` 段：不显示贝塞尔把手；只显示台阶。
5. `EVENT` 行：没有段缓动入口。
6. 烘焙 2s→4s 段：插入采样节点；段变 linear；`authoring` 删除；一次撤销全恢复。
7. 保存时有未烘焙段：出现三选一确认；选“烘焙后保存”后 JSON 只有节点，无 `authoring`。
8. 选“仅保存节点”后重开：贝塞尔把手不恢复；节点值保留。
9. 拖动节点后：相邻段 `authoring` 失效移除；不残留上一版段。
10. 关闭 `position.x` 动画：该行 `authoring` 清除；属性面板无缓动入口。
11. 同一片段两个属性各有未烘焙段：提示列出两条路径；烘焙只影响选中段/行。
