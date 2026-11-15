# 04-07 主题注册表与可配置主题

## 目标

主题不再写死“深色/浅色”两套，而是做成 VS Code 那样的可配置模型：内置主题只是兜底，插件可以贡献主题包，用户可以选任意主题、跟随系统并分别指定浅色/深色/高对比主题、导入本地主题、局部覆盖 token。主题是数据，不执行代码；切换只改 CSS 变量和原生 `themeSource`，不重建文档、不重建预览、不弄脏脚本。

## 模型来源

参考 VS Code 的四层机制：

- `contributes.themes`：插件声明主题文件，主题有 `type` 和 `colors`。
- `workbench.colorTheme`：用户选择当前主题，主题名持久化。
- `window.autoDetectColorScheme` + preferred light/dark/high-contrast：跟随系统，并分别指定每种系统外观用哪个主题。
- `workbench.colorCustomizations`：用户在活动主题上做局部颜色覆盖，不动主题文件。

04 把“插件”换成编译期插件，“主题文件”换成工作台 token JSON；其余选择/跟随/覆盖模型同构。

## 主题定义

```ts
interface ThemeDefinition {
  version: 1
  id: string                    // workbench.dark-default / demo.sepia / user.my-theme
  label: string                 // 人读名称；插件主题可用 labelKey
  labelKey?: string             // i18n key，优先于 label
  appearance: 'dark' | 'light' | 'high-contrast'
  tokens: Partial<ThemeTokens>  // 颜色 token；缺失从同 appearance 的基础主题继承
  syntaxTokens?: Partial<SyntaxTokens>
  trackTokens?: Partial<TrackTokens>
  preview?: { bg: string; panel: string; text: string; accent: string }
}
```

`ThemeTokens` 核心 token：

| token | 用途 | 必需 |
|---|---|---|
| `bg-app` | 应用底/标题区 | 是 |
| `bg-panel` | 工作面板/时间轴 | 是 |
| `bg-raised` | 输入框/卡片/浮层 | 是 |
| `bg-hover` | 悬停 | 是 |
| `bg-selected` | 选中填充 | 是 |
| `text` | 正文 | 是 |
| `text-secondary` | 元信息/单位 | 是 |
| `text-muted` | 非关键辅助说明 | 是 |
| `border` | 结构分隔 | 是 |
| `border-strong` | 关键输入/浮层边界 | 是 |
| `accent` | 链接/交互文本 | 是 |
| `focus` | 焦点环 | 是 |
| `success` | 成功 | 是 |
| `warning` | 警告/待确认 | 是 |
| `error` | 错误 | 是 |
| `error-bg` | 字段错误背景 | 是 |
| `selection-outline` | 选中片段/节点外描边 | 是 |

可选 token：

- `shadow`、`overlay`、`scrollbar`、`scrollbar-hover`。
- `track.camera` / `track.letterbox` / `track.audio` / `track.event` / `track.mod_event` / `track.overlay` / `track.adjust`；默认用固定分类色，主题可覆盖，但不自动反色。
- `syntax.keyword` / `syntax.string` / `syntax.number` / `syntax.comment` / `syntax.property` / `syntax.punctuation` / `syntax.invalid`；用于 JSON/脚本文本、诊断片段，不引入完整语法高亮引擎。

规则：

- `tokens` 可以只写一部分；缺失的核心 token 从同 `appearance` 的内置基础主题继承。缺少全部核心 token 或颜色非法的主题无效。
- 颜色值只接受 CSS 字面量颜色（`#rgb/#rrggbb/#rrggbbaa`、`rgb()/rgba()/hsl()/hsla()`、`transparent`）；拒绝 `var()`、`url()`、`@import`、`expression()`、分号/花括号。
- 不允许主题引用另一个主题的 token；不允许循环继承；继承只走“同 appearance 基础主题”一层。
- `appearance` 决定 `color-scheme` 和原生 `themeSource`；高对比主题还要过对比度检查。
- `labelKey` 走 i18n；缺失翻译显示原 key 并记录，不显示空白。

## 主题注册表

```ts
interface ThemeRegistry {
  list(): ThemeSummary[]
  get(themeId: string): ThemeDefinition | undefined
  registerBuiltin(theme: ThemeDefinition): void
  registerContribution(pluginId: string, theme: ThemeDefinition): void
  importUserTheme(json: unknown): ThemeDefinition
  removeUserTheme(themeId: string): void
  subscribe(listener: () => void): () => void
}
```

来源与优先级：

