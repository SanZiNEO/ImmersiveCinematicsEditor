/**
 * 07-05 §四：路径引用完整性的「扫描 → 阻止 → 提供处理选项」。
 *
 * 位置节点与片段是路径的两种外部引用：
 * - 端点必须落在目标片段的位置节点并集上，且 `from` / `to` 相邻；
 * - `paths[].clip` 必须指向存在的片段 id。
 *
 * 因此删节点 / 插节点 / 移动节点 / 删片段 / 改片段 id 五个入口，都要先扫描受影响的路径，
 * 再由作者显式选择「删除这些路径并继续 / 取消」；删除与帧操作写在同一个 `compound`，
 * 一次撤销全回退。
 *
 * 本模块只产出计划（命令对象），不提交；命令由各面板走 `ctx.commands.commit`。
 */
import type { DocCommand } from '../../core/doc/commands.ts'
import type { ScriptDoc } from '../../core/doc/types.ts'
import { pathEntries } from '../../core/paths/collection.ts'

/** 位置三轴：只有这三个字段的关键帧构成路径节点。 */
export const POSITION_NODE_PATHS: readonly string[] = ['position.x', 'position.y', 'position.z']

/** 一条被影响的路径（用于列表展示与删除计划）。 */
export interface AffectedPath {
  id: string
  clip: string
  from: number
  to: number
  /** 为什么会被影响（中文，直接进界面）。 */
  reason: string
}

function affected(entry: { id: string; clipId: string; from: number; to: number }, reason: string): AffectedPath {
  return { id: entry.id, clip: entry.clipId, from: entry.from, to: entry.to, reason }
}

/** 该片段上的全部路径（删片段 / 改片段 id 用）。 */
export function pathsOfClip(doc: ScriptDoc, clipId: string): AffectedPath[] {
  return pathEntries(doc)
    .filter((entry) => entry.clipId === clipId)
    .map((entry) => affected(entry, `端点 ${formatTime(entry.from)}→${formatTime(entry.to)} 引用该片段`))
}

/** 以 `time` 为端点（起点或终点）的路径（删节点用）。 */
export function pathsUsingEndpoint(doc: ScriptDoc, clipId: string, time: number): AffectedPath[] {
  return pathEntries(doc)
    .filter((entry) => entry.clipId === clipId && (sameTime(entry.from, time) || sameTime(entry.to, time)))
    .map((entry) => affected(entry, `该节点是端点（${formatTime(entry.from)}→${formatTime(entry.to)}）`))
}

/** 区间内部插入节点会破坏「端点相邻」的路径（插节点用）。 */
export function pathsBreakingOnInsert(doc: ScriptDoc, clipId: string, time: number): AffectedPath[] {
  return pathEntries(doc)
    .filter((entry) => entry.clipId === clipId && time > entry.from && time < entry.to)
    .map((entry) => affected(entry, `区间 ${formatTime(entry.from)}→${formatTime(entry.to)} 内插入节点会破坏相邻性`))
}

/** 移动端点后会失去端点绑定的路径（移动节点用）。 */
export function pathsBreakingOnMove(
  doc: ScriptDoc,
  clipId: string,
  fromTime: number,
  toTime: number,
): AffectedPath[] {
  const entries = pathEntries(doc).filter((entry) => entry.clipId === clipId)
  const result: AffectedPath[] = []
  for (const entry of entries) {
    if (sameTime(entry.from, fromTime) || sameTime(entry.to, fromTime)) {
      result.push(affected(entry, `端点 ${formatTime(fromTime)} 被移动到 ${formatTime(toTime)}，端点绑定会失效`))
      continue
    }
    if (toTime > entry.from && toTime < entry.to) {
      result.push(affected(entry, `区间 ${formatTime(entry.from)}→${formatTime(entry.to)} 内出现新节点，相邻性会被破坏`))
    }
  }
  return result
}

/** 边界情况：删除会同时带走起点与终点两条路径时，两条都列出来。 */
export function uniqueById(paths: readonly AffectedPath[]): AffectedPath[] {
  const seen = new Map<string, AffectedPath>()
  for (const item of paths) {
    if (!seen.has(item.id)) {
      seen.set(item.id, item)
    }
  }
  return [...seen.values()]
}

/**
 * 「删除这些路径」命令。
 *
 * `path.writeBatch` 的 `entries` 是**追加**语义（与既有 id 重复会被拒绝），
 * 所以删除只能走 `removeIds`：其余条目保持原样，不重写。
 */
export function removePathsCommand(paths: readonly AffectedPath[]): DocCommand | null {
  const ids = uniqueById(paths).map((item) => item.id)
  if (ids.length === 0) {
    return null
  }
  return { kind: 'path.writeBatch', removeIds: ids, entries: [] }
}

/**
 * 帧操作 + 路径删除合成一次提交（一次撤销全回退）。
 *
 * 顺序是「先删路径，再做帧操作」：帧命令会预检端点/相邻性，
 * 路径已经不在时预检才通过。
 */
export function withPathRemoval(frameCommand: DocCommand, paths: readonly AffectedPath[]): DocCommand {
  const removal = removePathsCommand(paths)
  if (removal === null) {
    return frameCommand
  }
  return { kind: 'compound', commands: [removal, frameCommand] }
}

function sameTime(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-9
}

function formatTime(time: number): string {
  return Number.isFinite(time) ? time.toFixed(3) : String(time)
}
