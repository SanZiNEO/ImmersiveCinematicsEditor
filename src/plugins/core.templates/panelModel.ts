/**
 * 模板面板视图模型（12-06）：纯函数，吃普通数据，产出面板渲染 / 断言可用的模型。
 *
 * 面板 `.vue` 只做接线：从 `DocumentService` 取只读快照与选区，调本模块函数，
 * 写文档只走 `PanelContext.commands`。自检直接断言本模块与模板内核门面的纯函数，
 * 不靠看界面。本模块不依赖 Vue 运行时；`node --experimental-strip-types` 下可直接 import。
 *
 * 数字与事实全部来自模板内核的 `StructureSummary` / 计划结果；本模块不估算片段数、
 * 时长或冲突，也不画假预览。
 */
import type { CatalogIndex } from '../../core/schema/index.ts'
import type { DocCommand } from '../../core/doc/commands.ts'
import type { JsonObject, JsonValue, ScriptDoc } from '../../core/doc/types.ts'
import { isJsonObject } from '../../core/doc/json.ts'
import type { CommitOutcome } from '../../workbench/api/documents.ts'
import {
  listTemplates,
  templateById,
  defaultParams,
  summarizeGeneration,
  planGeneration,
  type GenerationPlan,
  type GenerationRequest,
  type ParamValue,
  type StructureSummary,
  type TemplateDefinition,
  type TemplateLayer,
  type TemplateParamIssue,
} from '../../features/templates/public.ts'
import type { InsertTarget, ParamDecl } from '../../features/templates/types.ts'

// ── 层分组与搜索 ────────────────────────────────────────────────────────────

/** 三层顺序（面板页签 / 分组展示顺序）。 */
export const LAYERS: readonly TemplateLayer[] = ['clip', 'track', 'script']

/** 列表项模型：标题 / 说明走 i18n 键，不在本层做本地化。 */
export interface TemplateListItem {
  id: string
  layer: TemplateLayer
  titleKey: string
  descriptionKey: string
  targetTrackTypes: readonly string[]
}

function matchesQuery(def: TemplateDefinition, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  return (
    def.id.toLowerCase().includes(q)
    || def.titleKey.toLowerCase().includes(q)
    || def.descriptionKey.toLowerCase().includes(q)
  )
}

/** 按层 + 搜索词列出模板（注册顺序即展示顺序）。 */
export function templatesForLayer(layer: TemplateLayer, query: string): TemplateListItem[] {
  return listTemplates(layer)
    .filter((def) => matchesQuery(def, query))
    .map((def) => ({
      id: def.id,
      layer: def.layer,
      titleKey: def.titleKey,
      descriptionKey: def.descriptionKey,
      targetTrackTypes: def.targetTrackTypes,
    }))
}

/** 按 id 取模板定义；未登记返回 `null`。 */
export function findTemplate(id: string): TemplateDefinition | null {
  return templateById(id)
}

/** 模板参数草稿：默认值完全来自声明（门面 `defaultParams`），不另写一套默认规则。 */
export function initialParams(def: TemplateDefinition): Record<string, ParamValue> {
  return defaultParams(def)
}

// ── 参数错误映射 ────────────────────────────────────────────────────────────

/** 字段级错误视图：错误 / 警告 / 信息都带定位键。 */
export interface ParamIssueView {
  paramKey: string
  code: string
  severity: TemplateParamIssue['severity']
  message: string
}

/** 问题按参数键分组（`paramKey === null` 的归到 `''` 全局组）。 */
export function issuesByParam(issues: readonly TemplateParamIssue[]): Map<string, ParamIssueView[]> {
  const map = new Map<string, ParamIssueView[]>()
  for (const issue of issues) {
    const key = issue.paramKey ?? ''
    const list = map.get(key) ?? []
    list.push({
      paramKey: issue.paramKey ?? '',
      code: issue.code,
      severity: issue.severity,
      message: issue.message,
    })
    map.set(key, list)
  }
  return map
}

/** 取某参数的第一条 error 文案；无 error 返回 `null`（warning / info 不挡生成）。 */
export function issueMessage(issues: readonly TemplateParamIssue[], paramKey: string): string | null {
  for (const issue of issues) {
    if (issue.paramKey === paramKey && issue.severity === 'error') {
      return issue.message
    }
  }
  return null
}

