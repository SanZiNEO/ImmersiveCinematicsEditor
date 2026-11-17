/**
 * 05-06 / 05-07 关系写入：图上改前置、改 meta.id 的预览/应用/回滚。
 *
 * 两条路径共用 03 的 `DocCommand` 与 `DocStore`：
 * - 当前打开的脚本 → 走 `DocumentServiceImpl.commit/undo/save`（同一撤销栈）；
 * - 未打开的脚本 → 一个后台 `DocStore` 会话（同一命令、同一撤销语义），
 *   成功后直接写回文件；失败回滚内存，不更新图。
 *
 * 没有第二套关系存储，也没有「先乐观更新再回滚」。
 */
import type { CatalogIndex } from '../../core/schema/index.ts'
import type { DocCommand } from '../../core/doc/commands.ts'
import { META_ID_PATTERN, metaKeys } from '../../core/doc/keys.ts'
import { parseDoc } from '../../core/doc/parse.ts'
import { serializeDoc } from '../../core/doc/serialize.ts'
import { DocStore } from '../../core/doc/store.ts'
import { cloneJson, isJsonObject } from '../../core/doc/json.ts'
import type { JsonObject, JsonValue } from '../../core/doc/types.ts'
import {
  findTriggerIndex,
  duplicateTriggerIds,
  parseRequirement,
  requiresArrayOf,
  triggerFingerprint,
} from '../../core/graph/requirements.ts'
import { normalizeScriptPath } from '../../core/graph/index.ts'
import { isBuiltinRequirementType } from '../../core/graph/types.ts'
import type { GraphRequirement, GraphData, BuiltinRequirementType } from '../../core/graph/types.ts'
import type {
  MutationErrorCode,
  RefsApplyResult,
  RefsPreviewResult,
  RequiresMutationRequest,
  RequiresMutationResult,
  ScriptMutationServicePort,
  ScriptSource,
  GraphServicePort,
} from '../api/graph.ts'
import type { DocumentServiceImpl } from './DocumentServiceImpl.ts'

export interface ScriptMutationServiceOptions {
  source: ScriptSource
  graph: GraphServicePort
  documents: DocumentServiceImpl
  catalog: CatalogIndex
}

interface LoadedFile {
  path: string
  doc: JsonObject | null
  error?: string
}

/** 关系写入实现。 */
export class ScriptMutationService implements ScriptMutationServicePort {
  private readonly source: ScriptSource
  private readonly graph: GraphServicePort
  private readonly documents: DocumentServiceImpl
  private readonly catalog: CatalogIndex
  private readonly keys: readonly string[]
  private readonly sessions = new Map<string, DocStore>()
  private locked = false

  constructor(options: ScriptMutationServiceOptions) {
    this.source = options.source
    this.graph = options.graph
    this.documents = options.documents
    this.catalog = options.catalog
    this.keys = metaKeys(options.catalog)
  }

