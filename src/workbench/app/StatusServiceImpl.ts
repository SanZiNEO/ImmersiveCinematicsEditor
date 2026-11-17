/**
 * 状态区服务（04-04 AppStatusBar / 04-05 PanelContext.status）。
 *
 * 只读状态 + 非阻塞临时提示；不承载字段校验（那是诊断面板与字段原位提示的事）。
 */
import type { DiagnosticSink } from '../api/diagnostics.ts'
import type { StatusApi } from '../api/context.ts'

export type TransientSeverity = 'info' | 'warning' | 'error'

export interface TransientMessage {
  message: string
  severity: TransientSeverity
}

/** 状态服务实现。 */
export class StatusServiceImpl implements StatusApi {
  private current: TransientMessage | null = null
  private readonly listeners = new Set<() => void>()
  private readonly sink: DiagnosticSink

  constructor(sink: DiagnosticSink) {
    this.sink = sink
  }

  notify(message: string, severity: TransientSeverity = 'info'): void {
    this.current = { message, severity }
    // 状态区提示不冒充诊断：用户操作失败（离线保存/新建被拒）是预期错误路径，
    // 进诊断会淹没真正的宿主/插件故障。诊断由真正失败的调用方按自己的 source 记录。
    this.emit()
  }

  clearTransient(): void {
    if (this.current === null) {
      return
    }
    this.current = null
    this.emit()
  }

  transient(): TransientMessage | null {
    return this.current
  }

  diagnostics(): DiagnosticSink {
    return this.sink
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }
}
