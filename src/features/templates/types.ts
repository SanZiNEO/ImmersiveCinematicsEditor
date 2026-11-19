/**
 * 12 轮「模板内核」对外类型（spec §2.1 冻结门面的一部分）。
 *
 * 本文件只放类型；实现见 engine / registry / assembly，门面统一从 `public.ts` 导出。
 */
import type { CatalogIndex } from '../../core/schema/index.ts'
import type { DocCommand } from '../../core/doc/commands.ts'
import type { ScriptDoc } from '../../core/doc/types.ts'
import type { Diagnostic } from '../generation/diagnostics.ts'

export type TemplateLayer = 'clip' | 'track' | 'script'

/** 姿态参数值：位置三轴 + 朝向角 + 镜头。 */
export interface PoseValue {
  position: { x: number; y: number; z: number }
  yaw: number
  pitch: number
  roll: number
  fov: number
  zoom: number
}

export type ParamKind =
  | 'number' | 'integer' | 'boolean' | 'enum' | 'text'
  | 'color' | 'selector' | 'pose' | 'poseList'

export type ParamValue = number | boolean | string | PoseValue | PoseValue[] | null

export interface ParamDecl {
  key: string
  kind: ParamKind
  labelKey: string
  helpKey?: string
  required: boolean
  default?: ParamValue
  min?: number
  max?: number
  unit?: string
  enumValues?: readonly string[]
  colorPattern?: string
  minCount?: number
  maxCount?: number
}

export interface TemplateDefinition {
  id: string
  layer: TemplateLayer
  titleKey: string
  descriptionKey: string
  targetTrackTypes: readonly string[]
  params: readonly ParamDecl[]
}

export interface TemplateParamIssue {
  paramKey: string | null
  code: string
  severity: 'error' | 'warning' | 'info'
  message: string
}

export interface InsertTarget {
  mode: 'atPlayhead' | 'afterSelection' | 'atTime' | 'newTrack' | 'appendTrack' | 'newDocument'
  time?: number
  trackId?: string
}

export interface StructureSummary {
  clipCount: number
  trackCount: number
  pathCount: number
  triggerCount: number
  totalDuration: number
  segments: Array<{ start: number; duration: number }>
  targetTrackTypes: readonly string[]
  createsTrack: boolean
  createsDocument: boolean
  conflicts: Array<{ clipKey: string; start: number; end: number }>
  notes: string[]
}

export interface GenerationRequest {
  templateId: string
  params: Record<string, ParamValue>
  target: InsertTarget
  doc: ScriptDoc | null
  catalog: CatalogIndex
  playhead: number
  selectedClipKeys: readonly string[]
}

export interface GenerationPlan {
  ok: boolean
  templateId: string
  layer: TemplateLayer
  summary: StructureSummary
  command: DocCommand | null
  diagnostics: Diagnostic[]
  selectedClipKeys: string[]
}