  async mutateRequires(request: RequiresMutationRequest): Promise<RequiresMutationResult> {
    if (this.locked) {
      return fail('lock_busy', '另一个引用事务正在进行')
    }
    // 断连直接拒写：关系写入依赖服务端校验目标脚本，来源断开时不假装成功。
    if (this.source.connected?.() === false) {
      return fail('offline', '未连接脚本来源，无法写入前置关系')
    }
    const path = normalizeScriptPath(request.path)
    if (path === null) {
      return fail('bad_path', '脚本路径不安全或不是 .json')
    }
    this.locked = true
    try {
      const graph = await this.ensureGraph()
      if (graph === null) {
        return fail('offline', '未连接脚本来源，无法校验目标脚本')
      }

      const isCurrent = this.documents.summary().path === path && this.documents.store.doc !== null
      if (isCurrent && this.documents.dirty) {
        return fail('dirty_conflict', '当前脚本文档有未保存修改；先保存/放弃后再改前置')
      }

      let session: DocStore | null = null
      if (!isCurrent) {
        try {
          session = await this.ensureSession(path)
        } catch (error) {
          return fail(
            this.source.connected?.() === false ? 'offline' : 'write_failed',
            `读取脚本失败：${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
      const doc: JsonObject | null = isCurrent
        ? this.documents.store.doc?.root ?? null
        : null
      if (session === null && doc === null) {
        return fail('write_failed', '脚本无法读取')
      }
      const root = isCurrent ? doc as JsonObject : session?.doc?.root
      if (root === undefined || root === null) {
        return fail('write_failed', '脚本无法读取')
      }

      const resolved = this.validateMutation(root, request, graph)
      if ('code' in resolved) {
        return resolved
      }

      const command = this.commandOf(request)
      if (isCurrent) {
        const committed = this.documents.commit(command)
        if (!committed.ok) {
          return fail('write_failed', committed.error ?? '文档命令被拒绝')
        }
        const saved = await this.documents.save()
        if (!saved.ok) {
          this.documents.undo()
          return fail('write_failed', saved.message ?? '写盘失败，已回滚')
        }
      } else {
        const store = session as DocStore
        const committed = store.commit(command)
        if (!committed.ok) {
          return fail('write_failed', committed.error ?? '文档命令被拒绝')
        }
        const saved = await this.writeSession(store, path)
        if (!saved.ok) {
          store.undo()
          return fail('write_failed', saved.error)
        }
      }

      const afterRoot = isCurrent
        ? this.documents.store.doc?.root
        : session?.doc?.root
      const requirements = afterRoot === undefined || afterRoot === null
        ? []
        : this.requirementsOf(afterRoot, request.triggerIdentity)
      this.graph.invalidate('requires', [path])
      let version = this.graph.version()
      try {
        const refreshed = await this.graph.refresh()
        version = refreshed.version
      } catch {
        // 写入已成功；刷新失败只影响图的新鲜度，不谎报写失败。
      }
      return {
        ok: true,
        path,
        triggerIdentity: request.triggerIdentity,
        requirements,
        graphVersion: version,
      }
    } finally {
      this.locked = false
    }
  }

  canUndo(path: string): boolean {
    const normalized = normalizeScriptPath(path)
    if (normalized === null) {
      return false
    }
    if (this.documents.summary().path === normalized) {
      return this.documents.canUndo
    }
    return this.sessions.get(normalized)?.canUndo() ?? false
  }

  async undo(path: string): Promise<RequiresMutationResult> {
    if (this.locked) {
      return fail('lock_busy', '另一个引用事务正在进行')
    }
    const normalized = normalizeScriptPath(path)
    if (normalized === null) {
      return fail('bad_path', '脚本路径不安全')
    }
    this.locked = true
    try {
      if (this.documents.summary().path === normalized) {
        if (!this.documents.undo()) {
          return fail('write_failed', '当前文档没有可撤销的操作')
        }
        const saved = await this.documents.save()
        if (!saved.ok) {
          return fail('write_failed', saved.message ?? '撤销后写盘失败')
        }
      } else {
        const store = this.sessions.get(normalized)
        if (store === undefined || !store.undo()) {
          return fail('write_failed', '没有可撤销的图操作')
        }
        const saved = await this.writeSession(store, normalized)
        if (!saved.ok) {
          return fail('write_failed', saved.error)
        }
      }
      this.graph.invalidate('requires', [normalized])
      let version = this.graph.version()
      try {
        version = (await this.graph.refresh()).version
      } catch {
        // 同上。
      }
      return {
        ok: true,
        path: normalized,
        triggerIdentity: '',
        requirements: [],
        graphVersion: version,
      }
    } finally {
      this.locked = false
    }
  }

  async previewRefs(from: string, to: string): Promise<RefsPreviewResult> {
    if (this.source.connected?.() === false) {
      return { ok: false, code: 'offline', message: '未连接脚本来源，无法预览引用变更' }
    }
    if (!validId(from) || !validId(to)) {
      return { ok: false, code: 'invalid_id', message: '脚本 id 需匹配 [A-Za-z0-9_]{1,32}' }
    }
    if (from === to) {
      return { ok: false, code: 'invalid_id', message: '新旧 id 不能相同' }
    }
    let loaded: LoadedFile[]
    try {
      loaded = await this.loadAll()
    } catch (error) {
      return {
        ok: false,
        code: this.source.connected?.() === false ? 'offline' : 'write_failed',
        message: error instanceof Error ? error.message : String(error),
      }
    }
    if (loaded.some((file) => file.doc === null)) {
      return { ok: false, code: 'write_failed', message: this.loadFailure(loaded) }
    }
    const docs = loaded.filter((file): file is { path: string; doc: JsonObject } => file.doc !== null)
    const sources = docs.filter((file) => readMetaId(file.doc) === from)
    if (sources.length === 0) {
      return { ok: false, code: 'source_missing', message: `源脚本 id 不存在：${from}` }
    }
    if (docs.some((file) => readMetaId(file.doc) === to)) {
      return { ok: false, code: 'target_exists', message: `新 id 已存在：${to}` }
    }

    const files: { path: string; references: number }[] = []
    const warnings: string[] = []
    let totalReferences = 0
    for (const file of docs) {
      const references = countReferences(file.doc, from)
      if (references === 0) {
        continue
      }
      files.push({ path: file.path, references })
      totalReferences += references
      if (readMetaId(file.doc) === from) {
        warnings.push(`${file.path} 引用自身 ${from}，应用时一并改为 ${to}`)
      }
    }
    if (sources.length > 1) {
      warnings.push(`源 id ${from} 在 ${sources.length} 个脚本中重复；请先修复重复 id`)
    }
    return { ok: true, from, to, files, totalReferences, warnings }
  }

  async applyRefs(from: string, to: string, expectedFiles: number): Promise<RefsApplyResult> {
    if (this.locked) {
      return { ok: false, code: 'lock_busy', message: '另一个引用事务正在进行', rolledBack: true }
    }
    if (this.source.connected?.() === false) {
      return { ok: false, code: 'offline', message: '未连接脚本来源，无法应用引用变更', rolledBack: false }
    }
    if (!validId(from) || !validId(to) || from === to) {
      return { ok: false, code: 'invalid_id', message: '脚本 id 非法或新旧相同', rolledBack: true }
    }
    this.locked = true
    try {
      let loaded: LoadedFile[]
      try {
        loaded = await this.loadAll()
      } catch (error) {
        return {
          ok: false,
          code: this.source.connected?.() === false ? 'offline' : 'write_failed',
          message: error instanceof Error ? error.message : String(error),
          rolledBack: true,
        }
      }
      if (loaded.some((file) => file.doc === null)) {
        return {
          ok: false,
          code: 'write_failed',
          message: this.loadFailure(loaded),
          rolledBack: true,
        }
      }
      const docs = loaded.filter((file): file is { path: string; doc: JsonObject } => file.doc !== null)
      const sources = docs.filter((file) => readMetaId(file.doc) === from)
      if (sources.length === 0) {
        return { ok: false, code: 'source_missing', message: `源脚本 id 不存在：${from}`, rolledBack: true }
      }
      if (sources.length > 1) {
        return { ok: false, code: 'source_missing', message: `源 id ${from} 不唯一，请先修复重复 id`, rolledBack: true }
      }
      if (docs.some((file) => readMetaId(file.doc) === to)) {
        return { ok: false, code: 'target_exists', message: `新 id 已存在：${to}`, rolledBack: true }
      }

      const affected = docs.filter((file) => countReferences(file.doc, from) > 0)
      if (affected.length !== expectedFiles) {
        return {
          ok: false,
          code: 'stale_preview',
          message: `引用面已变化（预览 ${expectedFiles} 个文件，当前 ${affected.length} 个），请重新预览`,
          rolledBack: true,
        }
      }

      const currentPath = this.documents.summary().path
      if (this.documents.dirty && currentPath !== null
        && (affected.some((file) => file.path === currentPath) || sources[0].path === currentPath)) {
        return {
          ok: false,
          code: 'dirty_conflict',
          message: '当前脚本文档有未保存修改，且本次引用同步涉及它；先保存/放弃',
          rolledBack: true,
        }
      }

      const writes: { path: string; doc: JsonObject; references: number }[] = []
      for (const file of docs) {
        const references = countReferences(file.doc, from)
        const sourceFile = file.path === sources[0].path
        if (references === 0 && !sourceFile) {
          continue
        }
        const next = cloneJson(file.doc) as JsonObject
        if (references > 0) {
          replaceReferences(next, from, to)
        }
        if (sourceFile) {
          const meta = isJsonObject(next.meta) ? next.meta : {}
          meta.id = to
          next.meta = meta
        }
        writes.push({ path: file.path, doc: next, references })
      }

      const originals = new Map<string, JsonObject>()
      const written: string[] = []
      for (const write of writes) {
        originals.set(write.path, write.doc)
      }
      const before = new Map(affected.map((file) => [file.path, file.doc]))
      for (const file of sources) {
        before.set(file.path, file.doc)
      }

      try {
        for (const write of writes) {
          const original = loadOriginal(docs, write.path)
          if (original === undefined) {
            throw new Error(`缺少原文件：${write.path}`)
          }
          await this.source.save(write.path, write.doc)
          written.push(write.path)
        }
      } catch (error) {
        const failedPaths: string[] = []
        for (const path of [...written].reverse()) {
          const original = loadOriginal(docs, path)
          if (original === undefined) {
            failedPaths.push(path)
            continue
          }
          try {
            await this.source.save(path, original)
          } catch {
            failedPaths.push(path)
          }
        }
        this.graph.invalidate('refactor', written)
        return {
          ok: false,
          code: 'write_failed',
          message: error instanceof Error ? error.message : String(error),
          rolledBack: failedPaths.length === 0,
          ...(failedPaths.length === 0 ? {} : { failedPaths }),
        }
      }

      // 当前打开的是被改文件时，内存同步（不重载、不重置撤销栈）。
      if (currentPath !== null) {
        const currentWrite = writes.find((write) => write.path === currentPath)
        if (currentWrite !== undefined) {
          this.documents.store.applyExternal(currentWrite.doc, { markClean: true })
        }
      }

      this.graph.invalidate('refactor', writes.map((write) => write.path))
      let version = this.graph.version()
      try {
        version = (await this.graph.refresh()).version
      } catch {
        // 写盘已完成；刷新失败只影响图的新鲜度。
      }
      void before
      void originals
      return {
        ok: true,
        changed: writes.map((write) => ({ path: write.path, references: write.references })),
        graphVersion: version,
      }
    } finally {
      this.locked = false
    }
  }

  /** 当前文档（若有）的触发器当前 requirements（编辑器页表单用）。 */
  currentRequirements(triggerIdentity: string): GraphRequirement[] {
    const root = this.documents.store.doc?.root
    return root === undefined ? [] : this.requirementsOf(root, triggerIdentity)
  }

  private async ensureGraph(): Promise<GraphData | null> {
    if (this.graph.current() !== null && !this.graph.stale()) {
      return this.graph.current()
    }
    try {
      return await this.graph.refresh()
    } catch {
      return this.graph.current()
    }
  }

  private async ensureSession(path: string): Promise<DocStore> {
    const existing = this.sessions.get(path)
    if (existing !== undefined) {
      return existing
    }
    const loaded = await this.source.load(path)
    const parsed = parseDoc(loaded, { metaKeys: this.keys })
    if (!parsed.ok) {
      throw new Error(`脚本无法解析：${parsed.issues[0]?.message ?? path}`)
    }
    const store = new DocStore({ catalog: this.catalog, metaKeys: this.keys })
    store.open(parsed.doc, path)
    this.sessions.set(path, store)
    return store
  }

  private async writeSession(store: DocStore, path: string): Promise<{ ok: boolean; error: string }> {
    const doc = store.doc
    if (doc === null) {
      return { ok: false, error: '没有打开的文档' }
    }
    try {
      await this.source.save(path, serializeDoc(doc))
      store.markSaved()
      return { ok: true, error: '' }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private validateMutation(
    root: JsonObject,
    request: RequiresMutationRequest,
    graph: GraphData,
  ): { ok: true } | { ok: false; code: MutationErrorCode; message: string; currentRequirements?: GraphRequirement[] } {
    const meta = isJsonObject(root.meta) ? root.meta : {}
    const sourceId = typeof meta.id === 'string' ? meta.id : ''
    const triggers = Array.isArray(meta.triggers) ? meta.triggers : []
    const index = findTriggerIndex(triggers, request.triggerIdentity, duplicateTriggerIds(triggers))
    if (index < 0) {
      return { ok: false, code: 'bad_trigger', message: `触发器不存在：${request.triggerIdentity}` }
    }
    const trigger = triggers[index]
    if (!isJsonObject(trigger)) {
      return { ok: false, code: 'bad_trigger', message: '触发器不是对象' }
    }
    const requires = requiresArrayOf(trigger)
    const currentFingerprint = triggerFingerprint(trigger)
    if (currentFingerprint !== request.requiresFingerprint) {
      return {
        ok: false,
        code: 'stale_requires',
        message: '触发器已被其他窗口修改，请刷新后重试',
        currentRequirements: requires.map((entry, i) => parseRequirement(entry, i)),
      }
    }
    if (request.operation !== 'add' && (request.index < 0 || request.index >= requires.length)) {
      return { ok: false, code: 'bad_index', message: `前置下标越界：${request.index}` }
    }
    if (request.operation === 'add' && (request.index < 0 || request.index > requires.length)) {
      return { ok: false, code: 'bad_index', message: `插入位置越界：${request.index}` }
    }
    if (request.operation !== 'add') {
      const existing = requires[request.index]
      const parsed = parseRequirement(existing, request.index)
      if (parsed.role !== 'builtin') {
        return { ok: false, code: 'custom_readonly', message: '自定义前置只读' }
      }
    }
    if (sourceId.length === 0 || !META_ID_PATTERN.test(sourceId)) {
      return { ok: false, code: 'source_without_id', message: '当前脚本没有合法 meta.id，先设置脚本 id' }
    }
    if (request.operation === 'remove') {
      return { ok: true }
    }
    const type = request.requirementType
    if (type === undefined || !isBuiltinRequirementType(type)) {
      return { ok: false, code: 'invalid_type', message: '只能写入内置三种前置类型' }
    }
    const target = request.targetScriptId
    if (target === undefined || target.length === 0 || !META_ID_PATTERN.test(target)) {
      return { ok: false, code: 'target_missing', message: '目标脚本 id 非法' }
    }
    if (target === sourceId) {
      return { ok: false, code: 'self_reference', message: '不能引用当前脚本自身' }
    }
    const matches = graph.nodes.filter((node) => node.scriptId === target)
    if (matches.length === 0) {
      return { ok: false, code: 'target_missing', message: `目标脚本不存在：${target}` }
    }
    if (matches.length > 1) {
      return { ok: false, code: 'target_duplicate', message: `目标 id 重复：${target}` }
    }
    return { ok: true }
  }

  private commandOf(request: RequiresMutationRequest): DocCommand {
    if (request.operation === 'remove') {
      return {
        kind: 'trigger.requires.remove',
        triggerIdentity: request.triggerIdentity,
        index: request.index,
      }
    }
    return {
      kind: request.operation === 'add' ? 'trigger.requires.add' : 'trigger.requires.update',
      triggerIdentity: request.triggerIdentity,
      index: request.index,
      requirementType: request.requirementType as BuiltinRequirementType,
      targetScriptId: request.targetScriptId as string,
    }
  }

  private requirementsOf(root: JsonObject, triggerIdentity: string): GraphRequirement[] {
    const meta = isJsonObject(root.meta) ? root.meta : {}
    const triggers = Array.isArray(meta.triggers) ? meta.triggers : []
    const index = findTriggerIndex(triggers, triggerIdentity, duplicateTriggerIds(triggers))
    if (index < 0) {
      return []
    }
    const trigger = triggers[index]
    if (!isJsonObject(trigger)) {
      return []
    }
    return requiresArrayOf(trigger).map((entry, requirementIndex) => parseRequirement(entry, requirementIndex))
  }

  private async loadAll(): Promise<LoadedFile[]> {
    const paths = await this.source.list()
    const normalized = [...new Set(paths
      .map((path) => normalizeScriptPath(path))
      .filter((path): path is string => path !== null))]
      .sort((left, right) => left.localeCompare(right))
    const files: LoadedFile[] = []
    for (const path of normalized) {
      try {
        const doc = await this.source.load(path)
        files.push({ path, doc: isJsonObject(doc) ? doc : null, ...(isJsonObject(doc) ? {} : { error: '根元素不是 JSON 对象' }) })
      } catch (error) {
        files.push({ path, doc: null, error: error instanceof Error ? error.message : String(error) })
      }
    }
    return files
  }

  private loadFailure(files: readonly LoadedFile[]): string {
    const failed = files.find((file) => file.doc === null)
    return failed === undefined ? '脚本读取失败' : `读取 ${failed.path} 失败：${failed.error ?? '未知错误'}`
  }
}

/** 读 `meta.id`（合法字符串才返回）。 */
function readMetaId(doc: JsonObject): string | undefined {
  const meta = isJsonObject(doc.meta) ? doc.meta : {}
  const id = meta.id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

/** 统计一个脚本里指向 `from` 的 requires 条数。 */
function countReferences(doc: JsonObject, from: string): number {
  const meta = isJsonObject(doc.meta) ? doc.meta : {}
  const triggers = Array.isArray(meta.triggers) ? meta.triggers : []
  let count = 0
  for (const trigger of triggers) {
    if (!isJsonObject(trigger) || !Array.isArray(trigger.requires)) {
      continue
    }
    for (const entry of trigger.requires) {
      if (typeof entry === 'string' && entry === from) {
        count += 1
        continue
      }
      if (isJsonObject(entry) && isJsonObject(entry.data) && entry.data.script === from) {
        count += 1
      }
    }
  }
  return count
}

/** 只替换 requires 里的脚本 id，保留其他字段与数组顺序。 */
function replaceReferences(root: JsonObject, from: string, to: string): void {
  const meta = isJsonObject(root.meta) ? root.meta : undefined
  if (meta === undefined) {
    return
  }
  const triggers = Array.isArray(meta.triggers) ? meta.triggers : []
  for (const trigger of triggers) {
    if (!isJsonObject(trigger) || !Array.isArray(trigger.requires)) {
      continue
    }
    const next: JsonValue[] = []
    for (const entry of trigger.requires) {
      if (typeof entry === 'string') {
        next.push(entry === from ? to : entry)
        continue
      }
      if (isJsonObject(entry) && isJsonObject(entry.data) && entry.data.script === from) {
        const copy = cloneJson(entry) as JsonObject
        const data = isJsonObject(copy.data) ? copy.data : {}
        data.script = to
        copy.data = data
        next.push(copy)
        continue
      }
      next.push(entry)
    }
    trigger.requires = next
  }
}

function loadOriginal(docs: readonly { path: string; doc: JsonObject }[], path: string): JsonObject | undefined {
  return docs.find((file) => file.path === path)?.doc
}

function validId(value: string): boolean {
  return META_ID_PATTERN.test(value)
}

function fail(code: MutationErrorCode, message: string): RequiresMutationResult {
  return { ok: false, code, message }
}
