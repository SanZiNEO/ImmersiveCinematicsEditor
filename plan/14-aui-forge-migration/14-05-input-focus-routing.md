# 14-05 输入、焦点与按键路由

> 状态：未实现（仅计划；14 是 13 通过后的迁移执行轮）
> 轮次：14-aui-forge-migration
> 前置：`../13-webui-acceptance-release/README.md` 全部出口通过；14-01/14-02 可用
> 关联：`README.md`、`14-02-aui-host-screen.md`、`14-06-flight-mode-inprocess.md`、`14-07-teardown-carrier-consistency.md`、`14-09-full-feature-migration.md`、`../03-host-transport/03-10-editor-package-lifecycle.md`

## 1. 职责

冻结游戏内编辑器的输入路径：AUI 的键盘/鼠标 mixin 如何把事件派发给编辑器 Document；`Screen` 层的编辑器键/ESC/飞控键如何与 AUI 事件共存；玩家输入是否被屏蔽；焦点/文本输入；关闭时释放按键状态。本任务不实现飞控逻辑（14-06）与画面（14-03）。

**键位决策**：13 已验收 WebUI 的 F9 打开路径；14 不改变既有 WebUI 键位语义。游戏内编辑器使用独立默认键 **F8**（可在配置中改），F9 仍打开 WebUI 预览屏；两者都经统一入口/总开关门禁。若未来产品要求 F9 切换为 ingame，必须同时回归 WebUI 的 F9 行为并更新 13/14 验收，不得在 14 中无声改键。

## 2. 现有事实（源码锚点）

| 事实 | 锚点 | 说明 |
|---|---|---|
| AUI 键盘 mixin | `AUI:mixin/KeyboardHandlerMixin.java:14-20` | `KeyboardHandler.keyPress` HEAD → `FabricInput.keyPress`（Forge 同名实现）→ 返回 true 则 cancel |
| AUI 鼠标 mixin | `AUI:mixin/MouseHandlerMixin.java:14-22` | `MouseHandler.onPress` / `onScroll` → `FabricInput.mouseButton/mouseScroll` |
| AUI 输入入口 | `AUI:client/Client.java:124-180` | `handleKeyInput`、`handleMouseButton`、`handleMouseScroll` |
| 键盘处理 | `AUI:render/Operation.java:177-507` | 遍历 `Document.getAll()`；`keydown` 事件；焦点元素文本编辑/按钮/Select；`documentCanceled` |
| 键盘释放 | `Operation.java:508-517` | 遍历所有 Document 派发 `keyup` |
| 字符输入 | `Operation.java:152-175` | 焦点文本元素/Iframe 插入字符 |
| 鼠标按下/释放 | `Operation.java:41-74` | `MouseEvent.tiggerEvent`；`isNativeConsumed` |
| 滚轮 | `Operation.java:117-125` | `MouseEvent("wheel")` |
| 鼠标派发 | `AUI:event/MouseEvent.java:92-118` | 按 `DocumentLayerOrder.frontToBack` 遍历；`interceptsMouseEventsAt`；`consumeNative` |
| 文档级鼠标拦截 | `MouseEvent.java:126-146` | `hitTest` → `triggerResolvedEvent`；`consumeNative` |
| 屏幕鼠标拦截 | `Operation.java:136-139` | `shouldBlockScreenMouseEvents`（配置 + 鼠标 grabbed） |
| Screen 键盘 | `AUI:screen/ApricityScreen.java:162-180` | reload 键、Ctrl 缩放；其余 `super.keyPressed` |
| Screen 鼠标 | `AUI:screen/ApricityScreen.java`（未重写 mouse*） | 由 `Screen` 默认 + AUI mixin 处理 |
| 主模组键位 | `MOD:control/CinematicKeyBindings.java:29-48` | F9 `EDITOR_WEBUI_OPEN`、F7 `EDITOR_FLIGHT`、飞控键、ESC 处理在 `WebPreviewScreen` |
| 主模组 F9 打开 | `CinematicKeyBindings.java:67-73` | `while (EDITOR_WEBUI_OPEN.consumeClick())` → `new WebPreviewScreen()`；500ms 冷却 |
| WebPreviewScreen 按键 | `J:webui/WebPreviewScreen.java:108-159` | F9/ESC 关闭；飞控中 ESC 取消；F7 退出；飞控按键转发 |
| 飞控按键转发 | `MOD:control/FlightModeManager.java:81-89` | `onKeyEvent`/`onMouseMove` |
| AUI 焦点 | `AUI:init/Document.java`（`getFocusedElement`/`clearFocus`） | 文本/按钮焦点 |
| AUI 文档卸载 | `Document.java:766-799` | `focus.clearFocus()`、`setPressedElement(null)`、`setPreviousCursorElement(null)` |
| AUI 鼠标 grabbed 判断 | `AUI:spi/AuiClientService.java:69-72` | `isMouseGrabbed()` |
| AUI 配置 | AUI jar `apricityui-client.toml`（`forge/run/config/apricityui-client.toml`） | `blockMouseEventsWhenCursorHidden` 等 |
| 原版 HUD 条件 | `MOD:plans/0.3.6/Z-editor/README.md` §8.3.1 | `screen != null` 时 HUD 照常渲染 |
| 统一入口/模式 | `../03-host-transport/03-10-editor-package-lifecycle.md` §4.1–4.2 | 总开关、模式、按需生命周期 |

