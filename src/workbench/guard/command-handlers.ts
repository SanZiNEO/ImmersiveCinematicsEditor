/**
 * G2：命令 ID ↔ handler 双向守卫（四种错误全拦）。
 *
 * 1. 有声明没 handler
 * 2. 有 handler 没声明（孤儿）
 * 3. 引用映射到不存在的命令
 * 4. 命令名不是合法命令形态
 *
 * 运行时只用内存内核里的 CommandRegistry（不 execute，避免副作用）；
 * demo.kitchen-sink 因 JSON import 限制不能 activate，其 3 条命令用源码静态核对。
 */
import { join } from 'node:path'
import { check, summaryLine, exitCode, notRun } from '../verify-kit.ts'
import { GUARD_EXEMPTIONS } from './exemptions.ts'
import {
  REPO_ROOT,
  createGuardKernel,
  demoFacts,
  loadGuardManifests,
  readText,
  selfTestCase,
} from './kernel.ts'

const COMMAND_ID_RE = /^[a-z][A-Za-z0-9]*\.[A-Za-z0-9.]+$/

interface RegisteredInfo {
  pluginId: string
  hasRun: boolean
}

function literalIds(source: string): string[] {
  return [...source.matchAll(/commandId:\s*'([^']+)'/g)].map((match) => match[1]!)
}

function registeredLiterals(source: string): string[] {
  return [...source.matchAll(/\bregister\('([^']+)'/g)].map((match) => match[1]!)
}

async function main(): Promise<void> {
  const selfTest = selfTestCase()
  const manifests = await loadGuardManifests()
  const kernel = await createGuardKernel(manifests)

  const inactive = manifests.filter((manifest) => !kernel.pluginRegistry.isActive(manifest.id))
  for (const manifest of inactive) {
    notRun(`G2 插件可激活：${manifest.id}`, 'activate 失败，命令注册表不完整')
  }

  const declared = new Map<string, string>() // commandId → pluginId
  for (const manifest of manifests) {
    for (const command of manifest.contributes.commands ?? []) {
      declared.set(command.commandId, manifest.id)
    }
  }

  for (const id of registeredLiterals(readText(join(REPO_ROOT, 'src/plugins/core.workbench/commands.ts')))) {
    declared.set(id, 'core.workbench')
  }
  for (const id of literalIds(readText(join(REPO_ROOT, 'src/plugins/core.script-graph/commands.ts')))) {
    declared.set(id, 'core.script-graph')
  }
  for (const id of literalIds(readText(join(REPO_ROOT, 'src/plugins/core.camera-inspect/index.ts')))) {
    declared.set(id, 'core.camera-inspect')
  }

  const demo = demoFacts()
  for (const command of demo.commands) declared.set(command.commandId, 'demo.kitchen-sink')

  const registered = new Map<string, RegisteredInfo>()
  for (const entry of kernel.registries.commands.list()) {
    registered.set(entry.definition.commandId, {
      pluginId: entry.pluginId,
      hasRun: typeof entry.definition.run === 'function',
    })
  }
  for (const command of demo.commands) {
    registered.set(command.commandId, { pluginId: 'demo.kitchen-sink', hasRun: command.hasRun })
  }

  // 自测夹具：只改内存集合，不改真实源码。
  if (selfTest === 'missing-handler') registered.delete('file.saveDoc')
  if (selfTest === 'orphan-handler') registered.set('demo.orphan.command', { pluginId: 'demo.kitchen-sink', hasRun: true })
  if (selfTest === 'bad-name') declared.set('Bad Command', 'demo.kitchen-sink')

  for (const [id, pluginId] of declared) {
    check(`G2 声明命令有 handler：${id}`, registered.has(id), `plugin=${pluginId} 无 handler`)
  }
  for (const [id, info] of registered) {
    check(`G2 handler 非孤儿：${id}`, declared.has(id), `plugin=${info.pluginId} 未在声明来源登记`)
    check(`G2 handler 带 run：${id}`, info.hasRun, `plugin=${info.pluginId} 缺 run`)
  }

  const references: Array<{ id: string; source: string }> = []
  for (const dir of manifests.map((manifest) => manifest.id)) {
    const manifestPath = join(REPO_ROOT, 'src/plugins', dir, 'manifest.ts')
    let source = ''
    try {
      source = readText(manifestPath)
    } catch {
      continue
    }
    for (const match of source.matchAll(/commandId:\s*'([^']+)'/g)) {
      references.push({ id: match[1]!, source: dir })
    }
  }
  if (selfTest === 'dangling-ref') references.push({ id: 'demo.missing.command', source: 'self-test' })
  for (const reference of references) {
    check(`G2 引用命令存在：${reference.id}`, registered.has(reference.id), `引用方=${reference.source}`)
  }

  for (const id of declared.keys()) {
    check(`G2 命令名合法：${id}`, COMMAND_ID_RE.test(id), id)
  }

  for (const [key, why] of Object.entries(GUARD_EXEMPTIONS)) {
    if (!key.startsWith('G2: ')) continue
    const id = key.slice(4).trim()
    if (registered.has(id)) {
      check(`G2 豁免仍有效：${id}`, false, `已注册却仍豁免：${why}`)
    }
  }

  kernel.dispose()
}

void main().then(() => {
  console.log(summaryLine())
  process.exitCode = exitCode()
})
