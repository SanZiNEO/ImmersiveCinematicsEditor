/**
 * 诊断聚合（06-10）：把校验层 `DocIssue[]` 落到行、节点、组头，并决定"点过去该去哪个面板"。
 *
 * 规则（06-10 §三 / §4.2）：
 * - 同代码的服务端 issue 覆盖本地 issue；不同代码并存；
 * - 动画行与节点 → 效果面板；静态、未设置、必填缺失 → 属性面板；
 * - 服务端超时/失败 → 一条 `server_incomplete` 的 info 诊断，**绝不**把超时当通过；
 * - 聚合是单向的：issue → 行 / 节点 / 组头，不反向存储。
 *
 * 本模块是纯函数：不读文档、不写会话、不 commit。
 */
import type { DocIssue } from '../../core/doc/types.ts'
import { isRequiredMissing } from './rows.ts'
import type { ClipTiming } from './rows.ts'
import type {
  DiagnosticIndex,
  DiagnosticPanel,
  EffectDiagnostic,
  PanelMembershipMode,
  PropertyRow,
} from './types.ts'

/** 级别排序（越小越严重）。 */
export const SEVERITY_ORDER: Readonly<Record<EffectDiagnostic['severity'], number>> = {
  block: 0,
  error: 1,
  warn: 2,
  info: 3,
}

/** 服务端未完成的稳定代码（UI 文案与筛选都认这个字符串）。 */
export const SERVER_INCOMPLETE_CODE = 'server_incomplete'

/** 一条 issue 落到哪个面板：动画行/节点 → 效果面板；其余 → 属性面板。 */
export function resolvePanel(issue: { time?: number; path?: string }, row: PropertyRow | undefined): DiagnosticPanel {
  if (row === undefined) {
    // 没有对应行（片段级 issue）：没有可动画的落点，回属性面板。
    return 'properties'
  }
  if (row.mode === 'unknown') {
    return row.keyframes.length > 0 ? 'effects' : 'properties'
  }
  if (issue.time !== undefined) {
    // 节点 issue：该行有帧才在效果面板显示。
    return row.keyframes.length > 0 ? 'effects' : 'properties'
  }
  return row.keyframes.length > 0 ? 'effects' : 'properties'
}

/** 诊断稳定身份：代码 + 片段 + 路径 + 时间（重算不会重复）。 */
export function diagnosticIdOf(issue: {
  code: string
  clipKey?: string
  objectPath?: string
  keyframeTime?: number
  jsonPath: string
}): string {
  const time = issue.keyframeTime === undefined ? '' : issue.keyframeTime.toFixed(6)
  return `${issue.code}|${issue.clipKey ?? ''}|${issue.objectPath ?? issue.jsonPath}|${time}`
}

/**
 * 合并本地与服务端 issue：同代码的服务端覆盖本地，不同代码并存。
 *
 * 顺序：先服务端（权威），再未被覆盖的本地；同键只保留一条。
 */
export function mergeServerIssues(
  local: readonly DocIssue[],
  server: readonly DocIssue[],
): DocIssue[] {
  const result: DocIssue[] = []
  const seen = new Set<string>()
  for (const issue of server) {
    const key = diagnosticIdOf(issue)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push(issue)
  }
  for (const issue of local) {
    const key = diagnosticIdOf(issue)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push(issue)
  }
  return result
}

/** 服务端未完成诊断（超时 / 断连 / 失败）：info 级，明确写出"未完成"，不表示通过。 */
export function serverIncompleteDiagnostic(detail?: string): EffectDiagnostic {
  return {
    id: `${SERVER_INCOMPLETE_CODE}|`,
    code: SERVER_INCOMPLETE_CODE,
    severity: 'info',
    clipKey: '',
    message: detail === undefined || detail.length === 0
      ? '服务端校验未完成：结果不代表通过，本地提示仍然有效'
      : `服务端校验未完成：${detail}`,
    source: 'server',
    panel: 'properties',
  }
}

/** 把一条 `DocIssue` 转成面板诊断（面板归属由调用方按策略给出）。 */
export function toEffectDiagnostic(
  issue: DocIssue,
  row: PropertyRow | undefined,
  panel: DiagnosticPanel,
): EffectDiagnostic {
  return {
    id: diagnosticIdOf(issue),
    code: issue.code,
    severity: issue.severity,
    clipKey: issue.clipKey ?? row?.clipKey ?? '',
    ...(issue.objectPath === undefined ? {} : { path: issue.objectPath }),
    ...(issue.keyframeTime === undefined ? {} : { time: issue.keyframeTime }),
    message: issue.message,
    source: issue.source,
    panel,
  }
}

