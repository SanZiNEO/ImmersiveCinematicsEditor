/**
 * 12-06 模板面板自检（`runTemplatePanel(check, ctx)`）。
 *
 * 断言走纯视图模型（`core.templates/panelModel.ts`），不靠看界面：
 * - 三层分组与搜索过滤；
 * - 参数默认值来自声明；错误红字映射到参数键；
 * - 插入目标可选集与禁用原因码；
 * - 摘要数字与 diff 事实来自 `StructureSummary`；
 * - 应用按钮就绪判定；九槽不可用时的禁用原因；
 * - 应用走同一 `planGeneration` + 提交通道：注入 commit 计数器，成功一次事务提交 1 次，
 *   失败零残留；脚本层新建文档先开文档再提交；真实 store 提交后撤销一次全回退。
 */
import type { CheckFn } from './harness.ts'
import type { VerifyContext } from './context.ts'
import { clipsOf, trackOfType, tracksOf } from './context.ts'
import type { DocStore } from '../../core/doc/store.ts'
import type { JsonObject, ScriptDoc } from '../../core/doc/types.ts'
import {
  planGeneration,
  type GenerationRequest,
  type ParamValue,
  type PoseValue,
} from '../../features/templates/public.ts'
import {
  docIsEmpty,
  findTemplate,
  initialParams,
  issueMessage,
  pickerAvailability,
  readiness,
  runApply,
  summaryView,
  targetOptions,
  templatesForLayer,
  type ApplyDeps,
  type TargetOption,
} from '../../plugins/core.templates/panelModel.ts'

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
  doc: ScriptDoc | null,
  selected: readonly string[] = [],
): GenerationRequest {
  return {
    templateId,
    params,
    target,
    doc,
    catalog: ctx.catalog,
    playhead: 0,
    selectedClipKeys: selected,
  }
}

function openStore(ctx: VerifyContext): DocStore {
  const store = ctx.createStore()
  store.open(ctx.emptyDoc(), null)
  return store
}

/** 构造一条带一条 OVERLAY 片段的文档（指定轨道类型）。 */
function docWithClip(ctx: VerifyContext, trackType: string, clipId: string): ScriptDoc {
  const root: JsonObject = {
    meta: { id: 'panel-1', name: 'panel', author: 'verify' },
    timeline: {
      tracks: [
        {
          type: trackType,
          clips: [
            {
              id: clipId,
              start_time: 0,
              duration: 2,
              objects: { layer_type: { value: 'fade' } },
            },
          ],
        },
      ],
    },
  }
  return ctx.docFrom(root)
}

function optionByKey(options: readonly TargetOption[], key: string): TargetOption | null {
  return options.find((option) => option.key === key) ?? null
}

