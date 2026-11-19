/**
 * 工作区布局服务（04-02）：布局树唯一写入者。
 *
 * 外壳只调 `getTree` 渲染，不持有第二份尺寸；拖动/缩放通过事务把连续变化留在内存，
 * 松手提交一次。布局历史与 03 的脚本撤销完全分开，最多 20 步。
 *
 * 本文件是纯逻辑：不 import `.vue`、不读 DOM、不读 `window`，像素与折叠降级都用传入的视口计算。
 */
import type { DiagnosticInput, DiagnosticSeverity, DiagnosticSink } from '../api/diagnostics.ts'
import type { Orientation, PanelRef } from '../api/ids.ts'
import { CORE_PAGE_IDS, panelNodeId, samePanel, SLOT_IDS } from '../api/ids.ts'
import type {
  GroupNode,
  GroupStatePatch,
  LayoutFile,
  LayoutNode,
  LayoutTransaction,
  LayoutTree,
  LayoutValidationResult,
  PageLayout,
  PanelLayoutInfo,
  PanelNode,
  SplitNode,
  Viewport,
  WorkspaceLayoutService,
} from '../api/layout.ts'
import type { PanelRegistry } from '../api/registries.ts'
import {
  buildDefaultTree,
  buildPresetTree,
  isPagePresetId,
  mergePanelConstraint,
  PAGE_PRESETS,
} from './defaultLayouts.ts'
import type { PanelSlotSource } from './defaultLayouts.ts'
import {
  assignGroupActiveTabId,
  clonePanelNode,
  cloneTree,
  collectPanelRefs,
  createGroup,
  createSplit,
  DEFAULT_DRAWER_HEIGHT,
  DRAWER_GROUP_ID,
  DRAWER_MAX_HEIGHT,
  DRAWER_MIN_HEIGHT,
  findGroup,
  findNode,
  findPanel,
  findPanelGroup,
  firstVisiblePanelId,
  groupActiveTabId,
  isDrawerGroupId,
  normalizeSizes,
  pruneEmptyGroups,
  createPanelNode,
  removePanelNode,
  repairGroupActivePanel,
  replaceNode,
  serializeLayoutFile,
  uniqueNodeId,
  walkTree,
} from './tree.ts'
import { validateLayoutFile } from './validate.ts'

/** 每页布局历史步数上限（04-02）。 */
export const LAYOUT_HISTORY_LIMIT = 20

/** 单页最少保留的可视宽度；窗口窄于此值时优先折叠右侧面板。 */
const COMPACT_WIDTH = 900

/** 低窗阈值：低于它时抽屉折叠、主轴保持可用（04-06）。 */
const LOW_HEIGHT = 720

/** 构造参数。 */
export interface LayoutServiceOptions {
  panels: PanelRegistry
  diagnostics: DiagnosticSink
  /** 页级默认树；插件页可以用自己的蓝图覆盖。 */
  defaults?: (pageId: string) => LayoutTree
  now?: () => number
  /**
   * 「这个 ref 是否已注册」的判定（默认只看 `PanelRegistry`）。
   *
   * 抽屉标签不是面板，但可以被拖进普通 group 变成真正的面板节点，
   * 所以应用装配层会把 `DrawerTabRegistry` 也并进这个谓词。
   */
  registered?: (ref: PanelRef) => boolean
  /** 「这个 ref 是抽屉标签吗」——抽屉 group 的回归语义用它区分。 */
  isDrawerTab?: (ref: PanelRef) => boolean
}

/** 一个节点在视口里的实际像素。 */
export interface ComputedNode {
  id: string
  width: number
  height: number
  visible: boolean
  collapsed: boolean
}

/** 一次视口计算的结果：只读、不持久化、不改比例。 */
export interface ComputedLayout {
  pageId: string
  viewport: Viewport
  nodes: readonly ComputedNode[]
  /** 因窗口过小被折叠的 group（不写盘，窗口恢复后自动回来）。 */
  foldedGroupIds: readonly string[]
  message: string | null
}

/** 布局历史状态（状态区 / 自检读取）。 */
export interface LayoutHistoryInfo {
  canUndo: boolean
  canRedo: boolean
  undoDepth: number
  redoDepth: number
  lastChangeAt: number
}

interface History {
  past: PageLayout[]
  future: PageLayout[]
  lastChangeAt: number
}

interface TransactionState {
  pageId: string
  page: PageLayout
  snapshot: PageLayout
  closed: boolean
}

/** 一次低窗挤压的记录：还原时按原比例写回。 */
interface AxisRecord {
  pageId: string
  splitId: string
  sizes: number[]
}

function finitePositive(value: number): number | undefined {
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function roundPixels(value: number): number {
  return Math.max(0, Math.round(value))
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => Math.abs(value - right[index]) < 1e-9)
}

function clonePage(page: PageLayout): PageLayout {
  const presets: Record<string, LayoutTree> = {}
  for (const presetId of Object.keys(page.presets)) presets[presetId] = cloneTree(page.presets[presetId])
  return { presetId: page.presetId, presets }
}

/** 找到直接包含 `childId` 的 split 与子节点下标。 */
function findParentSplit(
  root: LayoutNode,
  childId: string,
): { split: SplitNode; index: number } | null {
  let found: { split: SplitNode; index: number } | null = null
  walkTree(root, (node) => {
    if (found) return false
    if (node.type !== 'split') return true
    const index = node.children.findIndex((child) => child.id === childId)
    if (index >= 0) {
      found = { split: node, index }
      return false
    }
    return true
  })
  return found
}

/**
 * 把总量按比例分给子节点，同时满足最小/最大像素约束。
 *
 * 先按比例分，超界的孩子冻结在边界上，剩余空间再按比例分给未冻结的孩子；
 * 循环最多 8 轮。若最小空间本身就放不下，按最小值的比例缩放，绝不产生负尺寸。
 */