**已核对的缺口**：

1. **两套入口冲突**：主模组 `CinematicKeyBindings` 的 F9 直接打开 `WebPreviewScreen`（`CinematicKeyBindings.java:67-73`）；游戏内编辑器需要独立键（默认 F8）或统一入口分流，当前没有。
2. **AUI mixin 先于 Screen**：AUI 在 `KeyboardHandler.keyPress` HEAD 派发给所有 Document；若编辑器 Document 消费了编辑器键/ESC，`Screen.keyPressed` 收不到。需要确认 AUI 是否消费 F8/ESC（`Operation.onKeyPressed` 只对焦点元素/文本键消费，普通键不 cancel；但 `keydown` 事件可被页面 `preventDefault`）。
3. **玩家输入**：`Screen` 打开时原版玩家移动是否停止取决于 `Minecraft` 的输入 tick；`ApricityScreen.isPauseScreen=false` 不会暂停游戏。需要实测；若仍驱动玩家，需在 `Screen` 层吞移动键/清空输入，不能改玩家持久状态。
4. **飞控键**：`WebPreviewScreen` 用 `CinematicKeyBindings` 的 KeyMapping 匹配；游戏内编辑器需要同样的键位与转发，但 `EditorAuiScreen` 没有这些处理。
5. **ESC 语义**：飞控中 ESC = 取消并恢复；非飞控 = 关闭编辑器。当前只在 `WebPreviewScreen` 实现。
6. **鼠标 grabbed**：编辑器打开时鼠标应释放（可见光标）；`ApricityScreen` 没有显式 `setMouseGrabbed(false)`；依赖 `Screen` 默认。
7. **焦点与 AUI 文本输入**：编辑器输入框（脚本名、数值）依赖 AUI 的焦点/文本编辑；需要确认 `keyPressed` 不被 Screen 抢走。
8. **关闭时按键状态**：飞控中关闭需 `FlightModeManager.cancel()`；否则按键状态/光标可能残留。
9. **AUI 的 `shouldBlockScreenMouseEvents`**：配置开启且鼠标 grabbed 时，screen 文档不接收鼠标事件；编辑器需要鼠标可见，否则 UI 无法点击。
10. **没有编辑器键的开关门禁**：关闭总开关后键仍可能触发；必须在处理器首行检查 `EditorHostApi.isEnabled()/modes()`。
11. **没有 AUI 元素事件绑定层的输入规则**：14-09 的面板（表格/滑块/文本/树）需要统一的焦点/键盘导航，不能各写一套。

## 3. 差异与提案

### 3.1 现状 vs 目标

| 项 | 现状 | 目标 |
|---|---|---|
| 编辑器入口 | F9 直接开 WebUI 预览屏 | F8 打开 ingame；F9 保持 WebUI；两者经 `EditorManager`/总开关 |
| ESC | 仅 `WebPreviewScreen` | `EditorAuiScreen`：飞控中取消，否则关闭 |
| 飞控键 | 仅 `WebPreviewScreen` | `EditorAuiScreen` 转发到 `FlightModeManager` |
| 玩家输入 | 依赖原版 | 明确验证；必要时在 Screen 层吞移动键/清空输入 |
| 鼠标 | 依赖 Screen 默认 | 显式释放光标；确认 AUI `blockMouseEventsWhenCursorHidden=false` 或等价 |
| 焦点 | AUI 默认 | 编辑器输入框可获得焦点；Screen 不抢文本键；面板统一键盘规则 |
| 关闭 | 无 | `EditorTeardown` 取消飞控、清焦点、恢复光标/按键 |
| 总开关 | 无 ingame 门禁 | 键处理器首行读 `isEnabled()/modes()`；关闭态无动作 |

