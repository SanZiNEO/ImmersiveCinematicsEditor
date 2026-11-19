/**
 * 12 轮「片段模板」自检（12-03 / 12-16 片段组）。
 *
 * 真跑纯函数 planGeneration + 真实命令提交（createStore / commit / undo），覆盖：
 * 四个片段模板骨架、字段只来自目录、无转场 / 无模板元信息、关键帧从 0 起严格递增、
 * 呼吸关闭省略其余呼吸字段、推轨起止不等 / 注视二选一、环绕弧路径端点与控制点形态、
 * 单段扫角超限拒绝、撤销全回退。
 */
import type { CheckFn } from './harness.ts'
import type { VerifyContext } from './context.ts'
import { allClips, clipsOf, objectsOf, pathEntries, trackOfType } from './context.ts'
import type { AnimObjectShape, JsonObject, ScriptDoc } from '../../core/doc/types.ts'
import { planGeneration, type GenerationRequest, type ParamValue, type PoseValue } from '../../features/templates/public.ts'
import { validateStructure } from '../../core/doc/structural.ts'
import type { DocStore } from '../../core/doc/store.ts'

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

function clipRequest(ctx: VerifyContext, templateId: string, params: Record<string, ParamValue>): GenerationRequest {
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

function openStore(ctx: VerifyContext): DocStore {
  const store = ctx.createStore()
  store.open(ctx.emptyDoc(), null)
  return store
}

function commitPlan(check: CheckFn, store: DocStore, plan: ReturnType<typeof planGeneration>, label: string): void {
  if (plan.command === null) {
    check(`${label} 命令非空`, false, plan.diagnostics)
    return
  }
  const outcome = store.commit(plan.command)
  check(`${label} 命令提交成功`, outcome.ok, outcome.error ?? plan.diagnostics)
}

function noForbiddenOrLeak(check: CheckFn, objects: LeafRecord, label: string): void {
  const keys = Object.keys(objects)
  check(`${label} 无转场字段`, !keys.some((k) => k.startsWith('transition') || k.startsWith('crossfade')), keys)
  check(`${label} 无模板元信息键`, !keys.some((k) => /template|param|slot|namespace|source|createdAt/i.test(k)), keys)
}

function cameraClips(store: DocStore): JsonObject[] {
  const track = trackOfType(store.doc as ScriptDoc, 'CAMERA')
  return track === null ? [] : clipsOf(track)
}

export function runClipTemplates(check: CheckFn, ctx: VerifyContext): void {
  // ── clip.fade ──
  {
    const plan = planGeneration(clipRequest(ctx, 'clip.fade', { duration: 2, mode: 'in', color: '#000000' }))
    check('C1 fade 计划成功', plan.ok, plan.diagnostics)
    const store = openStore(ctx)
    commitPlan(check, store, plan, 'C1 fade')
    const doc = store.doc as ScriptDoc
    const track = trackOfType(doc, 'OVERLAY')
    check('C1 fade 落在 OVERLAY 轨', track !== null)
    const clips = track ? clipsOf(track) : []
    check('C1 fade 一片段', clips.length === 1, clips.length)
    if (clips.length === 1) {
      const objects = leafObjects(clips[0])
      check('C1 fade layer_type=fade', objects.layer_type?.value === 'fade', objects.layer_type)
      check('C1 fade 颜色字符串', objects.color?.value === '#000000', objects.color)
      const opacity = objects.opacity
      check('C1 fade 透明度两帧 0→1',
        Array.isArray(opacity?.keyframes) && opacity.keyframes.length === 2
        && opacity.keyframes[0].time === 0 && opacity.keyframes[0].value === 0
        && opacity.keyframes[1].time === 2 && opacity.keyframes[1].value === 1,
        opacity)
      noForbiddenOrLeak(check, objects, 'C1 fade')
      check('C1 fade 不写遮罩 / 渐变 / 混合 / 文本',
        !('mask_shape' in objects) && !('gradient' in objects) && !('blend_mode' in objects) && !('text' in objects),
        Object.keys(objects))
    }
    const issues = validateStructure(doc, { catalog: ctx.catalog, metaKeys: ctx.metaKeys, registry: store.registry })
    check('C1 fade 产物过结构校验', issues.length === 0, issues.map((i) => `${i.code} ${i.message}`))
    store.undo()
    const after = store.doc as ScriptDoc
    check('C1 fade 撤销后零片段', allClips(after).length === 0, allClips(after).length)
  }

  // ── clip.static_breath（关闭呼吸） ──
  {
    const plan = planGeneration(clipRequest(ctx, 'clip.static_breath', { pose: pose(), duration: 3, breathEnabled: false }))
    check('C2 static_breath 计划成功', plan.ok, plan.diagnostics)
    const store = openStore(ctx)
    commitPlan(check, store, plan, 'C2 static_breath')
    const clips = cameraClips(store)
    check('C2 static_breath 一片段', clips.length === 1, clips.length)
    if (clips.length === 1) {
      const objects = leafObjects(clips[0])
      check('C2 static_breath 绝对位置', objects.position_mode?.value === 'absolute', objects.position_mode)
      check('C2 static_breath 位置三轴单值', objects['position.x']?.value === 0 && objects['position.y']?.value === 1.6 && objects['position.z']?.value === 0, objects)
      check('C2 static_breath 朝向 / 镜头单值', objects.yaw?.value === 0 && objects.fov?.value === 70 && objects.zoom?.value === 1, objects)
      check('C2 static_breath 呼吸关闭', objects.cam_breath_enabled?.value === false, objects.cam_breath_enabled)
      const breathKeys = Object.keys(objects).filter((k) => k.startsWith('cam_breath_') && k !== 'cam_breath_enabled')
      check('C2 static_breath 关闭时省略其余呼吸字段', breathKeys.length === 0, breathKeys)
      noForbiddenOrLeak(check, objects, 'C2 static_breath')
    }
    store.undo()
  }

  // ── clip.static_breath（开启 trauma 呼吸） ──
  {
    const plan = planGeneration(clipRequest(ctx, 'clip.static_breath', {
      pose: pose(), duration: 3, breathEnabled: true, breathType: 'trauma', breathIntensity: 0.2, breathSeed: 7, breathSpeed: 1.2, breathTrauma: 0.8, breathDecay: 0.4,
    }))
    check('C2 trauma 呼吸计划成功', plan.ok, plan.diagnostics)
    const store = openStore(ctx)
    commitPlan(check, store, plan, 'C2 trauma 呼吸')
    const clips = cameraClips(store)
    if (clips.length === 1) {
      const objects = leafObjects(clips[0])
      check('C2 trauma 写 trauma 与 decay', objects.cam_breath_trauma?.value === 0.8 && objects.cam_breath_decay?.value === 0.4, objects)
      check('C2 trauma 呼吸字段全单值', Object.entries(objects).every(([k, v]) => !k.startsWith('cam_breath_') || !Array.isArray(v.keyframes)), objects)
    }
    store.undo()
  }

  // ── clip.dolly（朝向角） ──
  {
    const start = pose({ position: { x: 0, y: 1.6, z: 0 }, yaw: 0, pitch: 0 })
    const end = pose({ position: { x: 4, y: 2, z: -3 }, yaw: 20, pitch: -5 })
    const plan = planGeneration(clipRequest(ctx, 'clip.dolly', { duration: 3, startPose: start, endPose: end, lookMode: 'angles' }))
    check('C3 dolly 计划成功', plan.ok, plan.diagnostics)
    const store = openStore(ctx)
    commitPlan(check, store, plan, 'C3 dolly')
    const clips = cameraClips(store)
    if (clips.length === 1) {
      const objects = leafObjects(clips[0])
      for (const axis of ['x', 'y', 'z']) {
        const frames = objects[`position.${axis}`]?.keyframes
        check(`C3 dolly position.${axis} 两端节点`, Array.isArray(frames) && frames.length === 2 && frames[0].time === 0 && frames[1].time === 3, frames)
      }
      check('C3 dolly yaw/pitch/roll 两端节点',
        Array.isArray(objects.yaw?.keyframes) && objects.yaw.keyframes.length === 2
        && Array.isArray(objects.pitch?.keyframes) && objects.pitch.keyframes.length === 2,
        objects)
      check('C3 dolly 不写注视目标', !('look_at_target_x' in objects), Object.keys(objects))
      noForbiddenOrLeak(check, objects, 'C3 dolly')
    }
    store.undo()
  }

  // ── clip.dolly（坐标注视；起止相同拒绝） ──
  {
    const same = pose()
    const coord = planGeneration(clipRequest(ctx, 'clip.dolly', {
      duration: 3, startPose: same, endPose: pose({ position: { x: 1, y: 1.6, z: 1 } }), lookMode: 'coordinate', lookTargetX: 5, lookTargetY: 2, lookTargetZ: 0,
    }))
    check('C3 dolly 坐标注视计划成功', coord.ok, coord.diagnostics)
    const store = openStore(ctx)
    if (coord.command !== null) {
      store.commit(coord.command)
      const clips = cameraClips(store)
      if (clips.length === 1) {
        const objects = leafObjects(clips[0])
        check('C3 dolly 坐标注视 look_at=coordinate', objects.look_at?.value === 'coordinate', objects.look_at)
        check('C3 dolly 坐标注视写注视点三轴', objects.look_at_target_x?.value === 5 && objects.look_at_target_y?.value === 2 && objects.look_at_target_z?.value === 0, objects)
        check('C3 dolly 坐标注视不写朝向角', !('yaw' in objects) && !('pitch' in objects) && !('roll' in objects), Object.keys(objects))
      }
      store.undo()
    }

    const bad = planGeneration(clipRequest(ctx, 'clip.dolly', { duration: 3, startPose: same, endPose: same, lookMode: 'angles' }))
    check('C3 dolly 起止相同拒绝', !bad.ok && bad.diagnostics.some((d) => d.code === 'T_PARAM_CROSS'), bad.diagnostics)
  }

  // ── clip.orbit_arc（看向圆心） ──
  {
    const plan = planGeneration(clipRequest(ctx, 'clip.orbit_arc', {
      duration: 3, centerX: 0, centerZ: 0, height: 2, radius: 5, startAngle: 0, sweep: 60, clockwise: false, lookMode: 'center', fov: 70,
    }))
    check('C4 orbit_arc 计划成功', plan.ok, plan.diagnostics)
    const store = openStore(ctx)
    commitPlan(check, store, plan, 'C4 orbit_arc')
    const clips = cameraClips(store)
    check('C4 orbit_arc 一片段', clips.length === 1, clips.length)
    const paths = pathEntries(store.doc as ScriptDoc)
    check('C4 orbit_arc 一条路径', paths.length === 1, paths.length)
    if (clips.length === 1 && paths.length === 1) {
      const objects = leafObjects(clips[0])
      const clipId = clips[0].id
      check('C4 orbit_arc 位置两端节点',
        Array.isArray(objects['position.x']?.keyframes) && objects['position.x'].keyframes.length === 2, objects)
      check('C4 orbit_arc 看向圆心', objects.look_at?.value === 'coordinate' && objects.look_at_target_x?.value === 0 && objects.look_at_target_y?.value === 2 && objects.look_at_target_z?.value === 0, objects)
      const path = paths[0]
      check('C4 路径 clip 指向本片段', path.clip === clipId, { pathClip: path.clip, clipId })
      check('C4 路径端点命中节点时间', path.from === 0 && path.to === 3, { from: path.from, to: path.to })
      check('C4 路径轴只含水平两轴', Array.isArray(path.axes) && path.axes.join(',') === 'x,z', path.axes)
      const geometry = path.geometry as JsonObject | undefined
      check('C4 几何为 bezier', geometry?.type === 'bezier', geometry)
      const controls = geometry?.control_points as JsonObject[] | undefined
      check('C4 两个完整相对偏移控制点',
        Array.isArray(controls) && controls.length === 2
        && controls.every((p) => ['dx', 'dy', 'dz'].every((k) => typeof p[k] === 'number' && Number.isFinite(p[k]))),
        controls)
      noForbiddenOrLeak(check, objects, 'C4 orbit_arc')
    }
    store.undo()
  }

  // ── clip.orbit_arc（切线朝向 + 扫角超限拒绝） ──
  {
    const tangent = planGeneration(clipRequest(ctx, 'clip.orbit_arc', {
      duration: 3, centerX: 0, centerZ: 0, height: 2, radius: 5, startAngle: 0, sweep: 45, clockwise: true, lookMode: 'tangent', fov: 70,
    }))
    check('C4 切线朝向计划成功', tangent.ok, tangent.diagnostics)
    const store = openStore(ctx)
    if (tangent.command !== null) {
      store.commit(tangent.command)
      const clips = cameraClips(store)
      if (clips.length === 1) {
        const objects = leafObjects(clips[0])
        check('C4 切线 orient=tangent', objects.orient?.value === 'tangent', objects.orient)
        check('C4 切线不写圆心注视', !('look_at_target_x' in objects), Object.keys(objects))
      }
      store.undo()
    }

    const over = planGeneration(clipRequest(ctx, 'clip.orbit_arc', {
      duration: 3, centerX: 0, centerZ: 0, height: 2, radius: 5, startAngle: 0, sweep: 120, clockwise: false, lookMode: 'center', fov: 70,
    }))
    check('C4 单段扫角超 90° 拒绝', !over.ok && over.diagnostics.some((d) => d.code === 'T_PARAM_CROSS'), over.diagnostics)
  }
}
