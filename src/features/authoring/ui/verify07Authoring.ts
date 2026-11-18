/**
 * 07 轮作者态 UI 自检切片（纯逻辑；走真 DocStore + 真 catalog + 真 commit +
 * 真 DocumentServiceImpl）。
 *
 * 运行：`node --experimental-strip-types src/features/authoring/ui/verify07Authoring.ts`
 * 断言覆盖四份文档「六、实现结果」可自动化条目；不碰 verify-07.ts。
 */
import { metaKeys } from '../../../core/doc/keys.ts'
import { DocStore } from '../../../core/doc/store.ts'
import type { DocIssue, JsonObject, JsonValue, ScriptDoc } from '../../../core/doc/types.ts'
import { parseDoc } from '../../../core/doc/parse.ts'
import { serializeDoc } from '../../../core/doc/serialize.ts'
import { validateStructure } from '../../../core/doc/structural.ts'
import type { DocTransport } from '../../../core/doc/io.ts'
import type { ValidationTransport } from '../../../core/doc/validate.ts'
import type { DiagnosticSink, DiagnosticInput, Diagnostic } from '../../../workbench/api/diagnostics.ts'
import { DocumentServiceImpl } from '../../../workbench/app/DocumentServiceImpl.ts'
import { buildCatalog, indexCatalog, type CatalogIndex } from '../../../core/schema/index.ts'
import {
  loadAuthoringGroups,
  planGroupAction,
  panelOf,
  POSITION_AXES,
  type AuthoringGroup,
} from '../groups.ts'
import { propertyRowsFor } from '../../effects/clipContext.ts'
import {
  matchAuthoringGroup,
  suggestCustomDraft,
  planGroupPopover,
  planToCompoundCommand,
  planStepFill,
  nextCustomGroupId,
  createCustomGroup,
  renameGroup,
  addGroupMembers,
  removeGroupMembers,
  deleteGroup,
  customGroupsToJson,
  canDeleteGroup,
  rowPaths,
} from './groupPopover.ts'
import {
  readPositionValues,
  projectPositionBar,
  decoratePositionRows,
  planClearIgnoredAbsolute,
  planPositionStepWrite,
  ABSOLUTE_IGNORED_PATHS,
} from './positionFields.ts'
import {
  draftPointSource,
  validatePointDraft,
  draftLookAt,
  lookAtBranchState,
  coordsBlockedByStructure,
  validateLookAtDraft,
  facingAutoState,
} from './pointSourceFields.ts'
import {
  projectOrientationBar,
  decorateOrientationRows,
  readOrientationValues,
} from './orientationFields.ts'
import { lineBaseAngles, manualAngle } from '../orientation.ts'
import { pointSourceRoundTrip, isStructureId } from '../pointSource.ts'

// ── 自检骨架 ────────────────────────────────────────────────────────────────

export type SliceCheck = (label: string, condition: boolean, actual?: unknown) => void

interface Harness {
  catalog: CatalogIndex
  store: DocStore
  service: DocumentServiceImpl
  doc: ScriptDoc
  clipKey: string
  objects: JsonObject
}

/** 内存传输 / 诊断占位（DocumentServiceImpl 依赖；自检不连后端）。 */
class MemoryTransport implements DocTransport, ValidationTransport {
  async load(): Promise<{ path: string; doc: JsonValue }> { return { path: 'verify.json', doc: {} } }
  async save(): Promise<{ path: string }> { return { path: 'verify.json' } }
  async validate(): Promise<{ ok: boolean; issues: string[] }> { return { ok: true, issues: [] } }
  async pushScript(): Promise<{ ok: boolean; reason?: string }> { return { ok: true } }
  async newScript(): Promise<{ path: string; doc: JsonValue }> { return { path: 'u', doc: {} } }
  async seek(): Promise<void> { return undefined }
}

class MemorySink implements DiagnosticSink {
  private readonly items: Diagnostic[] = []
  report(input: DiagnosticInput): Diagnostic {
    const diagnostic: Diagnostic = { id: 's1', timestamp: '2026-01-01T00:00:00Z', ...input }
    this.items.push(diagnostic)
    return diagnostic
  }
  list(): readonly Diagnostic[] { return this.items }
  countBySeverity(): number { return this.items.length }
  subscribe(listener: (items: readonly Diagnostic[]) => void): () => void {
    return () => { listener([]) }
  }
  clearHandled(): void { this.items.length = 0 }
  clear(): void { this.items.length = 0 }
}

