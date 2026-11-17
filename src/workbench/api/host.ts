/**
 * 宿主端口（04-09）。
 *
 * 工作台与面板只依赖这些端口，不直接 import `electron`。
 * WebUI 用 Electron 实现；浏览器 dev 用内存 / 无操作实现，不假装有文件系统。
 */
import type { ThemeAppearance, SystemThemeState, ThemeCache } from './theme.ts'
import type { MenuState } from './commands.ts'

/** 窗口端口。 */
export interface WindowPort {
  minimize(): void
  maximize(): void
  close(): void
  isMaximized(): Promise<boolean>
  onMaximizeChange(listener: (maximized: boolean) => void): () => void
  /** 标题栏 / 窗口底色（防白闪）。 */
  setBackground(color: string): void
  /**
   * 用户点了关闭按钮：主进程先发这个事件，渲染进程走 `UnsavedGuard` 后
   * 调 `confirmClose()` 真正关闭（取消则什么都不做）。
   */
  onCloseRequest(listener: () => void): () => void
  /** 放行一次关闭（只在 `UnsavedGuard` 确认后调用）。 */
  confirmClose(): void
}

/** 文件对话框端口：全部走主进程，renderer 不读文件、不拼路径。 */
export interface FileDialogPort {
  openScript(): Promise<string | null>
  openFolder(): Promise<string | null>
  saveScript(defaultPath?: string): Promise<string | null>
  importTheme(): Promise<string | null>
  confirm(message: string, detail?: string, buttons?: string[]): Promise<number>
  /**
   * 读一个已由对话框选中的文本文件（导入主题用）。
   *
   * 主进程侧限制：只接受 `.json`、≤256 KB、只读；路径必须来自对话框或最近项目，
   * 不接受 renderer 随意拼的任意路径。
   */
  readText(path: string): Promise<string | null>
}

/** shell 端口（白名单）。 */
export interface ShellPort {
  showItemInFolder(path: string): void
  openExternal(url: string): void
}

/** 主题宿主端口：只改原生 `themeSource` 与窗口底色。 */
export interface ThemeHostPort {
  setSource(appearance: ThemeAppearance): void
  setWindowBackground(color: string): void
  onSystemChange(listener: (state: SystemThemeState) => void): () => void
  /** 读启动缓存（防白闪）；无宿主实现时返回 `null`。 */
  initialTheme(): ThemeCache | null
}

/** 草稿摘要（不显示整份脚本正文）。 */
export interface DraftSummary {
  draftId: string
  docId: string
  sourcePath?: string
  capturedAt: string
  docRevision: number
  hash: string
  bytes: number
}

/** 草稿记录（写入用）。 */
export interface DraftRecord {
  version: 1
  draftId: string
  docId: string
  sourcePath?: string
  capturedAt: string
  docRevision: number
  hash: string
  /** 03 序列化的不透明快照（字符串形态，避免跨进程结构体）。 */
  payload: string
}

/** 草稿端口。 */
export interface DraftPort {
  list(): Promise<DraftSummary[]>
  read(draftId: string): Promise<DraftRecord | null>
  write(record: DraftRecord): Promise<void>
  remove(draftId: string): Promise<void>
}

/** 菜单端口。 */
export interface MenuPort {
  sync(items: MenuState[]): void
  onCommand(listener: (commandId: string) => void): () => void
}

/** 存储端口：只允许白名单文件（`preferences.json` / `layout.json` / `window-state.json` / `themes/*`）。 */
export interface StoragePort {
  read(name: string): Promise<string | null>
  /** 原子写（tmp + rename）；不留 `.bak`（版本历史交给 git）。 */
  write(name: string, text: string): Promise<void>
  remove(name: string): Promise<void>
  list(prefix?: string): Promise<string[]>
  /** 读取损坏文件备份（诊断用）。 */
  listCorrupt(prefix: string): Promise<string[]>
  /**
   * 路径是否存在（只读布尔，不返回内容；最近项目的 `missing` 探测用）。
   *
   * 浏览器 dev 无文件系统，返回 `true` 并保持「无法判定」语义。
   */
  exists(path: string): Promise<boolean>
  revealUserData(): void
}

/**
 * 工作区端口：直接读写 `<游戏根目录>/immersive_cinematics/`。
 *
 * 脚本与资源都在这个目录下（`scripts/` 可再分子文件夹），编辑器**自己**读写，
 * 不经过模组的 WebSocket 通道——模组只在推送播放和预览画面时参与。
 */
export interface WorkspacePort {
  /** 当前工作区根（`.../immersive_cinematics`）；未设置时为 `null`。 */
  root(): Promise<string | null>
  /** 记住工作区根（用户选目录后调用）；返回归一化后的根（`.../immersive_cinematics`）。 */
  setRoot(path: string): Promise<string>
  /**
   * 递归列出 `scripts/` 下的脚本相对路径（`/` 分隔，相对 `scripts/`）。
   *
   * 一次扫描拿到全部路径：10 万脚本也只有一次 I/O 往返。
   */
  listScripts(): Promise<string[]>
  /** 读脚本原文 + 指纹（`mtime:size`）；不存在返回 `null`。 */
  readScript(path: string): Promise<{ text: string; stamp: string } | null>
  /** 原子写脚本（tmp + rename），必要时建父目录。 */
  writeScript(path: string, text: string): Promise<void>
  /** 删除脚本；不存在不报错。 */
  removeScript(path: string): Promise<void>
  /**
   * 文件指纹（mtime + size），增量扫描用：没变就不重解析。
   *
   * 返回 `path → "mtime:size"`；实现可以只返回已存在的文件。
   */
  scriptStamps(): Promise<Record<string, string>>
  /** 脚本是否已存在（新建防覆盖）。 */
  scriptExists(path: string): Promise<boolean>
}

/** 宿主能力集合。 */
export interface HostPort {
  readonly kind: 'electron' | 'browser'
  readonly platform: 'win32' | 'darwin' | 'linux' | 'web'
  readonly window: WindowPort
  readonly files: FileDialogPort
  readonly shell: ShellPort
  readonly theme: ThemeHostPort
  readonly drafts: DraftPort
  readonly menu: MenuPort
  readonly storage: StoragePort
  readonly workspace: WorkspacePort
}

/** preload 暴露的桥（`window.workbench`）；渲染进程只能看到这些字段。 */
export interface WorkbenchBridge extends HostPort {
  /** WebUI 握手 token（由主进程读 token 文件；不落盘、不写偏好）。 */
  webuiToken(): string
}
