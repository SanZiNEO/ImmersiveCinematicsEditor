/**
 * e2e-system CLI（docs/13-e2e-system.md §5）。
 *
 * 用法：
 *   node --experimental-strip-types e2e-system/src/cli.ts list
 *   node --experimental-strip-types e2e-system/src/cli.ts dry-run --suite <id> [--scenario <id>]
 *   node --experimental-strip-types e2e-system/src/cli.ts run --suite <id> [--scenario <id>]
 *   node --experimental-strip-types e2e-system/src/cli.ts review [--fixture <本地 JSON 路径>]
 *
 * 退出码：0 全 PASS；1 任一 FAIL；2 BLOCKED 且无 FAIL。review 正常关闭为 0，启动或落盘失败为 1；
 * Ctrl+C 时 Playwright 可能以自己的 SIGINT 处理退出 130（本会话 Vite 已在信号处理里同步停止）。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ConfigLoader, ConfigError } from './config.ts'
import { collectEnvironment, createRegistry, runSuite, type RunReport } from './runner.ts'
import { writeRunJson } from './report/json.ts'
import { writeReportMarkdown } from './report/markdown.ts'
import { runReview } from './review.ts'

function parseArgs(argv: string[]): { command: string; suite?: string; scenario?: string; fixture?: string } {
  const [command, ...rest] = argv
  const options: { suite?: string; scenario?: string; fixture?: string } = {}
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    if (token === '--suite') options.suite = rest[++index]
    else if (token === '--scenario') options.scenario = rest[++index]
    else if (token === '--fixture') {
      const value = rest[++index]
      if (value === undefined || value === '') {
        throw new ConfigError('E_CONFIG', '--fixture 需要本地 JSON 文件路径')
      }
      options.fixture = value
    }
  }
  return { command: command ?? 'list', ...options }
}

function repoRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(here, '..', '..')
}

function printList(loader: ConfigLoader, registry: ReturnType<typeof createRegistry>): void {
  console.log('=== 套件 ===')
  for (const suiteId of loader.suiteIds) {
    const suite = loader.suite(suiteId)
    console.log(`- ${suiteId}: ${suite.title}`)
    console.log(`  插件: ${suite.plugins.join(', ')}`)
    console.log(`  场景: ${suite.scenarios.join(', ')}`)
  }

  console.log('\n=== 场景 ===')
  for (const scenarioId of loader.scenarioIds) {
    const resolved = loader.resolveScenario(scenarioId)
    console.log(`- ${scenarioId} [模板 ${resolved.template.id}] ${resolved.def.title}`)
    console.log(`  能力: ${resolved.requires.join(', ') || '（无）'}`)
    console.log(`  步骤: ${resolved.steps.map((step) => step.op).join(' → ')}`)
  }

  console.log('\n=== 模板 ===')
  for (const templateId of loader.templateIds) {
    const template = loader.template(templateId)
    console.log(`- ${templateId}: ${template.description}`)
  }

  console.log('\n=== 插件与能力 ===')
  for (const plugin of registry.all()) {
    console.log(`- ${plugin.id}: ${plugin.capabilities.join(', ')}`)
    console.log(`  ops: ${plugin.ops.join(', ')}`)
  }
}

async function execute(
  loader: ConfigLoader,
  registry: ReturnType<typeof createRegistry>,
  command: 'dry' | 'run',
  suiteId: string,
  scenarioId?: string,
): Promise<number> {
  const environment = collectEnvironment(loader.resolved)
  const report: RunReport = await runSuite(loader, registry, {
    suiteId,
    scenarioId,
    mode: command === 'run' ? 'run' : 'dry',
  }, environment)

  console.log(`=== ${command === 'run' ? 'run' : 'dry-run'} ${suiteId} ===`)
  console.log(`状态: ${report.status}`)
  for (const scenario of report.scenarios) {
    const reason = scenario.reason ? ` — ${scenario.reason}` : ''
    console.log(`- ${scenario.id}: ${scenario.status}（${scenario.durationMs}ms）${reason}`)
    if (command === 'dry') {
      for (const step of scenario.steps) {
        const plugin = (step.result as { plugin?: string | null } | undefined)?.plugin ?? '—'
        const withArgs = Object.keys(step.with).length > 0 ? ` ${JSON.stringify(step.with)}` : ''
        console.log(`    · ${step.op} → ${plugin}${withArgs}`)
      }
    }
  }

  if (command === 'run') {
    const runJson = writeRunJson(report, path.join(loader.resolved.artifactsDir, report.runId))
    const reportMd = writeReportMarkdown(report, path.join(loader.resolved.artifactsDir, report.runId), loader.manualItems())
    console.log(`\n报告:`)
    console.log(`- ${runJson}`)
    console.log(`- ${reportMd}`)
  }

  if (report.status === 'FAIL') return 1
  if (report.status === 'BLOCKED' || report.status === 'NOT RUN') return 2
  return 0
}

async function main(): Promise<number> {
  try {
    const args = parseArgs(process.argv.slice(2))
    const loader = new ConfigLoader(repoRoot())
    const registry = createRegistry()

    if (args.command === 'list') {
      printList(loader, registry)
      return 0
    }
    if (args.command === 'dry-run' || args.command === 'dry') {
      if (!args.suite) throw new ConfigError('E_CONFIG', 'dry-run 需要 --suite <id>')
      return await execute(loader, registry, 'dry', args.suite, args.scenario)
    }
    if (args.command === 'run') {
      if (!args.suite) throw new ConfigError('E_CONFIG', 'run 需要 --suite <id>')
      return await execute(loader, registry, 'run', args.suite, args.scenario)
    }
    if (args.command === 'review') {
      return await runReview(loader, { fixture: args.fixture })
    }
    console.error(`未知命令: ${args.command}（可用: list / dry-run / run / review）`)
    return 1
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`[${error.code}] ${error.message}`)
      return 1
    }
    console.error(`执行失败: ${String(error)}`)
    return 1
  }
}

main()
  .then((exitCode) => {
    process.exit(exitCode)
  })
  .catch((error) => {
    console.error(`未捕获异常: ${String(error)}`)
    process.exit(1)
  })
