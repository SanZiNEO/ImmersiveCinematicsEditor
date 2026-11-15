# 04-08 偏好、设置页、i18n 与最近项目

## 目标

应用级偏好集中到一份可校验、可恢复、可分项重置的 `preferences.json`；同时提供设置页分区、中文/英文、密度、最近项目。布局归 04-02，窗口状态/草稿归 04-09，本文件不重复存。

## 四个存储分开

| 文件/目录 | 归属 | 内容 |
|---|---|---|
| `userData/preferences.json` | 本文件 | 主题偏好、语言、密度、快捷键覆盖、最近项目、设置页状态 |
| `userData/layout.json` | 04-02 | 每页布局、预设、尺寸比例、标签顺序 |
| `userData/window-state.json` | 04-09 | 窗口 bounds、maximized、display 信息 |
| `userData/drafts/` | 04-09 | 未保存文档快照；03 序列化的不透明 payload |

禁止把布局写进 `preferences.json`，禁止把窗口 bounds 写进偏好，禁止把草稿塞进偏好。坏一个只恢复一个。

## preferences.json

```ts
interface PreferencesFile {
  version: 1
  theme: ThemePreference          // 04-07 定义
  language: 'zh_cn' | 'en_us'
  density: 'comfortable' | 'compact'
  shortcuts: KeybindingOverride[] // 04-10 定义
  recentProjects: RecentProject[]
  settings: {
    lastSectionId?: string
    showStatusBar?: boolean
    confirmOnClose?: boolean
  }
}

interface RecentProject {
  path: string                    // 绝对路径；不存脚本内容
  name: string
  kind: 'folder' | 'script'
  lastOpenedAt: string            // ISO 时间
  missing?: boolean               // 加载时探测，不持久化删除
}
```

约束：

- `version` 不是 1：已知低版本迁移；未知版本备份后回默认。
- 未知键保留原样并忽略（不要因为多一个键丢整份偏好）；已知键类型不符回默认并记诊断。
- `recentProjects` 最多 20 条；按 `lastOpenedAt` 倒序；路径归一化后去重；不存 token/secret/脚本正文。
- `settings.lastSectionId` 只记设置页上次分区；不存业务表单草稿。
- `preferences.json` 不写脚本字段、不写 `meta.version`、不写布局树。

## PreferencesStore

```ts
interface PreferencesStore {
  load(): Promise<void>
  get(): Readonly<PreferencesFile>
  getSection<K extends keyof PreferencesFile>(key: K): PreferencesFile[K]
  setSection<K extends keyof PreferencesFile>(key: K, value: PreferencesFile[K]): void
  patch(partial: Partial<PreferencesFile>): void
  resetSection(key: 'theme' | 'language' | 'density' | 'shortcuts' | 'recentProjects' | 'settings'): void
  resetAll(): void
  subscribe(listener: (next: PreferencesFile) => void): () => void
  flush(): Promise<void>
}
```

实现约束：

- 写：300ms debounce；先写 `preferences.json.tmp`，再原子 rename；保留 `preferences.json.bak`；写失败保留内存值，状态区提示，不阻塞编辑。
- 读失败/JSON 损坏：原文件复制为 `preferences.corrupt.<timestamp>.json`，内存用默认；只提示偏好恢复，不重置布局/窗口/草稿。
- 大小上限 512 KB；超过拒绝写入并提示。
- `resetSection` 只重置指定键；`resetAll` 二次确认，清空偏好但不删布局/窗口/草稿/脚本。
- 渲染进程不直接读写 `userData`；经 preload 的 `PreferencesPort` 调主进程。浏览器 dev 用内存态，不用 `localStorage` 冒充跨宿主持久化。
- 不存 WebUI token；token 仍由主进程 `sendSync` 给 preload，不落盘。

## 设置页

`SettingsPage` 左侧分区导航 + 右侧内容；分区来自 `settings` 贡献。核心分区：

| sectionId | 内容 |
|---|---|
| `appearance` | 主题选择器/跟随系统/导入主题/token 覆盖（04-07）；密度 |
| `workspace` | 布局预设、恢复默认、打开布局文件所在目录（只读路径） |
| `shortcuts` | 快捷键表、编辑、冲突提示、恢复默认（04-10） |
| `language` | `zh_cn` / `en_us`，即时切换 |
| `about` | 版本、构建、Electron/Chromium 版本、日志路径、复制诊断 |
| `advanced` | 打开 `userData` 目录、导出/重置偏好、查看插件/布局/主题错误；危险操作二次确认 |

插件 `settings` 分区：

- 只能读写自己的偏好键；通过 `SettingsApi.get/set`，不能拿整份 `preferences.json` 覆盖别人。
- 分区标题/顺序来自 manifest；插件被移除后，分区消失，不阻塞设置页。
- 插件设置项变化不弄脏脚本、不重建文档。

