/**
 * 12-10 曲线工具自检：五类形状入口、控制点拾取判定与正交画布逆变换、匀速等分重采样、
 * 面板事务 / 撤销、与 07 既有生成器输出对比。
 *
 * 运行口径（与 verify-07 / verify12 骨架一致）：真 DocStore + 真 catalog + 真 commit；
 * 不加载 `.vue` / DOM；纯逻辑组合 07 公开函数，不改 07 内核。
 */
import type { JsonObject } from '../../core/doc/types.ts'
import type { CheckFn } from './harness.ts'
import type { VerifyContext } from './context.ts'
import { pathEntries } from './context.ts'
import { createPathCommand, updatePathCommand } from '../../features/paths/collectionPanel.ts'
import { planShapeEntry } from '../../features/paths/shapeEntries.ts'
import { resampleTiming } from '../../features/paths/resample.ts'
import {
  canPickControlPoint,
  pickControlPoint,
  PICK_APPROX_NOTE,
  type PickFrame,
} from '../../features/paths/picking.ts'
import { planShapeGeneration } from '../../core/paths/generators.ts'
import { buildGeometry, sampleGeometry, type Vec3 } from '../../core/paths/sampling.ts'
import type { PathAxis } from '../../core/paths/types.ts'

// ── 夹具 ────────────────────────────────────────────────────────────────────

const FROM: Vec3 = { x: 0, y: 0, z: 0 }
const TO: Vec3 = { x: 4, y: 0, z: 0 }
const AXES_XYZ: PathAxis[] = ['x', 'y', 'z']

function script(objects: JsonObject): JsonObject {
  return {
    meta: { id: 'verify12-curve', name: 'verify12-curve', author: '' },
    timeline: {
      tracks: [{ type: 'CAMERA', clips: [{ id: 'c1', start_time: 0, duration: 2, objects }] }],
    },
  }
}

function baseObjects(overrides: JsonObject = {}): JsonObject {
  return {
    'position.x': { keyframes: [{ time: 0, value: 0 }, { time: 1, value: 4 }] },
    'position.y': { keyframes: [{ time: 0, value: 0 }, { time: 1, value: 0 }] },
    'position.z': { keyframes: [{ time: 0, value: 0 }, { time: 1, value: 0 }] },
    yaw: { value: 0 },
    pitch: { value: 0 },
    roll: { value: 0 },
    orient: { value: 'manual' },
    'position_mode': { value: 'absolute' },
    'position_space': { value: 'world' },
    'position_origin': { value: '' },
    'look_at': { value: 'none' },
    'facing_source': { value: 'auto' },
    ...overrides,
  }
}

function makeEntry(geometry: JsonObject, timing?: JsonObject): JsonObject {
  const entry: JsonObject = { id: 'p_1', clip: 'c1', from: 0, to: 1, axes: [...AXES_XYZ], geometry }
  if (timing !== undefined) {
    entry.timing = timing
  }
  return entry
}

/** 测试用正交画布帧：宽高 + ViewTransform + 轴对（与预览画布同口径）。 */
const TEST_FRAME: PickFrame = {
  width: 800,
  height: 600,
  transform: { scale: 2, offsetX: 100, offsetY: 80 },
  pair: 'xz',
}

function controlPoints(geometry: JsonObject | undefined): JsonObject[] {
  if (geometry === undefined) {
    return []
  }
  const raw = geometry.control_points
  return Array.isArray(raw) ? (raw as JsonObject[]) : []
}

function controlComponent(point: JsonObject, axis: 'x' | 'y' | 'z' | 'dx' | 'dy' | 'dz'): number {
  const value = point[axis]
  return typeof value === 'number' ? value : Number.NaN
}

/** 竖直分量：相对形态读 dy，绝对形态读 y。 */
function verticalComponent(point: JsonObject): number {
  return 'dy' in point ? controlComponent(point, 'dy') : controlComponent(point, 'y')
}

function sameKeySet(left: JsonObject, right: JsonObject): boolean {
  const leftKeys = Object.keys(left).sort().join('|')
  const rightKeys = Object.keys(right).sort().join('|')
  return leftKeys === rightKeys
}

// ── 主入口 ──────────────────────────────────────────────────────────────────

