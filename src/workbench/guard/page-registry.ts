/**
 * G3：面板 / 页面 ↔ 注册表双向守卫。
 *
 * - manifest 声明但注册表没有 → FAIL
 * - 注册表有但 manifest 没声明 → FAIL
 * - 组件路径不存在 → FAIL
 * - `.vue` 里的 pageId / panelId 字面量不在注册表或声明集合 → FAIL
 *
 * 只扫 src/plugins/**\/*.vue 与 src/workbench/shell/*.vue：layout 里的 slot 引用
 * （如 panelId: 'clip.effects'）是布局占位，不是面板贡献，扫进来会大量误报。
 */
import { dirname, join } from 'node:path'
import { check, summaryLine, exitCode, notRun } from '../verify-kit.ts'
import { GUARD_EXEMPTIONS } from './exemptions.ts'
import {
  REPO_ROOT,
  builtinImportDirs,
  createGuardKernel,
  demoFacts,
  isFile,
  loadGuardManifests,
  parseManifestComponents,
  readText,
  selfTestCase,
  stripComments,
  walkFiles,
} from './kernel.ts'

interface Contribution {
  key: string
  component: string | null
}

interface VueLiteral {
  value: string
  file: string
  line: number
}

/** 从懒加载函数源码里取 `import('<rel>')` 并解析成绝对路径。 */
function componentPath(manifestAbs: string, component: unknown): string | null {
  if (typeof component !== 'function') return null
  const text = Function.prototype.toString.call(component)
  const match = /import\('([^']+)'\)/.exec(text)
  return match === null ? null : join(dirname(manifestAbs), match[1]!)
}

function vueLiterals(): VueLiteral[] {
  const roots = [join(REPO_ROOT, 'src', 'plugins'), join(REPO_ROOT, 'src', 'workbench', 'shell')]
  const hits: VueLiteral[] = []
  for (const root of roots) {
    for (const file of walkFiles(root, ['.vue'])) {
      const lines = stripComments(readText(file)).split('\n')
      lines.forEach((line, index) => {
        const match = /\b(pageId|panelId)\s*:\s*'([^']+)'/.exec(line)
        if (match === null) return
        hits.push({
          value: match[2]!,
          file: file.replaceAll('\\', '/').replace(`${REPO_ROOT.replaceAll('\\', '/')}/`, ''),
          line: index + 1,
        })
      })
    }
  }
  return hits
}

async function main(): Promise<void> {
  const selfTest = selfTestCase()
  const manifests = await loadGuardManifests()
  const kernel = await createGuardKernel(manifests)

  const inactive = manifests.filter((manifest) => !kernel.pluginRegistry.isActive(manifest.id))
  for (const manifest of inactive) {
    notRun(`G3 插件可激活：${manifest.id}`, 'activate 失败，页面/面板注册表不完整')
  }

  const declared = new Map<string, Contribution>()
  const dirs = builtinImportDirs()
  for (const manifest of manifests) {
    const dir = dirs.find((candidate) => candidate === manifest.id) ?? manifest.id
    const manifestAbs = join(REPO_ROOT, 'src/plugins', dir, 'manifest.ts')
    for (const page of manifest.contributes.pages ?? []) {
      declared.set(`${manifest.id}:${page.pageId}`, {
        key: `${manifest.id}:${page.pageId}`,
        component: componentPath(manifestAbs, page.component),
      })
    }
    for (const panel of manifest.contributes.panels ?? []) {
      declared.set(`${manifest.id}:${panel.panelId}`, {
        key: `${manifest.id}:${panel.panelId}`,
        component: componentPath(manifestAbs, panel.component),
      })
    }
  }

  const demo = demoFacts()
  for (const page of demo.pages) {
    declared.set(`demo.kitchen-sink:${page.id}`, { key: `demo.kitchen-sink:${page.id}`, component: page.component })
  }
  for (const panel of demo.panels) {
    declared.set(`demo.kitchen-sink:${panel.id}`, { key: `demo.kitchen-sink:${panel.id}`, component: panel.component })
  }

  const registered = new Map<string, string>() // key → kind
  for (const entry of kernel.registries.pages.list()) {
    registered.set(`${entry.pluginId}:${entry.contribution.pageId}`, 'page')
  }
  for (const entry of kernel.registries.panels.list()) {
    registered.set(`${entry.pluginId}:${entry.contribution.panelId}`, 'panel')
  }
  // demo.kitchen-sink 不能 activate（JSON import 限制），静态登记它的 1 页 + 3 面板。
  for (const page of demo.pages) registered.set(`demo.kitchen-sink:${page.id}`, 'page')
  for (const panel of demo.panels) registered.set(`demo.kitchen-sink:${panel.id}`, 'panel')

  // 自测夹具：只改内存集合，不改真实源码。
  if (selfTest === 'orphan-registered') registered.set('demo.kitchen-sink:demo.ghost.panel', 'panel')
  if (selfTest === 'missing-component') {
    declared.set('demo.kitchen-sink:demo.ghost.page', {
      key: 'demo.kitchen-sink:demo.ghost.page',
      component: join(REPO_ROOT, 'src/plugins/demo.kitchen-sink/pages/GhostPage.vue'),
    })
    registered.set('demo.kitchen-sink:demo.ghost.page', 'page')
  }

  for (const [key, item] of declared) {
    check(`G3 贡献已注册：${key}`, registered.has(key), 'manifest 声明但注册表缺失')
    check(`G3 组件文件存在：${key}`, item.component !== null && isFile(item.component), item.component ?? '组件路径未解析')
  }
  for (const key of registered.keys()) {
    check(`G3 注册项非孤儿：${key}`, declared.has(key), '注册表有但 manifest 未声明')
  }

  const values = new Set<string>()
  for (const key of declared.keys()) values.add(key.slice(key.indexOf(':') + 1))
  for (const key of registered.keys()) values.add(key.slice(key.indexOf(':') + 1))

  let literals = vueLiterals()
  if (selfTest === 'ghost-page') {
    literals = [...literals, { value: 'demo.ghost-page', file: 'src/plugins/demo.kitchen-sink/pages/SandboxPage.vue', line: 24 }]
  }
  for (const hit of literals) {
    check(`G3 字面量已登记：${hit.value}`, values.has(hit.value), `${hit.file}:${hit.line}`)
  }

  for (const [key, why] of Object.entries(GUARD_EXEMPTIONS)) {
    if (!key.startsWith('G3: ')) continue
    if (registered.has(key.slice(4).trim())) {
      check(`G3 豁免仍有效：${key.slice(4).trim()}`, false, `已注册却仍豁免：${why}`)
    }
  }

  kernel.dispose()
}

void main().then(() => {
  console.log(summaryLine())
  process.exitCode = exitCode()
})
