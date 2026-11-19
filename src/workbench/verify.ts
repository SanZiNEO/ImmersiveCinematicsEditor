/**
 * 04 自检：插件化工作台骨架（04-01 ~ 04-11）。
 *
 * 运行：`node --experimental-strip-types src/workbench/verify.ts`
 * 输出：每条断言一行 `ok   <描述>` / `FAIL <描述>：<实际值>`，最后 `summary ok=<n> fail=<n>`。
 * 任一失败把 `process.exitCode` 置 1。
 *
 * 覆盖：
 * - 插件内核：manifest 校验 / 重复 ID / 依赖缺失与环 / 拓扑顺序 / activate 失败隔离 / 七类贡献提交；
 * - 布局：树校验、比例归一、坏 JSON 回退与备份、原子写（不留 .bak）、服务事务 / 预设 / 历史 / 抽屉 group；
 * - 主题：颜色字面量、对比度、核心 token 继承、导入拒绝、重复 ID、插件主题回滚、变量写入；
 * - 偏好：默认合并、未知键保留、错类型回默认、分项重置、最近项目 20 条 / 去重 / missing、插件段；
 * - 命令 / 快捷键 / 焦点：冲突、IME、输入框白名单、覆盖冲突、enabled 抛错按 disabled、F6 顺序；
 * - 面板宿主：选区五分支映射、抽屉高度夹取、落点计算、手势优先级、预览帧解析；
 * - 03 消费：revision / clipKeys / 保存清脏 / 序列化不被 04 改写；
 * - 外壳边界：源码 grep（无旧尺寸 ref、无 window.prompt、无 localStorage、内核不 import 业务面板）；
 * - 参考插件：`demo.kitchen-sink` 七类贡献清单、`builtin.ts` 唯一清单。
 */
import { readFile, readdir } from 'node:fs/promises'

import type { CatalogIndex } from '../core/schema/index.ts'
import { buildCatalog, indexCatalog } from '../core/schema/index.ts'
import { DocIo } from '../core/doc/io.ts'
import type { DocTransport } from '../core/doc/io.ts'
import { parseDoc } from '../core/doc/parse.ts'
import { serializeDoc } from '../core/doc/serialize.ts'
import { DocStore } from '../core/doc/store.ts'
import { liveClipKeys } from '../core/doc/identity.ts'
import { metaKeys } from '../core/doc/keys.ts'
import type { JsonObject, JsonValue, Selection } from '../core/doc/types.ts'
import { validateStructure } from '../core/doc/structural.ts'

import type { CommandContribution, PanelContribution, PluginManifest } from './api/contributions.ts'
import type { CommandContext, KeybindingRule, MenuState } from './api/commands.ts'
import type { PluginContext } from './api/context.ts'
import type { DiagnosticInput, DiagnosticSink } from './api/diagnostics.ts'
import type { StoragePort } from './api/host.ts'
import type { ServiceRegistry } from './api/services.ts'
import type { ThemeDefinition } from './api/theme.ts'
import type { LayoutFile, LayoutTree } from './api/layout.ts'
import type { PreferencesFile } from './api/preferences.ts'

const WORKBENCH_DIR = new URL('./', import.meta.url)
const REPO_ROOT = new URL('../..', import.meta.url)

let ok = 0
let fail = 0

/** 诊断文本（断言用）。 */
function diagnosticText(sink: { list(): ReadonlyArray<{ message: string; detail?: string }> }): string[] {
  return sink.list().map((item) => `${item.message}${item.detail === undefined ? '' : ` / ${item.detail}`}`)
}

/** 断言。 */
function check(label: string, condition: boolean, actual?: unknown): void {
  if (condition) {
    ok += 1
    console.log(`ok   ${label}`)
    return
  }
  fail += 1
  console.log(`FAIL ${label}：${format(actual)}`)
}

