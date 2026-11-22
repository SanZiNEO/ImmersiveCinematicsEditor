/**
 * 07 轮自检（真实入口）：`node --experimental-strip-types src/workbench/verify-07.ts`
 *
 * 覆盖：timing、11 类几何校验与采样、路径集合引用完整性、分组命令原子性、
 * 三个形状生成器、数学模型校验、预览投影、序列化剥离、模组解析形态。
 */
import { readFileSync } from 'node:fs'
import type { CatalogIndex } from '../core/schema/index.ts'
import { buildCatalog, indexCatalog } from '../core/schema/index.ts'
import { metaKeys } from '../core/doc/keys.ts'
import { parseDoc } from '../core/doc/parse.ts'
import { serializeDoc } from '../core/doc/serialize.ts'
import { DocStore } from '../core/doc/store.ts'
import type { JsonObject, JsonValue, ScriptDoc } from '../core/doc/types.ts'
import { validateGeometry } from '../core/paths/geometry.ts'
import { validateTiming, evaluateTimingS, insertTimingPoint, TIMING_MAX_POINTS } from '../core/paths/timing.ts'
import { buildGeometry, sampleGeometry } from '../core/paths/sampling.ts'
import { planShapeGeneration } from '../core/paths/generators.ts'
import { pathEntries, validatePathEntry, pathCollectionIssues } from '../core/paths/collection.ts'
import { isJsonObject } from '../core/doc/json.ts'
import type { DocCommand } from '../core/doc/commands.ts'
import { removeKeyframeCommands } from '../features/effects/keyframeOps.ts'
import {
  pathsBreakingOnInsert, pathsUsingEndpoint, withPathRemoval,
} from '../features/paths/integrity.ts'
import { buildPathPreview, projectPreviewPoint } from '../core/paths/preview.ts'
import { validateModelDefinition, modelOverLimit, modelNodeCount } from '../core/paths/models.ts'
import { parsePointSource, formatPointSource, isStructureId, pointSourceRoundTrip, validateLookAtPart } from '../features/authoring/pointSource.ts'
import { positionVisibility, missingPositionAxesExact, switchMissingAxes } from '../features/authoring/positionForm.ts'
import { resolveOrientation, manualAngle, lineBaseAngles } from '../features/authoring/orientation.ts'
import { loadAuthoringGroups, planGroupAction } from '../features/authoring/groups.ts'
import golden from './fixtures/path-golden-07.json' with { type: 'json' }
import { runCollectionChecks } from '../features/paths/verify07Collection.ts'
import { runVisualChecks } from '../features/paths/verify07Visual.ts'
import { runModelChecks } from '../features/paths/verify07Models.ts'
import { runAuthoringChecks } from '../features/authoring/ui/verify07Authoring.ts'
import { runIntegrityChecks } from '../features/paths/verify07Integrity.ts'
import type { LayoutNode, GroupNode } from './api/layout.ts'
import { buildDefaultTree } from './layout/defaultLayouts.ts'

let ok = 0
let fail = 0

function check(label: string, condition: boolean, actual?: unknown): void {
  if (condition) {
    ok += 1
    console.log(`ok   ${label}`)
    return
  }
  fail += 1
  console.log(`FAIL ${label}: ${format(actual)}`)
}

function format(value: unknown): string {
  if (value === undefined) {
    return 'undefined'
  }
  if (typeof value === 'string') {
    return value
  }
  try {
    const text = JSON.stringify(value)
    return text === undefined ? String(value) : text.length > 280 ? `${text.slice(0, 280)}...` : text
  } catch {
    return String(value)
  }
}

function near(actual: number, expected: number, epsilon = 1e-9): boolean {
  return Math.abs(actual - expected) <= epsilon
}

function firstClip(store: DocStore): JsonObject {
  const tracks = store.doc!.timeline.tracks as unknown as JsonObject[]
  const clips = tracks[0].clips as unknown as JsonObject[]
  return clips[0]
}

/** 读一个对象路径的关键帧数组（没有动画时为空）。 */
function getKeyframes(store: DocStore, path: string): JsonObject[] {
  const objects = firstClip(store).objects as JsonObject
  const value = objects[path]
  if (value === undefined || !isJsonObject(value)) {
    return []
  }
  const frames = (value as JsonObject).keyframes
  return Array.isArray(frames) ? frames as JsonObject[] : []
}