const baseObjects: JsonObject = {
  fov: { value: 70 },
  'position.x': { value: 0, keyframes: [{ time: 0, value: 0 }, { time: 1, value: 1 }] },
  'position.y': { value: 0, keyframes: [{ time: 0, value: 0 }, { time: 1, value: 2 }] },
  'position.z': { value: 0, keyframes: [{ time: 0, value: 0 }, { time: 1, value: 3 }] },
  yaw: { value: 0 },
  pitch: { value: 0 },
  roll: { value: 0 },
  orient: { value: 'manual' },
  position_mode: { value: 'relative' },
  position_space: { value: 'world' },
  position_origin: { value: '' },
  facing_source: { value: 'auto' },
}

function cameraScript(objects: JsonObject): JsonObject {
  return {
    meta: { id: 'verify07ui', name: 'verify', author: 'self' },
    timeline: {
      tracks: [
        {
          type: 'CAMERA',
          clips: [{ id: 'cam1', start_time: 0, duration: 2, objects: structuredClone(objects) }],
        },
      ],
    },
  }
}

function openStore(catalog: CatalogIndex, objects: JsonObject): { store: DocStore; doc: ScriptDoc; clipKey: string; clip: JsonObject; objects: JsonObject } {
  const store = new DocStore({ catalog, metaKeys: metaKeys(catalog) })
  const parsed = parseDoc(cameraScript(objects), { metaKeys: metaKeys(catalog) })
  if (!parsed.ok) {
    throw new Error(`fixture parse failed: ${parsed.issues.map((issue) => issue.message).join('; ')}`)
  }
  store.open(parsed.doc, 'verify.json')
  const clipKey = liveClipKey(store)
  const handle = store.registry.handles()[0]
  const clip = (handle?.clip ?? {}) as JsonObject
  return { store, doc: parsed.doc, clipKey, clip, objects: (clip.objects ?? {}) as JsonObject }
}

function liveClipKey(store: DocStore): string {
  const handles = store.registry.handles()
  return handles[0]?.key ?? ''
}

function clipObjects(store: DocStore, clipKey: string): JsonObject {
  const handle = store.registry.handles().find((item) => item.key === clipKey)
  return (handle?.clip.objects ?? {}) as JsonObject
}

function framesAt(objects: JsonObject, path: string, time: number): JsonValue | undefined {
  const raw = objects[path] as JsonObject | undefined
  const frames = Array.isArray(raw?.keyframes) ? raw.keyframes as Array<{ time: number; value: JsonValue }> : []
  const hit = frames.find((frame) => frame.time === time)
  return hit?.value
}

function frameTimes(objects: JsonObject, path: string): number[] {
  const raw = objects[path] as JsonObject | undefined
  const frames = Array.isArray(raw?.keyframes) ? raw.keyframes : []
  return frames.filter(isFrame).map((frame) => frame.time)
}

function isFrame(value: JsonValue): value is { time: number; value: JsonValue } {
  return typeof value === 'object' && value !== null && typeof (value as { time?: unknown }).time === 'number'
}

let sharedCatalog: CatalogIndex | null = null

function blockIssues(store: DocStore): DocIssue[] {
  if (store.doc === null || sharedCatalog === null) {
    return []
  }
  return validateStructure(store.doc, { catalog: sharedCatalog, metaKeys: metaKeys(sharedCatalog), registry: store.registry })
    .filter((issue) => issue.severity === 'block')
}

// ── 断言主体 ────────────────────────────────────────────────────────────────

