/**
 * 12-07 快捷效果自检（`runQuickEffects(check, ctx)`）。
 *
 * 断言：
 * - 固定集合条目数与模板登记一致，条目层与模板层一致；
 * - 前置条件求值：无文档 / 缺姿态 / 槽位不足 / 缺选择器分别置灰并给稳定原因码；
 * - 满足前置时预填参数（姿态 / 圆心 / 列表 / 选择器）；
 * - 快捷效果走与模板面板同一条 `planGeneration` + `commit` 通道：注入计数器，
 *   计划只调一次、提交一次；产物脚本不含快捷效果 id 或模板 id。
 */
import type { CheckFn } from './harness.ts'
import type { VerifyContext } from './context.ts'
import { clipsOf, tracksOf, trackOfType } from './context.ts'
import type { DocStore } from '../../core/doc/store.ts'
import type { JsonObject, ScriptDoc } from '../../core/doc/types.ts'
import { planGeneration, templateById, type ParamValue, type PoseValue } from '../../features/templates/public.ts'
import {
  QUICK_EFFECTS,
  buildQuickRequest,
  evaluateQuickEffect,
  quickTemplateRegistered,
  type QuickContext,
  type QuickEvaluate,
  type QuickEffectDef,
} from '../../plugins/core.templates/quickEffects.ts'
import { runApply, type ApplyDeps } from '../../plugins/core.templates/panelModel.ts'

function pose(over: Partial<PoseValue> = {}): PoseValue {
  return {
    position: { x: 0, y: 1.6, z: 0 },
    yaw: 0, pitch: 0, roll: 0, fov: 70, zoom: 1,
    ...over,
  }
}

function openStore(ctx: VerifyContext): DocStore {
  const store = ctx.createStore()
  store.open(ctx.emptyDoc(), null)
  return store
}

function quickContext(over: Partial<QuickContext> = {}): QuickContext {
  return {
    docOpen: true,
    sourcePose: null,
    filledSlots: [],
    selector: '',
    ...over,
  }
}

/** 按内部 id 取条目；未找到给一条禁用结果（自检断言时先判存在）。 */
function defById(id: string): QuickEffectDef | null {
  return QUICK_EFFECTS.find((entry) => entry.id === id) ?? null
}

function evaluate(id: string, context: QuickContext): QuickEvaluate | null {
  const def = defById(id)
  if (def === null) return null
  return evaluateQuickEffect(def, context)
}

function enabledIds(context: QuickContext): string[] {
  return QUICK_EFFECTS.filter((def) => evaluateQuickEffect(def, context).enabled).map((def) => def.id)
}

function trackCounts(doc: ScriptDoc): number[] {
  return tracksOf(doc).map((track) => clipsOf(track).length)
}

