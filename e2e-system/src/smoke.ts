/**
 * 启动冒烟（`smoke` 子命令）。
 *
 * 回答一个问题：**这个应用能不能正常起来**。
 *
 * 与 `run` 的区别：`run` 跑业务场景（打开脚本、播放、预览），`smoke` 只验证
 * "启动路径健康"，因此可以在每次构建后无条件跑，成本远低于整套 e2e。
 *
 * 判据全部是**可观测信号**，不依赖窗口句柄、不依赖截图：
 *   1. 工作台根节点 `.workspace-shell` 出现（Vue 挂载完成、页面真的渲染了）
 *   2. 渲染进程没有抛 `pageerror`
 *   3. 没有 `console.error`
 *   4. 主进程没有 CDP 积压告警
 *   5. 进程在观察窗口内没有退出
 *
 * 参考实现：
 *   - beekeeper-studio `apps/studio/e2e/tests/appLaunch.test.ts`（smoke 是独立的一档）
 *   - electron-fiddle `packages/app/e2e/smoke.e2e.ts`（启动 + 每项能力各一条）
 *   - vscode `test/smoke/src/areas/workbench/launch.test.ts`（最小启动断言）
 *
 * 退出码：0 通过；1 失败；2 环境不满足（BLOCKED，不伪造通过）。
 */
import path from 'node:path'

import type { ConfigLoader } from './config.ts'
import type { PluginContext } from './registry.ts'
import { createElectronHostPlugin } from '../plugins/electron-host/index.ts'

export interface SmokeInput {
  /** 已打包可执行文件；省略时验证 `electron .` + dist 的开发构建。 */
  executablePath?: string
  /** 就绪后额外保持观察的毫秒数，用来抓"启动后几秒内崩溃"。 */
  holdMs?: number
}

export interface SmokeCheck {
  name: string
  ok: boolean
  detail: string
}

export interface SmokeResult {
  checks: SmokeCheck[]
  /** 未通过的原因，按出现顺序；空数组表示全通过。 */
  failures: string[]
  blocked: string[]
}

const DEFAULT_HOLD_MS = 3000

/** 插件 `editor.probeDiagnostics` 返回的可观测信号（只取 smoke 需要的字段）。 */
export interface SmokeSignals {
  rendererErrors: string[]
  consoleCounts: Record<string, number>
  mainPending: string[]
}

/** 把插件上下文里的可观测信号收敛成一组可断言的检查项。 */
export function evaluateSmoke(ctx: PluginContext, signals: SmokeSignals): SmokeResult {
  const checks: SmokeCheck[] = []
  const failures: string[] = []
  const blocked: string[] = []

  const pagePresent = ctx.page !== null
  checks.push({
    name: '页面已创建',
    ok: pagePresent,
    detail: pagePresent ? 'firstWindow() 返回了页面' : '未拿到任何窗口',
  })
  if (!pagePresent) {
    blocked.push('没有窗口，无法继续检查（启动阶段就失败了）')
    return { checks, failures, blocked }
  }

  const consoleErrors = signals.consoleCounts.error ?? 0

  checks.push({
    name: '无渲染进程异常',
    ok: signals.rendererErrors.length === 0,
    detail: signals.rendererErrors.length === 0 ? 'pageerror 0 条' : `${signals.rendererErrors.length} 条: ${signals.rendererErrors.join(' | ')}`,
  })
  if (signals.rendererErrors.length > 0) failures.push(`渲染进程异常: ${signals.rendererErrors.join(' | ')}`)

  checks.push({
    name: '无 console.error',
    ok: consoleErrors === 0,
    detail: `console.error ${consoleErrors} 条`,
  })
  if (consoleErrors > 0) failures.push(`console.error ${consoleErrors} 条（详见 artifacts 日志）`)

  checks.push({
    name: '主进程无 CDP 积压',
    ok: signals.mainPending.length === 0,
    detail: signals.mainPending.length === 0 ? '0 条告警' : `${signals.mainPending.length} 条: ${signals.mainPending[0]}`,
  })
  if (signals.mainPending.length > 0) failures.push(`主进程告警: ${signals.mainPending[0]}`)

  return { checks, failures, blocked }
}

export async function runSmoke(loader: ConfigLoader, input: SmokeInput): Promise<number> {
  const holdMs = input.holdMs ?? DEFAULT_HOLD_MS
  const executablePath = input.executablePath === undefined ? undefined : path.resolve(process.cwd(), input.executablePath)
  const sessionDir = path.join(loader.resolved.artifactsDir, `smoke-${new Date().toISOString().replace(/[:.]/g, '-')}`)

  const host = createElectronHostPlugin({ executablePath, smoke: true })
  const ctx: PluginContext = {
    runId: path.basename(sessionDir),
    artifactsDir: sessionDir,
    config: loader.resolved,
    suitePlugins: ['electron-host'],
    params: {},
    page: null,
    app: null,
    log: (line) => console.log(line),
    attachEvidence: () => {},
    cleanupErrors: [],
  }

  console.log('=== smoke ===')
  console.log(`目标: ${executablePath ?? 'electron .（未打包，dist/）'}`)
  console.log(`产物目录: ${sessionDir}`)

  const availability = await host.available(ctx)
  if (!availability.ok) {
    console.error('环境不满足启动条件:')
    for (const missing of availability.missing) console.error(`- ${missing}`)
    return 2
  }

  let exitCode = 0
  const errors: string[] = []
  try {
    await host.setup?.(ctx)
  } catch (error) {
    console.error(`启动失败: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }

  try {
    const app = ctx.app
    if (app === null) {
      console.error('启动失败: 窗口在启动阶段就关闭了')
      exitCode = 1
    } else {
      const exited = app.process().exitCode
      if (exited !== null) {
        console.error(`启动失败: 进程已退出（exitCode=${exited}）`)
        exitCode = 1
      } else {
        console.log(`就绪：工作台已渲染；保持观察 ${holdMs}ms，确认不会启动后崩溃`)
        await new Promise((resolve) => setTimeout(resolve, holdMs))
        if (app.process().exitCode !== null) {
          console.error(`启动失败: 观察期内进程退出（exitCode=${app.process().exitCode}）`)
          exitCode = 1
        } else {
          const probe = await host.invoke(ctx, 'editor.probeDiagnostics', {})
          const value = (probe.value ?? {}) as Partial<SmokeSignals>
          const result = evaluateSmoke(ctx, {
            rendererErrors: value.rendererErrors ?? [],
            consoleCounts: value.consoleCounts ?? {},
            mainPending: value.mainPending ?? [],
          })
          console.log('')
          console.log('检查项:')
          for (const check of result.checks) {
            console.log(`  ${check.ok ? 'PASS' : 'FAIL'}  ${check.name} — ${check.detail}`)
          }
          if (result.blocked.length > 0) {
            for (const entry of result.blocked) console.error(`BLOCKED: ${entry}`)
            exitCode = 2
          } else if (result.failures.length > 0) {
            for (const entry of result.failures) console.error(`FAIL: ${entry}`)
            exitCode = 1
          }
        }
      }
    }
  } finally {
    try {
      errors.push(...(await (host.teardown?.() ?? Promise.resolve([]))))
    } catch (error) {
      errors.push(`清理异常: ${String(error)}`)
    }
  }

  if (errors.length > 0) {
    console.error('清理失败:')
    for (const entry of errors) console.error(`- ${entry}`)
    exitCode = 1
  }

  if (exitCode === 0) console.log('smoke 通过：应用能起来，工作台已渲染，观察期内未崩溃。')
  return exitCode
}
