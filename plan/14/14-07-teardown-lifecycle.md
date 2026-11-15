# 14-07 释放、生命周期与载体一致性

> 前置：14-02～14-06 的资源句柄已存在
> 后续：14-08 垂直切片
> 状态：设计合同；关闭/退世界未执行时不填 PASS

## 1. 职责

定义 AUI 编辑器的唯一释放路径：

- Screen 关闭、切载体、总开关关闭、世界退出、页面/端点异常；
- 只释放本端点拥有的飞控、端点、帧租约、输入、Document 注册；
- 重复关闭幂等；
- 不关闭 `CaptureHub`、不停止 WebUI 服务、不影响其他端点/普通脚本播放。

## 2. 当前事实

### 2.1 AUI 关闭顺序

- `ApricityScreen.onClose()` 会发 `unload`、`linkedDocument.remove()`、清 viewport/光标。
- `removed()` 也会 remove；子类必须共用 teardown。
- 子类在 `super.onClose()` 之前访问 `getLinkedDocument()` 才有效；之后可能已 disposed。
- `Document.disposeLifecycle` 清焦点/pressed/hover；但子类资源（端点/租约/飞控）不在 AUI 内。

### 2.2 当前 WebUI 关闭问题

- `WebPreviewScreen.onClose()` 当前无 `closed` 守卫、无 `removed()`。
- 重复关闭可能走 `exitPreview()` 的 else 分支，误停游戏播放。
- 13-06 已把关闭幂等列为修复项；14 的 AUI 不能重犯。

### 2.3 共享资源

- `CaptureHub` 是全局捕获中心；`close()` 清所有消费者、删 FBO/PBO。
- `WebEditorServer` 是 WebUI 传输；ingame 不启动。
- `FlightModeManager` 是全局飞控；只允许一个 owner。
- 其他端点/普通脚本播放不受 AUI 关闭影响。

## 3. 方案

### 3.1 统一 teardown

`EditorTeardown.run(reason)` 必须幂等，顺序固定：

```text
1. 若本端点是飞控 owner：EditorFlightControl.exit(endpointId, false)  // 取消，不写回
2. 停止本 Screen 的输入路由：注销键/鼠标/焦点；清 pressed/hover
3. 停止中央画面绘制；注销 AUI 纹理注册
4. 释放 EditorFrameSource 租约（unregisterGpu；不删纹理）
5. detach 本端点（EditorSessionApi.detach；不 stop 服务）
6. 停本 Screen 的定时器/队列/待处理命令；不提交半次命令
7. 清控制器/面板引用；标记 closed
8. 交给 AUI：super.onClose()/removed() 移除 Document
```

约束：

- `closed` 守卫在入口；重复调用直接返回。
- `onClose()` 和 `removed()` 都调 `EditorTeardown.run(SCREEN_CLOSE)`；两者共用。
- teardown 必须在 `super.onClose()` 之前；不能先让 AUI 移除 Document。
- 步骤 1 只对 owner；非 owner 端点关闭不调用 `exit`，不取消他人飞控。
- 步骤 4 只释放本租约；不 `glDeleteTextures`、不 `CaptureHub.close()`。
- 步骤 5 只 detach 本端点；不 `WebEditorServer.stop()`、不关 8765（ingame 本来就没开）。
- 步骤 6 清理未完成命令；不把半次编辑写盘。
- 步骤 8 之后不再访问 Document/元素。

### 3.2 触发源

| 触发 | 入口 | 行为 |
|---|---|---|
| `F6` 关闭 | `EditorEntry.closeIfOpen(USER)` | 走统一 teardown |
| ESC 关闭 | `EditorAuiScreen.keyPressed` | 飞控中先取消；再关闭 |
| 切载体 | `EditorEntry.setActive`/open 前 | 先关闭当前载体，再打开目标 |
| 总开关关闭 | `EditorHostApi` 监听/统一入口 | 关闭已打开载体；注销入口；不再打开 |
| 世界退出/断线 | 客户端世界卸载钩子 | 关闭 Screen；释放资源；不依赖按键 |
| 页面缺失/端点失败 | `EditorScreens`/错误页 | 关闭；释放；显示原因 |
| 飞控 owner 关闭 | teardown 步骤 1 | 取消飞控；只发 owner 取消 |
| 非 owner 关闭 | teardown 步骤 1 跳过 | 不影响飞控 |

### 3.3 载体一致性