function fitAxis(
  total: number,
  ratios: readonly number[],
  mins: readonly number[],
  maxes: readonly number[],
): number[] {
  const count = ratios.length
  if (count === 0) return []
  const minSum = mins.reduce((sum, value) => sum + Math.max(0, value), 0)
  if (minSum > total && minSum > 0) {
    return mins.map((value) => (total * Math.max(0, value)) / minSum)
  }
  const weights = ratios.map((value) => (Number.isFinite(value) && value > 0 ? value : 0))
  const weightSum = weights.reduce((sum, value) => sum + value, 0)
  const base = weights.map((value) => (weightSum > 0 ? value / weightSum : 1 / count))
  const pixels = base.map((value) => value * total)
  const frozen = new Array<boolean>(count).fill(false)
  for (let pass = 0; pass < 8; pass += 1) {
    let remaining = total
    const free: number[] = []
    let clamped = false
    for (let index = 0; index < count; index += 1) {
      if (frozen[index]) {
        remaining -= pixels[index]
        continue
      }
      if (pixels[index] < mins[index]) {
        pixels[index] = Math.max(0, mins[index])
        frozen[index] = true
        remaining -= pixels[index]
        clamped = true
        continue
      }
      if (pixels[index] > maxes[index]) {
        pixels[index] = Math.max(0, maxes[index])
        frozen[index] = true
        remaining -= pixels[index]
        clamped = true
        continue
      }
      free.push(index)
    }
    if (!clamped) {
      // 未冻结的孩子按比例吃掉剩余空间；最后一个收口，保证总和精确。
      const freeWeight = free.reduce((sum, index) => sum + Math.max(0, ratios[index] ?? 0), 0)
      let assigned = 0
      free.forEach((index, position) => {
        if (position === free.length - 1) {
          pixels[index] = Math.max(0, remaining - assigned)
          return
        }
        const share = freeWeight > 0
          ? (remaining * Math.max(0, ratios[index] ?? 0)) / freeWeight
          : remaining / free.length
        pixels[index] = Math.max(0, share)
        assigned += pixels[index]
      })
      break
    }
    if (remaining <= 0) {
      free.forEach((index) => {
        pixels[index] = 0
        frozen[index] = true
      })
      break
    }
  }
  return pixels
}

/**
 * 布局服务实现。
 *
 * 提交顺序固定为：改树 → 记历史 → 通知订阅者。持久化由外壳订阅后调用
 * `LayoutPersistence.save(parse(serialize()))`，服务本身不碰文件。
 */
export class LayoutService implements WorkspaceLayoutService {
  private readonly panels: PanelRegistry

  private readonly diagnostics: DiagnosticSink

  private readonly defaults?: (pageId: string) => LayoutTree

  private readonly registered?: (ref: PanelRef) => boolean

  private readonly isDrawerTabRef?: (ref: PanelRef) => boolean

  private readonly now: () => number

  private file: LayoutFile

  private readonly histories = new Map<string, History>()

  private readonly lastChangeAt = new Map<string, number>()

  private readonly listeners = new Set<() => void>()

  private view: Viewport = { width: 1600, height: 900 }

  private transaction: TransactionState | null = null

  private axisRecord: AxisRecord | null = null

  constructor(options: LayoutServiceOptions) {
    this.panels = options.panels
    this.diagnostics = options.diagnostics
    this.defaults = options.defaults
    this.registered = options.registered
    this.isDrawerTabRef = options.isDrawerTab
    this.now = options.now ?? Date.now
    this.file = { version: 1, currentPageId: 'project', pages: {} }
    for (const pageId of CORE_PAGE_IDS) this.file.pages[pageId] = this.newDefaultPage(pageId)
  }

  // ── 读取 ──────────────────────────────────────────────────────────────

  getPage(pageId: string): PageLayout {
    return clonePage(this.workingPage(pageId))
  }

  getTree(pageId: string): LayoutTree {
    return cloneTree(this.treeOf(this.workingPage(pageId)))
  }

  getGroup(pageId: string, groupId: string): GroupNode | undefined {
    const group = findGroup(this.treeOf(this.workingPage(pageId)).root, groupId)
    return group ? (cloneTree({ root: group }).root as GroupNode) : undefined
  }

  viewport(): Viewport {
    return { ...this.view }
  }

  computedLayout(pageId: string): ComputedLayout {
    return this.computeLayout(pageId)
  }

  /** 面板实际几何；面板不在当前页或未注册时返回 null（面板宿主据此显示空态）。 */
  panelLayout(pageId: string, ref: PanelRef): PanelLayoutInfo | null {
    const tree = this.treeOf(this.workingPage(pageId))
    const group = findPanelGroup(tree.root, ref)
    if (!group) return null
    const panel = group.panels.find((item) => samePanel(item, ref))
    if (!panel) return null
    const computed = this.computeLayout(pageId)
    const geometry = computed.nodes.find((node) => node.id === group.id)
    if (!geometry) return null
    const visible = geometry.visible && panel.visible && !geometry.collapsed
    return {
      pageId,
      visible,
      collapsed: geometry.collapsed || !visible,
      width: visible ? geometry.width : 0,
      height: visible ? geometry.height : 0,
    }
  }

  historyInfo(pageId: string): LayoutHistoryInfo {
    const history = this.histories.get(pageId)
    return {
      canUndo: (history?.past.length ?? 0) > 0,
      canRedo: (history?.future.length ?? 0) > 0,
      undoDepth: history?.past.length ?? 0,
      redoDepth: history?.future.length ?? 0,
      lastChangeAt: this.lastChangeAt.get(pageId) ?? 0,
    }
  }

  // ── 视口 ──────────────────────────────────────────────────────────────

  applyViewport(pageId: string, viewport: Viewport): void {
    const width = finitePositive(viewport.width)
    const height = finitePositive(viewport.height)
    if (width === undefined || height === undefined) {
      this.report('warning', `忽略非法视口 ${String(viewport.width)}×${String(viewport.height)}`)
      return
    }
    const unchanged = this.view.width === roundPixels(width) && this.view.height === roundPixels(height)
    this.view = { width: roundPixels(width), height: roundPixels(height) }
    this.computeLayout(pageId)
    if (!unchanged) this.notify()
  }

  // ── 停靠与缩放 ────────────────────────────────────────────────────────