export function runQuickEffects(check: CheckFn, ctx: VerifyContext): void {
  // ── 集合与登记 ──
  check('Q1 固定快捷效果 10 项', QUICK_EFFECTS.length === 10, QUICK_EFFECTS.map((e) => e.id))
  check('Q1 全部引用已登记模板', QUICK_EFFECTS.every((def) => quickTemplateRegistered(def)), QUICK_EFFECTS.map((e) => e.templateId))
  check('Q1 条目层与模板层一致', QUICK_EFFECTS.every((def) => templateById(def.templateId)?.layer === def.layer),
    QUICK_EFFECTS.map((e) => `${e.id}:${e.layer}`))

  // ── 无文档：全部置灰 ──
  {
    const closed = quickContext({ docOpen: false })
    const disabled = QUICK_EFFECTS.filter((def) => !evaluateQuickEffect(def, closed).enabled)
    check('Q2 无文档全部禁用', disabled.length === QUICK_EFFECTS.length, disabled.map((d) => d.id))
    check('Q2 无文档原因=noDoc', QUICK_EFFECTS.every((def) => evaluateQuickEffect(def, closed).reasonCode === 'noDoc'))
  }

  // ── 空姿态 / 空选择器：缺前置置灰 ──
  {
    const empty = quickContext()
    const ids = enabledIds(empty)
    check('Q3 无姿态时仅无姿态条目可用', ids.join(',') === 'fade_in_black,fade_out_black', ids)

    const breath = evaluate('static_breath', empty)
    const dolly = evaluate('push_in', empty)
    const orbitArc = evaluate('orbit_90', empty)
    const orbitTrack = evaluate('orbit_full', empty)
    const multiCam = evaluate('multi_cam', empty)
    const intro = evaluate('camera_intro', empty)
    const follow = evaluate('follow_black', empty)

    check('Q3 呼吸缺姿态置灰', breath !== null && breath.reasonCode === 'noPose')
    check('Q3 推近缺姿态置灰', dolly !== null && dolly.reasonCode === 'noPose')
    check('Q3 环绕弧缺姿态置灰', orbitArc !== null && orbitArc.reasonCode === 'noPose')
    check('Q3 整圈缺姿态置灰', orbitTrack !== null && orbitTrack.reasonCode === 'noPose')
    check('Q3 多机位槽位不足置灰', multiCam !== null && multiCam.reasonCode === 'needSlots')
    check('Q3 开场缺姿态置灰', intro !== null && intro.reasonCode === 'noPose')
    check('Q3 跟随缺选择器置灰', follow !== null && follow.reasonCode === 'needSelector')
  }

  // ── 满足前置：预填参数 ──
  {
    const poseA = pose({ position: { x: 3, y: 2, z: 5 }, yaw: 45 })
    const poseB = pose({ position: { x: -2, y: 1.6, z: 4 }, yaw: -30 })
    const context = quickContext({
      sourcePose: poseA,
      filledSlots: [poseB],
      selector: '@p1',
    })

    const breath = evaluate('static_breath', context)
    check('Q4 呼吸预填姿态', breath?.enabled === true && breath.params.pose !== null, breath?.params)

    const dolly = evaluate('push_in', context)
    check('Q4 推近起止姿态齐全', dolly?.enabled === true
      && dolly.params.startPose !== null && dolly.params.endPose !== null, dolly?.params)
    if (dolly !== null) {
      const start = dolly.params.startPose as PoseValue
      const end = dolly.params.endPose as PoseValue
      check('Q4 推近终点位置≠起点', start.position.x !== end.position.x
        || start.position.y !== end.position.y
        || start.position.z !== end.position.z, { start: start.position, end: end.position })
    }

    const arcEval = evaluate('orbit_90', context)
    check('Q4 环绕弧圆心取自姿态位置', arcEval?.enabled === true
      && arcEval.params.centerX === 3 && arcEval.params.centerZ === 5 && arcEval.params.height === 2, arcEval?.params)

    const oneSlot = evaluate('multi_cam', quickContext({ filledSlots: [poseB] }))
    check('Q4 单槽多机位仍置灰', oneSlot?.reasonCode === 'needSlots', oneSlot)
    const twoSlots = evaluate('multi_cam', quickContext({ filledSlots: [poseB, poseA] }))
    const poses = twoSlots === null ? null : (twoSlots.params.poses as PoseValue[] | null)
    check('Q4 双槽多机位预填两姿态', twoSlots?.enabled === true && poses !== null && poses.length === 2, twoSlots?.params)

    const followEval = evaluate('follow_black', context)
    check('Q4 跟随预填选择器', followEval?.enabled === true && followEval.params.selector === '@p1', followEval?.params)

    const fadeEval = evaluate('fade_in_black', context)
    check('Q4 淡入黑场模式=in', fadeEval?.enabled === true && fadeEval.params.mode === 'in', fadeEval?.params)
  }

  // ── 同一提交通道：计划一次、提交一次，产物无 id 泄漏 ──
  {
    const store = openStore(ctx)
    const def = defById('fade_in_black')
    check('Q5 淡入条目存在', def !== null)
    if (def === null) return

    const evaluated = evaluateQuickEffect(def, quickContext())
    const request = buildQuickRequest(
      def,
      evaluated.params,
      ctx.emptyDoc(),
      ctx.catalog,
      0,
      [],
    )
    // 自检用 newTrack 目标，避免空文档无同类型轨；通道与面板一致。
    request.target = { mode: 'newTrack' }

    const counters = { plan: 0, commit: 0 }
    const deps: ApplyDeps = {
      plan: (r) => { counters.plan += 1; return planGeneration(r) },
      commit: (cmd) => { counters.commit += 1; return store.commit(cmd) },
      select: () => undefined,
    }
    const plan = deps.plan(request)
    check('Q5 快捷效果计划成功', plan.ok, plan.diagnostics)
    const outcome = runApply(deps, plan, false)
    check('Q5 应用成功', outcome.ok, outcome.failures)
    check('Q5 计划只调一次（无第二生成通道）', counters.plan === 1, counters.plan)
    check('Q5 提交恰好一次', counters.commit === 1, counters.commit)

    const doc = store.doc as ScriptDoc
    const overlay = trackOfType(doc, 'OVERLAY')
    check('Q5 落地一条 OVERLAY 片段', overlay !== null && clipsOf(overlay).length === 1, trackCounts(doc))
    const serialized = JSON.stringify(doc)
    check('Q5 产物无快捷效果 id', !serialized.includes('fade_in_black'))
    check('Q5 产物无模板 id', !serialized.includes('clip.fade'))
  }

  // ── 多机位真实提交：两硬切机位，产物无模板 / 条目 id ──
  {
    const store = openStore(ctx)
    const def = defById('multi_cam')
    check('Q5 多机位条目存在', def !== null)
    if (def === null) return
    const poseA = pose({ position: { x: 3, y: 2, z: 5 } })
    const poseB = pose({ position: { x: -2, y: 1.6, z: 4 } })
    const evaluated = evaluateQuickEffect(def, quickContext({ filledSlots: [poseA, poseB] }))
    const request = buildQuickRequest(def, evaluated.params, ctx.emptyDoc(), ctx.catalog, 0, [])
    request.target = { mode: 'newTrack' }
    const counters = { plan: 0, commit: 0 }
    const deps: ApplyDeps = {
      plan: (r) => { counters.plan += 1; return planGeneration(r) },
      commit: (cmd) => { counters.commit += 1; return store.commit(cmd) },
      select: () => undefined,
    }
    const plan = deps.plan(request)
    check('Q5 多机位计划成功', plan.ok, plan.diagnostics)
    const outcome = runApply(deps, plan, false)
    check('Q5 多机位应用成功', outcome.ok, outcome.failures)
    check('Q5 多机位计划一次提交一次', counters.plan === 1 && counters.commit === 1, counters)
    const doc = store.doc as ScriptDoc
    const camera = trackOfType(doc, 'CAMERA')
    check('Q5 多机位两片段', camera !== null && clipsOf(camera).length === 2, trackCounts(doc))
    const serialized = JSON.stringify(doc)
    check('Q5 产物无 multi_cam 条目 id', !serialized.includes('multi_cam'))
    check('Q5 产物无模板 id', !serialized.includes('track.multi_cam'))
  }
}

// 保留 ParamValue / JsonObject 类型引用供后续扩展。
export type { ParamValue, JsonObject }
