/**
 * 07-05 路径集合模型：条目视图、端点选择、重复 / 重叠判定、诊断。
 *
 * 端点只来自目标片段 `position.x/y/z` 的关键帧时间并集（`clipPositionNodes`），
 * 不看 `value`、不看 `motion_*`、不看路径自身；两端必须相邻。
 */
import type { CatalogIndex } from '../schema/index.ts'
import type { DocIssue, JsonObject, JsonValue, ScriptDoc, Severity } from '../doc/types.ts'
import { clipIdOf, hasObjects } from '../doc/clip.ts'
import { isJsonObject } from '../doc/json.ts'
import { clipPositionNodes, eachClip, PATH_TIME_EPSILON } from '../doc/identity.ts'
import { PATH_KEYS } from '../doc/keys.ts'
import { validateGeometry } from './geometry.ts'
import { timingKind, validateTiming } from './timing.ts'
import type { PathFieldIssue } from './types.ts'
import { PATH_AXES, PATH_ID_JAVA_PATTERN, isKnownGeometryType } from './types.ts'

export interface PathEntryView {
  index: number
  entry: JsonObject
  id: string
  clipId: string
  from: number
  to: number
  axes: Array<'x' | 'y' | 'z'>
  geometryType: string
  timingKind: 'linear' | 'keyframes'
  issues: PathFieldIssue[]
}

export interface PathOverlapNote {
  otherId: string
  /** 胜出条目 id（起点更晚者；起点相同按 paths[] 靠前者）。 */
  winnerId: string
  message: string
}

/** 目标片段查找（重复 id 取第一个，与结构检查一致）。 */
export function findClipById(doc: ScriptDoc, clipId: string): JsonObject | undefined {
  let found: JsonObject | undefined
  eachClip(doc, (clip) => {
    if (found === undefined && clipIdOf(clip) === clipId) {
      found = clip
    }
  })
  return found
}

/** 全部路径条目视图（保持 paths[] 顺序）。 */
export function pathEntries(doc: ScriptDoc): PathEntryView[] {
  const raw = doc.root.paths
  if (!Array.isArray(raw)) {
    return []
  }
  const views: PathEntryView[] = []
  for (let index = 0; index < raw.length; index += 1) {
    const entry = raw[index]
    if (!isJsonObject(entry)) {
      continue
    }
    const issues = validatePathEntry(doc, entry, index)
    views.push({
      index,
      entry,
      id: typeof entry.id === 'string' ? entry.id : '',
      clipId: typeof entry.clip === 'string' ? entry.clip : '',
      from: typeof entry.from === 'number' ? entry.from : Number.NaN,
      to: typeof entry.to === 'number' ? entry.to : Number.NaN,
      axes: readAxes(entry.axes),
      geometryType: isJsonObject(entry.geometry) && typeof entry.geometry.type === 'string'
        ? entry.geometry.type
        : '',
      timingKind: timingKind(entry.timing),
      issues,
    })
  }
  return views
}