  movePanel(pageId: string, panel: PanelRef, targetGroupId: string, index: number): void {
    this.mutate(pageId, 'movePanel', (page) => {
      const tree = this.treeOf(page)
      const sourcePanel = findPanel(tree.root, panel)
      const sourceGroup = findPanelGroup(tree.root, panel)
      const target = findGroup(tree.root, targetGroupId)
      if (!target) {
        this.report('warning', `无法移动 ${panel.pluginId}:${panel.panelId}：目标 group ${targetGroupId} 不存在`)
        return false
      }
      if (!sourcePanel || !sourceGroup) {
        // 抽屉 group：回归只设 activeTabId，不建面板节点（抽屉标签归注册表管）。
        if (target.id === DRAWER_GROUP_ID && this.isDrawerTab(panel)) {
          const nextDrawer: GroupNode = {
            ...target,
            activeTabId: panel.panelId,
            visible: true,
            collapsed: false,
          }
          const root = replaceNode(tree.root, target.id, nextDrawer)
          if (!root) return false
          tree.root = root
          return true
        }
        // 抽屉标签被拖进普通 group：源不是面板节点，落成新面板节点。
        return this.dropDrawerTabInto(tree, panel, target, index)
      }
      if (target.id === DRAWER_GROUP_ID && this.isDrawerTab(panel)) {
        // 从普通 group 拖回抽屉：移除面板节点，改回 activeTabId。
        const without = removePanelNode(tree.root, sourcePanel.id, [DRAWER_GROUP_ID])
        if (!without) return false
        const drawer = findGroup(without, DRAWER_GROUP_ID)
        if (drawer === null) return false
        const nextDrawer: GroupNode = {
          ...drawer,
          activeTabId: panel.panelId,
          visible: true,
          collapsed: false,
        }
        const root = replaceNode(without, drawer.id, nextDrawer)
        if (!root) return false
        tree.root = root
        return true
      }
      if (isDrawerGroupId(target.id) && !this.panels.has(panel)) {
        // 抽屉标签拖回抽屉：抽屉 group 的 panels 恒为空（内容来自 drawerTab 注册表），
        // 这里只切 activeTabId，绝不生成残留的幽灵节点。
        return this.returnDrawerTab(tree, sourcePanel, panel)
      }
      if (sourceGroup.id === target.id) {
        const from = sourceGroup.panels.findIndex((item) => item.id === sourcePanel.id)
        const to = Math.min(Math.max(index, 0), sourceGroup.panels.length - 1)
        if (from < 0 || from === to) return false
        const panels = [...sourceGroup.panels]
        const [moved] = panels.splice(from, 1)
        panels.splice(to, 0, moved)
        const nextGroup: GroupNode = { ...sourceGroup, panels, activePanelId: moved.id }
        const root = replaceNode(tree.root, sourceGroup.id, nextGroup)
        if (!root) return false
        tree.root = root
        return true
      }
      // 目标 group 可能刚由 splitGroup 建出来（空组），压缩时必须保留它，
      // 否则“拖到边缘拆分并移动”会在中途丢掉落点。
      const withoutPanel = removePanelNode(tree.root, sourcePanel.id, [DRAWER_GROUP_ID, targetGroupId])
      if (!withoutPanel) {
        this.report('warning', `无法移除面板 ${panel.pluginId}:${panel.panelId} 的原节点`)
        return false
      }
      const targetAfter = findGroup(withoutPanel, targetGroupId)
      if (!targetAfter) {
        this.report('warning', `目标 group ${targetGroupId} 在压缩后被移除`)
        return false
      }
      const panels = [...targetAfter.panels]
      const to = Math.min(Math.max(index, 0), panels.length)
      const moved: PanelNode = { ...clonePanelNode(sourcePanel), visible: true }
      panels.splice(to, 0, moved)
      const nextTarget: GroupNode = {
        ...targetAfter,
        panels,
        visible: true,
        collapsed: false,
        activePanelId: moved.id,
      }
      const root = replaceNode(withoutPanel, targetAfter.id, nextTarget)
      if (!root) return false
      tree.root = root
      return true
    })
  }

  /**
   * 把抽屉标签落成一个面板节点（04-06 拖出）。
   *
   * 抽屉 group 的 `panels` 为空（标签来自 `drawerTab` 贡献），所以这里新建 `PanelNode`，
   * 并清掉抽屉的 `activeTabId`（如果正指向被拖走的标签）。
   */
  private dropDrawerTabInto(
    tree: LayoutTree,
    panel: PanelRef,
    target: GroupNode,
    index: number,
  ): boolean {
    if (!this.isRegistered(panel)) {
      this.report('warning', `无法移动 ${panel.pluginId}:${panel.panelId}：未注册的面板或抽屉标签`)
      return false
    }
    const panels = [...target.panels]
    if (panels.some((item) => item.pluginId === panel.pluginId && item.panelId === panel.panelId)) {
      this.report('info', `${panel.pluginId}:${panel.panelId} 已在目标 group，忽略重复拖入`)
      return false
    }
    const node = createPanelNode(panel)
    const to = Math.min(Math.max(index, 0), panels.length)
    panels.splice(to, 0, node)
    const nextTarget: GroupNode = {
      ...target,
      panels,
      visible: true,
      collapsed: false,
      activePanelId: node.id,
    }
    let root = replaceNode(tree.root, target.id, nextTarget)
    if (!root) return false
    const drawer = findGroup(root, DRAWER_GROUP_ID)
    if (drawer !== null && drawer.activeTabId === panel.panelId) {
      const nextDrawer: GroupNode = { ...drawer, activeTabId: undefined }
      root = replaceNode(root, drawer.id, nextDrawer) ?? root
    }
    tree.root = root
    return true
  }

  /**
   * 抽屉标签拖回抽屉（04-06）。
   *
   * 抽屉内容来自 `DRAWER_TAB_REGISTRY`，所以只切 `activeTabId` 并打开抽屉，
   * 绝不把标签落成 `panels` 里的节点——否则容器不渲染它，还会被序列化落盘。
   */
  private returnDrawerTab(tree: LayoutTree, sourcePanel: PanelNode, panel: PanelRef): boolean {
    if (!this.isRegistered(panel)) {
      this.report('warning', `无法移回抽屉 ${panel.pluginId}:${panel.panelId}：未注册或插件已禁用`)
      return false
    }
    const removed = removePanelNode(tree.root, sourcePanel.id, [DRAWER_GROUP_ID])
    if (!removed) {
      this.report('warning', `无法移回抽屉 ${panel.pluginId}:${panel.panelId}：原节点移除失败`)
      return false
    }
    const drawer = findGroup(removed, DRAWER_GROUP_ID)
    if (!drawer) {
      this.report('warning', '无法移回抽屉：布局里没有 document.drawer group')
      return false
    }
    const nextDrawer: GroupNode = {
      ...drawer,
      panels: drawer.panels,
      visible: true,
      collapsed: false,
      activeTabId: panel.panelId,
    }
    const root = replaceNode(removed, drawer.id, nextDrawer)
    if (!root) return false
    tree.root = root
    return true
  }

  /** ref 是否抽屉标签（装配层注入；未注入时按未注册处理）。 */
  private isDrawerTab(ref: PanelRef): boolean {
    return this.isDrawerTabRef !== undefined && this.isDrawerTabRef(ref)
  }

