/**
 * 只读注册表（12-01 §四）：层内 id 唯一、注册顺序即展示顺序；注册失败只让该模板不可用。
 *
 * 内置模板在模块加载时登记；校验不通过的条目进入失败清单，不影响其余模板。
 */
import type { TemplateDefinition, TemplateLayer } from './types.ts'
import type { InternalTemplate } from './model.ts'
import { TRACK_TYPE_ORDER } from './model.ts'
import { CLIP_TEMPLATES } from './builtins/clip.ts'
import { TRACK_TEMPLATES } from './builtins/track.ts'
import { SCRIPT_TEMPLATES } from './builtins/script.ts'

export interface RegistryIssue {
  id: string
  message: string
}

const LAYERS: readonly TemplateLayer[] = ['clip', 'track', 'script']
const TRACK_TYPES = new Set<string>(TRACK_TYPE_ORDER)

/** 登记期校验：id / 层 / 目标轨型 / 参数键唯一 / 文案键齐全。 */
export function validateDefinition(def: TemplateDefinition): RegistryIssue[] {
  const issues: RegistryIssue[] = []
  if (!/^[a-z][a-z0-9_.]*$/.test(def.id)) {
    issues.push({ id: def.id, message: `模板 id 非法: ${def.id}` })
  }
  if (!LAYERS.includes(def.layer)) {
    issues.push({ id: def.id, message: `模板 ${def.id} 层类型非法: ${def.layer}` })
  }
  for (const trackType of def.targetTrackTypes) {
    if (!TRACK_TYPES.has(trackType)) {
      issues.push({ id: def.id, message: `模板 ${def.id} 目标轨道类型未登记: ${trackType}` })
    }
  }
  if (def.titleKey.length === 0 || def.descriptionKey.length === 0) {
    issues.push({ id: def.id, message: `模板 ${def.id} 缺少标题或描述文案键` })
  }
  const seen = new Set<string>()
  for (const param of def.params) {
    if (seen.has(param.key)) {
      issues.push({ id: def.id, message: `模板 ${def.id} 参数键重复: ${param.key}` })
    }
    seen.add(param.key)
    if (param.labelKey.length === 0) {
      issues.push({ id: def.id, message: `模板 ${def.id} 参数 ${param.key} 缺少文案键` })
    }
  }
  return issues
}

const ALL_TEMPLATES: readonly InternalTemplate[] = [...CLIP_TEMPLATES, ...TRACK_TEMPLATES, ...SCRIPT_TEMPLATES]

interface RegistryEntry {
  internal: InternalTemplate
  issues: RegistryIssue[]
}

function buildEntries(): RegistryEntry[] {
  const seenIds = new Set<string>()
  const entries: RegistryEntry[] = []
  for (const internal of ALL_TEMPLATES) {
    const issues = validateDefinition(internal.def)
    if (seenIds.has(internal.def.id)) {
      issues.push({ id: internal.def.id, message: `模板 id 在层内重复: ${internal.def.id}` })
    }
    seenIds.add(internal.def.id)
    entries.push({ internal, issues })
  }
  return entries
}

const ENTRIES: readonly RegistryEntry[] = buildEntries()

/** 全部登记失败条目（仅该模板不可用）。 */
export function registryIssues(): RegistryIssue[] {
  return ENTRIES.flatMap((entry) => entry.issues)
}

/** 可用模板定义（注册顺序即展示顺序），可按层过滤。 */
export function listTemplates(layer?: TemplateLayer): readonly TemplateDefinition[] {
  return ENTRIES
    .filter((entry) => entry.issues.length === 0)
    .map((entry) => entry.internal.def)
    .filter((def) => layer === undefined || def.layer === layer)
}

/** 按 id 取门面定义；未登记 / 注册失败返回 null。 */
export function templateById(id: string): TemplateDefinition | null {
  const entry = ENTRIES.find((item) => item.internal.def.id === id)
  if (entry === undefined || entry.issues.length > 0) {
    return null
  }
  return entry.internal.def
}

/** 内部条目（引擎 / 装配用；不进门面）。 */
export function internalById(id: string): InternalTemplate | null {
  const entry = ENTRIES.find((item) => item.internal.def.id === id)
  if (entry === undefined || entry.issues.length > 0) {
    return null
  }
  return entry.internal
}
