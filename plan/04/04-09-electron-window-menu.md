# 04-09 Electron 窗口、菜单、文件端口与草稿恢复

## 目标

把当前只有三个窗口按钮 + token 同步的 Electron 壳，补成正常桌面应用：窗口状态可恢复、标题栏保留原生窗口控件、菜单/命令同一份注册表、文件对话框只走主进程、草稿恢复不覆盖源脚本、preload 只暴露最小权限 API。

当前项目是 `electron ^43.2.0`；`windowStatePersistence` 是 Electron 44 的内置能力，主进程用 `WindowStateAdapter` 提供同一语义，不引第三方窗口状态库。

## 窗口

```ts
const useOverlay = supportsTitleBarOverlay()   // Windows/Linux 支持时

new BrowserWindow({
  width: 1600,
  height: 900,
  minWidth: 1280,
  minHeight: 720,
  show: false,
  backgroundColor: themeCache.bgApp,     // 启动防白闪
  ...(useOverlay
    ? {
        titleBarStyle: 'hidden',
        titleBarOverlay: {
          color: themeCache.bgApp,
          symbolColor: themeCache.tokens['text'],
          height: 36
        }
      }
    : { frame: false }),                  // 不支持 overlay 时回退自绘三键
  webPreferences: {
    preload,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    allowRunningInsecureContent: false
  }
})
```

约束：

- `show:false` + `ready-to-show` 后再显示；首屏应用主题后再显示，避免白闪。
- Windows/Linux 优先 `titleBarStyle:'hidden'` + `titleBarOverlay`，保留原生最小化/最大化/关闭和 Snap Layouts；平台不支持 overlay 时回退 `frame:false` + 自绘三键。
- macOS 保留原生 traffic lights；菜单用 native `Menu`。
- 标题栏拖动区用 `-webkit-app-region: drag`；按钮/菜单/输入设置 `no-drag`，避免点按钮时拖窗口。
- 双击标题栏最大化/还原：overlay 支持时交给原生；回退自绘时在主进程处理。
- 窗口关闭前走 `UnsavedGuard`：脏文档三选一；取消阻止关闭；保存失败/断连不能按“已保存”关闭。
- 最小尺寸 1280×720；低窗布局降级由 04-02 处理，窗口不强行放大。

## 窗口状态

`window-state.json`：

```ts
interface WindowStateFile {
  version: 1
  bounds: { x: number; y: number; width: number; height: number }
  maximized: boolean
  displayId?: string
  updatedAt: string
}
```

`WindowStateAdapter`：

- 启动读文件；没有/坏文件用默认 1600×900 居中。
- 恢复前用 `screen.getAllDisplays()` 校验 bounds 是否在某个 `workArea` 内；不在则挪到主屏居中，保证可见。
- 多屏/DPI：保存 `displayId` 与 bounds；显示器拔掉后回主屏；`display-metrics-changed` 时重新夹到 workArea。
- 保存时机：`move`/`resize` debounce 500ms；`maximize`/`unmaximize` 立即记 `maximized`；关闭前 flush。
- 不保存 minimized 状态；最小化恢复用原 bounds。
- bounds 宽高低于窗口最小尺寸时夹到 1280×720；负 x/y 允许（多屏左侧），但必须在某个 workArea 内。
- 写：tmp + rename + `.bak`；坏文件只恢复窗口，不影响偏好/布局/草稿。
- Electron 44 后：切 `windowStatePersistence:true` + 唯一 `name`，保留本 adapter 作为迁移/回退；不引 `electron-window-state`。

## 标题栏与菜单

- `AppTopBar` 在 Windows/Linux 显示应用菜单栏；macOS 不显示应用内菜单栏，用 native `Menu.setApplicationMenu`。
- 菜单项来自 04-10 的 `CommandRegistry`；菜单不自己写 handler。
- 菜单结构：文件/编辑/视图/帮助 + 插件页/面板子菜单；命令 ID、标题、accelerator、enabled/checked 同步。
- Windows/Linux：`Menu.setApplicationMenu(null)` 避免原生菜单和自绘菜单重复；快捷键由 renderer 的 KeybindingService 处理。
- macOS：native Menu 菜单项点击 → 主进程发 `command.execute(commandId)` 给 renderer；renderer 把 `command.state` 同步回主进程更新 enabled/checked。
- 菜单状态同步：`menu.sync` 批量发 `{commandId, enabled, checked, label}`；主进程只更新菜单项，不执行命令。
- 菜单打开前求值 `enabled/checked`；求值抛错按 disabled 处理并诊断。
- 关闭/最小化/最大化/还原/关于/帮助/设置/退出都有命令 ID；不写两套。
- `CmdOrCtrl` 用 accelerator 的角色映射；不占用浏览器/系统保留键。

## 文件对话框与 shell

`FileDialogPort`：

```ts
interface FileDialogPort {
  openScript(): Promise<string | null>
  openFolder(): Promise<string | null>
  saveScript(defaultPath?: string): Promise<string | null>
  importTheme(): Promise<string | null>
  confirm(message: string, detail?: string, buttons?: string[]): Promise<number>
}
```

- 全部走主进程 `dialog.showOpenDialog/showSaveDialog/showMessageBox`；renderer 不直接读文件、不拼路径。
- 脚本过滤器 `.json`；主题过滤器 `.json`；文件夹 `openDirectory`。
- 取消返回 `null`，调用方保持原状态；打开失败提示，不关闭当前文档。
- 保存对话框只返回路径；实际写文件走 03 文档 IO/主进程端口，不在对话框里写。
- `ShellPort.showItemInFolder(path)` 只允许已知项目/日志/主题目录；`openExternal(url)` 只允许 `https?://` 白名单；不打开任意 `file://`/`javascript:`/`data:`。
- 主题导入：选文件 → 校验（04-07）→ 复制到 `userData/themes/`；不执行文件内容。

