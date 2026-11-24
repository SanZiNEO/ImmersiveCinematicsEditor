/**
 * G6：豁免表守卫。
 *
 * 1. 类型：必须是 `Record<string, string>`，每条值非空。
 * 2. 格式：`<规则编号>: <对象> — <理由>`。
 * 3. 反查：豁免对象如果在当前代码上已经实现 / 已登记 / 已覆盖，仍留在表里 → FAIL。
 */
import { check, summaryLine, exitCode, notRun } from '../verify-kit.ts'
import { GUARD_EXEMPTIONS } from './exemptions.ts'
import {
  CORE_COVERAGE,
  builtinImportDirs,
  createGuardKernel,
  demoFacts,
  loadGuardManifests,
  scanDirectHits,
  selfTestCase,
} from './kernel.ts'

const KEY_RE = /^(G[1-6]): .+ — .+$/

function objectOf(key: string): string {
  const body = key.slice(4)
  const dash = body.indexOf(' — ')
  return (dash < 0 ? body : body.slice(0, dash)).trim()
}

async function main(): Promise<void> {
  const selfTest = selfTestCase()
  const table: Record<string, unknown> = { ...GUARD_EXEMPTIONS }

  // 自测夹具：只改内存表，不落盘。
  if (selfTest === 'empty-reason') table['G1: demo.tmp — 自测条目'] = ''
  if (selfTest === 'bad-key') table['G1 demo.tmp 缺分隔符'] = '自测'
  if (selfTest === 'bad-type') table['G1: demo.tmp — 自测条目'] = 42
  if (selfTest === 'already-implemented') table['G1: core.workbench — 自测：已登记'] = '自测'

  check('G6 豁免表是对象', typeof table === 'object' && table !== null && !Array.isArray(table))

  const entries = Object.entries(table)
  const valid: Array<[string, string]> = []
  for (const [key, value] of entries) {
    check(`G6 条目格式合规：${key}`, KEY_RE.test(key), key)
    check(`G6 理由非空：${key}`, typeof value === 'string' && value.trim() !== '', JSON.stringify(value))
    if (KEY_RE.test(key) && typeof value === 'string') valid.push([key, value])
  }

  const needsRuntime = valid.some(([key]) => key.startsWith('G2: ') || key.startsWith('G3: '))
  let registeredCommands = new Set<string>()
  let registeredPages = new Set<string>()
  if (needsRuntime) {
    try {
      const manifests = await loadGuardManifests()
      const kernel = await createGuardKernel(manifests)
      registeredCommands = new Set(kernel.registries.commands.list().map((entry) => entry.definition.commandId))
      for (const entry of demoFacts().commands) registeredCommands.add(entry.commandId)
      registeredPages = new Set([
        ...kernel.registries.pages.list().map((entry) => entry.contribution.pageId),
        ...kernel.registries.panels.list().map((entry) => entry.contribution.panelId),
        ...demoFacts().pages.map((entry) => entry.id),
        ...demoFacts().panels.map((entry) => entry.id),
      ])
      kernel.dispose()
    } catch (error) {
      notRun('G6 运行时 probe 装配', error instanceof Error ? error.message : String(error))
      return
    }
  }

  const builtinDirs = new Set(builtinImportDirs())
  const directHits = valid.some(([key]) => key.startsWith('G4: ')) ? scanDirectHits() : []

  for (const [key] of valid) {
    const rule = key.slice(0, 2)
    const object = objectOf(key)
    let stillNeeded = true
    if (rule === 'G1') stillNeeded = !builtinDirs.has(object)
    else if (rule === 'G2') stillNeeded = !registeredCommands.has(object)
    else if (rule === 'G3') {
      const bare = object.includes(':') ? object.slice(object.indexOf(':') + 1) : object
      stillNeeded = !registeredPages.has(object) && !registeredPages.has(bare)
    } else if (rule === 'G4') {
      stillNeeded = directHits.some((hit) => `${hit.file}:${hit.line}` === object)
    } else if (rule === 'G5') {
      stillNeeded = (CORE_COVERAGE[object] ?? []).length === 0
    }
    check(`G6 豁免仍有效：${key}`, stillNeeded, '已实现 / 已登记 / 已覆盖却仍豁免')
  }
}

void main().then(() => {
  console.log(summaryLine())
  process.exitCode = exitCode()
})
