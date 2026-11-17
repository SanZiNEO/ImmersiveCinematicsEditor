/**
 * 浏览器 dev 宿主（04-09）。
 *
 * 明确约束：浏览器 dev 不持久化、不假装有文件系统。
 * - storage 只在内存 Map 里活到刷新；
 * - files 全部返回 `null`；
 * - drafts 为空；
 * - menu 无操作；
 * - theme 没有 nativeTheme（只记录调用）；
 * - window 只做最小内存状态，无法真正最小化/关闭标签页。
 */
import type { MenuState } from '../../api/commands.ts'
import type {
  DraftPort,
  DraftRecord,
  DraftSummary,
  FileDialogPort,
  HostPort,
  MenuPort,
  ShellPort,
  StoragePort,
  ThemeHostPort,
  WindowPort,
} from '../../api/host.ts'
import type { SystemThemeState, ThemeAppearance, ThemeCache } from '../../api/theme.ts'

class MemoryWindow implements WindowPort {
  private maximized = false
  private readonly maximizeListeners = new Set<(maximized: boolean) => void>()
  private readonly closeListeners = new Set<() => void>()

  minimize(): void {
    console.info('[browser] window.minimize 无宿主窗口，忽略')
  }

  maximize(): void {
    this.maximized = !this.maximized
    for (const listener of [...this.maximizeListeners]) listener(this.maximized)
  }

  close(): void {
    for (const listener of [...this.closeListeners]) listener()
  }

  async isMaximized(): Promise<boolean> {
    return this.maximized
  }

  onMaximizeChange(listener: (maximized: boolean) => void): () => void {
    this.maximizeListeners.add(listener)
    return () => {
      this.maximizeListeners.delete(listener)
    }
  }

  setBackground(color: string): void {
    console.info('[browser] window.setBackground 无原生窗口，记录后忽略', color)
  }

  onCloseRequest(listener: () => void): () => void {
    this.closeListeners.add(listener)
    return () => {
      this.closeListeners.delete(listener)
    }
  }

  confirmClose(): void {
    console.info('[browser] window.confirmClose 无宿主窗口，忽略')
  }
}

class BrowserFiles implements FileDialogPort {
  async openScript(): Promise<string | null> {
    return null
  }

  async openFolder(): Promise<string | null> {
    return null
  }

  async saveScript(): Promise<string | null> {
    return null
  }

  async importTheme(): Promise<string | null> {
    return null
  }

  async confirm(): Promise<number> {
    // 浏览器 dev 没有原生对话框：返回 -1（= 取消），让守卫保持原状而不是假装保存成功。
    return -1
  }

  async readText(): Promise<string | null> {
    return null
  }
}

class BrowserShell implements ShellPort {
  showItemInFolder(path: string): void {
    console.info('[browser] shell.showItemInFolder 无文件系统，忽略', path)
  }

  openExternal(url: string): void {
    console.info('[browser] shell.openExternal 请手动打开', url)
  }
}

class BrowserTheme implements ThemeHostPort {
  private source: ThemeAppearance = 'dark'
  private background = ''

  setSource(appearance: ThemeAppearance): void {
    this.source = appearance
  }

  setWindowBackground(color: string): void {
    this.background = color
  }

  onSystemChange(_listener: (state: SystemThemeState) => void): () => void {
    return () => undefined
  }

  initialTheme(): ThemeCache | null {
    return null
  }
}

class BrowserDrafts implements DraftPort {
  async list(): Promise<DraftSummary[]> {
    return []
  }

  async read(): Promise<DraftRecord | null> {
    return null
  }

  async write(): Promise<void> {
    return undefined
  }

  async remove(): Promise<void> {
    return undefined
  }
}

class BrowserMenu implements MenuPort {
  sync(_items: MenuState[]): void {
    // 浏览器没有原生菜单；菜单由页面内 AppTopBar 渲染。
  }

  onCommand(_listener: (commandId: string) => void): () => void {
    return () => undefined
  }
}

class MemoryStorage implements StoragePort {
  private readonly files = new Map<string, string>()

  async read(name: string): Promise<string | null> {
    return this.files.get(name) ?? null
  }

  async write(name: string, text: string): Promise<void> {
    this.files.set(name, text)
  }

  async remove(name: string): Promise<void> {
    this.files.delete(name)
  }

  async list(prefix = ''): Promise<string[]> {
    const normalized = prefix.replace(/\/+$/, '')
    return [...this.files.keys()]
      .filter((name) => normalized === '' || name === normalized || name.startsWith(`${normalized}/`))
      .sort()
  }

  async listCorrupt(_prefix: string): Promise<string[]> {
    return []
  }

  /** 浏览器 dev 无文件系统：返回 true 表示「无法判定」，不把未知路径标成 missing。 */
  async exists(_path: string): Promise<boolean> {
    return true
  }

  revealUserData(): void {
    console.info('[browser] storage.revealUserData 无 userData 目录，忽略')
  }
}

export class BrowserHost implements HostPort {
  readonly kind = 'browser' as const
  readonly platform = 'web' as const
  readonly window = new MemoryWindow()
  readonly files = new BrowserFiles()
  readonly shell = new BrowserShell()
  readonly theme = new BrowserTheme()
  readonly drafts = new BrowserDrafts()
  readonly menu = new BrowserMenu()
  readonly storage = new MemoryStorage()
}

export function createBrowserHost(): HostPort {
  return new BrowserHost()
}
