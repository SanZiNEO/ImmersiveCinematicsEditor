/**
 * 诊断 sink 实现（04-06 / 04-11）。
 *
 * 唯一写入点；按来源分组展示由面板负责，这里只保证顺序、计数与订阅。
 */
import type {
  Diagnostic,
  DiagnosticInput,
  DiagnosticSeverity,
  DiagnosticSink,
} from '../api/diagnostics.ts'

export class DiagnosticsStore implements DiagnosticSink {
  private items: Diagnostic[] = []
  private sequence = 0
  private readonly listeners = new Set<(items: readonly Diagnostic[]) => void>()

  private readonly now: () => Date

  constructor(now: () => Date = () => new Date()) {
    this.now = now
  }

  report(input: DiagnosticInput): Diagnostic {
    this.sequence += 1
    const diagnostic: Diagnostic = {
      id: `d${this.sequence}`,
      severity: input.severity,
      source: input.source,
      message: input.message,
      timestamp: this.now().toISOString(),
      ...(input.pluginId === undefined ? {} : { pluginId: input.pluginId }),
      ...(input.detail === undefined ? {} : { detail: input.detail }),
    }
    this.items.push(diagnostic)
    this.emit()
    return diagnostic
  }

  list(): readonly Diagnostic[] {
    return this.items
  }

  countBySeverity(severity: DiagnosticSeverity): number {
    return this.items.filter((item) => item.severity === severity).length
  }

  subscribe(listener: (items: readonly Diagnostic[]) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  clearHandled(ids: readonly string[]): void {
    const handled = new Set(ids)
    this.items = this.items.filter((item) => !handled.has(item.id))
    this.emit()
  }

  clear(): void {
    this.items = []
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.items)
    }
  }
}
