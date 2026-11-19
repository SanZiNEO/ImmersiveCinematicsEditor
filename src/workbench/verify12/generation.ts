/**
 * 12 轮「生成校验链」自检（12-11 / 12-16 校验组）。
 *
 * 覆盖：四层链路（参数 → 展开结构 → 装配 → 最终脚本校验）、诊断级别与定位字段、
 * warning 允许保存 / error 阻止且零残留、重叠拒绝且已有片段不动、类型不匹配拒绝、
 * 连续两次生成各自独立事务（一次撤销只回退最近一次）。
 */
import type { CheckFn } from './harness.ts'
import type { VerifyContext } from './context.ts'
import { allClips } from './context.ts'
import type { ScriptDoc } from '../../core/doc/types.ts'
import { planGeneration, summarizeGeneration, type GenerationRequest, type ParamValue, type PoseValue } from '../../features/templates/public.ts'
import { dedupeDiagnostics } from '../../features/generation/diagnostics.ts'

function pose(over: Partial<PoseValue> = {}): PoseValue {
  return {
    position: { x: 0, y: 1.6, z: 0 },
    yaw: 0, pitch: 0, roll: 0, fov: 70, zoom: 1,
    ...over,
  }
}

function request(
  ctx: VerifyContext,
  templateId: string,
  params: Record<string, ParamValue>,
  target: GenerationRequest['target'],
  doc = ctx.emptyDoc(),
): GenerationRequest {
  return {
    templateId,
    params,
    target,
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

function busyOverlayDoc(ctx: VerifyContext): ReturnType<VerifyContext['docFrom']> {
  return ctx.docFrom({
    meta: { id: 'busy', name: 'busy', author: 't' },
    timeline: {
      tracks: [
        { type: 'OVERLAY', clips: [{ start_time: 0, duration: 2, objects: { layer_type: { value: 'fade' }, color: { value: '#000000' }, opacity: { value: 1 } } }] },
        { type: 'CAMERA', clips: [{ start_time: 0, duration: 2, objects: { position_mode: { value: 'absolute' } } }] },
      ],
    },
  })
}

export function runGenerationValidation(check: CheckFn, ctx: VerifyContext): void {
  // ── 第一层：参数 error 阻止，命令为 null，零残留。 ──
  {
    const bad = planGeneration(request(ctx, 'clip.fade', { duration: -1, mode: 'in', color: '#000000' }, { mode: 'newTrack' }))
    check('G1 参数 error 阻止生成', !bad.ok && bad.command === null, bad)
    check('G1 诊断带 T_ 前缀与定位',
      bad.diagnostics.some((d) => d.code.startsWith('T_') && d.paramKey === 'duration' && d.templateId === 'clip.fade'),
      bad.diagnostics)
    const store = openStore(ctx)
    check('G1 失败计划不产生命令（零残留）', bad.command === null && allClips(store.doc as ScriptDoc).length === 0)
  }

  // ── 未知模板。 ──
  {
    const unknown = planGeneration(request(ctx, 'clip.nope', {}, { mode: 'newTrack' }))
    check('G1 未知模板 error', !unknown.ok && unknown.diagnostics.some((d) => d.code === 'T_UNKNOWN_TEMPLATE'), unknown.diagnostics)
  }

  // ── 第三层：重叠拒绝，已有片段不动。 ──
  {
    const doc = busyOverlayDoc(ctx)
    const plan = planGeneration(request(ctx, 'clip.fade', { duration: 2, mode: 'in', color: '#000000' }, { mode: 'atTime', time: 1, trackId: 'OVERLAY#0' }, doc))
    check('G3 重叠拒绝', !plan.ok && plan.diagnostics.some((d) => d.code === 'T_OVERLAP'), plan.diagnostics)
    const store = openStore(ctx)
    store.open(doc, null)
    const live = store.doc as ScriptDoc
    const before = allClips(live).length
    if (plan.command !== null) {
      store.commit(plan.command)
    }
    check('G3 重叠拒绝后已有片段不动', allClips(live).length === before, allClips(live).length)
  }

  // ── 第三层：目标轨道类型不匹配拒绝。 ──
  {
    const doc = busyOverlayDoc(ctx)
    const plan = planGeneration(request(ctx, 'clip.fade', { duration: 2, mode: 'in', color: '#000000' }, { mode: 'atTime', time: 0, trackId: 'CAMERA#1' }, doc))
    check('G3 类型不匹配拒绝', !plan.ok && plan.diagnostics.some((d) => d.code === 'T_TARGET_LAYER_MISMATCH'), plan.diagnostics)
  }

  // ── 第四层：合法产物最终脚本校验无 document error。 ──
  {
    const plan = planGeneration(request(ctx, 'clip.static_breath', { pose: pose(), duration: 3, breathEnabled: false }, { mode: 'newTrack' }))
    check('G4 合法模板计划成功', plan.ok, plan.diagnostics)
    const docErrors = plan.diagnostics.filter((d) => d.source === 'document' && d.severity === 'error')
    check('G4 最终脚本校验无 error', docErrors.length === 0, docErrors)
    const store = openStore(ctx)
    if (plan.command !== null) {
      const outcome = store.commit(plan.command)
      check('G4 真实提交成功', outcome.ok, outcome.error)
    }
    store.undo()
    check('G4 撤销后零片段', allClips(store.doc as ScriptDoc).length === 0)
  }

  // ── warning 允许保存。 ──
  {
    const plan = planGeneration(request(ctx, 'track.multi_cam', { poses: [pose(), pose()], clipDuration: 2, gap: 0 }, { mode: 'newTrack' }))
    check('G4 warning 不阻止保存', plan.ok && plan.diagnostics.some((d) => d.severity === 'warning'), plan.diagnostics)
  }

  // ── 诊断去重与级别集合。 ──
  {
    const deduped = dedupeDiagnostics([
      { code: 'T_X', severity: 'error', message: 'm', source: 'template', paramKey: 'a' },
      { code: 'T_X', severity: 'error', message: 'm', source: 'template', paramKey: 'a' },
      { code: 'T_Y', severity: 'warning', message: 'n', source: 'document' },
    ])
    check('G5 诊断去重', deduped.length === 2, deduped.length)
    check('G5 级别合法', deduped.every((d) => ['error', 'warning', 'info'].includes(d.severity)), deduped)
  }

  // ── 连续两次生成：各自独立事务，一次撤销只回退最近一次。 ──
  {
    const store = openStore(ctx)
    const plan1 = planGeneration(request(ctx, 'clip.fade', { duration: 1, mode: 'in', color: '#000000' }, { mode: 'newTrack' }))
    const plan2 = planGeneration(request(ctx, 'clip.fade', { duration: 1, mode: 'out', color: '#ffffff' }, { mode: 'newTrack' }))
    check('G6 两次计划均成功', plan1.ok && plan2.ok, [plan1.diagnostics, plan2.diagnostics])
    if (plan1.command !== null) store.commit(plan1.command)
    if (plan2.command !== null) store.commit(plan2.command)
    const live = () => store.doc as ScriptDoc
    check('G6 两次提交后两片段', allClips(live()).length === 2, allClips(live()).length)
    store.undo()
    check('G6 一次撤销回退最近一次', allClips(live()).length === 1, allClips(live()).length)
    store.undo()
    check('G6 再次撤销回退第一次', allClips(live()).length === 0, allClips(live()).length)
  }

  // ── 摘要接口：问题清单与事实计数。 ──
  {
    const summary = summarizeGeneration(request(ctx, 'script.blank', { id: 'verify12', name: 'verify', author: 't' }, { mode: 'newDocument' }))
    check('G7 摘要七轨零片段', summary.summary.trackCount === 7 && summary.summary.clipCount === 0, summary.summary)
    check('G7 摘要无参数 error', !summary.issues.some((i) => i.severity === 'error'), summary.issues)
  }

  // ── 产物不含模板 id / 参数 / 槽位 / 命名空间 / 来源 / 生成时间。 ──
  {
    const plan = planGeneration(request(ctx, 'clip.orbit_arc', {
      duration: 3, centerX: 0, centerZ: 0, height: 2, radius: 5, startAngle: 0, sweep: 60, clockwise: false, lookMode: 'center', fov: 70,
    }, { mode: 'newTrack' }))
    check('G8 orbit_arc 计划成功', plan.ok, plan.diagnostics)
    const store = openStore(ctx)
    if (plan.command !== null) store.commit(plan.command)
    const serialized = JSON.stringify((store.doc as ScriptDoc).root)
    check('G8 产物不含模板 id', !serialized.includes('orbit_arc') && !serialized.includes('clip.orbit_arc'), serialized.slice(0, 200))
    check('G8 产物不含参数键 / 命名空间 / 来源 / 时间戳',
      !/param|namespace|templateId|generatedAt|createdAt|source/.test(serialized), serialized.slice(0, 200))
    store.undo()
  }
}
