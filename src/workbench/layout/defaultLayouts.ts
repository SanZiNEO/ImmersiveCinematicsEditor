/**
 * 默认布局与内置预设（04-02 / 04-04）。
 *
 * 默认树只由“已注册面板的 defaultSlot + order”生成，外加冻结的基础结构
 * （document 三列 + 抽屉 + 主轴，project 单组，settings 导航 + 内容）。
 * 这里不 import 任何插件或组件：面板身份只有 `{ pluginId, panelId }`。
 */
import type { GroupNode, LayoutFile, LayoutTree, PageLayout, PanelNode } from '../api/layout.ts'
import type { PanelRef, SlotId } from '../api/ids.ts'
import { CORE_PAGE_IDS, panelNodeId } from '../api/ids.ts'
import type { PanelContribution } from '../api/contributions.ts'
import type { RegisteredPanel } from '../api/registries.ts'
import {
  BOTTOM_MIN_HEIGHT,
  createGroup,
  createPanelNode,
  createSplit,
  DEFAULT_DRAWER_HEIGHT,
  DRAWER_GROUP_ID,
  DRAWER_MIN_HEIGHT,
  collectPanelRefs,
  collectGroups,
  findGroup,
  findPanel,
  removePanelNode,
  replaceNode,
} from './tree.ts'

/** 内置预设 ID（04-02）；任何页都可以切到这些 ID。 */
export const PAGE_PRESETS = ['default', 'camera', 'subtitle', 'behavior', 'compact'] as const

export type PagePresetId = (typeof PAGE_PRESETS)[number]

/** 是否为内置预设 ID。 */
export function isPagePresetId(value: string): value is PagePresetId {
  return (PAGE_PRESETS as readonly string[]).includes(value)
}

/** document 页主区三列比例（左 0.26 / 中 0.52 / 右 0.22）。 */
export const DEFAULT_SPLIT_RATIOS = { left: 0.26, center: 0.52, right: 0.22 } as const

/** document 根 split（主轴 / 抽屉 / 时间轴）的默认比例；抽屉默认隐藏，占 0。 */
export const DEFAULT_VERTICAL_RATIOS = { main: 0.62, drawer: 0.06, bottom: 0.32 } as const

/** 尺寸约束：数值来自 04-02 / 04-05 / 04-06 的冻结表，键是面板（或抽屉 tab）的 `panelId`。 */
export interface PanelSizeConstraint {
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
}

/** 冻结尺寸表；manifest 未声明尺寸时也用它兜底，避免布局出现不可用宽度。 */
export const PANEL_SIZE_CONSTRAINTS: Readonly<Record<string, PanelSizeConstraint>> = Object.freeze({
  'clip.effects': { minWidth: 420 },
  'selection.properties': { minWidth: 280, maxWidth: 560 },
  preview: { minWidth: 320 },
  timeline: { minHeight: BOTTOM_MIN_HEIGHT, maxHeight: 560 },
  'timeline.main': { minHeight: BOTTOM_MIN_HEIGHT, maxHeight: 560 },
  diagnostics: { minHeight: DRAWER_MIN_HEIGHT },
})

/** 取一个面板的冻结尺寸约束。 */
export function panelSizeConstraint(panelId: string): PanelSizeConstraint {
  return PANEL_SIZE_CONSTRAINTS[panelId] ?? {}
}

/** 面板尺寸：manifest 只允许把冻结下限抬高、把上限压低，不能反向放宽。 */
export function mergePanelConstraint(
  panelId: string,
  contribution?: PanelContribution,
): PanelSizeConstraint {
  const frozen = panelSizeConstraint(panelId)
  const merged: PanelSizeConstraint = {}
  const minWidth = Math.max(frozen.minWidth ?? 0, contribution?.minWidth ?? 0)
  const minHeight = Math.max(frozen.minHeight ?? 0, contribution?.minHeight ?? 0)
  const maxWidth = Math.min(frozen.maxWidth ?? Infinity, contribution?.maxWidth ?? Infinity)
  const maxHeight = Math.min(frozen.maxHeight ?? Infinity, contribution?.maxHeight ?? Infinity)
  if (minWidth > 0) merged.minWidth = minWidth
  if (minHeight > 0) merged.minHeight = minHeight
  if (Number.isFinite(maxWidth)) merged.maxWidth = maxWidth
  if (Number.isFinite(maxHeight)) merged.maxHeight = maxHeight
  return merged
}

