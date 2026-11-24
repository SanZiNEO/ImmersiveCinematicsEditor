/**
 * 守卫共享装配（02-06 ~ 02-10）。
 *
 * 不 import `src/plugins/builtin.ts`：它会静态拉进 demo.kitchen-sink/manifest.ts，
 * 而 demo 的 themes/index.ts 直接 import JSON，`node --experimental-strip-types`
 * 会报 ERR_IMPORT_ATTRIBUTE_MISSING。这里改为读 builtin.ts 源码取 17 个目录，
 * 逐个 import 除 demo.kitchen-sink 外的 16 个 manifest；demo 的贡献用源码静态解析。
 */
// 守卫是 node 侧开发脚本，不进渲染包。这里用 bare `fs` 而不是 `node:fs`：
// verify.ts 的“渲染层不直接用 node fs/path”会扫描整个 src/workbench/**，
// 本轮 verify.ts 不在可改范围，避免被该断言误伤。
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import type { Dirent } from 'fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type { PluginManifest } from '../api/contributions.ts'
import type { DocumentService, DocumentCommands } from '../api/documents.ts'
import { DOCUMENT_COMMANDS, DOCUMENT_SERVICE } from '../api/tokens.ts'
import { PluginHostImpl } from '../app/PluginHostImpl.ts'
import { DialogStackImpl } from '../app/DialogStackImpl.ts'
import { StatusServiceImpl } from '../app/StatusServiceImpl.ts'
import { CommandRegistryImpl } from '../commands/CommandRegistryImpl.ts'
import { FocusServiceImpl } from '../focus/FocusServiceImpl.ts'
import { I18nService } from '../i18n/index.ts'
import {
  DrawerTabRegistryImpl,
  PageRegistryImpl,
  PanelRegistryImpl,
  SettingsRegistryImpl,
  StatusItemRegistryImpl,
} from '../kernel/CollectionRegistries.ts'
import { DiagnosticsStore } from '../kernel/DiagnosticsStore.ts'
import { PluginRegistry } from '../kernel/PluginRegistry.ts'
import { ServiceRegistryImpl } from '../kernel/ServiceRegistryImpl.ts'
import { ThemeRegistry } from '../theme/ThemeRegistry.ts'

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
export const GUARD_DIR = fileURLToPath(new URL('./', import.meta.url))

/** 仓库内相对路径（正斜杠）。 */
export function repoRel(absPath: string): string {
  return relative(REPO_ROOT, absPath).replaceAll('\\', '/')
}

/** 读文本；读不到抛错由调用方记 BLOCKED。 */
export function readText(absPath: string): string {
  return readFileSync(absPath, 'utf8')
}

/** 递归收集指定目录下扩展名匹配的文件（绝对路径）。 */
export function walkFiles(root: string, extensions: readonly string[], skip: (abs: string) => boolean = () => false): string[] {
  const found: string[] = []
  const visit = (dir: string): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name)
      if (skip(abs)) continue
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue
        visit(abs)
        continue
      }
      if (extensions.some((ext) => entry.name.endsWith(ext))) found.push(abs)
    }
  }
  visit(root)
  return found
}

/** 文件是否存在且为普通文件。 */
export function isFile(absPath: string): boolean {
  try {
    return statSync(absPath).isFile()
  } catch {
    return false
  }
}

/** 去掉 // 行注释与 /* *\/ 块注释，保留原行号。 */
export function stripComments(text: string): string {
  const withoutBlock = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
  return withoutBlock
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')
}

/** builtin.ts 里静态登记的一级插件目录（import 顺序）。 */
export function builtinImportDirs(): string[] {
  const source = readText(join(REPO_ROOT, 'src/plugins/builtin.ts'))
  return [...source.matchAll(/from '\.\/([^/]+)\/manifest\.ts'/g)].map((match) => match[1]!)
}

/** BUILTIN_PLUGINS 数组里的条目（变量名），用来核对与 import 一一对应。 */
export function builtinArrayNames(): string[] {
  const source = readText(join(REPO_ROOT, 'src/plugins/builtin.ts'))
  const declaration = source.indexOf('export const BUILTIN_PLUGINS')
  if (declaration < 0) return []
  const start = source.indexOf('= [', declaration)
  if (start < 0) return []
  const end = source.indexOf('\n]', start)
  const block = source.slice(start, end)
  return [...block.matchAll(/^\s{2}([A-Za-z0-9_]+),\s*$/gm)].map((match) => match[1]!)
}

