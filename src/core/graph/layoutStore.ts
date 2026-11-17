/**
 * 05-04 图布局持久化：`graph-layout.json`。
 *
 * 只读写世界坐标、视图与折叠目录：
 * - 布局文件独立于 04 的面板布局文件，也不写进偏好文件；
 * - 不存边、不存脚本正文、不存 `requires` / 触发器数据；
 * - 加载时路径命中优先，其次按 `meta.id` 迁移，其余记为 orphan（不参与渲染，
 *   保留 30 天后在下一次写入时清理）；
 * - 重绑定只改内存，不因重绑定写盘；
 * - 每次写入都写完整 JSON（原子临时文件 + rename 由 `StoragePort` 负责）。
 */
import type { StoragePort } from '../../workbench/api/host.ts'
import type {
  GraphLayoutLoadResult,
  GraphLayoutServicePort,
  GraphLayoutWriteResult,
} from '../../workbench/api/graph.ts'
import { isJsonObject } from '../doc/json.ts'
import type { JsonObject } from '../doc/types.ts'
import { clampScale, DEFAULT_VIEW } from './layout.ts'
import type { GraphViewState } from './layout.ts'
import {
  createGraphLayoutFile,
  GRAPH_LAYOUT_FILE,
  GRAPH_LAYOUT_MAX_BYTES,
  GRAPH_LAYOUT_VERSION,
  GRAPH_PROJECT_KEY,
} from './layoutFile.ts'
import type { GraphLayoutFile, GraphNodeLayout } from './layoutFile.ts'
import { folderOf, normalizeScriptPath } from './index.ts'

/** 损坏备份前缀（`graph-layout.corrupt.<ISO>.json`）。 */
export const GRAPH_LAYOUT_CORRUPT_PREFIX = 'graph-layout.corrupt.'

/** 失效节点记录的保留时长：30 天。 */
export const GRAPH_LAYOUT_ORPHAN_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** 已知脚本（重绑定输入）。 */
export interface KnownScript {
  path: string
  scriptId?: string | null
}

/** 构造参数。 */
export interface GraphLayoutStoreOptions {
  storage: StoragePort
  /** 时间源（测试可注入）。 */
  now?: () => Date
}

/** 坐标上限（与 `computeGraphLayout` 覆盖校验同口径）。 */
const MAX_ABS_COORDINATE = 1e6

/** 目录路径是否合法（`""` = 根组）。 */
export function isFolderPath(value: string): boolean {
  if (value === '') {
    return true
  }
  if (value.length > 512 || value.startsWith('/') || value.includes('\\')) {
    return false
  }
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

/** 损坏备份名：Windows 文件名不允许 `:`，ISO 时间戳统一换成 `-`。 */
export function corruptGraphLayoutFileName(at: Date): string {
  return `${GRAPH_LAYOUT_CORRUPT_PREFIX}${at.toISOString().replace(/[:.]/g, '-')}.json`
}

/** 规范化视图：scale 夹 0.15–2.5，tx/ty 非有限归 0。 */
export function normalizeGraphView(value: unknown): GraphViewState {
  const record: JsonObject = isJsonObject(value) ? value : {}
  const scale = typeof record.scale === 'number' ? clampScale(record.scale) : DEFAULT_VIEW.scale
  const tx = typeof record.tx === 'number' && Number.isFinite(record.tx) ? record.tx : DEFAULT_VIEW.tx
  const ty = typeof record.ty === 'number' && Number.isFinite(record.ty) ? record.ty : DEFAULT_VIEW.ty
  return { scale, tx, ty }
}

/** 规范化一条节点坐标；非法返回 `null`（调用方丢弃该条）。 */
export function normalizeNodeLayout(value: unknown): GraphNodeLayout | null {
  if (!isJsonObject(value)) {
    return null
  }
  const x = value.x
  const y = value.y
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null
  }
  if (Math.abs(x) > MAX_ABS_COORDINATE || Math.abs(y) > MAX_ABS_COORDINATE) {
    return null
  }
  const scriptId = typeof value.scriptId === 'string' && value.scriptId.length > 0 ? value.scriptId : null
  return { x, y, scriptId }
}

/** 规范化 `collapsed`：合法目录路径、去重、排序。 */
export function normalizeCollapsedFolders(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  const folders = new Set<string>()
  for (const entry of value) {
    if (typeof entry === 'string' && isFolderPath(entry)) {
      folders.add(entry)
    }
  }
  return [...folders].sort()
}