1. `builtin`：`workbench.dark-default`、`workbench.light-default`、`workbench.high-contrast`。仅兜底，不限制用户选择。
2. `plugin`：编译期插件通过 `theme` 贡献；主题文件在插件目录内，`path` 不允许绝对路径/`..`/远程 URL。
3. `user`：本地导入的主题，存 `userData/themes/*.json`；ID 必须以 `user.` 开头，冲突拒绝。

规则：

- 主题 ID 全局唯一；重复 ID 启动报错，列出 builtin/plugin/user 来源。
- 插件主题不能被用户覆盖文件；用户只能通过 `overrides` 局部覆盖当前活动主题。
- 用户主题可删除；删除活动主题时回退到同 `appearance` 的内置基础主题并提示。
- 主题包插件被构建排除/禁用时，其主题从列表移除；活动主题回退并提示，不崩。
- 主题列表按 `appearance` 分组，组内按 label 排序；支持搜索；插件主题显示插件名。

## 用户选择与跟随系统

```ts
interface ThemePreference {
  mode: 'manual' | 'system'
  themeId: string                 // manual 模式的活动主题
  system: {
    lightThemeId: string
    darkThemeId: string
    highContrastThemeId?: string
  }
  overrides: Record<string, string>   // 只允许核心 token；可空
  themeCache?: {
    themeId: string
    appearance: 'dark' | 'light' | 'high-contrast'
    bgApp: string
    tokens: ThemeTokens
  }
}
```

行为：

- `manual`：始终用 `themeId`；系统变化不覆盖手选。
- `system`：按 `nativeTheme.shouldUseDarkColors` / `shouldUseHighContrastColors`（平台支持时）选择 `light/dark/highContrast` 槽位主题；槽位主题缺失时回退到同 appearance 的内置主题。
- 用户在主题选择器里选一个具体主题 → 切到 `manual`；打开“跟随系统” → 切到 `system`，并保留已配的 light/dark 槽位。
- 设置页在“跟随系统”下显示三个下拉：浅色时用、深色时用、高对比时用；槽位只允许 `appearance` 匹配的主题（light 槽只能选 light 主题，dark 槽只能选 dark，high-contrast 槽只能选 high-contrast）。
- 手选主题不被系统变化覆盖；system 模式订阅/取消订阅幂等，不重复监听。
- 主题选择器支持键盘：↑/↓ 预览，Enter 应用，Esc 取消；预览只改临时 token，不写偏好，不弄脏文档。

## 启动与切换

启动顺序：

1. 主进程创建窗口前读 `preferences.json` 的 `themeCache`；没有 cache 时用内置默认。
2. `nativeTheme.themeSource` 设为 cache 的 `appearance` 对应值；`BrowserWindow.backgroundColor` 设为 `themeCache.bgApp`；`show:false`。
3. preload 在 DOM 前把 `themeCache.tokens` 暴露为 `window.workbench.initialTheme`；renderer 在挂载前写入 `document.documentElement` 的 CSS 变量和 `data-theme-*`。
4. `ready-to-show` 后再显示窗口，避免白闪。
5. 挂载后 ThemeRegistry 加载插件/用户主题；若当前主题解析结果与 cache 不一致，再应用一次并更新 cache。

切换：

- `ThemeService.apply(themeId)` 解析 token → 写入根 CSS 变量 → 设置 `data-theme-id`/`data-theme-appearance` → 设置 `color-scheme` → 通过 preload 通知主进程更新 `nativeTheme.themeSource` 和 `win.setBackgroundColor(bgApp)`。
- 只改根变量，不逐组件改色；组件只能用 token，不散写颜色。
- 切换不重建文档、不重建预览流、不触发脚本保存、不清选区、不改变游戏画面像素。
- 主题切换期间焦点环仍可见；`prefers-reduced-motion` 下不做颜色过渡。
- 切换后更新 `themeCache`（防白闪），但 cache 不写脚本。

## 主题选择器与设置页

`Settings > 外观`：

- 主题选择器：按 dark/light/high-contrast 分组，显示名称、来源（内置/插件/用户）、小预览（bg/panel/text/accent 四色块）；搜索；↑/↓ 预览，Enter 应用，Esc 取消。
- “跟随系统”开关；打开后显示浅色/深色/高对比三个槽位下拉。
- “导入主题…”按钮：`dialog.showOpenDialog` 选 `.json`；校验；复制到 `userData/themes/`；加入列表；可立即应用。
- 用户主题行显示“移除”；移除活动主题时回退并提示。
- “高级：token 覆盖”：表格列出核心 token，当前值 + 覆盖值；支持单个重置/全部重置；只允许核心 token，不允许任意选择器/CSS。
- “重置外观”：恢复内置默认主题、关闭跟随、清空覆盖；不动布局/窗口/快捷键。

