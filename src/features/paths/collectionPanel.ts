/**
 * 07-05 路径集合面板的纯逻辑：行视图、筛选、新建四步状态机、默认条目、命令产出、
 * 诊断按 pathId 聚合、草稿按 pathId 缓存。
 *
 * 红线：本模块不 import `.vue`、不碰 DOM、不写文档；所有写操作由调用方把这里产出的
 * `DocCommand` 交给命令层 commit。草稿只存在面板会话里，不落盘。
 */
import type { CatalogIndex } from '../../core/schema/index.ts'
import type { DocCommand } from '../../core/doc/commands.ts'
import type { JsonObject, ScriptDoc, Selection } from '../../core/doc/types.ts'
import { clipIdOf, hasObjects } from '../../core/doc/clip.ts'
import { clipPositionNodes, eachClip } from '../../core/doc/identity.ts'
import {
  defaultPathEntry,
  findClipById,
  nextEndpoint,
  nextPathId,
  overlapNotes,
  pathCollectionIssues,
  pathEntries,
  readAxes,
  startEndpointOptions,
} from '../../core/paths/collection.ts'
import { timingKind } from '../../core/paths/timing.ts'
import {
  PATH_AXES,
  PATH_ID_EDITOR_PATTERN,
  type PathAxis,
  type PathFieldIssue,
} from '../../core/paths/types.ts'

// ── 行视图 ────────────────────────────────────────────────────────────────

/** 列表一行的派生视图（保持 `paths[]` 顺序）。 */
export interface PathRowView {
  index: number
  id: string
  clipId: string
  from: number
  to: number
  axes: PathAxis[]
  geometryType: string
  timingKind: 'linear' | 'keyframes'
  issues: PathFieldIssue[]
  issueCount: number
  /** 部分重叠提示（完全重复由诊断拦下，不进这里）。 */
  overlaps: Array<{ otherId: string; winnerId: string; message: string }>
  /** 同片段同端点对重复（结构诊断）。 */
  duplicatePair: boolean
}

/** 从快照构建全部行视图；诊断复用 `pathCollectionIssues` + `validatePathEntry`。 */
export function buildPathRows(doc: ScriptDoc, catalog: CatalogIndex): PathRowView[] {
  const collectionIssues = pathCollectionIssues(doc, catalog)
  const duplicatePairs = new Set<string>()
  for (const issue of collectionIssues) {
    if (issue.message.includes('端点对重复')) {
      duplicatePairs.add(issue.jsonPath)
    }
  }
  const views = pathEntries(doc)
  return views.map((view) => {
    const overlaps = overlapNotes(doc, view.index)
    const duplicatePair = duplicatePairs.has(`paths[${view.index}].from`)
    return {
      index: view.index,
      id: view.id,
      clipId: view.clipId,
      from: view.from,
      to: view.to,
      axes: view.axes,
      geometryType: view.geometryType,
      timingKind: view.timingKind,
      issues: view.issues,
      issueCount: view.issues.length,
      overlaps,
      duplicatePair,
    }
  })
}

// ── 筛选 ──────────────────────────────────────────────────────────────────

/** 面板筛选状态（只改显示，不落盘）。 */
export interface PathFilterState {
  /** 按片段 id 过滤；`null` = 全部片段。 */
  clipId: string | null
  /** 按 id 模糊搜索。 */
  search: string
  /** 只看有问题的路径。 */
  onlyIssues: boolean
}

export function emptyFilter(): PathFilterState {
  return { clipId: null, search: '', onlyIssues: false }
}

/** 按筛选条件过滤行；顺序保持文档顺序。 */
export function filterPathRows(rows: readonly PathRowView[], filter: PathFilterState): PathRowView[] {
  const query = filter.search.trim().toLowerCase()
  return rows.filter((row) => {
    if (filter.clipId !== null && row.clipId !== filter.clipId) {
      return false
    }
    if (filter.onlyIssues && row.issueCount === 0 && !row.duplicatePair) {
      return false
    }
    if (query !== '' && !row.id.toLowerCase().includes(query)) {
      return false
    }
    return true
  })
}

/** 文档里出现过的片段 id（筛选下拉用，保持首次出现顺序）。 */
export function clipIdsInUse(doc: ScriptDoc): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const view of pathEntries(doc)) {
    if (view.clipId !== '' && !seen.has(view.clipId)) {
      seen.add(view.clipId)
      result.push(view.clipId)
    }
  }
  return result
}

