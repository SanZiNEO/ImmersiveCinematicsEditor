/**
 * 12-08 飞控九槽姿态库自检（`runFlightPoseBank(check, ctx)`）。
 *
 * 覆盖契约 §D 与 plan 12-08 §6：
 * - 槽固定 9 个、不可增删；
 * - 存槽不产生消息 / 不改姿态状态（无 commit / external 事件、transport / session / 文档根不变）；
 * - 退出后可存；手动编辑不进事务；应用一次事务、一次撤销全回退；
 * - 绝对 / 相对世界固定原点 / 相对基准 / 注视目标 / 切线朝向 / 路径端点无节点 / 控制点对象形态各一组；
 * - 槽值不落盘；重开文档后槽为空；不可忠实求值给禁用原因。
 */
import { serializeDoc } from '../../core/doc/serialize.ts'
import { DocStore } from '../../core/doc/store.ts'
import type { JsonObject, JsonValue, ScriptDoc } from '../../core/doc/types.ts'
import {
  planApply,
  poseBankFor,
  poseFromClip,
  type ClipFieldApplyTarget,
  type PoseValue,
} from '../../features/flight/public.ts'
import type { CheckFn } from './harness.ts'
import type { VerifyContext } from './context.ts'

const EPS = 1e-9

function approx(actual: number, expected: number, eps = EPS): boolean {
  return Math.abs(actual - expected) <= eps
}

function samplePose(
  x = 10, y = 20, z = 30,
  yaw = 45, pitch = 10, roll = 0, fov = 70, zoom = 1.2,
): PoseValue {
  return { position: { x, y, z }, yaw, pitch, roll, fov, zoom }
}

/** 相机片段基础对象：绝对世界、手动朝向、注视关闭。 */
function cameraObjects(overrides: Record<string, JsonValue>): JsonObject {
  const base: Record<string, JsonValue> = {
    'position_mode': { value: 'absolute' },
    'position_space': { value: 'world' },
    'position_origin': { value: '' },
    'look_at': { value: 'none' },
    'orient': { value: 'manual' },
    'position.x': { value: 1 },
    'position.y': { value: 2 },
    'position.z': { value: 3 },
    yaw: { value: 10 },
    pitch: { value: 5 },
    roll: { value: 2 },
    fov: { value: 60 },
    zoom: { value: 1 },
  }
  return { ...base, ...overrides }
}

function cameraRoot(objects: JsonObject, paths?: JsonObject[]): JsonObject {
  const root: JsonObject = {
    meta: { id: 'verify12-08', name: 'flight-pose-bank', author: 'verify' },
    timeline: {
      tracks: [
        { type: 'CAMERA', clips: [{ id: 'c1', start_time: 0, duration: 2, objects }] },
      ],
    },
  }
  if (paths !== undefined) {
    root.paths = paths
  }
  return root
}

interface OpenedStore {
  store: DocStore
  doc: ScriptDoc
  clipKey: string
  clipId: string
}

function openStore(ctx: VerifyContext, root: JsonObject): OpenedStore {
  const store = ctx.createStore()
  const doc = ctx.docFrom(root)
  store.open(doc, 'verify-12-08.json')
  const handle = store.registry.handles()[0]
  return { store, doc, clipKey: handle.key, clipId: String(handle.id) }
}

function currentClip(store: DocStore): JsonObject {
  const handle = store.registry.handles()[0]
  return handle.clip
}

function objectsOf(clip: JsonObject): JsonObject {
  return (clip.objects as JsonObject) ?? {}
}

