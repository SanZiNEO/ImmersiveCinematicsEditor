/* 临时冒烟：跑完即删。 */
import type { Diagnostic, DiagnosticSink } from '../api/diagnostics.ts'
import type { StoragePort } from '../api/host.ts'
import type { PanelRegistry, RegisteredPanel } from '../api/registries.ts'
import type { SlotId } from '../api/ids.ts'
import type { GroupNode, LayoutFile, LayoutTree, SplitNode } from '../api/layout.ts'
import { LayoutService } from './LayoutService.ts'
import { buildDefaultTree, createDefaultFile } from './defaultLayouts.ts'
import { LayoutPersistence } from './persist.ts'
import { DRAWER_GROUP_ID, findGroup, findNode, serializeLayoutFile } from './tree.ts'
import { validateLayoutFile } from './validate.ts'

let fail = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) {
    fail += 1
    console.log(`FAIL ${name} ${detail}`)
  }
}

const panels: PanelRegistry = {
  register() {},
  get() {
    return undefined
  },
  has() {
    return true
  },
  list(): RegisteredPanel[] {
    return []
  },
  bySlot(_slot: SlotId) {
    return []
  },
  subscribe() {
    return () => {}
  },
  disposePlugin() {},
}

const diagnostics: DiagnosticSink = {
  report(input) {
    return { ...input, id: 'd', timestamp: '' } satisfies Diagnostic
  },
  list() {
    return []
  },
  countBySeverity() {
    return 0
  },
  subscribe() {
    return () => {}
  },
  clearHandled() {},
  clear() {},
}

class MemoryStorage implements StoragePort {
  files = new Map<string, string>()

  async read(name: string) {
    return this.files.get(name) ?? null
  }

  async write(name: string, text: string) {
    this.files.set(name, text)
  }

  async remove(name: string) {
    this.files.delete(name)
  }

  async list(prefix = '') {
    return [...this.files.keys()].filter((name) => name.startsWith(prefix))
  }

  async listCorrupt(prefix: string) {
    return this.list(prefix)
  }

  revealUserData() {}
}

const file = createDefaultFile()
check('default pages', Object.keys(file.pages).length === 3)
const doc = file.pages.document.presets.default.root
if (doc.type === 'split') {
  check('doc root 3 children', doc.children.length === 3)
  const drawer = doc.children[1]
  check(
    'drawer hidden',
    drawer.type === 'group' && drawer.id === DRAWER_GROUP_ID && !drawer.visible && drawer.collapsed && drawer.lastSize === 280,
  )
  check('bottom min', doc.minSizes?.[2] === 160)
} else {
  check('doc root vertical', false)
}

const service = new LayoutService({ panels, diagnostics })
service.applyViewport('document', { width: 1600, height: 900 })
const props = { pluginId: 'core.workbench', panelId: 'selection.properties' }
const effects = { pluginId: 'core.workbench', panelId: 'clip.effects' }
service.movePanel('document', effects, 'document.right', 1)
let tree = service.getTree('document')
check('move joined', findGroup(tree.root, 'document.right')?.panels.length === 2)
check('move pruned', findGroup(tree.root, 'document.left') === null)
service.undo('document')
check('undo restored', findGroup(service.getTree('document').root, 'document.left')?.panels.length === 1)
service.redo('document')
check('redo applied', findGroup(service.getTree('document').root, 'document.right')?.panels.length === 2, JSON.stringify(service.getTree('document').root))
service.undo('document')

const tx = service.beginTransaction('document')
const newGroupId = service.splitGroup('document', 'document.right', 'horizontal', 1)
if (newGroupId) service.movePanel('document', props, newGroupId, 0)
tx.commit()
tree = service.getTree('document')
check('tx split created', newGroupId !== null && findNode(tree.root, newGroupId) !== null, String(newGroupId))
check(
  'tx panel moved',
  newGroupId !== null && (findGroup(tree.root, newGroupId) as GroupNode | null)?.panels.length === 1,
)
check('tx history once', service.historyInfo('document').undoDepth === 1, JSON.stringify(service.historyInfo('document')))
service.undo('document')
check('tx undo', findNode(service.getTree('document').root, newGroupId ?? 'x') === null)

service.resetLayout('document')
service.applyViewport('document', { width: 1600, height: 900 })
service.resizeSplit('document', 'document.main', 0, 0)
const main = findNode(service.getTree('document').root, 'document.main') as SplitNode
check('resize clamp min', main.sizes[0] >= 420 / 1600 - 1e-6, String(main.sizes[0]))
service.resizeSplit('document', 'document.main', 1, 0.9)
const main2 = findNode(service.getTree('document').root, 'document.main') as SplitNode
check('resize right max 560', 1600 * main2.sizes[2] <= 561, String(1600 * main2.sizes[2]))

service.resetLayout('document')
service.applyViewport('document', { width: 900, height: 900 })
check('narrow folds', service.computedLayout('document').foldedGroupIds.length > 0)
service.applyViewport('document', { width: 1600, height: 900 })
check('wide no fold', service.computedLayout('document').foldedGroupIds.length === 0)
service.applyViewport('document', { width: 1600, height: 600 })
service.setGroupState('document', DRAWER_GROUP_ID, { visible: true, collapsed: false })
const low = service.computedLayout('document')
check('low folds drawer', low.foldedGroupIds.includes(DRAWER_GROUP_ID), JSON.stringify(low.foldedGroupIds))
service.setGroupState('document', DRAWER_GROUP_ID, { visible: false, collapsed: true })
service.applyViewport('document', { width: 1600, height: 900 })