/** 是否存在任一 error 级问题。 */
export function hasError(issues: readonly TemplateParamIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error')
}

// ── 文档只读读取（面板快照；不改输入）─────────────────────────────────────────

interface DocTrack {
  trackId: string
  type: string
  clipKeys: string[]
}

function readTracks(doc: ScriptDoc | null): DocTrack[] {
  if (doc === null) return []
  const tracks = Array.isArray(doc.timeline.tracks) ? doc.timeline.tracks : []
  const out: DocTrack[] = []
  tracks.forEach((entry, index) => {
    if (!isJsonObject(entry)) return
    const type = typeof entry.type === 'string' ? entry.type : ''
    const clips = Array.isArray(entry.clips) ? entry.clips : []
    const clipKeys: string[] = []
    for (const clip of clips) {
      if (isJsonObject(clip) && typeof clip.id === 'string') clipKeys.push(clip.id)
    }
    out.push({ trackId: `${type}#${index}`, type, clipKeys })
  })
  return out
}

/** 文档是否为空：无片段、无根路径、无触发器声明。脚本层「替换空文档」用。 */
export function docIsEmpty(doc: ScriptDoc | null): boolean {
  if (doc === null) return true
  if (readTracks(doc).some((track) => track.clipKeys.length > 0)) return false
  const rootPaths = doc.root.paths
  if (Array.isArray(rootPaths) && rootPaths.length > 0) return false
  const triggers = doc.meta.triggers
  if (Array.isArray(triggers) && triggers.length > 0) return false
  return true
}

// ── 插入目标 ─────────────────────────────────────────────────────────────────

/** 目标禁用原因码；面板映射为本地化文案，自检断言稳定码。 */
export type TargetReasonCode =
  | ''
  | 'noSelection'
  | 'selectionTypeMismatch'
  | 'noMatchingTrack'
  | 'docNonEmpty'

/** 一个可选插入目标。 */
export interface TargetOption {
  key: string
  mode: InsertTarget['mode']
  trackId?: string
  labelKey: string
  enabled: boolean
  reasonCode: TargetReasonCode
}

/** 目标求值上下文（只读快照 + 会话选区 + 播放头）。 */
export interface TargetContext {
  doc: ScriptDoc | null
  playhead: number
  selectedClipKeys: readonly string[]
}

/**
 * 按层给出可选插入目标：
 * - 片段层：播放头 / 选中之后 / 指定轨道（同类型既有轨）/ 新建轨道；
 * - 轨道层：新建轨道 / 追加到同类型轨道；
 * - 脚本层：新建文档 / 替换空文档。
 * 禁用项必须带原因码；目标类型不符不静默落到别的轨。
 */
export function targetOptions(def: TemplateDefinition, ctx: TargetContext): TargetOption[] {
  const tracks = readTracks(ctx.doc)
  const matching = tracks.filter((track) => def.targetTrackTypes.includes(track.type))
  const selectedKey = ctx.selectedClipKeys[0] ?? null
  const selectedTrack = selectedKey === null
    ? null
    : tracks.find((track) => track.clipKeys.includes(selectedKey)) ?? null

  const options: TargetOption[] = []

  if (def.layer === 'clip') {
    options.push({
      key: 'atPlayhead',
      mode: 'atPlayhead',
      labelKey: 'templates.target.atPlayhead',
      enabled: matching.length > 0,
      reasonCode: matching.length > 0 ? '' : 'noMatchingTrack',
    })
    options.push({
      key: 'afterSelection',
      mode: 'afterSelection',
      labelKey: 'templates.target.afterSelection',
      enabled: selectedTrack !== null
        && def.targetTrackTypes.includes(selectedTrack.type),
      reasonCode: selectedTrack === null
        ? 'noSelection'
        : def.targetTrackTypes.includes(selectedTrack.type)
          ? ''
          : 'selectionTypeMismatch',
    })
    for (const track of matching) {
      options.push({
        key: `atTrack:${track.trackId}`,
        mode: 'atTime',
        trackId: track.trackId,
        labelKey: 'templates.target.atTrack',
        enabled: true,
        reasonCode: '',
      })
    }
    options.push({
      key: 'newTrack',
      mode: 'newTrack',
      labelKey: 'templates.target.newTrack',
      enabled: true,
      reasonCode: '',
    })
    return options
  }

  if (def.layer === 'track') {
    options.push({
      key: 'newTrack',
      mode: 'newTrack',
      labelKey: 'templates.target.newTrack',
      enabled: true,
      reasonCode: '',
    })
    options.push({
      key: 'appendTrack',
      mode: 'appendTrack',
      labelKey: 'templates.target.appendTrack',
      enabled: matching.length > 0,
      reasonCode: matching.length > 0 ? '' : 'noMatchingTrack',
    })
    return options
  }

  // 脚本层
  options.push({
    key: 'newDocument',
    mode: 'newDocument',
    labelKey: 'templates.target.newDocument',
    enabled: true,
    reasonCode: '',
  })
  options.push({
    key: 'replaceEmpty',
    mode: 'newDocument',
    labelKey: 'templates.target.replaceEmpty',
    enabled: docIsEmpty(ctx.doc),
    reasonCode: docIsEmpty(ctx.doc) ? '' : 'docNonEmpty',
  })
  return options
}

