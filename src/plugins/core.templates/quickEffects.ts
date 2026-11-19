/**
 * 快捷效果固定集合（12-07）：条目 = 模板 id + 一组默认参数 + 默认插入位置 + 前置条件。
 *
 * 不是第二套效果系统：每个条目只引用已登记模板，生成 / diff / 事务 / 选择 / 撤销
 * 与模板面板完全一致，走同一条 `planGeneration` + `commit` 通道。本模块是纯函数，
 * 不依赖 Vue 运行时；节点类型擦除下可直接 import。
 *
 * 缺姿态 / 缺槽 / 缺选择器时条目置灰并给原因，不生成默认假值；
 * 条目 id 只在面板内部使用，不写进脚本产物。
 */
import type { CatalogIndex } from '../../core/schema/index.ts'
import type { JsonValue, ScriptDoc } from '../../core/doc/types.ts'
import { cloneJson } from '../../core/doc/json.ts'
import {
  templateById,
  type GenerationRequest,
  type ParamValue,
  type PoseValue,
  type TemplateLayer,
} from '../../features/templates/public.ts'
import type { InsertTarget } from '../../features/templates/types.ts'

/** 姿态角色：无 / 单姿态 / 起止双姿态 / 姿态列表。 */
export type QuickPoseRole = 'none' | 'single' | 'pair' | 'list'

/** 一条快捷效果定义（只读）。 */
export interface QuickEffectDef {
  /** 面板内部条目 id；不落脚本。 */
  id: string
  titleKey: string
  descriptionKey: string
  /** 引用的已登记模板 id。 */
  templateId: string
  layer: TemplateLayer
  /** 默认插入位置。 */
  target: InsertTarget
  /** 固定默认参数（不含姿态类；姿态由前置解析注入）。 */
  staticParams: Record<string, ParamValue>
  poseRole: QuickPoseRole
  /** 单姿态参数键名（`poseToCenter` 为 false 时使用）。 */
  poseParam?: string
  /** 姿态列表参数键名。 */
  posesParam?: string
  /** 单姿态映射为环绕圆心（写 centerX / centerZ / height），而非姿态参数。 */
  poseToCenter?: boolean
  /** `pair` 沿视线位移距离（正 = 推近，负 = 拉远）。 */
  distance?: number
  /** `list` 需要的姿态数。 */
  requiredSlots?: number
  /** 需要作者给出跟随选择器。 */
  requiresSelector?: boolean
}

// ── 固定条目集合 ────────────────────────────────────────────────────────────

const PLAYHEAD: InsertTarget = { mode: 'atPlayhead' }
const NEW_TRACK: InsertTarget = { mode: 'newTrack' }
const NEW_DOCUMENT: InsertTarget = { mode: 'newDocument' }

