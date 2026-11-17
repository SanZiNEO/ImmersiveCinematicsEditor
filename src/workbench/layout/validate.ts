/**
 * 布局文件校验与回退（04-02）。
 *
 * 校验只修布局本身：坏页回默认、坏预设丢弃、未知面板保留占位、重复面板只留第一个。
 * 它不碰主题 / 快捷键 / 窗口 / 草稿——布局损坏不能让用户的其它偏好一起回退。
 */
import type {
  GroupNode,
  LayoutFile,
  LayoutNode,
  LayoutTree,
  LayoutValidationResult,
  PageLayout,
  PanelNode,
  SplitNode,
} from '../api/layout.ts'
import type { PanelRef } from '../api/ids.ts'
import { CORE_PAGE_IDS, PANEL_ID_PATTERN, PLUGIN_ID_PATTERN, panelNodeId } from '../api/ids.ts'
import { buildDefaultTree, panelSizeConstraint } from './defaultLayouts.ts'
import {
  assignGroupActiveTabId,
  DRAWER_GROUP_ID,
  isDrawerGroupId,
  normalizeSizes,
  pruneEmptyGroups,
  repairGroupActivePanel,
} from './tree.ts'

/** 防御性上限：手改文件塞进超大 / 超深树时按损坏处理，不做无界递归。 */
const MAX_TREE_DEPTH = 32

const MAX_TREE_NODES = 4000

/** 校验入参。 */
export interface ValidateLayoutOptions {
  /** 必须存在的页（核心页）；文件里多出来的页会被保留。 */
  pageIds: readonly string[]
  /** 面板是否已注册；返回 false 时保留节点并标记 `missing`。 */
  panels: (ref: PanelRef) => boolean
  /** 页级回退树；缺省用内置默认树（含核心槽位兜底）。 */
  defaultTree?: (pageId: string) => LayoutTree
}

/** 校验产物：可用的布局文件 + 校验结果（诊断 / 状态区消费）。 */
export interface ValidatedLayout {
  file: LayoutFile
  result: LayoutValidationResult
}

interface SanitizeState {
  /** 共享节点预算：递归分支都要计入，避免超大树绕过上限。 */
  nodes: { count: number }
  ids: Set<string>
  /** 当前预设树里已出现的面板 ref key（同页同面板只留第一个）。 */
  seenPanels: Set<string>
}

