/** report.md 落盘（docs/13-e2e-system.md §7）。 */
import { writeFileSync } from 'node:fs'
import path from 'node:path'

import type { RunReport, ScenarioRecord, StepRecord } from '../runner.ts'

export interface ManualItem {
  id: string
  source: string
  title: string
  reason: string
}

function statusBadge(status: string): string {
  return `**${status}**`
}

function renderStep(step: StepRecord): string {
  const lines = [
    `- 步骤 ${step.index} \`${step.op}\` — ${statusBadge(step.status)}（${step.durationMs}ms）`,
  ]
  if (step.reason) lines.push(`  - 原因: ${step.reason}`)
  if (step.expected !== undefined) lines.push(`  - 期望: ${JSON.stringify(step.expected)}`)
  if (step.actual !== undefined) lines.push(`  - 实际: ${JSON.stringify(step.actual)}`)
  if (Object.keys(step.with).length > 0) lines.push(`  - with: ${JSON.stringify(step.with)}`)
  return lines.join('\n')
}

function renderScenario(record: ScenarioRecord): string {
  const head = [
    `### ${record.id} — ${record.title}`,
    `- 状态: ${statusBadge(record.status)}（${record.durationMs}ms）`,
  ]
  if (record.reason) head.push(`- 备注: ${record.reason}`)
  if (record.evidence.length > 0) head.push(`- 证据: ${record.evidence.join(', ')}`)
  const body = record.steps.map(renderStep)
  return [...head, ...body].join('\n')
}

export function writeReportMarkdown(report: RunReport, artifactsDir: string, manualItems: ManualItem[] = []): string {
  const lines: string[] = []
  lines.push(`# E2E 系统报告 — ${report.suiteTitle}`)
  lines.push('')
  lines.push(`- runId: \`${report.runId}\``)
  lines.push(`- 套件: ${report.suiteId}`)
  lines.push(`- 状态: ${statusBadge(report.status)}`)
  lines.push(`- 开始: ${report.startedAt}`)
  lines.push(`- 结束: ${report.finishedAt}`)
  lines.push('')
  lines.push('## 环境')
  lines.push('')
  lines.push('| 项 | 值 |')
  lines.push('| --- | --- |')
  for (const [key, value] of Object.entries(report.environment)) {
    lines.push(`| ${key} | ${String(value)} |`)
  }
  lines.push('')

  lines.push('## 场景汇总')
  lines.push('')
  lines.push('| 场景 | 标题 | 状态 | 耗时 ms | 备注 |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (const scenario of report.scenarios) {
    lines.push(`| ${scenario.id} | ${scenario.title} | ${scenario.status} | ${scenario.durationMs} | ${scenario.reason ?? ''} |`)
  }
  lines.push('')

  const failed = report.scenarios.filter((item) => item.status === 'FAIL' || item.status === 'BLOCKED')
  if (failed.length > 0) {
    lines.push('## 失败 / 阻塞明细')
    lines.push('')
    for (const scenario of failed) lines.push(renderScenario(scenario), '')
  }

  const passing = report.scenarios.filter((item) => item.status === 'PASS')
  if (passing.length > 0) {
    lines.push('## 通过场景')
    lines.push('')
    for (const scenario of passing) {
      lines.push(`- ${scenario.id} — ${scenario.title}（${scenario.durationMs}ms）`)
    }
    lines.push('')
  }

  if (manualItems.length > 0) {
    lines.push('## 未自动化（NOT RUN / 人工核验）')
    lines.push('')
    lines.push('| 编号 | 来源 | 未自动化项 | 原因 |')
    lines.push('| --- | --- | --- | --- |')
    for (const item of manualItems) {
      lines.push(`| ${item.id} | ${item.source} | ${item.title} | ${item.reason} |`)
    }
    lines.push('')
  }

  if (report.cleanupErrors.length > 0) {
    lines.push('## 清理错误')
    lines.push('')
    for (const error of report.cleanupErrors) lines.push(`- ${error}`)
    lines.push('')
  }

  const file = path.join(artifactsDir, 'report.md')
  writeFileSync(file, lines.join('\n'), 'utf8')
  return file
}
