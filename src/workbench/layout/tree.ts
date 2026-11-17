/**
 * 布局树纯函数（04-02）。
 *
 * 树是工作区唯一尺寸来源；外壳只渲染 `getTree`，写入一律走 `LayoutService`。
 * 这里的函数不就地改写调用方持有的节点：`removePanelNode` / `replaceNode` / `pruneEmptyGroups`
 * 都用结构共享返回新根，事务快照与撤销历史因此不会被别名悄悄改掉。
 */
import type {
  GroupNode,
  LayoutFile,
  LayoutNode,
  LayoutTree,
  PageLayout,
  PanelNode,
  SplitNode,
} from '../api/layout.ts'
import type { Orientation, PanelRef } from '../api/ids.ts'
import { CORE_PAGE_IDS, panelNodeId, samePanel } from '../api/ids.ts'

/** 抽屉 group 的固定 id（04-06）；它由 drawerTab 注册表供内容，布局里可以是空 group。 */
export const DRAWER_GROUP_ID = 'document.drawer'

/** 抽屉默认高度（像素，04-06 的 200–420 区间的中值）。 */
export const DEFAULT_DRAWER_HEIGHT = 280

/** 抽屉高度下限 / 上限（04-06）。 */
export const DRAWER_MIN_HEIGHT = 200

export const DRAWER_MAX_HEIGHT = 420

/** 底部面板组（主时间轴）最小高度（04-02）。 */
export const BOTTOM_MIN_HEIGHT = 160

/** 是否为抽屉容器 group：允许空 panels，压缩时不得删除。 */
export function isDrawerGroupId(id: string): boolean {
  return id === DRAWER_GROUP_ID
}

/** 面板节点创建参数。 */
export interface CreatePanelOptions {
  visible?: boolean
  collapsed?: boolean
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
}

/** group 创建参数。 */
export interface CreateGroupOptions {
  visible?: boolean
  collapsed?: boolean
  activePanelId?: string
  activeTabId?: string
  lastSize?: number
}

/**
 * 抽屉 group 的活动 tab 是 `tabId`（`demo.drawer.notes` 形态），与 panel 的 `activePanelId` 语义分开：
 * 抽屉内容来自 `drawerTab` 注册表，`panels` 里可以没有对应节点。
 */

/** 读抽屉 group 的活动 tab（不要求 `panels` 里存在该 tab）。 */
export function groupActiveTabId(group: GroupNode): string | undefined {
  return group.activeTabId
}

