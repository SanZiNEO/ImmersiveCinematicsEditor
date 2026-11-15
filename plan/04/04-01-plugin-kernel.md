# 04-01 插件内核与七类扩展点

## 目标

建立工作台唯一的插件注册表：框架只认 `pluginId`，面板、页面、抽屉、命令、状态项、设置、主题都通过 manifest 声明；插件在编译期注册，只从内置 `builtin.ts` 加载。加一个面板等于加一个插件目录 + `builtin.ts` 加一行，内核不改。

## 插件目录

每个插件一个目录，目录名就是 `pluginId` 的短名：

```text
src/plugins/<pluginId>/
  manifest.ts          // 默认导出 PluginManifest
  index.ts             // activate(ctx)
  panels/...           // 面板组件，按需懒加载
  pages/...
  drawers/...
  settings/...
  themes/*.json        // 主题包，纯数据
```

`src/plugins/builtin.ts` 是唯一的编译期清单：

```ts
import coreWorkbench from './core.workbench/manifest'
import demoKitchenSink from './demo.kitchen-sink/manifest'

export const BUILTIN_PLUGINS = [coreWorkbench, demoKitchenSink]
```

不允许运行时 `import()` 扫目录、读 `plugins/` 文件夹、从网络拉 manifest。发布构建可以按标志排除 `demo.kitchen-sink`。

## Manifest

```ts
interface PluginManifest {
  id: string                    // ^[a-z][a-z0-9._-]{2,63}$，全局唯一
  name: string                  // 人读名称，可 i18n key
  version: string               // 语义化版本
  apiVersion: '1'               // 本轮只接受 1
  requires?: string[]           // 依赖的 pluginId，按拓扑排序激活
  contributes: PluginContributions
  activate: (ctx: PluginContext) => void | Promise<void>
}
```

约束：

- `id` 必须全局唯一；重复 ID 在启动阶段抛错，错误里带两个 manifest 的来源路径。
- `requires` 必须指向已注册插件；缺失依赖或依赖激活失败时，本插件不激活，错误进工作台诊断，不半注册贡献。
- 依赖图必须无环；环在启动阶段抛错，列出环上的 ID。
- `apiVersion` 不匹配时拒绝该插件，不猜测兼容。
- `activate` 只做注册和轻量初始化；重活放面板首次挂载。允许返回 Promise，工作台等待完成；拒绝则只废该插件。
- 插件不能跨插件 `import` 组件或内部模块；只能 import `@workbench/api` 和自己的文件。用 ESLint/架构测试卡住。

## 七类扩展点

### 1. panel

```ts
interface PanelContribution {
  panelId: string               // 插件内唯一；全局键 = pluginId + panelId
  titleKey: string
  component: () => Promise<Component>
  defaultSlot: SlotId           // document.left / document.center / document.right / document.bottom / document.drawer / project.main / settings.content
  order: number
  minWidth?: number
  minHeight?: number
  keepAlive?: boolean
  singleton?: boolean           // 默认 true；每页最多一个实例
  closable?: boolean            // 默认 true；核心面板可设 false
  available?: (ctx: PanelAvailabilityContext) => boolean
}
```

约束：`panelId` 只在插件内唯一；布局树和宿主只认 `{ pluginId, panelId }`。`component` 必须懒加载，不能在内核启动时把所有面板打进首屏包。`singleton` 为 true 时，同一页重复拖入只保留一个实例，第二次拖入变成“聚焦已有面板”。

### 2. page

```ts
interface PageContribution {
  pageId: string                // project / document / settings 是核心页；插件可加 sandbox 等
  route: string                 // 顶层路由片段，不能含查询串
  titleKey: string
  component: () => Promise<Component>
  defaultLayout?: LayoutBlueprint
  order: number
}
```

约束：核心三页 `project/document/settings` 由 `core.workbench` 贡献；插件页面从“视图 → 页面”或命令打开，不抢占核心三页路由。页面组件只负责页面壳，不直接持有布局树。

### 3. drawerTab

```ts
interface DrawerTabContribution {
  tabId: string                 // 全局唯一；保留 curves/behavior/resources/diagnostics/templates
  titleKey: string
  component: () => Promise<Component>
  order: number
  minHeight?: number
  keepAlive?: boolean
  available?: (ctx: PanelAvailabilityContext) => boolean
}
```

约束：抽屉是一个 dock group，不是独立窗口；一个 group 同时只有一个活动 tab。五个保留 ID 中，04 只登记 `diagnostics` 的真实工作台诊断；其余四个保留 ID 的空位。

### 4. command

```ts
interface CommandContribution {
  commandId: string             // 全局唯一；点分命名，如 file.saveDoc
  titleKey: string
  category: string              // 文件/编辑/视图/帮助/插件
  run: (ctx: CommandContext) => void | Promise<void>
  enabled?: (ctx: CommandContext) => boolean
  checked?: (ctx: CommandContext) => boolean
  menu?: MenuPlacement          // 菜单栏位置；不填表示不进菜单
}
```

约束：命令是菜单、快捷键、命令面板的唯一入口；不允许菜单自己写一个 handler、快捷键再写一个。`enabled/checked` 每次菜单打开、快捷键执行前求值；求值抛错按 disabled 处理并记诊断。04 注册 shell 命令，文档命令代理到 03。

### 5. statusItem

```ts
interface StatusItemContribution {
  itemId: string
  align: 'left' | 'right'
  order: number
  text?: (ctx: StatusContext) => string
  component?: () => Promise<Component>
  commandId?: string            // 点击时执行的命令
  severity?: (ctx: StatusContext) => 'normal' | 'warning' | 'error'
}
```