/** 校验一条路径条目；field 相对条目（`from` / `geometry.radius` …）。 */
export function validatePathEntry(doc: ScriptDoc, entry: JsonObject, index: number): PathFieldIssue[] {
  const issues: PathFieldIssue[] = []
  const prefix = `paths[${index}]`
  for (const key of Object.keys(entry)) {
    if (!PATH_KEYS.includes(key)) {
      issues.push({ field: `${prefix}.${key}`, message: `未知键（可用: ${PATH_KEYS.join(' / ')}）` })
    }
  }
  const id = entry.id
  if (typeof id !== 'string' || id.length === 0) {
    issues.push({ field: `${prefix}.id`, message: '缺失或不是非空字符串' })
  } else if (!PATH_ID_JAVA_PATTERN.test(id)) {
    issues.push({ field: `${prefix}.id`, message: `必须匹配 ${PATH_ID_JAVA_PATTERN.source}，实际: ${id}` })
  }
  const clipId = entry.clip
  if (typeof clipId !== 'string' || clipId.length === 0) {
    issues.push({ field: `${prefix}.clip`, message: '缺失或不是非空字符串（片段 id）' })
    return issues
  }
  const clip = findClipById(doc, clipId)
  if (clip === undefined) {
    issues.push({ field: `${prefix}.clip`, message: `未知片段引用: ${clipId}` })
    return issues
  }
  if (!hasObjects(clip)) {
    issues.push({ field: `${prefix}.clip`, message: `路径集合只支持 objects 片段（${clipId} 没有 objects）` })
    return issues
  }
  const from = entry.from
  const to = entry.to
  const fromValid = typeof from === 'number' && Number.isFinite(from)
  const toValid = typeof to === 'number' && Number.isFinite(to)
  if (!fromValid) {
    issues.push({ field: `${prefix}.from`, message: '需要有限数字（片段局部秒）' })
  }
  if (!toValid) {
    issues.push({ field: `${prefix}.to`, message: '需要有限数字（片段局部秒）' })
  }
  if (fromValid && toValid && !(from < to)) {
    issues.push({ field: `${prefix}.to`, message: `to 必须大于 from（from=${from}, to=${to}）` })
  }
  if (Object.prototype.hasOwnProperty.call(entry, 'axes')) {
    const raw = entry.axes
    if (!Array.isArray(raw) || raw.length === 0) {
      issues.push({ field: `${prefix}.axes`, message: '需要非空数组（x / y / z 的子集）' })
    } else {
      for (let axisIndex = 0; axisIndex < raw.length; axisIndex += 1) {
        const axis = raw[axisIndex]
        if (typeof axis !== 'string' || !PATH_AXES.includes(axis as 'x' | 'y' | 'z')) {
          issues.push({ field: `${prefix}.axes[${axisIndex}]`, message: `未知轴 ${String(axis)}（可选: x, y, z）` })
        }
      }
    }
  }
  const geometry = entry.geometry
  for (const issue of validateGeometry(geometry as JsonValue | undefined, `${prefix}.geometry`)) {
    issues.push({ field: issue.field, message: issue.message })
  }
  if (Object.prototype.hasOwnProperty.call(entry, 'timing')) {
    for (const issue of validateTiming(entry.timing, `${prefix}.timing`)) {
      issues.push({ field: issue.field, message: issue.message })
    }
  }
  if (!fromValid || !toValid || !(from < to)) {
    return issues
  }
  const nodes = clipPositionNodes(doc, clipId)
  if (nodes.length < 2) {
    issues.push({ field: `${prefix}.clip`, message: `位置节点不足（${clipId} 只有 ${nodes.length} 个；至少 2 个）` })
    return issues
  }
  const fromIndex = exactNodeIndex(nodes, from as number)
  const toIndex = exactNodeIndex(nodes, to as number)
  if (fromIndex < 0) {
    issues.push({
      field: `${prefix}.from`,
      message: `必须命中目标片段 ${clipId} 的 position 节点时间（可用: [${nodes.join(', ')}]，实际: ${from}）`,
    })
  }
  if (toIndex < 0) {
    issues.push({
      field: `${prefix}.to`,
      message: `必须命中目标片段 ${clipId} 的 position 节点时间（可用: [${nodes.join(', ')}]，实际: ${to}）`,
    })
  }
  if (fromIndex < 0 || toIndex < 0) {
    return issues
  }
  if (toIndex !== fromIndex + 1) {
    const next = fromIndex + 1 < nodes.length ? String(nodes[fromIndex + 1]) : '（无）'
    issues.push({
      field: `${prefix}.to`,
      message: `端点必须与 from 相邻（from=${nodes[fromIndex]} 的下一个节点 = ${next}，实际 to=${to}）`,
    })
  }
  return issues
}

/** 收集整套路径集合的诊断（结构检查用）。 */
export function pathCollectionIssues(doc: ScriptDoc, catalog: CatalogIndex): DocIssue[] {
  const issues: DocIssue[] = []
  const raw = doc.root.paths
  if (raw === undefined) {
    return issues
  }
  if (!Array.isArray(raw)) {
    issues.push({
      code: 'L25',
      severity: 'block',
      message: 'paths 需要数组（路径集合）',
      jsonPath: 'paths',
      source: 'local',
    })
    return issues
  }
  const idSeen = new Map<string, number>()
  const pairSeen = new Map<string, number>()
  for (let index = 0; index < raw.length; index += 1) {
    const entry = raw[index]
    const prefix = `paths[${index}]`
    if (!isJsonObject(entry)) {
      issues.push({
        code: 'L25',
        severity: 'block',
        message: '需要对象（路径条目）',
        jsonPath: prefix,
        source: 'local',
      })
      continue
    }
    const id = entry.id
    if (typeof id === 'string') {
      if (idSeen.has(id)) {
        issues.push({
          code: 'L25',
          severity: 'block',
          message: `路径 id 重复: ${id}（脚本内必须唯一）`,
          jsonPath: `${prefix}.id`,
          source: 'local',
        })
      } else {
        idSeen.set(id, index)
      }
    }
    for (const issue of validatePathEntry(doc, entry, index)) {
      issues.push({
        code: severityCode(issue.field),
        severity: severityOf(issue.message),
        message: issue.message,
        jsonPath: issue.field,
        source: 'local',
      })
    }
    const clip = typeof entry.clip === 'string' ? entry.clip : ''
    const from = typeof entry.from === 'number' ? entry.from : Number.NaN
    const to = typeof entry.to === 'number' ? entry.to : Number.NaN
    if (clip !== '' && Number.isFinite(from) && Number.isFinite(to)) {
      const pair = `${clip}|${from}|${to}`
      if (pairSeen.has(pair)) {
        issues.push({
          code: 'L28',
          severity: 'block',
          message: `同一片段的端点对重复（clip=${clip}, from=${from}, to=${to}）`,
          jsonPath: `${prefix}.from`,
          source: 'local',
        })
      } else {
        pairSeen.set(pair, index)
      }
    }
  }
  return issues
}