/** 节点键：`path@time`（与 `DiagnosticIndex.byNode` 的约定一致）。 */
export function nodeDiagnosticKey(path: string, time: number): string {
  return `${path}@${time.toFixed(6)}`
}

/** 按级别降序排序（同级保持输入顺序）。 */
export function sortBySeverity(list: readonly EffectDiagnostic[]): EffectDiagnostic[] {
  return [...list].sort((left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity])
}

/** 一组诊断里的最高级别；空列表返回 `null`。 */
export function highestSeverity(list: readonly EffectDiagnostic[]): EffectDiagnostic['severity'] | null {
  let best: EffectDiagnostic['severity'] | null = null
  for (const item of list) {
    if (best === null || SEVERITY_ORDER[item.severity] < SEVERITY_ORDER[best]) {
      best = item.severity
    }
  }
  return best
}

/** 诊断索引的附加输入。 */
export interface DiagnosticIndexOptions {
  /** 只统计该片段（省略 = 全部）。 */
  clipKey?: string
  /** 片段时长（必填缺失判定用）。 */
  timing?: ClipTiming
}

/**
 * 建诊断索引。
 *
 * `rows` 是**当前片段的全部属性行**（含未设置行）——归属与组键都从它取；
 * `membershipMode` 只影响"组是否在效果面板"的判定语义（`leaf` 下组内只要有动画行就算效果侧）。
 */
export function buildDiagnosticIndex(
  issues: readonly DocIssue[],
  rows: readonly PropertyRow[],
  membershipMode: PanelMembershipMode,
  options: DiagnosticIndexOptions = {},
): DiagnosticIndex {
  const byPath = new Map<string, PropertyRow>()
  const animatedGroups = new Set<string>()
  for (const row of rows) {
    byPath.set(row.path, row)
    if (row.keyframes.length > 0) {
      animatedGroups.add(row.groupKey)
    }
  }

  /**
   * 归属：`leaf` 下只有动画行/节点去效果面板；`group` 下动画组内的叶子都跟组走。
   * 静态、未设置与必填缺失永远在属性面板。
   */
  const panelOf = (row: PropertyRow | undefined): DiagnosticPanel => {
    if (row === undefined) {
      return 'properties'
    }
    if (membershipMode === 'group' && animatedGroups.has(row.groupKey)) {
      return 'effects'
    }
    return row.keyframes.length > 0 ? 'effects' : 'properties'
  }
  const byRow = new Map<string, EffectDiagnostic[]>()
  const byNode = new Map<string, EffectDiagnostic[]>()
  const groupAcc = new Map<string, { severity: EffectDiagnostic['severity']; count: number }>()

  const pushRow = (path: string, diagnostic: EffectDiagnostic): void => {
    const list = byRow.get(path)
    if (list === undefined) {
      byRow.set(path, [diagnostic])
      return
    }
    list.push(diagnostic)
  }

  const merged = mergeServerIssues(
    issues.filter((issue) => issue.source === 'local'),
    issues.filter((issue) => issue.source === 'server'),
  )

  for (const issue of merged) {
    if (options.clipKey !== undefined && issue.clipKey !== undefined && issue.clipKey !== options.clipKey) {
      continue
    }
    const row = issue.objectPath === undefined ? undefined : byPath.get(issue.objectPath)
    const diagnostic = toEffectDiagnostic(issue, row, panelOf(row))
    const path = diagnostic.path
    if (path !== undefined) {
      pushRow(path, diagnostic)
      if (diagnostic.time !== undefined) {
        const key = nodeDiagnosticKey(path, diagnostic.time)
        const list = byNode.get(key)
        if (list === undefined) {
          byNode.set(key, [diagnostic])
        } else {
          list.push(diagnostic)
        }
      }
      const groupKey = row?.groupKey
      if (groupKey !== undefined) {
        accumulateGroup(groupAcc, groupKey, diagnostic)
      }
    }
  }

  // 必填缺失：本地即时提示（06-10 §三）。已有同代码 issue 时不重复添加。
  const timing = options.timing
  if (timing !== undefined) {
    for (const row of rows) {
      if (!isRequiredMissing(row, timing)) {
        continue
      }
      const existing = byRow.get(row.path) ?? []
      if (existing.some((item) => item.code === 'required_missing')) {
        continue
      }
      const diagnostic: EffectDiagnostic = {
        id: `required_missing|${row.clipKey}|${row.path}|`,
        code: 'required_missing',
        severity: 'error',
        clipKey: row.clipKey,
        path: row.path,
        message: `${row.path} 必填未设置`,
        source: 'local',
        panel: 'properties',
      }
      pushRow(row.path, diagnostic)
      accumulateGroup(groupAcc, row.groupKey, diagnostic)
    }
  }

  for (const [path, list] of byRow) {
    byRow.set(path, sortBySeverity(list))
  }
  for (const [key, list] of byNode) {
    byNode.set(key, sortBySeverity(list))
  }

  return { byRow, byNode, byGroup: groupAcc }
}

