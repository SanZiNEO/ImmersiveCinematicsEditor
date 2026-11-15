# 03-05 文档状态与命令撤销

## 目标

把编辑器状态分四层，给一个统一的写入口 `commit`，一个动作一个快照，失败全回滚。

## 四类状态（物理分开）

| 层 | 内容 | 写盘 |
|---|---|---|
| `doc` | 要保存的脚本文档 | 是 |
| `session` | 选择、播放头、缩放、轨道可见/锁定/静音、marker、A-B 循环 | 否 |
| `derived` | 有限末端、结构 issue、服务端 issue、schema 漂移、预览统计 | 否（可重算） |
| `transport` | 连接、请求/回执、预览帧 | 否 |

关键区分：`session.loopRange`（UI 的 A-B 循环）和 `doc.timeline.loop_start/loop_end`（parser 接受的脚本字段）**不得互写**。

## 命令与 commit

命令是**对象**（不是闭包），如 `{kind:'object.addKeyframe', clipKey, path, time, value}`。

`commit` 顺序固定：

1. 无文档 → 返回失败。
2. `snapshot = structuredClone(doc)`（不用 `JSON.parse(JSON.stringify())`，会丢 `undefined`、把 `NaN` 变 `null`）。
3. `apply(doc, cmd)`，抛错 → 文档还原，返回失败。
4. `enforceStructure(doc)`：clip 按 `start_time` 排序 + 转场对齐 + 引用完整性（`paths[].clip` 等指向存在的片段）。引用断裂 → 回滚，**不静默删条目**。
5. 入撤销栈（超限丢最早），清 redo。
6. `dirty = true`；重算 derived；调度结构检查 + `script.validate`。
7. 调度预览推送（160ms 防抖）。

## 撤销/重做

- 快照式，上限 200（沿用现有值）。
- 只作用 `doc`，不影响 `session`（选择按 03-03 修复）。
- 撤销后把快照重新 `parseDoc` 成文档。
- 打开/新建后 `resetHistory()`。

## 存储约束

- `commit` 不改时间线总时长；对象/帧编辑只改对象，时间轴编辑才改片段末端。
- 命令用对象注册，不用闭包。
- UI 状态只进 `session`，不挂在 `doc` 上。

## 验收标准

- `commit` 加 `yaw` 一帧：`yaw` 帧数 +1、`position.x` 不变、`dirty=true`、撤销栈 +1。
- 连续 3 次 commit 后 undo 3 次，文档回到初始。
- commit 一个会抛错的命令（给 `mode=value` 的 `orient` 加 keyframe）：文档与提交前完全相等、撤销栈不变。
- 移动 `yaw` 第 2 帧到与第 3 帧同时间：`apply` 阶段抛错回滚（同属性时间严格递增），明确报错。
- 文档含 `undefined` 的 `authoring`，`structuredClone` 快照不丢字段。
- `grep 时间线总时长`：0 命中。
