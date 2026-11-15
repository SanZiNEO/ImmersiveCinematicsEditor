# 04-10 命令、快捷键、焦点与键盘可达

## 目标

键盘输入由“一张命令表 + 一张快捷键表 + 一套焦点作用域”处理。命令是菜单、快捷键、命令面板的唯一入口；快捷键按当前焦点解析，不按 hover；输入法、输入框、弹窗三种守卫必须可靠；没有鼠标也能完成工作台操作。

## 命令注册表

```ts
interface CommandDefinition {
  commandId: string             // 全局唯一，点分命名
  titleKey: string
  category: string
  run(ctx: CommandContext): void | Promise<void>
  enabled?(ctx: CommandContext): boolean
  checked?(ctx: CommandContext): boolean
  menu?: MenuPlacement
  keybinding?: string           // 默认 chord；用户可覆盖
}
```

04 注册的 shell 命令：

| commandId | 作用 | 备注 |
|---|---|---|
| `file.newDoc` | 新建空白脚本 | 走 03 |
| `file.openDoc` | 打开脚本文件 | 走 03/文件端口 |
| `file.saveDoc` | 保存当前文档 | 走 03，等服务端回执 |
| `file.validateDoc` | 校验当前文档 | 走 03 |
| `file.revertDoc` | 从磁盘重载 | 二次确认 |
| `file.closeDoc` | 关闭文档 | 走 UnsavedGuard |
| `edit.undo` / `edit.redo` | 文档撤销/重做 | 走 03；输入框内不拦截 |
| `app.settings` | 打开设置页 | 页面路由 |
| `app.commandPalette` | 打开命令面板 | 最小命令搜索 |
| `workspace.focusNext` | F6 下一个焦点区 | FocusService |
| `workspace.focusPrev` | Shift+F6 上一个焦点区 | FocusService |
| `layout.reset` | 恢复当前页默认布局 | 04-02 |
| `layout.showPanel` | 显示隐藏面板 | 子菜单/命令参数 |
| `theme.pick` | 打开主题选择器 | 04-07 |
| `theme.followSystem` | 切换跟随系统 | 04-07 |
| `window.minimize/maximize/close` | 窗口动作 | 04-09 |
| `help.shortcuts` | 快捷键帮助 | 设置页 |
| `help.about` | 关于 | 设置页 |

约束：

- 菜单、快捷键、命令面板都从同一 `CommandRegistry` 取；不允许菜单自己写 handler。
- `enabled/checked` 在菜单打开前、快捷键执行前求值；求值抛错按 disabled 处理并诊断。
- 04 注册 shell/文档命令；插件命令在自己的 `activate` 里注册，内核不预埋空 handler。
- 命令面板只列已注册且 enabled 的命令；搜索标题/key/category；没有结果显式空态。
- 命令执行失败：错误进诊断/状态区；不静默吞掉，不假装成功。

## 快捷键注册表

```ts
interface KeybindingRule {
  chord: string                 // 'Mod+S' / 'F6' / 'Alt+ArrowLeft'
  commandId: string
  scope: 'global' | 'page' | 'panel' | 'dialog'
  when?: (ctx: KeyContext) => boolean
  priority?: number
}
```

作用域优先级：

```text
dialog > panel > page > global
```

- `global`：保存、撤销/重做、设置、命令面板、F6、帮助；只在没有更高作用域占用时生效。
- `page`：项目页/文档页/设置页自己的导航；例如 `Alt+Left` 返回项目。
- `panel`：面板内部命令；由 `PanelContext` 提供 `data-focus-scope`，按当前焦点解析。
- `dialog`：弹窗/命令面板/确认框；打开时只响应 dialog 与 global 白名单 `Esc`。

04 默认键位（只列 shell）：

| chord | scope | command | 守卫 |
|---|---|---|---|
| `Mod+S` | global | `file.saveDoc` | 输入框内也拦截（编辑器语义） |
| `Mod+Z` | global | `edit.undo` | 输入框内不拦截，交给文本原生撤销 |
| `Mod+Shift+Z` / `Mod+Y` | global | `edit.redo` | 同上 |
| `Mod+,` | global | `app.settings` | 输入框内不拦截 |
| `Mod+Shift+P` | global | `app.commandPalette` | 弹窗内不重复打开 |
| `F6` | global | `workspace.focusNext` | 弹窗内不切区域 |
| `Shift+F6` | global | `workspace.focusPrev` | 同上 |
| `Esc` | dialog | 关闭当前弹窗/取消 | 逐层退出，不一次清空全部 |
| `Alt+Left` | page | 返回项目/上一页 | 脏文档先走 UnsavedGuard |
| `Alt+Arrow` | panel | 移动面板（04-03） | 只在面板标题聚焦时 |
| `Alt+Shift+Arrow` | panel | 拆分面板（04-03） | 只在面板标题聚焦时 |

约束：

- 同一 scope 同一 chord 同一 `when` 出现两次 → 模块加载期抛错，指出两处 commandId。
- `Mod` 抽象 `Ctrl/Cmd`；不在表里写两行平台键。
- 不占用 `Ctrl+R`/`Ctrl+W`/`Ctrl+N` 等浏览器/系统保留键；确实需要时用菜单命令，不抢默认。
- 输入法组合中（`isComposing===true` 或 `keyCode===229`）一律不触发快捷键。
- 输入框/文本域/`contenteditable` 内：除 `Mod+S` 等显式白名单外，不拦截字符键、Delete、方向键、`Mod+Z`。
- 弹窗打开时：背景命令 disabled；`Esc` 只关最上层；焦点陷阱在弹窗内；关闭后焦点回到打开前的元素。
- 快捷键执行前检查 `enabled`；disabled 不执行、不弹错误，状态区可提示原因。
- 不做“按住连发加速”；方向键用系统重复；不做自定义 key repeat。