### 3.2 拟新建（提案）

- `INGAME:forge/src/main/java/com/immersivecinematics/editor/client/EditorKeyBindings.java`
  - 注册 `EDITOR_INGAME_OPEN`（默认 F8，可配置）；`consumeClick` → `EditorScreens.open()`。
  - 处理器首行：`EditorHostApi.isEnabled()` 且 `modes()` 含 `INGAME`；否则消费/忽略，不打开。
  - 与主模组 `CinematicKeyBindings` 协调：不修改主模组 F9 语义；F9 仍打开 WebUI；F8 只属于 ingame。
  - Forge KeyMapping 在客户端初始化注册一次（框架限制）；“关闭时不注册”通过处理器门禁实现为“无入口效果”。若实现能在启动时按开关跳过注册，则同时满足更严格解释；两种都必须保证关闭态不可打开。
- `INGAME:forge/src/main/java/com/immersivecinematics/editor/client/EditorInputRouter.java`
  - `keyPressed/keyReleased`：ESC/F8/F7/飞控键；其余交给 AUI。
  - `mouseClicked/mouseDragged/mouseReleased/mouseScrolled`：交给 AUI（不重写）。
  - 焦点/文本输入：不拦截；依赖 AUI；面板键盘导航统一规则。
  - 玩家输入：必要时吞移动键/清空 `Minecraft.player.input`（不持久化）。
- `INGAME:forge/src/main/java/com/immersivecinematics/editor/client/EditorFocusPolicy.java`（提案，可选合并到 InputRouter）
  - 文本焦点时：ESC 先失焦（若 AUI/产品要求）还是关闭；飞控中 ESC 取消；避免双重处理。
- **不新建**第二套输入框架；不复制 AUI 的 `Operation`/`MouseEvent`。

## 4. 输入输出与字段约束

### 4.1 键盘

| 键 | 非飞控 | 飞控中 |
|---|---|---|
| F8（ingame 编辑器键） | 关闭编辑器 | 关闭编辑器（先取消飞控） |
| F9（WebUI） | 保持 13 的 WebUI 打开行为；ingame 不消费 | 同左 |
| ESC | 非飞控先取消当前节点/片段/停靠拖动或弹层，再按4.4处理文本/关闭；一次只消费一层 | 取消飞控并恢复；再按ESC回UI关闭流程 |
| F7 | 退出飞控（若激活） | 退出飞控 |
| 飞控光学/缩放/滚转/模式/重置 | — | 转发 `FlightModeManager.onKeyEvent` |
| 文本键 | AUI 焦点元素处理 | 不转发（飞控接管） |

约束：AUI 先派发 `keydown`；若页面 `preventDefault`，Screen 不再处理；编辑器不得同时让 AUI 与 Screen 处理同一键（避免双触发）。F8/F9 的 `consumeClick` 每次只消费一次；Screen 的 `keyPressed` 不重复打开。

### 4.2 鼠标

- 编辑器打开时鼠标可见、可点击；`Screen` 默认释放光标；必要时显式 `setMouseGrabbed(false)`/等价。
- AUI 的 `MouseEvent.tiggerEvent` 按文档层级派发；编辑器页面元素可点击/滚动/拖拽。
- 飞控中鼠标用于视角（`FlightModeManager.onMouseMove`）；编辑器 UI 不应同时接收鼠标（飞控接管）。
- 关闭时恢复光标（`FlightModeManager.cancel()`/`unlockCursor`）。
- 面板拖动/停靠（14-09/05-22）使用 AUI 鼠标事件；不与飞控同时启用。

### 4.3 玩家输入

- 编辑器打开时玩家不应被 WASD/空格/Shift 驱动。
- 若原版仍处理，需在 `EditorAuiScreen` 的 `keyPressed` 中吞掉移动键，或在打开时清空 `Minecraft.player.input`；不得修改玩家状态持久化。
- 飞控中玩家输入由 `FlightController` 接管（`FlightModeManager.onKeyEvent`），不走原版移动。
- 验收必须实测（不能假设 `isPauseScreen=false` 就自动屏蔽）。