  /** ref 是否已注册（面板或抽屉标签，由装配层注入谓词）。 */
  private isRegistered(ref: PanelRef): boolean {
    if (this.registered !== undefined) {
      return this.registered(ref)
    }
    return this.panels.has(ref)
  }

  /**
   * 把一个 group 拆成两个：原 group 原样保留，新建一个空 group。
   *
   * `atIndex` 是原 group 在新 split 里的位置（0 = 新组在前，1 = 原组在前）。
   * 返回新 group id（接口签名是 void，拖动控制器的标准流程是随后 `movePanel` 到该 id）。
   */
  splitGroup(pageId: string, groupId: string, orientation: Orientation, atIndex: number): string | null {
    let created: string | null = null
    this.mutate(pageId, 'splitGroup', (page) => {
      const tree = this.treeOf(page)
      const group = findGroup(tree.root, groupId)
      if (!group) {
        this.report('warning', `无法拆分 group ${groupId}：不存在`)
        return false
      }
      const newGroupId = uniqueNodeId(tree.root, `${groupId}~split`)
      const splitId = uniqueNodeId(tree.root, `${groupId}~splitter`)
      const spare = createGroup(newGroupId, [], { visible: true, collapsed: false })
      const children = atIndex <= 0 ? [spare, group] : [group, spare]
      const split = createSplit(splitId, orientation, children, [0.5, 0.5])
      const root = replaceNode(tree.root, groupId, split)
      if (!root) return false
      tree.root = root
      created = newGroupId
      return true
    })
    return created
  }

  resizeSplit(pageId: string, splitId: string, index: number, ratio: number): void {
    if (!Number.isFinite(ratio)) {
      this.report('warning', `忽略非法分隔线比例 ${String(ratio)}`)
      return
    }
    this.mutate(pageId, 'resizeSplit', (page) => {
      const tree = this.treeOf(page)
      const node = findNode(tree.root, splitId)
      if (!node || node.type !== 'split') {
        this.report('warning', `无法缩放分隔线：split ${splitId} 不存在`)
        return false
      }
      const handle = Math.trunc(index)
      if (handle < 0 || handle >= node.children.length - 1) {
        this.report('warning', `分隔线下标 ${String(index)} 超出 split ${splitId} 的范围`)
        return false
      }
      const horizontal = node.orientation === 'horizontal'
      const nodes = this.distributeTree(tree.root, this.view, this.foldedGroupIds(pageId))
      const geometry = nodes.get(node.id)
      const total = roundPixels(geometry ? (horizontal ? geometry.width : geometry.height) : 0)
      if (total <= 0) return false
      const sizes = [...node.sizes]
      const pairTotal = (sizes[handle] ?? 0) + (sizes[handle + 1] ?? 0)
      if (!(pairTotal > 0)) return false

      const minLeft = this.minPixels(node, handle, horizontal)
      const maxLeft = this.maxPixels(node, handle, horizontal)
      const minRight = this.minPixels(node, handle + 1, horizontal)
      const maxRight = this.maxPixels(node, handle + 1, horizontal)

      // ratio 是 sizes[handle] 的新值（0..1，相对整个 split）；相邻两项的总比例保持不变。
      let lower = Math.max(0, minLeft / total)
      let upper = Math.min(pairTotal, pairTotal - minRight / total)
      if (Number.isFinite(maxLeft)) upper = Math.min(upper, maxLeft / total)
      if (Number.isFinite(maxRight)) lower = Math.max(lower, pairTotal - maxRight / total)
      if (lower > upper) {
        const middle = (lower + upper) / 2
        lower = middle
        upper = middle
      }
      const desired = Math.min(1, Math.max(0, ratio))
      const nextLeft = Math.min(upper, Math.max(lower, desired))
      const nextSizes = [...sizes]
      nextSizes[handle] = nextLeft
      nextSizes[handle + 1] = pairTotal - nextLeft
      if (sameNumbers(nextSizes, sizes)) return false
      const nextSplit: SplitNode = { ...node, sizes: normalizeSizes(nextSizes) }
      const root = replaceNode(tree.root, node.id, nextSplit)
      if (!root) return false
      tree.root = root
      return true
    })
  }

  hidePanel(pageId: string, panel: PanelRef): void {
    this.mutate(pageId, 'hidePanel', (page) => {
      const tree = this.treeOf(page)
      const group = findPanelGroup(tree.root, panel)
      if (!group) {
        this.report('warning', `无法隐藏面板 ${panel.pluginId}:${panel.panelId}：不在当前布局里`)
        return false
      }
      const target = group.panels.find((item) => samePanel(item, panel))
      if (!target || !target.visible) return false
      const panels = group.panels.map((item) =>
        item.id === target.id ? { ...item, visible: false } : item,
      )
      const anyVisible = panels.some((item) => item.visible)
      const nextGroup: GroupNode = {
        ...group,
        panels,
        visible: anyVisible ? group.visible : false,
        collapsed: anyVisible ? group.collapsed : true,
      }
      const activePanelId = firstVisiblePanelId(panels)
      if (activePanelId !== undefined) nextGroup.activePanelId = activePanelId
      else delete nextGroup.activePanelId
      if (!anyVisible) {
        const geometry = this.distributeTree(tree.root, this.view, this.foldedGroupIds(pageId)).get(group.id)
        if (geometry) {
          const parent = findParentSplit(tree.root, group.id)
          const horizontal = parent ? parent.split.orientation === 'horizontal' : true
          nextGroup.lastSize = Math.round(horizontal ? geometry.width : geometry.height)
        }
      }
      const root = replaceNode(tree.root, group.id, nextGroup)
      if (!root) return false
      tree.root = root
      return true
    })
  }

  showPanel(pageId: string, panel: PanelRef): void {
    this.mutate(pageId, 'showPanel', (page) => {
      const tree = this.treeOf(page)
      const group = findPanelGroup(tree.root, panel)
      if (!group) {
        this.report('warning', `无法显示面板 ${panel.pluginId}:${panel.panelId}：不在当前布局里`)
        return false
      }
      const target = group.panels.find((item) => samePanel(item, panel))
      if (!target) {
        this.report('warning', `无法显示面板 ${panel.pluginId}:${panel.panelId}：节点缺失`)
        return false
      }
      if (target.visible && group.visible && !group.collapsed && group.activePanelId === target.id) return false
      const panels = group.panels.map((item) => (item.id === target.id ? { ...item, visible: true } : item))
      const nextGroup: GroupNode = {
        ...group,
        panels,
        visible: true,
        collapsed: false,
        activePanelId: target.id,
      }
      const root = replaceNode(tree.root, group.id, nextGroup)
      if (!root) return false
      tree.root = root
      return true
    })
  }