## 草稿恢复

`DraftRecoveryStore` 在主进程：

```ts
interface DraftRecord {
  version: 1
  draftId: string
  docId: string
  sourcePath?: string
  capturedAt: string
  docRevision: number
  hash: string
  payload: unknown        // 03 序列化的不透明快照
}
```

- 存放：`userData/drafts/<draftId>.json`；不写源脚本目录；不与 `preferences/layout/window` 混。
- 触发：03 文档脏后 debounce 2s 写一次；窗口关闭/崩溃前尽量 flush；保存成功后删除对应草稿。
- 启动扫描草稿：有候选时显示“恢复/丢弃/对照”；恢复只进编辑器内存，不自动覆盖源脚本；用户点保存才写源文件。
- 对照：显示源路径、草稿时间、docId、修订号、摘要；不显示整份脚本正文。
- 丢弃：删除草稿文件；二次确认；不影响源脚本。
- 大小上限 5 MB/条、50 条；超过拒绝并提示；坏草稿只跳过该条，其他保留。
- 草稿保存失败不阻塞编辑；状态区提示“草稿未保存”；关闭时若既没保存也没草稿，仍走未保存三选一。
- 不把草稿当“已保存”；不因草稿存在就清脏。

## 安全 preload

`preload.cjs` 只暴露 typed `window.workbench`：

```ts
interface WorkbenchBridge {
  window: {
    minimize(): void
    maximize(): void
    close(): void
    isMaximized(): Promise<boolean>
    onMaximizeChange(cb: (maximized: boolean) => void): () => void
  }
  theme: {
    setSource(appearance: 'dark' | 'light' | 'high-contrast'): void
    setWindowBackground(color: string): void
    onSystemChange(cb: (state: { dark: boolean; highContrast: boolean }) => void): () => void
  }
  files: FileDialogPort
  shell: ShellPort
  drafts: DraftPort
  menu: {
    sync(items: MenuState[]): void
    onCommand(cb: (commandId: string) => void): () => void
  }
  initialTheme: ThemeCache
}
```

约束：

- 不暴露 `ipcRenderer`、`require`、`process`、`fs`、`path` 给 renderer。
- 每个 IPC handler 校验 `event.senderFrame`/`event.sender` 是主窗口；拒绝其他 frame。
- `setWindowOpenHandler` 一律 deny；`will-navigate` 只允许应用自身 URL；外部链接走 `openExternal` 白名单。
- `session.setPermissionRequestHandler` 默认 deny（摄像头/麦克风/通知/剪贴板读写等）；需要时逐项显式允许。
- CSP：`default-src 'self'`；`script-src 'self'`；`style-src 'self' 'unsafe-inline'`（Vue scoped style 需要时再评估）；`img-src 'self' data:`；`connect-src 'self' ws://127.0.0.1:*`（WebUI 本地服务）；不加载远程脚本/iframe。
- `sandbox:true`；如果 preload 需要的 API 在 sandbox 下不可用，改用主进程 IPC，不关 sandbox。
- `webSecurity:true`；不关 `allowRunningInsecureContent`；不设置 `webviewTag`。
- 退出时清理 IPC listener、窗口状态 flush、草稿 flush。

## HostPort 抽象

04 不把 Electron 类型散到工作台：

```ts
interface HostPort {
  window: WindowPort
  files: FileDialogPort
  shell: ShellPort
  theme: ThemeHostPort
  drafts: DraftPort
  menu: MenuPort
}
```

- WebUI：Electron 实现；浏览器 dev：内存/无操作实现，不假装有文件系统。
- 其他宿主实现同一接口：窗口按钮隐藏、文件选择走宿主服务、主题无 nativeTheme、草稿存宿主可写目录。
- 工作台/面板只依赖 `HostPort`/`PanelContext`，不直接 import `electron`。

## 验收

- 最小化/最大化/还原/关闭可用；双击标题栏最大化/还原；按钮区域不拖窗口。
- 移动/缩放窗口 → 重启恢复 bounds；最大化状态恢复；换屏/拔屏/改 DPI 后窗口仍可见、不小于 1280×720。
- 脏文档点关闭：保存/放弃/取消；取消窗口不关；保存失败/断连窗口不关。
- Windows/Linux 菜单项与命令 enabled/checked 同步；macOS native 菜单点击执行同一命令；快捷键与菜单不双触发。
- 打开脚本/文件夹/保存脚本/导入主题对话框可用；取消不改状态；renderer 无 `fs`/`path`。
- 制造未保存草稿 → 重启出现恢复/丢弃/对照；恢复不覆盖源脚本；保存成功草稿删除；丢弃只删草稿。
- `window.open`/外部导航/权限请求被 deny；`window.workbench` 只有 typed API；`rg` 无 `ipcRenderer` 暴露、无 `nodeIntegration:true`、无 `@electron/remote`。
- 43.2 下窗口状态用自研 adapter；不引 `electron-window-state`；44 升级后内置能力可替换且语义一致。

## 窗口与安全约束

- 文件系统只经白名单 preload 端口。
- `nodeIntegration:false`、`contextIsolation:true`、`sandbox:true`。
- 菜单/主题/脚本只从本地加载，不接远程。
- 43.2 窗口状态用自研 adapter；44 升级后换内置能力，语义保持一致。
- 草稿不是源脚本；草稿保存不改变文档脏标记。
- 关闭保存失败时不退出。
- 窗口状态只存 bounds/最大化，不存业务状态。
