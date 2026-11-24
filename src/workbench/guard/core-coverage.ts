/**
 * G5：`src/core/*` 模块必须映射到具体 verify 入口。
 *
 * 映射不是只写表：入口文件必须存在，且源码真的 import 了该模块。
 * 未映射的模块必须进豁免表（G5: <module> — 理由）。
 */
import { readdirSync } from 'fs'
import { join } from 'node:path'
import { check, summaryLine, exitCode, notRun } from '../verify-kit.ts'
import { GUARD_EXEMPTIONS } from './exemptions.ts'
import { CORE_COVERAGE, REPO_ROOT, isFile, readText, selfTestCase } from './kernel.ts'

function importsModule(entry: string, module: string): boolean {
  let source = ''
  try {
    source = readText(join(REPO_ROOT, entry))
  } catch {
    return false
  }
  if (entry.startsWith(`src/core/${module}/`)) {
    return /from\s+'\.\/[^']+'/.test(source) || new RegExp(`from\\s+'\\.\\./${module}/`).test(source)
  }
  return new RegExp(`core/${module}/`).test(source)
}

function main(): void {
  const selfTest = selfTestCase()
  let modules: string[]
  try {
    modules = readdirSync(join(REPO_ROOT, 'src/core'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch (error) {
    notRun('G5 core 模块目录可读', error instanceof Error ? error.message : String(error))
    return
  }

  if (selfTest === 'uncovered-module') modules.push('phantom')

  const exempt = new Map<string, string>()
  for (const [key, why] of Object.entries(GUARD_EXEMPTIONS)) {
    if (key.startsWith('G5: ')) exempt.set(key.slice(4).trim(), why)
  }

  for (const module of modules) {
    const entries = CORE_COVERAGE[module] ?? []
    if (entries.length === 0) {
      check(`G5 模块已覆盖或豁免：${module}`, exempt.has(module), '无 verify 映射且未豁免')
      continue
    }
    if (exempt.has(module)) {
      check(`G5 豁免仍有效：${module}`, false, '已有 verify 映射却仍豁免')
    }
    for (const entry of entries) {
      check(`G5 覆盖入口存在：${module} → ${entry}`, isFile(join(REPO_ROOT, entry)), entry)
      check(`G5 入口实际引用模块：${module} → ${entry}`, importsModule(entry, module), entry)
    }
  }
}

main()
console.log(summaryLine())
process.exitCode = exitCode()
