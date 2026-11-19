/**
 * 12 轮「轨道模板」自检（12-04 / 12-16 轨道组）。
 *
 * 覆盖：整圈环绕分段首尾相接 / 不重叠 / 不写转场 / 每段一条路径；段数不足报参数错误；
 * 多机位机位数=姿态数、呼吸关闭、不补空、相同姿态给 warning；真实提交与撤销回退。
 */
import type { CheckFn } from './harness.ts'
import type { VerifyContext } from './context.ts'
import { allClips, clipsOf, objectsOf, pathEntries, trackOfType } from './context.ts'
import type { AnimObjectShape, JsonObject, ScriptDoc } from '../../core/doc/types.ts'
import { validateStructure } from '../../core/doc/structural.ts'
import { planGeneration, type GenerationRequest, type ParamValue, type PoseValue } from '../../features/templates/public.ts'

type LeafRecord = Record<string, AnimObjectShape>

function leafObjects(clip: JsonObject): LeafRecord {
  return objectsOf(clip) as LeafRecord
}

function pose(over: Partial<PoseValue> = {}): PoseValue {
  return {
    position: { x: 0, y: 1.6, z: 0 },
    yaw: 0, pitch: 0, roll: 0, fov: 70, zoom: 1,
    ...over,
  }
}

function trackRequest(ctx: VerifyContext, templateId: string, params: Record<string, ParamValue>): GenerationRequest {
  return {
    templateId,
    params,
    target: { mode: 'newTrack' },
    doc: ctx.emptyDoc(),
    catalog: ctx.catalog,
    playhead: 0,
    selectedClipKeys: [],
  }
}

function openStore(ctx: VerifyContext) {
  const store = ctx.createStore()
  store.open(ctx.emptyDoc(), null)
  return store
}

export function runTrackTemplates(check: CheckFn, ctx: VerifyContext): void {
  // ── track.orbit_full ──
  {
    const plan = planGeneration(trackRequest(ctx, 'track.orbit_full', {
      duration: 8, centerX: 0, centerZ: 0, height: 2, radius: 5, turns: 1, segments: 4, clockwise: false, lookMode: 'center', fov: 70,
    }))
    check('T1 orbit_full 计划成功', plan.ok, plan.diagnostics)
    const store = openStore(ctx)
    if (plan.command !== null) {
      const outcome = store.commit(plan.command)
      check('T1 orbit_full 提交成功', outcome.ok, outcome.error ?? plan.diagnostics)
    }
    const doc = store.doc as ScriptDoc
    const track = trackOfType(doc, 'CAMERA')
    const clips = track ? clipsOf(track) : []
    check('T1 orbit_full 四段片段', clips.length === 4, clips.length)
    const expectedStarts = [0, 2, 4, 6]
    check('T1 orbit_full 段首尾相接',
      clips.every((clip, i) => Math.abs((clip.start_time as number) - expectedStarts[i]) < 1e-6),
      clips.map((c) => c.start_time))
    check('T1 orbit_full 末段收在总时长',
      clips.length === 0 || Math.abs(((clips[clips.length - 1].start_time as number) + (clips[clips.length - 1].duration as number)) - 8) < 1e-6,
      clips.map((c) => [c.start_time, c.duration]))
    const nonOverlap = clips.every((clip, i) => {
      if (i === 0) return true
      const prev = clips[i - 1]
      return (prev.start_time as number) + (prev.duration as number) <= (clip.start_time as number) + 1e-9
    })
    check('T1 orbit_full 段间不重叠', nonOverlap, clips.map((c) => [c.start_time, c.duration]))
    const paths = pathEntries(doc)
    check('T1 orbit_full 每段一条路径', paths.length === 4, paths.length)
    check('T1 orbit_full 路径轴为水平两轴', paths.every((p) => (p.axes as string[]).join(',') === 'x,z'), paths.map((p) => p.axes))
    const transitionKeys = clips.flatMap((clip) => Object.keys(leafObjects(clip)).filter((k) => k.startsWith('transition') || k.startsWith('crossfade')))
    check('T1 orbit_full 不写转场字段', transitionKeys.length === 0, transitionKeys)
    const issues = validateStructure(doc, { catalog: ctx.catalog, metaKeys: ctx.metaKeys, registry: store.registry })
    check('T1 orbit_full 产物过结构校验', issues.length === 0, issues.map((i) => `${i.code} ${i.message}`))
    store.undo()
    const after = store.doc as ScriptDoc
    check('T1 orbit_full 撤销后零片段', allClips(after).length === 0, allClips(after).length)
  }

  // ── track.orbit_full：段数不足 → 参数错误，提示增大段数。 ──
  {
    const plan = planGeneration(trackRequest(ctx, 'track.orbit_full', {
      duration: 8, centerX: 0, centerZ: 0, height: 2, radius: 5, turns: 2, segments: 2, clockwise: false, lookMode: 'center', fov: 70,
    }))
    const cross = plan.diagnostics.find((d) => d.code === 'T_PARAM_CROSS')
    check('T1 段数不足拒绝', !plan.ok && cross !== undefined, plan.diagnostics)
    check('T1 段数不足提示增大段数', cross?.message.includes('段数') === true, cross?.message)
  }

  // ── track.multi_cam ──
  {
    const poses = [
      pose({ position: { x: -3, y: 1.6, z: 0 }, yaw: 10 }),
      pose({ position: { x: 3, y: 1.8, z: -2 }, yaw: -15 }),
    ]
    const plan = planGeneration(trackRequest(ctx, 'track.multi_cam', { poses, clipDuration: 2, gap: 0.5 }))
    check('T2 multi_cam 计划成功', plan.ok, plan.diagnostics)
    const store = openStore(ctx)
    if (plan.command !== null) {
      const outcome = store.commit(plan.command)
      check('T2 multi_cam 提交成功', outcome.ok, outcome.error ?? plan.diagnostics)
    }
    const doc = store.doc as ScriptDoc
    const track = trackOfType(doc, 'CAMERA')
    const clips = track ? clipsOf(track) : []
    check('T2 multi_cam 机位=姿态数（2）', clips.length === 2, clips.length)
    check('T2 multi_cam 机位起点 0 / 2.5',
      clips.length === 2 && Math.abs(clips[0].start_time as number) < 1e-6 && Math.abs((clips[1].start_time as number) - 2.5) < 1e-6,
      clips.map((c) => c.start_time))
    for (const clip of clips) {
      const objects = leafObjects(clip)
      check('T2 multi_cam 呼吸关闭', objects.cam_breath_enabled?.value === false, objects.cam_breath_enabled)
      const breathKeys = Object.keys(objects).filter((k) => k.startsWith('cam_breath_') && k !== 'cam_breath_enabled')
      check('T2 multi_cam 不补呼吸字段', breathKeys.length === 0, breathKeys)
    }
    check('T2 multi_cam 无路径', pathEntries(doc).length === 0, pathEntries(doc).length)
    store.undo()
    const after = store.doc as ScriptDoc
    check('T2 multi_cam 撤销后零片段', allClips(after).length === 0, allClips(after).length)
  }

  // ── track.multi_cam：相邻姿态相同 → warning，不阻止保存。 ──
  {
    const same = [pose(), pose()]
    const plan = planGeneration(trackRequest(ctx, 'track.multi_cam', { poses: same, clipDuration: 2, gap: 0 }))
    check('T2 相同姿态不阻止（warning）', plan.ok, plan.diagnostics)
    check('T2 相同姿态给 warning', plan.diagnostics.some((d) => d.severity === 'warning'), plan.diagnostics)
  }
}
