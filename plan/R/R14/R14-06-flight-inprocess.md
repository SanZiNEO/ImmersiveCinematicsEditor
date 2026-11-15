# R14-06 飞控进程内适配

> 前置：R14-04 端点可用；R14-05 输入路由可用
> 后续：R14-07 释放、R14-08 垂直切片
> 状态：设计合同；真实飞控未执行时不填 PASS

## 1. 职责

把**现有飞控**接到进程内端点：

- 不新建飞控算法，不改飞行手感、姿态回推、退出写回、HUD 钳制；
- 只把入口从 `WebPreviewScreen.activeScreen` 改为 `EditorFlightControl` + 端点 owner；
- 同一时刻只允许一个 owner；
- `flight.exit` 只发 owner，不广播；
- AUI 关闭/切载体/退世界时，只有 owner 端点触发取消，非 owner 不影响。

R12 的“飞控九槽输入源”仍是编辑器侧暂存面板；R14 只迁移它到 AUI，不改变游戏飞控协议。

## 2. 当前事实

### 2.1 现有飞控

- 主模组 `FlightModeManager` 负责进入/退出/按键/鼠标/姿态。
- `WebPreviewScreen.enterFlightMode` 做逐字段回落；`requestFlightExit` 走 `exit()` 或 `cancel()`。
- 当前 `flight.exit` 语义存在广播风险：非发起窗口可能误写回。
- 当前退出依赖 `WebPreviewScreen.activeScreen`；没有独立 Screen 时入口不完整。
- 姿态状态回推有节流（现有 10Hz）；HUD 有钳制；这些行为不变。

### 2.2 R12 九槽

- R12 已在编辑器侧维护 9 个姿态槽，供模板/关键帧/路径取点。
- 飞控取点仍由游戏内现有飞控产生，编辑器只保存/展示/引用；R14 不新增游戏侧协议。
- AUI 九槽面板属于 R14-09 的 R12 迁移项，不是 R14-06 新功能。

## 3. 方案

### 3.1 合同

`EditorFlightControl`（R1）由主模组实现：

```text
enter(endpointId, x,y,z, yaw,pitch,roll, fov,zoom, absolute) -> boolean + reason
exit(endpointId, record) -> boolean
isActive() -> boolean
ownerEndpointId() -> String/null
state() -> FlightState
```

规则：

- `enter` 只允许一个 owner；重复/冲突返回 false + 原因。
- 逐字段回落与现有 `WebPreviewScreen.enterFlightMode` 一致；不新增字段。
- `exit(record=true)` 走现有 `FlightModeManager.exit()`，向 owner 发 `flight.exit{cancelled:false}`。
- `exit(record=false)` 走现有 `cancel()`，向 owner 发 `flight.exit{cancelled:true}`。
- 非 owner 调用 `exit` 返回 false，不改状态，不发消息。
- 非 owner 端点关闭不取消飞控；owner 关闭时由宿主取消并恢复进入前状态。
- 实现不依赖 `activeScreen`；AUI/未来 Fabric 都可以用同一合同。

### 3.2 AUI 侧

```text
点击“进入飞控”
  -> 读取当前选中关键帧/路径的姿态
  -> EditorFlightControl.enter(endpointId, ...)
  -> 成功：状态栏显示 owner；开始收 flight.state
  -> 失败：显示 reason，不进入

退出/取消
  -> F7 / ESC / 面板按钮
  -> EditorFlightControl.exit(endpointId, record)
  -> 只 owner 收到 flight.exit
  -> record=true：写回选中关键帧
  -> record=false：不写回，恢复进入前状态
```

约束：

- AUI 控制器不直接调 `FlightModeManager`；只走 `EditorFlightControl`。
- 不复制飞控算法/姿态插值；不在 AUI 里模拟飞行。
- `flight.state` 100ms 节流；AUI 显示姿态/owner/记录状态。
- 记录写回必须走现有命令/文档层；不直接改文件。
- 九槽只是编辑器暂存；进入飞控时可用槽位作为初始姿态，退出后可存入槽位，不改变游戏协议。
- 飞控激活时 UI 输入让位；退出后恢复原面板焦点。

