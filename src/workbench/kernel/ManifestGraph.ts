/**
 * manifest 校验与依赖图（04-01）。
 *
 * 纯函数：不 import 任何业务实现，只看 manifest 结构。
 * 启动失败（重复 ID / API 版本 / 依赖环 / 依赖缺失）在这里产出明确诊断，不进入激活。
 */
import type { PluginContributions, PluginManifest } from '../api/contributions.ts'
import { PLUGIN_API_VERSION } from '../api/contributions.ts'
import type { ContributionKind } from '../api/contributions.ts'
import { COMMAND_ID_PATTERN, PANEL_ID_PATTERN, PLUGIN_ID_PATTERN, THEME_ID_PATTERN } from '../api/ids.ts'

/** 一条 manifest 及其来源（来源用于重复 ID 报错）。 */
export interface ManifestEntry {
  manifest: PluginManifest
  source: string
}

/** 一条 manifest 级问题。 */
export interface ManifestIssue {
  severity: 'error' | 'warning'
  code: string
  message: string
  pluginId?: string
  source?: string
}

/** 规划结果。 */
export interface ManifestPlan {
  /** 按依赖拓扑排序的激活顺序（依赖在前）。 */
  order: ManifestEntry[]
  /** 失败 / 跳过原因。 */
  failed: Map<string, string>
  /** 全部问题（错误 + 警告）。 */
  issues: ManifestIssue[]
}

/** 贡献类别的 ID 取值与校验。 */
interface KindSpec {
  kind: ContributionKind
  label: string
  list: (contributions: PluginContributions) => ReadonlyArray<Record<string, unknown>> | undefined
  idKey: string
  pattern?: RegExp
}

const KIND_SPECS: KindSpec[] = [
  { kind: 'panel', label: 'panelId', list: (c) => c.panels as unknown as Record<string, unknown>[] | undefined, idKey: 'panelId', pattern: PANEL_ID_PATTERN },
  { kind: 'page', label: 'pageId', list: (c) => c.pages as unknown as Record<string, unknown>[] | undefined, idKey: 'pageId', pattern: PANEL_ID_PATTERN },
  { kind: 'drawerTab', label: 'tabId', list: (c) => c.drawerTabs as unknown as Record<string, unknown>[] | undefined, idKey: 'tabId', pattern: PANEL_ID_PATTERN },
  { kind: 'command', label: 'commandId', list: (c) => c.commands as unknown as Record<string, unknown>[] | undefined, idKey: 'commandId', pattern: COMMAND_ID_PATTERN },
  { kind: 'statusItem', label: 'itemId', list: (c) => c.statusItems as unknown as Record<string, unknown>[] | undefined, idKey: 'itemId', pattern: PANEL_ID_PATTERN },
  { kind: 'settings', label: 'sectionId', list: (c) => c.settings as unknown as Record<string, unknown>[] | undefined, idKey: 'sectionId', pattern: PANEL_ID_PATTERN },
  { kind: 'theme', label: 'themeId', list: (c) => c.themes as unknown as Record<string, unknown>[] | undefined, idKey: 'themeId', pattern: THEME_ID_PATTERN },
]