function numOf(objects: JsonObject, path: string): number | null {
  const raw = objects[path]
  if (raw === null || typeof raw !== 'object') {
    return null
  }
  const value = (raw as { value?: unknown }).value
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function writePaths(plan: ReturnType<typeof planApply>): string[] {
  return plan.writes.map((write) => write.fieldPath)
}

function hasCode(plan: ReturnType<typeof planApply>, code: string): boolean {
  return plan.diagnostics.some((diagnostic) => diagnostic.code === code)
}

/** 路径端点夹具：绑定 c1，from 0.5 / to 1。 */
function endpointPath(pathId: string, from: number, to: number): JsonObject {
  return {
    id: pathId,
    clip: 'c1',
    from,
    to,
    axes: ['x', 'y', 'z'],
    geometry: { type: 'line' },
  }
}

export function runFlightPoseBank(check: CheckFn, ctx: VerifyContext): void {
  // ── G1 槽固定 9 个，不可增删 ──────────────────────────────────────────────
  {
    const store = ctx.createStore()
    store.open(ctx.emptyDoc(), null)
    const bank = poseBankFor(store)

    check('九槽：槽位固定 9 个', bank.slots().length === 9, bank.slots().length)
    check('九槽：初始九槽全空',
      bank.slots().every((slot) => slot.pose === null && slot.source === null), bank.slots())

    bank.set(2, samplePose(), 'manual')
    check('九槽：存槽后槽位数仍为 9', bank.slots().length === 9, bank.slots().length)
    bank.clear(2)
    check('九槽：清槽后槽位数仍为 9', bank.slots().length === 9, bank.slots().length)

    const again = poseBankFor(store)
    check('九槽：同一会话同一 store 取到同一实例', again === bank)
  }

  // ── G2 存槽不产生消息 / 不改姿态状态 ─────────────────────────────────────
  {
    const store = ctx.createStore()
    store.open(ctx.emptyDoc(), null)
    const bank = poseBankFor(store)

    const events: string[] = []
    const off = store.subscribe((event) => {
      events.push(event)
    })
    const transportBefore = JSON.stringify(store.transport)
    const sessionBefore = JSON.stringify(store.session)
    const rootBefore = JSON.stringify(store.doc?.root)
    const dirtyBefore = store.dirty

    bank.set(4, samplePose(11, 22, 33), 'clip')

    check('存槽：不置脏', store.dirty === dirtyBefore, store.dirty)
    check('存槽：不产生 commit / external 事件',
      events.filter((event) => event === 'commit' || event === 'external').length === 0, events)
    check('存槽：不改 transport 状态', JSON.stringify(store.transport) === transportBefore)
    check('存槽：不改 session 选择 / 播放头', JSON.stringify(store.session) === sessionBefore)
    check('存槽：不改文档根', JSON.stringify(store.doc?.root) === rootBefore)
    off()
  }

  // ── G3 退出后可存（最近姿态 → 槽）────────────────────────────────────────
  {
    const store = ctx.createStore()
    store.open(ctx.emptyDoc(), null)
    const bank = poseBankFor(store)

    const exitPose = samplePose(7, 8, 9)
    bank.setLatest(exitPose)
    check('退出：最近姿态可读', bank.latest() !== null, bank.latest())

    const latest = bank.latest()
    if (latest !== null) {
      bank.set(1, latest, 'flight')
    }
    const slot = bank.slot(1)
    check('退出：退出姿态可存入槽', slot !== null && slot.pose !== null && slot.source === 'flight', slot)
    check('退出：槽内姿态与最近姿态一致',
      slot !== null && slot.pose !== null &&
      approx(slot.pose.position.x, 7) && approx(slot.pose.position.z, 9), slot?.pose)
  }

  // ── G4 手动编辑不进事务；应用一次事务、一次撤销全回退 ─────────────────────
  {
    const root = cameraRoot(cameraObjects({}))
    const { store, doc, clipKey } = openStore(ctx, root)
    const bank = poseBankFor(store)
    const pose = samplePose(11, 22, 33, 90, 15, 5, 75, 1.5)

    bank.set(0, pose, 'manual')
    check('手动编辑：不进撤销栈', store.undoDepth() === 0, store.undoDepth())
    check('手动编辑：不置脏', store.dirty === false, store.dirty)

    const clip = currentClip(store)
    const target: ClipFieldApplyTarget = {
      kind: 'clipField',
      clipKey,
      clip,
      time: 0,
      frameMode: 'static',
    }
    const plan = planApply(doc, ctx.catalog, target, pose)
    check('应用：绝对位置计划可行', plan.ok && plan.command !== null, plan)
    check('应用：计划含位置三轴 + 朝向三轴 + fov/zoom 共 8 条写入',
      plan.writes.length === 8, plan.writes.map((write) => write.fieldPath))

    const outcome = store.commit(plan.command!)
    check('应用：提交成功', outcome.ok === true, outcome)
    check('应用：一次应用产生一个撤销项', store.undoDepth() === 1, store.undoDepth())

    const afterObjects = objectsOf(currentClip(store))
    check('应用：位置三轴已写入',
      numOf(afterObjects, 'position.x') === 11 &&
      numOf(afterObjects, 'position.y') === 22 &&
      numOf(afterObjects, 'position.z') === 33, afterObjects)
    check('应用：朝向三轴已写入',
      numOf(afterObjects, 'yaw') === 90 && numOf(afterObjects, 'pitch') === 15 && numOf(afterObjects, 'roll') === 5, afterObjects)
    check('应用：fov / zoom 已写入',
      numOf(afterObjects, 'fov') === 75 && numOf(afterObjects, 'zoom') === 1.5, afterObjects)

    const undone = store.undo()
    check('应用：撤销成功', undone === true)
    check('应用：一次撤销后撤销栈清空', store.undoDepth() === 0, store.undoDepth())

    const restored = objectsOf(currentClip(store))
    check('应用：撤销后位置回到原值',
      numOf(restored, 'position.x') === 1 && numOf(restored, 'position.y') === 2 && numOf(restored, 'position.z') === 3, restored)
    check('应用：撤销后朝向回到原值',
      numOf(restored, 'yaw') === 10 && numOf(restored, 'pitch') === 5 && numOf(restored, 'roll') === 2, restored)
    check('应用：撤销后光学回到原值',
      numOf(restored, 'fov') === 60 && numOf(restored, 'zoom') === 1, restored)
  }

  // ── G5a 绝对位置：局部 = 世界点（不换算）─────────────────────────────────
  {
    const root = cameraRoot(cameraObjects({}))
    const { store, doc, clipKey } = openStore(ctx, root)
    const clip = currentClip(store)
    const target: ClipFieldApplyTarget = { kind: 'clipField', clipKey, clip, time: 0, frameMode: 'static' }
    const pose = samplePose(40, 50, 60)
    const plan = planApply(doc, ctx.catalog, target, pose)
    const xWrite = plan.writes.find((write) => write.fieldPath === 'position.x')
    check('绝对：世界点直接写入局部',
      xWrite !== undefined && approx(xWrite.newValue as number, 40), plan.writes)
  }

  // ── G5b 相对世界 + 固定数值原点：局部 = 世界点 − 原点 ────────────────────
  {
    const objects = cameraObjects({
      'position_mode': { value: 'relative' },
      'position_space': { value: 'world' },
      'position_origin': { value: 'coordinate' },
      'position_origin_x': { value: 100 },
      'position_origin_y': { value: 200 },
      'position_origin_z': { value: 300 },
    })
    const root = cameraRoot(objects)
    const { store, doc, clipKey } = openStore(ctx, root)
    const clip = currentClip(store)
    const target: ClipFieldApplyTarget = { kind: 'clipField', clipKey, clip, time: 0, frameMode: 'static' }
    const pose = samplePose(110, 202, 333)
    const plan = planApply(doc, ctx.catalog, target, pose)

    const writeOf = (path: string): number | null => {
      const write = plan.writes.find((entry) => entry.fieldPath === path)
      return write !== undefined && typeof write.newValue === 'number' ? write.newValue : null
    }
    check('相对世界：局部 x = 世界 − 原点', writeOf('position.x') !== null && approx(writeOf('position.x')!, 10), plan.writes)
    check('相对世界：局部 y = 世界 − 原点', writeOf('position.y') !== null && approx(writeOf('position.y')!, 2), plan.writes)
    check('相对世界：局部 z = 世界 − 原点', writeOf('position.z') !== null && approx(writeOf('position.z')!, 33), plan.writes)
    check('相对世界：朝向仍可写', writePaths(plan).includes('yaw') && writePaths(plan).includes('roll'), writePaths(plan))
  }

  // ── G5c 相对基准：禁位置与朝向，只写 fov / zoom ──────────────────────────
  {
    const objects = cameraObjects({
      'position_mode': { value: 'relative' },
      'position_space': { value: 'base' },
    })
    const root = cameraRoot(objects)
    const { store, doc, clipKey } = openStore(ctx, root)
    const clip = currentClip(store)
    const target: ClipFieldApplyTarget = { kind: 'clipField', clipKey, clip, time: 0, frameMode: 'static' }
    const plan = planApply(doc, ctx.catalog, target, samplePose())
    const paths = writePaths(plan)

    check('相对基准：不写位置三轴', !paths.some((path) => path.startsWith('position.')), paths)
    check('相对基准：不写朝向三轴', !paths.includes('yaw') && !paths.includes('pitch') && !paths.includes('roll'), paths)
    check('相对基准：只写 fov / zoom', paths.length === 2 && paths.includes('fov') && paths.includes('zoom'), paths)
    check('相对基准：位置禁用原因', hasCode(plan, 'flight.position.base'), plan.diagnostics)
    check('相对基准：朝向禁用原因', hasCode(plan, 'flight.orientation.base'), plan.diagnostics)
  }

  // ── G5d 注视目标：不写朝向角，位置与光学可写 ─────────────────────────────
  {
    const objects = cameraObjects({
      'look_at': { value: 'coordinate' },
      'look_at_target_x': { value: 1 },
      'look_at_target_y': { value: 2 },
      'look_at_target_z': { value: 3 },
    })
    const root = cameraRoot(objects)
    const { store, doc, clipKey } = openStore(ctx, root)
    const clip = currentClip(store)
    const target: ClipFieldApplyTarget = { kind: 'clipField', clipKey, clip, time: 0, frameMode: 'static' }
    const plan = planApply(doc, ctx.catalog, target, samplePose())
    const paths = writePaths(plan)

    check('注视目标：位置三轴可写',
      paths.includes('position.x') && paths.includes('position.y') && paths.includes('position.z'), paths)
    check('注视目标：不写朝向三轴', !paths.includes('yaw') && !paths.includes('pitch') && !paths.includes('roll'), paths)
    check('注视目标：fov / zoom 可写', paths.includes('fov') && paths.includes('zoom'), paths)
    check('注视目标：朝向禁用原因', hasCode(plan, 'flight.orientation.lookAt'), plan.diagnostics)
  }

  // ── G5e 切线朝向：不写朝向角 ─────────────────────────────────────────────
  {
    const objects = cameraObjects({ orient: { value: 'tangent' } })
    const root = cameraRoot(objects)
    const { store, doc, clipKey } = openStore(ctx, root)
    const clip = currentClip(store)
    const target: ClipFieldApplyTarget = { kind: 'clipField', clipKey, clip, time: 0, frameMode: 'static' }
    const plan = planApply(doc, ctx.catalog, target, samplePose())
    const paths = writePaths(plan)

    check('切线朝向：位置三轴可写',
      paths.includes('position.x') && paths.includes('position.y') && paths.includes('position.z'), paths)
    check('切线朝向：不写朝向三轴', !paths.includes('yaw') && !paths.includes('pitch') && !paths.includes('roll'), paths)
    check('切线朝向：朝向禁用原因', hasCode(plan, 'flight.orientation.tangent'), plan.diagnostics)
  }

  // ── G5f 路径端点：端点时间无对应位置节点 → 拒绝并提示先走 07 端点编辑 ─────
  {
    const objects: JsonObject = {
      'position.x': { keyframes: [{ time: 0, value: 1 }, { time: 1, value: 1 }] },
      'position.y': { keyframes: [{ time: 0, value: 2 }, { time: 1, value: 2 }] },
      'position.z': { keyframes: [{ time: 0, value: 3 }, { time: 1, value: 3 }] },
      yaw: { value: 0 },
      pitch: { value: 0 },
      roll: { value: 0 },
      fov: { value: 60 },
      zoom: { value: 1 },
    }
    const paths = [endpointPath('p1', 0.5, 1)]
    const root = cameraRoot(objects, paths)
    const { store, doc, clipKey } = openStore(ctx, root)

    const target = {
      kind: 'pathPoint' as const,
      pathId: 'p1',
      point: { type: 'endpoint' as const, side: 'from' as const },
      clipKey,
    }
    const plan = planApply(doc, ctx.catalog, target, samplePose())

    check('端点：无节点时间时计划不可行', plan.ok === false, plan)
    check('端点：命令为 null', plan.command === null, plan.command)
    check('端点：给出 endpointNoNode 原因', hasCode(plan, 'flight.path.endpointNoNode'), plan.diagnostics)
    check('端点：未产生写入', plan.writes.length === 0, plan.writes)
  }

  // ── G5g 路径控制点：保留完整对象形态；相对形态拒绝换算 ────────────────────
  {
    const absolutePaths = [{
      id: 'p2',
      clip: 'c1',
      from: 0,
      to: 1,
      axes: ['x', 'y', 'z'],
      geometry: { type: 'bezier', control_points: [{ x: 0, y: 0, z: 0 }] },
    }]
    const rootAbs = cameraRoot(cameraObjects({}), absolutePaths)
    const { store: storeAbs, doc: docAbs } = openStore(ctx, rootAbs)
    const absTarget = {
      kind: 'pathPoint' as const,
      pathId: 'p2',
      point: { type: 'control' as const, index: 0 },
    }
    const absPose = samplePose(30, 40, 50)
    const absPlan = planApply(docAbs, ctx.catalog, absTarget, absPose)

    check('控制点：绝对形态计划可行', absPlan.ok === true, absPlan)
    check('控制点：命令为 path.writeBatch',
      absPlan.command !== null && absPlan.command.kind === 'path.writeBatch', absPlan.command)
    const batchCommand = absPlan.command as { entries: JsonObject[] } | null
    const writtenPoint = batchCommand?.entries[0]?.geometry as JsonObject | undefined
    const controlList = writtenPoint !== undefined && Array.isArray(writtenPoint.control_points)
      ? writtenPoint.control_points[0] as JsonObject
      : undefined
    check('控制点：写入完整 {x,y,z} 对象形态',
      controlList !== undefined &&
      approx(controlList.x as number, 30) && approx(controlList.y as number, 40) && approx(controlList.z as number, 50) &&
      !('dx' in controlList), controlList)

    const relativePaths = [{
      id: 'p3',
      clip: 'c1',
      from: 0,
      to: 1,
      axes: ['x', 'y', 'z'],
      geometry: { type: 'bezier', control_points: [{ dx: 1, dy: 2, dz: 3 }] },
    }]
    const rootRel = cameraRoot(cameraObjects({}), relativePaths)
    const { doc: docRel } = openStore(ctx, rootRel)
    const relTarget = {
      kind: 'pathPoint' as const,
      pathId: 'p3',
      point: { type: 'control' as const, index: 0 },
    }
    const relPlan = planApply(docRel, ctx.catalog, relTarget, samplePose())
    check('控制点：相对形态不自动换算', relPlan.ok === false && relPlan.command === null, relPlan)
    check('控制点：给出 controlRelative 原因', hasCode(relPlan, 'flight.path.controlRelative'), relPlan.diagnostics)
  }

  // ── G6 槽值不落盘：存槽后序列化文本搜不到槽号 / 姿态值 ────────────────────
  {
    const root = cameraRoot(cameraObjects({}))
    const { store, doc } = openStore(ctx, root)
    const bank = poseBankFor(store)
    const secret = samplePose(1234.567, 2345.678, 3456.789, 31.415, 27.182, 1.618, 91.234, 2.718)

    bank.set(6, secret, 'manual')
    check('落盘：存槽不置脏', store.dirty === false, store.dirty)

    const serialized = JSON.stringify(serializeDoc(doc))
    const secretValues = [1234.567, 2345.678, 3456.789, 31.415, 27.182, 1.618, 91.234, 2.718]
    check('落盘：序列化文本不含槽内姿态数值',
      secretValues.every((value) => !serialized.includes(String(value))), serialized)
    check('落盘：文档根不含槽库身份字段',
      !serialized.includes('"slots"') && !serialized.includes('"poseBank"') && !serialized.includes('"source"'), serialized)
  }

  // ── G7 重开文档：槽清空；同会话面板重开不丢 ───────────────────────────────
  {
    const store = ctx.createStore()
    store.open(ctx.emptyDoc(), null)
    const bank = poseBankFor(store)

    bank.set(3, samplePose(5, 6, 7), 'clip')
    bank.setLatest(samplePose(8, 9, 10))
    const sameSession = poseBankFor(store)
    check('重开前：同会话再次取库槽保留',
      sameSession.slot(3)?.pose !== null && sameSession.latest() !== null)

    store.open(ctx.docFrom(cameraRoot(cameraObjects({}))), 'reopen.json')
    check('重开后：九槽全空', bank.slots().every((slot) => slot.pose === null && slot.source === null), bank.slots())
    check('重开后：最近姿态清空', bank.latest() === null, bank.latest())
  }

  // ── G8 不可忠实求值：逐条禁用原因 ────────────────────────────────────────
  {
    // 干净绝对片段：可忠实求值。
    const cleanRoot = cameraRoot(cameraObjects({
      'position.x': { value: 4 },
      'position.y': { value: 5 },
      'position.z': { value: 6 },
      yaw: { value: 30 },
      pitch: { value: 12 },
      roll: { value: 3 },
      fov: { value: 65 },
      zoom: { value: 1.1 },
    }))
    const clean = openStore(ctx, cleanRoot)
    const cleanExtraction = poseFromClip(clean.doc, clean.clipId, 0, ctx.catalog)
    check('求值：干净绝对片段可忠实求值', cleanExtraction.ok && cleanExtraction.pose !== null, cleanExtraction)
    check('求值：世界位置与片段一致',
      cleanExtraction.pose !== null &&
      approx(cleanExtraction.pose.position.x, 4) && approx(cleanExtraction.pose.position.y, 5) && approx(cleanExtraction.pose.position.z, 6),
      cleanExtraction.pose)

    // 相对基准：无可靠世界参考系。
    const baseRoot = cameraRoot(cameraObjects({
      'position_mode': { value: 'relative' },
      'position_space': { value: 'base' },
    }))
    const baseStore = openStore(ctx, baseRoot)
    const baseExtraction = poseFromClip(baseStore.doc, baseStore.clipId, 0, ctx.catalog)
    check('求值：基准空间不可忠实求值', baseExtraction.ok === false && baseExtraction.pose === null, baseExtraction)
    check('求值：基准空间给位置原因', baseExtraction.reasons.some((reason) => reason.code === 'flight.position.base'), baseExtraction.reasons)

    // 注视目标：朝向由目标方向决定。
    const lookRoot = cameraRoot(cameraObjects({ look_at: { value: 'coordinate' } }))
    const lookStore = openStore(ctx, lookRoot)
    const lookExtraction = poseFromClip(lookStore.doc, lookStore.clipId, 0, ctx.catalog)
    check('求值：注视目标不可忠实求值朝向', lookExtraction.ok === false, lookExtraction)
    check('求值：注视目标给朝向原因', lookExtraction.reasons.some((reason) => reason.code === 'flight.orientation.lookAt'), lookExtraction.reasons)

    // 切线朝向。
    const tangentRoot = cameraRoot(cameraObjects({ orient: { value: 'tangent' } }))
    const tangentStore = openStore(ctx, tangentRoot)
    const tangentExtraction = poseFromClip(tangentStore.doc, tangentStore.clipId, 0, ctx.catalog)
    check('求值：切线朝向不可忠实求值', tangentExtraction.ok === false, tangentExtraction)
    check('求值：切线朝向给原因', tangentExtraction.reasons.some((reason) => reason.code === 'flight.orientation.tangent'), tangentExtraction.reasons)

    // 呼吸抖动。
    const breathRoot = cameraRoot(cameraObjects({ cam_breath_enabled: { value: true } }))
    const breathStore = openStore(ctx, breathRoot)
    const breathExtraction = poseFromClip(breathStore.doc, breathStore.clipId, 0, ctx.catalog)
    check('求值：呼吸抖动不可忠实求值', breathExtraction.ok === false, breathExtraction)
    check('求值：呼吸抖动给原因', breathExtraction.reasons.some((reason) => reason.code === 'flight.breath'), breathExtraction.reasons)

    // 位置运动模型非空：姿态含运行时叠加分量。
    const motionRoot = cameraRoot(cameraObjects({ motion_position: { value: { type: 'sin' } } }))
    const motionStore = openStore(ctx, motionRoot)
    const motionExtraction = poseFromClip(motionStore.doc, motionStore.clipId, 0, ctx.catalog)
    check('求值：位置运动模型不可忠实求值', motionExtraction.ok === false, motionExtraction)
    check('求值：位置运动模型给原因', motionExtraction.reasons.some((reason) => reason.code === 'flight.motion.position'), motionExtraction.reasons)
  }
}