## 用户覆盖

- 设置页 `shortcuts` 分区列出 commandId/标题/默认 chord/当前 chord/scope。
- 点击“录制”后捕获下一个 chord；`Esc` 取消；`Backspace` 清空绑定。
- 冲突：与同 scope 已有 chord 冲突时拒绝并指出冲突命令；不允许保存冲突表。
- 覆盖存 `preferences.json` 的 `shortcuts`；只存 `{commandId, chord}`，不存 `when`/scope（scope 由命令定义固定）。
- 恢复默认：清空覆盖，不删命令表。
- 菜单 accelerator 与快捷键表同步；用户覆盖后菜单显示新 chord（Windows/Linux 自绘菜单）；macOS native 菜单同步更新。
- 不允许用户给 `global` 命令加 `when` 绕过守卫。

## 焦点服务

```ts
interface FocusService {
  focusRegion(regionId: string): void
  focusNext(): void
  focusPrev(): void
  currentRegion(): string
  remember(regionId: string): void
  restore(regionId: string): void
  subscribe(listener: (regionId: string) => void): () => void
}
```

- 焦点区域：顶栏 → `clip.effects` → 预览工具条 → `selection.properties` → 主时间轴 → 抽屉 → 状态区。
- 折叠/隐藏的面板跳过；抽屉关闭时跳过内容；弹窗打开时焦点进 dialog。
- `F6` 循环可见区域；`Shift+F6` 反向；区域标题/容器有 `data-focus-scope`。
- 每个面板提供 `focusFirst` 或 `autofocus`；面板内 `Tab` 不逃出区域，除非 `F6`。
- 面板隐藏/折叠时记住最后焦点；恢复时回到上次焦点，找不到则回标签。
- 焦点顺序不按 DOM 视觉顺序猜；由布局树 + `focusOrder` 决定。
- 焦点环 2px、颜色 `--focus-ring`、偏移 1px；禁止 `outline:none` 无替代；`prefers-reduced-motion` 下无过渡。
- `roving tabindex` 用于标签条/工具栏/分隔线；不允许 `tabindex>0`。
- 分隔线 `role="separator"` + `aria-orientation` + 方向键调整（04-03）。
- 弹窗：初始焦点、Tab 范围、Esc 取消、关闭归还焦点；`aria-modal`/`role=dialog`。
- `aria-live="polite"` 播报保存成功/失败、校验计数、连接状态、布局恢复、主题回退；不播报全部坐标。

## 命令面板

- `Mod+Shift+P` 打开；输入框自动聚焦；列出 enabled 命令，按 category 分组；↑/↓ 选择，Enter 执行，Esc 关闭。
- 命令项显示标题、category、chord；无结果显式空态。
- 命令面板是 dialog scope；打开时背景命令 disabled；关闭后焦点回原区域。
- 不列 disabled/未注册命令。
- 插件命令自动出现，不需要改面板代码。

## 菜单同步

- Windows/Linux 自绘菜单 + macOS native 菜单都从 `CommandRegistry` 生成。
- 菜单项 `enabled/checked` 由 renderer 求值后 `menu.sync` 给主进程；主进程只更新 UI。
- 菜单点击发 `command.execute(commandId)` 回 renderer；不直接执行文件操作。
- 菜单 accelerator 与快捷键表同源；用户覆盖后同步更新。
- 菜单打开时如果命令状态变化，下次打开重新求值；不缓存过期 enabled。

## 验收

- 在中文输入法里输入“位置”时按 `M`/`Delete`/`Space`：不触发命令；组合结束后才生效。
- 在数值输入框按 `Delete`：只删文本，不删片段/节点；按 `Mod+Z` 走文本撤销，不触发文档撤销。
- 在输入框按 `Mod+S`：保存文档（显式白名单）；保存失败保留脏标记。
- 不用鼠标：`F6` 进效果控件 → `F6` 加速捷属性 → `F6` 主时间轴 → `Mod+S` 保存；焦点环全程可见。
- 故意注册两个同 scope `Mod+S`：启动报错，指出两处 commandId。
- 用户覆盖 `Mod+S` 为 `F2`：菜单/命令面板/快捷键同步；与已有 `F2` 冲突时拒绝保存。
- 命令面板：`Mod+Shift+P` 打开，搜索“保存”执行保存，Esc 关闭，焦点回原区域。
- 打开确认框：Tab 只在框内，Esc 取消，关闭后焦点回触发按钮；背景 `Delete` 不执行。
- 菜单 enabled/checked 与命令状态一致；断连时保存 disabled 并显示原因，不静默失败。
- `rg` 检查命令层没有 `onKeydown` 大分支；没有第二个快捷键表；没有 `tabindex>0`。

## 命令约束

- 快捷键表驱动；不引入快捷键库。
- 避开浏览器/系统保留快捷键。
- 输入法组合态不触发命令。
- 作用域按焦点判定，不按 hover/最后点击推断。
- 键盘焦点环始终可见。
- 不做自定义连发加速。
- 每个命令都有真实 handler；不注册空 handler/假命令。
- 键盘路径与鼠标路径在同一界面可达。
- 输入框/IME/弹窗/面板作用域分开守卫。