/** 写抽屉 group 的活动 tab；传 `undefined` 表示清除。 */
export function assignGroupActiveTabId(group: GroupNode, tabId: string | undefined): void {
  if (tabId === undefined) delete group.activeTabId
  else group.activeTabId = tabId
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function optionalPositive(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const rounded = Math.max(0, Math.round(value))
  return rounded
}

/** 第一个可见面板的节点 id（group 的活动标签回退）。 */
export function firstVisiblePanelId(panels: readonly PanelNode[]): string | undefined {
  return panels.find((panel) => panel.visible)?.id ?? panels[0]?.id
}

/** 面板节点：`id` 由 `pluginId + panelId` 派生，不接受外部传入，避免出现两套身份。 */
export function createPanelNode(ref: PanelRef, options: CreatePanelOptions = {}): PanelNode {
  const node: PanelNode = {
    type: 'panel',
    id: panelNodeId(ref),
    pluginId: ref.pluginId,
    panelId: ref.panelId,
    visible: options.visible ?? true,
  }
  if (options.collapsed !== undefined) node.collapsed = options.collapsed
  const minWidth = optionalPositive(options.minWidth)
  const maxWidth = optionalPositive(options.maxWidth)
  const minHeight = optionalPositive(options.minHeight)
  const maxHeight = optionalPositive(options.maxHeight)
  if (minWidth !== undefined) node.minWidth = minWidth
  if (maxWidth !== undefined) node.maxWidth = maxWidth
  if (minHeight !== undefined) node.minHeight = minHeight
  if (maxHeight !== undefined) node.maxHeight = maxHeight
  return node
}

/** 组节点：`activePanelId` 缺省取第一个可见面板，符合 04-02 的加载回退规则。 */
export function createGroup(
  id: string,
  panels: readonly PanelNode[],
  options: CreateGroupOptions = {},
): GroupNode {
  const group: GroupNode = {
    type: 'group',
    id,
    panels: panels.map(clonePanelNode),
    visible: options.visible ?? true,
    collapsed: options.collapsed ?? false,
  }
  const activePanelId = options.activePanelId ?? firstVisiblePanelId(group.panels)
  if (activePanelId !== undefined) group.activePanelId = activePanelId
  if (options.activeTabId !== undefined) assignGroupActiveTabId(group, options.activeTabId)
  if (options.lastSize !== undefined) group.lastSize = options.lastSize
  return group
}

/** 分割节点：`sizes` 一律归一；缺省均分，保证“和为 1”的模型不变式。 */
export function createSplit(
  id: string,
  orientation: Orientation,
  children: readonly LayoutNode[],
  sizes?: readonly number[],
  minSizes?: readonly number[],
): SplitNode {
  const node: SplitNode = {
    type: 'split',
    id,
    orientation,
    children: children.map(cloneNode),
    sizes: normalizeSizes(sizes && sizes.length === children.length ? sizes : children.map(() => 1)),
  }
  if (minSizes && minSizes.length === children.length) {
    node.minSizes = minSizes.map((value) => Math.max(0, finiteOr(value, 0)))
  }
  return node
}

export function clonePanelNode(panel: PanelNode): PanelNode {
  const copy: PanelNode = {
    type: 'panel',
    id: panel.id,
    pluginId: panel.pluginId,
    panelId: panel.panelId,
    visible: panel.visible,
  }
  if (panel.collapsed !== undefined) copy.collapsed = panel.collapsed
  if (panel.minWidth !== undefined) copy.minWidth = panel.minWidth
  if (panel.maxWidth !== undefined) copy.maxWidth = panel.maxWidth
  if (panel.minHeight !== undefined) copy.minHeight = panel.minHeight
  if (panel.maxHeight !== undefined) copy.maxHeight = panel.maxHeight
  return copy
}

/** 深拷贝一个树节点（split / group）；面板节点用 `clonePanelNode`。 */
export function cloneNode(node: LayoutNode): LayoutNode {
  if (node.type === 'group') {
    const group: GroupNode = {
      type: 'group',
      id: node.id,
      panels: node.panels.map(clonePanelNode),
      visible: node.visible,
      collapsed: node.collapsed,
    }
    if (node.activePanelId !== undefined) group.activePanelId = node.activePanelId
    const activeTabId = groupActiveTabId(node)
    if (activeTabId !== undefined) assignGroupActiveTabId(group, activeTabId)
    if (node.lastSize !== undefined) group.lastSize = node.lastSize
    return group
  }
  return createSplit(node.id, node.orientation, node.children, node.sizes, node.minSizes)
}

/** 深拷贝整棵树。 */
export function cloneTree(tree: LayoutTree): LayoutTree {
  return { root: cloneNode(tree.root) }
}

/** 前序遍历；`visit` 返回 `false` 时跳过该节点的子树。 */
export function walkTree(
  node: LayoutNode,
  visit: (node: LayoutNode, depth: number) => void | boolean,
  depth = 0,
): void {
  if (visit(node, depth) === false) return
  if (node.type !== 'split') return
  for (const child of node.children) walkTree(child, visit, depth + 1)
}

/** 按 id 找 split / group / panel 节点。 */
export function findNode(root: LayoutNode, id: string): LayoutNode | PanelNode | null {
  let found: LayoutNode | PanelNode | null = null
  walkTree(root, (node) => {
    if (found) return false
    if (node.id === id) {
      found = node
      return false
    }
    if (node.type === 'group') {
      const panel = node.panels.find((item) => item.id === id)
      if (panel) {
        found = panel
        return false
      }
    }
    return true
  })
  return found
}

/** 按 id 找 group。 */
export function findGroup(root: LayoutNode, groupId: string): GroupNode | null {
  const node = findNode(root, groupId)
  return node && node.type === 'group' ? node : null
}

/** 按 `{ pluginId, panelId }` 找面板节点。 */
export function findPanel(root: LayoutNode, ref: PanelRef): PanelNode | null {
  const id = panelNodeId(ref)
  let found: PanelNode | null = null
  walkTree(root, (node) => {
    if (found) return false
    if (node.type !== 'group') return true
    const panel = node.panels.find((item) => item.id === id || samePanel(item, ref))
    if (panel) {
      found = panel
      return false
    }
    return true
  })
  return found
}

/** 面板节点所在的 group。 */
export function findPanelGroup(root: LayoutNode, ref: PanelRef): GroupNode | null {
  const id = panelNodeId(ref)
  let found: GroupNode | null = null
  walkTree(root, (node) => {
    if (found) return false
    if (node.type !== 'group') return true
    if (node.panels.some((panel) => panel.id === id || samePanel(panel, ref))) {
      found = node
      return false
    }
    return true
  })
  return found
}

/** 所有 group，按树内顺序。 */
export function collectGroups(root: LayoutNode): GroupNode[] {
  const groups: GroupNode[] = []
  walkTree(root, (node) => {
    if (node.type === 'group') groups.push(node)
  })
  return groups
}

/** 所有面板引用，按树内顺序。 */
export function collectPanelRefs(root: LayoutNode): PanelRef[] {
  const refs: PanelRef[] = []
  walkTree(root, (node) => {
    if (node.type !== 'group') return
    for (const panel of node.panels) refs.push({ pluginId: panel.pluginId, panelId: panel.panelId })
  })
  return refs
}

/**
 * 归一分割比例。
 *
 * 非有限值 / 负数 / 总和为 0 视为不可用，直接均分；正常值按总和缩放。
 * 最后一项用“1 减前面之和”收口，避免浮点误差让 `sum !== 1`。
 */
export function normalizeSizes(sizes: readonly number[]): number[] {
  const count = sizes.length
  if (count === 0) return []
  if (count === 1) return [1]
  const usable = sizes.every((value) => Number.isFinite(value) && value >= 0)
  const total = usable ? sizes.reduce((sum, value) => sum + value, 0) : 0
  if (!usable || total <= 0) {
    const even = sizes.map(() => 1 / count)
    even[count - 1] = 1 - even.slice(0, count - 1).reduce((sum, value) => sum + value, 0)
    return even
  }
  const scaled = sizes.map((value) => value / total)
  const head = scaled.slice(0, count - 1)
  scaled[count - 1] = 1 - head.reduce((sum, value) => sum + value, 0)
  return scaled
}

/** 让 group 的活动面板指向仍然存在的面板（空 panels 时保留抽屉的 `activeTabId`）。 */
export function repairGroupActivePanel(group: GroupNode): GroupNode {
  if (group.panels.length === 0) return group
  if (group.activePanelId && group.panels.some((panel) => panel.id === group.activePanelId)) return group
  const next = firstVisiblePanelId(group.panels)
  const repaired: GroupNode = { ...group, panels: group.panels }
  if (next === undefined) delete repaired.activePanelId
  else repaired.activePanelId = next
  return repaired
}

interface RewriteResult {
  node: LayoutNode | null
  changed: boolean
}

/** 摘掉子节点后重建 split：落单子节点退化为它本身，比例按保留下来的子节点归一。 */
function rebuildSplit(
  split: SplitNode,
  nextChildren: LayoutNode[],
  keptIndexes: readonly number[],
  changed: boolean,
): RewriteResult {
  if (!changed && nextChildren.length === split.children.length) return { node: split, changed: false }
  if (nextChildren.length === 0) return { node: null, changed: true }
  if (nextChildren.length === 1) return { node: nextChildren[0] as LayoutNode, changed: true }
  const sizes = normalizeSizes(keptIndexes.map((index) => split.sizes[index] ?? 0))
  const rebuilt: SplitNode = {
    type: 'split',
    id: split.id,
    orientation: split.orientation,
    children: nextChildren,
    sizes,
  }
  if (split.minSizes) {
    rebuilt.minSizes = keptIndexes.map((index) => Math.max(0, finiteOr(split.minSizes?.[index], 0)))
  }
  return { node: rebuilt, changed: true }
}

/** 删除一个面板节点；空 group / 单子 split 按 04-02 的压缩规则收拾。抽屉容器保留。 */
export function removePanelNode(
  root: LayoutNode,
  panelNodeIdToRemove: string,
  keepEmpty: readonly string[] = [DRAWER_GROUP_ID],
): LayoutNode | null {
  const removed = pruneNode(root, (node) => {
    if (node.type !== 'group') return null
    if (!node.panels.some((panel) => panel.id === panelNodeIdToRemove)) return null
    return { ...node, panels: node.panels.filter((panel) => panel.id !== panelNodeIdToRemove) }
  })
  return removed ? pruneEmptyGroups(removed, keepEmpty) : null
}

/** 用 `next` 替换 id 匹配的 split / group（面板节点不在这里替换，移动面板走 `movePanel`）。 */
export function replaceNode(root: LayoutNode, id: string, next: LayoutNode): LayoutNode | null {
  return pruneNode(root, (node) => (node.id === id ? next : null))
}

/**
 * 删除满足条件的子节点并压缩。
 *
 * `rewrite` 返回新节点表示替换，返回 `null` 表示保持原样。
 */
function pruneNode(
  root: LayoutNode,
  rewrite: (node: LayoutNode) => LayoutNode | null,
): LayoutNode | null {
  const rewritten = rewrite(root)
  if (rewritten) return rewritten
  if (root.type === 'group') return root
  const nextChildren: LayoutNode[] = []
  const keptIndexes: number[] = []
  let changed = false
  root.children.forEach((child, index) => {
    const next = pruneNode(child, rewrite)
    if (next === child) {
      nextChildren.push(child)
      keptIndexes.push(index)
      return
    }
    changed = true
    if (next) {
      nextChildren.push(next)
      keptIndexes.push(index)
    }
  })
  return rebuildSplit(root, nextChildren, keptIndexes, changed).node
}

/**
 * 压缩空 group 与退化 split。
 *
 * `keepEmpty` 里的 group（抽屉容器）即使没有面板也保留：它的内容来自 drawerTab 注册表，
 * 删掉会让抽屉无法恢复。
 */
export function pruneEmptyGroups(root: LayoutNode, keepEmpty: readonly string[] = []): LayoutNode | null {
  if (root.type === 'group') {
    if (root.panels.length === 0 && !keepEmpty.includes(root.id)) return null
    return repairGroupActivePanel(root)
  }
  const nextChildren: LayoutNode[] = []
  const keptIndexes: number[] = []
  let changed = false
  root.children.forEach((child, index) => {
    const next = pruneEmptyGroups(child, keepEmpty)
    if (next === child) {
      nextChildren.push(child)
      keptIndexes.push(index)
      return
    }
    changed = true
    if (next) {
      nextChildren.push(next)
      keptIndexes.push(index)
    }
  })
  return rebuildSplit(root, nextChildren, keptIndexes, changed).node
}

/** 生成树内唯一的节点 id：`base`、`base2`、`base3`…… */
export function uniqueNodeId(root: LayoutNode, base: string): string {
  if (!findNode(root, base)) return base
  let suffix = 2
  while (findNode(root, `${base}${suffix}`)) suffix += 1
  return `${base}${suffix}`
}

/** 该 split 是否有可见子节点（隐藏组不占空间）。 */
export function splitChildVisible(child: LayoutNode): boolean {
  if (child.type === 'group') return child.visible && (child.panels.length === 0 || child.panels.some((panel) => panel.visible))
  return true
}

/**
 * 稳定序列化布局文件。
 *
 * 持久化要能按字节比较是否变化，所以键序固定（对象字面量顺序 + 页/预设显式排序），
 * 缩进 2 空格；`undefined` 字段直接省略，不写 `null`。
 */
export function serializeLayoutFile(file: LayoutFile): string {
  const pageIds = orderedKeys(file.pages)
  const pages: Record<string, unknown> = {}
  for (const pageId of pageIds) {
    pages[pageId] = serializePage(file.pages[pageId] as PageLayout)
  }
  return JSON.stringify({ version: file.version, currentPageId: file.currentPageId, pages }, null, 2)
}

/** 页顺序：核心页按 04-04 固定顺序，其余按字典序。 */
export function orderedKeys(record: Record<string, unknown>): string[] {
  const keys = Object.keys(record)
  const core = CORE_PAGE_IDS.filter((pageId) => keys.includes(pageId))
  const rest = keys.filter((key) => !(CORE_PAGE_IDS as readonly string[]).includes(key)).sort()
  return [...core, ...rest]
}

function serializePage(page: PageLayout): unknown {
  const presetIds = Object.keys(page.presets).sort((left, right) => {
    if (left === 'default') return -1
    if (right === 'default') return 1
    return left.localeCompare(right)
  })
  const presets: Record<string, unknown> = {}
  for (const presetId of presetIds) {
    const tree = page.presets[presetId]
    presets[presetId] = { root: serializeNode(tree.root) }
  }
  return { presetId: page.presetId, presets }
}

function serializeNode(node: LayoutNode | PanelNode): unknown {
  if (node.type === 'panel') {
    const panel: Record<string, unknown> = {
      type: 'panel',
      id: node.id,
      pluginId: node.pluginId,
      panelId: node.panelId,
      visible: node.visible,
    }
    if (node.collapsed !== undefined) panel.collapsed = node.collapsed
    if (node.minWidth !== undefined) panel.minWidth = node.minWidth
    if (node.maxWidth !== undefined) panel.maxWidth = node.maxWidth
    if (node.minHeight !== undefined) panel.minHeight = node.minHeight
    if (node.maxHeight !== undefined) panel.maxHeight = node.maxHeight
    return panel
  }
  if (node.type === 'group') {
    const group: Record<string, unknown> = {
      type: 'group',
      id: node.id,
      panels: node.panels.map(serializeNode),
    }
    if (node.activePanelId !== undefined) group.activePanelId = node.activePanelId
    const activeTabId = groupActiveTabId(node)
    if (activeTabId !== undefined) group.activeTabId = activeTabId
    group.visible = node.visible
    group.collapsed = node.collapsed
    if (node.lastSize !== undefined) group.lastSize = node.lastSize
    return group
  }
  const split: Record<string, unknown> = {
    type: 'split',
    id: node.id,
    orientation: node.orientation,
    children: node.children.map(serializeNode),
    sizes: node.sizes.map(roundRatio),
  }
  if (node.minSizes) split.minSizes = node.minSizes.map((value) => Math.max(0, Math.round(value)))
  return split
}

/** 比例保留 6 位小数，避免浮点尾巴让同一布局序列化出两种字节。 */
function roundRatio(value: number): number {
  const rounded = Math.round(value * 1e6) / 1e6
  return Number.isFinite(rounded) ? rounded : 0
}