/** 组头累计：最高级别 + 计数。 */
function accumulateGroup(
  acc: Map<string, { severity: EffectDiagnostic['severity']; count: number }>,
  groupKey: string,
  diagnostic: EffectDiagnostic,
): void {
  const current = acc.get(groupKey)
  if (current === undefined) {
    acc.set(groupKey, { severity: diagnostic.severity, count: 1 })
    return
  }
  acc.set(groupKey, {
    severity: SEVERITY_ORDER[diagnostic.severity] < SEVERITY_ORDER[current.severity]
      ? diagnostic.severity
      : current.severity,
    count: current.count + 1,
  })
}

/** 取一行的诊断（没有返回空数组）。 */
export function diagnosticsOfRow(index: DiagnosticIndex, path: string): EffectDiagnostic[] {
  return index.byRow.get(path) ?? []
}

/** 取一个节点的诊断（没有返回空数组）。 */
export function diagnosticsOfNode(index: DiagnosticIndex, path: string, time: number): EffectDiagnostic[] {
  return index.byNode.get(nodeDiagnosticKey(path, time)) ?? []
}

/** 诊断条摘要：总数 + 最高级别 + 各级计数。 */
export function summarizeDiagnostics(list: readonly EffectDiagnostic[]): {
  total: number
  severity: EffectDiagnostic['severity'] | null
  counts: Record<EffectDiagnostic['severity'], number>
} {
  const counts: Record<EffectDiagnostic['severity'], number> = { block: 0, error: 0, warn: 0, info: 0 }
  for (const item of list) {
    counts[item.severity] += 1
  }
  return { total: list.length, severity: highestSeverity(list), counts }
}

/**
 * 过滤出某个面板可见的诊断。
 *
 * `clipKey` 给定时只留该片段；片段级诊断（无 `path`）在两个面板都显示，
 * 因为它是"整体校验未完成"，不是某一行的问题。
 */
export function diagnosticsForPanel(
  index: DiagnosticIndex,
  panel: DiagnosticPanel,
  clipKey?: string,
): EffectDiagnostic[] {
  const result: EffectDiagnostic[] = []
  const seen = new Set<string>()
  for (const list of index.byRow.values()) {
    for (const item of list) {
      if (item.panel !== panel) {
        continue
      }
      if (clipKey !== undefined && item.clipKey !== '' && item.clipKey !== clipKey) {
        continue
      }
      if (seen.has(item.id)) {
        continue
      }
      seen.add(item.id)
      result.push(item)
    }
  }
  return sortBySeverity(result)
}

/**
 * 诊断定位意图：交给面板执行（只改可见性 / 展开 / 滚动 / 播放头，不写文档）。
 *
 * 效果侧 → `effects`，带路径与可选时间；属性侧 → `properties`，带路径。
 */
export interface DiagnosticReveal {
  panel: DiagnosticPanel
  clipKey: string
  path?: string
  time?: number
  /** 需要聚焦的值控件路径（属性面板用）。 */
  focusPath?: string
}

/** 把一条诊断翻译成定位意图。 */
export function revealFor(diagnostic: EffectDiagnostic): DiagnosticReveal {
  const base: DiagnosticReveal = {
    panel: diagnostic.panel,
    clipKey: diagnostic.clipKey,
  }
  if (diagnostic.path !== undefined) {
    base.path = diagnostic.path
  }
  if (diagnostic.time !== undefined) {
    base.time = diagnostic.time
  }
  if (diagnostic.panel === 'properties' && diagnostic.path !== undefined) {
    base.focusPath = diagnostic.path
  }
  return base
}

/**
 * 追加"服务端未完成"到诊断列表（两个面板的条都用它）。
 *
 * 它是片段级诊断，不属于任何行，所以不经过 `byRow`；调用方在展示前拼到最前面。
 * `stale` 为假时原样返回（不发明 issue）。
 */
export function withServerIncomplete(
  list: readonly EffectDiagnostic[],
  stale: boolean,
  detail?: string,
): EffectDiagnostic[] {
  return stale ? [serverIncompleteDiagnostic(detail), ...list] : [...list]
}

/** 级别文案（诊断条与行角标共用；只靠文字也能分辨，不只靠颜色）。 */
export function severityLabel(severity: EffectDiagnostic['severity']): string {
  switch (severity) {
    case 'block':
      return '阻止'
    case 'error':
      return '错误'
    case 'warn':
      return '警告'
    default:
      return '提示'
  }
}