/** 十项固定快捷效果（片段 6 / 轨道 2 / 脚本 2）。 */
export const QUICK_EFFECTS: readonly QuickEffectDef[] = [
  {
    id: 'fade_in_black',
    titleKey: 'quick.fade_in_black.title',
    descriptionKey: 'quick.fade_in_black.desc',
    templateId: 'clip.fade',
    layer: 'clip',
    target: PLAYHEAD,
    staticParams: { duration: 2, mode: 'in', color: '#000000' },
    poseRole: 'none',
  },
  {
    id: 'fade_out_black',
    titleKey: 'quick.fade_out_black.title',
    descriptionKey: 'quick.fade_out_black.desc',
    templateId: 'clip.fade',
    layer: 'clip',
    target: PLAYHEAD,
    staticParams: { duration: 2, mode: 'out', color: '#000000' },
    poseRole: 'none',
  },
  {
    id: 'static_breath',
    titleKey: 'quick.static_breath.title',
    descriptionKey: 'quick.static_breath.desc',
    templateId: 'clip.static_breath',
    layer: 'clip',
    target: PLAYHEAD,
    staticParams: {
      duration: 3,
      breathEnabled: true,
      breathType: 'perlin',
      breathIntensity: 0.05,
      breathSeed: 0,
      breathSpeed: 1,
      breathTrauma: 1,
      breathDecay: 0.5,
    },
    poseRole: 'single',
    poseParam: 'pose',
  },
  {
    id: 'push_in',
    titleKey: 'quick.push_in.title',
    descriptionKey: 'quick.push_in.desc',
    templateId: 'clip.dolly',
    layer: 'clip',
    target: PLAYHEAD,
    staticParams: { duration: 3, lookMode: 'angles' },
    poseRole: 'pair',
    distance: 2,
  },
  {
    id: 'pull_out',
    titleKey: 'quick.pull_out.title',
    descriptionKey: 'quick.pull_out.desc',
    templateId: 'clip.dolly',
    layer: 'clip',
    target: PLAYHEAD,
    staticParams: { duration: 3, lookMode: 'angles' },
    poseRole: 'pair',
    distance: -2,
  },
  {
    id: 'orbit_90',
    titleKey: 'quick.orbit_90.title',
    descriptionKey: 'quick.orbit_90.desc',
    templateId: 'clip.orbit_arc',
    layer: 'clip',
    target: PLAYHEAD,
    staticParams: {
      duration: 3,
      radius: 5,
      startAngle: 0,
      sweep: 90,
      clockwise: false,
      lookMode: 'center',
      fov: 70,
    },
    poseRole: 'single',
    poseToCenter: true,
  },
  {
    id: 'orbit_full',
    titleKey: 'quick.orbit_full.title',
    descriptionKey: 'quick.orbit_full.desc',
    templateId: 'track.orbit_full',
    layer: 'track',
    target: NEW_TRACK,
    staticParams: {
      duration: 10,
      radius: 5,
      turns: 1,
      segments: 4,
      clockwise: false,
      lookMode: 'center',
      fov: 70,
    },
    poseRole: 'single',
    poseToCenter: true,
  },
  {
    id: 'multi_cam',
    titleKey: 'quick.multi_cam.title',
    descriptionKey: 'quick.multi_cam.desc',
    templateId: 'track.multi_cam',
    layer: 'track',
    target: NEW_TRACK,
    staticParams: { clipDuration: 3, gap: 0 },
    poseRole: 'list',
    posesParam: 'poses',
    requiredSlots: 2,
  },
  {
    id: 'camera_intro',
    titleKey: 'quick.camera_intro.title',
    descriptionKey: 'quick.camera_intro.desc',
    templateId: 'script.camera_intro',
    layer: 'script',
    target: NEW_DOCUMENT,
    staticParams: { cameraDuration: 3, letterboxRatio: 2.35, blackDuration: 1 },
    poseRole: 'single',
    poseParam: 'cameraPose',
  },
  {
    id: 'follow_black',
    titleKey: 'quick.follow_black.title',
    descriptionKey: 'quick.follow_black.desc',
    templateId: 'script.follow_black',
    layer: 'script',
    target: NEW_DOCUMENT,
    staticParams: {
      backDistance: 3,
      heightOffset: 1.6,
      lookHeight: 1.6,
      duration: 10,
      blackDuration: 1,
      triggerType: 'none',
    },
    poseRole: 'none',
    requiresSelector: true,
  },
]

/** 按内部 id 取条目；未找到返回 `null`。 */
export function quickEffectById(id: string): QuickEffectDef | null {
  return QUICK_EFFECTS.find((entry) => entry.id === id) ?? null
}

/** 条目引用的模板是否已登记（自检 / 面板前置校验共用）。 */
export function quickTemplateRegistered(def: QuickEffectDef): boolean {
  return templateById(def.templateId) !== null
}

// ── 前置求值 ─────────────────────────────────────────────────────────────────

/** 快捷效果求值上下文（面板从服务 / 选区 / 槽库快照注入）。 */
export interface QuickContext {
  /** 文档是否打开。 */
  docOpen: boolean
  /** 当前可解析姿态（选中片段求值 / 最近飞控姿态）；无则 `null`。 */
  sourcePose: PoseValue | null
  /** 已填充槽位姿态（按槽号顺序）。 */
  filledSlots: PoseValue[]
  /** 表单已填跟随选择器。 */
  selector: string
}

/** 禁用原因码；面板映射为本地化文案，自检断言稳定码。 */
export type QuickReasonCode = '' | 'noDoc' | 'noPose' | 'needSlots' | 'needSelector'

export interface QuickEvaluate {
  enabled: boolean
  reasonCode: QuickReasonCode
  /** 文案插值参数（如槽位需求数）。 */
  reasonParams: Record<string, number>
  /** 预填参数（静态默认 + 解析到的姿态 / 选择器）。 */
  params: Record<string, ParamValue>
}