  /**
   * 把注册表里已注册、但当前布局中不存在的面板补进它声明的槽位 group。
   *
   * 为什么需要：布局在插件激活**之前**构建（04 轮启动顺序），因此新增面板不会自动进布局。
   * 本方法在激活后调用，只补缺失项，不动用户已有的排列、比例与活动标签。
   *
   * @returns 补进去的面板数量（0 表示布局已是最新）
   */
  ensureSlotPanels(pageId: string, panels: PanelSlotSource): number {
    let added = 0
    this.mutate(pageId, 'ensureSlotPanels', (page) => {
      const tree = this.treeOf(page)
      for (const slot of SLOT_IDS) {
        const registered = panels.bySlot(slot)
        if (registered.length === 0) {
          continue
        }
        const group = findGroup(tree.root, slot)
        if (!group) {
          continue
        }
        for (const entry of registered) {
          const ref: PanelRef = { pluginId: entry.pluginId, panelId: entry.contribution.panelId }
          if (findPanel(tree.root, ref) !== null) {
            continue
          }
          const node = createPanelNode(ref, mergePanelConstraint(ref.panelId, entry.contribution))
          const nextGroup: GroupNode = {
            ...group,
            panels: [...group.panels, node],
            activePanelId: group.activePanelId ?? node.id,
          }
          const root = replaceNode(tree.root, group.id, nextGroup)
          if (!root) {
            continue
          }
          tree.root = root
          added += 1
        }
      }
      return added > 0
    })
    return added
  }

  setActivePanel(pageId: string, groupId: string, panel: PanelRef): void {
    this.mutate(pageId, 'setActivePanel', (page) => {
      const tree = this.treeOf(page)
      const group = findGroup(tree.root, groupId)
      if (!group) {
        this.report('warning', `无法切换标签：group ${groupId} 不存在`)
        return false
      }
      const target = group.panels.find((item) => samePanel(item, panel))
      if (!target) {
        this.report('warning', `无法切换标签：面板 ${panel.pluginId}:${panel.panelId} 不在 group ${groupId}`)
        return false
      }
      if (group.activePanelId === target.id && !isDrawerGroupId(groupId)) return false
      const nextGroup: GroupNode = { ...group, panels: group.panels, activePanelId: target.id }
      // 抽屉 group 同时承载两套活动项：选面板就把 activeTabId 清掉，保证宿主只有一个活动来源。
      if (isDrawerGroupId(groupId)) delete nextGroup.activeTabId
      const root = replaceNode(tree.root, groupId, nextGroup)
      if (!root) return false
      tree.root = root
      return true
    })
  }

  setGroupState(pageId: string, groupId: string, patch: GroupStatePatch): void {
    this.mutate(pageId, 'setGroupState', (page) => {
      const tree = this.treeOf(page)
      const group = findGroup(tree.root, groupId)
      if (!group) {
        this.report('warning', `无法修改 group ${groupId}：不存在`)
        return false
      }
      const nextGroup: GroupNode = { ...group, panels: group.panels }
      let changed = false
      if (patch.visible !== undefined && patch.visible !== group.visible) {
        nextGroup.visible = patch.visible
        changed = true
      }
      if (patch.collapsed !== undefined && patch.collapsed !== group.collapsed) {
        nextGroup.collapsed = patch.collapsed
        changed = true
      }
      if (patch.activeTabId !== undefined && groupActiveTabId(group) !== patch.activeTabId) {
        assignGroupActiveTabId(nextGroup, patch.activeTabId)
        changed = true
      }
      if (patch.lastSize !== undefined) {
        const size = finitePositive(patch.lastSize)
        if (size === undefined) {
          this.report('warning', `忽略非法 group 尺寸 ${String(patch.lastSize)}`)
        } else {
          const clamped = isDrawerGroupId(groupId)
            ? Math.min(DRAWER_MAX_HEIGHT, Math.max(DRAWER_MIN_HEIGHT, Math.round(size)))
            : Math.round(size)
          if (clamped !== group.lastSize) {
            nextGroup.lastSize = clamped
            changed = true
          }
        }
      }
      if (!changed) return false
      if (isDrawerGroupId(groupId)) {
        // 抽屉里 activeTabId 与 activePanelId 互斥：选了 tab 就不再保留面板活动项。
        if (patch.activeTabId !== undefined) delete nextGroup.activePanelId
      } else {
        const repaired = repairGroupActivePanel(nextGroup)
        if (repaired.activePanelId !== nextGroup.activePanelId) {
          if (repaired.activePanelId === undefined) delete nextGroup.activePanelId
          else nextGroup.activePanelId = repaired.activePanelId
        }
      }
      const root = replaceNode(tree.root, groupId, nextGroup)
      if (!root) return false
      tree.root = root
      return true
    })
  }

  /**
   * 低窗降级：把包含抽屉 group 的 split 的主轴兄弟压到 `axisPx`，抽屉拉回 `lastSize`。
   *
   * 只改比例，不改可见性；首次挤压记下原比例供 `restoreAxis` 还原。
   */
  squeezeAxis(pageId: string, drawerGroupId: string, axisPx: number): void {
    const axis = finitePositive(axisPx)
    if (axis === undefined) {
      this.report('warning', `忽略非法主轴尺寸 ${String(axisPx)}`)
      return
    }
    this.mutate(pageId, 'squeezeAxis', (page) => {
      const tree = this.treeOf(page)
      const located = findParentSplit(tree.root, drawerGroupId)
      if (!located) {
        this.report('warning', `无法压低主轴：抽屉 group ${drawerGroupId} 不在 split 里`)
        return false
      }
      const horizontal = located.split.orientation === 'horizontal'
      const total = horizontal ? this.view.width : this.view.height
      if (!(total > 0)) return false
      const drawerGroup = located.split.children[located.index]
      const drawerPx =
        drawerGroup && drawerGroup.type === 'group' && drawerGroup.lastSize
          ? drawerGroup.lastSize
          : DEFAULT_DRAWER_HEIGHT
      const siblingIndex = located.index === 0 ? 1 : 0
      if (siblingIndex >= located.split.children.length) return false
      const sizes = [...located.split.sizes]
      const before = sizes.slice()
      const mainRatio = Math.min(0.9, Math.max(0.02, axis / total))
      const drawerRatio = Math.min(0.98 - mainRatio, Math.max(0, drawerPx / total))
      const restIndexes = located.split.children
        .map((_, index) => index)
        .filter((index) => index !== located.index && index !== siblingIndex)
      const restOld = restIndexes.reduce((sum, index) => sum + (sizes[index] ?? 0), 0)
      const restNew = Math.max(0, 1 - mainRatio - drawerRatio)
      sizes[siblingIndex] = mainRatio
      sizes[located.index] = drawerRatio
      for (const index of restIndexes) {
        sizes[index] = restOld > 0 ? ((sizes[index] ?? 0) / restOld) * restNew : restNew / restIndexes.length
      }
      const nextSizes = normalizeSizes(sizes)
      if (sameNumbers(nextSizes, located.split.sizes)) return false
      this.axisRecord = { pageId, splitId: located.split.id, sizes: before }
      const root = replaceNode(tree.root, located.split.id, { ...located.split, sizes: nextSizes })
      if (!root) return false
      tree.root = root
      return true
    })
  }

