# 05-05 片段编辑（移动 / 裁切 / 分割 / 复制 / 循环 / 波纹）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案）。
> 轮次：05-timeline-workspace。前置：02（编辑命令与历史）、05-03（几何与选区）；同轮：05-04。

## 1. 职责

把 `DragIntent` 与菜单/快捷键意图翻译成 02 的文档命令，并定义每种操作的**可用条件、边界、失败回滚**。所有操作原子提交、可撤销、多目标失败全回滚。

**参考输入**：[Olive时间轴与命令](../references/01-olive-timeline-commands.md)的拖动起始快照、松手单事务、锁定预检、严格内部切点与无变化不入历史。只借命令边界，不引入media_in、GapBlock、覆盖放置或隐式邻段联动。引用影响、属性局部秒、分割规则和失败全回滚均以本文及02/06为准。

## 2. 现状（现有文件 + 符号 + 行）

| 位置 | 事实 |
|---|---|
| `EDITOR:src/operations.ts:79–104` | `addClip`：默认建两个边界关键帧 `[{time:0},{time:duration}]`（旧模型） |
| `EDITOR:src/operations.ts:106–114` | `deleteClip` |
| `EDITOR:src/operations.ts:116–127` | `moveClip` / `moveClips`（`start >= 0`） |
| `EDITOR:src/operations.ts:129–158` | `resizeClipLeft` / `resizeClipRight`（内含关键帧搬移/clamp/补边界） |
| `EDITOR:src/operations.ts:485–560` | `splitClip`：切关键帧、复制到右半、`ensureBoundaryKeyframes` |
| `EDITOR:src/operations.ts:600–608` | `snapAllClips`：顺排 + 转场重叠 |
| `EDITOR:src/store.ts:900–980` | `copySelectedClips` / `cutSelectedClips` / `pasteClips` / `deleteSelectedClips` / `duplicateSelectedClips`（下标 + 偏移 0.5s） |
| `EDITOR:src/components/Timeline.vue:268–336` | 拖拽移动/裁切直接 `commit` |
| `EDITOR:src/components/Timeline.vue:445–463` | `addClipToTrack`：追加到末片段之后，默认 5s |
| `EDITOR:src/components/Timeline.vue:483–497` | `renameTrack` 用 `window.prompt` |
| `MOD:docs/SCRIPT_FORMAT.md:94–105` | 片段白名单 8 键；`duration<0` = 无限单次 |
| `MOD:docs/SCRIPT_FORMAT.md:649–715` | 脚本级 `clips[]`（无 `start_time`）与时间线片段不同 |

## 3. 拟新建（提案）

| 文件 | 导出 | 说明 |
|---|---|---|
| `EDITOR:src/timeline/clipCommands.ts` | `moveClips`、`trimClipLeft`、`trimClipRight`、`splitAt`、`duplicateClips`、`deleteClips`、`pasteClips`、`setClipLoop`、`rippleShift` | 全部返回 `CommandResult`，内部调用 02 |
| `EDITOR:src/timeline/clipRules.ts` | `canMove/canTrim/canSplit/canDelete` | 可用条件（锁定、无限、独立片段、引用占用） |
| `EDITOR:src/timeline/clipboard.ts` | `ClipboardPayload` | 跨文档剪贴板（内存 + 可选本地存储） |
| `EDITOR:src/timeline/ripple.ts` | `planRipple` | 波纹移动/删除的影响面预演 |

## 4. 输入 / 输出 / 字段约束

**输入**：`DragIntent`（`05-03`）、菜单/快捷键意图、当前选区、轨道 UI 状态（锁定/静音）、02 的文档快照。

输出共享命令结果：成功时包含02 Selection/批选和必要定位映射，失败时返回code/message且文档与选择全回滚；不另造SelectionRef数组合同。

**操作约束表**

| 操作 | 允许条件 | 结果 | 禁止 |
|---|---|---|---|
| 移动片段 | 轨道未锁；目标 `start >= 0` | 改 `start_time`；同轨排序；转场对齐由 08 的规则决定（本轮只调用 02 提供的对齐钩子） | 拖到另一轨道（跨轨移动属独立命令，见下） |
| 跨轨移动 | 源/目标轨道类型相同（`type` 决定 `objects` 字段集） | 改 `track` 归属；保留 `clipId` | 把 CAMERA 片段拖到 AUDIO 轨（字段集不同） |
| 裁切左 | 轨道未锁；新起点 < 原末端；`duration > 0` | 改 `start_time` + `duration`；对象节点时间**不**自动平移（局部秒语义） | 把 `duration` 裁成 ≤ 0 |
| 裁切右 | 同上；新末端 > 起点 | 改 `duration`；节点保留，主轴不画节点，由 06 效果控件标「不生效」 | 把超窗口节点删除；把轴外节点塞回主轴显示 |
| 分割 | 切点严格在 `(0, duration)` 内（距端点 > 0.01s）；轨道未锁 | 生成右半片段，`id` 重新分配；被 `paths`/`rules`/`exit.target` 引用的片段**默认禁止分割**，除非 02 提供引用重写 | 分割无限片段（`duration<0`） |
| 复制/粘贴 | 剪贴板非空 | 粘贴到播放头或选中片段之后；偏移量 = 粘贴点，不再额外 +0.5s | 静默覆盖目标位置已有片段 |
| 复制片段 | 同复制+粘贴 | 同上 | — |
| 删除 | 轨道未锁；片段未被引用，或被引用但用户确认级联 | 删除片段；被引用时列影响面 | 静默删除被引用片段导致引用悬空 |
| 循环 | 轨道未锁 | 写 `loop/loop_count/loop_mode`（字段存在时） | 对 `duration<0` 片段设置 `loop` |
| 波纹 | 轨道未锁 | 删除/插入后把后续片段前移/后移相同量 | 波纹跨轨道（本轮不做） |
| 顺排 | 轨道未锁 | 同轨首尾相接（转场重叠按 08 的 B 模型） | 跨轨顺排 |