export function runTemplatePanel(check: CheckFn, ctx: VerifyContext): void {
  // ── 三层分组与搜索 ──
  check('P1 片段层模板 4 个', templatesForLayer('clip', '').length === 4, templatesForLayer('clip', '').map((t) => t.id))
  check('P1 轨道层模板 2 个', templatesForLayer('track', '').length === 2, templatesForLayer('track', '').map((t) => t.id))
  check('P1 脚本层模板 3 个', templatesForLayer('script', '').length === 3, templatesForLayer('script', '').map((t) => t.id))

  const orbitHits = templatesForLayer('clip', 'orbit').map((t) => t.id)
  check('P1 搜索 orbit 命中片段环绕弧', orbitHits.includes('clip.orbit_arc'), orbitHits)
  check('P1 无匹配搜索返回空', templatesForLayer('clip', 'zzz-no-match').length === 0)

  // ── 默认值来自声明 ──
  const fade = findTemplate('clip.fade')
  check('P2 fade 模板已登记', fade !== null)
  if (fade !== null) {
    const defaults = initialParams(fade)
    check('P2 fade 默认时长 2s', defaults.duration === 2, defaults.duration)
    check('P2 fade 默认 mode=in', defaults.mode === 'in', defaults.mode)
    check('P2 fade 默认黑色', defaults.color === '#000000', defaults.color)
  }

  // ── 错误红字映射 ──
  {
    const bad = planGeneration(request(ctx, 'clip.fade', { duration: 0.01, mode: 'in', color: '#000000' }, { mode: 'newTrack' }, ctx.emptyDoc()))
    const msg = bad.diagnostics.map((d) => d.message).join('；')
    check('P3 越界时长进诊断', bad.diagnostics.some((d) => d.paramKey === 'duration'), msg)
    check('P3 计划被拒绝', !bad.ok, bad.diagnostics)
  }
  {
    const breath = findTemplate('clip.static_breath')
    check('P3 呼吸模板已登记', breath !== null)
    if (breath !== null) {
      const issues = planGeneration(request(ctx, breath.id, initialParams(breath), { mode: 'newTrack' }, ctx.emptyDoc())).diagnostics
      const mapped = issueMessage(issues.map((d) => ({
        paramKey: d.paramKey ?? null,
        code: d.code,
        severity: d.severity,
        message: d.message,
      })), 'pose')
      check('P3 缺姿态映射到 pose 字段红字', mapped !== null, issues)
    }
  }

  // ── 插入目标：空文档 ──
  {
    const fadeDef = findTemplate('clip.fade')
    check('P4 fade 定义存在', fadeDef !== null)
    if (fadeDef === null) return
    const options = targetOptions(fadeDef, { doc: ctx.emptyDoc(), playhead: 0, selectedClipKeys: [] })
    const atPlayhead = optionByKey(options, 'atPlayhead')
    const afterSelection = optionByKey(options, 'afterSelection')
    const newTrack = optionByKey(options, 'newTrack')
    check('P4 空文档播放头目标禁用', atPlayhead !== null && !atPlayhead.enabled, atPlayhead)
    check('P4 空文档播放头原因=无同类型轨', atPlayhead?.reasonCode === 'noMatchingTrack', atPlayhead?.reasonCode)
    check('P4 无选区目标禁用', afterSelection !== null && !afterSelection.enabled, afterSelection)
    check('P4 无选区原因=noSelection', afterSelection?.reasonCode === 'noSelection', afterSelection?.reasonCode)
    check('P4 新建轨道可用', newTrack !== null && newTrack.enabled, newTrack)
    check('P4 空文档不列出指定轨道', options.every((o) => o.mode !== 'atTime'), options)
  }

  // ── 插入目标：有同类型轨 ──
  {
    const fadeDef = findTemplate('clip.fade')
    if (fadeDef === null) return
    const doc = docWithClip(ctx, 'OVERLAY', 'ov1')
    const options = targetOptions(fadeDef, { doc, playhead: 0, selectedClipKeys: [] })
    const atPlayhead = optionByKey(options, 'atPlayhead')
    const trackOption = options.find((o) => o.mode === 'atTime')
    check('P5 有同类型轨播放头可用', atPlayhead?.enabled === true, atPlayhead)
    check('P5 列出指定轨道选项', trackOption !== undefined && trackOption.trackId === 'OVERLAY#0', trackOption)
  }

  // ── 插入目标：选区类型不符 ──
  {
    const fadeDef = findTemplate('clip.fade')
    if (fadeDef === null) return
    const doc = docWithClip(ctx, 'CAMERA', 'cam1')
    const options = targetOptions(fadeDef, { doc, playhead: 0, selectedClipKeys: ['cam1'] })
    const afterSelection = optionByKey(options, 'afterSelection')
    check('P5 选区类型不符禁用', afterSelection !== null && !afterSelection.enabled, afterSelection)
    check('P5 选区类型不符原因码', afterSelection?.reasonCode === 'selectionTypeMismatch', afterSelection?.reasonCode)
  }

  // ── 插入目标：脚本层 ──
  {
    const blank = findTemplate('script.blank')
    check('P6 blank 定义存在', blank !== null)
    if (blank === null) return
    const nonEmpty = docWithClip(ctx, 'CAMERA', 'cam1')
    const onNonEmpty = targetOptions(blank, { doc: nonEmpty, playhead: 0, selectedClipKeys: [] })
    const replaceOnNonEmpty = optionByKey(onNonEmpty, 'replaceEmpty')
    check('P6 非空文档替换禁用', replaceOnNonEmpty !== null && !replaceOnNonEmpty.enabled, replaceOnNonEmpty)
    check('P6 非空文档替换原因=docNonEmpty', replaceOnNonEmpty?.reasonCode === 'docNonEmpty', replaceOnNonEmpty?.reasonCode)
    check('P6 非空文档新建文档可用', optionByKey(onNonEmpty, 'newDocument')?.enabled === true)

    const onEmpty = targetOptions(blank, { doc: ctx.emptyDoc(), playhead: 0, selectedClipKeys: [] })
    check('P6 空文档替换可用', optionByKey(onEmpty, 'replaceEmpty')?.enabled === true)
    check('P6 空文档判定为真', docIsEmpty(ctx.emptyDoc()) === true)
    check('P6 非空文档判定为假', docIsEmpty(nonEmpty) === false)
  }

  // ── 摘要数字来自 StructureSummary ──
  {
    const plan = planGeneration(request(ctx, 'script.blank', { id: 'panel1', name: 'Panel', author: 'v' }, { mode: 'newDocument' }, ctx.emptyDoc()))
    check('P7 blank 计划成功', plan.ok, plan.diagnostics)
    const view = summaryView(plan.summary)
    check('P7 七类空轨', view.trackCount === 7, view.trackCount)
    check('P7 零片段', view.clipCount === 0, view.clipCount)
    check('P7 零路径', view.pathCount === 0, view.pathCount)
    check('P7 零触发器', view.triggerCount === 0, view.triggerCount)
    check('P7 标记新建文档', view.createsDocument === true, view.createsDocument)
  }

  // ── 就绪判定 ──
  {
    const fadeDef = findTemplate('clip.fade')
    if (fadeDef === null) return
    const badPlan = planGeneration(request(ctx, 'clip.fade', { duration: 0.01, mode: 'in', color: '#000000' }, { mode: 'newTrack' }, ctx.emptyDoc()))
    const badIssues = badPlan.diagnostics.map((d) => ({
      paramKey: d.paramKey ?? null, code: d.code, severity: d.severity, message: d.message,
    }))
    const badTarget = optionByKey(targetOptions(fadeDef, { doc: ctx.emptyDoc(), playhead: 0, selectedClipKeys: [] }), 'newTrack')
    check('P8 有错误时不可生成', readiness(badIssues, badTarget).enabled === false, readiness(badIssues, badTarget).reasons)

    const goodPlan = planGeneration(request(ctx, 'clip.fade', { duration: 2, mode: 'in', color: '#000000' }, { mode: 'newTrack' }, ctx.emptyDoc()))
    const goodIssues = goodPlan.diagnostics.map((d) => ({
      paramKey: d.paramKey ?? null, code: d.code, severity: d.severity, message: d.message,
    }))
    check('P8 参数目标就绪可生成', readiness(goodIssues, badTarget).enabled === true)
  }

  // ── 九槽可用性 ──
  {
    check('P9 服务缺失禁用', pickerAvailability(false, true, 3).reasonCode === 'serviceMissing')
    check('P9 无文档禁用', pickerAvailability(true, false, 3).reasonCode === 'noDoc')
    check('P9 槽位全空禁用', pickerAvailability(true, true, 0).reasonCode === 'slotsEmpty')
    check('P9 有服务有槽可用', pickerAvailability(true, true, 2).enabled === true)
  }

  // ── 应用：同一提交通道，成功一次事务 ──
  {
    const store = openStore(ctx)
    const counters = { plan: 0, commit: 0, selected: [] as string[] }
    const deps: ApplyDeps = {
      plan: (r) => { counters.plan += 1; return planGeneration(r) },
      commit: (cmd) => { counters.commit += 1; return store.commit(cmd) },
      select: (keys) => { counters.selected = [...keys] },
    }
    const plan = deps.plan(request(ctx, 'clip.fade', { duration: 2, mode: 'in', color: '#000000' }, { mode: 'newTrack' }, ctx.emptyDoc()))
    check('P10 fade 计划成功', plan.ok, plan.diagnostics)

    const outcome = runApply(deps, plan, false)
    check('P10 应用成功', outcome.ok, outcome.failures)
    check('P10 计划只调用一次（无第二生成通道）', counters.plan === 1, counters.plan)
    check('P10 提交恰好一次', counters.commit === 1, counters.commit)
    check('P10 未新建文档', outcome.newDocumentOpened === false, outcome.newDocumentOpened)
    check('P10 选中新片段', outcome.selectedClipKeys.length === 1, outcome.selectedClipKeys)
    check('P10 选择键回传一致', counters.selected.length === 1 && counters.selected[0] === outcome.selectedClipKeys[0], counters.selected)

    const doc = store.doc as ScriptDoc
    const overlay = trackOfType(doc, 'OVERLAY')
    check('P10 落地一条 OVERLAY 片段', overlay !== null && clipsOf(overlay).length === 1, tracksOf(doc).map((t) => clipsOf(t).length))
    check('P10 撤销一次全回退', store.undo() === true && clipsOf(trackOfType(store.doc as ScriptDoc, 'OVERLAY') ?? { clips: [] }).length === 0)
  }

  // ── 应用：计划失败零残留 ──
  {
    const store = openStore(ctx)
    const breath = findTemplate('clip.static_breath')
    if (breath === null) return
    const plan = planGeneration(request(ctx, breath.id, initialParams(breath), { mode: 'newTrack' }, ctx.emptyDoc()))
    check('P11 缺姿态计划失败', !plan.ok, plan.diagnostics)
    const counters = { commit: 0 }
    const deps: ApplyDeps = {
      plan: (r) => planGeneration(r),
      commit: (cmd) => { counters.commit += 1; return store.commit(cmd) },
      select: () => undefined,
    }
    const outcome = runApply(deps, plan, false)
    check('P11 应用失败', !outcome.ok, outcome.failures)
    check('P11 失败零提交', counters.commit === 0, counters.commit)
    check('P11 失败无选中', outcome.selectedClipKeys.length === 0, outcome.selectedClipKeys)
  }

  // ── 应用：脚本层新建文档先开文档再提交 ──
  {
    const store = openStore(ctx)
    const plan = planGeneration(request(ctx, 'script.blank', { id: 'panel2', name: 'Panel', author: 'v' }, { mode: 'newDocument' }, ctx.emptyDoc()))
    check('P12 blank 计划成功', plan.ok, plan.diagnostics)
    const counters = { commit: 0 }
    const deps: ApplyDeps = {
      plan: (r) => planGeneration(r),
      commit: (cmd) => { counters.commit += 1; return store.commit(cmd) },
      select: () => undefined,
    }
    const outcome = runApply(deps, plan, true)
    check('P12 应用成功', outcome.ok, outcome.failures)
    check('P12 标记已新建文档', outcome.newDocumentOpened === true, outcome.newDocumentOpened)
    check('P12 提交一次', counters.commit === 1, counters.commit)
  }
}