设置页行为：

- 进入设置页不关闭文档；返回回到原文档/项目页。
- 修改主题/语言/密度/快捷键即时生效；写盘 debounce；重启保留。
- 设置页本身用主题 token；切主题后设置页也换色，不残留主题色。
- 搜索设置项（可选）：按标题/key 过滤；没有结果显式空态，不显示假条目。
- 危险操作（重置全部/删除用户主题/清空最近项目）二次确认，默认焦点在取消。

## i18n

- 语言：`zh_cn`、`en_us`；默认 `zh_cn`。
- 核心 `t(key, params?)`；缺失 key 显示原 key 并记录诊断，不显示空白。
- 语言切换即时更新菜单、顶栏、状态区、设置页、对话框、错误/空态、aria-label；不要求刷新页面。
- 面板插件自带自己的语言资源；`PanelContext.i18n` 提供 `t`/`locale`，插件不能改全局语言。
- 数字/时间用 `Intl.NumberFormat`/`Intl.DateTimeFormat`；脚本时间仍按真实秒显示，不因语言改精度。
- 长中文/英文标签最多两行；单位不被截断；窄面板改上标签下控件；字段标签默认 104px 可调。
- 翻译缺失/冲突在诊断里可见；不把中文硬编码进新组件。
- 语言设置存 `preferences.json`，不写脚本。

## 最近项目

- 来源：项目页“打开文件夹”、项目页“打开脚本文件”、文档顶栏返回项目。
- 记录：`path/name/kind/lastOpenedAt`；文件夹与脚本分开；同一路径只保留最近一条。
- 加载时探测存在性：不存在标 `missing`，保留条目，提供“移除/重新定位”；不自动删除用户记录。
- 点击文件夹：记录为最近项目，不扫描；点击脚本：走 03 打开。
- 最近项目不绕过游戏服务直接读脚本；不自动创建同名文件；不把脚本内容缓存进偏好。
- 最多 20 条；超出淘汰最早；用户可清空（二次确认）。

## 损坏与重置矩阵

| 损坏 | 行为 |
|---|---|
| `preferences.json` JSON 坏 | 备份原文件，偏好回默认；布局/窗口/草稿保留 |
| `preferences` 某键类型错 | 该键回默认并诊断；其他键保留 |
| `layout.json` 坏 | 04-02 回默认布局；偏好/窗口/草稿保留 |
| `window-state.json` 坏 | 04-09 回默认窗口；偏好/布局/草稿保留 |
| `drafts/` 某文件坏 | 该草稿不可恢复，其他草稿保留；不覆盖源脚本 |
| 写入失败 | 内存值保留，状态区警告；不阻塞编辑；下次重试 |

分项重置：

- 外观：主题/覆盖/跟随系统回默认；密度回舒适。
- 工作区：布局回默认（04-02），保留用户预设？重置布局只回默认，不删用户预设；单独“删除用户预设”。
- 快捷键：回默认表（04-10）。
- 语言：回 `zh_cn`。
- 最近项目：清空列表，不删文件。
- 高级：清空全部偏好；不删布局/窗口/草稿/脚本，二次确认。

## 验收

- 改主题/语言/密度/快捷键/最近项目 → 重启全部保留；`preferences.json` 是唯一偏好来源。
- 手改 `preferences.json` 制造坏 JSON/错类型/超长：备份 + 默认/该键回默认；布局/窗口/草稿不受影响。
- 删掉 `preferences.json`：应用可用默认启动；不崩、不白屏。
- 设置页切分区/返回文档：文档、选区、脏标记不变；主题/语言即时生效。
- 语言切到 `en_us`：菜单/顶栏/状态区/设置页/对话框/错误文案更新；缺失 key 显示 key 并诊断，不空白。
- 最近项目：打开文件夹/脚本 → 列表出现；文件移走 → 标 missing；移除/重新定位可用；不自动删记录。
- 插件 `demo.settings.section` 出现在设置页；删插件后分区消失，设置页可用。
- 重置外观不影响布局；重置布局不影响主题/快捷键；重置快捷键不影响文档；重置全部不删脚本/草稿。
- `rg` 检查没有 `localStorage` 直写偏好、没有 token/secret 写入 `preferences.json`、没有脚本内容写入偏好。

## 偏好约束

- 偏好是全局的；布局/窗口/草稿分别存自己的文件。
- 文件读写只经 preload 的 `PreferencesPort`。
- 偏好文件不存 WebUI token、游戏凭据、脚本正文。
- “重置全部”只清偏好，不清用户目录其他分项。
- 设置页只读写本分区自己的键，不变成第二份业务表单。
- 不把布局/窗口/草稿塞进 `preferences.json`。