  /** 撤销低窗降级：按挤压前记录的比例还原；没有记录（或记录已被覆盖）时 no-op。 */
  restoreAxis(pageId: string): void {
    const record = this.axisRecord
    if (!record || record.pageId !== pageId) return
    this.axisRecord = null
    this.mutate(pageId, 'restoreAxis', (page) => {
      const tree = this.treeOf(page)
      const node = findNode(tree.root, record.splitId)
      if (!node || node.type !== 'split' || node.children.length !== record.sizes.length) return false
      const sizes = normalizeSizes(record.sizes)
      if (sameNumbers(sizes, node.sizes)) return false
      const root = replaceNode(tree.root, node.id, { ...node, sizes })
      if (!root) return false
      tree.root = root
      return true
    })
  }

  /**
   * 正常窗口展开抽屉：把抽屉在父 split 里的比例拉回 `lastSize` 对应像素，
   * 其余兄弟按原比例分摊剩余空间。只改比例，不改可见性；与 `squeezeAxis` 不同，
   * 这里不压主轴、也不记录还原快照。
   */
  expandDrawer(pageId: string, drawerGroupId: string): void {
    this.mutate(pageId, 'expandDrawer', (page) => {
      const tree = this.treeOf(page)
      const located = findParentSplit(tree.root, drawerGroupId)
      if (!located) {
        this.report('warning', `无法展开抽屉：抽屉 group ${drawerGroupId} 不在 split 里`)
        return false
      }
      const horizontal = located.split.orientation === 'horizontal'
      const total = horizontal ? this.view.width : this.view.height
      if (!(total > 0)) return false
      const drawerGroup = located.split.children[located.index]
      const drawerPx =
        drawerGroup && drawerGroup.type === 'group' && drawerGroup.lastSize
          ? drawerGroup.lastSize
          : DEFAULT_DRAWER_HEIGHT
      const sizes = [...located.split.sizes]
      const drawerRatio = Math.min(0.9, Math.max(0, drawerPx / total))
      const restIndexes = located.split.children
        .map((_, index) => index)
        .filter((index) => index !== located.index)
      const restOld = restIndexes.reduce((sum, index) => sum + (sizes[index] ?? 0), 0)
      const restNew = Math.max(0, 1 - drawerRatio)
      sizes[located.index] = drawerRatio
      for (const index of restIndexes) {
        sizes[index] = restOld > 0 ? ((sizes[index] ?? 0) / restOld) * restNew : restNew / restIndexes.length
      }
      const nextSizes = normalizeSizes(sizes)
      if (sameNumbers(nextSizes, located.split.sizes)) return false
      const root = replaceNode(tree.root, located.split.id, { ...located.split, sizes: nextSizes })
      if (!root) return false
      tree.root = root
      return true
    })
  }

  // ── 预设 ──────────────────────────────────────────────────────────────

  applyPreset(pageId: string, presetId: string): void {
    this.mutate(pageId, 'applyPreset', (page) => {
      if (!page.presets[presetId]) {
        if (!isPagePresetId(presetId)) {
          this.report('warning', `未知布局预设 ${presetId}`)
          return false
        }
        page.presets[presetId] = buildPresetTree(pageId, presetId, this.panels)
      }
      if (page.presetId === presetId) return false
      page.presetId = presetId
      return true
    })
  }

  savePreset(pageId: string, name: string): void {
    const presetName = name.trim()
    if (presetName.length === 0) {
      this.report('warning', '预设名不能为空')
      return
    }
    if (isPagePresetId(presetName)) {
      this.report('warning', `不能覆盖内置预设 ${presetName}`)
      return
    }
    this.mutate(pageId, 'savePreset', (page) => {
      const existing = page.presets[presetName]
      if (existing) {
        this.report('warning', `预设 ${presetName} 已存在，不能覆盖`)
        return false
      }
      page.presets[presetName] = cloneTree(this.treeOf(page))
      return true
    })
  }

  deletePreset(pageId: string, presetId: string): void {
    if (isPagePresetId(presetId)) {
      this.report('warning', `不能删除内置预设 ${presetId}`)
      return
    }
    this.mutate(pageId, 'deletePreset', (page) => {
      if (!page.presets[presetId]) {
        this.report('warning', `预设 ${presetId} 不存在`)
        return false
      }
      delete page.presets[presetId]
      if (page.presetId === presetId) page.presetId = 'default'
      return true
    })
  }

  presets(pageId: string): string[] {
    const page = this.workingPage(pageId)
    const user = Object.keys(page.presets)
      .filter((presetId) => !isPagePresetId(presetId))
      .sort()
    return [...PAGE_PRESETS, ...user]
  }

  resetLayout(pageId: string): void {
    this.mutate(pageId, 'resetLayout', (page) => {
      page.presets.default = this.defaultTree(pageId)
      page.presetId = 'default'
      return true
    })
  }

  removeMissingPanels(pageId: string): void {
    this.mutate(pageId, 'removeMissingPanels', (page) => {
      let changed = false
      for (const presetId of Object.keys(page.presets)) {
        const tree = page.presets[presetId]
        let root = tree.root
        for (const ref of collectPanelRefs(tree.root)) {
          if (this.isRegistered(ref)) continue
          const removed = removePanelNode(root, panelNodeId(ref))
          if (!removed) continue
          root = removed
          changed = true
        }
        if (root !== tree.root) tree.root = root
      }
      return changed
    })
  }

  removePanel(pageId: string, panel: PanelRef): void {
    this.mutate(pageId, 'removePanel', (page) => {
      let changed = false
      for (const presetId of Object.keys(page.presets)) {
        const tree = page.presets[presetId]
        if (!findPanel(tree.root, panel)) continue
        const removed = removePanelNode(tree.root, panelNodeId(panel))
        tree.root = removed ?? this.defaultTree(pageId).root
        changed = true
      }
      return changed
    })
  }

