/**
 * 自检公共断言实现（02-03）：`check()` 失败输出带 `文件:行`。
 *
 * 用法：
 *   import { check, summaryLine, exitCode } from './verify-kit.ts'
 *
 * 语义沿用仓库既有约定：PASS → 0、FAIL → 1、BLOCKED / NOT RUN → 2。
 * `ok` 行格式不变（`ok   <label>`）；失败行变为
 * `FAIL <相对仓库路径>:<行> <label>：<actual>`。
 * 栈帧解析不到时退化为只打印 label，并在 stderr 留一行原因，不静默吞掉定位。
 */
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))

let ok = 0
let fail = 0
let blocked = 0

/** 实际值压成一行（不抛异常）。 */
function format(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Error) return `${value.name}: ${value.message}`
  try {
    const text = JSON.stringify(value)
    if (text === undefined) return String(value)
    return text.length > 320 ? `${text.slice(0, 320)}…` : text
  } catch {
    return String(value)
  }
}

/** 取断言调用点的 `文件:行`（跳过 kit 自身帧）。 */
function callerLocation(): string {
  const stack = new Error().stack?.split('\n') ?? []
  for (const raw of stack.slice(1)) {
    const frame = raw.trim()
    if (frame.includes('verify-kit.ts')) continue
    const match = /\(?(file:\/\/[^)]+):(\d+):(\d+)\)?$/.exec(frame)
    if (match === null) continue
    try {
      const file = fileURLToPath(match[1]!)
      const line = match[2]!
      const rel = relative(REPO_ROOT, file).replaceAll('\\', '/')
      return `${rel}:${line}`
    } catch {
      continue
    }
  }
  console.error('[verify-kit] 无法解析断言调用点，失败行将只输出 label')
  return ''
}

/** 断言：通过计 ok，失败计 fail 并打印调用点。 */
function check(label: string, condition: boolean, actual?: unknown): void {
  if (condition) {
    ok += 1
    console.log(`ok   ${label}`)
    return
  }
  fail += 1
  const at = callerLocation()
  console.log(at === '' ? `FAIL ${label}：${format(actual)}` : `FAIL ${at} ${label}：${format(actual)}`)
}

/** 环境不满足：记 NOT RUN，不计 ok/fail。 */
function notRun(label: string, reason: string): void {
  blocked += 1
  console.log(`NOT RUN ${label}：${reason}`)
}

/** 当前计数（供各脚本末行沿用既有格式）。 */
function counts(): { ok: number; fail: number; blocked: number } {
  return { ok, fail, blocked }
}

/** 统一 summary 行。 */
function summaryLine(): string {
  return `summary ok=${ok} fail=${fail}`
}

/** 统一退出码：FAIL 优先，其次 BLOCKED。 */
function exitCode(): number {
  if (fail > 0) return 1
  if (blocked > 0) return 2
  return 0
}

/** 自检夹具用：清零计数，避免把负例混进正例统计。 */
function reset(): void {
  ok = 0
  fail = 0
  blocked = 0
}

export { check, counts, exitCode, format, notRun, reset, summaryLine }