interface ValidateContext {
  options: ValidateLayoutOptions
  messages: string[]
  missing: Map<string, PanelRef>
  duplicates: Map<string, PanelRef>
  defaultPage(pageId: string): PageLayout
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function positiveNumber(value: unknown): number | undefined {
  const parsed = finiteNumber(value)
  return parsed !== undefined && parsed > 0 ? parsed : undefined
}

function refKey(ref: PanelRef): string {
  return `${ref.pluginId}:${ref.panelId}`
}

function defaultPageFor(pageId: string, options: ValidateLayoutOptions): PageLayout {
  const tree = options.defaultTree?.(pageId) ?? buildDefaultTree(pageId)
  return { presetId: 'default', presets: { default: tree } }
}

/**
 * 校验一个布局文件。
 *
 * `null / undefined` 表示“还没有布局文件”，走默认文件但不算回退；
 * 其余不可识别输入（版本不对、pages 非对象）按损坏处理并置 `reverted`。
 */
export function validateLayoutFile(input: unknown, options: ValidateLayoutOptions): ValidatedLayout {
  const requiredPages =
    options.pageIds.length > 0 ? [...options.pageIds] : [...CORE_PAGE_IDS]
  const context: ValidateContext = {
    options,
    messages: [],
    missing: new Map(),
    duplicates: new Map(),
    defaultPage: (pageId) => defaultPageFor(pageId, options),
  }

  if (input === null || input === undefined) {
    return {
      file: buildFile(requiredPages, context.defaultPage, undefined),
      result: { ok: true, reverted: false, missing: [], duplicates: [], messages: [] },
    }
  }

  const raw = asRecord(input)
  if (!raw || raw.version !== 1) {
    return {
      file: buildFile(requiredPages, context.defaultPage, undefined),
      result: {
        ok: false,
        reverted: true,
        missing: [],
        duplicates: [],
        messages: [
          raw
            ? `布局文件版本 ${String(raw.version)} 不受支持，已回退默认布局`
            : '布局文件结构不可识别，已回退默认布局',
        ],
      },
    }
  }

  const rawPages = asRecord(raw.pages)
  if (!rawPages) {
    return {
      file: buildFile(requiredPages, context.defaultPage, undefined),
      result: {
        ok: false,
        reverted: true,
        missing: [],
        duplicates: [],
        messages: ['布局文件缺少 pages，已回退默认布局'],
      },
    }
  }

  const extraPages = Object.keys(rawPages)
    .filter((pageId) => !requiredPages.includes(pageId))
    .sort()
  const pages: Record<string, PageLayout> = {}
  let reverted = false

  for (const pageId of [...requiredPages, ...extraPages]) {
    const rawPage = rawPages[pageId]
    if (rawPage === undefined) {
      pages[pageId] = context.defaultPage(pageId)
      context.messages.push(`缺少页 ${pageId}，已补默认布局`)
      continue
    }
    const page = sanitizePage(pageId, rawPage, context)
    if (page) {
      pages[pageId] = page
      continue
    }
    pages[pageId] = context.defaultPage(pageId)
    reverted = true
    context.messages.push(`页 ${pageId} 的布局不可用（环 / 比例 / 子节点不足），已回退默认布局`)
  }

  const currentPageId =
    typeof raw.currentPageId === 'string' && pages[raw.currentPageId]
      ? raw.currentPageId
      : requiredPages[0] ?? CORE_PAGE_IDS[0]

  return {
    file: { version: 1, currentPageId, pages },
    result: {
      ok: !reverted && context.duplicates.size === 0,
      reverted,
      missing: [...context.missing.values()],
      duplicates: [...context.duplicates.values()],
      messages: context.messages,
    },
  }
}

function buildFile(
  pageIds: readonly string[],
  defaultPage: (pageId: string) => PageLayout,
  currentPageId: string | undefined,
): LayoutFile {
  const pages: Record<string, PageLayout> = {}
  for (const pageId of pageIds) pages[pageId] = defaultPage(pageId)
  return {
    version: 1,
    currentPageId: currentPageId ?? pageIds[0] ?? CORE_PAGE_IDS[0],
    pages,
  }
}

function sanitizePage(pageId: string, input: unknown, context: ValidateContext): PageLayout | null {
  const record = asRecord(input)
  if (!record) return null
  const rawPresets = asRecord(record.presets)
  if (!rawPresets) return null

  const presets: Record<string, LayoutTree> = {}
  const invalidPresets: string[] = []

  for (const presetId of Object.keys(rawPresets).sort()) {
    if (presetId === 'default' && presets.default) continue
    const state: SanitizeState = {
      nodes: { count: 0 },
      ids: new Set(),
      seenPanels: new Set(),
    }
    const tree = sanitizeTree(rawPresets[presetId], pageId, state, context)
    if (tree) presets[presetId] = tree
    else invalidPresets.push(presetId)
  }

  for (const presetId of invalidPresets) {
    if (presetId === 'default') return null
    context.messages.push(`页 ${pageId} 的预设 ${presetId} 不可用，已丢弃`)
  }

  if (!presets.default) {
    presets.default = context.options.defaultTree?.(pageId) ?? buildDefaultTree(pageId)
    context.messages.push(`页 ${pageId} 缺少 default 预设，已补默认布局`)
  }

  let presetId = typeof record.presetId === 'string' && record.presetId.length > 0 ? record.presetId : 'default'
  if (!presets[presetId]) {
    context.messages.push(`页 ${pageId} 的活动预设 ${presetId} 不可用，已切回 default`)
    presetId = 'default'
  }
  return { presetId, presets }
}

function sanitizeTree(
  input: unknown,
  pageId: string,
  state: SanitizeState,
  context: ValidateContext,
): LayoutTree | null {
  // 预设的形状是 `{ root }`；只把 root 交给节点校验，避免把包装对象当节点。
  const record = asRecord(input)
  if (!record) return null
  const root = sanitizeNode(record.root, pageId, state, context, 0)
  if (!root) return null
  // 重复面板被移除后可能出现空 group / 单子 split；这里按压缩规则收拾，
  // 抽屉容器例外：它的内容来自 drawerTab 注册表，空 panels 是合法状态。
  const pruned = pruneEmptyGroups(root, [DRAWER_GROUP_ID])
  if (!pruned) return null
  return { root: pruned }
}

function sanitizeNode(
  input: unknown,
  pageId: string,
  state: SanitizeState,
  context: ValidateContext,
  depth: number,
): LayoutNode | null {
  if (depth > MAX_TREE_DEPTH) return null
  state.nodes.count += 1
  if (state.nodes.count > MAX_TREE_NODES) return null
  const record = asRecord(input)
  if (!record) return null
  if (record.type === 'group') return sanitizeGroup(record, pageId, state, context)
  if (record.type === 'split') return sanitizeSplit(record, pageId, state, context, depth)
  return null
}

/** 取一个唯一节点 id；缺失、重复（含自引用）都按损坏处理。 */
function takeNodeId(record: Record<string, unknown>, state: SanitizeState): string | null {
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  if (id.length === 0 || state.ids.has(id)) return null
  state.ids.add(id)
  return id
}

function sanitizeGroup(
  record: Record<string, unknown>,
  pageId: string,
  state: SanitizeState,
  context: ValidateContext,
): GroupNode | null {
  const id = takeNodeId(record, state)
  if (id === null) return null
  const rawPanels = record.panels
  if (!Array.isArray(rawPanels)) return null

  const panels: PanelNode[] = []
  for (const rawPanel of rawPanels) {
    const panel = sanitizePanel(rawPanel, context)
    if (!panel) return null
    const key = panelNodeId(panel)
    if (state.seenPanels.has(key)) {
      context.duplicates.set(key, { pluginId: panel.pluginId, panelId: panel.panelId })
      context.messages.push(`页 ${pageId} 的面板 ${key} 重复，保留第一个，其余已移除`)
      continue
    }
    state.seenPanels.add(key)
    panels.push(panel)
  }

  const group: GroupNode = {
    type: 'group',
    id,
    panels,
    visible: record.visible !== false,
    collapsed: record.collapsed === true,
  }
  if (typeof record.activePanelId === 'string') group.activePanelId = record.activePanelId
  if (typeof record.activeTabId === 'string') assignGroupActiveTabId(group, record.activeTabId)
  const lastSize = positiveNumber(record.lastSize)
  if (lastSize !== undefined) group.lastSize = lastSize

  // 抽屉 group 的 activeTabId 不要求在 panels 里；普通 group 的 activePanelId 回退第一个可见面板。
  if (isDrawerGroupId(id)) return group
  return repairGroupActivePanel(group)
}

function sanitizePanel(input: unknown, context: ValidateContext): PanelNode | null {
  const record = asRecord(input)
  if (!record) return null
  const pluginId = record.pluginId
  const panelId = record.panelId
  if (typeof pluginId !== 'string' || !PLUGIN_ID_PATTERN.test(pluginId)) return null
  if (typeof panelId !== 'string' || !PANEL_ID_PATTERN.test(panelId)) return null

  const ref: PanelRef = { pluginId, panelId }
  const node: PanelNode = {
    type: 'panel',
    id: panelNodeId(ref),
    pluginId,
    panelId,
    visible: record.visible !== false,
  }
  if (record.collapsed === true) node.collapsed = true

  const frozen = panelSizeConstraint(panelId)
  const minWidth = Math.max(0, positiveNumber(record.minWidth) ?? 0, frozen.minWidth ?? 0)
  const minHeight = Math.max(0, positiveNumber(record.minHeight) ?? 0, frozen.minHeight ?? 0)
  const maxWidth = Math.min(positiveNumber(record.maxWidth) ?? Infinity, frozen.maxWidth ?? Infinity)
  const maxHeight = Math.min(positiveNumber(record.maxHeight) ?? Infinity, frozen.maxHeight ?? Infinity)

  let effectiveMinWidth = minWidth
  let effectiveMaxWidth = maxWidth
  if (node.visible && effectiveMaxWidth < 1) {
    // 可见面板不能被夹成 0 宽：手改出 0 / 负数上限时归一到 1px，并留下诊断。
    context.messages.push(
      `页内面板 ${panelNodeId(ref)} 的可见宽度上限为 ${String(record.maxWidth)}，已归一为 1px`,
    )
    effectiveMinWidth = 1
    effectiveMaxWidth = 1
  }
  if (effectiveMaxWidth < effectiveMinWidth) effectiveMinWidth = effectiveMaxWidth

  if (effectiveMinWidth > 0) node.minWidth = effectiveMinWidth
  if (Number.isFinite(effectiveMaxWidth)) node.maxWidth = effectiveMaxWidth
  if (minHeight > 0) node.minHeight = minHeight
  if (Number.isFinite(maxHeight)) node.maxHeight = maxHeight

  if (!context.options.panels(ref)) {
    context.missing.set(refKey(ref), { pluginId, panelId })
  }
  return node
}

function sanitizeSplit(
  record: Record<string, unknown>,
  pageId: string,
  state: SanitizeState,
  context: ValidateContext,
  depth: number,
): SplitNode | null {
  const id = takeNodeId(record, state)
  if (id === null) return null
  const orientation =
    record.orientation === 'horizontal' || record.orientation === 'vertical' ? record.orientation : null
  if (!orientation) return null
  const rawChildren = record.children
  const rawSizes = record.sizes
  if (!Array.isArray(rawChildren) || rawChildren.length < 2) return null
  if (!Array.isArray(rawSizes) || rawSizes.length !== rawChildren.length) return null

  const sizes: number[] = []
  for (const rawSize of rawSizes) {
    const size = finiteNumber(rawSize)
    if (size === undefined || size <= 0) return null
    sizes.push(size)
  }

  const children: LayoutNode[] = []
  for (const rawChild of rawChildren) {
    const child = sanitizeNode(rawChild, pageId, state, context, depth + 1)
    if (!child) return null
    children.push(child)
  }

  const split: SplitNode = {
    type: 'split',
    id,
    orientation,
    children,
    sizes: normalizeSizes(sizes),
  }
  if (Array.isArray(record.minSizes) && record.minSizes.length === children.length) {
    const minSizes: number[] = []
    for (const rawMinSize of record.minSizes) {
      const minSize = finiteNumber(rawMinSize)
      if (minSize === undefined || minSize < 0) return null
      minSizes.push(Math.round(minSize))
    }
    split.minSizes = minSizes
  }
  return split
}
