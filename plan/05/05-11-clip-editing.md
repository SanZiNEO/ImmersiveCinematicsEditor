# 05-11 片段编辑

## 目标

片段级编辑全部走 03 的 `EditorCommand`：移动、跨轨移动、左右裁切、分割、复制/粘贴、删除、循环、波纹删除、顺排。一次拖拽只产生一次撤销；裁切不删除窗口外关键帧；分割给两个新片段稳定 id；被引用片段在删除/分割前预检；不再用 `window.prompt`。

## 命令集

所有命令定义在 03 的 `EditorCommand` 注册表，输入只用 `clipKey` / `trackId` / 秒；不传 `trackIndex`/`clipIndex`。

| 命令 | 参数 | 说明 |
|---|---|---|
| `timeline.addClip` | `trackId, atTime?, duration=5` | 新建片段；字段来自 02 默认；无默认可必填字段时禁用 |
| `timeline.moveClips` | `clipKeys, deltaSeconds, targetTrackId?` | 单/多片段平移；跨轨时目标轨类型必须一致 |
| `timeline.trimClip` | `clipKey, edge: 'left'|'right', newTime` | 左裁切改 start；右裁切改 duration |
| `timeline.splitClip` | `clipKey, splitTime` | 在片段内时间点分割 |
| `timeline.copyClips` | `clipKeys` | 写会话剪贴板，不改文档 |
| `timeline.cutClips` | `clipKeys` | 复制 + 删除；引用预检同删除 |
| `timeline.pasteClips` | `targetTrackId?, atTime` | 粘贴新片段，新 id |
| `timeline.duplicateClips` | `clipKeys, atTime` | 复制 + 粘贴到播放头，一条命令 |
| `timeline.deleteClips` | `clipKeys` | 删除；引用检查 |
| `timeline.toggleLoop` | `clipKeys` | 切换 `loop`；不改 duration/count |
| `timeline.rippleDelete` | `clipKeys` | 删除并把同轨后续片段左移 |
| `timeline.compactSelection` | `clipKeys` | 同轨选中片段顺排，去空隙 |

### 新建片段

- 入口：轨道头 `+`、工具栏“新建片段”、右键“在此添加片段”；命令 `timeline.addClip`。
- 目标轨：当前轨道；无轨道 → 禁用并提示“先添加轨道”。
- 位置：该轨最后一个片段的 `end`；空轨用播放头（夹到 ≥0）。
- 时长：默认 5s。
- `playControl`：`start_time=atTime`、`duration=5`、`loop=false`、`loop_count=-1`、`loop_mode="repeat"`。
- `objects`：
  - 只填 02 字段目录中 `required` 且有 `default` 的叶子；
  - `animated` 叶子写 `value=default`，`keyframes` 为空，不补帧；
  - `value` 叶子写 `value=default`；
  - `struct` 叶子按默认原样透传，不展开；
  - 没有默认的必填叶子不猜；`canCreateClip(trackType)` 返回 false，UI/命令禁用并列出缺失字段。
- EVENT / MOD_EVENT：事件记录无法凭空合成 → 默认禁用“新建片段”；提示复制已有片段。
- 新片段 `id` 匹配 `^[A-Za-z0-9_]{1,64}$`，全文档唯一；`clipKey` 新生成。
- 一条 `timeline.addClip` 命令；一次撤销；新建后选中新片段，播放头不变。
- 不写总时长；不补关键帧；不写任何 `requires`/规则/路径。


### 移动 / 跨轨