### 4.4 焦点/文本

- 编辑器输入框（文本/数值）点击后获得 AUI 焦点；`keydown` 由 AUI 文本编辑处理。
- Screen 不抢 `A-Z/0-9/空格/标点` 等文本键（`Operation.shouldConsumeTextEntryKey` 已处理）。
- 文本焦点时 ESC 行为必须唯一：建议先失焦并消费 ESC，再次 ESC 才关闭；或按产品定义关闭。无论哪种，不能同时失焦+关闭+取消飞控。
- 关闭时 `Document.disposeLifecycle` 清焦点（`Document.java:788-790`）；`EditorTeardown` 也显式清本 Screen 的 pending 输入。
- 14-09 的面板统一键盘规则：Tab/Shift+Tab、方向键、Enter、Esc；不各写一套。

### 4.4a 定制面板输入作用域

按[C17](../shared/effect-controls-workspace.md)区分mainTimeline、effectControls、properties、dock、dialog与游戏飞控。EditorInputRouter从实际焦点panelId/活动手势分派：主轴只做片段编排；clip.effects消费属性/节点选择、复制粘贴、删帧、局部缩放/滚动；selection.properties只做当前目标的值输入和reveal，不设第二节点轴。Delete在效果控件删所选节点，不在主轴误删片段；IME/文本输入优先于全局键。

指针按下后由当前手势持有到释放/取消，节点拖动不触发片段移动或面板停靠；停靠仅标题开始。Esc/失焦/丢指针/卸载清临时预览、释放捕获，不提交半次命令。局部节点轴与主轴滚轮缩放各自拥有视口，不能一滚同时改变两轴。飞控激活时依原排他所有权接管，退出后恢复正确面板焦点而非任意旧属性。

### 4.5 关闭/禁用

| 场景 | 行为 |
|---|---|
| 关闭 Screen | 取消飞控（若 owner）、清焦点、恢复光标、释放按键状态；`EditorTeardown` |
| 总开关关闭 | 键处理器不再打开；已打开则关闭并释放；不注册新入口 |
| 世界退出 | 同关闭；不依赖按键 |
| 切换载体 | 先关闭当前 Screen；F9/F8 处理器不双开 |
| 关闭后再次打开 | 重新建立焦点/按键状态；不复用旧 Screen |

### 4.6 错误

| 场景 | 行为 |
|---|---|
| F8 在标题界面 | 不打开；不报错/或状态提示 |
| 总开关关闭按 F8 | 无动作；不创建 Screen/端点 |
| 页面元素缺失 | 显示错误页；输入不崩溃 |
| AUI 与 Screen 双触发 | 记录诊断；修正为单一路径；验收失败 |
| 飞控中鼠标同时操作 UI | 不允许；输入路由在飞控中独占鼠标 |
| 文本输入被 Screen 抢 | 验收失败；修正 `keyPressed` 优先级 |
| 关闭后光标仍 grabbed | 验收失败；修正恢复顺序 |

## 5. 修改步骤

1. 确认键位：F8 ingame、F9 WebUI；写入 `EditorKeyBindings` 与配置；不改主模组 F9 语义。
2. 实现 `EditorInputRouter`：ESC/F8/F7/飞控键；其余交给 AUI。
3. 飞控中把键盘/鼠标转发给 `FlightModeManager`；退出时恢复。
4. 验证玩家输入不被驱动；必要时吞移动键/清空输入。
5. 验证 AUI 文本输入/按钮点击/滚动；确认 `blockMouseEventsWhenCursorHidden=false` 或等价。
6. 统一面板键盘规则（14-09 复用）；文本焦点 ESC 行为唯一。
7. `EditorTeardown` 取消飞控、清焦点、恢复光标/按键。
8. 关闭总开关时键处理器首行拒绝；14-08 验证。

## 6. 禁止修改

- 不改 AUI 的 mixin/`Operation`/`MouseEvent`。
- 不在 `Screen.keyPressed` 里重复处理 AUI 已消费的键。
- 不把玩家输入状态写入脚本/存档。
- 不在飞控中同时让编辑器 UI 接收鼠标。
- 不新增第二套键位注册（复用 `KeyMapping`）。
- 不改变 WebUI F9 的既有语义而不回归 13；不在 14 无声改键。
- 不用“总开关关闭时键仍注册但偶尔不触发”冒充门禁；关闭态必须无打开效果。

