/**
 * 最近项目（04-08）。
 *
 * 纯函数：不做文件系统探测（`exists` 由调用方注入）；不持久化删除，
 * 文件消失只标 `missing`，由用户决定移除或重新定位。
 */
import { RECENT_PROJECTS_LIMIT } from '../api/preferences.ts'
import type { RecentProject } from '../api/preferences.ts'

/** 路径归一化键：分隔符统一、去尾斜杠、Windows 路径忽略大小写。 */
export function recentPathKey(path: string): string {
  const slashed = path.trim().replace(/\\/g, '/')
  const unc = slashed.startsWith('//')
  let rest = unc ? slashed.slice(2) : slashed
  rest = rest.replace(/\/{2,}/g, '/')
  if (rest.length > 1 && !/^[a-zA-Z]:\/$/.test(rest)) {
    rest = rest.replace(/\/+$/, '')
  }
  const normalized = (unc ? '//' : '') + rest
  return unc || /^[a-zA-Z]:\//.test(rest) || path.includes('\\')
    ? normalized.toLowerCase()
    : normalized
}

/** 按 `lastOpenedAt` 倒序；坏时间排到最后。 */
export function sortRecent(list: readonly RecentProject[]): RecentProject[] {
  return [...list].sort((left, right) => {
    const leftTime = Date.parse(left.lastOpenedAt)
    const rightTime = Date.parse(right.lastOpenedAt)
    const leftValue = Number.isNaN(leftTime) ? Number.NEGATIVE_INFINITY : leftTime
    const rightValue = Number.isNaN(rightTime) ? Number.NEGATIVE_INFINITY : rightTime
    return rightValue - leftValue
  })
}

/** 加入一条记录：同路径只留最近一条，最多 20 条。 */
export function addRecent(list: readonly RecentProject[], entry: RecentProject): RecentProject[] {
  if (entry.path.trim().length === 0) {
    return sortRecent(list).slice(0, RECENT_PROJECTS_LIMIT)
  }
  const key = recentPathKey(entry.path)
  const remaining = list.filter((item) => recentPathKey(item.path) !== key)
  const next: RecentProject = {
    path: entry.path,
    name: entry.name,
    kind: entry.kind,
    lastOpenedAt: entry.lastOpenedAt,
  }
  return sortRecent([next, ...remaining]).slice(0, RECENT_PROJECTS_LIMIT)
}

/** 探测存在性：不存在标 `missing`，重新出现则清除标记；条目本身保留。 */
export function markMissing(
  list: readonly RecentProject[],
  exists: (path: string) => boolean,
): RecentProject[] {
  return list.map((entry) => {
    let present = false
    try {
      present = exists(entry.path)
    } catch {
      present = false
    }
    if (present) {
      return {
        path: entry.path,
        name: entry.name,
        kind: entry.kind,
        lastOpenedAt: entry.lastOpenedAt,
      }
    }
    return { ...entry, missing: true }
  })
}

/** 移除一条记录（按归一化路径匹配）。 */
export function removeRecent(list: readonly RecentProject[], path: string): RecentProject[] {
  const key = recentPathKey(path)
  return list.filter((entry) => recentPathKey(entry.path) !== key)
}

/** 把持久化数据规范成最近项目列表；坏条目收集为 issues。 */
export function normalizeRecentList(value: unknown): { list: RecentProject[]; issues: string[] } {
  if (!Array.isArray(value)) {
    return { list: [], issues: ['recentProjects 不是数组，已回空列表'] }
  }
  const issues: string[] = []
  const entries: RecentProject[] = []
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      issues.push('recentProjects 含非对象条目，已忽略')
      continue
    }
    const record = raw as Record<string, unknown>
    const path = typeof record.path === 'string' ? record.path.trim() : ''
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    const kind = record.kind
    const lastOpenedAt = typeof record.lastOpenedAt === 'string' ? record.lastOpenedAt : ''
    if (path.length === 0 || name.length === 0) {
      issues.push('recentProjects 条目缺少 path/name，已忽略')
      continue
    }
    if (kind !== 'folder' && kind !== 'script') {
      issues.push(`recentProjects 条目 kind 非法：${String(kind)}，已忽略`)
      continue
    }
    const parsed = Date.parse(lastOpenedAt)
    if (Number.isNaN(parsed)) {
      issues.push(`recentProjects 条目 lastOpenedAt 非法：${lastOpenedAt}，已忽略`)
      continue
    }
    entries.push({
      path,
      name,
      kind,
      lastOpenedAt: new Date(parsed).toISOString(),
      ...(record.missing === true ? { missing: true } : {}),
    })
  }
  const sorted = sortRecent(entries)
  const seen = new Set<string>()
  const list: RecentProject[] = []
  for (const entry of sorted) {
    const key = recentPathKey(entry.path)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    list.push(entry)
    if (list.length >= RECENT_PROJECTS_LIMIT) {
      break
    }
  }
  return { list, issues }
}
