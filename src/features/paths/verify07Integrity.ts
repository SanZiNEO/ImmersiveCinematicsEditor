/**
 * 07-05 §四 自检切片：路径引用完整性五个入口的「扫描 → 阻止 → 处理选项 → 同一次 compound」。
 *
 * 运行：`node --experimental-strip-types src/features/paths/verify07Integrity.ts`
 *
 * 断言走真 `DocStore` + 真 catalog + 真 `commit`（装配写法自 `src/workbench/verify-07.ts`
 * 复制同构，不改它）；不加载 `.vue` / DOM。
 *
 * 覆盖：
 * - 删端点被扫描出来（`pathsUsingEndpoint`）；
 * - 区间内插帧被扫描出来（`pathsBreakingOnInsert`）；
 * - 移动端点被扫描出来（`pathsBreakingOnMove`）；
 * - 确认后一次撤销全回退，其余路径原样；
 * - 取消后文档零变化；
 * - 删片段带路径同一次撤销；
 * - 改 id 同步 `paths[].clip` 且路径 id 不变；
 * - id 冲突被命令层拦下。
 */
import type { CatalogIndex } from '../../core/schema/index.ts'
import { buildCatalog, indexCatalog } from '../../core/schema/index.ts'
import { metaKeys } from '../../core/doc/keys.ts'
import { parseDoc } from '../../core/doc/parse.ts'
import { DocStore } from '../../core/doc/store.ts'
import type { DocCommand } from '../../core/doc/commands.ts'
import type { JsonObject, JsonValue, ScriptDoc } from '../../core/doc/types.ts'
import { pathEntries } from '../../core/paths/collection.ts'
import {
  pathsBreakingOnInsert,
  pathsBreakingOnMove,
  pathsOfClip,
  pathsUsingEndpoint,
} from './integrity.ts'

export type SliceCheck = (label: string, condition: boolean, actual?: unknown) => void

/** 「删除这些路径」命令：只移除受影响条目，其余条目原样留在 `paths[]`。 */
function removalCommand(affected: readonly { id: string }[]): DocCommand | null {
  const ids = [...new Set(affected.map((item) => item.id))]
  if (ids.length === 0) {
    return null
  }
  return { kind: 'path.writeBatch', removeIds: ids, entries: [] }
}

// ── 真 store 装配（自 verify-07.ts 复制同构写法，不改 verify-07.ts） ──────────