## 7. 两分支承载

| 分支 | 承载 |
|---|---|
| 编辑器 `1.20.1` | `EditorKeyBindings`、`EditorInputRouter`、焦点策略 |
| 编辑器 `webui` | 不承载；前端自己处理快捷键（`App.vue`） |
| 主模组 `main` | `CinematicKeyBindings`（F9/F7/飞控键）；ingame 不修改 F9 语义；统一入口门禁 |

## 8. 前置

- 14-02 的 `EditorAuiScreen`。
- 14-06 的飞控进入/退出。
- AUI 1.3.1 的输入 mixin 与 `ApricityScreen` 行为（已核对源码）。
- 03-10 的总开关/模式门禁。

## 9. 正反例验收

**正例 A**：编辑器打开，鼠标可见；点击页面按钮/输入框有响应；WASD 不移动玩家。
**正例 B**：ESC 关闭编辑器；再次 F8 打开；飞控中 ESC 先取消飞控、再按 ESC 关闭。
**正例 C**：飞控中 F7 退出；光学/缩放/滚转键生效；退出后编辑器 UI 恢复接收鼠标。
**正例 D**：文本输入框获得焦点，输入 `A-Z/0-9` 不被 Screen 抢走；Enter/ESC 行为符合 4.4。
**正例 E**：关闭后光标恢复、焦点清空；再次打开无残留按键。
**正例 F**：总开关关闭按 F8 → 无 Screen/无端点/无帧源；F9 的 WebUI 行为按 13 基线仍可用。
**正例 G**：飞控中鼠标只控制视角，不点击 UI；退出后恢复。
**正例 H**：14-09 的面板统一 Tab/方向键/Enter/Esc 行为；无面板各写一套。
**正例I**：分别在主轴片段、效果控件节点、快捷属性文本及面板标题拖动，只有当前作用域响应；多组效果行仍可见，Esc取消一次不顺带关闭编辑器，中文组合输入不触发删帧/删片段。

**反例 A**：AUI 与 Screen 同时处理 F8 → 打开又立刻关闭（双触发）；验收不通过。
**反例 B**：编辑器打开时 WASD 仍驱动玩家 → 验收不通过。
**反例 C**：飞控中鼠标同时操作 UI 与视角 → 验收不通过。
**反例 D**：关闭后光标仍 grabbed/隐藏 → 验收不通过。
**反例 E**：输入框无法输入（Screen 抢键）→ 验收不通过。
**反例 F**：总开关关闭仍能打开/仍注册入口 → 验收不通过。
**反例 G**：把 F9 从 WebUI 改成 ingame 且未回归 13 → 验收不通过。

## 10. 真实游戏冒烟（未执行）

前置：Forge 1.20.1 dev run + AUI 页面 + 14-02/14-06。

1. 打开编辑器，点击按钮/输入框/滚动列表。
2. 按 WASD/空格/Shift，确认玩家不移动。
3. ESC/F8/F9/F7 与飞控键逐项测试；确认无双触发、F9 仍按 13 打开 WebUI。
4. 关闭后检查光标/焦点/按键状态。
5. 飞控中鼠标视角与退出恢复。
6. 关闭总开关，确认 F8 无动作；F9 的 WebUI 路径仍可用。
7. 14-09 阶段验证面板键盘导航。
8. 按4.4a人工走主轴/效果节点/快捷属性/停靠/弹层/飞控切换、IME、指针取消与双轴缩放，核对命令目标、一次提交和焦点恢复。

**本轮未执行**：无 Forge 运行环境；以上为 14-08 统一冒烟的一部分。

## 11. 完成定义

- F8（ingame）/F9（WebUI）/ESC/飞控键的分流与转发明确；无双触发；不无声改变 13 的 F9 语义。
- 玩家输入、鼠标 grabbed、焦点/文本输入、关闭恢复四项有正反例。
- 总开关关闭态无入口效果；打开态按需建立输入资源。
- 不复制 AUI 输入框架；不改 AUI 源码。
- 面板键盘规则统一，供 14-09 复用。
- 未执行的真实冒烟明确标注。