/** 端点选择：返回位置节点时间（升序、精确去重）。 */
export function endpointNodes(doc: ScriptDoc, clipId: string): number[] {
  return clipPositionNodes(doc, clipId)
}

/** 可作为 A 的节点（去掉最后一项）。 */
export function startEndpointOptions(doc: ScriptDoc, clipId: string): number[] {
  const nodes = endpointNodes(doc, clipId)
  return nodes.slice(0, -1)
}

/** 给定 A 返回 B（A 的下一个节点；A 不在并集时返回 null）。 */
export function nextEndpoint(doc: ScriptDoc, clipId: string, from: number): number | null {
  const nodes = endpointNodes(doc, clipId)
  const index = exactNodeIndex(nodes, from)
  return index < 0 || index + 1 >= nodes.length ? null : nodes[index + 1]
}

/** 兼容 1e-4 匹配后的节点原值（写盘时把 UI 数字对齐到节点原值）。 */
export function snapEndpoint(doc: ScriptDoc, clipId: string, time: number): number | null {
  const nodes = endpointNodes(doc, clipId)
  const exact = exactNodeIndex(nodes, time)
  if (exact >= 0) {
    return nodes[exact]
  }
  for (const node of nodes) {
    if (Math.abs(node - time) <= PATH_TIME_EPSILON) {
      return node
    }
  }
  return null
}

/** 新建路径 id：`p_<n>`，全局最大 + 1。 */
export function nextPathId(doc: ScriptDoc): string {
  let maximum = 0
  const entries = pathEntries(doc)
  for (const view of entries) {
    const match = /^p_(\d+)$/.exec(view.id)
    if (match !== null) {
      maximum = Math.max(maximum, Number(match[1]))
    }
  }
  return `p_${maximum + 1}`
}

/** 生成默认路径条目（07-05：id、三轴、line、线性 timing 省略）。 */
export function defaultPathEntry(doc: ScriptDoc, clipId: string, from: number): JsonObject | null {
  const to = nextEndpoint(doc, clipId, from)
  if (to === null) {
    return null
  }
  return {
    id: nextPathId(doc),
    clip: clipId,
    from,
    to,
    axes: ['x', 'y', 'z'],
    geometry: { type: 'line' },
  }
}

/** 与其它条目的重叠提示（部分重叠；完全重复由诊断拦下）。 */
export function overlapNotes(doc: ScriptDoc, entryIndex: number): PathOverlapNote[] {
  const views = pathEntries(doc)
  const self = views.find((view) => view.index === entryIndex)
  if (self === undefined || !Number.isFinite(self.from) || !Number.isFinite(self.to)) {
    return []
  }
  const notes: PathOverlapNote[] = []
  for (const other of views) {
    if (other.id === self.id || other.index === self.index || other.clipId !== self.clipId) {
      continue
    }
    if (!Number.isFinite(other.from) || !Number.isFinite(other.to)) {
      continue
    }
    if (other.from === self.from && other.to === self.to) {
      continue
    }
    if (self.from < other.to && other.from < self.to) {
      const selfLater = self.from > other.from || (self.from === other.from && self.index > other.index)
      const winner = selfLater ? self.id : other.id
      notes.push({
        otherId: other.id,
        winnerId: winner,
        message: `与 ${other.id} 重叠，起点更晚者生效（${winner} 胜出）`,
      })
    }
  }
  return notes
}

/** 读取 axes；缺省 = 三轴。 */
export function readAxes(raw: JsonValue | undefined): Array<'x' | 'y' | 'z'> {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [...PATH_AXES]
  }
  const axes: Array<'x' | 'y' | 'z'> = []
  for (const axis of raw) {
    if (axis === 'x' || axis === 'y' || axis === 'z') {
      if (!axes.includes(axis)) {
        axes.push(axis)
      }
    }
  }
  return axes
}

/** 几何类型是否被注册表接受（line 别名单独处理）。 */
export function isAcceptedGeometry(type: string): boolean {
  return type === 'line' || isKnownGeometryType(type)
}

// ── 内部 ───────────────────────────────────────────────────────────────────

function exactNodeIndex(nodes: readonly number[], time: number): number {
  for (let index = 0; index < nodes.length; index += 1) {
    if (nodes[index] === time) {
      return index
    }
  }
  return -1
}

function severityCode(field: string): string {
  if (field.endsWith('.id') || field.endsWith('.clip') || field.endsWith('.from') || field.endsWith('.to')) {
    return 'L25'
  }
  return 'L25'
}

function severityOf(message: string): Severity {
  if (message.startsWith('未知曲线类型') || message.startsWith('未知几何')) {
    return 'error'
  }
  return 'block'
}