- `deltaSeconds` 由拖动会话算：`snap(screenDelta / pps)`；结果 `start >= 0`；不限制末端；无限片段可移动。
- 多选移动：所有片段同一 delta；保持相对偏移；若任一在锁定轨道/无效 → 整组拒绝，不部分移动。
- 跨轨：`targetTrackId` 的 `type` 必须与每个片段原轨 `type` 相同；CAMERA→AUDIO 拒绝。多选跨轨要求所有片段同类型且目标同类型。
- 一次拖拽：`pointerdown` 记录原状态 → `pointermove` 只更新 ghost → `pointerup` 发一条 `timeline.moveClips` → `commit` 一次。
- 拖动中 `Esc`：丢弃 ghost，不发命令。
- 移动不删除/不新增关键帧；关键帧相对片段起点保持不变。
- 移动被 `paths/rule_bindings/exit` 引用的片段：允许，但在拖动开始时显示“该片段被引用，移动会改变时序”提示；不阻断。
- 吸附：05-09 的 8px；`Alt` 临时关闭。
- 移动/裁切允许重叠；不写转场参数，不自动对齐。
- 锁定轨道：拖动被拒绝；光标/ghost 显示禁止。

### 裁切

- 左裁切：`newStart` 夹在 `[0, start+duration-0.05]`；`duration = oldEnd - newStart`；`start=newStart`。
- 右裁切：`newEnd` 夹在 `[start+0.05, ∞]`；`duration = newEnd-start`；循环次数不变。
- 无限片段（`duration<0` 或 `loop_count<0`）：右裁切禁用；左裁切允许，仍保持无限。
- 裁切不调用 `ensureBoundaryKeyframes`；不删除窗口外关键帧；不新增关键帧。
- 窗口外关键帧保留在原数组；裁切不裁剪关键帧数组。
- 裁切到与其他片段重叠：允许；重叠由 05-10 显示，不自动推开。
- 被引用片段裁切：允许，显示时序影响提示；不阻断。
- 一次拖拽一条命令；左右手柄各自一条。

### 分割

- 入口：右键“在播放头分割”、`Mod+K`、命令 `timeline.splitClip`。
- `splitTime` 必须严格在 `(start+0.01, start+duration-0.01)` 内；距端点 ≤0.01s → `no_op`，不产生命令。
- 无限片段（`duration<0`）禁止分割：没有有限末端，不能定义右半段；菜单 disabled 并给原因。
- 结果两个片段：
  - 左：`start` 不变，`duration = splitTime-start`，新 `clipKey`；
  - 右：`start = splitTime`，`duration = oldEnd-splitTime`，新 `clipKey`；
  - 其他字段（轨道、loop、对象、规则绑定、exit）复制；`meta.id` 不复制（片段 id 是新生成）。
- 关键帧分配：
  - 按属性组，`t < splitTime` 归左，`t >= splitTime` 归右；
  - 分割点上的关键帧归右；
  - 左侧若某属性没有任何关键帧，保留原属性组最近的前一个关键帧（值延续），不补 0；
  - 右侧若某属性没有关键帧，保留原属性组最近的后一个关键帧；不新增关键帧。
- 引用检查：分割前查 `paths` / `rule_bindings` / `exit` 是否引用原 `clipKey`/片段 id；被引用 → 默认禁止分割，菜单 disabled 并显示引用位置；不提供“强行分割”。
- 分割后选择：默认选中右片段；`clipKeys=[rightKey]`；原片段从选择移除。
- `splitClip` 统一签名 `splitClip(doc, clipKey, splitTime)`；所有调用方走该签名。
- 分割不改总时长；片段末端按新起止派生。

### 复制 / 粘贴

- 复制：把选中片段序列化为会话剪贴板（内存，不写系统剪贴板，不写文件）；含轨道类型、start/duration/loop/对象/关键帧；不含 `clipKey`、不含文档级引用。
- 粘贴：
  - 目标轨：当前选中轨或原轨；类型必须一致；没有目标轨 → 拒绝。
  - 插入时间：播放头；多片段保持相对偏移，最早片段对齐播放头。
  - 新 `clipKey` 全部重新生成；片段 `id` 若与现有重复则生成新 id；对象/关键帧时间相对新起点平移。
  - 粘贴后选中新片段；一条 `timeline.pasteClips` 命令，一次撤销。
  - 粘贴不删除/替换目标位置已有片段；重叠允许，按 05-10 显示重叠区，不静默覆盖。
  - 无限片段可粘贴；循环次数保留。