service.savePreset('document', '我的布局')
check('savePreset listed', service.presets('document').includes('我的布局'))
service.applyPreset('document', 'camera')
check('camera active', service.getPage('document').presetId === 'camera')
service.deletePreset('document', '我的布局')
check('deletePreset', !service.presets('document').includes('我的布局'))
service.savePreset('document', 'camera')
check('builtin protected', service.presets('document').filter((id) => id === 'camera').length === 1)

service.setGroupState('document', DRAWER_GROUP_ID, {
  visible: true,
  collapsed: false,
  activeTabId: 'demo.drawer.notes',
  lastSize: 300,
})
const drawer = service.getGroup('document', DRAWER_GROUP_ID) as GroupNode
check('drawer state', drawer.visible && !drawer.collapsed && drawer.lastSize === 300)
check('activeTabId serialized', service.serialize().includes('"activeTabId": "demo.drawer.notes"'))
service.squeezeAxis('document', DRAWER_GROUP_ID, 160)
const squeezed = findNode(service.getTree('document').root, 'document.root') as SplitNode
check('squeeze applied', Math.abs(squeezed.sizes[0] - 160 / 900) < 0.02, String(squeezed.sizes[0]))
service.restoreAxis('document')
const restored = findNode(service.getTree('document').root, 'document.root') as SplitNode
check('restore applied', restored.sizes[0] > 0.5, String(restored.sizes[0]))
service.restoreAxis('document')

const base = createDefaultFile()
const dup = JSON.parse(JSON.stringify(base)) as LayoutFile
const right = findGroup(dup.pages.document.presets.default.root, 'document.right') as GroupNode
right.panels.push({ ...right.panels[0] })
const dupResult = validateLayoutFile(dup, { pageIds: ['project', 'document', 'settings'], panels: () => true })
check('validate duplicates', dupResult.result.duplicates.length === 1, JSON.stringify(dupResult.result.messages))
check(
  'validate dedupe tree',
  (findGroup(dupResult.file.pages.document.presets.default.root, 'document.right') as GroupNode).panels.length === 1,
)

const cycle = JSON.parse(JSON.stringify(base)) as LayoutFile
const cycleRoot = cycle.pages.document.presets.default.root as SplitNode
const cycleChild = cycleRoot.children[0] as SplitNode
cycleChild.id = 'document.root'
const cycleResult = validateLayoutFile(cycle, { pageIds: ['project', 'document', 'settings'], panels: () => true })
check('validate cycle reverts', cycleResult.result.reverted)
check('validate other pages kept', cycleResult.file.pages.project.presets.default.root.type === 'group')

const versionResult = validateLayoutFile({ version: 2 }, { pageIds: ['project', 'document', 'settings'], panels: () => true })
check('validate version revert', versionResult.result.reverted && !versionResult.result.ok)
const nullResult = validateLayoutFile(null, { pageIds: ['project', 'document'], panels: () => true })
check('validate first run ok', nullResult.result.ok && !nullResult.result.reverted)

const unknownResult = validateLayoutFile(base, { pageIds: ['project', 'document', 'settings'], panels: () => false })
check('validate missing keeps nodes', unknownResult.result.missing.length > 0)
check('validate missing not revert', !unknownResult.result.reverted)

const storage = new MemoryStorage()
const persistence = new LayoutPersistence({ storage, diagnostics, now: () => new Date('2026-01-02T03:04:05.678Z') })
storage.files.set('layout.json', '{ broken')
check('persist corrupt null', (await persistence.load()) === null)
check(
  'persist corrupt backup',
  [...storage.files.keys()].some((name) => name.startsWith('layout.corrupt.') && name.endsWith('.json')),
  [...storage.files.keys()].join(','),
)
check('persist keeps original', storage.files.get('layout.json') === '{ broken')
storage.files.delete('layout.json')
await persistence.save(base)
check('persist tmp', storage.files.get('layout.json.tmp') === serializeLayoutFile(base))
check('persist main', storage.files.get('layout.json') === serializeLayoutFile(base))
await persistence.save(base)
check('persist bak written', storage.files.has('layout.json.bak'))

const bigGroup: GroupNode = { type: 'group', id: 'big', panels: [], visible: true, collapsed: false }
for (let index = 0; index < 12000; index += 1) {
  bigGroup.panels.push({
    type: 'panel',
    id: `p:core.workbench:panel${index}`,
    pluginId: 'core.workbench',
    panelId: `panel${index}`,
    visible: true,
  })
}
const oversized: LayoutFile = {
  version: 1,
  currentPageId: 'project',
  pages: { project: { presetId: 'default', presets: { default: { root: bigGroup } } } },
}
let rejected = false
try {
  await new LayoutPersistence({ storage: new MemoryStorage(), diagnostics }).save(oversized)
} catch {
  rejected = true
}
check('persist rejects oversize', rejected)

check('buildDefaultTree ok', buildDefaultTree('document').root.type === 'split')
check('unknown page fallback', buildDefaultTree('demo.sandbox').root.type === 'group')
check('serialize stable', serializeLayoutFile(base) === serializeLayoutFile(JSON.parse(serializeLayoutFile(base)) as LayoutFile))

console.log(`summary fail=${fail}`)