// ── 目标片段选项（新建下拉） ───────────────────────────────────────────────

/** 新建路径可选的目标片段。 */
export interface ClipTargetOption {
  /** 运行时片段 id；未设置为 `undefined`。 */
  clipId: string | undefined
  label: string
  trackType: string
  hasId: boolean
  nodeCount: number
  nodeTimes: number[]
  /** 非空 = 禁用并旁挂原因。 */
  disabledReason: string | null
}

/**
 * 新建下拉只列 CAMERA 片段；没有 id 或位置节点不足 2 个的片段禁用并给原因。
 * 端点时间只来自 `position.x/y/z` 关键帧并集，不看 `value` / `motion_*` / 路径自身。
 */
export function clipTargetOptions(doc: ScriptDoc): ClipTargetOption[] {
  const options: ClipTargetOption[] = []
  eachClip(doc, (clip, _inline, trackType) => {
    if (trackType !== 'CAMERA') {
      return
    }
    const clipId = clipIdOf(clip)
    const hasId = clipId !== undefined
    const nodeTimes = hasId ? clipPositionNodes(doc, clipId) : []
    let disabledReason: string | null = null
    if (!hasId) {
      disabledReason = '片段未设置 id（先在片段属性里设置片段 id）'
    } else if (!hasObjects(clip)) {
      disabledReason = '片段没有 objects（路径集合只支持 objects 片段）'
    } else if (nodeTimes.length < 2) {
      disabledReason = `位置节点不足（${nodeTimes.length} 个；至少 2 个）`
    }
    options.push({
      clipId,
      label: clipId ?? '未命名片段',
      trackType,
      hasId,
      nodeCount: nodeTimes.length,
      nodeTimes,
      disabledReason,
    })
  })
  return options
}

// ── 新建四步状态机 ────────────────────────────────────────────────────────

/** 新建步骤：选片段 → 选 A → 自动 B → 确认默认值。 */
export type NewDraftStep = 'clip' | 'from' | 'to' | 'defaults'

export interface NewDraftState {
  step: NewDraftStep
  clipId: string | null
  from: number | null
  to: number | null
}

export function initialNewDraft(): NewDraftState {
  return { step: 'clip', clipId: null, from: null, to: null }
}

/** 选片段：清空已选端点，回到选 A 步骤。 */
export function chooseClip(state: NewDraftState, clipId: string): NewDraftState {
  return { step: 'from', clipId, from: null, to: null }
}

/** 选起点 A：B 自动锁为 A 的下一个节点；A 取最后节点时 B 为空。 */
export function chooseFrom(doc: ScriptDoc, state: NewDraftState, from: number): NewDraftState {
  if (state.clipId === null) {
    return state
  }
  const to = nextEndpoint(doc, state.clipId, from)
  return {
    step: to === null ? 'from' : 'to',
    clipId: state.clipId,
    from,
    to,
  }
}

/** A 的可选节点（去掉最后一项）；端点只能来自节点并集，不接受自由输入。 */
export function fromEndpointOptions(doc: ScriptDoc, clipId: string | null): number[] {
  if (clipId === null) {
    return []
  }
  return startEndpointOptions(doc, clipId)
}

/** 给定 A 推导 B（A 不在并集或是最后节点时返回 null）。 */
export function resolvedTo(doc: ScriptDoc, clipId: string | null, from: number | null): number | null {
  if (clipId === null || from === null) {
    return null
  }
  return nextEndpoint(doc, clipId, from)
}

/** 新建前的本地拦截；`reasons` 为空才可确认。 */
export function draftConfirmCheck(
  doc: ScriptDoc,
  state: NewDraftState,
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (state.clipId === null) {
    reasons.push('请选择目标片段')
    return { ok: false, reasons }
  }
  const clip = findClipById(doc, state.clipId)
  if (clip === undefined) {
    reasons.push(`未知片段引用: ${state.clipId}`)
    return { ok: false, reasons }
  }
  const nodes = clipPositionNodes(doc, state.clipId)
  if (nodes.length < 2) {
    reasons.push(`位置节点不足（${state.clipId} 只有 ${nodes.length} 个；至少 2 个）`)
  }
  if (state.from === null) {
    reasons.push('请选择起点 A')
  }
  if (state.to === null) {
    reasons.push('A 已是最后一个节点，没有相邻终点 B')
  }
  if (state.from !== null && state.to !== null) {
    const duplicate = pathEntries(doc).some((view) => (
      view.clipId === state.clipId
      && view.from === state.from
      && view.to === state.to
    ))
    if (duplicate) {
      reasons.push('同一片段的端点对重复（起点更晚者生效，不能再建相同端点对）')
    }
  }
  return { ok: reasons.length === 0, reasons }
}