/**
 * 核心槽位的兜底引用（`core.workbench`）。
 *
 * 面板还没注册时也要有稳定的五区结构：保留真实 ID，宿主显示“面板未安装”占位，
 * 而不是让默认树缺一块或被压缩成两列。
 */
export const CORE_PANEL_REFS = {
  effects: { pluginId: 'core.workbench', panelId: 'clip.effects' },
  preview: { pluginId: 'core.workbench', panelId: 'preview' },
  properties: { pluginId: 'core.workbench', panelId: 'selection.properties' },
  timeline: { pluginId: 'core.workbench', panelId: 'timeline' },
  diagnostics: { pluginId: 'core.workbench', panelId: 'diagnostics' },
  projectMain: { pluginId: 'core.workbench', panelId: 'project.main' },
  settingsNav: { pluginId: 'core.workbench', panelId: 'settings.nav' },
  settingsContent: { pluginId: 'core.workbench', panelId: 'settings.content' },
} as const satisfies Record<string, PanelRef>

/** 面板注册表里本模块需要的唯一能力；测试可只用 `{ bySlot }` 替身。 */
export interface PanelSlotSource {
  bySlot(slot: SlotId): readonly RegisteredPanel[]
}

/** 抽屉贡献的布局身份；宿主通过同一 `PanelHost` 解析，拖动仍按普通面板处理。 */
export interface DrawerPanelSource {
  ref: PanelRef
  order: number
  minWidth?: number
  minHeight?: number
}

/** 应用装配层提供的抽屉贡献列表（按注册顺序即可）。 */
export interface DrawerPanelSlotSource {
  list(): readonly DrawerPanelSource[]
}

/** 每个页每个槽位在“一个面板都没注册”时的兜底面板引用。 */
const FALLBACK_SLOT_REFS: Readonly<Record<string, Partial<Record<SlotId, readonly PanelRef[]>>>> = {
  document: {
    'document.left': [CORE_PANEL_REFS.effects],
    'document.center': [CORE_PANEL_REFS.preview],
    'document.right': [CORE_PANEL_REFS.properties],
    'document.bottom': [CORE_PANEL_REFS.timeline],
  },
  project: {
    'project.main': [CORE_PANEL_REFS.projectMain],
  },
  settings: {
    'settings.nav': [CORE_PANEL_REFS.settingsNav],
    'settings.content': [CORE_PANEL_REFS.settingsContent],
  },
}

/** 槽位的像素下限；与 04-02 / 04-05 的冻结尺寸一致。 */
const SLOT_MIN_WIDTHS: Readonly<Partial<Record<SlotId, number>>> = {
  'document.left': 420,
  'document.center': 320,
  'document.right': 280,
}

const SLOT_MIN_HEIGHTS: Readonly<Partial<Record<SlotId, number>>> = {
  'document.bottom': BOTTOM_MIN_HEIGHT,
  'document.drawer': DRAWER_MIN_HEIGHT,
}

/** 每个预设的树形差异：只改比例与隐藏槽位，不改面板集合。 */
interface PresetShape {
  main: readonly [number, number, number]
  root: readonly [number, number, number]
  hidden: readonly SlotId[]
}

const PRESET_SHAPES: Readonly<Record<PagePresetId, PresetShape>> = {
  default: {
    main: [DEFAULT_SPLIT_RATIOS.left, DEFAULT_SPLIT_RATIOS.center, DEFAULT_SPLIT_RATIOS.right],
    root: [DEFAULT_VERTICAL_RATIOS.main, DEFAULT_VERTICAL_RATIOS.drawer, DEFAULT_VERTICAL_RATIOS.bottom],
    hidden: [],
  },
  camera: {
    main: [0.08, 0.72, 0.2],
    root: [0.8, 0.06, 0.14],
    hidden: ['document.left'],
  },
  subtitle: {
    main: [0.18, 0.54, 0.28],
    root: [0.54, 0.06, 0.4],
    hidden: [],
  },
  behavior: {
    main: [0.3, 0.42, 0.28],
    root: [0.62, 0.06, 0.32],
    hidden: ['document.drawer'],
  },
  compact: {
    main: [0.2, 0.62, 0.18],
    root: [0.74, 0.06, 0.2],
    hidden: ['document.drawer'],
  },
}