const DEG = Math.PI / 180

/**
 * 由姿态朝向角求视线方向（Minecraft 约定：yaw=0 朝 +Z，俯仰绕 X 轴；角度单位度）。
 * 编辑器侧几何换算，不写新字段；仅用于推近 / 拉远预填终点，作者可在表单改。
 */
export function forwardVector(pose: PoseValue): { x: number; y: number; z: number } {
  const yaw = pose.yaw * DEG
  const pitch = pose.pitch * DEG
  const cosPitch = Math.cos(pitch)
  return {
    x: -Math.sin(yaw) * cosPitch,
    y: -Math.sin(pitch),
    z: Math.cos(yaw) * cosPitch,
  }
}

/** 沿视线方向平移姿态位置；`distance` 正前进、负后退。 */
export function shiftPoseAlong(pose: PoseValue, distance: number): PoseValue {
  const forward = forwardVector(pose)
  return {
    ...pose,
    position: {
      x: pose.position.x + forward.x * distance,
      y: pose.position.y + forward.y * distance,
      z: pose.position.z + forward.z * distance,
    },
  }
}

function clonePose(pose: PoseValue): PoseValue {
  return cloneJson(pose as unknown as JsonValue) as unknown as PoseValue
}

/**
 * 求值一条快捷效果：
 * - 无文档 → `noDoc`；
 * - 需要选择器而未填 → `needSelector`；
 * - 需要姿态而当前姿态 / 槽位都没有 → `noPose`；
 * - 姿态列表槽位不足 → `needSlots`（不补空、不截断）；
 * - 满足前置 → 合并静态默认参数与解析到的姿态 / 选择器。
 */
export function evaluateQuickEffect(def: QuickEffectDef, ctx: QuickContext): QuickEvaluate {
  const params: Record<string, ParamValue> = { ...def.staticParams }

  if (!ctx.docOpen) {
    return { enabled: false, reasonCode: 'noDoc', reasonParams: {}, params }
  }
  if (def.requiresSelector && ctx.selector.trim().length === 0) {
    return { enabled: false, reasonCode: 'needSelector', reasonParams: {}, params }
  }
  if (def.requiresSelector) {
    params.selector = ctx.selector.trim()
  }

  const source: PoseValue | null = ctx.sourcePose ?? ctx.filledSlots[0] ?? null

  if (def.poseRole === 'single') {
    if (source === null) {
      return { enabled: false, reasonCode: 'noPose', reasonParams: {}, params }
    }
    if (def.poseToCenter) {
      params.centerX = source.position.x
      params.centerZ = source.position.z
      params.height = source.position.y
    } else if (def.poseParam !== undefined) {
      params[def.poseParam] = clonePose(source)
    }
    return { enabled: true, reasonCode: '', reasonParams: {}, params }
  }

  if (def.poseRole === 'pair') {
    if (source === null) {
      return { enabled: false, reasonCode: 'noPose', reasonParams: {}, params }
    }
    const start = clonePose(source)
    const end = shiftPoseAlong(start, def.distance ?? 0)
    params.startPose = start
    params.endPose = end
    return { enabled: true, reasonCode: '', reasonParams: {}, params }
  }

  if (def.poseRole === 'list') {
    const required = def.requiredSlots ?? 1
    if (ctx.filledSlots.length < required) {
      return {
        enabled: false,
        reasonCode: 'needSlots',
        reasonParams: { count: required },
        params,
      }
    }
    const poses = ctx.filledSlots.slice(0, required).map(clonePose)
    if (def.posesParam !== undefined) params[def.posesParam] = poses
    return { enabled: true, reasonCode: '', reasonParams: {}, params }
  }

  return { enabled: true, reasonCode: '', reasonParams: {}, params }
}

/** 构造快捷效果生成请求（与模板面板同一请求形状；计划 / 提交仍走门面与命令面）。 */
export function buildQuickRequest(
  def: QuickEffectDef,
  params: Record<string, ParamValue>,
  doc: ScriptDoc | null,
  catalog: CatalogIndex,
  playhead: number,
  selectedClipKeys: readonly string[],
): GenerationRequest {
  return {
    templateId: def.templateId,
    params,
    target: def.target,
    doc,
    catalog,
    playhead,
    selectedClipKeys,
  }
}
