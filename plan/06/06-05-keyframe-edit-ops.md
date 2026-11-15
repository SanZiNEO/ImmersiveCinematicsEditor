# 06-05 关键帧编辑操作

## 目标

在效果面板完成节点级增删改移、复制粘贴、多选、吸附和撤销，并保证每次编辑后两个面板的归属正确：新增首帧进入效果面板，删空/关闭动画回到属性面板。所有写入走 03 `EditorCommand`，不直接改 JSON。

## 操作表

| 操作 | 入口 | 命令 | 面板变化 |
|---|---|---|---|
| 开动画/建首帧 | 属性面板时钟 | `object.enableAnimation` | 叶子进入效果面板 |
| 当前帧加节点 | 效果行 `◆+`、双击组空白、`K` | `object.addKeyframe` | 已在效果面板 |
| 删当前节点 | 行 `◆-`、节点右键、`Delete` | `object.removeKeyframe` | 删最后一帧 → 回属性面板 |
| 改节点值 | 行值控件 | `object.setKeyframeValue` | 不改归属 |
| 拖节点 | 节点拖动 | `object.moveKeyframe` | 不改归属 |
| 批量拖 | 多选拖动 | `object.moveKeyframes` | 不改归属 |
| 批量删 | 多选 `Delete` | `object.removeKeyframes` | 删空 → 回属性面板 |
| 复制/粘贴 | `Ctrl+C / Ctrl+V` | `object.pasteKeyframes` | 粘贴到无帧叶子 → 进入效果面板 |
| 关动画 | 行菜单 | `object.disableAnimation` | 叶子回属性面板 |
| 移除属性 | 属性面板行菜单 | `object.remove` | 从两个面板消失 |

## 建帧

```ts
addKeyframe({ clipKey, path, time, value? })
```

- 时间取播放头局部秒；精度 `1e-4`；同路径同刻已存在则拒绝 `duplicate_time`，不覆盖、不合并。
- 初值：显式 `value` → 播放头最近节点按 `interp` 采样 → 该属性 `value` → schema `default`；都没有拒绝 `default_missing`。
- 新节点进入 `keyframes[]` 后按时间升序重排；不自动补前后帧，不自动开启 `interp`。
- 首次建帧同时把叶子置为效果面板归属（`keyframes.length>0`）；属性面板行改为“在效果面板”入口。
- `EVENT` 不走此操作；事件记录由 06-07 创建。

## 删帧

```ts
removeKeyframe({ clipKey, path, time })
removeKeyframes({ clipKey, path, times[] })
```

- 精确匹配 `abs(node.time-time)<=1e-4`；找不到返回 `not_found`，不静默成功。
- 单删/批删原子提交；批删部分失败整次回滚。
- 删除后允许 `keyframes=[]`；不自动删 `AnimObject`，不自动改 `mode`。
- `keyframes=[]` 时：
  - 保留最后节点的 `value` 作为静态值；若没有节点值，用原 `value`/default。
  - 叶子移回属性面板；效果面板行消失；选择从 `node` 退回 `leaf`。
  - 属性面板显示“动画轨道无帧”，时钟仍开；再建首帧回到效果面板。
- `EVENT` 删除唯一记录被拒绝 `event_requires_record`；事件永远留在效果面板。

## 改值

```ts
setKeyframeValue({ clipKey, path, time, value })
```

- 只改命中的节点 `value`；不改时间、不改其他节点、不改 `interp`。
- 类型/范围校验同 06-03；失败不写文档。
- 连续输入合并为一次撤销：同一节点 600ms 内连续提交合并；失焦/回车结束合并。
- 播放头无节点时不允许直接改“当前值”；必须先建帧（06-03 的草稿 + 添加帧）。

## 拖节点

```ts
moveKeyframe({ clipKey, path, fromTime, toTime })
moveKeyframes({ clipKey, path, moves: {fromTime,toTime}[] })
```

- 拖动中只更新预览 `x`，不写文档；松手一次提交。
- 目标时间 `toTime` 四舍五入到 `1e-4`；同路径目标已存在则拒绝 `duplicate_time`，不插入、不覆盖。
- 不钳制到 `[0,duration]`：轴内/轴外都可拖；`t<0` 拒绝 `negative_time`。
- 跨属性拖动：不改路径；目标属性必须同类型；只允许拖到同类型行。跨类型拒绝 `type_mismatch`。
- 多选拖动：所有节点同一 `deltaTime`；任一时段冲突整次拒绝；不部分移动。
- 拖动时播放头不动；松手后选择保留在新时间。
- 拖动结束不自动添加/删除节点，不自动改 `duration`。

## 复制/粘贴

```ts
copyKeyframes(selection): KeyframeClipboard
pasteKeyframes({ clipKey, path, anchorTime, mode:'merge'|'replace' })
```

