/**
 * 结构读取问题的构造（`LocalProblem`）。
 *
 * 独立成模块是因为 `object.ts` / `clip.ts` / `structural.ts` / `binding.ts` 都产出同类问题，
 * 定位字段（jsonPath + objectPath + keyframeTime）必须锁步。
 */
import type { LocalProblem, Severity } from './types.ts'

export interface ProblemLocation {
  jsonPath: string
  objectPath?: string
  keyframeTime?: number
}

/** 追加一条本地问题。 */
export function pushProblem(
  list: LocalProblem[],
  severity: Severity,
  code: string,
  message: string,
  location: ProblemLocation,
): void {
  const problem: LocalProblem = {
    code,
    severity,
    message,
    jsonPath: location.jsonPath,
  }
  if (location.objectPath !== undefined) {
    problem.objectPath = location.objectPath
  }
  if (location.keyframeTime !== undefined) {
    problem.keyframeTime = location.keyframeTime
  }
  list.push(problem)
}