- 剪贴板跨文档切换保留到会话结束；不写 localStorage。
- 跨文档粘贴：按 02 字段目录校验目标轨道类型/字段；目标缺源字段 → 拒绝并列出缺失路径，不做字段丢弃；字段类型不兼容同样拒绝。
- 粘贴不检查引用（新片段尚未被引用）；粘贴后若 id 与原引用冲突，由 03 校验标 block，不自动改引用。
- 复制一份：`timeline.duplicateClips` 在播放头粘贴一份新片段，不改写会话剪贴板；与“复制→粘贴”结果一致，但只占一个撤销条目。

### 剪切

- 剪切 = 复制到会话剪贴板 + 删除；删除的引用预检同样生效。
- 被引用片段剪切：整组拒绝，不写剪贴板、不删片段；提示引用位置。
- 锁定轨道剪切断：拒绝。
- 一条 `timeline.cutClips` 命令；撤销恢复文档和选择，但剪贴板保留（撤销不自动清剪贴板）。

### 删除 / 波纹删除

- 删除前查引用：`paths[].clip`、`rule_bindings[].clip`、`exit[].target`（按 02/03 的实际字段名）引用该片段 → 整组拒绝；对话框列出引用位置；不提供“强制删除”。
- 多选删除：任一被引用 → 整组拒绝，不部分删除。
- 删除：从文档移除片段；清该片段选择；一条命令；撤销恢复原位置/选择。
- 波纹删除：删除后，同一轨道上 `start > deleted.start` 的片段左移 `deletedEnd - deletedStart`；不跨轨；不移动开始早于删除片段的片段；多条删除按从后往前处理，总位移正确。
- 锁定轨道：删除/波纹删除禁用。
- 无限片段删除：普通删除允许；波纹删除禁用（没有有限末端，不能计算位移），提示“无限片段不能波纹删除”。

### 循环

- 切换 `clip.loop`：
  - `false → true`：`loop` 置 true；若 `loop_count` 缺失/0，置 1；duration 不变。
  - `true → false`：`loop` 置 false；`loop_count` 保留（不重置）；duration 不变。
- 无限片段（`duration<0`）禁止开启循环：本身已无限，循环无意义；菜单 disabled 并给原因。
- `loop_mode` 若字段存在（02 `playControl`）：只显示，不切换。
- 不编辑 `loop_count` 数值。
- 切换后 `clipWindowEnd` 变化，主轴显示/播放头不变；不自动扩展/缩短显示范围。
- 一条命令；多选循环以第一个片段的当前值取反，全部设为同一值（避免混合态）；菜单显示“混合”时先显示当前主选值。

### 顺排

- `timeline.compactSelection`：
  - 按轨道分组选中片段；
  - 每组按 `start` 升序；
  - 第一个片段起点 = 组内最小 start；
  - 后续片段 `start = 前一个 end`；保留 duration；
  - 不移动未选中片段；不改变轨道；不删除空隙外的片段；
  - 跨轨多选各自组独立顺排。
- 无限片段不参与顺排（无法定义 end）；选中含无限 → 整组拒绝并提示。
- 一条命令；一次撤销。

## 引用预检

- 预检数据来自 03 文档模型 + 03 引用完整性；不重新读文件。
- `paths` / `rule_bindings` / `exit` 的引用位置要能显示：`paths[2].clip`、`rule_bindings[0].clip`、`exit.target`。
- 删除/分割：被引用 → block，菜单 disabled，命令拒绝；不自动删引用、不自动改引用。
- 移动/裁切/循环：被引用 → warn，允许，显示“时序变化可能影响规则/路径”；不阻断。
- 复制/粘贴：不预检；粘贴后由 03 校验处理重复 id/悬空。
- 预检不通过时，命令返回 `blocked` + `reasons[]`；不写文档、不进撤销。

## 键盘与撤销

