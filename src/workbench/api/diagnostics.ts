/**
 * 工作台诊断（04-06 抽屉 / 04-04 状态区 / 04-11 验收）。
 *
 * 诊断是工作台级只读记录：插件加载失败、manifest 重复/依赖缺失、布局恢复、主题回退、
 * preload/IPC 失败、面板加载失败、命令求值失败。它不是第二套字段校验入口。
 */

/** 诊断来源。 */
export type DiagnosticSource =
  | 'plugin'
  | 'layout'
  | 'theme'
  | 'preload'
  | 'ipc'
  | 'panel'
  | 'command'
  | 'document'
  | 'preferences'

/** 诊断级别。 */
export type DiagnosticSeverity = 'error' | 'warning' | 'info'

/** 一条诊断。 */
export interface Diagnostic {
  id: string
  severity: DiagnosticSeverity
  source: DiagnosticSource
  pluginId?: string
  message: string
  detail?: string
  /** ISO 时间。 */
  timestamp: string
}

/** 报告入参（id / timestamp 由 sink 生成）。 */
export type DiagnosticInput = Omit<Diagnostic, 'id' | 'timestamp'> & {
  detail?: string
}

/** 诊断 sink：唯一写入点；读取方只读快照。 */
export interface DiagnosticSink {
  report(input: DiagnosticInput): Diagnostic
  list(): readonly Diagnostic[]
  countBySeverity(severity: DiagnosticSeverity): number
  subscribe(listener: (items: readonly Diagnostic[]) => void): () => void
  /** 只清 UI 已处理记录，不删源错误来源。 */
  clearHandled(ids: readonly string[]): void
  clear(): void
}