/** 折叠态 group 的 `lastSize` 估计：恢复时先按这个像素值展开，再由实际视口夹取。 */
const HIDDEN_SLOT_LAST_SIZE: Readonly<Partial<Record<SlotId, number>>> = {
  'document.left': 420,
  'document.center': 320,
  'document.right': 360,
  'document.bottom': BOTTOM_MIN_HEIGHT,
  'document.drawer': DEFAULT_DRAWER_HEIGHT,
}

interface SlotPanel {
  ref: PanelRef
  node: PanelNode
}

/** 解析一个槽位的面板：优先注册表（按 `order`），空槽才用核心兜底引用。 */
function resolveSlotPanels(pageId: string, slot: SlotId, panels?: PanelSlotSource): SlotPanel[] {
  const registered = panels?.bySlot(slot) ?? []
  if (registered.length > 0) {
    return registered.map((entry) => {
      const ref: PanelRef = { pluginId: entry.pluginId, panelId: entry.contribution.panelId }
      const constraint = mergePanelConstraint(ref.panelId, entry.contribution)
      return { ref, node: createPanelNode(ref, constraint) }
    })
  }
  if (panels !== undefined) {
    // 注册表权威：该槽位没有已注册面板就是空组（04-02「槽位不存在时创建组」），
    // 不回退到核心面板占位——否则未实现的 05/06 面板会在 04 里显示“不可用”。
    return []
  }
  const fallback = FALLBACK_SLOT_REFS[pageId]?.[slot] ?? []
  return fallback.map((ref) => ({
    ref: { pluginId: ref.pluginId, panelId: ref.panelId },
    node: createPanelNode(ref, panelSizeConstraint(ref.panelId)),
  }))
}

/** 建一个槽位 group；预设把该槽位标记为隐藏时保留 `lastSize` 供恢复。 */
function slotGroup(
  pageId: string,
  slot: SlotId,
  shape: PresetShape,
  panels?: PanelSlotSource,
): GroupNode {
  const entries = resolveSlotPanels(pageId, slot, panels)
  const hidden = shape.hidden.includes(slot)
  const group = createGroup(
    slot,
    entries.map((entry) => entry.node),
    hidden
      ? { visible: false, collapsed: true, lastSize: HIDDEN_SLOT_LAST_SIZE[slot] ?? DEFAULT_DRAWER_HEIGHT }
      : {},
  )
  return group
}

function buildDocumentTree(shape: PresetShape, panels?: PanelSlotSource): LayoutTree {
  const left = slotGroup('document', 'document.left', shape, panels)
  const center = slotGroup('document', 'document.center', shape, panels)
  const right = slotGroup('document', 'document.right', shape, panels)
  const bottom = slotGroup('document', 'document.bottom', shape, panels)
  // 旧版 `document.drawer` 槽位保留为合法停靠点，但默认贡献进入侧栏。
  const drawerPanels = resolveSlotPanels('document', DRAWER_GROUP_ID, panels).map((entry) => entry.node)
  if (panels !== undefined) {
    right.panels.push(...drawerPanels)
    right.activePanelId ??= right.panels[0]?.id
  }
  const drawer = createGroup(
    DRAWER_GROUP_ID,
    [],
    {
      visible: false,
      collapsed: true,
      lastSize: DEFAULT_DRAWER_HEIGHT,
    },
  )
  const main = createSplit(
    'document.main',
    'horizontal',
    [left, center, right],
    shape.main,
    [420, 320, 280],
  )
  const root = createSplit(
    'document.root',
    'vertical',
    [main, bottom, drawer],
    [shape.root[0], shape.root[2], shape.root[1]],
    [0, BOTTOM_MIN_HEIGHT, DRAWER_MIN_HEIGHT],
  )
  return { root }
}