function cameraScript(objects: JsonObject): JsonObject {
  return {
    meta: { id: 'verify07', name: 'Verify 07', author: '' },
    timeline: {
      tracks: [
        {
          type: 'CAMERA',
          clips: [{ id: 'c1', start_time: 0, duration: 2, objects }],
        },
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
    throw new Error(`fixture parse failed: ${format(parsed.issues)}`)
  }
  const store = new DocStore({ catalog, metaKeys: keys })
  store.open(parsed.doc, 'verify07.json')
  const handle = store.registry.handles()[0]
  return { store, clipKey: handle.key, doc: parsed.doc }
}

function findGroup(node: LayoutNode, id: string): GroupNode | undefined {
  if (node.type === 'group') {
    return node.id === id ? node : undefined
  }
  for (const child of node.children) {
    const found = findGroup(child, id)
    if (found !== undefined) {
      return found
    }
  }
  return undefined
}

function main(): void {
  const catalog = indexCatalog(buildCatalog('verify-07'))

  // ── 07-08 timing ─────────────────────────────────────────────────────────
  {
    const equal = { type: 'keyframes', points: [{ t: 0, s: 0 }, { t: 0.5, s: 0.5 }, { t: 0.5, s: 0.7 }, { t: 1, s: 1 }] }
    check('timing 相等 t/s 合法', validateTiming(equal).length === 0, validateTiming(equal))
    check('timing 相等 t 后点胜出', near(evaluateTimingS(equal, 0.5), 0.7), evaluateTimingS(equal, 0.5))
    check('timing 线性求值', near(evaluateTimingS(undefined, 0.42), 0.42))
    check('timing 缺首点 (0,0) 拒绝', validateTiming({ type: 'keyframes', points: [{ t: 0, s: 0.2 }, { t: 1, s: 1 }] }).length > 0)
    check('timing 缺末点 (1,1) 拒绝', validateTiming({ type: 'keyframes', points: [{ t: 0, s: 0 }, { t: 1, s: 0.9 }] }).length > 0)
    check('timing t 递减拒绝', validateTiming({ type: 'keyframes', points: [{ t: 0, s: 0 }, { t: 0.6, s: 0.4 }, { t: 0.5, s: 0.5 }, { t: 1, s: 1 }] }).length > 0)
    check('timing s 递减拒绝', validateTiming({ type: 'keyframes', points: [{ t: 0, s: 0 }, { t: 0.5, s: 0.6 }, { t: 0.7, s: 0.5 }, { t: 1, s: 1 }] }).length > 0)
    check('timing 超 256 点追加拒绝', insertTimingPoint(new Array(TIMING_MAX_POINTS).fill({ t: 0, s: 0 }), 0) === null)
  }

  // ── 07-06 geometry ───────────────────────────────────────────────────────
  const validGeometries: Record<string, JsonObject> = {
    linear: { type: 'line' },
    bezier: { type: 'bezier', control_points: [{ x: 0, y: 1, z: 0 }, { dx: 1, dy: 1, dz: 0 }] },
    rational_bezier: { type: 'rational_bezier', control_points: [{ x: 0, y: 1, z: 0 }], weights: [0.5] },
    arc: { type: 'arc', center: { x: 0, y: 0, z: 0 }, radius: 1, start_angle: 0, end_angle: 90 },
    ellipse: { type: 'ellipse', center: { x: 0, y: 0, z: 0 }, semi_major: 2, semi_minor: 1, rotation: 30, start_angle: 0, end_angle: 90 },
    bspline: { type: 'bspline', control_points: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }], degree: 2 },
    nurbs: { type: 'nurbs', control_points: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }], weights: [0.8, 0.6, 1], degree: 2 },
    catmull_rom: { type: 'catmull_rom', points: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }] },
    hermite: { type: 'hermite', tangents: [{ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }] },
    clothoid: { type: 'clothoid', start_curvature: 0, end_curvature: 0.5, length: 4 },
    fourier: { type: 'fourier', period: 1, cos: [{ x: 0.3, y: 0, z: 0 }], sin: [{ x: 0, y: 0.2, z: 0 }] },
  }
  for (const [type, geometry] of Object.entries(validGeometries)) {
    const issues = validateGeometry(geometry)
    check(`geometry ${type} 合法`, issues.length === 0, issues)
  }
  check('geometry 未知类型拒绝', validateGeometry({ type: 'nope' }).length > 0)
  check('geometry line 只接受 type', validateGeometry({ type: 'line', radius: 1 }).length > 0)
  check('geometry arc 半径 > 0', validateGeometry({ ...validGeometries.arc, radius: 0 }).length > 0)
  check('geometry arc 法向/参考轴非平行', validateGeometry({ ...validGeometries.arc, normal: { x: 1, y: 0, z: 0 }, reference_axis: { x: 2, y: 0, z: 0 } }).length > 0)
  check('geometry bezier 恰好 2 控制点', validateGeometry({ type: 'bezier', control_points: [{ x: 0, y: 0, z: 0 }] }).length > 0)
  check('geometry rational weights 等长', validateGeometry({ type: 'rational_bezier', control_points: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }], weights: [1] }).length > 0)
  check('geometry bspline knots 长度', validateGeometry({ ...validGeometries.bspline, knots: [0, 0, 1, 1] }).length > 0)
  check('geometry hermite 恰好 2 切线', validateGeometry({ type: 'hermite', tangents: [{ x: 0, y: 1, z: 0 }] }).length > 0)
  check('geometry fourier cos/sin 等长', validateGeometry({ ...validGeometries.fourier, sin: [] }).length > 0)
  check('geometry fourier 非周期 a0=0', validateGeometry({ ...validGeometries.fourier, periodic: false, a0: { x: 1, y: 0, z: 0 } }).length > 0)
  check('geometry clothoid length>0', validateGeometry({ ...validGeometries.clothoid, length: 0 }).length > 0)

  // ── 07-10 sampling ───────────────────────────────────────────────────────
  {
    const from = { x: 1, y: 0, z: 0 }
    const to = { x: 1, y: 0, z: 0 }
    const linear = buildGeometry({ type: 'line' }, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 })
    check('linear 采样端点', near(linear.start.x, 0) && near(linear.end.x, 10))
    const bezier = buildGeometry(validGeometries.bezier, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    check('bezier 起终点绑定', near(bezier.position(0).x, 0) && near(bezier.position(1).x, 1))
    const arc = buildGeometry({ ...validGeometries.arc, end_angle: 360 }, from, to)
    check('arc 360° 首尾同点', near(arc.position(0).x, arc.position(1).x, 1e-8) && near(arc.position(0).z, arc.position(1).z, 1e-8))
    check('arc 90° 中点半径', near(Math.hypot(arc.position(0.125).x - 0, arc.position(0.125).z - 0), 1, 1e-6))
    const ellipse = buildGeometry(validGeometries.ellipse, from, to)
    check('ellipse 起点在长轴', near(Math.hypot(ellipse.position(0).x, ellipse.position(0).z), 2, 1e-8), ellipse.position(0))
    const catmull = buildGeometry(validGeometries.catmull_rom, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 })
    check('catmull 起终点绑定', near(catmull.position(0).x, 0) && near(catmull.position(1).y, 1))
    const hermite = buildGeometry(validGeometries.hermite, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    check('hermite 起终点绑定', near(hermite.position(0).y, 0) && near(hermite.position(1).y, 0))
    const clothoid = buildGeometry(validGeometries.clothoid, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    check('clothoid 起点锚定', near(clothoid.start.x, 0) && near(clothoid.start.y, 0))
    const fourier = buildGeometry(validGeometries.fourier, from, to)
    check('fourier 周期首尾同点', near(fourier.start.x, fourier.end.x, 1e-8) && near(fourier.start.y, fourier.end.y, 1e-8))
    const samples = sampleGeometry(bezier, 17)
    check('采样点数与 u 均匀', samples.length === 17 && near(samples[8].u, 0.5))
    // 07-10 静态 golden fixture：期望值手工推导，不由采样器自生成。
    for (const goldenCase of golden.cases) {
      const evaluation = buildGeometry(
        goldenCase.geometry as unknown as JsonObject,
        { x: goldenCase.from[0], y: goldenCase.from[1], z: goldenCase.from[2] },
        { x: goldenCase.to[0], y: goldenCase.to[1], z: goldenCase.to[2] },
      )
      const actual = evaluation.position(goldenCase.u)
      const expected = goldenCase.expected
      check(
        `golden ${goldenCase.type}`,
        near(actual.x, expected[0], 1e-9) && near(actual.y, expected[1], 1e-9) && near(actual.z, expected[2], 1e-9),
        { actual, expected },
      )
      const samples = (goldenCase as unknown as {
        samples?: Array<{ u: number; expected: number[] }>
      }).samples ?? []
      for (const sample of samples) {
        const sampled = evaluation.position(sample.u)
        check(
          `golden ${goldenCase.type} u=${sample.u}`,
          near(sampled.x, sample.expected[0], 1e-9)
            && near(sampled.y, sample.expected[1], 1e-9)
            && near(sampled.z, sample.expected[2], 1e-9),
          { actual: sampled, expected: sample.expected },
        )
      }
    }
  }

  // ── 07-05 path collection ────────────────────────────────────────────────
  {
    const { store, clipKey, doc } = openStore(catalog, cameraScript(baseObjects()))
    const good: JsonObject = { id: 'p_1', clip: 'c1', from: 0, to: 1, axes: ['x', 'y', 'z'], geometry: { type: 'line' } }
    check('path 条目合法', validatePathEntry(doc, good, 0).length === 0, validatePathEntry(doc, good, 0))
    check('path 非相邻端点拒绝', validatePathEntry(doc, { ...good, id: 'p_2', to: 1.2 }, 0).length > 0)
    check('path 端点不命中拒绝', validatePathEntry(doc, { ...good, id: 'p_3', to: 1.5 }, 0).length > 0)
    check('path axes 非空', validatePathEntry(doc, { ...good, id: 'p_4', axes: [] }, 0).length > 0)
    check('path 未知键拒绝', validatePathEntry(doc, { ...good, id: 'p_5', foo: 1 }, 0).length > 0)
    const commit = store.commit({ kind: 'path.writeBatch', removeIds: [], entries: [good] })
    check('path.writeBatch 一次提交成功', commit.ok, commit)
    check('path.writeBatch 落地', pathEntries(store.doc!).length === 1)
    check('path.writeBatch 本地拒绝空 axes', !store.commit({ kind: 'path.writeBatch', removeIds: [], entries: [{ ...good, id: 'p_bad_axes', axes: [] }] }).ok)
    check('path.writeBatch 本地拒绝重复端点对', !store.commit({ kind: 'path.writeBatch', removeIds: [], entries: [{ ...good, id: 'p_bad_pair' }] }).ok)
    check('path.writeBatch 本地拒绝非节点端点', !store.commit({ kind: 'path.writeBatch', removeIds: [], entries: [{ ...good, id: 'p_bad_endpoint', to: 1.2 }] }).ok)
    check('path.writeBatch 拒绝后文档回滚', pathEntries(store.doc!).length === 1)
    const paths = store.doc!.root.paths as JsonValue[]
    paths.push({ id: 'p_dup', clip: 'c1', from: 0, to: 1, axes: ['x', 'y', 'z'], geometry: { type: 'line' } })
    check('path 重复端点对诊断', pathCollectionIssues(store.doc!, catalog).some((issue) => issue.message.includes('端点对重复')))
    check('path 重复 id 诊断', pathCollectionIssues(store.doc!, catalog).filter((issue) => issue.message.includes('id 重复')).length === 0)
    check('路径集合不改模组字段', JSON.stringify(serializeDoc(store.doc!)).includes('"paths"'))
  }

  // ── 07-01 group commands ─────────────────────────────────────────────────
  {
    const { store, clipKey, doc } = openStore(catalog, cameraScript(baseObjects()))
    const registry = loadAuthoringGroups(catalog)
    check('默认组数量 = 2', registry.groups.length === 2, registry.groups.map((group) => group.id))
    const clip = firstClip(store)
    const plan = planGroupAction({
      doc,
      catalog,
      clip,
      trackType: 'CAMERA',
      group: registry.groups[0],
      time: 0.5,
      action: 'create',
    })
    check('组合 create 只给缺失帧建三条', plan.ops.length === 3 && plan.counts.create === 3, plan)
    const commit = store.commit({
      kind: 'object.editKeyframes',
      clipKey,
      ops: plan.ops as unknown as { op: 'add' | 'set' | 'remove'; path: string; time: number; value: JsonValue }[],
    })
    check('组合 create 一次 commit', commit.ok, commit)
    const clipAfter = firstClip(store)
    const xFrames = ((clipAfter.objects as JsonObject)['position.x'] as JsonObject).keyframes as JsonObject[]
    check('组合三轴同刻精确相等', xFrames.filter((frame) => frame.time === 0.5).length === 1
      && missingPositionAxesExact(clipAfter, 0.5).length === 0)
    store.undo()
    const clipUndo = firstClip(store)
    check('组合一次撤销全回退', missingPositionAxesExact(clipUndo, 0.5).length === 3)
    // 自定义组不参与撤销
    const custom = { id: 'custom_1', name: 'My', track: 'CAMERA', members: ['position.x'], source: 'custom' as const, builtin: false }
    check('组合定义拒绝重复 id', !store.setAuthoringGroups([
      custom as unknown as JsonObject,
      { ...custom, name: 'dup' } as unknown as JsonObject,
    ]).ok)
    check('组合定义写入内存态', store.setAuthoringGroups([custom as unknown as JsonObject]).ok)
    store.commit({ kind: 'object.setValue', clipKey, path: 'roll', value: 3 })
    check('组合定义不随撤销回退', Array.isArray(store.doc!.authoring.groups)
      && (store.doc!.authoring.groups as unknown[]).length === 1)
    // step 对齐
    const stepClip = firstClip(store)
    check('step 字段 t>0 缺三轴帧', switchMissingAxes(stepClip, 'position_space', 0.5, 'base').length === 3)
    check('step 字段 t=0 不要求三轴', switchMissingAxes(stepClip, 'position_mode', 0, 'world').length === 0)
  }

  // ── 07-07 generators ─────────────────────────────────────────────────────
  {
    const { store, doc } = openStore(catalog, cameraScript(baseObjects()))
    const spec = {
      clip: 'c1', from: 0, to: 1, shape: 'circle' as const,
      center: { x: 0, y: 0, z: 0 }, radius: 1, semiMajor: 1, semiMinor: 1, rotation: 0,
      startAngle: 0, endAngle: 360, clockwise: false,
      normal: { x: 0, y: 1, z: 0 }, referenceAxis: { x: 1, y: 0, z: 0 },
      mode: 'bezier' as const, segments: 'auto' as const, timeMode: 'replace' as const,
    }
    const plan = planShapeGeneration(doc, spec)
    check('circle bezier 4 段', plan.plan !== null && plan.plan.paths.length === 4, plan)
    check('circle bezier 径向误差 ≤ 半径千分之一', plan.plan !== null && plan.plan.radialErrorRatio <= 0.001, plan.plan?.radialErrorRatio)
    check('circle 边界时间 5 个', plan.plan !== null && plan.plan.keyTimes.length === 5, plan.plan?.keyTimes)
    check('circle 首尾值相同', plan.plan !== null
      && plan.plan.keyTimes[0].point[0] === plan.plan.keyTimes[4].point[0]
      && plan.plan.keyTimes[0].point[1] === plan.plan.keyTimes[4].point[1])
    check('circle 替换旧路径 diff', plan.replacedPathIds.length === 0)
    // 提交：先删节点/补帧，再写路径（生成器不在运行时调用任何东西）
    const existingTimes = new Set<number>([0, 1])
    const editOps = plan.plan!.keyTimes.flatMap((entry) => {
      const op = existingTimes.has(entry.time) ? 'set' as const : 'add' as const
      return [
        { op, path: 'position.x', time: entry.time, value: entry.point[0] },
        { op, path: 'position.y', time: entry.time, value: entry.point[1] },
        { op, path: 'position.z', time: entry.time, value: entry.point[2] },
      ]
    })
    const commit = store.commit({
      kind: 'compound',
      commands: [
        { kind: 'object.editKeyframes', clipKey: store.registry.handles()[0].key, ops: editOps },
        { kind: 'path.writeBatch', removeIds: plan.replacedPathIds, entries: plan.plan!.paths },
      ],
    })
    check('circle 生成一次提交成功', commit.ok, commit)
    if (commit.ok) {
      const views = pathEntries(store.doc!)
      check('circle 生成 4 条路径', views.length === 4, views.map((view) => view.id))
      check('circle 每条都通过引用完整性', views.every((view) => view.issues.length === 0), views.map((view) => view.issues))
    }
    // 精确模式
    const exact = planShapeGeneration(store.doc!, { ...spec, from: 0, to: 0.25, endAngle: 90, mode: 'exact', timeMode: 'keep-nodes' })
    check('exact 模式一条 arc', exact.plan !== null && exact.plan.paths.length === 1 && (exact.plan.paths[0].geometry as JsonObject).type === 'arc', { issues: exact.issues, plan: exact.plan?.paths })
  }

  // ── 07-09 models ─────────────────────────────────────────────────────────
  {
    const unknown = { type: 'made_up', foo: 1 }
    const issues = validateModelDefinition(unknown, 'scalar')
    check('模型未知类型只警告不改写', issues.every((issue) => issue.severity === 'warn') && (unknown as JsonObject).type === 'made_up')
    check('模型未知参数保留', JSON.stringify(unknown).includes('foo'))
    const chain = { type: 'chain', models: [{ type: 'spring', stiffness: 8, damping: 0.75 }, { type: 'blend', a: { type: 'linear' }, b: { type: 'linear' }, weight: 0.2 }] }
    check('模型合法链无 error', validateModelDefinition(chain as unknown as JsonObject, 'scalar').filter((issue) => issue.severity === 'error').length === 0)
    check('模型 chain 空列表 error', validateModelDefinition({ type: 'chain', models: [] }, 'scalar').some((issue) => issue.severity === 'error'))
    check('模型 blend 缺分支 error', validateModelDefinition({ type: 'blend', a: { type: 'linear' } }, 'scalar').some((issue) => issue.severity === 'error'))
    check('模型 tau 越界 error', validateModelDefinition({ type: 'exponential_smooth', tau: 0 }, 'scalar').some((issue) => issue.severity === 'error'))
    check('模型 stiffness 越界 error', validateModelDefinition({ type: 'spring', stiffness: -1 }, 'scalar').some((issue) => issue.severity === 'error'))
    check('模型 damping 为负 error', validateModelDefinition({ type: 'inertia', damping: -0.1 }, 'scalar').some((issue) => issue.severity === 'error'))
    check('模型 weight 越界 error', validateModelDefinition({ type: 'blend', a: { type: 'linear' }, b: { type: 'linear' }, weight: 1.1 }, 'scalar').some((issue) => issue.severity === 'error'))
    check('模型 initial_velocity 非有限 error', validateModelDefinition({ type: 'spring', initial_velocity: Number.NaN }, 'scalar').some((issue) => issue.severity === 'error'))
    check('模型值域不匹配只警告', validateModelDefinition({ type: 'spring', domain: 'vector' }, 'scalar').every((issue) => issue.severity === 'warn'))
    const deep = { type: 'chain', models: [{ type: 'chain', models: [{ type: 'chain', models: [{ type: 'chain', models: [{ type: 'chain', models: [{ type: 'chain', models: [{ type: 'chain', models: [{ type: 'chain', models: [{ type: 'linear' }] }] }] }] }] }] }] }] }
    check('模型深度 > 8 禁用', modelOverLimit(deep))
    check('模型节点计数', modelNodeCount({ type: 'blend', a: { type: 'linear' }, b: { type: 'linear' } }) === 3)
  }

  // ── 07-03 point source ───────────────────────────────────────────────────
  {
    for (const raw of ['', 'player', 'coordinate', 'block:minecraft:stone', 'block:minecraft:stone:8', '@e[type=pig]', 'uuid:abc', 'village']) {
      check(`点源往返 ${raw || '(空)'}`, pointSourceRoundTrip(raw), parsePointSource(raw))
    }
    check('结构 id 拒绝保留字', !isStructureId('player') && !isStructureId('coordinate') && !isStructureId('@p') && !isStructureId('uuid:abc') && !isStructureId('block:foo'))
    check('block 缺省半径 16', parsePointSource('block:minecraft:stone').radius === 16)
    check('look_at_part 越界拒绝', validateLookAtPart([0, 50, 101]) !== null)
    check('look_at_part 合法', validateLookAtPart([0, 50, 100]) === null)
    const ps: JsonObject = { objects: {} }
    const format = formatPointSource({ kind: 'block', text: 'minecraft:stone', radius: 8 })
    check('block 格式', format === 'block:minecraft:stone:8', format)
  }

  // ── 07-02 / 07-04 projection ─────────────────────────────────────────────
  {
    const vis = positionVisibility({ position_mode: 'relative', position_space: 'base', position_origin: '@p', facing_source: 'auto', facing_target: '', facing_entity: '' })
    check('base 轴标签 fwd/up/right', vis.axisLabels.join('/') === 'fwd/up/right', vis.axisLabels)
    check('base 显示方向源', vis.fields.facing_source.visible && vis.fields.facing_entity.visible)
    const autoConflict = positionVisibility({ position_mode: 'relative', position_space: 'base', position_origin: '', facing_source: 'auto', facing_target: 'x', facing_entity: '@p' })
    check('auto target+entity 冲突阻止提交', autoConflict.canSubmit === false)
    const abs = positionVisibility({ position_mode: 'absolute', position_space: 'base', position_origin: 'player', facing_source: 'line', facing_target: 'x', facing_entity: '' })
    check('absolute 锁 world / 原点不读', !abs.fields.position_space.enabled && abs.fields.position_origin.read === false)
    check('absolute 未清除原点阻止提交', abs.canSubmit === false && abs.warnings.some((warning) => warning.includes('清除 position_origin')))
    const absCleared = positionVisibility({ position_mode: 'absolute', position_space: 'world', position_origin: '', facing_source: 'auto', facing_target: '', facing_entity: '' })
    check('absolute 清除原点后可提交', absCleared.canSubmit === true)

    const state = resolveOrientation({ look_at: 'entity', look_at_resolvable: true, orient: 'manual', has_tangent: true, yaw_base: 'world', pitch_base: 'world', yaw_lock: null, pitch_lock: null, line_resolvable: true, line_horizontal_degenerate: false })
    check('look_at 可解析压过 manual', state.branch === 'look_at' && state.disabled.yaw !== undefined)
    const manual = resolveOrientation({ look_at: 'none', look_at_resolvable: false, orient: 'manual', has_tangent: false, yaw_base: 'entity', pitch_base: 'world', yaw_lock: null, pitch_lock: null, line_resolvable: true, line_horizontal_degenerate: false })
    check('manual 分支可编辑', manual.branch === 'manual' && manual.disabled.yaw_offset !== undefined)
    check('lock 替换基准再叠加', manualAngle(90, 0, 15) === 105 && manualAngle(null, 0, 15) === 15)
    check('角度不归一化', manualAngle(720, 0, -540) === 180)
    check('线基准退化 0 回退', lineBaseAngles({ x: 0, z: 0 }, { x: 0, z: 0 }).warning !== null)
  }

  // ── 07-10 preview ───────────────────────────────────────────────────────
  {
    const { doc } = openStore(catalog, cameraScript(baseObjects()))
    const commit = (() => {
      const store = new DocStore({ catalog, metaKeys: metaKeys(catalog) })
      const parsed = parseDoc(cameraScript({ ...baseObjects(), 'position.x': { keyframes: [{ time: 0, value: 1 }, { time: 1, value: 1 }] } }), { metaKeys: metaKeys(catalog) })
      if (!parsed.ok) throw new Error('parse')
      store.open(parsed.doc, 'preview.json')
      store.commit({ kind: 'path.writeBatch', removeIds: [], entries: [{ id: 'p_1', clip: 'c1', from: 0, to: 1, axes: ['x', 'y', 'z'], geometry: { type: 'line' } }] })
      return store.doc!
    })()
    const preview = buildPathPreview(commit, 0)
    check('预览端点解析', preview !== null && preview.from[0] === 1 && preview.to[0] === 1)
    check('预览采样 65 点', preview !== null && preview.samples.length === 65)
    check('预览 s(u) 线性', preview !== null && near(preview.timingCurve[16].s, 0.5))
    const projection = projectPreviewPoint([1, 2, 3], ['x', 'y', 'z'], 'base')
    check('预览 base 3 维标签 fwd/right', projection.horizontalAxis === 'fwd' && projection.verticalAxis === 'right', projection)
    const one = projectPreviewPoint([4, 5, 6], ['y'], 'world')
    check('单轴一维投影', one.x === 5 && one.y === 0)
  }

  // ── 07-11 serialization / structural ────────────────────────────────────
  {
    const { store } = openStore(catalog, cameraScript(baseObjects()))
    const storeKeys = store.registry.handles()[0].key
    const commit = store.commit({
      kind: 'compound',
      commands: [
        { kind: 'object.editKeyframes', clipKey: storeKeys, ops: [
          { op: 'add', path: 'position.x', time: 0.5, value: 1 },
          { op: 'add', path: 'position.y', time: 0.5, value: 0 },
          { op: 'add', path: 'position.z', time: 0.5, value: 0 },
        ] },
        { kind: 'path.writeBatch', removeIds: [], entries: [
          { id: 'p_1', clip: 'c1', from: 0, to: 0.5, axes: ['x', 'y', 'z'], geometry: { type: 'line' } },
          { id: 'p_2', clip: 'c1', from: 0.5, to: 1, axes: ['x', 'y', 'z'], geometry: { type: 'line' } },
        ] },
      ],
    })
    check('复合命令路径集合通过结构检查', commit.ok, commit)
    const text = JSON.stringify(serializeDoc(store.doc!))
    check('序列化不含 authoring', !text.includes('"authoring"'))
    check('序列化不含 groupId', !text.includes('groupId'))
    check('序列化保留顶层 paths', text.includes('"paths"'))
    const invalid = cameraScript({ ...baseObjects(), 'position.x': { keyframes: [{ time: 0, value: 0 }, { time: 2, value: 1 }] } })
    const parsed = parseDoc(invalid, { metaKeys: metaKeys(catalog) })
    check('结构检查拒绝不在节点上的端点', parsed.ok)
    const fixture = JSON.parse(readFileSync('src/workbench/fixtures/round07-script.json', 'utf8'))
    const fixtureDoc = parseDoc(fixture, { metaKeys: metaKeys(catalog) })
    check('07 夹具可被编辑器解析', fixtureDoc.ok, fixtureDoc)
    const fixtureViews = fixtureDoc.ok ? pathEntries(fixtureDoc.doc) : []
    check('07 夹具含 8 条路径', fixtureDoc.ok && fixtureViews.length === 8, fixtureViews.length)
    check('07 夹具精确 arc 全圆', fixtureDoc.ok && fixtureViews[0].geometryType === 'arc' && (fixtureViews[0].entry.geometry as JsonObject).end_angle === 360)
    const bezierViews = fixtureViews.filter((view) => view.geometryType === 'bezier')
    check('07 夹具 Bezier 分段圆四段', bezierViews.length === 4, bezierViews.map((view) => view.id))
    check('07 夹具 Bezier 段带 timing', fixtureDoc.ok && fixtureViews[1].entry.timing !== undefined && Array.isArray((fixtureViews[1].entry.timing as JsonObject).points))
    check('07 夹具部分 axes 路径', fixtureViews.some((view) => view.axes.length === 1 && view.axes[0] === 'x'))
    check('07 夹具路径集合无 block/error', fixtureDoc.ok && pathCollectionIssues(fixtureDoc.doc, catalog).every((issue) => issue.severity !== 'block' && issue.severity !== 'error'), fixtureDoc.ok ? pathCollectionIssues(fixtureDoc.doc, catalog) : null)
    check('07 夹具无 authoring', !JSON.stringify(fixture).includes('"authoring"'))
  }

  // ── 07 UI 切片：路径面板 / 几何 / 时序、生成器与预览、模型编辑器 ──────────
  runCollectionChecks(check)
  runVisualChecks(check)
  runModelChecks(check)
  runAuthoringChecks(check)
  runIntegrityChecks(check)

  // ── 07-05 §四：位置节点编辑的「阻止 + 删除路径并继续」同一次撤销 ────────────
  {
    const raw = cameraScript(baseObjects())
    raw.paths = [{ id: 'p1', clip: 'c1', from: 0, to: 1, axes: ['x', 'y', 'z'], geometry: { type: 'line' } }]
    const { store, clipKey } = openStore(catalog, raw)
    const doc = store.doc as ScriptDoc
    const affected = pathsUsingEndpoint(doc, 'c1', 1)
    check('07-05 端点扫描命中路径', affected.length === 1 && affected[0].id === 'p1', affected)
    check('07-05 区间内插入被扫描', pathsBreakingOnInsert(doc, 'c1', 0.5).length === 1,
      pathsBreakingOnInsert(doc, 'c1', 0.5))
    check('07-05 区间外插入不命中', pathsBreakingOnInsert(doc, 'c1', 1.5).length === 0)
    // 取消：什么都不提交，文档不变
    const before = JSON.stringify(store.doc?.root)
    check('07-05 取消后文档零变化', getKeyframes(store, 'position.x').length === 2 && JSON.stringify(store.doc?.root) === before)
    const frame = removeKeyframeCommands(clipKey, [{ path: 'position.x', time: 1 }])
    check('07-05 帧命令非空', frame !== null, frame)
    const guarded = withPathRemoval(frame as DocCommand, affected)
    check('07-05 合成 compound 先删路径', guarded.kind === 'compound' && guarded.commands[0].kind === 'path.writeBatch', guarded)
    const committed = store.commit(guarded)
    check('07-05 确认后提交成功', committed.ok === true, committed)
    check('07-05 路径已删除', pathEntries(store.doc as ScriptDoc).length === 0, pathEntries(store.doc as ScriptDoc).map((e) => e.id))
    check('07-05 端点帧已删除', getKeyframes(store, 'position.x').length === 1, getKeyframes(store, 'position.x'))
    const undone = store.undo()
    check('07-05 一次撤销恢复路径与帧',
      undone && pathEntries(store.doc as ScriptDoc).length === 1 && getKeyframes(store, 'position.x').length === 2,
      { undone, paths: pathEntries(store.doc as ScriptDoc).length, frames: getKeyframes(store, 'position.x').length })
  }

  // ── 07-05 §四：给没有 id 的片段补 id（`clip.setId` + 冲突阻止） ─────────────
  {
    const raw = cameraScript(baseObjects())
    raw.timeline = {
      tracks: [
        { type: 'CAMERA', clips: [{ start_time: 0, duration: 2, objects: baseObjects() }] },
        { type: 'CAMERA', clips: [{ id: 'c2', start_time: 2, duration: 2, objects: {} }] },
      ],
    }
    const { store, clipKey } = openStore(catalog, raw)
    const outcome = store.commit({ kind: 'clip.setId', clipKey, value: 'c1', updateReferences: true })
    check('07-05 无 id 片段补 id 成功', outcome.ok === true, outcome)
    check('07-05 补 id 后片段可被引用', (store.doc as ScriptDoc) !== null
      && JSON.stringify(store.doc?.root).includes('"c1"'))
    const conflict = store.commit({ kind: 'clip.setId', clipKey, value: 'c2', updateReferences: true })
    check('07-05 补 id 冲突被拦', conflict.ok === false, conflict)
  }

  // ── 面板停靠：旧抽屉插件的面板安排在右侧 ────
  {
    const source = {
      bySlot: (slot: string) => (slot === 'document.drawer'
        ? [{
            pluginId: 'core.paths',
            contribution: {
              panelId: 'paths.collection',
              titleKey: '路径集合',
              component: () => Promise.resolve({ default: {} }),
              defaultSlot: 'document.drawer',
            },
          }]
        : []),
    }
    const tree = buildDefaultTree('document', source as never)
    const drawer = findGroup(tree.root, 'document.drawer')
    const right = findGroup(tree.root, 'document.right')
    const bottom = findGroup(tree.root, 'document.bottom')
    check('旧版抽屉面板默认停靠在右侧', right?.panels.some((panel) => panel.panelId === 'paths.collection') === true)
    check('旧抽屉容器默认隐藏且为空', drawer?.visible === false && drawer.panels.length === 0)
    check('路径面板不进主时间轴槽', bottom?.panels.every((panel) => panel.panelId !== 'paths.collection') === true)
  }

  console.log(`summary ok=${ok} fail=${fail}`)
  if (fail > 0) {
    process.exitCode = 1
  }
}

main()