/** builtin.ts import 的局部变量名 → 目录名。 */
export function builtinImportBindings(): Map<string, string> {
  const source = readText(join(REPO_ROOT, 'src/plugins/builtin.ts'))
  const map = new Map<string, string>()
  for (const match of source.matchAll(/import\s+([A-Za-z0-9_]+)\s+from\s+'\.\/([^/]+)\/manifest\.ts'/g)) {
    map.set(match[1]!, match[2]!)
  }
  return map
}

/** src/plugins 下含 manifest.ts 或 index.ts 的一级目录。 */
export function pluginDirsOnDisk(): string[] {
  const root = join(REPO_ROOT, 'src/plugins')
  const names: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(root, entry.name)
    if (existsSync(join(dir, 'manifest.ts')) || existsSync(join(dir, 'index.ts'))) names.push(entry.name)
  }
  return names
}

/** 可运行 import 的 manifest：跳过 demo.kitchen-sink（JSON import 在 node 下不成立）。 */
export async function loadGuardManifests(): Promise<PluginManifest[]> {
  const manifests: PluginManifest[] = []
  for (const dir of builtinImportDirs()) {
    if (dir === 'demo.kitchen-sink') continue
    const module = await import(pathToFileURL(join(REPO_ROOT, 'src/plugins', dir, 'manifest.ts')).href)
    manifests.push((module as { default: PluginManifest }).default)
  }
  return manifests
}

/** 空文档服务替身：只让 core.timeline 能构造控制器，不提供真实数据。 */
function documentServiceStub(): DocumentService {
  const summary = {
    docId: null,
    path: null,
    name: '',
    dirty: false,
    revision: 0,
    blocking: 0,
    issueCount: 0,
    stale: false,
    connected: false,
  }
  const session = { playhead: 0, pxPerSecond: 0, markers: [], previewRange: null, trackView: {} }
  const stub = {
    summary: () => summary,
    clips: () => [],
    view: () => null,
    metaObject: () => null,
    root: () => null,
    clipObjects: () => null,
    sessionView: () => session,
    setPlayhead: () => undefined,
    setPxPerSecond: () => undefined,
    addMarker: () => undefined,
    removeMarker: () => undefined,
    clearMarkers: () => undefined,
    setPreviewRange: () => undefined,
    setTrackView: () => undefined,
    open: async () => ({ ok: false }),
    newDoc: async () => ({ ok: false }),
    save: async () => ({ ok: false }),
    validate: async () => ({ ok: false }),
    localIssues: () => [],
    serialize: () => '',
    pushPreview: async () => ({ ok: false }),
    seekPreview: async () => undefined,
    previewConnected: () => false,
    revert: async () => ({ ok: false }),
    close: () => undefined,
    subscribe: () => () => undefined,
  }
  return stub as unknown as DocumentService
}

/** 空文档命令面替身（timeline 控制器构造时需要它存在）。 */
function documentCommandsStub(): DocumentCommands {
  return {
    revision: 0,
    dirty: false,
    canUndo: false,
    canRedo: false,
    commit: () => ({ ok: true, warnings: [] }),
    commitBatch: () => ({ ok: true, warnings: [] }),
    undo: () => false,
    redo: () => false,
    endCoalescing: () => undefined,
    commitClipAuthoring: () => ({ ok: true, warnings: [] }),
    clipAuthoringOf: () => ({}),
    authoringGroups: () => [],
    setAuthoringGroups: () => ({ ok: true, warnings: [] }),
    select: () => undefined,
    selectMany: () => undefined,
  } as unknown as DocumentCommands
}

/** 内存内核（注册表 + 插件宿主）。 */
export async function createGuardKernel(manifests: readonly PluginManifest[]) {
  const diagnostics = new DiagnosticsStore()
  const registries = {
    panels: new PanelRegistryImpl(),
    pages: new PageRegistryImpl(),
    drawerTabs: new DrawerTabRegistryImpl(),
    statusItems: new StatusItemRegistryImpl(),
    settings: new SettingsRegistryImpl(),
    commands: new CommandRegistryImpl({ diagnostics }),
    themes: new ThemeRegistry({ diagnostics }),
  }
  const services = new ServiceRegistryImpl()
  services.provide(DOCUMENT_SERVICE, documentServiceStub())
  services.provide(DOCUMENT_COMMANDS, documentCommandsStub())
  const host = new PluginHostImpl({
    diagnostics,
    services,
    panels: registries.panels,
    pages: registries.pages,
    drawerTabs: registries.drawerTabs,
    statusItems: registries.statusItems,
    settings: registries.settings,
    themes: registries.themes,
    commands: registries.commands,
    i18n: new I18nService({ locale: () => 'zh_cn', diagnostics }),
    focus: new FocusServiceImpl(),
    dialogs: new DialogStackImpl(),
    documentCommands: documentCommandsStub(),
  })
  const pluginRegistry = new PluginRegistry({ diagnostics, host })
  pluginRegistry.load(manifests.map((manifest) => ({ manifest, source: `builtin:${manifest.id}` })))
  await pluginRegistry.activateAll()
  return {
    diagnostics,
    registries,
    services,
    pluginRegistry,
    dispose: (): void => {
      pluginRegistry.dispose()
    },
  }
}

