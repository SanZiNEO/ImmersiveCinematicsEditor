/**
 * 套件运行器（docs/13-e2e-system.md §5/§6/§7）。
 *
 * 状态语义：PASS / FAIL / BLOCKED / NOT RUN。缺能力记 BLOCKED 并写具体缺失项；
 * 断言失败记 FAIL 并保留期望/实际；禁止 SKIP、禁止伪造通过。
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

import type { ConfigLoader, LoadedScenario, ResolvedConfig } from './config.ts'
import {
  PluginRegistry,
  type E2ePlugin,
  type EvidenceEntry,
  type PluginContext,
  type StepResult,
} from './registry.ts'
import { createElectronHostPlugin } from '../plugins/electron-host/index.ts'
import { createFakeWebUiPlugin } from '../plugins/fake-webui/index.ts'
import { createLiveWebuiPlugin } from '../plugins/live-webui/index.ts'
import { createIcdevDriverPlugin } from '../plugins/icdev-driver/index.ts'
import { createEvidencePlugin } from '../plugins/evidence/index.ts'

export type ScenarioStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT RUN'

export interface StepRecord {
  index: number
  op: string
  with: Record<string, unknown>
  durationMs: number
  status: ScenarioStatus
  result?: unknown
  expected?: unknown
  actual?: unknown
  reason?: string
  evidence: string[]
}

export interface ScenarioRecord {
  id: string
  title: string
  status: ScenarioStatus
  reason?: string
  durationMs: number
  steps: StepRecord[]
  evidence: string[]
}

export interface RunReport {
  runId: string
  startedAt: string
  finishedAt: string
  suiteId: string
  suiteTitle: string
  /** 规范 §7：`suite` 字段（id + 标题）。 */
  suite: { id: string; title: string }
  status: ScenarioStatus
  environment: Record<string, string>
  scenarios: ScenarioRecord[]
  cleanupErrors: string[]
}

export function createRegistry(): PluginRegistry {
  const registry = new PluginRegistry()
  registry.register(createElectronHostPlugin())
  registry.register(createFakeWebUiPlugin())
  registry.register(createLiveWebuiPlugin())
  registry.register(createIcdevDriverPlugin())
  registry.register(createEvidencePlugin())
  return registry
}