/** 生成默认条目（id=p_<n>、三轴、line 几何、timing 省略）；端点不合法返回 null。 */
export function buildDefaultEntry(doc: ScriptDoc, state: NewDraftState): JsonObject | null {
  if (state.clipId === null || state.from === null) {
    return null
  }
  return defaultPathEntry(doc, state.clipId, state.from)
}

/** 下一个默认路径 id（`p_<n>`，全局最大 + 1）。 */
export function nextDraftId(doc: ScriptDoc): string {
  return nextPathId(doc)
}

// ── id 校验 ───────────────────────────────────────────────────────────────

/** 校验路径 id；返回 null 表示合法，否则返回可读原因。 */
export function validateDraftId(id: string, existingIds: readonly string[]): string | null {
  if (id.length === 0) {
    return 'id 不能为空'
  }
  if (!PATH_ID_EDITOR_PATTERN.test(id)) {
    return `id 必须以字母开头，后接字母 / 数字 / 下划线（1~63 字符），实际: ${id}`
  }
  if (existingIds.includes(id)) {
    return `id 已被占用: ${id}`
  }
  return null
}

// ── 草稿缓存（按 pathId；未提交不落盘） ────────────────────────────────────

/** 草稿表：pathId → 条目草稿。面板会话内持有，关闭重开由父面板恢复。 */
export type PathDraftMap = Map<string, JsonObject>

export function draftFor(map: PathDraftMap, pathId: string): JsonObject | undefined {
  return map.get(pathId)
}

export function setDraft(map: PathDraftMap, pathId: string, entry: JsonObject): void {
  map.set(pathId, structuredClone(entry))
}

export function clearDraft(map: PathDraftMap, pathId: string): void {
  map.delete(pathId)
}

export function clearAllDrafts(map: PathDraftMap): void {
  map.clear()
}

// ── 命令产出 ──────────────────────────────────────────────────────────────

/** 新建一条路径：追加到 `paths[]`。 */
export function createPathCommand(entry: JsonObject): DocCommand {
  return { kind: 'path.writeBatch', removeIds: [], entries: [entry] }
}

/**
 * 保存既有路径的编辑（含改名）：先按旧 id 删除，再写回新条目。
 * 一次 commit、一次撤销；命令层任一成员失败整次回滚。
 */
export function updatePathCommand(oldId: string, entry: JsonObject): DocCommand {
  return { kind: 'path.writeBatch', removeIds: [oldId], entries: [entry] }
}

/** 复制一条路径：新条目带新 id，几何 / 区间原样复制。 */
export function duplicatePathCommand(source: JsonObject, newId: string): DocCommand {
  const clone = structuredClone(source)
  clone.id = newId
  return { kind: 'path.writeBatch', removeIds: [], entries: [clone] }
}

/** 删除一条路径。 */
export function removePathCommand(pathId: string): DocCommand {
  return { kind: 'path.remove', pathId }
}

// ── 选择联动 ───────────────────────────────────────────────────────────────

/** 路径选择用共享 Selection 的 `pathId`，不用数组下标。 */
export function pathSelection(pathId: string): Selection {
  return { domain: 'path', pathId }
}

// ── 公共字段读取（编辑器表单回显用） ───────────────────────────────────────

/** 读条目 axes；缺省三轴（与 core `readAxes` 同口径）。 */
export function entryAxes(entry: JsonObject | undefined): PathAxis[] {
  if (entry === undefined) {
    return [...PATH_AXES]
  }
  return readAxes(entry.axes)
}

/** 读条目 timing 类型（缺省 = linear）。 */
export function entryTimingKind(entry: JsonObject | undefined): 'linear' | 'keyframes' {
  if (entry === undefined) {
    return 'linear'
  }
  return timingKind(entry.timing)
}