**字段约束**

- 片段 id：分割/复制产生的新片段必须有新 `id`（`^[A-Za-z0-9_]{1,64}$`，`MOD:docs/SCRIPT_FORMAT.md:700–715` 的 `paths.id` 规则同族）；不得复用旧 id。
- 独立片段（脚本级 `clips[]`）**不出现在时间轴**上；本轮提供「结构实体列表」在行为页（11）展示，避免用户以为它丢了（`shared/product-and-layout.md` §3.4 要求可定位）。
- 剪贴板跨文档时，若目标文档 schema 缺少源字段 → 拒绝粘贴并列出缺失路径，不做字段丢弃。
- 撤销：一次拖拽 = 一次撤销（拖动过程不逐帧入栈）；多选移动 = 一次撤销。
- 批量操作统一预检所有源/目标轨道、边界与引用；任一锁定、越界或冲突都整次拒绝并定位原因，不跳过锁定片段后部分成功。拖动中状态变化时提交前重检，失败恢复文档/选择/临时预览。

## 5. 修改步骤

1. 新建 `clipRules.ts`，从 `Timeline.vue` 的锁定判断（272、287、341）与 `store.ts` 的锁定判断（952–958）抽出。
2. 新建 `clipCommands.ts`，把 `operations.ts:79–158,485–560` 的旧模型实现**替换**为基于 `objects` 的命令（片段编辑只经 02 命令，不在主轴读写对象行）；旧函数保留到 02 迁移完成前，但时间轴不得再调用（编译期用 lint 规则禁止 import）。
3. 新建 `clipboard.ts`：剪贴板存 `{trackType, clip}` 快照 + 源文档 `schemaVersion`（01 的 C01 快照 id）；跨文档粘贴做字段校验。
4. 新建 `ripple.ts`：`planRipple(doc, selection, mode)` 返回受影响片段与位移量，供 UI 预览（虚线残影）与提交共用。
5. 删除 `store.ts:900–980` 的下标剪贴板实现；`App.vue:91–317` 的 Ctrl+C/X/V/D/Delete 键改调 `clipCommands`。
6. `renameTrack`（`Timeline.vue:483–497`）的 `window.prompt` 换成内联可编辑标签（轨道头双击进入编辑态，`Enter` 提交、`Esc` 取消）。
7. 分割/删除前计算引用影响面（`paths[].clip`、`rule_bindings[].clip`、`exit.target`），在确认框列出。

## 6. 禁止修改

- 不实现属性节点编辑（06/07）、转场参数（08）、模板展开（12）。
- 不改 `paths`/`rules`/`rule_bindings` 的结构；引用重写只调用 02 提供的事务。
- 不做「自动补边界关键帧」：新格式没有片段级 `keyframes`，`ensureBoundaryKeyframes` 属旧模型（`operations.ts:565–600`），随 02 迁移删除。
- 不做媒体级 ripple（音画同步、变速）；本轮波纹只作用于片段起点。

## 7. 两分支承载

同一份命令层。差异：游戏内无右键菜单（AUI 右键支持未实证）→ 所有右键项必须在工具栏/快捷键/属性面板有等价入口；确认对话框用自绘层。

## 8. 前置

02 的 `EditorCommand` 与引用完整性检查；05-03 的选区与几何；08 的转场对齐钩子（若未就绪，移动/裁切时跳过对齐并在诊断中提示）。

## 9. 验收

**正例**

1. 拖动片段 2.3s：一次撤销回到原位；撤销后选区仍是该 `clipId`。
2. 裁切右边界使片段从 6s → 4s：窗口外节点保留，主轴片段仍为 4s 且不显示节点；效果控件把 4–6s 的节点标「不生效」，保存后仍在 JSON 中。
3. 分割被 `paths[].clip` 引用的片段：默认禁止，提示「被路径 p1 引用」；用户选择级联后，路径 `from/to` 由 02 重映射或标记需重建。
4. 多选 3 个片段移动：任一目标越界（`start<0`）→ 整次回滚，无部分移动。
5. 复制片段到另一文档：目标文档缺 `cam_breath_*` → 拒绝并列出缺失路径。
6. 无限片段：不可分割、不可设循环，提示原因。

**反例**

1. 拖动过程每帧入撤销栈 → 不通过。
2. 裁切时删除超窗口节点 → 不通过。
3. 分割后新片段沿用旧 id → 不通过。
4. 删除被引用片段后保存，validator 报引用不可解析且无提示 → 不通过。

**真实冒烟**：WebUI 打开 `MOD:cinematics/0.3.6/tests/camera/` 下含 `paths` 的脚本，执行 1–6；保存后 `script.validate` 无新增 issue。

## 10. 完成定义

- 时间轴/快捷键/菜单三处调用同一 `clipCommands`，无第二套实现。
- 每种操作都有可用条件、失败码、回滚路径与引用影响面。
- 旧 `operations.ts` 的片段函数不再被 UI 引用（保留或删除由 02 决定，但本轮必须断开调用）。
- 无 `window.prompt` / `window.alert` 残留在片段操作路径上。