### 3.3 多端点

| 场景 | 行为 |
|---|---|
| A 端点进入飞控，B 端点关闭 | B 关闭不取消 A 的飞控；B 不收到 `flight.exit` |
| A 端点关闭（owner） | 取消飞控；只向 A 发 `flight.exit{cancelled:true}`；不向 B 发 |
| A 退出记录，B 仍开 | 只向 A 写回；B 不写回 |
| A 进入失败（已有 owner） | 返回 false + owner 信息；不抢占 |
| 世界退出 | 取消当前 owner；清理所有端点；不写回半次 |

### 3.4 HUD/画面

- 飞控中 HUD 仍按现有规则渲染；不额外隐藏/显示。
- 中央画面仍来自 `CaptureHub` GPU 纹理；飞控改变相机，纹理随之更新。
- 飞控退出后画面回到编辑器播放/暂停状态，不残留飞行姿态。
- 不把编辑器 UI 画进捕获画面。

## 4. 输入输出

### 4.1 输入

- `EditorFlightControl` 合同（R1）。
- 现有 `FlightModeManager`、逐字段回落逻辑、`flight.exit` 语义。
- AUI 选中关键帧/路径/九槽姿态。
- R14-05 键位/鼠标路由。

### 4.2 输出

- AUI 可进入/退出/取消飞控。
- `flight.state` 100ms 推送；owner 显示。
- 退出记录写回选中关键帧；取消不写回。
- 多端点只影响 owner；无广播。
- 关闭/世界退出无残留。

### 4.3 禁止

- 把飞控描述成 R14 新功能；飞控早已存在。
- 改飞控算法/回推频率/退出写回/HUD 钳制。
- 用 `WebPreviewScreen.activeScreen` 作为 AUI 飞控入口。
- `flight.exit` 广播。
- 非 owner 关闭取消飞控。
- 在 AUI 里模拟飞行或伪造姿态。

## 5. 验收

### 5.1 正例

**正例 A**：AUI 选中关键帧 → 进入飞控 → 游戏画面可操控；状态栏显示 owner。

**正例 B**：`flight.state` 100ms 更新；姿态与游戏内一致；不卡顿。

**正例 C**：F7/记录退出 → 选中关键帧写回；重开脚本值一致；`flight.exit{cancelled:false}` 只到 owner。

**正例 D**：ESC/取消 → 不写回；恢复进入前姿态；`flight.exit{cancelled:true}` 只到 owner。

**正例 E**：A 飞控中 B 关闭 → A 仍飞控；B 不收到 exit；A 退出只写 A。

**正例 F**：A 关闭（owner） → 飞控取消；B 不受影响；无广播。

**正例 G**：世界退出 → 飞控取消；无残留；重进世界可再次进入。

**正例 H**：九槽作为初始姿态/保存点可用；不改变游戏飞控协议。

### 5.2 反例

| 反例 | 判定 |
|---|---|
| AUI 直接 `FlightModeManager` | 失败：绕过 owner/合同 |
| `flight.exit` 发给所有端点 | 失败：非 owner 误写回 |
| B 关闭取消 A 飞控 | 失败：越权释放 |
| 取消却写回关键帧 | 失败：记录语义错误 |
| 进入飞控后 UI 仍可点击/移动 | 失败：输入未让位 |
| 飞控中画面静止 | 失败：相机/捕获未更新 |
| 把九槽说成新飞控协议 | 失败：越界 |

### 5.3 执行记录

| 项 | 结果 | 证据 |
|---|---|---|
| 进入/状态 | NOT RUN | 待执行 |
| 记录退出写回 | NOT RUN | 待执行 |
| 取消不写回 | NOT RUN | 待执行 |
| 多端点 owner | NOT RUN | 待执行 |
| 关闭/世界退出 | NOT RUN | 待执行 |
