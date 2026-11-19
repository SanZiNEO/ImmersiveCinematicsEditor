/**
 * 12 轮生成校验诊断结构（spec §2.2，F/G/E 复用）。
 *
 * 稳定错误码前缀：T_（模板）/ G_（几何）/ C_（曲线）/ S_（字幕）；本切片只产 T_ 与 document 映射。
 * 诊断只带定位字段，不暴露内部结构；消息面向作者。
 */

export type DiagnosticSeverity = 'error' | 'warning' | 'info'
export type DiagnosticSource = 'template' | 'geometry' | 'curve' | 'subtitle' | 'document'

export interface Diagnostic {
  code: string
  severity: DiagnosticSeverity
  message: string
  source: DiagnosticSource
  templateId?: string
  refChain?: string[]
  paramKey?: string
  trackId?: string
  clipKey?: string
  pathId?: string
  fieldPath?: string
  detail?: string
}

/** 诊断定位字段（`diagnosticOf` 的可选附加项）。 */
export interface DiagnosticLoc {
  templateId?: string
  refChain?: string[]
  paramKey?: string
  trackId?: string
  clipKey?: string
  pathId?: string
  fieldPath?: string
  detail?: string
}

/**
 * 构造一条诊断。`code` 必须带稳定前缀；`source` 标明产出链路。
 */
export function diagnosticOf(
  code: string,
  severity: DiagnosticSeverity,
  message: string,
  source: DiagnosticSource,
  loc?: DiagnosticLoc,
): Diagnostic {
  const diagnostic: Diagnostic = { code, severity, message, source }
  if (loc === undefined) {
    return diagnostic
  }
  if (loc.templateId !== undefined) diagnostic.templateId = loc.templateId
  if (loc.refChain !== undefined) diagnostic.refChain = [...loc.refChain]
  if (loc.paramKey !== undefined) diagnostic.paramKey = loc.paramKey
  if (loc.trackId !== undefined) diagnostic.trackId = loc.trackId
  if (loc.clipKey !== undefined) diagnostic.clipKey = loc.clipKey
  if (loc.pathId !== undefined) diagnostic.pathId = loc.pathId
  if (loc.fieldPath !== undefined) diagnostic.fieldPath = loc.fieldPath
  if (loc.detail !== undefined) diagnostic.detail = loc.detail
  return diagnostic
}

/** 诊断去重键：同码同消息同定位视为重复。 */
function diagnosticKey(diagnostic: Diagnostic): string {
  return [
    diagnostic.code,
    diagnostic.message,
    diagnostic.templateId ?? '',
    diagnostic.paramKey ?? '',
    diagnostic.trackId ?? '',
    diagnostic.clipKey ?? '',
    diagnostic.pathId ?? '',
    diagnostic.fieldPath ?? '',
    (diagnostic.refChain ?? []).join('>'),
  ].join('|')
}

/** 按稳定键去重，保留首次出现的顺序。 */
export function dedupeDiagnostics(list: readonly Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>()
  const out: Diagnostic[] = []
  for (const diagnostic of list) {
    const key = diagnosticKey(diagnostic)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push(diagnostic)
  }
  return out
}