function resolvePath(root: unknown, target: string): unknown {
  if (target === '' || target === 'result') return root
  const parts = target.split('.')
  // 模板里的 `result.xxx` 对应步骤结果对象本身，去掉前缀再在扁平化结果上取值。
  if (parts[0] === 'result') parts.shift()
  let current: unknown = root
  for (const part of parts) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function flattenResult(step: StepResult): Record<string, unknown> {
  const value = step.value
  const base: Record<string, unknown> = {
    ok: step.ok,
    summary: step.summary,
    expected: step.expected,
    actual: step.actual,
    reason: step.reason,
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return { ...base, ...(value as Record<string, unknown>) }
  }
  base.value = value
  return base
}

interface ExpectOutcome {
  pass: boolean
  expected: unknown
  actual: unknown
}

function evaluateExpect(expect: Record<string, unknown>, step: StepResult): ExpectOutcome {
  const root = flattenResult(step)
  const [kind, arg] = Object.entries(expect)[0] ?? ['truthy', '']
  switch (kind) {
    case 'truthy': {
      const actual = resolvePath(root, String(arg))
      return { pass: Boolean(actual), expected: 'truthy', actual }
    }
    case 'falsy': {
      const actual = resolvePath(root, String(arg))
      return { pass: !actual, expected: 'falsy', actual }
    }
    case 'eq': {
      const [target, expected] = arg as [string, unknown]
      const actual = resolvePath(root, target)
      return { pass: actual === expected, expected, actual }
    }
    case 'neq': {
      const [target, expected] = arg as [string, unknown]
      const actual = resolvePath(root, target)
      return { pass: actual !== expected, expected: `!= ${String(expected)}`, actual }
    }
    case 'gt': {
      const [target, expected] = arg as [string, number]
      const actual = Number(resolvePath(root, target))
      return { pass: actual > expected, expected: `> ${expected}`, actual }
    }
    case 'gte': {
      const [target, expected] = arg as [string, number]
      const actual = Number(resolvePath(root, target))
      return { pass: actual >= expected, expected: `>= ${expected}`, actual }
    }
    case 'lt': {
      const [target, expected] = arg as [string, number]
      const actual = Number(resolvePath(root, target))
      return { pass: actual < expected, expected: `< ${expected}`, actual }
    }
    case 'lte': {
      const [target, expected] = arg as [string, number]
      const actual = Number(resolvePath(root, target))
      return { pass: actual <= expected, expected: `<= ${expected}`, actual }
    }
    case 'contains': {
      const [target, substring] = arg as [string, string]
      const actual = String(resolvePath(root, target) ?? '')
      return { pass: actual.includes(substring), expected: `包含 ${substring}`, actual }
    }
    case 'matches': {
      const [target, pattern] = arg as [string, string]
      const actual = String(resolvePath(root, target) ?? '')
      return { pass: new RegExp(pattern).test(actual), expected: `匹配 ${pattern}`, actual }
    }
    case 'lenGte': {
      const [target, expected] = arg as [string, number]
      const actual = resolvePath(root, target)
      const length = Array.isArray(actual) || typeof actual === 'string' ? actual.length : 0
      return { pass: length >= expected, expected: `长度 >= ${expected}`, actual: length }
    }
    default:
      return { pass: false, expected: `未知断言类型 ${kind}`, actual: expect }
  }
}

function aggregateStatus(scenarios: ScenarioRecord[]): ScenarioStatus {
  if (scenarios.some((item) => item.status === 'FAIL')) return 'FAIL'
  if (scenarios.some((item) => item.status === 'BLOCKED')) return 'BLOCKED'
  if (scenarios.every((item) => item.status === 'NOT RUN')) return 'NOT RUN'
  return 'PASS'
}

export interface RunInput {
  suiteId: string
  scenarioId?: string
  mode: 'run' | 'dry'
}

export async function runSuite(
  loader: ConfigLoader,
  registry: PluginRegistry,
  input: RunInput,
  environment: Record<string, string>,
): Promise<RunReport> {
  const { suite, scenarios } = loader.resolveSuite(input.suiteId, input.scenarioId)
  const startedAt = Date.now()
  const runId = new Date(startedAt).toISOString().replace(/[:.]/g, '-')
  const artifactsDir = path.join(loader.resolved.artifactsDir, runId)
  mkdirSync(artifactsDir, { recursive: true })

  const shared: { page: PluginContext['page']; app: PluginContext['app'] } = { page: null, app: null }
  const logs: string[] = []
  const cleanupErrors: string[] = []
  const evidence: EvidenceEntry[] = []

  const baseContext: Omit<PluginContext, 'params'> = {
    runId,
    artifactsDir,
    config: loader.resolved,
    suitePlugins: suite.plugins,
    page: null,
    app: null,
    log: (line) => logs.push(line),
    attachEvidence: (entry) => evidence.push(entry),
    cleanupErrors,
  }

  const suitePlugins: E2ePlugin[] = suite.plugins.map((id) => {
    const plugin = registry.get(id)
    if (plugin === undefined) throw new Error(`套件引用未知插件 "${id}"`)
    return plugin
  })

  // 能力探测（运行模式）；dry-run 只做声明能力核对。
  const availability = new Map<string, { ok: boolean; missing: string[] }>()
  if (input.mode === 'run') {
    for (const plugin of suitePlugins) {
      const ctx: PluginContext = { ...baseContext, params: {} }
      availability.set(plugin.id, await plugin.available(ctx))
    }
  }

  const records: ScenarioRecord[] = []
  let setupRan = false

  for (const scenario of scenarios) {
    const started = Date.now()
    const evidenceBefore = evidence.length
    const record: ScenarioRecord = {
      id: scenario.def.id,
      title: scenario.def.title,
      status: 'NOT RUN',
      durationMs: 0,
      steps: [],
      evidence: [],
    }

    const scenarioCtx: PluginContext = { ...baseContext, params: scenario.def.params, page: shared.page, app: shared.app }

    // 能力核对：模板 requires 的每个能力必须有套件插件提供，且能力级探测通过。
    const capabilityMissing: Array<{ capability: string; missing: string[] }> = []
    for (const capability of scenario.requires) {
      const provider = registry.capabilityProvider(capability)
      if (provider === undefined) {
        capabilityMissing.push({ capability, missing: ['无插件提供该能力'] })
        continue
      }
      if (provider.capabilityAvailable !== undefined) {
        const avail = await provider.capabilityAvailable(scenarioCtx, capability)
        if (!avail.ok) capabilityMissing.push({ capability, missing: avail.missing })
      }
    }
    const unavailable = suitePlugins.filter((plugin) => availability.get(plugin.id)?.ok === false)
    if (capabilityMissing.length > 0 || unavailable.length > 0) {
      record.status = 'BLOCKED'
      const reasons: string[] = []
      for (const entry of capabilityMissing) {
        reasons.push(`${entry.capability}: ${entry.missing.join('; ')}`)
      }
      for (const plugin of unavailable) {
        reasons.push(`${plugin.id}: ${availability.get(plugin.id)?.missing.join('; ')}`)
      }
      record.reason = reasons.join(' | ')
      record.durationMs = Date.now() - started
      records.push(record)
      continue
    }

    if (input.mode === 'dry') {
      record.status = 'PASS'
      record.reason = 'dry-run：配置与参数展开已核对，未执行'
      record.steps = scenario.steps.map((step, index) => {
        const provider = registry.routeOp(step.op)
        return {
          index: index + 1,
          op: step.op,
          with: step.with,
          durationMs: 0,
          status: 'PASS' as ScenarioStatus,
          result: { plugin: provider?.id ?? null },
          evidence: [],
        }
      })
      record.durationMs = Date.now() - started
      records.push(record)
      continue
    }

    // 套件级 setup（逆序 teardown 在全部场景结束后执行）。
    if (!setupRan) {
      for (const plugin of suitePlugins) {
        const ctx: PluginContext = { ...baseContext, params: scenario.def.params, page: shared.page, app: shared.app }
        await plugin.setup?.(ctx)
        shared.page = ctx.page
        shared.app = ctx.app
      }
      setupRan = true
    }

    const ctx: PluginContext = {
      ...baseContext,
      params: scenario.def.params,
      page: shared.page,
      app: shared.app,
    }

    let failed = false
    let blocked = false
    for (const [index, step] of scenario.steps.entries()) {
      const stepStarted = Date.now()
      const provider = registry.routeOp(step.op)
      if (provider === undefined) {
        record.steps.push({
          index: index + 1,
          op: step.op,
          with: step.with,
          durationMs: 0,
          status: 'FAIL',
          reason: `没有插件能处理 op: ${step.op}`,
          expected: '存在路由插件',
          actual: '无',
          evidence: [],
        })
        failed = true
        break
      }

      let stepResult: StepResult
      try {
        stepResult = await provider.invoke(ctx, step.op, step.with)
      } catch (error) {
        stepResult = { ok: false, reason: `步骤异常: ${String(error)}` }
      }

      // 运行期能力/检查缺失：记 BLOCKED 并写具体缺失项，不放宽成通过，也不当作断言失败。
      if (stepResult.blocked === true) {
        const missing = stepResult.missing ?? []
        record.steps.push({
          index: index + 1,
          op: step.op,
          with: step.with,
          durationMs: Date.now() - stepStarted,
          status: 'BLOCKED',
          result: stepResult.value,
          expected: '所需检查/能力就绪',
          actual: missing.length > 0 ? missing.join('; ') : (stepResult.reason ?? '缺失'),
          reason: stepResult.reason ?? missing.join('; '),
          evidence: evidence.slice(evidenceBefore).filter((entry) => entry.note !== undefined).map((entry) => (entry.path || entry.note) ?? ''),
        })
        record.reason = stepResult.reason ?? missing.join('; ')
        blocked = true
        break
      }

      const expectKeys = Object.keys(step.expect)
      let outcome: ExpectOutcome = { pass: stepResult.ok, expected: stepResult.expected, actual: stepResult.actual }
      if (expectKeys.length > 0) {
        outcome = evaluateExpect(step.expect, stepResult)
      }

      const stepRecord: StepRecord = {
        index: index + 1,
        op: step.op,
        with: step.with,
        durationMs: Date.now() - stepStarted,
        status: outcome.pass ? 'PASS' : 'FAIL',
        result: stepResult.value,
        expected: outcome.expected,
        actual: outcome.actual,
        reason: stepResult.reason,
        evidence: evidence.slice(evidenceBefore).filter((entry) => entry.note !== undefined).map((entry) => (entry.path || entry.note) ?? ''),
      }
      record.steps.push(stepRecord)
      if (!outcome.pass) {
        failed = true
        break
      }
    }

    record.status = failed ? 'FAIL' : blocked ? 'BLOCKED' : 'PASS'
    record.durationMs = Date.now() - started
    record.evidence = evidence.slice(evidenceBefore).map((entry) => (entry.path || entry.note) ?? '')
    records.push(record)
  }

  // 逆序 teardown；清理错误记入报告，不覆盖场景状态。
  if (setupRan) {
    for (const plugin of [...suitePlugins].reverse()) {
      try {
        const errors = await plugin.teardown?.()
        if (Array.isArray(errors)) cleanupErrors.push(...errors)
      } catch (error) {
        cleanupErrors.push(`${plugin.id} teardown: ${String(error)}`)
      }
    }
  }

  return {
    runId,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    suiteId: suite.id,
    suiteTitle: suite.title,
    suite: { id: suite.id, title: suite.title },
    status: aggregateStatus(records),
    environment,
    scenarios: records,
    cleanupErrors,
  }
}

export function collectEnvironment(config: ResolvedConfig): Record<string, string> {
  const env: Record<string, string> = {
    node: process.version,
    platform: process.platform,
    editorRepo: config.paths.editorRepo,
    workspace: config.paths.workspace,
    icdev: config.paths.icdev,
  }
  try {
    const pkg = JSON.parse(readFileSync(path.join(config.paths.editorRepo, 'package.json'), 'utf8')) as { version?: string }
    env.editorVersion = pkg.version ?? 'unknown'
  } catch {
    env.editorVersion = 'unknown'
  }
  try {
    const gradle = readFileSync(path.join(path.dirname(config.paths.icdev), '..', 'gradle.properties'), 'utf8')
    const version = /^version=(.*)$/m.exec(gradle)?.[1]
    const loader = /^fabric_loader_version=(.*)$/m.exec(gradle)?.[1]
    env.modVersion = version ?? 'unknown'
    env.loader = loader ?? 'unknown'
  } catch {
    env.modVersion = 'unknown'
    env.loader = 'unknown'
  }
  try {
    const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' })
    env.ffmpeg = ffmpeg.status === 0 ? String(ffmpeg.stdout.split('\n')[0]) : 'not found'
  } catch {
    env.ffmpeg = 'not found'
  }
  return env
}
