/**
 * 12 轮「脚本模板」自检（12-05 / 12-16 脚本组）。
 *
 * 覆盖：blank 七类空轨 / 不写触发器与路径；camera_intro 遮幅与黑场条件生成、同起同长；
 * follow_black 相对基准跟随、朝向与注视同一选择器、结束黑场淡入、触发器只含声明字段；
 * 非空文档拒绝；真实提交与撤销回退。
 */
import type { CheckFn } from './harness.ts'
import type { VerifyContext } from './context.ts'
import { allClips, clipsOf, objectsOf, pathEntries, trackOfType, tracksOf } from './context.ts'
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

function scriptRequest(ctx: VerifyContext, templateId: string, params: Record<string, ParamValue>, doc = ctx.emptyDoc()): GenerationRequest {
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

function openStore(ctx: VerifyContext) {
  const store = ctx.createStore()
  store.open(ctx.emptyDoc(), null)
  return store
}

function checkStructure(check: CheckFn, store: ReturnType<typeof openStore>, ctx: VerifyContext, label: string): void {
  const doc = store.doc as ScriptDoc
  const issues = validateStructure(doc, { catalog: ctx.catalog, metaKeys: ctx.metaKeys, registry: store.registry })
  check(`${label} 产物过结构校验`, issues.length === 0, issues.map((i) => `${i.code} ${i.message}`))
}

export function runScriptTemplates(check: CheckFn, ctx: VerifyContext): void {
  // ── script.blank ──
  {
    const plan = planGeneration(scriptRequest(ctx, 'script.blank', { id: 'verify12', name: 'verify', author: 'tester' }))
    check('S1 blank 计划成功', plan.ok, plan.diagnostics)
    const store = openStore(ctx)
    if (plan.command !== null) {
      const outcome = store.commit(plan.command)
      check('S1 blank 提交成功', outcome.ok, outcome.error ?? plan.diagnostics)
    }
    const doc = store.doc as ScriptDoc
    const tracks = tracksOf(doc)
    const order = tracks.map((t) => t.type)
    check('S1 blank 七类空轨齐全', order.join(',') === 'CAMERA,LETTERBOX,AUDIO,EVENT,MOD_EVENT,OVERLAY,ADJUST', order)
    check('S1 blank 轨道均为空轨', tracks.every((t) => clipsOf(t).length === 0), tracks.map((t) => clipsOf(t).length))
    check('S1 blank 无路径', pathEntries(doc).length === 0, pathEntries(doc).length)
    check('S1 blank 不写空 triggers 数组', !Array.isArray(doc.meta.triggers), doc.meta.triggers)
    check('S1 blank 不写 version / total_duration',
      doc.meta.version === undefined && doc.timeline.total_duration === undefined,
      { version: doc.meta.version, total: doc.timeline.total_duration })
    checkStructure(check, store, ctx, 'S1 blank')
    store.undo()
    const after = store.doc as ScriptDoc
    check('S1 blank 撤销后空文档', allClips(after).length === 0 && tracksOf(after).length === 0)
  }

  // ── script.camera_intro（遮幅 + 开场黑场） ──
  {
    const plan = planGeneration(scriptRequest(ctx, 'script.camera_intro', {
      cameraPose: pose(), cameraDuration: 3, letterboxRatio: 2.35, blackDuration: 1,
    }))
    check('S2 camera_intro 计划成功', plan.ok, plan.diagnostics)
    const store = openStore(ctx)
    if (plan.command !== null) {
      const outcome = store.commit(plan.command)
      check('S2 camera_intro 提交成功', outcome.ok, outcome.error ?? plan.diagnostics)
    }
    const doc = store.doc as ScriptDoc
    const camera = trackOfType(doc, 'CAMERA')
    const letterbox = trackOfType(doc, 'LETTERBOX')
    const overlay = trackOfType(doc, 'OVERLAY')
    check('S2 camera_intro 相机轨存在', camera !== null)
    check('S2 camera_intro 遮幅轨存在', letterbox !== null)
    check('S2 camera_intro 黑场轨存在', overlay !== null)
    const cameraClips = camera ? clipsOf(camera) : []
    const letterClips = letterbox ? clipsOf(letterbox) : []
    const overlayClips = overlay ? clipsOf(overlay) : []
    check('S2 相机一片段 0~3', cameraClips.length === 1 && cameraClips[0].start_time === 0 && cameraClips[0].duration === 3, cameraClips)
    check('S2 遮幅同起同长', letterClips.length === 1 && letterClips[0].start_time === 0 && letterClips[0].duration === 3, letterClips)
    if (letterClips.length === 1) {
      const objects = leafObjects(letterClips[0])
      check('S2 遮幅只写比例与透明度', objects.aspect_ratio?.value === 2.35 && objects.opacity?.value === 1, objects)
    }
    check('S2 黑场 0~1', overlayClips.length === 1 && overlayClips[0].start_time === 0 && overlayClips[0].duration === 1, overlayClips)
    if (overlayClips.length === 1) {
      const frames = leafObjects(overlayClips[0]).opacity?.keyframes
      check('S2 黑场淡出（黑→画面）1→0',
        Array.isArray(frames) && frames.length === 2 && frames[0].value === 1 && frames[1].value === 0, frames)
    }
    checkStructure(check, store, ctx, 'S2 camera_intro')
    store.undo()
  }

  // ── script.camera_intro：比例 / 黑场为 0 时不生成对应轨；黑场超长拒绝。 ──
  {
    const minimal = planGeneration(scriptRequest(ctx, 'script.camera_intro', {
      cameraPose: pose(), cameraDuration: 3, letterboxRatio: 0, blackDuration: 0,
    }))
    check('S2 零比例 / 零黑场计划成功', minimal.ok, minimal.diagnostics)
    const store = openStore(ctx)
    if (minimal.command !== null) {
      store.commit(minimal.command)
      check('S2 条件为 0 不生成遮幅轨', trackOfType(store.doc as ScriptDoc, 'LETTERBOX') === null)
      check('S2 条件为 0 不生成黑场轨', trackOfType(store.doc as ScriptDoc, 'OVERLAY') === null)
      store.undo()
    }
    const over = planGeneration(scriptRequest(ctx, 'script.camera_intro', {
      cameraPose: pose(), cameraDuration: 2, letterboxRatio: 2.35, blackDuration: 3,
    }))
    check('S2 黑场超过相机时长拒绝', !over.ok && over.diagnostics.some((d) => d.code === 'T_PARAM_CROSS'), over.diagnostics)
  }

  // ── script.follow_black（login 触发器） ──
  {
    const plan = planGeneration(scriptRequest(ctx, 'script.follow_black', {
      selector: '@p', backDistance: 3, heightOffset: 1.6, lookHeight: 1.6,
      duration: 10, blackDuration: 2, triggerType: 'login', biome: '',
    }))
    check('S3 follow_black 计划成功', plan.ok, plan.diagnostics)
    const store = openStore(ctx)
    if (plan.command !== null) {
      const outcome = store.commit(plan.command)
      check('S3 follow_black 提交成功', outcome.ok, outcome.error ?? plan.diagnostics)
    }
    const doc = store.doc as ScriptDoc
    const camera = trackOfType(doc, 'CAMERA')
    const cameraClips = camera ? clipsOf(camera) : []
    check('S3 跟随相机一片段 0~10', cameraClips.length === 1 && cameraClips[0].start_time === 0 && cameraClips[0].duration === 10, cameraClips)
    if (cameraClips.length === 1) {
      const objects = leafObjects(cameraClips[0])
      check('S3 相对基准位置', objects.position_mode?.value === 'relative' && objects.position_space?.value === 'base', objects)
      check('S3 基准选择器与不冻结', objects.position_origin?.value === '@p' && objects.position_origin_freeze?.value === false, objects)
      check('S3 位置按基准轴常量（后 / 上 / 横零）',
        objects['position.x']?.value === -3 && objects['position.y']?.value === 1.6 && objects['position.z']?.value === 0, objects)
      check('S3 朝向来源与注视同一选择器',
        objects.facing_source?.value === 'entity' && objects.facing_target?.value === '@p'
        && objects.look_at?.value === 'entity' && objects.look_at_selector?.value === '@p', objects)
      check('S3 注视点高度单独给', objects['look_at_part.y']?.value === 1.6, objects)
      const animated = Object.values(objects).some((v) => Array.isArray(v.keyframes))
      check('S3 位置与朝向全常量不打关键帧', animated === false, objects)
    }
    const overlay = trackOfType(doc, 'OVERLAY')
    const overlayClips = overlay ? clipsOf(overlay) : []
    check('S3 结束黑场 8~10', overlayClips.length === 1 && overlayClips[0].start_time === 8 && overlayClips[0].duration === 2, overlayClips)
    if (overlayClips.length === 1) {
      const frames = leafObjects(overlayClips[0]).opacity?.keyframes
      check('S3 结束黑场淡入（画面→黑）0→1',
        Array.isArray(frames) && frames.length === 2 && frames[0].value === 0 && frames[1].value === 1, frames)
    }
    const triggers = Array.isArray(doc.meta.triggers) ? (doc.meta.triggers as JsonObject[]) : []
    check('S3 login 触发器一条', triggers.length === 1, triggers)
    if (triggers.length === 1) {
      const trigger = triggers[0]
      check('S3 触发器只含声明字段', Object.keys(trigger).join(',') === 'type,conditions', Object.keys(trigger))
      check('S3 login 类型与空条件', trigger.type === 'login' && typeof trigger.conditions === 'object', trigger)
      check('S3 触发器不写 target / 规则 / 绑定', !('target' in trigger), Object.keys(trigger))
    }
    checkStructure(check, store, ctx, 'S3 follow_black')
    store.undo()
  }

  // ── script.follow_black：biome 触发器；空 biome 拒绝；非空文档拒绝。 ──
  {
    const biomePlan = planGeneration(scriptRequest(ctx, 'script.follow_black', {
      selector: '@p', backDistance: 3, heightOffset: 1.6, lookHeight: 1.6,
      duration: 10, blackDuration: 0, triggerType: 'biome', biome: 'plains',
    }))
    check('S3 biome 触发器计划成功', biomePlan.ok, biomePlan.diagnostics)
    const store = openStore(ctx)
    if (biomePlan.command !== null) {
      store.commit(biomePlan.command)
      const triggers = Array.isArray((store.doc as ScriptDoc).meta.triggers) ? ((store.doc as ScriptDoc).meta.triggers as JsonObject[]) : []
      check('S3 biome 条件带群系', triggers.length === 1 && (triggers[0].conditions as JsonObject).biome === 'plains', triggers)
      store.undo()
    }
    const emptyBiome = planGeneration(scriptRequest(ctx, 'script.follow_black', {
      selector: '@p', backDistance: 3, heightOffset: 1.6, lookHeight: 1.6,
      duration: 10, blackDuration: 0, triggerType: 'biome', biome: '',
    }))
    check('S3 biome 空群系拒绝', !emptyBiome.ok && emptyBiome.diagnostics.some((d) => d.paramKey === 'biome'), emptyBiome.diagnostics)

    // 非空文档：先放一条既有片段，脚本模板不得覆盖。
    const busyRoot = {
      meta: { id: 'busy', name: 'busy', author: 't' },
      timeline: { tracks: [{ type: 'OVERLAY', clips: [{ start_time: 0, duration: 2, objects: { layer_type: { value: 'fade' } } }] }] },
    }
    const busyDoc = ctx.docFrom(busyRoot)
    const busyPlan = planGeneration(scriptRequest(ctx, 'script.blank', { id: 'verify12', name: 'verify', author: 't' }, busyDoc))
    check('S1 脚本模板不覆盖非空文档', !busyPlan.ok && busyPlan.diagnostics.some((d) => d.code === 'T_DOC_NON_EMPTY'), busyPlan.diagnostics)
  }
}