/** 规范化整份文件；结构不可用返回 `null`（按坏文件处理）。 */
function normalizeGraphLayoutFile(raw: unknown, now: Date): GraphLayoutFile | null {
  if (!isJsonObject(raw)) {
    return null
  }
  if (raw.version !== GRAPH_LAYOUT_VERSION || raw.projectKey !== GRAPH_PROJECT_KEY) {
    return null
  }
  const revision = typeof raw.revision === 'number' && Number.isFinite(raw.revision) && raw.revision >= 0
    ? Math.floor(raw.revision)
    : 0
  const nodes: Record<string, GraphNodeLayout> = {}
  if (isJsonObject(raw.nodes)) {
    for (const [key, value] of Object.entries(raw.nodes)) {
      const path = normalizeScriptPath(key)
      if (path === null) {
        continue
      }
      const layout = normalizeNodeLayout(value)
      if (layout !== null) {
        nodes[path] = layout
      }
    }
  }
  const updatedAt = typeof raw.updatedAt === 'string' && Number.isFinite(Date.parse(raw.updatedAt))
    ? raw.updatedAt
    : now.toISOString()
  return {
    version: GRAPH_LAYOUT_VERSION,
    projectKey: GRAPH_PROJECT_KEY,
    revision,
    nodes,
    view: normalizeGraphView(raw.view),
    collapsed: normalizeCollapsedFolders(raw.collapsed),
    updatedAt,
  }
}

/** 已知脚本去重（路径规范化；同 path 只保留第一条）。 */
function normalizeKnown(known: readonly KnownScript[]): KnownScript[] {
  const seen = new Set<string>()
  const scripts: KnownScript[] = []
  for (const script of known) {
    const path = normalizeScriptPath(script.path)
    if (path === null || seen.has(path)) {
      continue
    }
    seen.add(path)
    const scriptId = typeof script.scriptId === 'string' && script.scriptId.length > 0
      ? script.scriptId
      : script.scriptId === undefined ? undefined : null
    scripts.push({ path, ...(scriptId === undefined ? {} : { scriptId }) })
  }
  return scripts
}

/** 已知脚本推导出的目录集合（含根与全部祖先）。 */
function knownFolders(known: readonly KnownScript[]): Set<string> {
  const folders = new Set<string>()
  for (const script of known) {
    const path = normalizeScriptPath(script.path)
    if (path === null) {
      continue
    }
    let folder = folderOf(path)
    folders.add(folder)
    while (folder !== '') {
      const index = folder.lastIndexOf('/')
      folder = index < 0 ? '' : folder.slice(0, index)
      folders.add(folder)
    }
  }
  return folders
}

/** 过滤指向不存在目录的折叠项（读取容错；不写回）。 */
function filterKnownFolders(collapsed: readonly string[], known: readonly KnownScript[]): string[] {
  const folders = knownFolders(known)
  return collapsed.filter((folder) => folders.has(folder))
}

/** 图布局存储。 */
export class GraphLayoutStore implements GraphLayoutServicePort {
  private readonly storage: StoragePort
  private readonly now: () => Date
  /** 文件级状态（不含 nodes）。 */
  private file: GraphLayoutFile | null = null
  /** 已绑定到当前已知脚本的记录。 */
  private active = new Map<string, GraphNodeLayout>()
  /** 找不到脚本的记录（不渲染；写入时保留 30 天）。 */
  private orphans = new Map<string, GraphNodeLayout>()
  /** 加载后尚未绑定一次的原始记录。 */
  private pending = new Map<string, GraphNodeLayout>()
  private loaded = false
  private lastStatus: GraphLayoutLoadResult['status'] = 'default'
  private lastMessages: string[] = []

  constructor(options: GraphLayoutStoreOptions) {
    this.storage = options.storage
    this.now = options.now ?? (() => new Date())
  }

  /** 当前内存布局：只含已绑定的记录（orphan 不参与渲染）；加载前为 `null`。 */
  current(): GraphLayoutFile | null {
    if (this.file === null) {
      return null
    }
    return this.materialize(false)
  }

  /**
   * 首次加载读一次文件；之后调用只重新绑定。
   * 文件缺失 → 默认布局；坏 JSON / 版本不符 → 备份后默认；超过 1 MB → 备份后默认。
   */
  async load(known: readonly KnownScript[]): Promise<GraphLayoutLoadResult> {
    if (this.loaded) {
      this.rebind(known)
      return this.loadResult()
    }
    this.loaded = true

    let text: string | null
    try {
      text = await this.storage.read(GRAPH_LAYOUT_FILE)
    } catch (error) {
      this.useDefault()
      this.lastStatus = 'default'
      this.lastMessages = [`读取图布局失败：${error instanceof Error ? error.message : String(error)}；已使用默认布局`]
      this.rebind(known)
      return this.loadResult()
    }

    if (text === null) {
      this.useDefault()
      this.lastStatus = 'default'
      this.lastMessages = []
      this.rebind(known)
      return this.loadResult()
    }

    if (new TextEncoder().encode(text).length > GRAPH_LAYOUT_MAX_BYTES) {
      await this.quarantine(text)
      this.useDefault()
      this.lastStatus = 'too-large'
      this.lastMessages = [`图布局文件超过 ${GRAPH_LAYOUT_MAX_BYTES} 字节，已备份并使用默认布局`]
      this.rebind(known)
      return this.loadResult()
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text) as unknown
    } catch {
      await this.quarantine(text)
      this.useDefault()
      this.lastStatus = 'corrupt'
      this.lastMessages = ['图布局 JSON 已损坏，已备份并使用默认布局']
      this.rebind(known)
      return this.loadResult()
    }

