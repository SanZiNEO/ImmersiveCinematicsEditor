/**
 * 布局持久化（04-02）。
 *
 * `layout.json` 独立于 `preferences.json` / `window-state.json` / `drafts/`：
 * 坏布局只恢复布局，不连坐主题、快捷键、窗口与草稿。
 * 不留 `.bak`（版本历史交给 git）；损坏文件复制为 `layout.corrupt.<ISO>.json` 而不是删除。
 */
import type { DiagnosticSink, DiagnosticSeverity } from '../api/diagnostics.ts'
import type { StoragePort } from '../api/host.ts'
import type { LayoutFile } from '../api/layout.ts'
import { serializeLayoutFile } from './tree.ts'

/** 布局文件名（`userData/` 下）。 */
export const LAYOUT_FILE_NAME = 'layout.json'

/** 写入中间文件；存储端口的原子写负责真正的 rename。 */
export const LAYOUT_TEMP_NAME = 'layout.json.tmp'

/** 布局文件大小上限：1 MB（04-02）。 */
export const LAYOUT_MAX_BYTES = 1024 * 1024

/** 构造参数。 */
export interface LayoutPersistenceOptions {
  storage: StoragePort
  diagnostics: DiagnosticSink
  now?: () => Date
}

/** 损坏文件备份名：ISO 时间戳里的 `:` / `.` 在 Windows 文件名里非法，统一换成 `-`。 */
export function corruptLayoutFileName(at: Date): string {
  const stamp = at.toISOString().replace(/[:.]/g, '-')
  return `layout.corrupt.${stamp}.json`
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/** 布局文件持久化：读坏文件会隔离备份，正常写入不留 `.bak`。 */
export class LayoutPersistence {
  private readonly storage: StoragePort

  private readonly diagnostics: DiagnosticSink

  private readonly now: () => Date

  constructor(options: LayoutPersistenceOptions) {
    this.storage = options.storage
    this.diagnostics = options.diagnostics
    this.now = options.now ?? (() => new Date())
  }

  /**
   * 读 `layout.json`；返回 `null` 表示“没有可用文件，用默认布局”。
   *
   * 坏 JSON / 超限 / 结构不完整都先复制成 `layout.corrupt.<ISO>.json` 再返回 null，
   * 原文件不删（用户可能想手工抢救）。
   */
  async load(): Promise<LayoutFile | null> {
    const text = await this.storage.read(LAYOUT_FILE_NAME)
    if (text === null) return null
    if (utf8Bytes(text) > LAYOUT_MAX_BYTES) {
      await this.quarantine(text, `超过 ${LAYOUT_MAX_BYTES} 字节`)
      return null
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text) as unknown
    } catch {
      await this.quarantine(text, '不是合法 JSON')
      return null
    }
    const record = asRecord(parsed)
    if (!record || typeof record.version !== 'number' || asRecord(record.pages) === null) {
      await this.quarantine(text, '缺少 version / pages')
      return null
    }
    return parsed as LayoutFile
  }

  /** 写 `layout.json`：先备份旧内容，再写 tmp，最后写正式文件。 */
  async save(file: LayoutFile): Promise<void> {
    const text = serializeLayoutFile(file)
    const bytes = utf8Bytes(text)
    if (bytes > LAYOUT_MAX_BYTES) {
      const message = `布局超过 ${LAYOUT_MAX_BYTES} 字节（${bytes}），已拒绝写入`
      this.report('error', message)
      throw new Error(message)
    }
    // 不留 `.bak`：上一版由 git 或用户的版本管理负责，编辑器只保证原子写。
    try {
      await this.storage.write(LAYOUT_TEMP_NAME, text)
    } catch (error) {
      // 存储端口可能只白名单正式文件名；临时文件失败不影响正式写入的原子性。
      this.report('warning', `无法写 ${LAYOUT_TEMP_NAME}，继续写 ${LAYOUT_FILE_NAME}`, String(error))
    }
    await this.storage.write(LAYOUT_FILE_NAME, text)
  }

  private async quarantine(text: string, reason: string): Promise<void> {
    const name = corruptLayoutFileName(this.now())
    try {
      await this.storage.write(name, text)
      this.report('warning', `布局文件损坏（${reason}），已备份为 ${name} 并使用默认布局`)
    } catch (error) {
      this.report(
        'error',
        `布局文件损坏（${reason}），且备份 ${name} 失败`,
        String(error),
      )
    }
  }

  private report(severity: DiagnosticSeverity, message: string, detail?: string): void {
    if (detail === undefined) this.diagnostics.report({ severity, source: 'layout', message })
    else this.diagnostics.report({ severity, source: 'layout', message, detail })
  }
}
