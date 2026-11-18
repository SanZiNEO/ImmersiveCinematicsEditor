/**
 * 07 轮可视化 / 生成器自检切片（纯逻辑层，node 下可直跑）。
 *
 * 直跑：`node --experimental-strip-types src/features/paths/verify07Visual.ts`
 * 覆盖两份设计（07-07 生成器、07-10 预览）可自动化条目；断言走真 DocStore / catalog / commit，
 * 不调运行时、不写 authoring / 临时 paths。
 */
import { buildCatalog, indexCatalog, type CatalogIndex } from '../../core/schema/index.ts'
import { metaKeys } from '../../core/doc/keys.ts'
import { parseDoc } from '../../core/doc/parse.ts'
import { DocStore } from '../../core/doc/store.ts'
import type { JsonObject, ScriptDoc } from '../../core/doc/types.ts'
import { pathEntries, validatePathEntry } from '../../core/paths/collection.ts'
import { buildPathPreview } from '../../core/paths/preview.ts'
import type { PathIssue, PathPreviewModel } from '../../core/paths/types.ts'
import {
  buildApplyPayload,
  canApply,
  defaultWizardState,
  expressionCenterFromInput,
  impactBlocked,
  planWizard,
  readCenterContext,
  validateWizard,
  worldCenterFromExpression,
  type GeneratorApplyPayload,
  type WizardPlanView,
  type WizardState,
} from './generatorWizard.ts'
import {
  buildCanvasGeometry,
  fitView,
  type CanvasOptions,
} from './previewCanvas.ts'
import { checkCurveFixtures, fixtureSummary } from './curveFixtures.ts'

export type SliceCheck = (label: string, condition: boolean, actual?: unknown) => void

// ── 本地夹具（同构 verify-07.ts，不改 verify-07.ts）─────────────────────────

function cameraScript(objects: JsonObject): JsonObject {
  return {
    meta: { id: 'verify07Visual', name: 'Verify 07 Visual', author: '' },
    timeline: {
      tracks: [
        { type: 'CAMERA', clips: [{ id: 'c1', start_time: 0, duration: 2, objects }] },
      ],
    },
  }
}

function baseObjects(): JsonObject {
  return {
    'position.x': { keyframes: [{ time: 0, value: 1 }, { time: 1, value: 1 }] },
    'position.y': { keyframes: [{ time: 0, value: 0 }, { time: 1, value: 0 }] },
    'position.z': { keyframes: [{ time: 0, value: 0 }, { time: 1, value: 0 }] },
    yaw: { keyframes: [{ time: 0, value: 0 }, { time: 1, value: 45 }] },
    pitch: { keyframes: [{ time: 0, value: 0 }, { time: 1, value: 10 }] },
    roll: { value: 0 },
    orient: { value: 'manual' },
    'position_mode': { value: 'relative' },
    'position_space': { value: 'world' },
    'position_origin': { value: '' },
    'facing_source': { value: 'auto' },
  }
}

function openStore(catalog: CatalogIndex, raw: JsonObject): { store: DocStore; clipKey: string; doc: ScriptDoc } {
  const keys = metaKeys(catalog)
  const parsed = parseDoc(raw, { metaKeys: keys })
  if (!parsed.ok) {
    throw new Error(`fixture parse failed: ${JSON.stringify(parsed.issues)}`)
  }
  const store = new DocStore({ catalog, metaKeys: keys })
  store.open(parsed.doc, 'verify07-visual.json')
  const handle = store.registry.handles()[0]
  return { store, clipKey: handle.key, doc: parsed.doc }
}

function validState(): WizardState {
  return defaultWizardState('c1', 0, 1)
}

function near(actual: number, expected: number, epsilon = 1e-9): boolean {
  return Math.abs(actual - expected) <= epsilon
}

function clipObjects(store: DocStore): JsonObject {
  const tracks = store.doc!.timeline.tracks as unknown as JsonObject[]
  const clips = tracks[0].clips as unknown as JsonObject[]
  return clips[0].objects as JsonObject
}