    const normalized = normalizeGraphLayoutFile(parsed, this.now())
    if (normalized === null) {
      await this.quarantine(text)
      this.useDefault()
      this.lastStatus = 'corrupt'
      this.lastMessages = ['图布局版本或结构不受支持，已备份并使用默认布局']
      this.rebind(known)
      return this.loadResult()
    }

    normalized.collapsed = filterKnownFolders(normalized.collapsed, known)
    this.file = normalized
    this.active = new Map()
    this.orphans = new Map()
    this.pending = new Map(Object.entries(normalized.nodes))
    this.lastStatus = 'loaded'
    this.lastMessages = []
    this.rebind(known)
    return this.loadResult()
  }

  /** 保存视图（merge；成功与否内存值都保留）。 */
  async saveView(view: GraphViewState): Promise<GraphLayoutWriteResult> {
    if (this.file === null) {
      return noLayout()
    }
    this.file.view = normalizeGraphView(view)
    return this.persist()
  }

  /** 保存手摆坐标（merge，不删除未传的节点；非法条目忽略）。 */
  async saveNodePositions(
    nodes: Readonly<Record<string, { x: number; y: number; scriptId?: string | null }>>,
  ): Promise<GraphLayoutWriteResult> {
    if (this.file === null) {
      return noLayout()
    }
    for (const [rawPath, rawValue] of Object.entries(nodes)) {
      const path = normalizeScriptPath(rawPath)
      if (path === null) {
        continue
      }
      const layout = normalizeNodeLayout(rawValue)
      if (layout === null) {
        continue
      }
      const existing = this.active.get(path) ?? this.orphans.get(path)
      this.orphans.delete(path)
      const scriptId = layout.scriptId === null && existing !== undefined
        ? (existing.scriptId ?? null)
        : layout.scriptId
      this.active.set(path, { x: layout.x, y: layout.y, scriptId })
    }
    return this.persist()
  }

  /** 保存折叠目录（去重排序）。 */
  async setCollapsed(collapsed: readonly string[]): Promise<GraphLayoutWriteResult> {
    if (this.file === null) {
      return noLayout()
    }
    this.file.collapsed = normalizeCollapsedFolders(collapsed)
    return this.persist()
  }

  /** 清空手摆坐标与折叠，保留视图。 */
  async resetLayout(): Promise<GraphLayoutWriteResult> {
    if (this.file === null) {
      return noLayout()
    }
    this.active.clear()
    this.orphans.clear()
    this.pending.clear()
    this.file.collapsed = []
    return this.persist()
  }

  /** 重新绑定到当前节点集（只改内存，不写盘）。 */
  rebind(known: readonly KnownScript[]): void {
    if (this.file === null) {
      return
    }
    const scripts = normalizeKnown(known)
    const pool = new Map<string, GraphNodeLayout>()
    const collect = (source: Map<string, GraphNodeLayout>): void => {
      for (const [path, layout] of source) {
        pool.set(path, { ...layout })
      }
    }
    collect(this.pending)
    collect(this.active)
    collect(this.orphans)
    this.pending = new Map()
    this.active = new Map()
    this.orphans = new Map()

    // 1. 路径命中：坐标沿用，scriptId 更新为当前脚本的 id。
    for (const script of scripts) {
      const record = pool.get(script.path)
      if (record === undefined) {
        continue
      }
      pool.delete(script.path)
      this.active.set(script.path, {
        x: record.x,
        y: record.y,
        scriptId: script.scriptId === undefined ? (record.scriptId ?? null) : script.scriptId,
      })
    }

    // 2. scriptId 迁移：脚本 id 在已知集里唯一且旧记录里唯一才迁移。
    const scriptIdCounts = new Map<string, number>()
    for (const script of scripts) {
      if (script.scriptId === null || script.scriptId === undefined) {
        continue
      }
      scriptIdCounts.set(script.scriptId, (scriptIdCounts.get(script.scriptId) ?? 0) + 1)
    }
    const byScriptId = new Map<string, { path: string; layout: GraphNodeLayout }[]>()
    for (const [path, layout] of pool) {
      const scriptId = typeof layout.scriptId === 'string' && layout.scriptId.length > 0
        ? layout.scriptId
        : null
      if (scriptId === null) {
        continue
      }
      const list = byScriptId.get(scriptId) ?? []
      list.push({ path, layout })
      byScriptId.set(scriptId, list)
    }
    for (const script of scripts) {
      if (this.active.has(script.path)) {
        continue
      }
      const scriptId = script.scriptId
      if (scriptId === null || scriptId === undefined || scriptIdCounts.get(scriptId) !== 1) {
        continue
      }
      const candidates = byScriptId.get(scriptId)
      if (candidates === undefined || candidates.length !== 1) {
        continue
      }
      const candidate = candidates[0]
      if (!pool.has(candidate.path)) {
        continue
      }
      pool.delete(candidate.path)
      this.active.set(script.path, {
        x: candidate.layout.x,
        y: candidate.layout.y,
        scriptId,
      })
    }

    // 3. 其余记录：orphan（不渲染，写入时按 30 天清理）。
    for (const [path, layout] of pool) {
      this.orphans.set(path, layout)
    }
  }

  /** 加载结果（`file` 只含已绑定记录）。 */
  private loadResult(): GraphLayoutLoadResult {
    return {
      status: this.lastStatus,
      file: this.current() ?? createGraphLayoutFile(this.now()),
      messages: [...this.lastMessages],
    }
  }

  /** 回默认布局（保留空记录）。 */
  private useDefault(): void {
    this.file = createGraphLayoutFile(this.now())
    this.active = new Map()
    this.orphans = new Map()
    this.pending = new Map()
  }

  /** 备份坏文件；备份失败忽略（不阻塞回默认）。 */
  private async quarantine(text: string): Promise<void> {
    try {
      await this.storage.write(corruptGraphLayoutFileName(this.now()), text)
    } catch {
      // 备份失败不影响布局回默认。
    }
  }

  /** 清理超过 30 天的 orphan（按布局文件的 `updatedAt` 计时）。 */
  private pruneOrphans(): void {
    const file = this.file
    if (file === null || this.orphans.size === 0) {
      return
    }
    const stamp = Date.parse(file.updatedAt)
    if (!Number.isFinite(stamp)) {
      this.orphans.clear()
      return
    }
    if (this.now().getTime() - stamp > GRAPH_LAYOUT_ORPHAN_TTL_MS) {
      this.orphans.clear()
    }
  }

  /** 完整写一份：revision + 1、刷新 updatedAt、超过 1 MB 拒绝写盘但保留内存值。 */
  private async persist(): Promise<GraphLayoutWriteResult> {
    const file = this.file
    if (file === null) {
      return noLayout()
    }
    this.pruneOrphans()
    file.revision += 1
    file.updatedAt = this.now().toISOString()

    const text = JSON.stringify(this.materialize(true), null, 2)
    const bytes = new TextEncoder().encode(text).length
    if (bytes > GRAPH_LAYOUT_MAX_BYTES) {
      return {
        ok: false,
        error: 'too-large',
        message: `图布局超过 ${GRAPH_LAYOUT_MAX_BYTES} 字节（${bytes}），已拒绝写入（内存值保留）`,
      }
    }
    try {
      await this.storage.write(GRAPH_LAYOUT_FILE, text)
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        error: 'write-failed',
        message: `图布局写入失败（内存值保留）：${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  /** 构造文件快照；`includeOrphans` 为 false 时只返回可渲染记录。 */
  private materialize(includeOrphans: boolean): GraphLayoutFile {
    const base = this.file as GraphLayoutFile
    const nodes: Record<string, GraphNodeLayout> = {}
    const append = (path: string, layout: GraphNodeLayout): void => {
      nodes[path] = { x: layout.x, y: layout.y, scriptId: layout.scriptId ?? null }
    }
    for (const path of [...this.active.keys()].sort()) {
      const layout = this.active.get(path)
      if (layout !== undefined) {
        append(path, layout)
      }
    }
    if (includeOrphans) {
      for (const path of [...this.orphans.keys()].sort()) {
        const layout = this.orphans.get(path)
        if (layout !== undefined) {
          append(path, layout)
        }
      }
    }
    return {
      version: GRAPH_LAYOUT_VERSION,
      projectKey: GRAPH_PROJECT_KEY,
      revision: base.revision,
      nodes,
      view: { scale: base.view.scale, tx: base.view.tx, ty: base.view.ty },
      collapsed: [...base.collapsed],
      updatedAt: base.updatedAt,
    }
  }
}

/** 未加载时的统一结果。 */
function noLayout(): GraphLayoutWriteResult {
  return { ok: false, error: 'no-layout', message: '图布局尚未加载' }
}