- 剪贴板结构：`{path,type,interp,anchorTime,points:{offset,value}[]}`；只存值和时间偏移，不存 `clipKey`。
- 粘贴目标为当前选中叶子；类型必须匹配。
- `merge`：按 `anchorTime+offset` 插入；同刻冲突拒绝整次粘贴。
- `replace`：确认后删目标叶子全部节点，再插入；一次撤销。
- 粘贴到 `keyframes=[]` 的叶子：直接进入效果面板；粘贴到 `VALUE`/`STRUCT` 拒绝 `mode_not_animatable`。
- 不跨 `EVENT` 粘贴普通节点；事件记录单独复制（06-07）。
- 粘贴不改变 `duration`、不改其他叶子。

## 多选

```ts
KeyframeSelection = { clipKey, objectPath, time }[]
```

- `Shift` 同属性范围；`Ctrl/Cmd` 增删；框选只选矩形内节点。
- 选择跨属性时，批量操作只作用于同一属性；跨属性 `Delete` 分属性原子提交，任一失败整批回滚。
- 选择不接受数组下标；节点移动/撤销后按 `objectPath+time` 重新解析。
- 选择变化只改高亮和属性面板摘要，不切单属性页、不重建面板。
- 点击组空白只移播放头，不清空选择；点击面板空白清空节点选择。

## 吸附

- 吸附源：同片段其他节点时间、播放头、标尺刻度、片段起止、标记时间。
- 吸附阈值：`6px` 对应的秒数；按住 `Alt` 临时关闭。
- 吸附只改预览；提交时用吸附后的时间。
- 多选拖动以主节点吸附，其他节点保持相对偏移。
- 吸附不跨片段；不把轴外节点吸到片段末端。

## 撤销与冲突

- 一次拖拽/一次批删/一次粘贴 = 一个命令 = 一个撤销项。
- 连续改值 600ms 合并；切换节点/失焦/回车结束合并。
- 命令失败：文档不变、撤销栈不变、选择不变、草稿保留。
- 撤销后按 `clipKey` 重取片段；若面板归属变化（例如恢复首帧），行在两个面板间迁移并滚动到对应位置。
- 重做同样重算归属；不缓存 `EffectGroup`，每次按当前文档重算。
- 保存前不要求关闭动画；`keyframes=[]` 可保存，重开仍为静态行。

## 面板迁移矩阵

| 操作前 | 操作 | 操作后 | 归属 |
|---|---|---|---|
| 属性面板，无帧 | 时钟 | 有 1 帧 | 效果面板 |
| 属性面板，`keyframes=[]` | 加首帧 | 有 1 帧 | 效果面板 |
| 效果面板，1 帧 | 删唯一帧 | `keyframes=[]` | 属性面板 |
| 效果面板，N 帧 | 删到 0 帧 | `keyframes=[]` | 属性面板 |
| 效果面板，N 帧 | 关动画 | `keyframes=[]` + 静态值 | 属性面板 |
| 属性面板，无帧 | 粘贴节点 | 有帧 | 效果面板 |
| 效果面板，有帧 | 撤销到无帧 | `keyframes=[]` | 属性面板 |
| 属性面板，无帧 | 撤销到无对象 | `present=false` | 属性面板未设置 |

迁移不改变 `Selection.clipKey/objectPath`；只改 `keyframeTime` 的有无。迁移后滚动到目标面板对应行/组。

## 验收

1. 属性面板点 `position.x` 时钟：播放头建首帧；效果面板出现 x 行；一次撤销回属性面板。
2. 效果面板 `yaw` 有 2 帧，删 1 帧剩 1 帧：仍在效果面板；再删最后 1 帧：回属性面板，显示静态值。
3. 同路径同刻重复建帧：拒绝 `duplicate_time`；原节点不变。
4. 拖节点到另一节点同刻：拒绝；松手后节点回原位；文档不变。
5. 多选跨三行拖动：所有节点同偏移；任一冲突整次拒绝；不部分移动。
6. 复制 `position.x` 两点粘贴到 `position.y`：按偏移插入；类型匹配；一次撤销。
7. 粘贴到 `VALUE` 的 `opacity`：拒绝 `mode_not_animatable`；文档不变。
8. 轴外节点拖回轴内：允许；不钳制；播放头不变。
9. 连续改同一节点 3 次：撤销一次回到最初；撤销栈只加 1 项。
10. 关动画后撤销：帧、效果面板行、节点选择恢复；属性面板行退回“在效果面板”。
11. 删除唯一事件记录：拒绝；事件行仍留在效果面板。
12. `keyframes=[]` 保存重开：属性面板显示“动画轨道无帧”；不丢静态值。