- `Mod+C` 复制、`Mod+X` 剪切、`Mod+V` 粘贴、`Mod+K` 分割、`Mod+D` 复制一份（复制+粘贴到播放头）、`L` 切换循环、`Delete` 删除、`Shift+Delete` 波纹删除、`B` 刀片工具。
- 快捷键在 04-10 注册；焦点在输入框/对话框时不触发。
- 一次拖拽/一次菜单命令 = 一个 undo 条目；连续拖动 100px 不产生 100 条。
- 撤销后选择恢复为该命令前的 `clipKeys`；若片段已不存在，`primary=invalid`。
- 重做不重新发文件 IO；只恢复文档内存状态。

## 验收标准

- 新建片段：CAMERA 轨空轨在播放头 0 建 5s 片段；playControl 五字段正确；required 叶子有默认值；无 keyframes；选中新片段；一次撤销。
- 新建片段：EVENT/MOD_EVENT 轨禁用并提示“事件记录不能凭空生成”；不写假 event。
- 新建片段：required 叶子无默认值 → 禁用并列出缺失路径；不创建半字段片段。
- 移动单片段 2.5s：start 增加 2.5；duration/关键帧相对位置不变；一次撤销。
- 多选 3 片段移动：相对偏移不变；任一锁定 → 整组拒绝，三个都不动。
- CAMERA 跨到 AUDIO：拒绝并提示类型不匹配；同一类型跨轨成功。
- 左裁切 1s：start+1、duration-1；窗口外关键帧仍在；没有新增边界关键帧。
- 右裁切到 0.05s：允许；再往左拒绝；无限片段右裁切 disabled。
- 分割 10s 片段于 4s：左 4s、右 6s；两个新 key；右侧选中；原 key 消失。
- 分割点关键帧：`t=4` 归右；左侧保留前一个关键帧；右侧保留后一个；不新增关键帧。
- 无限片段分割：菜单 disabled；命令拒绝；文档不变。
- 被 `paths` 引用的片段分割：菜单 disabled + 引用位置；命令拒绝；文档不变。
- 复制 2 片段粘贴到播放头：2 个新片段、相对偏移保持、新 id、新 key；一次撤销。
- 剪切未引用片段：剪贴板有 2 个、文档删除；一次撤销恢复文档/选择，剪贴板仍在。
- 剪切被引用片段：拒绝，剪贴板不写、片段不删。
- 粘贴到不同轨道类型：拒绝；不产生半组。
- 跨文档粘贴缺字段：拒绝并列出缺失路径；不做字段丢弃。
- 删除被引用片段：整组拒绝；引用位置可见；不部分删除。
- 波纹删除：同轨后续片段左移删除片段长度；其他轨不动；无限片段波纹删除拒绝。
- 循环切换：false→true 设 count=1；true→false 保留 count；duration 不变；无限片段禁止开启循环。
- 顺排 3 片段：首片段起点为最小 start，后续紧贴；未选中片段不动；无限片段拒绝。
- `splitClip` 调用：`grep splitClip` 只有 3 参数 `doc, clipKey, splitTime`；没有 `trackIndex/clipIndex` 版本。
- `grep ensureBoundaryKeyframes`：裁切/分割路径不补边界帧。
- `grep 总时长字段`：命令/提交路径 0 命中。
- `grep window.prompt`：0 命中。
- 拖拽 100 次 pointermove：undo 栈只增加 1 条。

## 片段编辑范围

- 新建只走 `timeline.addClip` 的 02 默认规则；缺默认可必填字段就禁用。
- 片段时间操作不改关键帧数组、曲线、对象属性。
- 重叠允许；转场/重叠参数不写。
- 轨道增删/排序/重命名在 05-10。
- 被引用片段删除/分割直接拒绝；不自动删规则/路径/exit。
- 不跨类型转换（CAMERA→AUDIO），不猜字段映射。
- 拖动只在松手提交；不逐帧提交。
- 剪贴板是编辑器会话内存，不写系统剪贴板。
- 片段操作不写总时长。