/** 结构校验：返回该 manifest 的结构问题（不涉及全局唯一性）。 */
function structuralIssues(entry: ManifestEntry): ManifestIssue[] {
  const issues: ManifestIssue[] = []
  const { manifest, source } = entry
  const pluginId = typeof manifest?.id === 'string' ? manifest.id : undefined

  if (typeof pluginId !== 'string' || !PLUGIN_ID_PATTERN.test(pluginId)) {
    issues.push({
      severity: 'error',
      code: 'E_PLUGIN_ID',
      message: `插件 ID 非法: ${String(pluginId)}（需要匹配 ${PLUGIN_ID_PATTERN.source}）`,
      source,
    })
  }
  if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
    issues.push({ severity: 'error', code: 'E_PLUGIN_NAME', message: 'manifest.name 需要非空字符串', pluginId, source })
  }
  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+/.test(manifest.version)) {
    issues.push({ severity: 'error', code: 'E_PLUGIN_VERSION', message: `manifest.version 需要语义化版本: ${String(manifest.version)}`, pluginId, source })
  }
  if (manifest.apiVersion !== PLUGIN_API_VERSION) {
    issues.push({
      severity: 'error',
      code: 'E_API_VERSION',
      message: `apiVersion 不匹配: ${String(manifest.apiVersion)}（本轮只接受 ${PLUGIN_API_VERSION}）`,
      pluginId,
      source,
    })
  }
  if (typeof manifest.activate !== 'function') {
    issues.push({ severity: 'error', code: 'E_ACTIVATE', message: 'manifest.activate 必须是函数', pluginId, source })
  }
  if (manifest.requires !== undefined && !Array.isArray(manifest.requires)) {
    issues.push({ severity: 'error', code: 'E_REQUIRES', message: 'manifest.requires 必须是字符串数组', pluginId, source })
  }

  if (pluginId === undefined) {
    return issues
  }
  const contributions = manifest.contributes
  if (contributions === null || typeof contributions !== 'object') {
    issues.push({ severity: 'error', code: 'E_CONTRIBUTIONS', message: 'manifest.contributes 必须是对象', pluginId, source })
    return issues
  }

  for (const spec of KIND_SPECS) {
    const items = spec.list(contributions)
    if (items === undefined) {
      continue
    }
    if (!Array.isArray(items)) {
      issues.push({ severity: 'error', code: `E_${spec.kind.toUpperCase()}_LIST`, message: `${spec.kind} 贡献必须是数组`, pluginId, source })
      continue
    }
    const seen = new Set<string>()
    for (const item of items) {
      const id = item[spec.idKey]
      if (typeof id !== 'string' || id.length === 0) {
        issues.push({ severity: 'error', code: `E_${spec.kind.toUpperCase()}_ID`, message: `${spec.kind} 贡献缺少 ${spec.label}`, pluginId, source })
        continue
      }
      if (spec.pattern !== undefined && !spec.pattern.test(id)) {
        issues.push({ severity: 'error', code: `E_${spec.kind.toUpperCase()}_ID`, message: `${spec.label} 形态非法: ${id}`, pluginId, source })
      }
      if (seen.has(id)) {
        issues.push({ severity: 'error', code: `E_${spec.kind.toUpperCase()}_DUP`, message: `插件内 ${spec.label} 重复: ${id}`, pluginId, source })
      }
      seen.add(id)
    }
  }

  for (const panel of contributions.panels ?? []) {
    if (typeof panel.component !== 'function') {
      issues.push({ severity: 'error', code: 'E_PANEL_COMPONENT', message: `面板 ${panel.panelId} 的 component 必须是懒加载函数`, pluginId, source })
    }
  }
  for (const page of contributions.pages ?? []) {
    if (typeof page.component !== 'function') {
      issues.push({ severity: 'error', code: 'E_PAGE_COMPONENT', message: `页面 ${page.pageId} 的 component 必须是懒加载函数`, pluginId, source })
    }
    if (typeof page.route === 'string' && page.route.includes('?')) {
      issues.push({ severity: 'error', code: 'E_PAGE_ROUTE', message: `页面 ${page.pageId} 的 route 不能含查询串`, pluginId, source })
    }
  }
  for (const tab of contributions.drawerTabs ?? []) {
    if (typeof tab.component !== 'function') {
      issues.push({ severity: 'error', code: 'E_DRAWER_COMPONENT', message: `抽屉标签 ${tab.tabId} 的 component 必须是懒加载函数`, pluginId, source })
    }
  }
  for (const section of contributions.settings ?? []) {
    if (typeof section.component !== 'function') {
      issues.push({ severity: 'error', code: 'E_SETTINGS_COMPONENT', message: `设置分区 ${section.sectionId} 的 component 必须是懒加载函数`, pluginId, source })
    }
  }

  const themeIds = new Set<string>()
  for (const theme of contributions.themes ?? []) {
    if (themeIds.has(theme.themeId)) {
      issues.push({ severity: 'error', code: 'E_THEME_DUP', message: `插件内主题 ID 重复: ${theme.themeId}`, pluginId, source })
    }
    themeIds.add(theme.themeId)
    if (typeof theme.path !== 'string' || theme.path.length === 0) {
      issues.push({ severity: 'error', code: 'E_THEME_PATH', message: `主题 ${theme.themeId} 缺少 path`, pluginId, source })
    } else if (theme.path.startsWith('/') || theme.path.includes('..') || /^[a-z]+:/i.test(theme.path)) {
      issues.push({ severity: 'error', code: 'E_THEME_PATH', message: `主题 ${theme.themeId} 的 path 必须是插件目录内相对路径: ${theme.path}`, pluginId, source })
    }
  }

  return issues
}

/** 全局贡献 ID 唯一性检查：跨插件重复时标记后注册方失败。 */
function crossPluginDuplicates(entries: readonly ManifestEntry[]): ManifestIssue[] {
  const issues: ManifestIssue[] = []
  for (const spec of KIND_SPECS) {
    const owners = new Map<string, string>()
    for (const entry of entries) {
      const items = spec.list(entry.manifest.contributes)
      if (items === undefined || !Array.isArray(items)) {
        continue
      }
      for (const item of items) {
        const id = item[spec.idKey]
        if (typeof id !== 'string') {
          continue
        }
        const owner = owners.get(id)
        if (owner === undefined) {
          owners.set(id, entry.manifest.id)
          continue
        }
        if (owner === entry.manifest.id) {
          continue
        }
        issues.push({
          severity: 'error',
          code: `E_${spec.kind.toUpperCase()}_GLOBAL_DUP`,
          message: `${spec.kind} ID 全局重复: ${id}（${owner} 与 ${entry.manifest.id}）`,
          pluginId: entry.manifest.id,
          source: entry.source,
        })
      }
    }
  }
  return issues
}