## 校验与错误

- 加载时校验 `version/id/appearance/tokens`；`id` 不符合规则、`appearance` 非法、核心 token 缺失、颜色非法 → 主题无效，进诊断，不进入列表。
- 用户导入重复 ID/路径非法/文件过大（>256 KB）→ 拒绝并提示；不覆盖已有文件。
- 高对比主题：`text` vs `bg-panel` 对比 ≥7:1，`text-secondary` ≥4.5:1，`focus`/`border-strong` ≥3:1；不达标拒绝并说明。
- 普通主题：`text` vs `bg-panel` ≥4.5:1，`focus`/`border-strong` ≥3:1；不达标警告但不阻止应用（用户可选可读性更高的主题）。
- 活动主题文件损坏/删除：回退同 appearance 内置主题，状态区提示；不重置布局/快捷键/文档。
- 主题包插件缺失：主题从列表移除；活动主题回退；布局里的面板不受影响。
- 主题切换失败：保留原主题，错误进诊断；不把界面留在半套 token。

## 主题与轨道/语法色

- 轨道分类色默认固定（CAMERA/LETTERBOX/AUDIO/EVENT/MOD_EVENT/OVERLAY/ADJUST），不随主题反色；主题只能显式覆盖 `track.*`，覆盖后仍要保证类型图标+文字可辨。
- 选中片段/节点的墨色按真实对比计算黑/白，不直接套分类色。
- `syntax.*` 只用于 JSON/脚本文本、诊断片段、代码式只读展示；没有语法高亮引擎时按 token 着色，不引入 TextMate/Monaco。
- 主题不能改变游戏预览像素、脚本调色、素材缩略图颜色；预览区不加 CSS filter。

## 宿主边界

- WebUI 用 CSS 变量 + `nativeTheme`；主题宿主适配层把同一 token 表映射成目标宿主字面值，不维护第二份语义表。
- 宿主不能读系统主题时，以用户手选为准，不伪造系统事件；token 语义保持一致。
- 主题服务不依赖 Electron；`ThemeHostPort` 抽象 `setNativeTheme` / `setWindowBackground`，WebUI 用 Electron 实现，其他宿主提供空实现或自绘标题栏适配。

## 验收

- 首次启动：默认主题，无白闪；切换 dark/light/high-contrast 三套内置主题，所有面板/抽屉/弹层/标题栏/状态区无残留主题色。
- 插件 `demo.kitchen-sink` 贡献 `demo.theme.sepia`（light）和 `demo.theme.midnight`（dark）：出现在选择器，可应用、重启保留；删除插件后回退并提示。
- 用户导入一个本地主题 JSON：出现在列表，可应用、重启保留；删除活动用户主题回退；重复 ID/非法颜色被拒绝并说明。
- 跟随系统：系统切深/浅，活动主题切到配置的 dark/light 槽；手选主题后系统变化不再覆盖；重新打开跟随恢复。
- 高对比槽：平台支持时切到 high-contrast；不达标的高对比主题被拒绝。
- token 覆盖：改 `accent`/`bg-panel` 立即生效；单个重置/全部重置；覆盖不写主题文件。
- 主题切换：文档不脏、选区不变、预览不重建、播放不中断；刷新/重启恢复同一主题。
- 坏主题/缺失主题/非法 JSON：回退 + 诊断；布局/快捷键/窗口/草稿不受影响。
- 键盘：主题选择器 ↑/↓ 预览、Enter 应用、Esc 取消；焦点环可见；屏幕阅读器能读到主题名和来源。
- `rg` 检查外壳/页面/抽屉没有散写十六进制颜色（除主题 token 文件和预览色块）；`themeCache` 不含脚本字段。

## 主题约束

- 内置主题只做兜底；用户可选任意注册主题。
- 主题包只读 JSON token；不接受 CSS/`@import`/`url()`/JS。
- 主题只改工作台 token，不改脚本调色或游戏预览像素。
- 全局主题 + 局部 token 覆盖；不给每个面板单独主题。
- 只做颜色 token；不做图标主题。
- token 覆盖受控；不生成任意 CSS。
- 主题文件本地读取；不联网下载。
