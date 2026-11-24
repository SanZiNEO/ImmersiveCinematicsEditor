// verify:all — 串行聚合九个自检 + 六个守卫，FAIL / BLOCKED / NOT RUN 分开记账。
// 零第三方依赖，仅用 node:child_process / node:fs / node:path / node:url。
// 退出码：任一子项 exit 1 -> 整体 1；否则任一 exit 2 / 未启动 / 脚本缺失 -> 整体 2；全 0 -> 0。
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

// 顺序固定：先九个自检（第一项是 verify.ts，不是 verify-01.ts），再六个守卫。
const ITEMS = [
  ['verify', 'src/workbench/verify.ts'],
  ['verify-05', 'src/workbench/verify-05.ts'],
  ['verify-06', 'src/workbench/verify-06.ts'],
  ['verify-07', 'src/workbench/verify-07.ts'],
  ['verify-08', 'src/workbench/verify-08.ts'],
  ['verify-09', 'src/workbench/verify-09.ts'],
  ['verify-10', 'src/workbench/verify-10.ts'],
  ['verify-11', 'src/workbench/verify-11.ts'],
  ['verify-12', 'src/workbench/verify-12.ts'],
  ['guard/plugin-registry', 'src/workbench/guard/plugin-registry.ts'],
  ['guard/command-handlers', 'src/workbench/guard/command-handlers.ts'],
  ['guard/page-registry', 'src/workbench/guard/page-registry.ts'],
  ['guard/host-boundary', 'src/workbench/guard/host-boundary.ts'],
  ['guard/core-coverage', 'src/workbench/guard/core-coverage.ts'],
  ['guard/exemptions-guard', 'src/workbench/guard/exemptions-guard.ts'],
]

const RESULT_RE = /FAIL|NOT RUN|BLOCKED/

function lastNonEmptyLine(text) {
  if (!text) return ''
  const lines = text.split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim().length > 0) return lines[i]
  }
  return ''
}

// 末行不一定就是计数行（例如 verify-09 末行是"未自动验收…"的说明），
// 因此优先取最后一条像 summary 的行（含 ok= / fail= / 自检），取不到再退回末行非空。
const SUMMARY_RE = /ok=|fail=|自检/

function summaryOf(stdout, stderr) {
  const lines = []
  for (const text of [stdout, stderr]) {
    for (const line of text.split(/\r?\n/)) {
      if (line.trim().length > 0) lines.push(line.trim())
    }
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    if (SUMMARY_RE.test(lines[i])) return lines[i]
  }
  return lastNonEmptyLine(stdout) || lastNonEmptyLine(stderr)
}

function collectResultLines(stdout, stderr) {
  const lines = []
  for (const text of [stdout, stderr]) {
    for (const line of text.split(/\r?\n/)) {
      if (RESULT_RE.test(line)) lines.push(line)
    }
  }
  return lines
}

// NOT RUN 的语义是"本轮未执行、写明原因、不参与判定"（example/rounds/README.md §4.3）。
// 本机默认仍按 02-01 的聚合口径（有 2 -> 整体 2），只有显式 VERIFY_ALLOW_NOT_RUN=1 时，
// 才把"仅由 NOT RUN 造成的 2"排除出判定；BLOCKED（exit 2 但没有 NOT RUN 行）永远算失败。
const allowNotRun = process.env.VERIFY_ALLOW_NOT_RUN === '1'

const startedAt = Date.now()
console.log(`# verify:all repoRoot=${repoRoot} node=${process.version} allowNotRun=${allowNotRun}`)

const results = []
let overall = 0 // 0 = 全过；2 = BLOCKED/NOT RUN；1 = 有 FAIL