/** 环检测（Tarjan 简化版：DFS 着色），返回参与环的插件 ID。 */
function findCycles(entries: readonly ManifestEntry[]): string[][] {
  const byId = new Map<string, ManifestEntry>()
  for (const entry of entries) {
    byId.set(entry.manifest.id, entry)
  }
  const state = new Map<string, 0 | 1 | 2>()
  const stack: string[] = []
  const cycles: string[][] = []

  const visit = (id: string): void => {
    const current = state.get(id) ?? 0
    if (current === 2) {
      return
    }
    if (current === 1) {
      const start = stack.indexOf(id)
      cycles.push(stack.slice(start === -1 ? 0 : start))
      return
    }
    state.set(id, 1)
    stack.push(id)
    const entry = byId.get(id)
    for (const dependency of entry?.manifest.requires ?? []) {
      if (byId.has(dependency)) {
        visit(dependency)
      }
    }
    stack.pop()
    state.set(id, 2)
  }

  for (const entry of entries) {
    visit(entry.manifest.id)
  }
  return cycles
}

/**
 * 校验 + 拓扑排序。
 *
 * 规则：
 * - 结构问题（ID / API 版本 / 贡献 ID 形态 / 组件懒加载）→ 该插件失败；
 * - 插件 ID 重复 → 两处一起失败，错误里列出两个来源；
 * - 依赖缺失 / 自我依赖 / 环 → 参与方失败并写依赖链；
 * - 其余插件按声明顺序稳定拓扑排序（依赖在前）。
 */
export function planManifests(entries: readonly ManifestEntry[]): ManifestPlan {
  const issues: ManifestIssue[] = []
  const failed = new Map<string, string>()

  const structuralById = new Map<string, ManifestIssue[]>()
  for (const entry of entries) {
    const found = structuralIssues(entry)
    structuralById.set(entry.manifest.id, found)
    issues.push(...found)
    if (found.length > 0) {
      failed.set(entry.manifest.id, found.map((issue) => issue.message).join('；'))
    }
  }

  // 重复插件 ID：两处来源都列出，一起失败。
  const idSources = new Map<string, string[]>()
  for (const entry of entries) {
    const list = idSources.get(entry.manifest.id)
    if (list === undefined) {
      idSources.set(entry.manifest.id, [entry.source])
    } else {
      list.push(entry.source)
    }
  }
  for (const [id, sources] of idSources) {
    if (sources.length > 1) {
      const message = `插件 ID 重复: ${id}（来源: ${sources.join(' 与 ')}）`
      issues.push({ severity: 'error', code: 'E_PLUGIN_ID_DUP', message, pluginId: id, source: sources.join(' | ') })
      failed.set(id, message)
    }
  }

  const duplicateIssues = crossPluginDuplicates(entries)
  issues.push(...duplicateIssues)
  for (const issue of duplicateIssues) {
    if (issue.pluginId !== undefined && !failed.has(issue.pluginId)) {
      failed.set(issue.pluginId, issue.message)
    }
  }

  // 依赖存在性。
  const known = new Set<string>()
  for (const entry of entries) {
    known.add(entry.manifest.id)
  }
  for (const entry of entries) {
    for (const dependency of entry.manifest.requires ?? []) {
      if (!known.has(dependency)) {
        const message = `依赖缺失: ${entry.manifest.id} 需要 ${dependency}（未注册）`
        issues.push({ severity: 'error', code: 'E_DEP_MISSING', message, pluginId: entry.manifest.id, source: entry.source })
        failed.set(entry.manifest.id, message)
      }
      if (dependency === entry.manifest.id) {
        const message = `依赖环: ${entry.manifest.id} 依赖自己`
        issues.push({ severity: 'error', code: 'E_DEP_CYCLE', message, pluginId: entry.manifest.id, source: entry.source })
        failed.set(entry.manifest.id, message)
      }
    }
  }

  // 环检测（只在未失败的插件之间）。
  const alive = entries.filter((entry) => !failed.has(entry.manifest.id))
  for (const cycle of findCycles(alive)) {
    const message = `依赖环: ${[...cycle, cycle[0]].join(' → ')}`
    issues.push({ severity: 'error', code: 'E_DEP_CYCLE', message, source: cycle.join(' | ') })
    for (const id of cycle) {
      failed.set(id, message)
    }
  }

  // 稳定拓扑排序：按声明顺序做 DFS，依赖先入结果。
  const order: ManifestEntry[] = []
  const byId = new Map<string, ManifestEntry>()
  for (const entry of entries) {
    if (!failed.has(entry.manifest.id)) {
      byId.set(entry.manifest.id, entry)
    }
  }
  const visited = new Set<string>()
  const walk = (id: string): void => {
    if (visited.has(id)) {
      return
    }
    visited.add(id)
    const entry = byId.get(id)
    if (entry === undefined) {
      return
    }
    for (const dependency of entry.manifest.requires ?? []) {
      walk(dependency)
    }
    order.push(entry)
  }
  for (const entry of entries) {
    walk(entry.manifest.id)
  }

  return { order, failed, issues }
}