/** 把选中的目标选项转成装配请求目标。 */
export function targetOfOption(option: TargetOption, playhead: number): InsertTarget {
  const target: InsertTarget = { mode: option.mode }
  if (option.trackId !== undefined) target.trackId = option.trackId
  if (option.mode === 'atTime') target.time = playhead
  return target
}

// ── 结构摘要视图 ────────────────────────────────────────────────────────────

export interface SegmentView {
  start: number
  duration: number
}

export interface ConflictView {
  clipKey: string
  start: number
  end: number
}

/** 摘要视图：字段名与 `StructureSummary` 一一对应，不补算。 */
export interface SummaryView {
  clipCount: number
  trackCount: number
  pathCount: number
  triggerCount: number
  totalDuration: number
  segments: SegmentView[]
  targetTrackTypes: readonly string[]
  createsTrack: boolean
  createsDocument: boolean
  conflicts: ConflictView[]
  notes: string[]
}

export function summaryView(summary: StructureSummary): SummaryView {
  return {
    clipCount: summary.clipCount,
    trackCount: summary.trackCount,
    pathCount: summary.pathCount,
    triggerCount: summary.triggerCount,
    totalDuration: summary.totalDuration,
    segments: summary.segments.map((segment) => ({ start: segment.start, duration: segment.duration })),
    targetTrackTypes: summary.targetTrackTypes,
    createsTrack: summary.createsTrack,
    createsDocument: summary.createsDocument,
    conflicts: summary.conflicts.map((conflict) => ({
      clipKey: conflict.clipKey,
      start: conflict.start,
      end: conflict.end,
    })),
    notes: [...summary.notes],
  }
}

// ── 请求构造与就绪判定 ───────────────────────────────────────────────────────

/** 构造生成请求（不计划、不提交）。 */
export function buildRequest(
  def: TemplateDefinition,
  params: Record<string, ParamValue>,
  target: InsertTarget,
  doc: ScriptDoc | null,
  catalog: CatalogIndex,
  playhead: number,
  selectedClipKeys: readonly string[],
): GenerationRequest {
  return {
    templateId: def.id,
    params,
    target,
    doc,
    catalog,
    playhead,
    selectedClipKeys,
  }
}

/** 生成前摘要 + 参数问题（门面 `summarizeGeneration`；不触达第四层校验）。 */
export function summarize(request: GenerationRequest): { summary: StructureSummary; issues: TemplateParamIssue[] } {
  return summarizeGeneration(request)
}

/** 四层校验后的计划（门面 `planGeneration`）。 */
export function plan(request: GenerationRequest): GenerationPlan {
  return planGeneration(request)
}

/** 就绪判定：有 error 问题或目标禁用 / 未选时不可生成。 */
export interface Readiness {
  enabled: boolean
  /** 阻塞原因：参数问题文案 + 目标原因码。 */
  reasons: string[]
}