export function runAuthoringChecks(check: SliceCheck): void {
  const catalog = indexCatalog(buildCatalog('07'))
  sharedCatalog = catalog

  // ── 07-01 注册表与组匹配 ─────────────────────────────────────────────────
  {
    const registry = loadAuthoringGroups(catalog)
    check('注册表内置两组', registry.groups.length === 2, registry.groups.map((g) => g.id))
    const positionGroup = registry.groups.find((group) => group.id === 'position.xyz')
    const orientationGroup = registry.groups.find((group) => group.id === 'orientation.ypr')
    check('内置位置组成员为三轴', positionGroup !== undefined && positionGroup.members.length === 3, positionGroup?.members)
    check('内置朝向组成员为三角度', orientationGroup !== undefined && orientationGroup.members.length === 3, orientationGroup?.members)

    const match = matchAuthoringGroup([...POSITION_AXES], registry)
    check('三轴命中位置组（交集 3）', match.intersection === 3 && match.group?.id === 'position.xyz', match.intersection)
    const none = matchAuthoringGroup(['fov'], registry)
    check('单 fov 无匹配 → 建议自定义组', none.group === null && none.intersection === 0, none)
    const draft = suggestCustomDraft('position', ['fov'], 'CAMERA')
    check('自定义草稿成员 = 行路径', draft.members.length === 1 && draft.track === 'CAMERA', draft)
  }

  // ── 07-01 四动作：create 三轴同刻精确相等 + 一次撤销全回退 ─────────────────
  {
    const { store, doc, clipKey, clip, objects } = openStore(catalog, baseObjects)
    const service = new DocumentServiceImpl({ catalog, transport: new MemoryTransport(), diagnostics: new MemorySink() })
    service.store.open(structuredClone(doc), 'verify.json')
    const group: AuthoringGroup = loadAuthoringGroups(catalog).groups[0]

    const plan = planGroupPopover({
      doc, catalog, clip, trackType: 'CAMERA', group, time: 0.5, action: 'create',
    })
    check('create 计划三轴将创建', plan.counts.create === 3, plan.counts)
    const command = planToCompoundCommand(clipKey, plan)
    check('create 计划合成 compound', command?.kind === 'compound', command?.kind)
    const outcome = store.commit(command as NonNullable<typeof command>)
    check('create 提交成功', outcome.ok, outcome.error)
    const after = clipObjects(store, clipKey)
    check('三轴 0.5 同刻精确建帧',
      framesAt(after, 'position.x', 0.5) !== undefined &&
      framesAt(after, 'position.y', 0.5) !== undefined &&
      framesAt(after, 'position.z', 0.5) !== undefined,
      frameTimes(after, 'position.x'))
    check('create 后三轴帧时刻一致',
      frameTimes(after, 'position.x').length === frameTimes(after, 'position.z').length,
      frameTimes(after, 'position.x'))

    const undone = store.undo()
    check('一次撤销全回退', undone && framesAt(clipObjects(store, clipKey), 'position.x', 0.5) === undefined,
      frameTimes(clipObjects(store, clipKey), 'position.x'))
  }

  // ── capture 只补无帧叶子 ──────────────────────────────────────────────────
  {
    const seeded = structuredClone(baseObjects)
    ;(seeded['position.x'] as JsonObject).keyframes = [
      { time: 0, value: 0 }, { time: 0.5, value: 4 }, { time: 1, value: 1 },
    ]
    const { store, doc, clipKey, clip, objects } = openStore(catalog, seeded)
    const group = loadAuthoringGroups(catalog).groups[0]
    const plan = planGroupAction({
      doc, catalog, clip, trackType: 'CAMERA', group, time: 0.5, action: 'capture',
    })
    check('capture：已有轴跳过，缺轴补两帧', plan.counts.create === 2 && plan.counts.existing === 1, plan.counts)
    const command = planToCompoundCommand(clipKey, plan)
    store.commit(command as NonNullable<typeof command>)
    const after = clipObjects(store, clipKey)
    check('capture 已有轴帧值未被覆盖', framesAt(after, 'position.x', 0.5) === 4, framesAt(after, 'position.x', 0.5))
    check('capture 缺轴已补', framesAt(after, 'position.y', 0.5) !== undefined && framesAt(after, 'position.z', 0.5) !== undefined)
  }

  // ── set-values 批量改值 / remove 删帧计数与实际一致 ─────────────────────────
  {
    const seeded = structuredClone(baseObjects)
    ;(seeded['position.x'] as JsonObject).keyframes = [
      { time: 0, value: 0 }, { time: 0.5, value: 1 }, { time: 1, value: 1 },
    ]
    const { store, doc, clipKey, clip, objects } = openStore(catalog, seeded)
    const group = loadAuthoringGroups(catalog).groups[0]

    const setPlan = planGroupAction({
      doc, catalog, clip, trackType: 'CAMERA', group, time: 0.5, action: 'set-values',
      values: { 'position.x': 12, 'position.y': 13, 'position.z': 14 },
    })
    check('set-values：1 改 2 建', setPlan.counts.create === 2 && setPlan.counts.existing === 1, setPlan.counts)
    store.commit(planToCompoundCommand(clipKey, setPlan) as NonNullable<ReturnType<typeof planToCompoundCommand>>)
    const afterSet = clipObjects(store, clipKey)
    check('set-values 三轴值与计划一致',
      framesAt(afterSet, 'position.x', 0.5) === 12 &&
      framesAt(afterSet, 'position.y', 0.5) === 13 &&
      framesAt(afterSet, 'position.z', 0.5) === 14,
      [framesAt(afterSet, 'position.x', 0.5), framesAt(afterSet, 'position.y', 0.5), framesAt(afterSet, 'position.z', 0.5)])

    const removePlan = planGroupAction({
      doc, catalog, clip: { objects: afterSet }, trackType: 'CAMERA', group, time: 0.5, action: 'remove',
    })
    check('remove：三帧均在，将删 3', removePlan.counts.existing === 3, removePlan.counts)
    store.commit(planToCompoundCommand(clipKey, removePlan) as NonNullable<ReturnType<typeof planToCompoundCommand>>)
    const afterRemove = clipObjects(store, clipKey)
    check('remove 后 0.5 帧全部消失',
      framesAt(afterRemove, 'position.x', 0.5) === undefined &&
      framesAt(afterRemove, 'position.y', 0.5) === undefined &&
      framesAt(afterRemove, 'position.z', 0.5) === undefined)
  }

  // ── step t>0 缺轴被拦；补齐后结构校验通过；t=0 不要求三轴 ──────────────────
  {
    const { store, doc, clipKey, objects } = openStore(catalog, baseObjects)

    const blocked = planPositionStepWrite({
      clip: objects, catalog, trackType: 'CAMERA', clipKey,
      path: 'position_space', time: 0.5, value: 'base', fillAxes: false,
    })
    check('t>0 缺三轴被拦', blocked.blocked && blocked.missingAxes.length === 3, blocked.missingAxes)

    const fill = planPositionStepWrite({
      clip: objects, catalog, trackType: 'CAMERA', clipKey,
      path: 'position_space', time: 0.5, value: 'base', fillAxes: true,
    })
    check('补齐后命令可提交（step 写 + 三轴补齐）', !fill.blocked && fill.commands.length >= 2, fill.commands.length)
    const compound = { kind: 'compound' as const, commands: fill.commands }
    const outcome = store.commit(compound)
    check('补齐提交成功', outcome.ok, outcome.error)
    const issues = blockIssues(store)
    check('补齐后无 block 结构问题', issues.length === 0, issues.map((i) => i.message))

    const zero = planPositionStepWrite({
      clip: clipObjects(store, clipKey), catalog, trackType: 'CAMERA', clipKey,
      path: 'position_space', time: 0, value: 'world', fillAxes: false,
    })
    check('t=0 不要求三轴', !zero.blocked && zero.missingAxes.length === 0, zero)
  }

  // ── 自定义组 CRUD（纯数据） ───────────────────────────────────────────────
  {
    const registry = loadAuthoringGroups(catalog)
    let groups: AuthoringGroup[] = [...registry.groups]
    check('内置组不可删', !canDeleteGroup(groups[0]))

    const created = createCustomGroup(groups, { name: '我的组', track: 'CAMERA', members: ['yaw', 'pitch'] }, catalog)
    check('新建自定义组成功且 id 为 custom_1', 'group' in created && created.group.id === 'custom_1', created)
    groups = 'groups' in created ? created.groups : groups
    check('nextCustomGroupId 递增', nextCustomGroupId(groups) === 'custom_2', nextCustomGroupId(groups))

    const renamed = renameGroup(groups, 'custom_1', '  我的组改名  ')
    check('自定义组可改名', renamed !== null && renamed.find((g) => g.id === 'custom_1')?.name === '我的组改名', renamed)
    groups = renamed ?? groups
    check('内置组拒绝改名', renameGroup(groups, 'position.xyz', 'x') === null)

    const added = addGroupMembers(groups, 'custom_1', ['roll'], catalog)
    check('增成员后组变宽', !added.error && added.groups.find((g) => g.id === 'custom_1')?.members.length === 3, added.error)
    groups = added.groups
    const removed = removeGroupMembers(groups, 'custom_1', ['roll'])
    check('删成员回到两成员', removed !== null && removed.find((g) => g.id === 'custom_1')?.members.length === 2, removed)
    groups = removed ?? groups

    const deleted = deleteGroup(groups, 'custom_1')
    check('自定义组可删', deleted !== null && deleted.every((g) => g.id !== 'custom_1'))
    groups = deleted ?? groups
    check('内置组拒绝删除', deleteGroup(groups, 'position.xyz') === null)

    const bad = createCustomGroup(groups, { name: '', track: 'CAMERA', members: ['not.a.field'] }, catalog)
    check('非法成员 / 空名本地拒绝', 'error' in bad && bad.error !== undefined, bad)
  }

  // ── 自定义组写入 doc.authoring.groups：不进撤销；serializeDoc 不含 authoring ─
  {
    const { store, doc } = openStore(catalog, baseObjects)
    const service = new DocumentServiceImpl({ catalog, transport: new MemoryTransport(), diagnostics: new MemorySink() })
    service.store.open(structuredClone(doc), 'verify.json')

    const registry = loadAuthoringGroups(catalog)
    const draft = createCustomGroup(registry.groups, { name: '持久化组', track: 'CAMERA', members: ['roll'] }, catalog)
    check('服务层写入前先造好草稿', 'group' in draft, draft)
    const persisted = customGroupsToJson('groups' in draft ? draft.groups : [])
    const outcome = service.setAuthoringGroups(persisted)
    check('setAuthoringGroups 成功', outcome.ok, outcome.error)
    check('authoringGroups 读回一致', service.authoringGroups().length === 1, service.authoringGroups())

    const rollOutcome = service.commit({ kind: 'object.setValue', clipKey: serviceClipKey(service), path: 'roll', value: 0 })
    check('普通命令提交成功', rollOutcome.ok, rollOutcome.error)
    service.undo()
    check('撤销普通命令不回退 authoring 组', service.authoringGroups().length === 1, service.authoringGroups())

    const serialized = JSON.stringify(serializeDoc(service.store.doc as ScriptDoc))
    check('serializeDoc 不含 authoring 段', !serialized.includes('authoring'), serialized.slice(0, 120))
  }

  // ── 07-02 位置可见性矩阵逐行 ─────────────────────────────────────────────
  {
    const worldRel = projectPositionBar({})
    check('relative+world：origin 坐标隐藏', !worldRel.cells['position_origin_x'].visible, worldRel.cells['position_origin_x'])
    check('relative+world：facing_source 隐藏', !worldRel.cells['facing_source'].visible)
    check('relative+world：facing_entity 隐藏', !worldRel.cells['facing_entity'].visible)

    const base = projectPositionBar({ position_space: { value: 'base' }, position_origin: { value: 'line:player' } })
    check('base + selector origin：facing_source 可见', base.cells['facing_source'].visible)
    check('base 轴标签 fwd/up/right', base.axisLabels[0] === 'fwd' && base.axisLabels[1] === 'up' && base.axisLabels[2] === 'right', base.axisLabels)

    const coord = projectPositionBar({ position_origin: { value: 'coordinate' } })
    check('coordinate 原点三轴可见且空值占位 0',
      coord.cells['position_origin_x'].visible && coord.cells['position_origin_x'].placeholder.includes('0'),
      coord.cells['position_origin_x'].placeholder)

    const absolute = projectPositionBar({ position_mode: { value: 'absolute' }, position_origin: { value: 'coordinate' }, facing_target: { value: '@p' } })
    check('absolute：space 被锁 world 标注', absolute.cells['position_space'].note.length > 0, absolute.cells['position_space'].note)
    check('absolute：origin 不读取', !absolute.cells['position_origin'].read)
    const clearObjects: JsonObject = { position_origin: { value: 'coordinate' }, facing_target: { value: '@p' } }
    check('absolute：清除命令覆盖已存在路径', planClearIgnoredAbsolute('cam1', clearObjects).length >= 2,
      planClearIgnoredAbsolute('cam1', clearObjects).map((c) => (c as { path: string }).path))
    check('忽略路径清单含方向源字段', ABSOLUTE_IGNORED_PATHS.includes('facing_entity') && ABSOLUTE_IGNORED_PATHS.includes('position_origin'))

    const conflict = facingAutoState('@p', '@e', 'player')
    check('auto 目标与实体同时非空 → 冲突阻止', conflict.conflict && conflict.warning !== null, conflict)
    const clean = facingAutoState('', '@e', 'coordinate')
    check('auto 单实体非冲突', !clean.conflict, clean)
  }

  // ── 位置行装饰器：base 标签 / 过滤 / 不读取原因 ────────────────────────────
  {
    const { store, doc, clipKey, objects } = openStore(catalog, baseObjects)
    const rows = propertyRowsFor({ clipKey, trackType: 'CAMERA', objects, catalog })
    const baseRows = { ...objects, position_space: { value: 'base' } }
    const decorated = decoratePositionRows(rows, { trackType: 'CAMERA', objects: baseRows, catalog })
    const byPath = Object.fromEntries(decorated.rows.map((row) => [row.path, row]))
    check('base 下 x/y/z 标签 fwd/up/right',
      byPath['position.x']?.label === 'fwd' && byPath['position.y']?.label === 'up' && byPath['position.z']?.label === 'right',
      [byPath['position.x']?.label, byPath['position.y']?.label, byPath['position.z']?.label])
    check('装饰后三轴行仍在', byPath['position.x'] !== undefined)

    const absoluteRows = decoratePositionRows(rows, { trackType: 'CAMERA', objects: { ...objects, position_mode: { value: 'absolute' } }, catalog })
    const facingSourceRow = absoluteRows.rows.find((row) => row.path === 'facing_source')
    check('absolute 下 facing_source 不读取（过滤或标注原因）',
      facingSourceRow === undefined || facingSourceRow.unavailableReason !== undefined,
      facingSourceRow?.unavailableReason)
    const originRow = absoluteRows.rows.find((row) => row.path === 'position_origin')
    check('absolute 下 origin 行标注不读取', originRow?.unavailableReason !== undefined, originRow?.unavailableReason)
  }

  // ── 07-03 五形态往返 / 结构 id 反例 / look_at 分支与 part 越界 ──────────────
  {
    const samples = ['player', 'coordinate', 'block:diamond', 'block:diamond:16', '@p', 'uuid:123e4567-e89b-12d3-a456-426614174000', 'structure:castle']
    for (const raw of samples) {
      const round = pointSourceRoundTrip(raw)
      check(`五形态往返 ${raw}`, round, round)
      const draft = draftPointSource(raw, {}, 16)
      const validation = validatePointDraft('facing_target', draft)
      check(`五形态表单校验通过 ${raw}`, validation.ok, validation.issues)
    }

    for (const reserved of ['player', 'coordinate']) {
      check(`结构 id 撞保留字反例 ${reserved}`, !isStructureId(reserved))
    }
    const badStructure = validatePointDraft('facing_target', { kind: 'structure', text: 'player', radius: 16, coords: [null, null, null] })
    check('结构 id 非法本地拒绝', !badStructure.ok && badStructure.issues.length > 0, badStructure.issues)

    const entity = draftLookAt({ look_at: 'entity', look_at_selector: '@e', 'look_at_part.x': 0, 'look_at_part.y': 50, 'look_at_part.z': 101 })
    const entityIssues = validateLookAtDraft(entity)
    check('look_at entity part 越界被拒', entityIssues.some((issue) => issue.field === 'look_at_part'), entityIssues)
    const entityOk = draftLookAt({ look_at: 'entity', look_at_selector: '@e', 'look_at_part.x': 0, 'look_at_part.y': 50, 'look_at_part.z': 100 })
    check('look_at entity part 0-100 通过', validateLookAtDraft(entityOk).length === 0)

    const coordDraft = draftLookAt({ look_at: 'coordinate', look_at_target_structure: 'castle' })
    check('coordinate 结构非空时坐标禁用', coordsBlockedByStructure(coordDraft))
    check('coordinate 分支结构载荷可见', lookAtBranchState('coordinate').structureVisible)
    const noneState = lookAtBranchState('none')
    check('none 分支载荷全隐藏且标注保留值', !noneState.selectorVisible && noneState.legacyNote.length > 0)
  }

  // ── 07-04 朝向三段分支 / 两基准独立 / 线退化 / 锁叠加 / 角度不归一化 ────────
  {
    const manual = projectOrientationBar({ orient: { value: 'manual' } }, {})
    check('manual 支路：yaw/pitch 可用', manual.state.disabled['yaw'] === undefined && manual.state.disabled['pitch'] === undefined)
    check('manual：roll 永不被注视支路压住', manual.state.disabled['roll'] === undefined)

    const tangentNoLine = projectOrientationBar({ orient: { value: 'tangent' } }, { hasTangent: false })
    check('tangent 无切线：回退 manual，yaw/pitch 可用', tangentNoLine.state.disabled['yaw'] === undefined, tangentNoLine.state.branch)

    const lookAtEntity = projectOrientationBar({ look_at: { value: 'entity' }, look_at_selector: { value: '@e' }, orient: { value: 'manual' } }, { lookAtResolvable: true })
    check('look_at=entity 可解析：注视支路', lookAtEntity.state.branch === 'look_at', lookAtEntity.state.branch)
    check('注视支路：yaw/pitch 被禁用', lookAtEntity.state.disabled['yaw'] !== undefined && lookAtEntity.state.disabled['pitch'] !== undefined)

    const twoBases = readOrientationValues({ yaw_base: { value: 'entity' }, pitch_base: { value: 'world' } }, {})
    check('两基准独立：yaw=entity pitch=world', twoBases.yaw_base === 'entity' && twoBases.pitch_base === 'world', twoBases)

    const degenerate = lineBaseAngles({ x: 0, z: 0 }, { x: 0, z: 0 })
    check('线基准水平退化：两端角度取 0 并回退 world', degenerate.warning !== null && degenerate.yaw === 0, degenerate)

    check('锁叠加：基准 + 角度', manualAngle(null, 40, 30) === 70)
    check('角度不归一化：720 原样', manualAngle(null, 0, 720) === 720)
    check('角度不归一化：-540 原样', manualAngle(null, 0, -540) === -540)

    const orientedRows = propertyRowsFor({ clipKey: 'cam1', trackType: 'CAMERA', objects: baseObjects, catalog })
    const decorated = decorateOrientationRows(orientedRows, { trackType: 'CAMERA', objects: { orient: { value: 'tangent' } }, catalog, flags: { hasTangent: false } })
    const yawRow = decorated.rows.find((row) => row.path === 'yaw')
    check('tangent 无切线：角度行标注回退说明', yawRow?.unavailableReason?.includes('切线缺失') === true, yawRow?.unavailableReason)
    const offsetRow = decorated.rows.find((row) => row.path === 'yaw_offset')
    check('切线偏移 requires 不满足：禁用但帧保留标注', offsetRow?.unavailableReason !== undefined, offsetRow?.unavailableReason)
  }

  // ── motion_* 不误入作者组合面板 ────────────────────────────────────────────
  {
    const rows = propertyRowsFor({ clipKey: 'cam1', trackType: 'CAMERA', objects: baseObjects, catalog })
    const motionRows = rows.filter((row) => row.path.startsWith('motion_'))
    check('motion_* 不进效果面板', motionRows.every((row) => row.def === undefined || panelOf(row.def) === 'properties'), rowPaths(rows))
    const orientRow = rows.find((row) => row.path === 'orient')
    check('orient 是静态值字段（mode=value）', orientRow?.mode === 'value', orientRow?.mode)
  }
}

function serviceClipKey(service: DocumentServiceImpl): string {
  const handles = service.store.registry.handles()
  return handles[0]?.key ?? ''
}

// ── 直跑段 ──────────────────────────────────────────────────────────────────

function main(): void {
  let ok = 0
  const failures: Array<{ label: string; actual?: unknown }> = []
  const check: SliceCheck = (label, condition, actual) => {
    if (condition) {
      ok += 1
      return
    }
    failures.push({ label, actual })
  }
  runAuthoringChecks(check)
  for (const failure of failures) {
    console.error(`FAIL ${failure.label}`, failure.actual)
  }
  console.log(`summary ok=${ok} fail=${failures.length}`)
  if (failures.length > 0) {
    process.exitCode = 1
  }
}

if (typeof process !== 'undefined' && process.argv[1] !== undefined && process.argv[1].endsWith('verify07Authoring.ts')) {
  main()
}