- `EditorEntry` 同一时刻只允许一个打开的载体；`open()` 前若已有打开，先 `closeIfOpen`。
- AUI 关闭后 `EditorEntry.isOpen` 必须为 false；再次 `F6` 可打开。
- `EditorHostApi.modes()` 不因一次关闭而改变；总开关关闭才移除模式。
- `F6` 关闭后不注销全局键位；改绑仍有效。
- 切到 WebUI：AUI teardown 完成后再打开 `WebPreviewScreen`；不两个 Screen 叠加。
- 切到 AUI：先关闭 WebUI，再打开 AUI；WebUI 的 8765/捕获消费者按 13 关闭语义释放。

### 3.4 世界退出/禁用

- 世界退出必须触发 `EditorScreens.closeIfOpen(WORLD_EXIT)`；不能只依赖 Screen 的 `removed()` 偶然调用。
- 总开关关闭：已打开则关闭；不再注册入口/打开 Screen；已有端点全部 detach；不关闭 `CaptureHub`。
- 世界退出后：无 Document、无端点、无租约、无输入监听、无定时器；重进世界可重新打开。
- 不删除用户脚本/配置/模板/字幕工程文件。

### 3.5 错误与幂等

| 场景 | 行为 |
|---|---|
| 重复 `F6` 关闭 | 第二次无操作；不误停播放/飞控 |
| `onClose` 后 `removed` | 第二次 teardown 直接返回 |
| teardown 中端点已关闭 | detach 幂等；不抛错 |
| 租约已释放 | 重复 release 无操作 |
| 飞控已退出 | 重复 exit 不写回、不广播 |
| Document 已移除 | 不再访问元素；错误页不再更新 |
| teardown 异常 | 记录；继续释放剩余资源；不静默吞 |

## 4. 输入输出

### 4.1 输入

- `EditorAuiScreen` 的 `onClose/removed`。
- `EditorCarrier.closeIfOpen(reason)`。
- 端点/租约/飞控/输入句柄。
- 总开关/世界退出钩子。

### 4.2 输出

- 统一、幂等的 teardown。
- 关闭/禁用/退世界后资源清单为 0（本端点）。
- 其他端点/`CaptureHub`/WebUI 服务不受影响。
- 重开/重进世界无残留。

### 4.3 禁止

- 在 `super.onClose()` 之后做 teardown。
- 只重写 `onClose`、不重写 `removed`。
- 关闭时 `CaptureHub.close()`、`WebEditorServer.stop()`、广播 `flight.exit`。
- 非 owner 关闭取消飞控。
- 关闭时写回半次/未完成命令。
- 用“关闭不报错”代替资源已释放。

## 5. 验收

### 5.1 正例

**正例 A**：`F6` 关闭 → 端点 detach、租约释放、纹理注销、输入释放、Document 移除；再次 `F6` 正常打开。

**正例 B**：`onClose` 与 `removed` 都触发 teardown；第二次无操作；无异常。

**正例 C**：AUI 飞控中关闭 → 飞控取消（不写回）；只发 owner；其他端点不受影响。

**正例 D**：AUI 非 owner 关闭 → 飞控继续；A 的 owner 状态不变。

**正例 E**：切到 WebUI → AUI 资源全释放；WebUI 正常打开；无两个 Screen。

**正例 F**：总开关关闭 → AUI 关闭；`F6` 不再打开；`CaptureHub`/WebUI 服务不受影响。

**正例 G**：世界退出 → 无 Document/端点/租约/输入/定时器；重进世界可重开。

**正例 H**：页面缺失/端点失败 → 错误页关闭；资源释放；不崩溃。

### 5.2 反例

| 反例 | 判定 |
|---|---|
| 关闭后 `CaptureHub` 被关闭 | 失败：共享捕获中心被误关 |
| 关闭后 8765 停止 | 失败：ingame 不应管理 WebUI 服务 |
| 关闭广播 `flight.exit` | 失败：非 owner 误写回 |
| 重复关闭误停游戏播放 | 失败：幂等缺失 |
| 世界退出不清理 | 失败：泄漏 |
| 关闭后光标仍 grabbed/按键仍吞 | 失败：输入残留 |
| 关闭时提交未完成保存 | 失败：半次写盘 |

### 5.3 执行记录

| 项 | 结果 | 证据 |
|---|---|---|
| F6 关闭/重开 | NOT RUN | 待执行 |
| onClose/removed 幂等 | NOT RUN | 待执行 |
| 飞控 owner/非 owner | NOT RUN | 待执行 |
| 切载体 | NOT RUN | 待执行 |
| 总开关关闭 | NOT RUN | 待执行 |
| 世界退出 | NOT RUN | 待执行 |