function positionObjects(): JsonObject {
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

function clip(id: string): JsonObject {
  return { id, start_time: 0, duration: 2, objects: positionObjects() }
}

function pathEntry(id: string, clipId: string, from: number, to: number): JsonObject {
  return {
    id,
    clip: clipId,
    from,
    to,
    axes: ['x', 'y', 'z'],
    geometry: { type: 'line' },
  }
}

function script(clips: JsonObject[], paths: JsonObject[]): JsonObject {
  return {
    meta: { id: 'verify07Integrity', name: 'Verify 07 Integrity', author: '' },
    timeline: { tracks: [{ type: 'CAMERA', clips }] },
    paths,
  }
}

function openStore(catalog: CatalogIndex, raw: JsonObject): { store: DocStore; doc: ScriptDoc } {
  const keys = metaKeys(catalog)
  const parsed = parseDoc(raw, { metaKeys: keys })
  if (!parsed.ok) {
    throw new Error(`fixture parse failed: ${JSON.stringify(parsed.issues)}`)
  }
  const store = new DocStore({ catalog, metaKeys: keys })
  store.open(parsed.doc, 'verify07-integrity.json')
  return { store, doc: parsed.doc }
}

function handleOf(store: DocStore, clipId: string) {
  return store.registry.handles().find((handle) => handle.id === clipId)
}

function clipIds(doc: ScriptDoc): string[] {
  const tracks = doc.timeline.tracks as JsonObject[]
  return tracks.flatMap((track) => (track.clips as JsonObject[]).map((item) => String(item.id)))
}

function clipById(doc: ScriptDoc, clipId: string): JsonObject | undefined {
  const tracks = doc.timeline.tracks as JsonObject[]
  for (const track of tracks) {
    const clips = track.clips as JsonObject[]
    const found = clips.find((item) => item.id === clipId)
    if (found !== undefined) {
      return found
    }
  }
  return undefined
}

function framesOfClip(doc: ScriptDoc, clipId: string, path: string): JsonValue[] {
  const clip = clipById(doc, clipId)
  if (clip === undefined) {
    return []
  }
  const objects = clip.objects as JsonObject
  const node = objects[path] as JsonObject
  return Array.isArray(node.keyframes) ? node.keyframes : []
}

function pathIds(doc: ScriptDoc): string[] {
  return pathEntries(doc).map((entry) => entry.id)
}

function pathById(doc: ScriptDoc, id: string): JsonObject | undefined {
  return pathEntries(doc).find((entry) => entry.id === id)?.entry
}

// ── 断言主体 ──────────────────────────────────────────────────────────────

export function runIntegrityChecks(check: SliceCheck): void {
  const catalog = indexCatalog(buildCatalog('verify-07'))

  // ── 1. 纯扫描：删端点 / 区间内插帧 / 移动端点 ────────────────────────────
  {
    const { doc } = openStore(
      catalog,
      script([clip('c1')], [pathEntry('p_a', 'c1', 0, 1), pathEntry('p_b', 'c1', 0, 1)]),
    )

    const byEndpoint = pathsUsingEndpoint(doc, 'c1', 0).map((item) => item.id)
    check('删端点：0s 端点路径被扫描出来', byEndpoint.includes('p_a'), byEndpoint)

    const byInsert = pathsBreakingOnInsert(doc, 'c1', 0.5).map((item) => item.id)
    check('区间内插帧：0.5s 路径被扫描出来', byInsert.includes('p_b'), byInsert)

    const byMove = pathsBreakingOnMove(doc, 'c1', 0, 0.3).map((item) => item.id)
    check('移动端点：0s→0.3s 路径被扫描出来', byMove.includes('p_a'), byMove)

    const noHit = pathsUsingEndpoint(doc, 'c1', 1.5).map((item) => item.id)
    check('非端点时间扫描为空', noHit.length === 0, noHit)

    const otherClip = pathsOfClip(doc, 'nope').map((item) => item.id)
    check('不存在的片段扫描为空', otherClip.length === 0, otherClip)
  }

  // ── 2. 确认：帧操作 + 路径删除同一次 compound，一次撤销全回退 ────────────
  {
    const { store, doc } = openStore(
      catalog,
      script([clip('c1'), clip('c2')], [pathEntry('p_a', 'c1', 0, 1), pathEntry('p_c', 'c2', 0, 1)]),
    )
    const handle = handleOf(store, 'c1')
    check('夹具：找到 c1 句柄', handle !== undefined)
    if (handle === undefined) {
      return
    }

    const affected = pathsUsingEndpoint(doc, 'c1', 0)
    check('删帧前扫描出受影响路径', affected.map((item) => item.id).join() === 'p_a', affected)

    const frameCommand: DocCommand = {
      kind: 'object.removeKeyframe',
      clipKey: handle.key,
      path: 'position.x',
      time: 0,
    }
    const removal = removalCommand(affected)
    check('删路径命令可构造', removal !== null)
    const plan: DocCommand = removal === null
      ? frameCommand
      : { kind: 'compound', commands: [removal, frameCommand] }
    check('确认计划合成一次 compound', plan.kind === 'compound', plan.kind)

    const before = JSON.stringify(doc.root)
    const outcome = store.commit(plan)
    check('确认后 compound 提交成功', outcome.ok, outcome)

    const afterIds = pathIds(store.doc!)
    check('确认后受影响路径被删除', !afterIds.includes('p_a'), afterIds)
    check('其余片段路径原样保留', afterIds.includes('p_c'), afterIds)
    check('确认后端点帧被删除', framesOfClip(store.doc!, 'c1', 'position.x').length === 1,
      framesOfClip(store.doc!, 'c1', 'position.x'))

    const undone = store.undo()
    check('一次撤销回退成功', undone)
    const restoredIds = pathIds(store.doc!)
    check('撤销后受影响路径恢复', restoredIds.includes('p_a'), restoredIds)
    check('撤销后其余路径仍在', restoredIds.includes('p_c'), restoredIds)
    check('撤销后端点帧恢复', framesOfClip(store.doc!, 'c1', 'position.x').length === 2,
      framesOfClip(store.doc!, 'c1', 'position.x'))
    check('撤销后文档回到提交前', JSON.stringify(store.doc!.root) === before)
  }

  // ── 3. 取消：不提交计划，文档零变化 ─────────────────────────────────────
  {
    const { store, doc } = openStore(
      catalog,
      script([clip('c1')], [pathEntry('p_a', 'c1', 0, 1)]),
    )
    const handle = handleOf(store, 'c1')
    check('夹具：找到 c1 句柄', handle !== undefined)
    if (handle === undefined) {
      return
    }

    const before = JSON.stringify(doc.root)
    const affected = pathsUsingEndpoint(doc, 'c1', 0)
    check('取消前扫描出受影响路径', affected.map((item) => item.id).join() === 'p_a', affected)

    // 作者点「取消」：扫描后不构造、不提交任何命令，文档零变化。
    removalCommand(affected)

    check('取消后文档零变化', JSON.stringify(store.doc!.root) === before)
    check('取消后受影响路径仍在', pathIds(store.doc!).includes('p_a'))
    check('取消后端点帧仍在', framesOfClip(store.doc!, 'c1', 'position.x').length === 2,
      framesOfClip(store.doc!, 'c1', 'position.x'))
  }

  // ── 4. 删片段：路径删除 + 片段删除同一次 compound，一次撤销全回退 ────────
  {
    const { store, doc } = openStore(
      catalog,
      script([clip('c1'), clip('c2')], [pathEntry('p_a', 'c1', 0, 1), pathEntry('p_c', 'c2', 0, 1)]),
    )
    const handle1 = handleOf(store, 'c1')
    check('夹具：找到 c1 句柄', handle1 !== undefined)
    if (handle1 === undefined) {
      return
    }

    const affected = pathsOfClip(doc, 'c1')
    check('删片段前扫描出引用路径', affected.map((item) => item.id).join() === 'p_a', affected)

    const removal = removalCommand(affected)
    check('删路径命令可构造', removal !== null)
    if (removal === null) {
      return
    }
    const plan: DocCommand = {
      kind: 'compound',
      commands: [removal, { kind: 'timeline.deleteClips', clipKeys: [handle1.key] }],
    }

    const outcome = store.commit(plan)
    check('删片段 compound 提交成功', outcome.ok, outcome)
    check('确认后片段被删除', !clipIds(store.doc!).includes('c1'), clipIds(store.doc!))
    const afterIds = pathIds(store.doc!)
    check('确认后引用路径被删除', !afterIds.includes('p_a'), afterIds)
    check('其余片段与路径原样', clipIds(store.doc!).includes('c2') && afterIds.includes('p_c'),
      { clips: clipIds(store.doc!), paths: afterIds })

    const undone = store.undo()
    check('一次撤销回退成功', undone)
    check('撤销后片段恢复', clipIds(store.doc!).includes('c1'), clipIds(store.doc!))
    const restoredIds = pathIds(store.doc!)
    check('撤销后路径恢复', restoredIds.includes('p_a') && restoredIds.includes('p_c'), restoredIds)
  }

  // ── 5. 改 id：同步 paths[].clip，路径 id 不变；冲突被拦 ─────────────────
  {
    const { store } = openStore(
      catalog,
      script([clip('c1'), clip('c2')], [pathEntry('p_a', 'c1', 0, 1)]),
    )
    const handle1 = handleOf(store, 'c1')
    check('夹具：找到 c1 句柄', handle1 !== undefined)
    if (handle1 === undefined) {
      return
    }

    const renamed = store.commit({
      kind: 'clip.setId',
      clipKey: handle1.key,
      value: 'c1x',
      updateReferences: true,
    })
    check('改 id 提交成功', renamed.ok, renamed)
    check('片段 id 已改为 c1x', handleOf(store, 'c1x') !== undefined)

    const pathAfter = pathById(store.doc!, 'p_a')
    check('paths[].clip 同步为新 id', pathAfter !== undefined && pathAfter.clip === 'c1x', pathAfter?.clip)
    check('路径自身 id 不变', pathAfter !== undefined && pathAfter.id === 'p_a', pathAfter?.id)

    const conflict = store.commit({
      kind: 'clip.setId',
      clipKey: handle1.key,
      value: 'c2',
      updateReferences: true,
    })
    check('id 冲突被阻止', !conflict.ok, conflict)
    check('冲突后片段 id 未变', handleOf(store, 'c1x') !== undefined && handleOf(store, 'c2') !== undefined,
      clipIds(store.doc!))
    const pathConflict = pathById(store.doc!, 'p_a')
    check('冲突后路径引用未变', pathConflict !== undefined && pathConflict.clip === 'c1x', pathConflict?.clip)

    store.undo()
    const pathRestored = pathById(store.doc!, 'p_a')
    check('撤销改名后引用回到旧 id', pathRestored !== undefined && pathRestored.clip === 'c1',
      pathRestored?.clip)
  }
}

// ── 直跑段 ─────────────────────────────────────────────────────────────────

const direct = process.argv[1] !== undefined
  && process.argv[1].replace(/\\/g, '/').endsWith('verify07Integrity.ts')

if (direct) {
  let ok = 0
  let fail = 0
  runIntegrityChecks((label, condition, actual) => {
    if (condition) {
      ok += 1
      console.log(`ok   ${label}`)
    } else {
      fail += 1
      console.log(`FAIL ${label}: ${typeof actual === 'string' ? actual : JSON.stringify(actual)}`)
    }
  })
  console.log(`summary ok=${ok} fail=${fail}`)
  if (fail > 0) {
    process.exitCode = 1
  }
}