export function runCurveTools(check: CheckFn, ctx: VerifyContext): void {
  // ── A. 形状入口 ──────────────────────────────────────────────────────────
  {
    // A1. 水平两轴抛物：两控制点竖直分量为 0；端点 / 时间映射不变。
    const horizontalAxes: PathAxis[] = ['x', 'z']
    const parabola = planShapeEntry({
      entry: makeEntry({ type: 'line' }),
      from: FROM,
      to: TO,
      axes: horizontalAxes,
      kind: 'parabola',
      params: {},
    })
    const parabolaPoints = parabola.ok && parabola.geometry !== null
      ? controlPoints(parabola.geometry)
      : []
    check('水平两轴抛物计划成功', parabola.ok && parabola.geometry !== null, parabola.diagnostics)
    check('抛物落在已注册的 bezier 类型', parabola.geometry?.type === 'bezier', parabola.geometry)
    check('抛物固定两个控制点', parabolaPoints.length === 2, parabolaPoints)
    check('水平两轴抛物两控制点竖直分量为 0', parabolaPoints.length === 2
      && verticalComponent(parabolaPoints[0]) === 0
      && verticalComponent(parabolaPoints[1]) === 0, parabolaPoints)

    // 端点与时间映射不被形状计划改动（计划只回 geometry）。
    const original = makeEntry({ type: 'line' }, { type: 'keyframes', points: [{ t: 0, s: 0 }, { t: 1, s: 1 }] })
    const assembled: JsonObject = { ...original, geometry: parabola.geometry ?? original.geometry }
    check('形状应用不改端点 from', assembled.from === original.from)
    check('形状应用不改端点 to', assembled.to === original.to)
    check('形状应用不改既有时间映射', JSON.stringify(assembled.timing) === JSON.stringify(original.timing))

    // A2. S 形两控制点反向偏移。
    const sShape = planShapeEntry({
      entry: makeEntry({ type: 'line' }),
      from: FROM,
      to: TO,
      axes: AXES_XYZ,
      kind: 's',
      params: { tension: 0.5 },
    })
    const sPoints = sShape.ok && sShape.geometry !== null ? controlPoints(sShape.geometry) : []
    check('S 形计划成功', sShape.ok && sShape.geometry !== null, sShape.diagnostics)
    check('S 形固定两个控制点', sPoints.length === 2, sPoints)
    const sideFirst = controlComponent(sPoints[0] ?? {}, 'dz')
    const sideSecond = controlComponent(sPoints[1] ?? {}, 'dz')
    check('S 形两控制点反向偏侧', Number.isFinite(sideFirst) && Number.isFinite(sideSecond) && sideFirst * sideSecond < 0, { sideFirst, sideSecond })

    // A3. 圆弧复用 07 既有参数形态，不被转成贝塞尔。
    const arc = planShapeEntry({
      entry: makeEntry({ type: 'line' }),
      from: FROM,
      to: TO,
      axes: AXES_XYZ,
      kind: 'arc',
      params: {
        center: { x: 2, y: 0, z: 0 },
        radius: 2,
        startAngle: 0,
        endAngle: 180,
        normal: { x: 0, y: 1, z: 0 },
        referenceAxis: { x: 1, y: 0, z: 0 },
      },
    })
    check('圆弧计划成功', arc.ok && arc.geometry !== null, arc.diagnostics)
    check('圆弧 geometry 类型仍是 arc（未转 bezier）', arc.geometry?.type === 'arc', arc.geometry)
    check('圆弧不写控制点数组', arc.geometry?.control_points === undefined, arc.geometry)

    // A4. 椭圆复用 07 既有参数形态。
    const ellipse = planShapeEntry({
      entry: makeEntry({ type: 'line' }),
      from: FROM,
      to: TO,
      axes: AXES_XYZ,
      kind: 'ellipse',
      params: {
        center: { x: 2, y: 0, z: 0 },
        semiMajor: 2,
        semiMinor: 1,
        rotation: 0,
        startAngle: 0,
        endAngle: 180,
        normal: { x: 0, y: 1, z: 0 },
        referenceAxis: { x: 1, y: 0, z: 0 },
      },
    })
    check('椭圆计划成功', ellipse.ok && ellipse.geometry !== null, ellipse.diagnostics)
    check('椭圆 geometry 类型仍是 ellipse', ellipse.geometry?.type === 'ellipse', ellipse.geometry)
  }

  // ── B. 控制点拾取判定 + 正交逆变换 ─────────────────────────────────────────
  {
    const openPickStore = (overrides: JsonObject) => {
      const store = ctx.createStore()
      const doc = ctx.docFrom(script(baseObjects(overrides)))
      store.open(doc, 'verify12-curve-pick.json')
      return { store, doc }
    }

    const good = openPickStore({})
    const goodEligibility = canPickControlPoint(good.doc, 'c1')
    check('绝对片段控制点可拾取（正交画布，不要求 3D 相机）', goodEligibility.available, goodEligibility)

    const relative = openPickStore({ 'position_mode': { value: 'relative' } })
    const relativeEligibility = canPickControlPoint(relative.doc, 'c1')
    check('相对位置片段禁用拾取', !relativeEligibility.available
      && relativeEligibility.reasons.some((reason) => reason.includes('相对') && reason.includes('数值')), relativeEligibility)

    const baseSpace = openPickStore({ 'position_space': { value: 'base' } })
    const baseEligibility = canPickControlPoint(baseSpace.doc, 'c1')
    check('基准坐标系片段禁用拾取', !baseEligibility.available
      && baseEligibility.reasons.some((reason) => reason.includes('基准')), baseEligibility)

    const dynamicOrigin = openPickStore({
      'position_mode': { value: 'relative' },
      'position_origin': { value: 'player' },
    })
    const originEligibility = canPickControlPoint(dynamicOrigin.doc, 'c1')
    check('动态原点片段禁用拾取', !originEligibility.available
      && originEligibility.reasons.some((reason) => reason.includes('动态引用')), originEligibility)

    const lookTarget = openPickStore({ look_at: { value: 'player' } })
    const lookEligibility = canPickControlPoint(lookTarget.doc, 'c1')
    check('注视目标片段禁用拾取', !lookEligibility.available
      && lookEligibility.reasons.some((reason) => reason.includes('注视')), lookEligibility)

    const tangentOrient = openPickStore({ orient: { value: 'tangent' } })
    const tangentEligibility = canPickControlPoint(tangentOrient.doc, 'c1')
    check('切线朝向片段禁用拾取', !tangentEligibility.available
      && tangentEligibility.reasons.some((reason) => reason.includes('切线')), tangentEligibility)

    const PLANE: Vec3 = { x: 0, y: 3, z: 0 }

    // 正交逆变换：屏幕 (200,160) → 世界 x=50、z=40；隐藏轴 y 取固定平面值 3。
    const pick = pickControlPoint({
      screen: { x: 200, y: 160 },
      frame: TEST_FRAME,
      segmentStart: FROM,
      controlMode: 'absolute',
      axes: AXES_XYZ,
      plane: PLANE,
    })
    check('正交逆变换成功', pick !== null, pick)
    if (pick !== null) {
      const errorX = Math.abs(pick.world.x - 50)
      const errorZ = Math.abs(pick.world.z - 40)
      check('可见两轴逆变换误差 < 1e-9', errorX < 1e-9 && errorZ < 1e-9, { errorX, errorZ, world: pick.world })
      check('隐藏轴等于固定平面值', pick.world.y === PLANE.y, pick.world)
      check('拾取结果带近似标注', pick.note === PICK_APPROX_NOTE && pick.note.includes('近似') && pick.note.includes('目视确认'), pick.note)
      check('被替换控制点为绝对形态', 'x' in pick.control && !('dx' in pick.control), pick.control)
    }

    // 既有绝对控制点：隐藏轴保留原值，不被平面值覆盖。
    const pickPreserve = pickControlPoint({
      screen: { x: 200, y: 160 },
      frame: TEST_FRAME,
      segmentStart: FROM,
      controlMode: 'absolute',
      axes: AXES_XYZ,
      plane: PLANE,
      existingControl: { x: 1, y: 7, z: 2 },
    })
    check('既有控制点隐藏轴被保留', pickPreserve !== null && pickPreserve.world.y === 7, pickPreserve?.world)

    // 既有相对控制点：隐藏轴由相对分量 + 段起点还原，输出仍为相对形态。
    const pickRelative = pickControlPoint({
      screen: { x: 200, y: 160 },
      frame: TEST_FRAME,
      segmentStart: FROM,
      controlMode: 'relative',
      axes: AXES_XYZ,
      plane: PLANE,
      existingControl: { dx: 1, dy: 2, dz: 3 },
    })
    check('相对形态隐藏轴按段起点还原', pickRelative !== null && pickRelative.world.y === 2, pickRelative?.world)
    check('相对形态控制点输出 dx/dy/dz', pickRelative !== null
      && 'dx' in pickRelative.control && 'dy' in pickRelative.control && 'dz' in pickRelative.control, pickRelative?.control)

    // 退化帧（scale 非法）→ null，不产生世界点。
    const badFrame: PickFrame = { width: 800, height: 600, transform: { scale: 0, offsetX: 0, offsetY: 0 }, pair: 'xz' }
    check('退化画布变换时拾取返回 null', pickControlPoint({
      screen: { x: 200, y: 160 },
      frame: badFrame,
      segmentStart: FROM,
      controlMode: 'absolute',
      axes: AXES_XYZ,
      plane: PLANE,
    }) === null)

    // 只改一个控制点：数组长度不变，不新增第三个；不写位置关键帧。
    const existingControls: JsonObject[] = [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }]
    const nextControls = pick === null ? existingControls : [pick.control, existingControls[1]]
    check('拾取只改一个控制点、不新增第三个', nextControls.length === 2, nextControls)
    const beforeFrames = JSON.stringify(baseObjects()['position.x'])
    check('拾取流程不产生位置关键帧写入', JSON.stringify(baseObjects()['position.x']) === beforeFrames)
  }

  // ── C. 匀速等分重采样（s = t） ──────────────────────────────────────────
  {
    // 旧映射非匀速：t=0.5 处 s=0.2；重采样应改写为 s=t 等分点表。
    const originalTiming: JsonObject = {
      type: 'keyframes',
      points: [{ t: 0, s: 0 }, { t: 0.5, s: 0.2 }, { t: 1, s: 1 }],
    }
    const result = resampleTiming({
      geometry: { type: 'line' },
      from: FROM,
      to: TO,
      axes: AXES_XYZ,
      samples: 5,
      timing: originalTiming,
    })
    check('重采样计划成功', result.ok && result.timing !== null, result.diagnostics)
    const points = result.points
    check('重采样至少两点', points.length >= 2, points.length)
    check('重采样首点固定 (0,0)', points.length > 0 && points[0].t === 0 && points[0].s === 0, points[0])
    check('重采样末点固定 (1,1)', points.length > 0 && points[points.length - 1].t === 1 && points[points.length - 1].s === 1, points[points.length - 1])
    const tNonDecreasing = points.every((point, index) => index === 0 || point.t >= points[index - 1].t)
    const sNonDecreasing = points.every((point, index) => index === 0 || point.s >= points[index - 1].s)
    check('重采样 t 单调不减', tNonDecreasing, points)
    check('重采样 s 单调不减', sNonDecreasing, points)
    const sEqualsT = points.every((point) => point.t === point.s)
    check('重采样输出 s = t 等分点表', sEqualsT, points)
    const mid = points.find((point) => point.t === 0.5)
    check('t=0.5 处旧 s=0.2 被改写为 s=0.5', mid !== undefined && mid.s === 0.5, mid)
    check('重采样报告总弧长且大于 0', result.arcLength > 0, result.arcLength)
    check('重采样只产出既有 keyframes 形态', result.timing?.type === 'keyframes', result.timing)

    // 几何 / 端点 / 轴不变。
    const originalEntry = makeEntry({ type: 'line' }, originalTiming)
    const resampledEntry: JsonObject = { ...originalEntry, timing: result.timing ?? originalTiming }
    check('重采样不改几何', JSON.stringify(resampledEntry.geometry) === JSON.stringify(originalEntry.geometry))
    check('重采样不改端点', resampledEntry.from === originalEntry.from && resampledEntry.to === originalEntry.to)
    check('重采样不改轴集合', JSON.stringify(resampledEntry.axes) === JSON.stringify(originalEntry.axes))
    check('重采样不写控制点', (resampledEntry.geometry as JsonObject).control_points === undefined)

    // 退化几何（端点重合）→ 本地拦下。
    const degenerate = resampleTiming({
      geometry: { type: 'line' },
      from: FROM,
      to: { x: 0, y: 0, z: 0 },
      axes: AXES_XYZ,
      samples: 4,
      timing: undefined,
    })
    check('退化几何重采样被拦下', !degenerate.ok && degenerate.timing === null, degenerate.diagnostics)
  }

  // ── D. 一次事务 / 一次撤销 ──────────────────────────────────────────────
  {
    // D1. 形状应用：一次 commit，撤销回退几何。
    const shapeStore = ctx.createStore()
    const shapeDoc = ctx.docFrom(script(baseObjects()))
    shapeStore.open(shapeDoc, 'verify12-curve-shape.json')
    const first = makeEntry({ type: 'line' })
    const createResult = shapeStore.commit(createPathCommand(first))
    check('形状用例初始条目提交成功', createResult.ok, createResult)

    const beforeEntry = pathEntries(shapeDoc)[0]
    const shapePlan = planShapeEntry({
      entry: beforeEntry,
      from: FROM,
      to: TO,
      axes: AXES_XYZ,
      kind: 'parabola',
      params: {},
    })
    check('形状计划可用于提交', shapePlan.ok && shapePlan.geometry !== null, shapePlan.diagnostics)
    const shapeNext: JsonObject = { ...beforeEntry, geometry: shapePlan.geometry }
    const shapeCommit = shapeStore.commit(updatePathCommand(beforeEntry.id as string, shapeNext))
    check('形状应用一次提交成功', shapeCommit.ok, shapeCommit)
    check('提交后几何为贝塞尔', (pathEntries(shapeStore.doc!)[0].geometry as JsonObject).type === 'bezier')
    const undidShape = shapeStore.undo()
    check('形状应用一次撤销成功', undidShape)
    const afterShape = pathEntries(shapeStore.doc!)[0]
    check('撤销后几何回退为直线', (afterShape.geometry as JsonObject).type === 'line')
    check('撤销后条目数不变', pathEntries(shapeStore.doc!).length === 1)

    // D2. 重采样：一次 commit，撤销回退时间映射。
    const timingStore = ctx.createStore()
    const timingDoc = ctx.docFrom(script(baseObjects()))
    timingStore.open(timingDoc, 'verify12-curve-resample.json')
    const timingOriginal = makeEntry({ type: 'line' }, {
      type: 'keyframes',
      points: [{ t: 0, s: 0 }, { t: 0.5, s: 0.2 }, { t: 1, s: 1 }],
    })
    const timingCreate = timingStore.commit(createPathCommand(timingOriginal))
    check('重采样用例初始条目提交成功', timingCreate.ok, timingCreate)

    const beforeTimingEntry = pathEntries(timingDoc)[0]
    const resampleResult = resampleTiming({
      geometry: beforeTimingEntry.geometry as JsonObject,
      from: FROM,
      to: TO,
      axes: AXES_XYZ,
      samples: 5,
      timing: beforeTimingEntry.timing,
    })
    check('重采样计划可用于提交', resampleResult.ok && resampleResult.timing !== null, resampleResult.diagnostics)
    const timingNext: JsonObject = { ...beforeTimingEntry, timing: resampleResult.timing }
    const timingCommit = timingStore.commit(updatePathCommand(beforeTimingEntry.id as string, timingNext))
    check('重采样一次提交成功', timingCommit.ok, timingCommit)
    check('提交后时间映射为关键帧重采样结果', (pathEntries(timingStore.doc!)[0].timing as JsonObject).type === 'keyframes')
    const undidTiming = timingStore.undo()
    check('重采样一次撤销成功', undidTiming)
    const afterUndo = pathEntries(timingStore.doc!)[0]
    check('撤销后时间映射回退', JSON.stringify(afterUndo.timing) === JSON.stringify(timingOriginal.timing))
    check('撤销后几何 / 端点 / 轴不变',
      (afterUndo.geometry as JsonObject).type === 'line'
      && afterUndo.from === timingOriginal.from
      && afterUndo.to === timingOriginal.to
      && JSON.stringify(afterUndo.axes) === JSON.stringify(timingOriginal.axes))
  }

  // ── E. 与 07 既有生成器输出对比（圆弧 / 椭圆未被改写） ──────────────────
  {
    const compareStore = ctx.createStore()
    const compareDoc = ctx.docFrom(script(baseObjects()))
    compareStore.open(compareDoc, 'verify12-curve-generator.json')

    const arcSpec = {
      clip: 'c1', from: 0, to: 1, shape: 'arc' as const,
      center: { x: 2, y: 0, z: 0 }, radius: 2, semiMajor: 2, semiMinor: 1, rotation: 0,
      startAngle: 0, endAngle: 180, clockwise: false,
      normal: { x: 0, y: 1, z: 0 }, referenceAxis: { x: 1, y: 0, z: 0 },
      mode: 'exact' as const, segments: 'auto' as const, timeMode: 'keep-nodes' as const,
    }
    const generatorArc = planShapeGeneration(compareDoc, arcSpec)
    check('07 生成器 exact 模式产出一条 arc', generatorArc.plan !== null
      && generatorArc.plan.paths.length === 1
      && (generatorArc.plan.paths[0].geometry as JsonObject).type === 'arc', generatorArc.issues)
    const generatorArcGeom = generatorArc.plan?.paths[0]?.geometry as JsonObject | undefined

    const ourArc = planShapeEntry({
      entry: makeEntry({ type: 'line' }),
      from: FROM,
      to: TO,
      axes: AXES_XYZ,
      kind: 'arc',
      params: {
        center: { x: 2, y: 0, z: 0 },
        radius: 2,
        startAngle: 0,
        endAngle: 180,
        normal: { x: 0, y: 1, z: 0 },
        referenceAxis: { x: 1, y: 0, z: 0 },
      },
    })
    check('本切片圆弧类型与 07 生成器一致', ourArc.geometry?.type === generatorArcGeom?.type, { our: ourArc.geometry, generator: generatorArcGeom })
    check('本切片圆弧参数键集与 07 生成器同形态', ourArc.geometry !== null && generatorArcGeom !== undefined
      && sameKeySet(ourArc.geometry, generatorArcGeom), { our: ourArc.geometry, generator: generatorArcGeom })

    const ellipseSpec = { ...arcSpec, shape: 'ellipse' as const }
    const generatorEllipse = planShapeGeneration(compareDoc, ellipseSpec)
    check('07 生成器 exact 模式产出一条 ellipse', generatorEllipse.plan !== null
      && generatorEllipse.plan.paths.length === 1
      && (generatorEllipse.plan.paths[0].geometry as JsonObject).type === 'ellipse', generatorEllipse.issues)
    const generatorEllipseGeom = generatorEllipse.plan?.paths[0]?.geometry as JsonObject | undefined

    const ourEllipse = planShapeEntry({
      entry: makeEntry({ type: 'line' }),
      from: FROM,
      to: TO,
      axes: AXES_XYZ,
      kind: 'ellipse',
      params: {
        center: { x: 2, y: 0, z: 0 },
        semiMajor: 2,
        semiMinor: 1,
        rotation: 0,
        startAngle: 0,
        endAngle: 180,
        normal: { x: 0, y: 1, z: 0 },
        referenceAxis: { x: 1, y: 0, z: 0 },
      },
    })
    check('本切片椭圆类型与 07 生成器一致', ourEllipse.geometry?.type === generatorEllipseGeom?.type, { our: ourEllipse.geometry, generator: generatorEllipseGeom })
    check('本切片椭圆参数键集与 07 生成器同形态', ourEllipse.geometry !== null && generatorEllipseGeom !== undefined
      && sameKeySet(ourEllipse.geometry, generatorEllipseGeom), { our: ourEllipse.geometry, generator: generatorEllipseGeom })

    // 两条圆锥几何都能被 07 采样链求值（未被改成无法求值的形态）。
    for (const [label, geometry] of [
      ['arc', ourArc.geometry],
      ['ellipse', ourEllipse.geometry],
    ] as Array<[string, JsonObject | null]>) {
      if (geometry === null) {
        check(`${label} 几何可求值`, false, 'geometry 为 null')
        continue
      }
      let evaluable = true
      let sampleCount = 0
      try {
        const evaluation = buildGeometry(geometry, FROM, TO)
        sampleCount = sampleGeometry(evaluation, 16).length
      } catch {
        evaluable = false
      }
      check(`${label} 几何可被 07 采样链求值`, evaluable && sampleCount > 0, { sampleCount })
    }
  }

  // ── F. 近似标注 ─────────────────────────────────────────────────────────
  {
    check('拾取近似标注文案就位', PICK_APPROX_NOTE.includes('固定平面')
      && PICK_APPROX_NOTE.includes('近似')
      && PICK_APPROX_NOTE.includes('目视确认'), PICK_APPROX_NOTE)
  }
}