/**
 * 在文档页三栏中补齐抽屉贡献，不改变已有面板顺序。
 *
 * 新贡献放左栏，已有普通面板留在原处；右栏用于属性 / 触发器等工作面，
 * 避免工具类抽屉在默认树里抢占检查器标签。旧布局由 `LayoutService` 单独迁移。
 */
export function appendDrawerPanelsToDocument(
  tree: LayoutTree,
  drawers: DrawerPanelSlotSource,
): number {
  const left = findGroup(tree.root, 'document.left')
  const right = findGroup(tree.root, 'document.right')
  const target = left?.visible ? left : right ?? left
  if (target === null) return 0
  const existing = new Set(collectPanelRefs(tree.root).map((ref) => `${ref.pluginId}:${ref.panelId}`))
  const additions = drawers.list()
    .filter((entry) => !existing.has(`${entry.ref.pluginId}:${entry.ref.panelId}`))
    .sort((a, b) => a.order - b.order || a.ref.panelId.localeCompare(b.ref.panelId))
    .map((entry) => createPanelNode(entry.ref, {
      minWidth: entry.minWidth,
      minHeight: entry.minHeight,
    }))
  if (additions.length === 0) return 0
  const next: GroupNode = {
    ...target,
    panels: [...target.panels, ...additions],
    activePanelId: target.activePanelId ?? additions[0]?.id,
  }
  const root = replaceNode(tree.root, target.id, next)
  if (root === null) return 0
  tree.root = root
  return additions.length
}

/** 移除已下线面板的布局节点（当前只用于触发器的 legacy 右栏入口）。 */
export function removeLegacyDocumentPanels(tree: LayoutTree): number {
  let removed = 0
  const legacy = [
    { pluginId: 'core.behavior', panelId: 'behavior.triggers' },
  ]
  for (const ref of legacy) {
    if (findPanel(tree.root, ref) === null) continue
    const next = removePanelNode(tree.root, panelNodeId(ref), [DRAWER_GROUP_ID])
    if (next === null) continue
    tree.root = next
    removed += 1
  }
  for (const group of collectGroups(tree.root)) {
    if (group.activePanelId !== undefined && group.panels.every((panel) => panel.id !== group.activePanelId)) {
      const next = { ...group, panels: group.panels }
      delete next.activePanelId
      const root = replaceNode(tree.root, group.id, next)
      if (root !== null) tree.root = root
    }
  }
  return removed
}

function buildProjectTree(panels?: PanelSlotSource): LayoutTree {
  return { root: slotGroup('project', 'project.main', PRESET_SHAPES.default, panels) }
}

function buildSettingsTree(panels?: PanelSlotSource): LayoutTree {
  const nav = slotGroup('settings', 'settings.nav', PRESET_SHAPES.default, panels)
  const content = slotGroup('settings', 'settings.content', PRESET_SHAPES.default, panels)
  return { root: createSplit('settings.main', 'horizontal', [nav, content], [0.22, 0.78]) }
}

/**
 * 按页建默认树。
 *
 * 未知页（插件页）走单组兜底：页面自己的 `defaultLayout` 蓝图由内核在注册时提供，
 * 布局服务只保证“永远有一棵结构合法的树”。
 */
export function buildDefaultTree(pageId: string, panels?: PanelSlotSource): LayoutTree {
  return buildPresetTree(pageId, 'default', panels)
}

/** 建内置预设树；`presetId` 不是内置 ID 时按 `default` 处理。 */
export function buildPresetTree(pageId: string, presetId: string, panels?: PanelSlotSource): LayoutTree {
  const shape = isPagePresetId(presetId) ? PRESET_SHAPES[presetId] : PRESET_SHAPES.default
  if (pageId === 'document') return buildDocumentTree(shape, panels)
  if (pageId === 'settings') return buildSettingsTree(panels)
  return buildProjectTree(panels)
}

/** 首次启动的布局文件：三核心页，每页只有 `default` 预设。 */
export function createDefaultFile(panels?: PanelSlotSource): LayoutFile {
  const pages: Record<string, PageLayout> = {}
  for (const pageId of CORE_PAGE_IDS) {
    pages[pageId] = { presetId: 'default', presets: { default: buildDefaultTree(pageId, panels) } }
  }
  return { version: 1, currentPageId: 'project', pages }
}