function positionTimes(objects: JsonObject, path: string): number[] {
  const raw = objects[path]
  if (!JsonObjectIs(raw) || !Array.isArray(raw.keyframes)) {
    return []
  }
  return raw.keyframes.map((frame) => (JsonObjectIs(frame) && typeof frame.time === 'number' ? frame.time : NaN))
}

function JsonObjectIs(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// ── 切片主体 ────────────────────────────────────────────────────────────────

export function runVisualChecks(check: SliceCheck): void {
  const catalog = indexCatalog(buildCatalog('verify-07-visual'))

  // ── 11 组 golden fixture ─────────────────────────────────────────────────
  {
    const results = checkCurveFixtures()
    const summary = fixtureSummary(results)
    check('11 组 golden fixture 全部通过', summary.fail === 0, summary)
    check('fixture 采样点数量 = 66（11 类 × 6 点）', results.length === 66, results.length)
  }

  // ── 0→90 Bezier：控制点长度 = (4/3)tan(Δ/4)·r，端点落在圆上 ────────────────
  {
    const { doc } = openStore(catalog, cameraScript(baseObjects()))
    const state = validState()
    state.shape = 'circle'
    state.radius = 4
    state.startAngle = 0
    state.endAngle = 90
    const view = planWizard(doc, state, null)
    check('90° Bezier 计划无 issue', view.issues.length === 0, view.issues)
    check('90° Bezier 一段', view.plan !== null && view.plan.paths.length === 1, view.plan?.paths.length)
    if (view.plan !== null) {
      const geometry = view.plan.paths[0].geometry as JsonObject
      const controls = geometry.control_points as Array<{ dx: number; dy: number; dz: number }>
      // 90° 段三次逼近：控制臂长 = r·(4/3)·tan(段角/4)（段角 π/4，核心 emits 的常数）。
      const alpha = (4 / 3) * Math.tan(Math.PI / 8)
      const expectedLength = alpha * state.radius
      const controlLength = Math.hypot(controls[0].dx, controls[0].dy, controls[0].dz)
      check('控制点长度符合 tan(段角/4) 逼近', near(controlLength, expectedLength, 1e-6), { controlLength, expectedLength })
      const first = view.plan.keyTimes[0].point
      const last = view.plan.keyTimes[view.plan.keyTimes.length - 1].point
      check('首端点落在圆上', near(Math.hypot(first[0], first[1], first[2]), state.radius, 1e-6), first)
      check('末端点落在圆上', near(Math.hypot(last[0], last[1], last[2]), state.radius, 1e-6), last)
    }
  }

  // ── 0→360 自动四段闭合，径向误差 ≤ 半径千分之一 ────────────────────────────
  {
    const { doc } = openStore(catalog, cameraScript(baseObjects()))
    const state = validState()
    state.shape = 'circle'
    state.radius = 1
    state.startAngle = 0
    state.endAngle = 360
    state.timeMode = 'replace'
    const view = planWizard(doc, state, null)
    check('360° 自动四段', view.plan !== null && view.plan.paths.length === 4, view.plan?.paths.length)
    check('360° 径向误差 ≤ 半径千分之一', view.plan !== null && view.plan.radialErrorRatio <= 0.001, view.plan?.radialErrorRatio)
    if (view.plan !== null) {
      const first = view.plan.keyTimes[0].point
      const last = view.plan.keyTimes[view.plan.keyTimes.length - 1].point
      check('360° 首尾闭合', near(first[0], last[0], 1e-9) && near(first[1], last[1], 1e-9) && near(first[2], last[2], 1e-9), { first, last })
    }
  }

  // ── 精确模式：一条 arc，本地语义校验通过 ─────────────────────────────────
  {
    const { doc } = openStore(catalog, cameraScript(baseObjects()))
    const state = validState()
    state.mode = 'exact'
    state.startAngle = 0
    state.endAngle = 90
    const view = planWizard(doc, state, null)
    check('精确模式计划无 issue', view.issues.length === 0, view.issues)
    check('精确模式一条 arc', view.plan !== null && view.plan.paths.length === 1
      && (view.plan.paths[0].geometry as JsonObject).type === 'arc', view.plan?.paths)
    if (view.plan !== null) {
      const entry = view.plan.paths[0]
      const issues = validatePathEntry(doc, entry, 0)
      check('精确 arc 本地语义校验通过', issues.length === 0, issues)
    }
  }

  // ── 顺时针：Δ 为负，控制点反向 ───────────────────────────────────────────
  {
    const { doc } = openStore(catalog, cameraScript(baseObjects()))
    const ccw = planWizard(doc, validState(), null)
    const cwState = validState()
    cwState.clockwise = true
    const cw = planWizard(doc, cwState, null)
    check('顺时针计划无 issue', cw.issues.length === 0, cw.issues)
    const cwExactState = validState()
    cwExactState.clockwise = true
    cwExactState.mode = 'exact'
    const cwExact = planWizard(doc, cwExactState, null)
    if (cwExact.plan !== null) {
      const arc = cwExact.plan.paths[0].geometry as JsonObject
      check('顺时针 Δ 为负（end_angle < start_angle）', arc.end_angle === -90, arc)
    }
    if (ccw.plan !== null && cw.plan !== null) {
      const ccwControl = (ccw.plan.paths[0].geometry as JsonObject).control_points as Array<{ dz: number }>
      const cwControl = (cw.plan.paths[0].geometry as JsonObject).control_points as Array<{ dz: number }>
      check('顺时针控制点反向', ccwControl[0].dz * cwControl[0].dz < 0, { ccw: ccwControl[0], cw: cwControl[0] })
    }
  }

  // ── 三维平面（法向非竖直）：平面内垂直分量恒定（残差 ≈ 0）────────────────
  {
    const { doc } = openStore(catalog, cameraScript(baseObjects()))
    const state = validState()
    state.normal = { x: 1, y: 0, z: 0 }
    state.referenceAxis = { x: 0, y: 1, z: 0 }
    const view = planWizard(doc, state, null)
    check('三维平面计划无 issue', view.issues.length === 0, view.issues)
    if (view.plan !== null) {
      const normal = state.normal
      const residual = Math.max(...view.plan.preview.map((sample) => Math.abs(
        sample.point[0] * normal.x + sample.point[1] * normal.y + sample.point[2] * normal.z,
      )))
      check('三维平面法向残差 ≈ 0', residual <= 1e-9, residual)
    }
  }

  // ── 两种时间策略：保留节点 / 替换区间节点 ────────────────────────────────
  {
    // keep-nodes：相邻区间 0→0.5，已有 0.5 节点作为边界保留。
    const keep = openStore(catalog, cameraScript(baseObjects()))
    keep.store.commit({
      kind: 'object.editKeyframes',
      clipKey: keep.clipKey,
      ops: [
        { op: 'add', path: 'position.x', time: 0.5, value: 1 },
        { op: 'add', path: 'position.y', time: 0.5, value: 0 },
        { op: 'add', path: 'position.z', time: 0.5, value: 0 },
      ],
    })
    const keepState = validState()
    keepState.to = 0.5
    keepState.timeMode = 'keep-nodes'
    const keepView = planWizard(keep.doc, keepState, null)
    check('keep-nodes 计划保留 0.5 节点', keepView.plan !== null
      && keepView.plan.keyTimes.some((entry) => near(entry.time, 0.5)), keepView.plan?.keyTimes)
    const keepPayload = buildApplyPayload(keep.doc, keepState, keepView, false, keep.clipKey)
    const keepCommand = keepPayload.commands[0]
    const keepCommit = keepCommand === undefined ? { ok: false, error: 'no command' } : keep.store.commit(keepCommand)
    check('keep-nodes 提交成功', keepCommit.ok, keepCommit)
    const keepTimes = positionTimes(clipObjects(keep.store), 'position.x')
    check('keep-nodes 落地后 0.5 帧仍在', keepTimes.some((time) => near(time, 0.5)), keepTimes)

    // replace：相邻区间 0→0.5，边界时间均匀重建；端点帧受保护不删。
    const replace = openStore(catalog, cameraScript(baseObjects()))
    replace.store.commit({
      kind: 'object.editKeyframes',
      clipKey: replace.clipKey,
      ops: [
        { op: 'add', path: 'position.x', time: 0.5, value: 1 },
        { op: 'add', path: 'position.y', time: 0.5, value: 0 },
        { op: 'add', path: 'position.z', time: 0.5, value: 0 },
      ],
    })
    const replaceState = validState()
    replaceState.to = 0.5
    replaceState.timeMode = 'replace'
    const replaceView = planWizard(replace.doc, replaceState, null)
    check('replace 计划边界均匀重建', replaceView.plan !== null
      && replaceView.plan.keyTimes.length === 2
      && near(replaceView.plan.keyTimes[0].time, 0) && near(replaceView.plan.keyTimes[1].time, 0.5),
    replaceView.plan?.keyTimes)
    const replacePayload = buildApplyPayload(replace.doc, replaceState, replaceView, false, replace.clipKey)
    const replaceCommand = replacePayload.commands[0]
    const replaceCommit = replaceCommand === undefined ? { ok: false, error: 'no command' } : replace.store.commit(replaceCommand)
    check('replace 提交成功', replaceCommit.ok, replaceCommit)
    const replaceTimes = positionTimes(clipObjects(replace.store), 'position.x')
    check('replace 端点帧 0.5 受保护保留', replaceTimes.some((time) => near(time, 0.5)), replaceTimes)
  }

  // ── 影响面：先列出再决定；未确认阻断；确认后才进 removeIds ───────────────
  {
    const { doc, clipKey } = openStore(catalog, cameraScript(baseObjects()))
    const state = validState()
    const view = planWizard(doc, state, null)
    const manual: WizardPlanView = {
      ...view,
      plan: view.plan === null ? null : { ...view.plan, impactedPaths: ['p_x'] },
      diff: { added: 1, replaced: 0, deleted: 1, impacted: 1, replacedPathIds: [], impactedPaths: ['p_x'] },
    }
    check('受影响路径未确认时阻断', impactBlocked(manual, false) && !canApply(manual, false))
    check('受影响路径已确认后放行', !impactBlocked(manual, true) && canApply(manual, true))
    const withoutDelete = buildApplyPayload(doc, state, manual, false, clipKey)
    const withDelete = buildApplyPayload(doc, state, manual, true, clipKey)
    const withoutIds = writeBatchRemoveIds(withoutDelete)
    const withIds = writeBatchRemoveIds(withDelete)
    check('未确认删除时 impacted 不进 removeIds', !withoutIds.includes('p_x'), withoutIds)
    check('确认删除后 impacted 进 removeIds', withIds.includes('p_x'), withIds)
  }

  // ── 重新生成：diff 替换，旧 id 不复用；一次撤销回退 ───────────────────────
  {
    const { store, doc, clipKey } = openStore(catalog, cameraScript(baseObjects()))
    const firstState = validState()
    firstState.endAngle = 360
    firstState.timeMode = 'replace'
    const firstView = planWizard(doc, firstState, null)
    const firstPayload = buildApplyPayload(doc, firstState, firstView, false, clipKey)
    const firstCommand = firstPayload.commands[0]
    if (firstCommand !== undefined) {
      store.commit(firstCommand)
    }
    const firstIds = pathEntries(store.doc!).map((entry) => entry.id)
    check('首次生成 4 条路径', firstIds.length === 4, firstIds)

    const secondState = validState()
    secondState.from = 0
    secondState.to = 0.25
    secondState.mode = 'exact'
    const secondView = planWizard(store.doc!, secondState, null)
    check('重新生成列出被替换旧路径', secondView.diff.replacedPathIds.length === 1
      && secondView.diff.replacedPathIds[0] === firstIds[0], secondView.diff.replacedPathIds)
    const secondPayload = buildApplyPayload(store.doc!, secondState, secondView, false, clipKey)
    const secondCommand = secondPayload.commands[0]
    const secondCommit = secondCommand === undefined ? { ok: false, error: 'no command' } : store.commit(secondCommand)
    check('重新生成提交成功', secondCommit.ok, secondCommit)
    const secondIds = pathEntries(store.doc!).map((entry) => entry.id)
    const addedIds = secondIds.filter((id) => !firstIds.includes(id))
    check('新 id 不复用旧 id', addedIds.length === 1 && !firstIds.includes(addedIds[0]), { firstIds, secondIds, addedIds })
    store.undo()
    const restoredIds = pathEntries(store.doc!).map((entry) => entry.id)
    check('一次撤销回退到旧路径', restoredIds.join() === firstIds.join(), restoredIds)
  }

  // ── 非法输入本地拦下并禁用应用 ───────────────────────────────────────────
  {
    const { doc } = openStore(catalog, cameraScript(baseObjects()))
    const cases: Array<{ label: string; mutate: (state: WizardState) => void }> = [
      { label: '半径 ≤ 0', mutate: (state) => { state.radius = 0 } },
      { label: '起止角相等', mutate: (state) => { state.startAngle = 90; state.endAngle = 90 } },
      { label: '|Δ| > 360', mutate: (state) => { state.endAngle = 450 } },
      { label: '法向与参考轴平行', mutate: (state) => { state.normal = { x: 1, y: 0, z: 0 }; state.referenceAxis = { x: 2, y: 0, z: 0 } } },
      { label: '分段数非法', mutate: (state) => { state.segments = 0 } },
    ]
    for (const testCase of cases) {
      const state = validState()
      testCase.mutate(state)
      const issues = validateWizard(state, null)
      const view = planWizard(doc, state, null)
      check(`非法输入拦截：${testCase.label}`, issues.length > 0 && view.issues.length > 0 && !canApply(view, true), issues)
    }
  }

  // ── 圆心空间换算：relative+world 坐标原点可世界输入；base 局部轴 ─────────
  {
    const objects = {
      ...baseObjects(),
      'position_mode': { value: 'relative' },
      'position_space': { value: 'world' },
      'position_origin': { value: 'coordinate' },
      'position_origin_x': { value: 1 },
      'position_origin_y': { value: 2 },
      'position_origin_z': { value: 3 },
    }
    const { doc } = openStore(catalog, cameraScript(objects))
    const ctx = readCenterContext(doc, 'c1')
    check('coordinate 原点允许世界输入', ctx !== null && ctx.worldInputAllowed, ctx)
    if (ctx !== null) {
      const world = { x: 4, y: 6, z: 9 }
      const expression = expressionCenterFromInput(world, ctx, true)
      check('世界输入减原点写片段坐标', near(expression.x, 3) && near(expression.y, 4) && near(expression.z, 6), expression)
      const back = worldCenterFromExpression(expression, ctx)
      check('片段坐标加原点回世界', back !== null && near(back.x, 4) && near(back.y, 6) && near(back.z, 9), back)
    }
    const baseObjectsDoc = openStore(catalog, cameraScript({
      ...baseObjects(),
      'position_space': { value: 'base' },
    }))
    const baseCtx = readCenterContext(baseObjectsDoc.doc, 'c1')
    check('base 轴标签 fwd/up/right', baseCtx !== null && baseCtx.axisLabels.join('/') === 'fwd/up/right', baseCtx?.axisLabels)
    check('base 不提供世界换算', baseCtx !== null && worldCenterFromExpression({ x: 1, y: 2, z: 3 }, baseCtx) === null)
  }

  // ── 预览画布：2D 投影 / 单轴一维 / 未知类型不出曲线 ──────────────────────
  {
    const model = sampleModel()
    const options: CanvasOptions = { pair: 'xz', space: 'world', showSamples: true, showTangents: true }
    const twoD = buildCanvasGeometry(model, ['x', 'z'], options)
    check('三轴条目走 2D 投影', twoD.mode === '2d' && twoD.curve.length === 2, twoD.curve.length)
    check('2D 轴标签 x/z', twoD.horizontalAxis === 'x' && twoD.verticalAxis === 'z', { h: twoD.horizontalAxis, v: twoD.verticalAxis })
    const oneD = buildCanvasGeometry(model, ['x'], options)
    check('单轴条目走一维图', oneD.mode === '1d' && oneD.horizontalAxis === 'u', oneD)
    const unknownModel: PathPreviewModel = {
      ...model,
      issues: [issue('geometry.type', '未知曲线类型 nope')],
      samples: [],
    }
    const unknown = buildCanvasGeometry(unknownModel, ['x', 'y', 'z'], options)
    check('未知类型不出曲线', unknown.unknownType && unknown.curve.length === 0, unknown.warnings)
    const transform = fitView(twoD.bounds, 320, 180, 16)
    check('适配视图缩放为正', transform.scale > 0, transform)
  }

  // ── FREE 端点偏差与 START 绑定 ──────────────────────────────────────────
  {
    const { doc } = openStore(catalog, cameraScript(baseObjects()))
    storeBatch(doc, [
      {
        id: 'p_clothoid', clip: 'c1', from: 0, to: 1, axes: ['x', 'y', 'z'],
        geometry: { type: 'clothoid', start_curvature: 0, end_curvature: 0.5, length: 4 },
      },
      {
        id: 'p_fourier', clip: 'c1', from: 0, to: 1, axes: ['x', 'y', 'z'],
        geometry: {
          type: 'fourier', period: 1, periodic: true,
          a0: { x: 0, y: 0, z: 0 },
          cos: [{ x: 0.3, y: 0, z: 0 }], sin: [{ x: 0, y: 0.2, z: 0 }],
        },
      },
    ])
    const clothoid = buildPathPreview(doc, 0)
    const fourier = buildPathPreview(doc, 1)
    check('clothoid 起点锚定（START）', clothoid !== null && clothoid.anchor === 'START', clothoid?.anchor)
    check('clothoid 起点偏差 ≈ 0', clothoid !== null && near(clothoid.startDeviation, 0, 1e-6), clothoid?.startDeviation)
    check('周期 fourier 几何自由（FREE）', fourier !== null && fourier.anchor === 'FREE', fourier?.anchor)
    check('FREE 暴露端点偏差数值', fourier !== null && typeof fourier.endDeviation === 'number', fourier?.endDeviation)
  }
}

// ── 辅助 ────────────────────────────────────────────────────────────────────

function writeBatchRemoveIds(payload: GeneratorApplyPayload): string[] {
  const compound = payload.commands[0]
  if (compound === undefined || compound.kind !== 'compound') {
    return []
  }
  const batch = compound.commands.find((command) => command.kind === 'path.writeBatch')
  return batch === undefined || batch.kind !== 'path.writeBatch' ? [] : [...batch.removeIds]
}

function storeBatch(doc: ScriptDoc, entries: JsonObject[]): void {
  const root = doc.root as JsonObject
  const paths = Array.isArray(root.paths) ? root.paths as JsonObject[] : []
  for (const entry of entries) {
    paths.push(entry)
  }
  root.paths = paths
}

function sampleModel(): PathPreviewModel {
  return {
    pathId: 'p_1',
    anchor: 'ENDPOINTS',
    anchorLabel: '端点绑定',
    from: [0, 0, 0],
    to: [1, 0, 0],
    geometryStart: [0, 0, 0],
    geometryEnd: [1, 0, 0],
    samples: [
      { u: 0, point: [0, 0, 0], tangent: null },
      { u: 1, point: [1, 0, 0], tangent: null },
    ],
    controlPolygon: null,
    startDeviation: 0,
    endDeviation: 0,
    timingCurve: [{ u: 0, s: 0 }, { u: 1, s: 1 }],
    warnings: [],
    issues: [],
  }
}

function issue(field: string, message: string): PathIssue {
  return {
    id: `p_1:${field}:L25`,
    pathId: 'p_1',
    jsonPath: field,
    field,
    code: 'L25',
    severity: 'error',
    message,
  }
}

// ── 直跑段 ──────────────────────────────────────────────────────────────────

const directRun = process.argv[1] !== undefined && process.argv[1].endsWith('verify07Visual.ts')

if (directRun) {
  let ok = 0
  let fail = 0
  const check: SliceCheck = (label, condition, actual) => {
    if (condition) {
      ok += 1
      console.log(`ok   ${label}`)
      return
    }
    fail += 1
    console.log(`FAIL ${label}: ${actual === undefined ? '' : JSON.stringify(actual)}`)
  }
  runVisualChecks(check)
  console.log(`summary ok=${ok} fail=${fail}`)
  if (fail > 0) {
    process.exitCode = 1
  }
}
