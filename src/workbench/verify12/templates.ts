/**
 * 12 轮「模板模型」自检（12-01 / 12-16 模型组）。
 *
 * 覆盖：注册表层内唯一 / 顺序 / 目标轨型 / 参数声明；参数校验（未知 / 必填 / 默认 /
 * 范围 / 枚举 / 颜色 / 姿态 / 姿态列表）；结构摘要只写事实。
 */
import type { CheckFn } from './harness.ts'
import type { VerifyContext } from './context.ts'
import {
  defaultParams,
  listTemplates,
  planGeneration,
  templateById,
  validateTemplateParams,
  type GenerationRequest,
  type ParamValue,
  type PoseValue,
} from '../../features/templates/public.ts'

function pose(over: Partial<PoseValue> = {}): PoseValue {
  return {
    position: { x: 0, y: 1.6, z: 0 },
    yaw: 0, pitch: 0, roll: 0, fov: 70, zoom: 1,
    ...over,
  }
}

function makeRequest(
  ctx: VerifyContext,
  templateId: string,
  params: Record<string, ParamValue>,
  doc = ctx.emptyDoc(),
): GenerationRequest {
  return {
    templateId,
    params,
    target: { mode: 'newDocument' },
    doc,
    catalog: ctx.catalog,
    playhead: 0,
    selectedClipKeys: [],
  }
}

export function runTemplateModel(check: CheckFn, ctx: VerifyContext): void {
  // ── 注册表：九个内置模板、分层数量、顺序、id 唯一。 ──
  const all = listTemplates()
  check('M1 内置模板共 9 个', all.length === 9, all.map((def) => def.id))
  const clipDefs = listTemplates('clip')
  const trackDefs = listTemplates('track')
  const scriptDefs = listTemplates('script')
  check('M1 片段层 4 个', clipDefs.length === 4, clipDefs.map((d) => d.id))
  check('M1 轨道层 2 个', trackDefs.length === 2, trackDefs.map((d) => d.id))
  check('M1 脚本层 3 个', scriptDefs.length === 3, scriptDefs.map((d) => d.id))

  const ids = all.map((def) => def.id)
  check('M1 层内 id 唯一', new Set(ids).size === ids.length, ids)
  check('M1 注册顺序即展示顺序',
    ids.join(',') === 'clip.fade,clip.static_breath,clip.dolly,clip.orbit_arc,track.orbit_full,track.multi_cam,script.blank,script.camera_intro,script.follow_black',
    ids)

  const expectedTarget: Record<string, string[]> = {
    'clip.fade': ['OVERLAY'],
    'clip.static_breath': ['CAMERA'],
    'clip.dolly': ['CAMERA'],
    'clip.orbit_arc': ['CAMERA'],
    'track.orbit_full': ['CAMERA'],
    'track.multi_cam': ['CAMERA'],
    'script.blank': [],
    'script.camera_intro': ['CAMERA', 'LETTERBOX', 'OVERLAY'],
    'script.follow_black': ['CAMERA', 'OVERLAY'],
  }
  for (const [id, target] of Object.entries(expectedTarget)) {
    const def = templateById(id)
    check(`M1 ${id} 目标轨型`, def !== null && def.targetTrackTypes.join(',') === target.join(','), def?.targetTrackTypes)
  }
  check('M1 未知模板返回 null', templateById('clip.nope') === null)

  // ── 默认值与参数校验。 ──
  const fade = templateById('clip.fade')
  check('M2 取到 clip.fade 定义', fade !== null)
  if (fade !== null) {
    const defaults = defaultParams(fade)
    check('M2 默认值补齐', defaults.duration === 2 && defaults.mode === 'in' && defaults.color === '#000000', defaults)

    const unknown = validateTemplateParams(fade, { duration: 2, mode: 'in', color: '#000000', rogue: 1 } as Record<string, ParamValue>)
    check('M2 未声明参数拒绝', unknown.some((issue) => issue.code === 'T_PARAM_UNKNOWN' && issue.paramKey === 'rogue'), unknown)

    const badColor = validateTemplateParams(fade, { duration: 2, mode: 'in', color: 'black' })
    check('M2 颜色非六位十六进制拒绝', badColor.some((issue) => issue.code === 'T_PARAM_COLOR'), badColor)

    const badEnum = validateTemplateParams(fade, { duration: 2, mode: 'sideways', color: '#000000' })
    check('M2 枚举候选外拒绝', badEnum.some((issue) => issue.code === 'T_PARAM_ENUM'), badEnum)

    const range = validateTemplateParams(fade, { duration: -1, mode: 'in', color: '#000000' })
    check('M2 范围下限拒绝', range.some((issue) => issue.code === 'T_PARAM_RANGE'), range)
  }

  const breath = templateById('clip.static_breath')
  check('M2 取到 clip.static_breath 定义', breath !== null)
  if (breath !== null) {
    const missing = validateTemplateParams(breath, {})
    check('M2 必填缺失报错', missing.some((issue) => issue.code === 'T_PARAM_REQUIRED' && issue.paramKey === 'pose'), missing)

    const incomplete = validateTemplateParams(breath, { pose: { position: { x: 0, y: 0 }, yaw: 0, pitch: 0, roll: 0, fov: 70, zoom: 1 } as unknown as PoseValue })
    check('M2 姿态三轴 / 字段不齐拒绝', incomplete.some((issue) => issue.code === 'T_PARAM_POSE'), incomplete)

    const ok = validateTemplateParams(breath, { pose: pose(), duration: 3 })
    check('M2 完整姿态通过', ok.length === 0, ok)
  }

  const multi = templateById('track.multi_cam')
  check('M2 取到 track.multi_cam 定义', multi !== null)
  if (multi !== null) {
    const few = validateTemplateParams(multi, { poses: [pose()] })
    check('M2 单姿态通过（minCount=1）', few.length === 0, few)
    const empty = validateTemplateParams(multi, { poses: [] })
    check('M2 姿态数少于下限拒绝', empty.some((issue) => issue.code === 'T_PARAM_COUNT'), empty)
  }

  // ── 摘要只写事实：blank 脚本摘要七轨零片段。 ──
  const blankReq = makeRequest(ctx, 'script.blank', { id: 'verify12', name: 'verify', author: 'tester' })
  const blankPlan = planGeneration(blankReq)
  check('M3 blank 计划成功', blankPlan.ok, blankPlan.diagnostics)
  check('M3 blank 摘要轨道数 7', blankPlan.summary.trackCount === 7, blankPlan.summary.trackCount)
  check('M3 blank 摘要片段 / 路径 / 触发器为 0',
    blankPlan.summary.clipCount === 0 && blankPlan.summary.pathCount === 0 && blankPlan.summary.triggerCount === 0,
    blankPlan.summary)
  check('M3 blank 标记新建文档', blankPlan.summary.createsDocument === true)
}
