/**
 * 12 轮自检共享断言骨架（`src/workbench/verify-12.ts` 与 `verify12/*.ts` 共用）。
 *
 * 口径沿用 verify.ts / verify-07.ts / verify-11.ts：`ok  <label>` / `FAIL <label>: <actual>`，
 * 末行 `summary ok=N fail=M`；任一 FAIL 置 `process.exitCode = 1`。
 */
export type CheckFn = (label: string, condition: boolean, actual?: unknown) => void

/** 独立跑一个切片断言模块用的计数器（不依赖 verify-12.ts 汇总）。 */
export interface CheckRunner {
  check: CheckFn
  summary(): { ok: number; fail: number }
  /** 打印 `summary ok=N fail=M`（与集成后格式一致）。 */
  print(): void
}

/** 创建计数器：切片可先用它单独验证自己的断言模块。 */
export function createCheckRunner(): CheckRunner {
  let ok = 0
  let fail = 0
  return {
    check(label: string, condition: boolean, actual?: unknown): void {
      if (condition) {
        ok += 1
        console.log(`ok   ${label}`)
        return
      }
      fail += 1
      console.log(`FAIL ${label}: ${formatActual(actual)}`)
    },
    summary(): { ok: number; fail: number } {
      return { ok, fail }
    },
    print(): void {
      console.log(`summary ok=${ok} fail=${fail}`)
    },
  }
}

/** 断言失败时的可读渲染（不抛异常、不截断成无语义字符串）。 */
export function formatActual(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Error) return `${value.name}: ${value.message}`
  try {
    const text = JSON.stringify(value)
    if (text === undefined) return String(value)
    return text.length > 320 ? `${text.slice(0, 320)}...` : text
  } catch {
    return String(value)
  }
}