/** 实际值压成一行。 */
function format(value: unknown): string {
  if (value === undefined) {
    return 'undefined'
  }
  if (typeof value === 'string') {
    return value
  }
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`
  }
  try {
    const text = JSON.stringify(value)
    return text === undefined ? String(value) : text.length > 320 ? `${text.slice(0, 320)}…` : text
  } catch {
    return String(value)
  }
}

/** 读取工作台源码（grep 断言用）。 */
async function readWorkbench(relative: string): Promise<string> {
  return readFile(new URL(relative, WORKBENCH_DIR), 'utf8')
}

/** 递归列出目录下的文件（相对路径）。 */
async function listFiles(relative: string, filter: (name: string) => boolean): Promise<string[]> {
  const entries = await readdir(new URL(relative, WORKBENCH_DIR), { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = `${relative}${entry.name}`
    if (entry.isDirectory()) {
      files.push(...await listFiles(`${path}/`, filter))
    } else if (filter(entry.name)) {
      files.push(path)
    }
  }
  return files
}

/** 内存存储（StoragePort 最小实现；用来断言原子写与备份）。 */
class MemoryStorage implements StoragePort {
  readonly files = new Map<string, string>()
  readonly order: string[] = []
  revealed = 0

  async read(name: string): Promise<string | null> {
    return this.files.get(name) ?? null
  }

  async write(name: string, text: string): Promise<void> {
    this.order.push(name)
    this.files.set(name, text)
  }

  async remove(name: string): Promise<void> {
    this.files.delete(name)
  }

  async list(prefix = ''): Promise<string[]> {
    return [...this.files.keys()].filter((name) => name.startsWith(prefix)).sort()
  }

  async listCorrupt(prefix: string): Promise<string[]> {
    return (await this.list(prefix)).filter((name) => name.includes('.corrupt.'))
  }

  async exists(): Promise<boolean> {
    return true
  }

  revealUserData(): void {
    this.revealed += 1
  }
}

/** 内存传输（03 打开/保存/推送测试）。 */
class MemoryTransport implements DocTransport {
  readonly files = new Map<string, JsonObject>()
  pushAck = true
  saved: JsonObject | null = null

  async load(path: string): Promise<{ path: string; doc: JsonValue }> {
    const doc = this.files.get(path)
    if (doc === undefined) {
      throw new Error(`不存在: ${path}`)
    }
    return { path, doc: structuredClone(doc) }
  }

  async save(path: string, doc: JsonObject): Promise<{ path: string }> {
    this.files.set(path, structuredClone(doc))
    this.saved = structuredClone(doc)
    return { path }
  }

  async validate(): Promise<{ ok: boolean; issues: string[] }> {
    return { ok: true, issues: [] }
  }

  async pushScript(): Promise<{ ok: boolean; reason?: string }> {
    return this.pushAck ? { ok: true } : { ok: false, reason: 'push-failed' }
  }

  async newScript(): Promise<{ path: string; doc: JsonValue }> {
    return { path: `untitled-${this.files.size + 1}.json`, doc: { meta: {}, timeline: { tracks: [] } } }
  }

  async seek(): Promise<void> {
    return undefined
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path)
  }
}

/** 最小可用文档夹具。 */
function sampleScript(): JsonObject {
  return {
    meta: { id: 'workbench_doc', name: 'Workbench Doc', author: '' },
    timeline: {
      tracks: [
        {
          type: 'CAMERA',
          clips: [
            { start_time: 0, duration: 2, objects: { 'position.x': { value: 1 } } },
            { start_time: 2, duration: 2, objects: { 'position.x': { value: 2 } } },
          ],
        },
      ],
    },
  }
}

async function main(): Promise<void> {
  const catalog: CatalogIndex = indexCatalog(buildCatalog('verify-workbench'))
  const keys = metaKeys(catalog)

  // ── 0. 验证夹具自检（避免后面断言建立在坏夹具上） ─────────────────────
  {
    const parsed = parseDoc(sampleScript(), { metaKeys: keys })
    check('夹具：示例脚本可解析', parsed.ok, parsed.ok ? '' : parsed.issues)
  }

  // ── 1. 插件内核（04-01） ──────────────────────────────────────────────
  {
    const { planManifests } = await import('./kernel/ManifestGraph.ts')
    const { PanelRegistryImpl, PageRegistryImpl, DrawerTabRegistryImpl, StatusItemRegistryImpl, SettingsRegistryImpl } = await import('./kernel/CollectionRegistries.ts')
    const { PluginRegistry } = await import('./kernel/PluginRegistry.ts')
    const { ServiceRegistryImpl } = await import('./kernel/ServiceRegistryImpl.ts')
    const { DisposableStoreImpl } = await import('./kernel/DisposableStoreImpl.ts')
    const { DiagnosticsStore } = await import('./kernel/DiagnosticsStore.ts')

    const makeManifest = (
      id: string,
      options: { requires?: string[]; apiVersion?: '1' | '2'; activate?: (ctx: PluginContext) => void | Promise<void>; contributes?: PluginManifest['contributes'] } = {},
    ): PluginManifest => ({
      id,
      name: id,
      version: '0.1.0',
      apiVersion: (options.apiVersion ?? '1') as '1',
      ...(options.requires === undefined ? {} : { requires: options.requires }),
      contributes: options.contributes ?? {},
      activate: options.activate ?? (() => undefined),
    })

    const plan = planManifests([
      { manifest: makeManifest('alpha.ok', { requires: ['beta.ok'] }), source: 'a' },
      { manifest: makeManifest('beta.ok'), source: 'b' },
    ])
    check('01 依赖在前：拓扑顺序 beta → alpha', plan.order.map((entry) => entry.manifest.id).join(',') === 'beta.ok,alpha.ok', plan.order.map((entry) => entry.manifest.id))
    check('01 无失败插件', plan.failed.size === 0, [...plan.failed.entries()])

    const duplicate = planManifests([
      { manifest: makeManifest('dup.one'), source: 'manifestA.ts' },
      { manifest: makeManifest('dup.one'), source: 'manifestB.ts' },
    ])
    const duplicateIssue = duplicate.issues.find((issue) => issue.code === 'E_PLUGIN_ID_DUP')
    check('01 重复插件 ID：两处来源都列出', duplicate.failed.get('dup.one') !== undefined
      && duplicateIssue !== undefined
      && duplicateIssue.message.includes('manifestA.ts')
      && duplicateIssue.message.includes('manifestB.ts'), duplicate.failed.get('dup.one'))

    const missing = planManifests([{ manifest: makeManifest('needs.ghost', { requires: ['ghost.pack'] }), source: 's' }])
    check('01 依赖缺失 → 插件失败且原因含依赖链', (missing.failed.get('needs.ghost') ?? '').includes('依赖缺失'), [...missing.failed.entries()])

    const cycle = planManifests([
      { manifest: makeManifest('ring.a', { requires: ['ring.b'] }), source: 'a' },
      { manifest: makeManifest('ring.b', { requires: ['ring.a'] }), source: 'b' },
    ])
    const cycleMessage = [...cycle.failed.values()].join(' | ')
    check('01 依赖环 → 环上插件全部失败', cycle.failed.has('ring.a') && cycle.failed.has('ring.b') && cycleMessage.includes('依赖环'), cycleMessage)

    const badApi = planManifests([{ manifest: makeManifest('api.two', { apiVersion: '2' }), source: 's' }])
    check('01 API 版本不匹配 → 拒绝该插件', badApi.failed.get('api.two')?.includes('apiVersion') === true, badApi.failed.get('api.two'))

    const dupCommand = planManifests([
      {
        manifest: makeManifest('cmd.one', {
          contributes: { commands: [{ commandId: 'demo.ping', titleKey: 'ping', category: 'demo', run: () => undefined }] },
        }),
        source: 'one',
      },
      {
        manifest: makeManifest('cmd.two', {
          contributes: { commands: [{ commandId: 'demo.ping', titleKey: 'ping', category: 'demo', run: () => undefined }] },
        }),
        source: 'two',
      },
    ])
    check('01 命令 ID 全局重复 → 后注册方失败', dupCommand.failed.has('cmd.two') && (dupCommand.failed.get('cmd.two') ?? '').includes('demo.ping'), [...dupCommand.failed.entries()])

    // 真实注册表 + 失败隔离
    const diagnostics = new DiagnosticsStore(() => new Date('2026-01-01T00:00:00.000Z'))
    const services = new ServiceRegistryImpl()
    const panels = new PanelRegistryImpl()
    const pages = new PageRegistryImpl()
    const drawerTabs = new DrawerTabRegistryImpl()
    const statusItems = new StatusItemRegistryImpl()
    const settings = new SettingsRegistryImpl()
    const committed: string[] = []
    const rolledBack: string[] = []
    const panelContribution: PanelContribution = {
      panelId: 'demo.panel',
      titleKey: 'demo',
      component: async () => ({ default: {} }),
      defaultSlot: 'document.left',
      order: 1,
    }
    const host = {
      createContext(manifest: PluginManifest, stage: { panels: PanelContribution[]; commands: CommandContribution[]; disposables?: unknown }): PluginContext {
        const context = {
          pluginId: manifest.id,
          commands: {
            register: (_pluginId: string, contribution: CommandContribution) => {
              stage.commands.push(contribution)
            },
            get: () => undefined,
            list: () => [],
            execute: async () => false,
            isEnabled: () => false,
            isChecked: () => false,
            menuItems: () => [],
            subscribe: () => () => undefined,
            disposePlugin: () => undefined,
          },
          panels: { register: (_p: string, c: PanelContribution) => stage.panels.push(c) },
          pages: { register: () => undefined },
          drawerTabs: { register: () => undefined },
          statusItems: { register: () => undefined },
          settings: { register: () => undefined },
          themes: { disposePlugin: () => undefined },
          services,
          i18n: { locale: () => 'zh_cn', t: (key: string) => key, subscribe: () => () => undefined },
          focus: { focusRegion: () => undefined, focusNext: () => undefined, focusPrev: () => undefined, currentRegion: () => null, remember: () => undefined, restore: () => undefined, subscribe: () => () => undefined },
          dialogs: { isOpen: () => false, open: () => undefined, close: () => undefined, subscribe: () => () => undefined },
          logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
          disposables: new DisposableStoreImpl(),
          contributePanel: (contribution: PanelContribution) => stage.panels.push(contribution),
          contributePage: () => undefined,
          contributeDrawerTab: () => undefined,
          contributeStatusItem: () => undefined,
          contributeSettings: () => undefined,
        }
        return context as unknown as PluginContext
      },
      commitStage(stage: { pluginId: string; panels: PanelContribution[]; commands: CommandContribution[] }): void {
        committed.push(stage.pluginId)
        for (const panel of stage.panels) {
          panels.register(stage.pluginId, panel)
        }
      },
      rollbackPlugin(pluginId: string): void {
        rolledBack.push(pluginId)
        panels.disposePlugin(pluginId)
      },
      disposeContext: () => undefined,
    }
    const registry = new PluginRegistry({ diagnostics, host })
    registry.load([
      {
        manifest: makeManifest('good.plugin', {
          contributes: { panels: [panelContribution] },
          activate: (ctx) => {
            ctx.commands.register('good.plugin', { commandId: 'good.ping', titleKey: 'ping', category: 'demo', run: () => undefined })
          },
        }),
        source: 'good',
      },
      {
        manifest: makeManifest('bad.plugin', {
          activate: () => {
            throw new Error('activate 抛错')
          },
        }),
        source: 'bad',
      },
      {
        manifest: makeManifest('depends.plugin', { requires: ['bad.plugin'] }),
        source: 'dep',
      },
    ])
    await registry.activateAll()
    check('01 activate 成功 → active 且贡献提交一次', registry.isActive('good.plugin') && committed.join(',') === 'good.plugin', registry.states())
    check('01 activate 抛错 → failed 且回滚，不提交贡献', registry.state('bad.plugin')?.status === 'failed' && rolledBack.includes('bad.plugin') && !committed.includes('bad.plugin'), registry.states())
    check('01 依赖失败 → 依赖方 skipped', registry.state('depends.plugin')?.status === 'skipped', registry.states())
    check('01 失败插件记诊断（含错误摘要）', diagnosticText(diagnostics).some((message) => message.includes('activate 抛错')), diagnosticText(diagnostics))
    check('01 硬错误不因单个插件失败中断其他插件', registry.isActive('good.plugin'))
    void pages
    void drawerTabs
    void statusItems
    void settings
  }

  // ── 2. 布局模型与服务（04-02） ────────────────────────────────────────
  {
    const tree = await import('./layout/tree.ts')
    const defaults = await import('./layout/defaultLayouts.ts')
    const validateModule = await import('./layout/validate.ts')
    const { LayoutService } = await import('./layout/LayoutService.ts')
    const { LayoutPersistence, LAYOUT_FILE_NAME, LAYOUT_TEMP_NAME } = await import('./layout/persist.ts')
    const { PanelRegistryImpl } = await import('./kernel/CollectionRegistries.ts')
    const { DiagnosticsStore } = await import('./kernel/DiagnosticsStore.ts')

    const normalized = tree.normalizeSizes([0, 0])
    check('02 比例归一：全 0 → 均分且和为 1', near(normalized[0], 0.5) && near(sum(normalized), 1), normalized)
    const negative = tree.normalizeSizes([-1, 2])
    check('02 比例归一：负数被丢弃后重新分配', sum(negative) === 1 && negative.every((value) => value > 0), negative)

    const defaultsFile = defaults.createDefaultFile()
    check('02 默认文件 version=1 且含三核心页', defaultsFile.version === 1
      && ['project', 'document', 'settings'].every((pageId) => defaultsFile.pages[pageId] !== undefined), Object.keys(defaultsFile.pages))
    const documentTree = defaults.buildDefaultTree('document')
    const refs = tree.collectPanelRefs(documentTree.root)
    check('02 默认 document 树含左/中/右三个核心槽', refs.length >= 3, refs)
    check('02 默认 document 树含抽屉 group', tree.findGroup(documentTree.root, tree.DRAWER_GROUP_ID) !== null, refs)

    const defaultValidated = validateModule.validateLayoutFile(defaultsFile, {
      pageIds: ['project', 'document', 'settings'],
      panels: () => true,
    })
    check('02 合法布局通过校验', defaultValidated.result.ok === true && defaultValidated.result.reverted === false, defaultValidated.result)

    const broken = structuredClone(defaultsFile) as LayoutFile
    const brokenTree = broken.pages.document.presets.default as LayoutTree
    brokenTree.root = {
      type: 'split',
      id: 'split-broken',
      orientation: 'horizontal',
      children: [brokenTree.root],
      sizes: [1],
    }
    const brokenValidated = validateModule.validateLayoutFile(broken, {
      pageIds: ['project', 'document', 'settings'],
      panels: () => true,
    })
    check('02 单子节点 split → 该页修复或回退，其他页保留', brokenValidated.result.messages.length > 0
      && brokenValidated.file.pages.project !== undefined, brokenValidated.result)

    const negativeRatios = structuredClone(defaultsFile) as LayoutFile
    const ratioTree = negativeRatios.pages.document.presets.default as LayoutTree
    if (ratioTree.root.type === 'split') {
      ratioTree.root.sizes = [-1, 0, 0]
    }
    const ratioValidated = validateModule.validateLayoutFile(negativeRatios, {
      pageIds: ['project', 'document', 'settings'],
      panels: () => true,
    })
    const ratioSizes = collectSizes(ratioValidated.file.pages.document.presets.default ?? defaults.buildDefaultTree('document'))
    check('02 负比例/零比例 → 回退或归一（不留负值）', ratioSizes.length > 0 && ratioSizes.every((value) => value > 0), ratioSizes)

    const unknownPanel = structuredClone(defaultsFile) as LayoutFile
    const unknownTree = unknownPanel.pages.document.presets.default as LayoutTree
    const group = tree.findGroup(unknownTree.root, 'group-left') ?? tree.collectGroups(unknownTree.root)[0]
    group.panels.push(tree.createPanelNode({ pluginId: 'ghost.plugin', panelId: 'ghost.panel' }))
    const unknownValidated = validateModule.validateLayoutFile(unknownPanel, {
      pageIds: ['project', 'document', 'settings'],
      panels: (ref) => ref.pluginId !== 'ghost.plugin',
    })
    check('02 未注册插件：保留节点并标 missing', unknownValidated.result.missing.some((ref) => ref.pluginId === 'ghost.plugin'), unknownValidated.result)

    const duplicatePanel = structuredClone(defaultsFile) as LayoutFile
    const duplicateTree = duplicatePanel.pages.document.presets.default as LayoutTree
    const firstGroup = tree.collectGroups(duplicateTree.root)[0]
    if (firstGroup.panels.length > 0) {
      firstGroup.panels.push(tree.clonePanelNode(firstGroup.panels[0]))
    }
    const duplicateValidated = validateModule.validateLayoutFile(duplicatePanel, {
      pageIds: ['project', 'document', 'settings'],
      panels: () => true,
    })
    check('02 同一页重复 panel → 保留第一个并记录 duplicates', duplicateValidated.result.duplicates.length > 0, duplicateValidated.result.duplicates)

    // 服务
    const registry = new PanelRegistryImpl()
    const left: PanelContribution = { panelId: 'clip.effects', titleKey: 'effects', component: async () => ({ default: {} }), defaultSlot: 'document.left', order: 1, minWidth: 420 }
    const right: PanelContribution = { panelId: 'selection.properties', titleKey: 'props', component: async () => ({ default: {} }), defaultSlot: 'document.right', order: 2, minWidth: 280, maxWidth: 560 }
    const bottom: PanelContribution = { panelId: 'timeline.main', titleKey: 'timeline', component: async () => ({ default: {} }), defaultSlot: 'document.bottom', order: 3, minHeight: 160, maxHeight: 560 }
    registry.register('core.workbench', left)
    check('01 面板注册表按 pluginId+panelId 可取回', registry.get('core.workbench', 'clip.effects')?.panelId === 'clip.effects'
      && registry.has({ pluginId: 'core.workbench', panelId: 'clip.effects' }), registry.list().map((entry) => entry.contribution.panelId))
    registry.register('core.workbench', right)
    registry.register('core.workbench', bottom)

    const diagnostics = new DiagnosticsStore()
    const layout = new LayoutService({ panels: registry, diagnostics })
    layout.load(JSON.stringify(defaults.createDefaultFile()))
    const pageTree = layout.getTree('document')
    const effectsGroup = tree.findPanelGroup(pageTree.root, { pluginId: 'core.workbench', panelId: 'clip.effects' })
    const propertiesGroup = tree.findPanelGroup(pageTree.root, { pluginId: 'core.workbench', panelId: 'selection.properties' })
    check('02 服务：默认树含左右面板', effectsGroup !== null && propertiesGroup !== null, collectRefs(pageTree.root))

    if (effectsGroup !== null && propertiesGroup !== null) {
      layout.movePanel('document', { pluginId: 'core.workbench', panelId: 'clip.effects' }, propertiesGroup.id, 0)
      const moved = tree.findPanelGroup(layout.getTree('document').root, { pluginId: 'core.workbench', panelId: 'clip.effects' })
      check('02 movePanel：面板并入目标 group', moved?.id === propertiesGroup.id, moved?.id)
      check('02 movePanel 后可 undo', layout.canUndo('document') === true)
      layout.undo('document')
      const restored = tree.findPanelGroup(layout.getTree('document').root, { pluginId: 'core.workbench', panelId: 'clip.effects' })
      check('02 undo 回到原 group', restored?.id === effectsGroup.id, restored?.id)
    }

    layout.hidePanel('document', { pluginId: 'core.workbench', panelId: 'clip.effects' })
    const hiddenRef = tree.findPanel(layout.getTree('document').root, { pluginId: 'core.workbench', panelId: 'clip.effects' })
    check('02 hidePanel：保留节点、visible=false', hiddenRef !== null && hiddenRef.visible === false, hiddenRef)
    layout.showPanel('document', { pluginId: 'core.workbench', panelId: 'clip.effects' })
    check('02 showPanel：恢复可见', tree.findPanel(layout.getTree('document').root, { pluginId: 'core.workbench', panelId: 'clip.effects' })?.visible === true)

    layout.savePreset('document', 'my-preset')
    check('02 保存用户预设', layout.presets('document').includes('my-preset'), layout.presets('document'))
    layout.applyPreset('document', 'my-preset')
    check('02 应用用户预设', layout.getPage('document').presetId === 'my-preset')
    layout.deletePreset('document', 'my-preset')
    check('02 删除用户预设', !layout.presets('document').includes('my-preset'))
    layout.resetLayout('document')
    check('02 resetLayout 回 default', layout.getPage('document').presetId === 'default')

    const transaction = layout.beginTransaction('document')
    if (propertiesGroup !== null) {
      layout.movePanel('document', { pluginId: 'core.workbench', panelId: 'clip.effects' }, propertiesGroup.id, 0)
    }
    transaction.rollback()
    const afterRollback = tree.findPanelGroup(layout.getTree('document').root, { pluginId: 'core.workbench', panelId: 'clip.effects' })
    check('02 事务 rollback 丢弃临时树', afterRollback?.id === effectsGroup?.id, afterRollback?.id)

    const refsBeforeLoad = collectRefs(layout.getTree('document').root).join(',')
    const serializedOnce = layout.serialize()
    check('02 serialize 幂等（同一状态两次一致）', serializedOnce === layout.serialize())
    layout.load(serializedOnce)
    const refsAfterLoad = collectRefs(layout.getTree('document').root).join(',')
    check('02 load(serialize) 结构等价（面板集合不变）', refsAfterLoad === refsBeforeLoad, { refsBeforeLoad, refsAfterLoad })

    layout.setGroupState('document', tree.DRAWER_GROUP_ID, { visible: true, collapsed: false, lastSize: 320, activeTabId: 'diagnostics' })
    const drawer = layout.getGroup('document', tree.DRAWER_GROUP_ID)
    check('02 抽屉 group：setGroupState 写入 activeTabId/lastSize', drawer?.visible === true && drawer.activeTabId === 'diagnostics' && drawer.lastSize === 320, drawer)
    layout.squeezeAxis('document', tree.DRAWER_GROUP_ID, 160)
    layout.restoreAxis('document')
    check('02 squeezeAxis/restoreAxis 可调用且不破坏比例', sum(collectSizes(layout.getTree('document'))) > 0)

    // 持久化
    const storage = new MemoryStorage()
    const persistence = new LayoutPersistence({ storage, diagnostics: new DiagnosticsStore(() => new Date('2026-01-01T00:00:00.000Z')) })
    await persistence.save(defaultsFile)
    check('02 保存走 tmp → 正式文件', storage.order.includes(LAYOUT_TEMP_NAME) && storage.order.includes(LAYOUT_FILE_NAME), storage.order)
    await persistence.save(defaultsFile)
    check('02 保存不留 .bak（版本历史交给 git）',
      [...storage.files.keys()].every((name) => !name.endsWith('.bak')), [...storage.files.keys()])
    const reloaded = await persistence.load()
    check('02 保存后可读回', reloaded !== null && reloaded.version === 1)

    storage.files.set(LAYOUT_FILE_NAME, '{ 坏 JSON')
    const corrupt = await persistence.load()
    check('02 坏 JSON → 返回 null（回默认）', corrupt === null)
    check('02 坏 JSON 备份为 layout.corrupt.*，原文件不删', storage.order.some((name) => name.includes('.corrupt.')) && storage.files.has(LAYOUT_FILE_NAME), storage.order)

    const huge = 'x'.repeat(1024 * 1024 + 10)
    storage.files.set(LAYOUT_FILE_NAME, huge)
    const oversize = await persistence.load()
    check('02 超过 1 MB → 拒绝并备份', oversize === null && storage.order.filter((name) => name.includes('.corrupt.')).length >= 2)
  }

  // ── 3. 主题（04-07） ─────────────────────────────────────────────────
  {
    const color = await import('./theme/color.ts')
    const validateThemeModule = await import('./theme/validateTheme.ts')
    const inherit = await import('./theme/inherit.ts')
    const builtin = await import('./theme/builtinThemes.ts')
    const { ThemeRegistry } = await import('./theme/ThemeRegistry.ts')
    const { ThemeService } = await import('./theme/ThemeService.ts')
    const { PreferencesStore } = await import('./preferences/PreferencesStore.ts')
    const { DiagnosticsStore } = await import('./kernel/DiagnosticsStore.ts')

    check('07 颜色：接受 #rgb/#rrggbb/rgb()/transparent', ['#abc', '#aabbcc', '#aabbccdd', 'rgb(1,2,3)', 'rgba(1,2,3,0.5)', 'hsl(10, 20%, 30%)', 'transparent']
      .every((value) => color.isColorLiteral(value)), ['#abc', 'rgb()'])
    check('07 颜色：拒绝 var()/url()/表达式/分号', ['var(--x)', 'url(a.png)', 'expression(1)', '#12', 'red;', '@import x']
      .every((value) => !color.isColorLiteral(value)))
    const blackWhite = color.contrastRatio('#000000', '#ffffff')
    check('07 对比度：黑白 ≈ 21', blackWhite !== null && Math.abs(blackWhite - 21) < 0.2, blackWhite)

    const builtinResults = builtin.BUILTIN_THEMES.map((theme) => validateThemeModule.validateTheme(theme))
    check('07 三套内置主题全部通过校验', builtinResults.every((result) => result.ok), builtinResults.map((result) => result.issues))

    const badTheme = {
      version: 1,
      id: 'workbench.bad',
      label: 'Bad',
      appearance: 'dark',
      tokens: { 'bg-app': 'var(--bg-panel)' },
    }
    const badResult = validateThemeModule.validateTheme(badTheme)
    check('07 非法颜色（var()）→ 主题无效', badResult.ok === false, badResult.issues)

    const lowContrast = {
      ...builtin.BUILTIN_THEMES[2],
      id: 'workbench.low-contrast',
      tokens: { ...builtin.BUILTIN_THEMES[2].tokens, text: '#7a7a7a', 'bg-panel': '#808080' },
    }
    const lowResult = validateThemeModule.validateTheme(lowContrast)
    check('07 高对比主题对比度不达标 → 拒绝', lowResult.ok === false, lowResult.issues)

    const partial: ThemeDefinition = {
      version: 1,
      id: 'plugin.partial',
      label: 'Partial',
      appearance: 'dark',
      tokens: { accent: '#ff8800' },
    }
    const resolved = inherit.resolveTokens(partial, builtin.BUILTIN_THEMES[0])
    check('07 缺失核心 token → 从同 appearance 基础主题继承', resolved['bg-panel'] === builtin.BUILTIN_THEMES[0].tokens['bg-panel'] && resolved.accent === '#ff8800', resolved['bg-panel'])
    check('07 继承层数只有一层（不跨 appearance）', inherit.missingCoreTokens({ accent: '#fff' }).length > 0)

    const diagnostics = new DiagnosticsStore()
    const registry = new ThemeRegistry({ diagnostics })
    check('07 内置主题已注册', registry.list().filter((theme) => theme.source === 'builtin').length === 3, registry.list().map((theme) => `${theme.id}:${theme.source}`))

    let duplicateThrew = false
    try {
      registry.registerBuiltin(builtin.BUILTIN_THEMES[0])
    } catch {
      duplicateThrew = true
    }
    check('07 重复主题 ID → 抛错', duplicateThrew)

    let prefixRejected = false
    try {
      registry.importUserTheme({ version: 1, id: 'not-user.theme', label: 'x', appearance: 'dark', tokens: { ...builtin.BUILTIN_THEMES[0].tokens } })
    } catch {
      prefixRejected = true
    }
    check('07 用户导入：非 user. 前缀拒绝', prefixRejected)

    let oversizeRejected = false
    try {
      const hugeTokens: Record<string, string> = {}
      for (let index = 0; index < 4000; index += 1) {
        hugeTokens[`pad-${index}`] = 'x'.repeat(80)
      }
      registry.importUserTheme({ version: 1, id: 'user.huge', label: 'Huge', appearance: 'dark', tokens: { ...builtin.BUILTIN_THEMES[0].tokens }, extra: hugeTokens })
    } catch {
      oversizeRejected = true
    }
    check('07 用户导入：超 256 KB 拒绝', oversizeRejected)

    const imported = registry.importUserTheme({ version: 1, id: 'user.mine', label: 'Mine', appearance: 'dark', tokens: { ...builtin.BUILTIN_THEMES[0].tokens } })
    check('07 用户导入：合法主题进入列表', registry.get(imported.id) !== undefined && registry.list().some((theme) => theme.id === 'user.mine' && theme.source === 'user'))
    registry.removeUserTheme('user.mine')
    check('07 用户主题可删除', registry.get('user.mine') === undefined)

    const pluginTheme: ThemeDefinition = { version: 1, id: 'demo.theme.sepia', label: 'Sepia', appearance: 'light', tokens: { ...builtin.BUILTIN_THEMES[1].tokens } }
    registry.registerContribution('demo.kitchen-sink', pluginTheme)
    check('07 插件主题可注册', registry.get('demo.theme.sepia')?.id === 'demo.theme.sepia')
    registry.disposePlugin('demo.kitchen-sink')
    check('07 插件卸载 → 其主题移除', registry.get('demo.theme.sepia') === undefined)

    // ThemeService 变量写入（假 document）
    const storage = new MemoryStorage()
    const preferences = new PreferencesStore({ storage, diagnostics, debounceMs: 0 })
    await preferences.load()
    const writes = new Map<string, string>()
    const attributes = new Map<string, string>()
    const fakeDocument = {
      documentElement: {
        style: {
          setProperty: (name: string, value: string) => writes.set(name, value),
          removeProperty: (name: string) => writes.delete(name),
        },
        setAttribute: (name: string, value: string) => attributes.set(name, value),
      },
    }
    const themeService = new ThemeService({
      registry,
      host: {
        setSource: () => undefined,
        setWindowBackground: () => undefined,
        onSystemChange: () => () => undefined,
        initialTheme: () => null,
      },
      preferences,
      diagnostics,
    })
    themeService.apply('workbench.dark-default')
    themeService.applyToDocument(fakeDocument)
    check('07 应用主题 → 写核心 token 变量', writes.has('--bg-app') && writes.has('--bg-panel') && writes.has('--selection-outline'), [...writes.keys()].slice(0, 6))
    check('07 应用主题 → 设置 data-theme-id / appearance', attributes.get('data-theme-id') === 'workbench.dark-default' && attributes.get('data-theme-appearance') === 'dark', [...attributes.entries()])
    check('07 themeCache 写入偏好', preferences.get().theme.themeCache?.themeId === 'workbench.dark-default', preferences.get().theme.themeCache)

    const overridesBefore = Object.keys(preferences.get().theme.overrides).length
    themeService.setOverride('accent', '#ff00aa')
    themeService.applyToDocument(fakeDocument)
    check('07 token 覆盖只允许核心 token', preferences.get().theme.overrides.accent === '#ff00aa' && Object.keys(preferences.get().theme.overrides).length === overridesBefore + 1, preferences.get().theme.overrides)
    themeService.setOverride('font.mono', '#123456')
    check('07 非核心 token 覆盖被拒绝', preferences.get().theme.overrides['font.mono'] === undefined)
    themeService.resetOverrides()
    check('07 覆盖可重置', Object.keys(preferences.get().theme.overrides).length === 0)
    themeService.dispose()

  }

  // ── 4. 偏好（04-08） ─────────────────────────────────────────────────
  {
    const defaultsModule = await import('./preferences/defaults.ts')
    const recent = await import('./preferences/recentProjects.ts')
    const { PreferencesStore } = await import('./preferences/PreferencesStore.ts')
    const { DiagnosticsStore } = await import('./kernel/DiagnosticsStore.ts')

    const normalizedDefault = defaultsModule.normalizePreferences({ version: 1 })
    check('08 最小合法文件 → 默认偏好且无 issue', normalizedDefault.preferences.language === 'zh_cn' && normalizedDefault.issues.length === 0, normalizedDefault.issues)
    const noVersion = defaultsModule.normalizePreferences({})
    check('08 缺 version → 回默认并标记需要备份', noVersion.needsBackup === true && noVersion.issues.length > 0, noVersion.issues)

    const versionTwo = defaultsModule.normalizePreferences({ version: 2, language: 'en_us' })
    check('08 未知 version → needsBackup（调用方备份）', versionTwo.needsBackup === true)

    const unknownKey = defaultsModule.normalizePreferences({ version: 1, x_future: { a: 1 } })
    check('08 未知顶层键保留（不丢整份偏好）', (unknownKey.extras as Record<string, unknown>).x_future !== undefined, unknownKey.extras)

    const wrongType = defaultsModule.normalizePreferences({ version: 1, language: 'fr_fr', density: 7, shortcuts: 'nope' })
    check('08 错类型回默认并记 issue', wrongType.preferences.language === 'zh_cn'
      && wrongType.preferences.density === 'comfortable'
      && wrongType.preferences.shortcuts.length === 0
      && wrongType.issues.length >= 2, wrongType.issues)

    const pluginsPreserved = defaultsModule.normalizePreferences({ version: 1, plugins: { 'demo.kitchen-sink': { enabled: true, bad: { nested: 1 } } } })
    const demoValues = pluginsPreserved.preferences.plugins?.['demo.kitchen-sink'] ?? {}
    check('08 插件段保留合法标量、丢弃非法值', demoValues.enabled === true && !('bad' in demoValues), demoValues)

    const many = Array.from({ length: 25 }, (_, index) => ({
      path: `C:/scripts/s${index}.json`,
      name: `s${index}`,
      kind: 'script' as const,
      lastOpenedAt: new Date(2026, 0, 1, 0, index).toISOString(),
    }))
    const trimmed = defaultsModule.normalizePreferences({ version: 1, recentProjects: many })
    check('08 最近项目最多 20 条且按时间倒序', trimmed.preferences.recentProjects.length === 20
      && trimmed.preferences.recentProjects[0].name === 's24', trimmed.preferences.recentProjects[0])

    const deduped = recent.addRecent(
      [{ path: 'C:/a.json', name: 'a', kind: 'script', lastOpenedAt: '2026-01-01T00:00:00.000Z' }],
      { path: 'C:/a.json', name: 'a2', kind: 'script', lastOpenedAt: '2026-02-01T00:00:00.000Z' },
    )
    check('08 同路径只保留一条（更新且置顶）', deduped.length === 1 && deduped[0].name === 'a2', deduped)

    const withMissing = recent.markMissing(
      [{ path: 'C:/missing.json', name: 'm', kind: 'script', lastOpenedAt: '2026-01-01T00:00:00.000Z' }],
      () => false,
    )
    check('08 探测存在性 → missing 标记', withMissing[0]?.missing === true, withMissing)

    const storage = new MemoryStorage()
    const diagnostics = new DiagnosticsStore(() => new Date('2026-01-01T00:00:00.000Z'))
    const store = new PreferencesStore({ storage, diagnostics, debounceMs: 0 })
    const loadResult = await store.load()
    check('08 空文件 → 默认且无 issue', loadResult.issues.length === 0 && store.get().version === 1, loadResult.issues)

    store.setSection('language', 'en_us')
    store.setPluginValue('demo.kitchen-sink', 'toggle', true)
    await store.flushNow()
    check('08 写盘后可读回语言', (await new MemoryStorageLoad(storage)).language() === 'en_us')
    check('08 插件段读写隔离', store.pluginValues('demo.kitchen-sink').toggle === true
      && store.pluginValues('other.plugin').toggle === undefined, store.pluginValues('demo.kitchen-sink'))

    store.resetPluginValues('demo.kitchen-sink')
    check('08 插件段可单项清空', Object.keys(store.pluginValues('demo.kitchen-sink')).length === 0)
    store.resetSection('language')
    check('08 分项重置：语言回默认', store.get().language === 'zh_cn')

    storage.files.set('preferences.json', '{ 坏 JSON')
    const broken = new PreferencesStore({ storage, diagnostics, debounceMs: 0 })
    const brokenResult = await broken.load()
    check('08 坏 JSON → 备份 + 默认', brokenResult.issues.length > 0
      && broken.get().version === 1
      && storage.order.some((name) => name.includes('preferences.corrupt.')), brokenResult.issues)
  }

  // ── 5. 命令 / 快捷键 / 焦点（04-10） ─────────────────────────────────
  {
    const { CommandRegistryImpl } = await import('./commands/CommandRegistryImpl.ts')
    const paletteModel = await import('./commands/CommandPaletteModel.ts')
    const chord = await import('./keybindings/chord.ts')
    const guards = await import('./keybindings/guards.ts')
    const { KeybindingRegistryImpl } = await import('./keybindings/KeybindingRegistryImpl.ts')
    const { FocusServiceImpl } = await import('./focus/FocusServiceImpl.ts')
    const { DiagnosticsStore } = await import('./kernel/DiagnosticsStore.ts')
    const { ServiceRegistryImpl } = await import('./kernel/ServiceRegistryImpl.ts')

    const diagnostics = new DiagnosticsStore()
    const services: ServiceRegistry = new ServiceRegistryImpl()
    const registry = new CommandRegistryImpl({ diagnostics })
    const context: CommandContext = { pageId: 'document', services }

    registry.register('core.workbench', { commandId: 'file.saveDoc', titleKey: 'doc.save', category: '文件', keybinding: 'Mod+S', run: () => undefined })
    let duplicateCommandThrew = false
    try {
      registry.register('other.plugin', { commandId: 'file.saveDoc', titleKey: 'x', category: '文件', run: () => undefined })
    } catch {
      duplicateCommandThrew = true
    }
    check('10 命令 ID 重复 → 抛错', duplicateCommandThrew)

    registry.register('core.workbench', {
      commandId: 'broken.enabled',
      titleKey: 'broken',
      category: '测试',
      enabled: () => {
        throw new Error('enabled 抛错')
      },
      run: () => undefined,
    })
    check('10 enabled 抛错按 disabled 处理', registry.isEnabled(context, 'broken.enabled') === false)
    let brokenRan = false
    registry.register('core.workbench', {
      commandId: 'broken.run',
      titleKey: 'broken run',
      category: '测试',
      run: () => {
        brokenRan = true
        throw new Error('run 抛错')
      },
    })
    const brokenResult = await registry.execute(context, 'broken.run')
    check('10 run 抛错 → 返回 false 并记诊断', brokenRan && brokenResult === false
      && diagnosticText(diagnostics).some((message) => message.includes('run 抛错')), diagnosticText(diagnostics))

    registry.register('core.workbench', { commandId: 'menu.only', titleKey: '菜单项', category: '视图', menu: { menu: 'view', order: 10 }, run: () => undefined })
    const menuItems: MenuState[] = registry.menuItems(context)
    check('10 菜单只列带 menu 的命令', menuItems.some((item) => item.commandId === 'menu.only') && !menuItems.some((item) => item.commandId === 'file.saveDoc'), menuItems.map((item) => item.commandId))

    const paletteItems: MenuState[] = registry.menuItems(context).filter((item) => item.enabled)
    check('10 菜单项非空（命令面板数据源）', paletteItems.length > 0, registry.menuItems(context))
    check('10 命令面板搜索：标题/分类/ID 匹配', paletteModel.filterCommands(paletteItems, '菜单').length === 1
      && paletteModel.filterCommands(paletteItems, '视图').length >= 1
      && paletteModel.filterCommands(paletteItems, '不存在').length === 0, {
      byTitle: paletteModel.filterCommands(paletteItems, '菜单').length,
      byCategory: paletteModel.filterCommands(paletteItems, '视图').length,
      byMissing: paletteModel.filterCommands(paletteItems, '不存在').length,
    })
    check('10 命令面板空查询返回全部', paletteModel.filterCommands(paletteItems, '').length === paletteItems.length)
    const paletteGroups = paletteModel.groupByCategory(paletteItems)
    check('10 命令面板按分类分组', paletteGroups.length > 0 && paletteGroups.every((group) => group.category.length > 0), paletteGroups)

    const mod = chord.parseChord('Mod+Shift+P')
    check('10 chord 解析 Mod+Shift+P', mod !== null && mod.mod === true && mod.shift === true && mod.key === 'p', mod)
    check('10 chord 归一：大小写/顺序无关', chord.normalizeChord('shift+mod+p') === chord.normalizeChord('Mod+Shift+P'))
    const event = { key: 'P', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false }
    check('10 chord 匹配事件', mod !== null && chord.matchChord(event, mod))
    check('10 chord 拒绝非法输入', chord.parseChord('Mod+') === null && chord.parseChord('') === null)

    check('10 IME：composing=true → 守卫命中', guards.isImeComposing({ key: 'Process', isComposing: true }) === true)
    check('10 IME：keyCode 229 → 守卫命中', guards.isImeComposing({ key: 'Process', keyCode: 229 }) === true)
    check('10 输入框白名单含 Mod+S / Esc', guards.KEY_WHITELIST_IN_EDITABLE.includes('Mod+S') && guards.KEY_WHITELIST_IN_EDITABLE.includes('Esc'))
    check('10 输入框判定：input/textarea/contenteditable', guards.isEditableElement({ tagName: 'INPUT' })
      && guards.isEditableElement({ tagName: 'TEXTAREA' })
      && guards.isEditableElement({ tagName: 'DIV', isContentEditable: true })
      && !guards.isEditableElement({ tagName: 'DIV' }))

    const keybindings = new KeybindingRegistryImpl({ diagnostics, platform: 'win32' })
    keybindings.register({ chord: 'Mod+S', commandId: 'file.saveDoc', scope: 'global' })
    let conflictThrew = false
    let conflictMessage = ''
    try {
      keybindings.register({ chord: 'Mod+S', commandId: 'file.saveAlt', scope: 'global' })
    } catch (error) {
      conflictThrew = true
      conflictMessage = error instanceof Error ? error.message : String(error)
    }
    check('10 同 scope 同 chord → 抛错并指出两个 commandId', conflictThrew
      && conflictMessage.includes('file.saveDoc')
      && conflictMessage.includes('file.saveAlt'), conflictMessage)

    let crossScopeThrew = false
    try {
      keybindings.register({ chord: 'Mod+S', commandId: 'panel.save', scope: 'panel' })
    } catch {
      crossScopeThrew = true
    }
    check('10 不同 scope 同 chord 不冲突', !crossScopeThrew)

    keybindings.register({ chord: 'Mod+Shift+P', commandId: 'app.commandPalette', scope: 'global' })
    keybindings.setOverride('file.saveDoc', 'F2')
    check('10 用户覆盖生效（chordOf 优先覆盖）', (keybindings.chordOf('file.saveDoc') ?? '').toLowerCase() === 'f2', keybindings.chordOf('file.saveDoc'))
    let overrideConflict = false
    try {
      keybindings.setOverride('app.commandPalette', 'F2')
    } catch {
      overrideConflict = true
    }
    check('10 覆盖冲突 → 拒绝保存', overrideConflict)
    keybindings.clearOverrides()

    const baseContext = { pageId: 'document', region: null, editable: false, composing: false, dialogOpen: false }
    const saveRule = keybindings.resolve({ key: 's', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false }, baseContext)
    check('10 resolve：命中 global 命令', saveRule?.commandId === 'file.saveDoc', saveRule)
    const imeRule = keybindings.resolve({ key: 'p', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, isComposing: true }, baseContext)
    check('10 resolve：IME 组合中不触发', imeRule === undefined, imeRule)
    const editableRule = keybindings.resolve({ key: 'p', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false }, { ...baseContext, editable: true })
    check('10 resolve：输入框内只允许白名单（Mod+Shift+P 不触发）', editableRule === undefined, editableRule)
    const editableSave = keybindings.resolve({ key: 's', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false }, { ...baseContext, editable: true })
    check('10 resolve：输入框内 Mod+S 仍保存', editableSave?.commandId === 'file.saveDoc', editableSave)

    const removed: string[] = []
    const focus = new FocusServiceImpl({ onFocus: (regionId) => removed.push(regionId) })
    focus.registerRegion({ id: 'topbar', order: 1, element: () => ({} as HTMLElement) })
    focus.registerRegion({ id: 'hidden-panel', order: 2, element: () => null })
    focus.registerRegion({ id: 'docs', order: 3, element: () => ({} as HTMLElement) })
    focus.focusNext()
    focus.focusNext()
    focus.focusNext()
    const order = removed.join(',')
    check('10 F6 跳过不可用区域并循环', order === 'topbar,docs,topbar' || order === 'docs,topbar,docs', order)
    focus.focusRegion('docs')
    focus.remember('docs')
    focus.focusRegion('topbar')
    focus.restore('docs')
    check('10 remember/restore 焦点区域', focus.currentRegion() === 'docs', focus.currentRegion())
  }

  // ── 6. 面板宿主选区五分支 + 抽屉 + 停靠 + 预览帧 ──────────────────────
  {
    const selectionState = await import('./host/selectionState.ts')
    const drawerLayout = await import('./drawer/drawerLayout.ts')
    const resize = await import('./dock/resize.ts')
    const dropTarget = await import('./dock/DropTarget.ts')
    const inputAdapter = await import('./dock/DockInputAdapter.ts')
    const preview = await import('./api/preview.ts')

    const none = selectionState.resolveClipSelectionState({
      selection: { domain: 'none' },
      clipKeys: [],
      invalid: null,
      clipExists: () => false,
    })
    check('05 选区：none', none.kind === 'none', none)

    const clip: Selection = { domain: 'clip', clipKey: 'c1' }
    const clipState = selectionState.resolveClipSelectionState({ selection: clip, clipKeys: ['c1'], invalid: null, clipExists: (key) => key === 'c1' })
    check('05 选区：clip（唯一有效）', clipState.kind === 'clip' && clipState.clipKey === 'c1', clipState)

    const multi = selectionState.resolveClipSelectionState({ selection: clip, clipKeys: ['c1', 'c2'], invalid: null, clipExists: () => true })
    check('05 选区：multi（批选不取第一个）', multi.kind === 'multi' && multi.clipKeys.length === 2, multi)

    const invalid = selectionState.resolveClipSelectionState({
      selection: { domain: 'none' },
      clipKeys: [],
      invalid: { reason: '片段被删除', previous: clip },
      clipExists: () => false,
    })
    check('05 选区：invalid（带原因）', invalid.kind === 'invalid' && invalid.reason.includes('片段被删除'), invalid)

    const foreign = selectionState.resolveClipSelectionState({ selection: { domain: 'path', pathId: 'p1' }, clipKeys: [], invalid: null, clipExists: () => false })
    check('05 选区：path/rule/binding → foreign（不属于片段控件）', foreign.kind === 'foreign' && foreign.domain === 'path', foreign)

    const tall = drawerLayout.clampDrawerHeight(280, 900)
    check('06 抽屉高度：常态 280 无提示', tall.height === 280 && tall.notice === null, tall)
    const low = drawerLayout.clampDrawerHeight(400, 700)
    check('06 抽屉高度：700 高 → 夹取 + 主轴 160 + 提示', low.height <= 420 && low.axisHeight === 160 && low.notice !== null, low)
    const tight = drawerLayout.clampDrawerHeight(400, 560)
    check('06 抽屉高度：560 高 → 上限 200、主轴 120', tight.height <= 200 && tight.axisHeight === 120, tight)
    check('06 低窗判定', drawerLayout.isLowWindow(700) && !drawerLayout.isLowWindow(900))
    const toggled = drawerLayout.drawerTabToggle({ activeTabId: 'demo.drawer.notes', visible: true, collapsed: false }, 'demo.drawer.notes')
    check('06 再点当前 tab → 折叠整个抽屉', toggled === 'collapse', toggled)
    const openedTab = drawerLayout.drawerTabToggle({ activeTabId: 'demo.drawer.notes', visible: false, collapsed: true }, 'demo.drawer.notes')
    check('06 关闭状态下点 tab → 打开', openedTab === 'open', openedTab)

    const sizes = resize.resizeRatio([0.5, 0.5], 0, 0.1, [200, 200], 1000)
    check('08 分隔线拖动：和为 1 且遵守像素下限', near(sum(sizes), 1) && sizes.every((value) => value > 0), sizes)
    const keyboard = resize.keyboardResize([0.5, 0.5], 0, 'right', false, 1000)
    check('03 键盘缩放：右移增大第一项', keyboard[0] > 0.5 && near(sum(keyboard), 1), keyboard)

    const rects = [
      { groupId: 'g-left', kind: 'group' as const, x: 0, y: 0, width: 400, height: 600 },
      { groupId: 'g-right', kind: 'group' as const, x: 400, y: 0, width: 400, height: 600 },
    ]
    const center = dropTarget.computeDropTarget({ pointer: { x: 200, y: 300 }, rects, tabBars: [], source: { pluginId: 'p', panelId: 'x' }, viewport: { width: 800, height: 600 } })
    check('03 落点：group 中心 → merge', center.kind === 'merge' && center.groupId === 'g-left', center)
    const edge = dropTarget.computeDropTarget({ pointer: { x: 10, y: 300 }, rects, tabBars: [], source: { pluginId: 'p', panelId: 'x' }, viewport: { width: 800, height: 600 } })
    check('03 落点：左边缘 25% → 水平拆分', edge.kind === 'split' && edge.orientation === 'horizontal' && edge.side === 'left', edge)
    const outside = dropTarget.computeDropTarget({ pointer: { x: 5000, y: 5000 }, rects, tabBars: [], source: { pluginId: 'p', panelId: 'x' }, viewport: { width: 800, height: 600 } })
    check('03 落点：视口外 → none', outside.kind === 'none', outside)
    const tabbar = dropTarget.computeDropTarget({
      pointer: { x: 120, y: 6 },
      rects,
      tabBars: [{ groupId: 'g-left', kind: 'tabbar', x: 0, y: 0, width: 400, height: 24 }],
      source: { pluginId: 'p', panelId: 'x' },
      viewport: { width: 800, height: 600 },
    })
    check('03 落点：标签条 → reorder', tabbar.kind === 'reorder' && tabbar.groupId === 'g-left', tabbar)

    check('03 手势优先级：输入框高于面板标题', inputAdapter.hitTestDragSource({ tagName: 'INPUT', isPanelTitle: true }) === 'input')
    check('03 手势优先级：滚动条高于面板标题', inputAdapter.hitTestDragSource({ isScrollbar: true, isPanelTitle: true }) === 'scrollbar')
    check('03 手势优先级：面板标题 → panel', inputAdapter.hitTestDragSource({ isPanelTitle: true }) === 'panel')
    check('03 手势优先级：普通区域 → none', inputAdapter.hitTestDragSource({ tagName: 'DIV' }) === 'none')

    const rgba = new Uint8Array(preview.PREVIEW_HEADER_BYTES + 4)
    rgba[0] = preview.PREVIEW_TYPE_RGBA
    rgba[1] = preview.PREVIEW_FLAG_KEYFRAME
    const view = new DataView(rgba.buffer)
    view.setUint32(2, 42, false)
    view.setUint32(6, 0, false)
    view.setUint32(10, 500_000, false)
    view.setUint16(14, 1, false)
    view.setUint16(16, 1, false)
    const frame = preview.parsePreviewFrame(rgba)
    check('09 预览帧：18 字节帧头解析（RGBA）', frame !== null
      && frame.frameId === 42
      && frame.width === 1
      && frame.height === 1
      && frame.keyframe === true
      && frame.ptsMicros === 500_000, frame)
    check('09 预览帧：帧头不足 → null', preview.parsePreviewFrame(new Uint8Array(10)) === null)
    const unknownType = new Uint8Array(preview.PREVIEW_HEADER_BYTES + 4)
    unknownType[0] = 9
    check('09 预览帧：未知类型 → null', preview.parsePreviewFrame(unknownType) === null)
  }

  // ── 7. 03 消费面（04-05 / 04-10 依赖的 store 行为） ────────────────────
  {
    const store = new DocStore({ catalog, metaKeys: keys })
    const parsed = parseDoc(sampleScript(), { metaKeys: keys })
    if (!parsed.ok) {
      throw new Error('03 消费面夹具无法解析')
    }
    const revisionBefore = store.revision
    store.open(parsed.doc, 'sample.json')
    check('03 open 后 revision 递增', store.revision === revisionBefore + 1, store.revision)
    check('03 open 清空 clipKeys', store.session.clipKeys.length === 0)

    const opened = store.doc
    if (opened === null) {
      throw new Error('open 后没有文档')
    }
    const live = liveClipKeys(opened, store.registry)
    check('03 文档有两个存活片段', live.length === 2, live)
    store.selectMany(live)
    check('03 selectMany 维护 clipKeys（多选）', store.session.clipKeys.length === 2, store.session.clipKeys)

    const beforeCommit = store.revision
    const committed = store.commit({ kind: 'object.setValue', clipKey: live[0], path: 'position.x', value: 9 })
    check('03 commit 成功且 revision 递增', committed.ok && store.revision === beforeCommit + 1, committed)
    const afterCommit = store.revision
    store.undo()
    check('03 undo 后 revision 递增', store.revision === afterCommit + 1)
    store.redo()
    check('03 redo 后 revision 递增', store.revision === afterCommit + 2)

    store.select({ domain: 'clip', clipKey: live[0] })
    const invalidated = store.commit({ kind: 'clip.remove', clipKey: live[0] })
    check('03 删除被选片段 → 选择退回并记录失效', invalidated.ok
      && store.session.selection.domain === 'none'
      && store.session.selectionInvalid !== null, {
      selection: store.session.selection,
      invalid: store.session.selectionInvalid,
    })

    // DocIo：保存成功清脏 / 失败保留
    const transport = new MemoryTransport()
    transport.files.set('sample.json', sampleScript())
    const ioStore = new DocStore({ catalog, metaKeys: keys })
    const io = new DocIo({ transport, catalog, metaKeys: keys, store: ioStore, debounceMs: 1 })
    const ioOpened = await io.open('sample.json')
    check('03 DocIo 打开成功', ioOpened.ok, ioOpened.error)
    ioStore.markDirty()
    const saved = await io.save()
    check('03 保存成功清脏', saved.ok && ioStore.dirty === false, saved)
    ioStore.markDirty()
    transport.pushAck = false
    const pushed = await io.push()
    check('03 推送失败标预览过期（不伪造成功）', !pushed.ok && ioStore.derived.previewStale, pushed)
    io.dispose()

    const serialized = serializeDoc(parsed.doc)
    check('03 序列化仍由 03 负责（含 meta/timeline 键）', serialized.meta !== undefined && serialized.timeline !== undefined)
    const structuralIssues = validateStructure(parsed.doc, { catalog, metaKeys: keys, registry: store.registry })
    check('03 结构检查可被 04 调用（无 block）', structuralIssues.every((issue) => issue.severity !== 'block'), structuralIssues)
  }

  // ── 8. 外壳边界（04-04 / 04-11 grep） ────────────────────────────────
  {
    const shellSources = await Promise.all([
      readWorkbench('shell/WorkspaceShell.vue'),
      readWorkbench('shell/AppTopBar.vue'),
      readWorkbench('shell/AppStatusBar.vue'),
      readWorkbench('shell/PageHost.vue'),
      readWorkbench('shell/DocumentPage.vue'),
      readWorkbench('shell/DocumentHeader.vue'),
      readWorkbench('shell/ProjectPage.vue'),
      readWorkbench('shell/SettingsPage.vue'),
    ])
    const joined = shellSources.join('\n')
    check('04 外壳无旧尺寸 ref', !/jsonColWidth|leftPanelWidth|rightPanelWidth|timelineHeight/.test(joined))
    check('04 外壳无 window.prompt 重命名', !/window\.prompt/.test(joined))
    check('04 外壳无 localStorage 直写', !/localStorage/.test(joined))
    check('04 外壳无常驻校验横幅', !/validation-banner/.test(joined))
    check('04 外壳不 import 业务面板', !/plugins\/.*panels/.test(joined))

    const kernelSources = await Promise.all((await listFiles('kernel/', (name) => name.endsWith('.ts'))).map((file) => readWorkbench(file)))
    const kernelJoined = kernelSources.join('\n')
    check('01 内核不 import 业务面板', !/from '[^']*plugins\/[^']*(panels|pages|drawers)/.test(kernelJoined) && !/\.vue/.test(kernelJoined), kernelJoined.slice(0, 200))
    check('01 内核不出现业务 switch（panelId === 常量）', !/panelId\s*===\s*'/.test(kernelJoined))

    const workbenchTs = (await listFiles('', (name) => name.endsWith('.ts') || name.endsWith('.vue')))
      .filter((file) => file !== 'verify.ts' && !file.startsWith('verify-') && file !== 'emit-fixtures-12.ts')
    const sources = await Promise.all(workbenchTs.map((file) => readWorkbench(file)))
    const allJoined = sources.join('\n')
    check('09 渲染层不暴露 ipcRenderer', !/ipcRenderer/.test(allJoined))
    check('09 渲染层不直接用 node fs/path', !/from 'node:fs|require\('fs'\)|require\('path'\)/.test(allJoined))
    check('07 十六进制色只出现在主题 token 与预览色块', !/#[0-9a-fA-F]{6}\b/.test(await readWorkbench('shell/WorkspaceShell.vue')))

    const pluginSources = await Promise.all((await listFiles('../plugins/', (name) => name.endsWith('.ts'))).map(async (file) => readFile(new URL(file, WORKBENCH_DIR), 'utf8')))
    const pluginJoined = pluginSources.join('\n')
    check(
      '01 插件不 import 文档 store / 宿主实现（只走 api、core 纯函数与 panelContext）',
      !/from '\.\.\/\.\.\/workbench\/(app|kernel|layout|dock|drawer|theme|preferences|commands|keybindings|focus|shell)\//.test(pluginJoined)
        && !/core\/doc\/(store|io|validate)\.ts/.test(pluginJoined),
      pluginJoined.match(/from '[^']+'/g)?.filter((line) => line.includes('workbench/app') || line.includes('doc/store')).slice(0, 5),
    )
  }

  // ── 9. 参考插件与 builtin 清单（04-11） ──────────────────────────────
  {
    // builtin.ts 静态 import 全部真实插件与 demo；Node strip-only 不支持 JSON import，
    // 所以这里读源码断言「唯一清单」：只有 manifest import + 一个数组。
    const builtinSource = await readWorkbench('../plugins/builtin.ts')
    const valueImports = builtinSource.split('\n').filter((line) => line.startsWith('import ') && !line.startsWith('import type '))
    const expectedManifests = [
      './core.workbench/manifest',
      './core.script-graph/manifest',
      './core.timeline/manifest',
      './core.clip-effects/manifest',
      './core.selection-properties/manifest',
      './core.behavior/manifest',
      './core.meta/manifest',
      './core.paths/manifest',
      './core.transition-panel/manifest',
      './core.camera-inspect/manifest',
      './demo.extra/manifest',
      './demo.kitchen-sink/manifest',
    ]
    // 插件数量随轮次增长（08 新增两个、07 新增 core.paths），这里只断言「清单仍由 builtin.ts 单一维护」：
    // 每个 value import 都指向 manifest，且已知插件全部在册、core 在前 demo 在后。
    check('11 builtin.ts 是唯一静态清单（每个 import 都指向 manifest，已知插件全部在册）',
      valueImports.every((line) => line.includes('/manifest.ts'))
      && expectedManifests.every((path) => valueImports.some((line) => line.includes(path))), valueImports)
    check('11 builtin.ts 数组顺序为 core → 05/06/07/08 真实插件 → demo', /BUILTIN_PLUGINS[^=]*=\s*\[\s*coreWorkbench[\s\S]*coreTransitionPanel[\s\S]*coreCameraInspect[\s\S]*demoExtra[\s\S]*demoKitchenSink\s*,?\s*\]/.test(builtinSource), builtinSource.slice(0, 500))

    const demoManifestSource = [
      await readFile(new URL('../plugins/demo.kitchen-sink/manifest.ts', WORKBENCH_DIR), 'utf8'),
      await readFile(new URL('../plugins/demo.kitchen-sink/commands.ts', WORKBENCH_DIR), 'utf8'),
      await readFile(new URL('../plugins/demo.kitchen-sink/themes/index.ts', WORKBENCH_DIR), 'utf8'),
      await readFile(new URL('../plugins/demo.kitchen-sink/themes/sepia.json', WORKBENCH_DIR), 'utf8'),
      await readFile(new URL('../plugins/demo.kitchen-sink/themes/midnight.json', WORKBENCH_DIR), 'utf8'),
    ].join('\n')
    const required = [
      'demo.sandbox',
      'demo.panel.effects',
      'demo.panel.properties',
      'demo.panel.bottom',
      'demo.drawer.notes',
      'demo.drawer.log',
      'demo.command.ping',
      'demo.command.toggleTheme',
      'demo.command.fail',
      'demo.status.plugin',
      'demo.settings.section',
      'demo.theme.sepia',
      'demo.theme.midnight',
    ]
    const missing = required.filter((id) => !demoManifestSource.includes(id))
    check('11 demo 七类贡献 ID 全部出现在 manifest', missing.length === 0, missing)
    const kinds = ['pages:', 'panels:', 'drawerTabs:', 'statusItems:', 'settings:', 'themes:']
    check('11 demo manifest 覆盖六类声明（命令由 activate 注册）', kinds.every((kind) => demoManifestSource.includes(kind)), kinds.filter((kind) => !demoManifestSource.includes(kind)))

    const coreManifest = await import('../plugins/core.workbench/manifest.ts')
    const core = coreManifest.coreWorkbench
    check('11 core.workbench 贡献三核心页', (core.contributes.pages ?? []).map((page) => page.pageId).join(',') === 'project,document,settings', (core.contributes.pages ?? []).map((page) => page.pageId))
    check('11 core.workbench 注册 diagnostics 抽屉', (core.contributes.drawerTabs ?? []).some((tab) => tab.tabId === 'diagnostics'))
    check('11 core.workbench 六设置分区齐全', (core.contributes.settings ?? []).length === 6, (core.contributes.settings ?? []).map((section) => section.sectionId))
    check('11 core.workbench 不注册 clip.effects / selection.properties 业务面板', !(core.contributes.panels ?? []).some((panel) => panel.panelId === 'clip.effects' || panel.panelId === 'selection.properties'), (core.contributes.panels ?? []).map((panel) => panel.panelId))
    check('11 core.workbench 不 import 业务组件', !/plugins\/.*\/(panels|pages|drawers)/.test(await readWorkbench('../plugins/core.workbench/manifest.ts')))

    // 真实激活 core.workbench（不依赖 .vue 运行时）
    const { PanelRegistryImpl, PageRegistryImpl, DrawerTabRegistryImpl, StatusItemRegistryImpl, SettingsRegistryImpl } = await import('./kernel/CollectionRegistries.ts')
    const { CommandRegistryImpl } = await import('./commands/CommandRegistryImpl.ts')
    const { DiagnosticsStore } = await import('./kernel/DiagnosticsStore.ts')
    const { ThemeRegistry } = await import('./theme/ThemeRegistry.ts')
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
    const { PluginRegistry } = await import('./kernel/PluginRegistry.ts')
    const { PluginHostImpl } = await import('./app/PluginHostImpl.ts')
    const { ServiceRegistryImpl } = await import('./kernel/ServiceRegistryImpl.ts')
    const { StatusServiceImpl } = await import('./app/StatusServiceImpl.ts')
    const { DialogStackImpl } = await import('./app/DialogStackImpl.ts')
    const { FocusServiceImpl } = await import('./focus/FocusServiceImpl.ts')
    const { I18nService } = await import('./i18n/index.ts')
    const services = new ServiceRegistryImpl()
    const status = new StatusServiceImpl(diagnostics)
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
      documentCommands: {
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
        // 07-01：文档级组合定义（仅内存、不写盘、不进撤销）的直通。
        authoringGroups: () => [],
        setAuthoringGroups: () => ({ ok: true, warnings: [] }),
        select: () => undefined,
        selectMany: () => undefined,
      },
    })
    const pluginRegistry = new PluginRegistry({ diagnostics, host })
    pluginRegistry.load([{ manifest: core, source: 'builtin:core.workbench' }])
    await pluginRegistry.activateAll()
    check('11 core.workbench 激活成功', pluginRegistry.isActive('core.workbench'), pluginRegistry.states())
    check('11 激活后页面/面板/抽屉/设置/状态项/命令全部进入注册表', registries.pages.list().length === 3
      && registries.panels.list().length >= 1
      && registries.drawerTabs.list().some((tab) => tab.contribution.tabId === 'diagnostics')
      && registries.settings.list().length === 6
      && registries.statusItems.list().length >= 4
      && registries.commands.list().length >= 15, {
      pages: registries.pages.list().length,
      panels: registries.panels.list().length,
      settings: registries.settings.list().length,
      status: registries.statusItems.list().length,
      commands: registries.commands.list().length,
    })
    check('11 core 命令已注册（file.saveDoc + layout.reset）', registries.commands.get('file.saveDoc') !== undefined
      && registries.commands.get('layout.reset') !== undefined)
    check('11 菜单可从同一注册表生成', registries.commands.menuItems({ pageId: 'document', services }).some((item) => item.commandId === 'file.saveDoc'), registries.commands.menuItems({ pageId: 'document', services }).map((item) => item.commandId))
    check('11 状态项求值不抛错', registries.statusItems.list().every((item) => typeof item.contribution.text !== 'function'
      || typeof item.contribution.text({
        pageId: 'document',
        t: (key: string) => key,
        documentOpen: false,
        documentDirty: false,
        connected: false,
        issueCount: 0,
        pluginErrorCount: 0,
        presetId: 'default',
      }) === 'string'))
    void status
    pluginRegistry.dispose()
    check('11 卸载后贡献清空', registries.pages.list().length === 0 && registries.commands.list().length === 0, {
      pages: registries.pages.list().length,
      commands: registries.commands.list().length,
    })
  }
}

/** 浮点近似。 */
function near(left: number, right: number): boolean {
  return Math.abs(left - right) < 1e-6
}

/** 求和。 */
function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

/** 收集一棵树里所有 split 的比例。 */
function collectSizes(tree: LayoutTree | { root: LayoutTree['root'] }): number[] {
  const sizes: number[] = []
  const visit = (node: LayoutTree['root']): void => {
    if (node.type === 'split') {
      sizes.push(...node.sizes)
      for (const child of node.children) {
        visit(child)
      }
    }
  }
  visit('root' in tree ? tree.root : (tree as LayoutTree).root)
  return sizes
}

/** 收集一棵树里的面板引用。 */
function collectRefs(root: LayoutTree['root']): string[] {
  const refs: string[] = []
  const visit = (node: LayoutTree['root']): void => {
    if (node.type === 'group') {
      for (const panel of node.panels) {
        refs.push(`${panel.pluginId}:${panel.panelId}`)
      }
      return
    }
    for (const child of node.children) {
      visit(child)
    }
  }
  visit(root)
  return refs
}

/** 重新读一遍写盘的偏好（断言 round-trip）。 */
class MemoryStorageLoad {
  private readonly storage: MemoryStorage

  constructor(storage: MemoryStorage) {
    this.storage = storage
  }

  language(): string {
    const text = this.storage.files.get('preferences.json') ?? '{}'
    const parsed = JSON.parse(text) as Partial<PreferencesFile>
    return parsed.language ?? ''
  }
}


main()
  .catch((error: unknown) => {
    check('verify 执行未抛出未捕获异常', false, error)
  })
  .finally(() => {
    console.log(`summary ok=${ok} fail=${fail}`)
    if (fail > 0) {
      process.exitCode = 1
    }
  })