  // ── 事务与历史 ────────────────────────────────────────────────────────

  beginTransaction(pageId: string): LayoutTransaction {
    if (this.transaction) {
      this.report('warning', `丢弃未结束的布局事务（页 ${this.transaction.pageId}）`)
      this.transaction = null
    }
    const page = this.ensurePage(pageId)
    const state: TransactionState = {
      pageId,
      page: clonePage(page),
      snapshot: clonePage(page),
      closed: false,
    }
    this.transaction = state
    return {
      commit: () => this.commitTransaction(state),
      rollback: () => this.rollbackTransaction(state),
      tree: () => cloneTree(this.treeOf(state.page)),
    }
  }

  undo(pageId: string): void {
    if (this.transaction) {
      this.transaction = null
      this.notify()
    }
    const history = this.histories.get(pageId)
    if (!history || history.past.length === 0) return
    const current = clonePage(this.ensurePage(pageId))
    const previous = history.past.pop()
    if (!previous) return
    history.future.push(current)
    this.file.pages[pageId] = previous
    this.touch(pageId)
    this.notify()
  }

  redo(pageId: string): void {
    if (this.transaction) {
      this.transaction = null
      this.notify()
    }
    const history = this.histories.get(pageId)
    if (!history || history.future.length === 0) return
    const current = clonePage(this.ensurePage(pageId))
    const next = history.future.pop()
    if (!next) return
    history.past.push(current)
    if (history.past.length > LAYOUT_HISTORY_LIMIT) history.past.shift()
    this.file.pages[pageId] = next
    this.touch(pageId)
    this.notify()
  }

  canUndo(pageId: string): boolean {
    return (this.histories.get(pageId)?.past.length ?? 0) > 0
  }

  canRedo(pageId: string): boolean {
    return (this.histories.get(pageId)?.future.length ?? 0) > 0
  }

  // ── 载入与序列化 ──────────────────────────────────────────────────────

  load(text: string | null): void {
    let parsed: unknown = null
    let parseFailed = false
    if (text !== null) {
      try {
        parsed = JSON.parse(text) as unknown
      } catch {
        parseFailed = true
      }
    }
    const { file, result } = validateLayoutFile(parseFailed ? { version: 0 } : parsed, {
      pageIds: CORE_PAGE_IDS,
      panels: (ref) => this.isRegistered(ref),
      defaultTree: (pageId) => this.defaultTree(pageId),
    })
    this.file = file
    this.histories.clear()
    this.lastChangeAt.clear()
    this.transaction = null
    this.axisRecord = null
    if (parseFailed) this.report('error', 'layout.json 不是合法 JSON，已回退默认布局')
    this.reportValidation(result)
    this.notify()
  }

  serialize(): string {
    return serializeLayoutFile(this.file)
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  // ── 内部：页与树 ──────────────────────────────────────────────────────

  private newDefaultPage(pageId: string): PageLayout {
    return { presetId: 'default', presets: { default: this.defaultTree(pageId) } }
  }

  private defaultTree(pageId: string): LayoutTree {
    const custom = this.defaults?.(pageId)
    return custom ? cloneTree(custom) : buildDefaultTree(pageId, this.panels)
  }

  private ensurePage(pageId: string): PageLayout {
    const existing = this.file.pages[pageId]
    if (existing) return existing
    const created = this.newDefaultPage(pageId)
    this.file.pages[pageId] = created
    return created
  }

  private workingPage(pageId: string): PageLayout {
    if (this.transaction && this.transaction.pageId === pageId) return this.transaction.page
    return this.ensurePage(pageId)
  }

  private treeOf(page: PageLayout): LayoutTree {
    const tree = page.presets[page.presetId] ?? page.presets.default
    if (!tree) throw new Error(`布局页缺少 default 预设（presetId=${page.presetId}）`)
    return tree
  }

  private mutate(pageId: string, label: string, change: (page: PageLayout) => boolean): boolean {
    if (this.transaction && this.transaction.pageId !== pageId) {
      this.report(
        'warning',
        `布局事务正作用于页 ${this.transaction.pageId}，忽略对 ${pageId} 的 ${label}`,
      )
      return false
    }
    const page = this.workingPage(pageId)
    const snapshot = this.transaction ? null : clonePage(page)
    if (!change(page)) return false
    if (snapshot) this.pushHistory(pageId, snapshot)
    this.touch(pageId)
    this.notify()
    return true
  }

  private pushHistory(pageId: string, snapshot: PageLayout): void {
    const history = this.histories.get(pageId) ?? { past: [], future: [], lastChangeAt: 0 }
    history.past.push(snapshot)
    if (history.past.length > LAYOUT_HISTORY_LIMIT) history.past.shift()
    history.future.length = 0
    this.histories.set(pageId, history)
  }

  private touch(pageId: string): void {
    const at = this.now()
    this.lastChangeAt.set(pageId, at)
    const history = this.histories.get(pageId)
    if (history) history.lastChangeAt = at
  }

  private commitTransaction(state: TransactionState): void {
    if (state.closed) return
    state.closed = true
    if (this.transaction !== state) return
    this.transaction = null
    // 事务里可能留下空 group（splitGroup 之后没 movePanel）；提交时统一压缩。
    for (const presetId of Object.keys(state.page.presets)) {
      const tree = state.page.presets[presetId]
      const root = pruneEmptyGroups(tree.root, [DRAWER_GROUP_ID])
      if (root) tree.root = root
      else state.page.presets[presetId] = { root: this.defaultTree(state.pageId).root }
    }
    if (this.pageSignature(state.snapshot) === this.pageSignature(state.page)) {
      this.notify()
      return
    }
    this.file.pages[state.pageId] = state.page
    this.pushHistory(state.pageId, state.snapshot)
    this.touch(state.pageId)
    this.notify()
  }

  private rollbackTransaction(state: TransactionState): void {
    if (state.closed) return
    state.closed = true
    if (this.transaction !== state) return
    this.transaction = null
    this.notify()
  }

  private pageSignature(page: PageLayout): string {
    return serializeLayoutFile({ version: 1, currentPageId: 'document', pages: { page } })
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch (error) {
        this.report('error', `布局订阅者抛错：${String(error)}`)
      }
    }
  }

  private report(severity: DiagnosticSeverity, message: string, detail?: string): void {
    const input: DiagnosticInput = { severity, source: 'layout', message }
    if (detail !== undefined) input.detail = detail
    this.diagnostics.report(input)
  }