for (const [name, rel] of ITEMS) {
  const abs = join(repoRoot, rel)

  // 异常情形 1：脚本文件不存在 -> BLOCKED，不算崩溃。
  if (!existsSync(abs)) {
    const reason = `脚本不存在: ${rel}`
    console.log(`[${name}] exit=N/A summary=<${reason}>`)
    console.log(`  BLOCKED ${reason}`)
    results.push({ name, rel, category: 'BLOCKED', reason, detailLines: [] })
    if (overall !== 1) overall = 2
    continue
  }

  const res = spawnSync(process.execPath, ['--experimental-strip-types', rel], {
    cwd: repoRoot,
    encoding: 'utf8',
  })

  const stdout = res.stdout ?? ''
  const stderr = res.stderr ?? ''
  const summary = summaryOf(stdout, stderr)
  const detailLines = collectResultLines(stdout, stderr)

  // 异常情形 2：子进程未启动 / 被信号杀掉（status === null）-> BLOCKED。
  if (res.status === null) {
    const reason = res.error
      ? `未启动: ${res.error.message}`
      : `被信号杀掉: signal=${res.signal}`
    console.log(`[${name}] exit=N/A summary=<${reason}>`)
    console.log(`  BLOCKED ${reason}`)
    results.push({ name, rel, category: 'BLOCKED', reason, detailLines })
    if (overall !== 1) overall = 2
    continue
  }

  console.log(`[${name}] exit=${res.status} summary=${summary || '<空>'}`)

  let category
  let reason
  if (res.status === 1) {
    category = 'FAIL'
    reason = detailLines[0] ?? 'exit=1'
    overall = 1
  } else if (res.status === 2) {
    const notRunLines = detailLines.filter((l) => l.includes('NOT RUN'))
    if (notRunLines.length > 0) {
      category = 'NOT RUN'
      reason = notRunLines.join(' | ')
      // allowNotRun 只豁免 NOT RUN；BLOCKED 仍按下面统一置 2。
      if (!allowNotRun && overall !== 1) overall = 2
    } else {
      category = 'BLOCKED'
      reason = detailLines[0] ?? 'exit=2'
      if (overall !== 1) overall = 2
    }
  } else {
    category = 'PASS'
    reason = ''
  }

  // 失败项：原样打印 stdout/stderr 里的 FAIL / NOT RUN / BLOCKED 行，保留 文件:行 定位，不截断不改写。
  if (res.status !== 0) {
    for (const line of detailLines) console.log(`  ${line}`)
  }

  results.push({ name, rel, category, reason, detailLines })
}

const counts = { PASS: 0, FAIL: 0, BLOCKED: 0, 'NOT RUN': 0 }
for (const r of results) counts[r.category] += 1

console.log('--- 汇总 ---')
console.log(`PASS: ${counts.PASS}`)
console.log(`FAIL: ${counts.FAIL}`)
console.log(`BLOCKED: ${counts.BLOCKED}`)
console.log(`NOT RUN: ${counts['NOT RUN']}`)
if (counts['NOT RUN'] > 0) {
  console.log(
    allowNotRun
      ? `# VERIFY_ALLOW_NOT_RUN=1：NOT RUN 不参与判定（不是 PASS，逐条列在下面）`
      : `# NOT RUN 参与整体退出码（未设 VERIFY_ALLOW_NOT_RUN=1）`,
  )
}

for (const r of results) {
  if (r.category === 'BLOCKED') console.log(`BLOCKED [${r.name}] ${r.reason}`)
  else if (r.category === 'NOT RUN') console.log(`NOT RUN [${r.name}] ${r.reason}`)
}

console.log(`# 耗时 ${Date.now() - startedAt} ms`)

// 02-05：GitHub Actions job summary 显式列 BLOCKED / NOT RUN 与缺失项，避免只留在日志里。
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    '## verify:all',
    '',
    `- exit: ${overall}`,
    `- PASS: ${counts.PASS} / FAIL: ${counts.FAIL} / BLOCKED: ${counts.BLOCKED} / NOT RUN: ${counts['NOT RUN']}`,
    `- VERIFY_ALLOW_NOT_RUN: ${allowNotRun ? '1（NOT RUN 不参与判定）' : '未设（NOT RUN 参与退出码）'}`,
    '',
    '| 项 | 结果 | 原因 / summary |',
    '|---|---|---|',
    ...results.map((r) => `| ${r.name} | ${r.category} | ${(r.reason || '').replaceAll('|', '\\|')} |`),
  ]
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`, 'utf8')
  } catch (error) {
    console.log(`# 无法写 GITHUB_STEP_SUMMARY: ${error instanceof Error ? error.message : String(error)}`)
  }
}

process.exitCode = overall