约束：状态区只读；条目不能直接改文档，只能发命令。连接、预览源、校验计数、当前布局预设由 `core.workbench` 提供；插件可以加自己的状态项（如插件加载失败计数）。

### 6. settings

```ts
interface SettingsContribution {
  sectionId: string
  titleKey: string
  order: number
  component: () => Promise<Component>
}
```

约束：设置页左侧是分区导航，右侧是内容；核心分区 `appearance/workspace/shortcuts/language/about/advanced` 由 `core.workbench` 贡献；插件设置分区只能读写自己的偏好键，不能直接改 `preferences.json` 全量对象。

### 7. theme

```ts
interface ThemeContribution {
  themeId: string               // 全局唯一，如 workbench.dark-default / demo.sepia
  labelKey: string
  appearance: 'dark' | 'light' | 'high-contrast'
  path: string                  // 插件目录内 JSON 相对路径；纯数据
  preview?: { bg: string; panel: string; text: string; accent: string }
}
```

约束：主题是数据，不执行代码；一个主题包插件可以贡献多个主题。主题文件必须是版本 1 的 JSON，token 规则/回退/非法判定见 04-07；缺失的核心 token 从同 appearance 的内置基础主题继承并记警告，颜色非法/核心 token 缺失过多的主题无效。插件不能贡献“主题编辑器脚本”或任意 CSS。

## 注册与激活

启动顺序：

1. 读 `BUILTIN_PLUGINS`，校验 manifest 结构、ID 唯一、API 版本、依赖无环。
2. 按拓扑顺序激活；每个插件创建独立 `PluginContext` 和 `Disposable` 栈。
3. `activate` 成功后才把该插件的贡献加入全局注册表；失败则标记 `failed`，贡献不进入布局可选集合，错误进诊断。
4. 依赖插件失败时，依赖它的插件也不激活，错误里写明“依赖 X 未激活”。
5. 应用卸载时按激活逆序 dispose；dispose 抛错只记日志，不阻塞其他插件。

`PluginContext`：

```ts
interface PluginContext {
  pluginId: string
  api: WorkbenchApi
  commands: CommandRegistry
  panels: PanelRegistry
  pages: PageRegistry
  drawerTabs: DrawerTabRegistry
  statusItems: StatusItemRegistry
  settings: SettingsRegistry
  themes: ThemeRegistry
  services: ServiceRegistry
  logger: PluginLogger
  disposables: DisposableStore
}
```

`ServiceRegistry` 用于跨插件能力注入，但不允许内核直接 import 业务实现：

```ts
interface ServiceRegistry {
  provide<T>(token: ServiceToken<T>, impl: T): void
  get<T>(token: ServiceToken<T>): T | undefined
  require<T>(token: ServiceToken<T>): T   // 缺失抛错，调用方自己决定降级
}
```

同一 token 只允许一个 provider；重复 provide 抛错。04 注册 `layout/theme/commands/status/i18n/host/selection/documents` 的基础实现。

## 内核边界

- `src/workbench/kernel/` 只 import `@workbench/api` 和 `builtin.ts` 的 manifest 类型；不 import 任何 `panels/` 业务组件。
- 布局树只存 `{ pluginId, panelId }`；不存组件路径、不存 DOM、不存业务数据。
- `PanelHost` 是唯一把 `pluginId + panelId` 解析成组件的地方；解析失败显示占位，不抛到外壳。
- 插件不能 import 另一个插件的组件；共享能力走 `ServiceRegistry` 或 `@workbench/api` 的公共类型。
- 加面板的标准动作：新建插件目录 → 写 manifest + 组件 → `builtin.ts` 加一行 → 布局默认槽位出现。禁止改 `PanelHost`/`WorkspaceShell` 的 switch。
- 内核代码里不允许出现 `if (panelId === 'timeline')` 这类业务分支；业务差异由插件自己声明。

## 缺失、禁用、重复、失败

| 情况 | 行为 |
|---|---|
| 布局引用了未注册 pluginId | 保留节点，显示“插件未安装/已禁用”占位；提供“移除该面板/重置布局”；不自动删布局，不拖垮其他面板 |
| 插件被构建排除 | 同“未注册”；布局不崩，诊断记录缺失 ID |
| 插件 manifest 重复 ID | 启动失败，列出两个来源；不进入工作台 |
| 插件 activate 抛错/拒绝 | 只废该插件；贡献不注册；诊断记录 pluginId + 错误摘要；其他插件继续 |
| 插件依赖缺失/失败 | 本插件不激活；错误写明依赖链；不半注册 |
| 面板组件加载失败 | 该面板显示错误 + 重试；其他面板正常 |
| 面板组件抛错 | 错误边界只影响该面板；错误进诊断；不重置布局 |

## 验收

- `demo.kitchen-sink` 同时贡献 panel/page/drawerTab/command/statusItem/settings/theme 七类，全部出现在工作台。
- 复制一个 manifest 改同 ID：启动报错，指出两处来源，不进入工作台。
- 让 demo 的 `activate` 抛错：demo 的贡献全部消失，布局显示缺失占位，其他插件正常。
- 从 `builtin.ts` 删掉 demo：布局引用 demo 的节点变占位，可移除/重置，不崩。
- 加 `demo.extra` 只写一个 panel manifest + 组件 + `builtin.ts` 一行：面板出现在默认槽位，内核零改动。
- `rg` 检查 `src/workbench/kernel` 没有任何 `plugins/*/panels` import；`layout.json` 里没有组件路径。

## 架构约束

- 插件编译期注册；不运行时安装/市场/服务器/远程代码。
- 跨插件组件不互相 import；共享走 token。
- 内核不写业务 `switch`。
- manifest 变更后重启生效。
- 缺失插件保留布局占位；删不删由用户决定。
- 插件禁用后不自动删布局；只显示缺失占位。