export function readiness(
  issues: readonly TemplateParamIssue[],
  target: TargetOption | null,
): Readiness {
  const reasons: string[] = []
  for (const issue of issues) {
    if (issue.severity === 'error') reasons.push(issue.message)
  }
  if (target === null) {
    reasons.push('templates.reason.noTarget')
  } else if (!target.enabled) {
    reasons.push(target.reasonCode)
  }
  return { enabled: reasons.length === 0, reasons }
}

// ── 姿态槽可用性（九槽接线；服务 / 槽位由面板注入快照）────────────────────────

export type PickerReasonCode = '' | 'serviceMissing' | 'noDoc' | 'slotsEmpty'

export interface PickerAvailability {
  enabled: boolean
  reasonCode: PickerReasonCode
}

/**
 * 「从槽位取」按钮可用性：服务未注册 / 无文档 / 九槽全空时禁用并给原因。
 * 不在面板本地造槽，也不复制第二套选择器。
 */
export function pickerAvailability(
  serviceAvailable: boolean,
  docOpen: boolean,
  slotsFilled: number,
): PickerAvailability {
  if (!serviceAvailable) return { enabled: false, reasonCode: 'serviceMissing' }
  if (!docOpen) return { enabled: false, reasonCode: 'noDoc' }
  if (slotsFilled <= 0) return { enabled: false, reasonCode: 'slotsEmpty' }
  return { enabled: true, reasonCode: '' }
}

// ── 应用事务（注入式提交通道；自检用计数器断言同一通道）────────────────────────

/** 应用依赖：计划 / 提交 / 选择全部由面板上下文注入。 */
export interface ApplyDeps {
  plan: (request: GenerationRequest) => GenerationPlan
  commit: (command: DocCommand) => CommitOutcome
  select: (clipKeys: readonly string[]) => void
}

/** 失败诊断视图（带定位：参数 / 片段 / 轨道）。 */
export interface ApplyFailure {
  message: string
  paramKey?: string
  clipKey?: string
  trackId?: string
}

export interface ApplyOutcome {
  ok: boolean
  /** 实际提交次数：成功一次事务为 1，失败 / 零残留为 0。 */
  committed: number
  /** 脚本层「新建文档」是否已先开空文档（由面板异步开启后传入）。 */
  newDocumentOpened: boolean
  selectedClipKeys: string[]
  failures: ApplyFailure[]
  error?: string
}

/**
 * 应用一次计划（同步；新文档开启由面板在调用前异步完成）：
 * - 计划失败 → 零残留，返回诊断定位，不提交；
 * - 成功 → 提交一次独立事务，选中计划给出的片段键；
 * - 重复应用是独立事务，不与上一次合并。
 */
export function runApply(
  deps: ApplyDeps,
  planResult: GenerationPlan,
  freshDocumentOpened: boolean,
): ApplyOutcome {
  if (!planResult.ok) {
    return {
      ok: false,
      committed: 0,
      newDocumentOpened: false,
      selectedClipKeys: [],
      failures: planResult.diagnostics.map((diagnostic) => ({
        message: diagnostic.message,
        paramKey: diagnostic.paramKey,
        clipKey: diagnostic.clipKey,
        trackId: diagnostic.trackId,
      })),
    }
  }

  if (planResult.command === null) {
    return {
      ok: false,
      committed: 0,
      newDocumentOpened: false,
      selectedClipKeys: [],
      failures: [{ message: 'templates.status.planFailed' }],
    }
  }

  const outcome = deps.commit(planResult.command)
  if (!outcome.ok) {
    return {
      ok: false,
      committed: 0,
      newDocumentOpened: freshDocumentOpened,
      selectedClipKeys: [],
      failures: [{ message: outcome.error ?? 'templates.status.failed' }],
    }
  }

  deps.select(planResult.selectedClipKeys)
  return {
    ok: true,
    committed: 1,
    newDocumentOpened: freshDocumentOpened,
    selectedClipKeys: [...planResult.selectedClipKeys],
    failures: [],
  }
}

/** 参数声明透传类型（表单渲染按 `kind` 分支；类型来自门面模板定义）。 */
export type { ParamDecl }
