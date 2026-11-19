/**
 * 12 轮「模板内核」门面（spec §2.1，B 只依赖这一个文件）。
 *
 * 对外只暴露类型与六个函数；内部引擎 / 注册表 / 装配 / 校验细节不进门面。
 */
import type { DocCommand } from '../../core/doc/commands.ts'
import { diagnosticOf, dedupeDiagnostics, type Diagnostic } from '../generation/diagnostics.ts'
import {
  assembleDraftDoc,
  validateAssembledDoc,
  validateDraftStructure,
} from '../generation/validate.ts'
import { internalById, listTemplates, registryIssues, templateById } from './registry.ts'
import { defaultParams, resolveParams, validateTemplateParams } from './params.ts'
import { expandTemplate } from './engine.ts'
import { planAssembly } from './assembly.ts'
import { emptyDraft, type LayerDraft } from './model.ts'
import type {
  GenerationPlan,
  GenerationRequest,
  ParamValue,
  PoseValue,
  StructureSummary,
  TemplateDefinition,
  TemplateLayer,
  TemplateParamIssue,
} from './types.ts'

export type {
  GenerationPlan,
  GenerationRequest,
  ParamValue,
  PoseValue,
  StructureSummary,
  TemplateDefinition,
  TemplateLayer,
  TemplateParamIssue,
}

function paramIssueToDiagnostic(issue: TemplateParamIssue, templateId: string): Diagnostic {
  return diagnosticOf(
    issue.code,
    issue.severity,
    issue.message,
    'template',
    { templateId, paramKey: issue.paramKey ?? undefined },
  )
}

function emptySummary(def: TemplateDefinition | null): StructureSummary {
  return {
    clipCount: 0,
    trackCount: 0,
    pathCount: 0,
    triggerCount: 0,
    totalDuration: 0,
    segments: [],
    targetTrackTypes: def?.targetTrackTypes ?? [],
    createsTrack: false,
    createsDocument: false,
    conflicts: [],
    notes: [],
  }
}

function failPlan(
  templateId: string,
  def: TemplateDefinition | null,
  diagnostics: Diagnostic[],
): GenerationPlan {
  return {
    ok: false,
    templateId,
    layer: def?.layer ?? 'clip',
    summary: emptySummary(def),
    command: null,
    diagnostics: dedupeDiagnostics(diagnostics),
    selectedClipKeys: [],
  }
}

/** 门面：按层列出可用模板（注册顺序即展示顺序）。 */
export { listTemplates, templateById, defaultParams, validateTemplateParams }

/**
 * 生成前结构摘要 + 参数问题（不提交命令、不触达第四层脚本校验）。
 */
export function summarizeGeneration(
  request: GenerationRequest,
): { summary: StructureSummary; issues: TemplateParamIssue[] } {
  const internal = internalById(request.templateId)
  if (internal === null) {
    return { summary: emptySummary(null), issues: [] }
  }
  const def = internal.def
  const paramIssues = validateTemplateParams(def, request.params)
  const resolved = resolveParams(def, request.params)
  const cross = internal.crossCheck?.(resolved) ?? []
  const issues = [...paramIssues, ...cross]

  let draft: LayerDraft = emptyDraft()
  if (!issues.some((issue) => issue.severity === 'error')) {
    const expanded = expandTemplate(internal, resolved, internalById, request.catalog)
    draft = expanded.draft
  }
  const assembly = planAssembly(internal, draft, request, request.catalog)
  return { summary: assembly.summary, issues }
}

/**
 * 四层校验后给出一次事务命令；任何 error → `ok=false`、`command=null`、零残留。
 */
export function planGeneration(request: GenerationRequest): GenerationPlan {
  const internal = internalById(request.templateId)
  if (internal === null) {
    const diagnostic = diagnosticOf(
      'T_UNKNOWN_TEMPLATE', 'error', `模板 ${request.templateId} 未登记或不可用`, 'template',
      { templateId: request.templateId },
    )
    return failPlan(request.templateId, null, [diagnostic])
  }
  const def = internal.def
  const diagnostics: Diagnostic[] = []

  // 第一层：参数校验 + 跨参数校验。
  const paramIssues = validateTemplateParams(def, request.params)
  const resolved = resolveParams(def, request.params)
  const crossIssues = internal.crossCheck?.(resolved) ?? []
  for (const issue of [...paramIssues, ...crossIssues]) {
    diagnostics.push(paramIssueToDiagnostic(issue, def.id))
  }
  if (diagnostics.some((item) => item.severity === 'error')) {
    return failPlan(def.id, def, diagnostics)
  }

  // 第二层：嵌套展开 + 草稿结构事实校验。
  const expanded = expandTemplate(internal, resolved, internalById, request.catalog)
  diagnostics.push(...expanded.diagnostics)
  diagnostics.push(...validateDraftStructure(expanded.draft, request.catalog))
  if (diagnostics.some((item) => item.severity === 'error')) {
    return failPlan(def.id, def, diagnostics)
  }

  // 第三层：装配（目标 / 类型 / 重叠 / id / 命令）。
  const assembly = planAssembly(internal, expanded.draft, request, request.catalog)
  diagnostics.push(...assembly.diagnostics)
  if (!assembly.ok) {
    return failPlan(def.id, def, diagnostics)
  }

  // 第四层：最终脚本校验（复用既有 validateStructure）。
  const assembled = assembleDraftDoc(request.doc, expanded.draft)
  diagnostics.push(...validateAssembledDoc(assembled, request.catalog, def.id))
  if (diagnostics.some((item) => item.severity === 'error')) {
    return failPlan(def.id, def, diagnostics)
  }

  const command: DocCommand = assembly.commands.length === 1
    ? assembly.commands[0]
    : { kind: 'compound', commands: assembly.commands }

  return {
    ok: true,
    templateId: def.id,
    layer: def.layer,
    summary: assembly.summary,
    command,
    diagnostics: dedupeDiagnostics(diagnostics),
    selectedClipKeys: assembly.selectedClipKeys,
  }
}

/** 注册表登记问题（集成方启动时可上报；只影响对应模板可用性）。 */
export { registryIssues }
