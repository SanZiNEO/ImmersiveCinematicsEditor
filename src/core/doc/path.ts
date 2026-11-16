/**
 * 属性点分路径：与运行时 `PropertyPath` 同一段规则。
 *
 * 段 = `.` 分隔，每段匹配 `[a-z][a-z0-9_]*`；无空段、无首尾点、无空格、无数组下标。
 * 03 不另写正则：这是运行时 `PropertyPath#isValid` 的等价形态。
 */

const PATH_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/

/** 路径是否合法（`null` / 空串 / 下标 / 大写 / 空段都非法）。 */
export function isValidObjectPath(path: string): boolean {
  return PATH_PATTERN.test(path)
}

/** 末段（事件记录形状按它判定 `event` / `mod_event`）；空串返回空串。 */
export function lastSegment(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot < 0 ? path : path.slice(dot + 1)
}

/** 路径端点节点时间的三轴来源（`PathCollectionParser.POSITION_PATHS`）。 */
export const POSITION_AXIS_PATHS: readonly string[] = ['position.x', 'position.y', 'position.z']