  private reportValidation(result: LayoutValidationResult): void {
    for (const message of result.messages) {
      this.report(result.reverted ? 'warning' : 'info', message)
    }
    if (result.reverted) this.report('warning', '布局已恢复默认；主题、快捷键、窗口与草稿未受影响')
    if (result.missing.length > 0) {
      this.report(
        'info',
        `有 ${result.missing.length} 个面板未注册，布局保留占位`,
        result.missing.map((ref) => `${ref.pluginId}:${ref.panelId}`).join(', '),
      )
    }
  }

  // ── 内部：像素计算 ────────────────────────────────────────────────────

  private computeLayout(pageId: string): ComputedLayout {
    const page = this.workingPage(pageId)
    const tree = this.treeOf(page)
    const viewport = { ...this.view }
    const folded: string[] = []

    const drawer = findGroup(tree.root, DRAWER_GROUP_ID)
    if (drawer && drawer.visible && !drawer.collapsed && viewport.height < LOW_HEIGHT) {
      folded.push(drawer.id)
    }

    for (let pass = 0; pass < 4; pass += 1) {
      const nodes = this.distributeTree(tree.root, viewport, folded)
      const candidate = this.findFoldCandidate(tree.root, nodes, folded)
      if (candidate === null) {
        return {
          pageId,
          viewport,
          nodes: [...nodes.values()],
          foldedGroupIds: folded,
          message: folded.length > 0 ? '窗口过小：已折叠部分面板，放大窗口后自动恢复' : null,
        }
      }
      folded.push(candidate)
    }

    const nodes = this.distributeTree(tree.root, viewport, folded)
    return {
      pageId,
      viewport,
      nodes: [...nodes.values()],
      foldedGroupIds: folded,
      message: folded.length > 0 ? '窗口过小：已折叠部分面板，放大窗口后自动恢复' : null,
    }
  }

  private foldedGroupIds(pageId: string): readonly string[] {
    return this.computeLayout(pageId).foldedGroupIds
  }

  private distributeTree(
    root: LayoutNode,
    viewport: Viewport,
    folded: readonly string[],
  ): Map<string, ComputedNode> {
    const nodes = new Map<string, ComputedNode>()
    this.distributeNode(root, viewport.width, viewport.height, nodes, folded)
    return nodes
  }

  private distributeNode(
    node: LayoutNode,
    width: number,
    height: number,
    nodes: Map<string, ComputedNode>,
    folded: readonly string[],
  ): void {
    if (node.type === 'group') {
      nodes.set(node.id, {
        id: node.id,
        width: roundPixels(width),
        height: roundPixels(height),
        visible: node.visible,
        collapsed: node.collapsed,
      })
      return
    }
    nodes.set(node.id, {
      id: node.id,
      width: roundPixels(width),
      height: roundPixels(height),
      visible: true,
      collapsed: false,
    })
    const horizontal = node.orientation === 'horizontal'
    const total = roundPixels(horizontal ? width : height)
    const active = node.children.map(
      (child) => this.childOccupiesSpace(child) && !folded.includes(child.id),
    )
    const activeIndexes = node.children
      .map((_, index) => index)
      .filter((index) => active[index])
    const pixels = fitAxis(
      total,
      activeIndexes.map((index) => node.sizes[index] ?? 1),
      activeIndexes.map((index) =>
        Math.max(node.minSizes?.[index] ?? 0, this.nodeMinSize(node.children[index], horizontal)),
      ),
      activeIndexes.map((index) => this.nodeMaxSize(node.children[index], horizontal)),
    )
    const sizeByIndex = new Map<number, number>()
    activeIndexes.forEach((childIndex, position) => {
      sizeByIndex.set(childIndex, roundPixels(pixels[position] ?? 0))
    })
    node.children.forEach((child, index) => {
      const size = sizeByIndex.get(index) ?? 0
      this.distributeNode(
        child,
        horizontal ? size : width,
        horizontal ? height : size,
        nodes,
        folded,
      )
    })
  }

  private childOccupiesSpace(child: LayoutNode): boolean {
    if (child.type === 'split') return true
    if (!child.visible || child.collapsed) return false
    if (isDrawerGroupId(child.id)) return true
    return child.panels.some((panel) => panel.visible)
  }

  private nodeMinSize(node: LayoutNode, horizontal: boolean): number {
    if (node.type === 'split') return 0
    if (isDrawerGroupId(node.id)) return horizontal ? 0 : DRAWER_MIN_HEIGHT
    if (!node.visible || node.collapsed) return 0
    let min = 0
    for (const panel of node.panels) {
      if (!panel.visible) continue
      const value = horizontal ? panel.minWidth ?? 0 : panel.minHeight ?? 0
      min = Math.max(min, value)
    }
    return min
  }

  private nodeMaxSize(node: LayoutNode, horizontal: boolean): number {
    if (node.type === 'split') return Infinity
    let max = Infinity
    for (const panel of node.panels) {
      if (!panel.visible) continue
      const value = horizontal ? panel.maxWidth : panel.maxHeight
      if (value !== undefined) max = Math.min(max, value)
    }
    return max
  }

  private minPixels(split: SplitNode, index: number, horizontal: boolean): number {
    const child = split.children[index]
    if (!child || !this.childOccupiesSpace(child)) return 0
    return Math.max(split.minSizes?.[index] ?? 0, this.nodeMinSize(child, horizontal))
  }

  private maxPixels(split: SplitNode, index: number, horizontal: boolean): number {
    const child = split.children[index]
    if (!child || !this.childOccupiesSpace(child)) return 0
    return this.nodeMaxSize(child, horizontal)
  }

  private findFoldCandidate(
    root: LayoutNode,
    nodes: Map<string, ComputedNode>,
    folded: readonly string[],
  ): string | null {
    let candidate: string | null = null
    walkTree(root, (node) => {
      if (node.type !== 'group') return true
      if (!node.visible || node.collapsed) return true
      if (folded.includes(node.id)) return true
      if (!node.panels.some((panel) => panel.visible)) return true
      const minWidth = this.nodeMinSize(node, true)
      const geometry = nodes.get(node.id)
      if (minWidth <= 0 || !geometry) return true
      if (geometry.width < minWidth) candidate = node.id
      return true
    })
    return candidate
  }
}

/** 抽屉高度上下限（宿主设置 `lastSize` 时的夹取范围），复述给抽屉容器使用。 */
export const DRAWER_SIZE_LIMITS = { min: DRAWER_MIN_HEIGHT, max: DRAWER_MAX_HEIGHT } as const