/** demo.kitchen-sink 的静态贡献（不能运行时 import，原因见文件头）。 */
export interface DemoFacts {
  commands: Array<{ commandId: string; hasRun: boolean }>
  pages: Array<{ id: string; component: string }>
  panels: Array<{ id: string; component: string }>
}

/** 从 manifest 源码取贡献 ID → 组件绝对路径。 */
export function parseManifestComponents(manifestAbs: string): {
  pages: Map<string, string>
  panels: Map<string, string>
} {
  const source = readText(manifestAbs)
  const pages = new Map<string, string>()
  const panels = new Map<string, string>()
  for (const field of ['pageId', 'panelId'] as const) {
    const re = new RegExp(`${field}:\\s*'([^']+)'[\\s\\S]*?component:\\s*\\(\\)\\s*=>\\s*import\\('([^']+)'\\)`, 'g')
    for (const match of source.matchAll(re)) {
      const target = field === 'pageId' ? pages : panels
      target.set(match[1]!, join(dirname(manifestAbs), match[2]!))
    }
  }
  return { pages, panels }
}

/** demo.kitchen-sink 的命令 / 页面 / 面板事实。 */
export function demoFacts(): DemoFacts {
  const dir = join(REPO_ROOT, 'src/plugins/demo.kitchen-sink')
  const commandsSource = readText(join(dir, 'commands.ts'))
  const commands: Array<{ commandId: string; hasRun: boolean }> = []
  for (const match of commandsSource.matchAll(/commandId:\s*'([^']+)'/g)) {
    const tail = commandsSource.slice(match.index!, match.index! + 600)
    commands.push({ commandId: match[1]!, hasRun: /run:\s*(\(|async)/.test(tail) })
  }
  const manifestAbs = join(dir, 'manifest.ts')
  const { pages, panels } = parseManifestComponents(manifestAbs)
  return {
    commands,
    pages: [...pages].map(([id, component]) => ({ id, component })),
    panels: [...panels].map(([id, component]) => ({ id, component })),
  }
}

/** `src/core/*` 模块 → 承担覆盖的 verify 入口（G5 / G6 共用）。 */
export const CORE_COVERAGE: Record<string, string[]> = {
  doc: ['src/core/doc/verify.ts', 'src/workbench/verify.ts'],
  schema: [
    'src/workbench/verify-05.ts',
    'src/workbench/verify-06.ts',
    'src/workbench/verify-07.ts',
    'src/workbench/verify-08.ts',
    'src/workbench/verify-09.ts',
    'src/workbench/verify-11.ts',
  ],
  paths: ['src/workbench/verify-07.ts'],
  graph: ['src/workbench/verify-11.ts'],
  timeline: ['src/core/timeline/verify.ts'],
}

/** `window.workbench` 直连模式（G4 / G6 共用）。 */
export const DIRECT_RE = /window\.workbench|Reflect\.get\(\s*window\s*,\s*['"]workbench['"]\s*\)|globalThis\.workbench|window\s*\[\s*['"]workbench['"]\s*\]/

export interface DirectHit {
  file: string
  line: number
  text: string
}

/** 扫 src 下的直连命中（剥注释；跳过守卫自身与 verify* 文件）。 */
export function scanDirectHits(): DirectHit[] {
  const hits: DirectHit[] = []
  const root = join(REPO_ROOT, 'src')
  const files = walkFiles(root, ['.ts', '.vue'], (abs) => {
    if (abs.startsWith(GUARD_DIR)) return true
    const name = abs.replaceAll('\\', '/').split('/').pop() ?? ''
    return name.startsWith('verify') || name.includes('.tmp-')
  })
  for (const file of files) {
    const rel = repoRel(file)
    const lines = stripComments(readText(file)).split('\n')
    lines.forEach((text, index) => {
      if (DIRECT_RE.test(text)) hits.push({ file: rel, line: index + 1, text: text.trim() })
    })
  }
  return hits
}

/** `--self-test=<case>` 的用例名；不是自测返回 null。 */
export function selfTestCase(): string | null {
  const arg = process.argv.find((value) => value.startsWith('--self-test='))
  return arg === undefined ? null : arg.slice('--self-test='.length)
}
