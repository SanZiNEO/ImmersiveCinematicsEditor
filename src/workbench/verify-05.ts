/**
 * 05 服务层自检：图服务、关系写入、文档视图/会话。
 *
 * 运行：`node --experimental-strip-types src/workbench/verify-05.ts`
 *
 * 用内存 `ScriptSource` + 内存 `DocTransport` 走真实服务实现：
 * `ScriptGraphService` / `ScriptMutationService` / `DocumentServiceImpl` / `GraphLayoutStore`。
 * 不 mock 业务逻辑，只替身文件来源。
 */
import { buildCatalog, indexCatalog } from '../core/schema/index.ts'
import type { CatalogIndex } from '../core/schema/index.ts'
import { cloneJson, isJsonObject } from '../core/doc/json.ts'
import { metaKeys } from '../core/doc/keys.ts'
import type { JsonObject, JsonValue } from '../core/doc/types.ts'
import type { DocTransport, OpenResult, SaveResult } from '../core/doc/io.ts'
import type { ServerValidateResult } from '../core/doc/validate.ts'
import type { ValidationTransport } from '../core/doc/validate.ts'
import { DiagnosticsStore } from './kernel/DiagnosticsStore.ts'
import { DocumentServiceImpl } from './app/DocumentServiceImpl.ts'
import { ScriptGraphService } from './app/ScriptGraphService.ts'
import { ScriptMutationService } from './app/ScriptMutationService.ts'
import type { ScriptSource } from './api/graph.ts'

let ok = 0
let fail = 0

function check(label: string, condition: boolean, actual?: unknown): void {
  if (condition) {
    ok += 1
    console.log(`ok   ${label}`)
    return
  }
  fail += 1
  console.log(`FAIL ${label}：${format(actual)}`)
}

function format(value: unknown): string {
  if (value === undefined) {
    return 'undefined'
  }
  try {
    const text = JSON.stringify(value)
    return text === undefined ? String(value) : text.length > 320 ? `${text.slice(0, 320)}…` : text
  } catch {
    return String(value)
  }
}

class MemorySource implements ScriptSource {
  readonly files = new Map<string, JsonObject>()
  failSavePath: string | null = null

  constructor(initial: Record<string, JsonObject>) {
    for (const [path, doc] of Object.entries(initial)) {
      this.files.set(path, cloneJson(doc) as JsonObject)
    }
  }

  connected(): boolean {
    return true
  }

  async list(): Promise<string[]> {
    return [...this.files.keys()].sort()
  }

  async load(path: string): Promise<JsonValue> {
    const doc = this.files.get(path)
    if (doc === undefined) {
      throw new Error(`missing: ${path}`)
    }
    return cloneJson(doc)
  }

  async save(path: string, doc: JsonValue): Promise<void> {
    if (this.failSavePath === path) {
      throw new Error(`模拟写失败：${path}`)
    }
    this.files.set(path, cloneJson(doc) as JsonObject)
  }
}

class MemoryDocTransport implements DocTransport, ValidationTransport {
  private readonly source: MemorySource

  constructor(source: MemorySource) {
    this.source = source
  }

  async load(path: string): Promise<{ path: string; doc: JsonValue }> {
    return { path, doc: await this.source.load(path) }
  }

  async loadRaw(path: string): Promise<string> {
    return JSON.stringify(await this.source.load(path))
  }

  async save(path: string, doc: JsonObject): Promise<{ path: string }> {
    await this.source.save(path, doc)
    return { path }
  }

  async validate(): Promise<ServerValidateResult> {
    return { ok: true, issues: [] }
  }

  async pushScript(): Promise<{ ok: boolean; reason?: string }> {
    return { ok: true }
  }

  async newScript(): Promise<{ path: string; doc: JsonValue }> {
    return { path: 'untitled.json', doc: { meta: {}, timeline: { tracks: [] } } }
  }

  async seek(): Promise<void> {
    return undefined
  }

  async exists(path: string): Promise<boolean> {
    return this.source.files.has(path)
  }
}

function script(id: string, requires: JsonValue[] = [], triggerId = `${id}_t`): JsonObject {
  return {
    meta: {
      id,
      name: id.toUpperCase(),
      author: 'verify',
      triggers: [{
        id: triggerId,
        type: 'login',
        conditions: {},
        repeatable: false,
        delay: 0,
        ...(requires.length === 0 ? {} : { requires }),
      }],
    },
    timeline: { tracks: [] },
  }
}

function graphFixture(): Record<string, JsonObject> {
  return {
    'a.json': script('A', ['B']),
    'b.json': script('B'),
    'c.json': script('C'),
  }
}

function triggerOf(doc: JsonObject, identity: string): JsonObject | undefined {
  const meta = isJsonObject(doc.meta) ? doc.meta : {}
  const triggers = Array.isArray(meta.triggers) ? meta.triggers : []
  return triggers.find((entry) => isJsonObject(entry) && entry.id === identity) as JsonObject | undefined
}

async function main(): Promise<void> {
  const catalog: CatalogIndex = indexCatalog(buildCatalog('verify-05'))
  const keys = metaKeys(catalog)
  const source = new MemorySource(graphFixture())
  const diagnostics = new DiagnosticsStore()
  const graph = new ScriptGraphService({ source, catalog })
  const documents = new DocumentServiceImpl({
    catalog,
    transport: new MemoryDocTransport(source),
    diagnostics,
    pushDebounceMs: 1,
    validateDebounceMs: 1,
  })
  const mutations = new ScriptMutationService({ source, graph, documents, catalog })

  const snapshot = await graph.refresh()
  check('图服务：3 个节点', snapshot.nodes.length === 3, snapshot.nodes.map((node) => node.path))
  check('图服务：A 的前置 B → A 一条边', snapshot.edges.some((edge) =>
    edge.from === 'b.json' && edge.to === 'a.json' && edge.requirementType === 'script_played'), snapshot.edges)
  check('图服务：版本从 1 开始', snapshot.version === 1, snapshot.version)
  const unchanged = await graph.snapshot(1)
  check('图服务：sinceVersion=当前返回 unchanged', unchanged.unchanged === true && unchanged.nodes.length === 0, unchanged)
  check('图服务：脚本摘要不含轨道对象/关键帧', !JSON.stringify(snapshot).includes('keyframes'))

  const nodeA = snapshot.nodes.find((node) => node.path === 'a.json')
  const triggerA = nodeA?.triggers[0]
  check('图服务：触发器带条件与指纹', triggerA !== undefined
    && isJsonObject(triggerA.conditions)
    && typeof triggerA.requiresFingerprint === 'string'
    && triggerA.requiresFingerprint.length === 16, triggerA)

  // ── 图上改前置（未打开文档 → 后台 DocStore） ─────────────
  const added = await mutations.mutateRequires({
    path: 'a.json',
    triggerIdentity: 'A_t',
    triggerIndex: 0,
    requiresFingerprint: triggerA?.requiresFingerprint ?? '',
    operation: 'add',
    index: 1,
    requirementType: 'script_started',
    targetScriptId: 'C',
  })
  check('改前置：add 成功', added.ok === true, added)
  const afterAdd = source.files.get('a.json')
  const afterTrigger = afterAdd === undefined ? undefined : triggerOf(afterAdd, 'A_t')
  const afterRequires = afterTrigger !== undefined && Array.isArray(afterTrigger.requires) ? afterTrigger.requires : []
  check('改前置：requires 多一条对象', afterRequires.length === 2
    && isJsonObject(afterRequires[1])
    && afterRequires[1].type === 'script_started', afterRequires)
  check('改前置：图新增 C → A 边', graph.current()?.edges.some((edge) =>
    edge.from === 'c.json' && edge.to === 'a.json' && edge.requirementType === 'script_started') === true,
  graph.current()?.edges)
  check('改前置：可以撤销', mutations.canUndo('a.json') === true)
  const undone = await mutations.undo('a.json')
  check('改前置：撤销成功', undone.ok === true, undone)
  const afterUndo = source.files.get('a.json')
  const undoTrigger = afterUndo === undefined ? undefined : triggerOf(afterUndo, 'A_t')
  check('改前置：撤销恢复单条', Array.isArray(undoTrigger?.requires) && undoTrigger.requires.length === 1, undoTrigger?.requires)

  // 指纹过期
  const stale = await mutations.mutateRequires({
    path: 'a.json',
    triggerIdentity: 'A_t',
    triggerIndex: 0,
    requiresFingerprint: '0000000000000000',
    operation: 'remove',
    index: 0,
  })
  check('改前置：指纹过期返回 stale_requires', stale.ok === false && stale.code === 'stale_requires', stale)

  // 自引用/目标缺失/重复 id
  const nodeACurrent = graph.current()?.nodes.find((node) => node.path === 'a.json')
  const fingerprintNow = nodeACurrent?.triggers[0]?.requiresFingerprint ?? ''
  const self = await mutations.mutateRequires({
    path: 'a.json',
    triggerIdentity: 'A_t',
    triggerIndex: 0,
    requiresFingerprint: fingerprintNow,
    operation: 'update',
    index: 0,
    requirementType: 'script_played',
    targetScriptId: 'A',
  })
  check('改前置：自引用拒绝', self.ok === false && self.code === 'self_reference', self)
  const missing = await mutations.mutateRequires({
    path: 'a.json',
    triggerIdentity: 'A_t',
    triggerIndex: 0,
    requiresFingerprint: fingerprintNow,
    operation: 'update',
    index: 0,
    requirementType: 'script_played',
    targetScriptId: 'Z',
  })
  check('改前置：目标缺失拒绝', missing.ok === false && missing.code === 'target_missing', missing)

  // ── 当前打开的文档：同一命令 + 保存 ────────────────────
  const opened = await documents.open('a.json')
  check('文档视图：打开成功', opened.ok === true, opened)
  const view = documents.view()
  check('文档视图：触发器指纹与图一致', view?.triggers[0]?.requiresFingerprint === nodeACurrent?.triggers[0]?.requiresFingerprint,
    [view?.triggers[0]?.requiresFingerprint, nodeACurrent?.triggers[0]?.requiresFingerprint])
  const currentMutation = await mutations.mutateRequires({
    path: 'a.json',
    triggerIdentity: 'A_t',
    triggerIndex: 0,
    requiresFingerprint: view?.triggers[0]?.requiresFingerprint ?? '',
    operation: 'update',
    index: 0,
    requirementType: 'script_completed',
    targetScriptId: 'C',
  })
  check('当前文档：改前置成功', currentMutation.ok === true, currentMutation)
  check('当前文档：保存后不脏', documents.summary().dirty === false, documents.summary())
  check('当前文档：view 立即反映新类型', documents.view()?.triggers[0]?.requirements[0]?.type === 'script_completed',
    documents.view()?.triggers[0]?.requirements)
  check('当前文档：文件已写回', JSON.stringify(source.files.get('a.json')).includes('script_completed'))

  // ── 会话 API ─────────────────────────────────────────
  documents.setPlayhead(7.25)
  documents.addMarker(3)
  documents.addMarker(3)
  documents.setPreviewRange({ start: 2, end: 8 })
  documents.setPxPerSecond(120)
  documents.setTrackView('CAMERA#0', { locked: true })
  const session = documents.sessionView()
  check('会话：播放头', session.playhead === 7.25, session)
  check('会话：标记去重', session.markers.length === 1 && session.markers[0] === 3, session.markers)
  check('会话：预览范围', session.previewRange?.start === 2 && session.previewRange.end === 8, session.previewRange)
  check('会话：缩放', session.pxPerSecond === 120, session.pxPerSecond)
  check('会话：轨道锁定', session.trackView['CAMERA#0']?.locked === true, session.trackView)

  // ── 改 meta.id 预览/应用/回滚 ────────────────────────
  const preview = await mutations.previewRefs('C', 'C2')
  check('改 id：预览引用面', preview.ok === true && preview.totalReferences >= 1, preview)
  check('改 id：预览不改文件', source.files.get('c.json')?.meta !== undefined
    && (source.files.get('c.json')?.meta as JsonObject).id === 'C')
  if (preview.ok) {
    const applied = await mutations.applyRefs('C', 'C2', preview.files.length)
    check('改 id：应用成功', applied.ok === true, applied)
    check('改 id：源脚本 meta.id 改写', (source.files.get('c.json')?.meta as JsonObject).id === 'C2')
    check('改 id：引用同步', JSON.stringify(source.files.get('a.json')).includes('C2'))
  }

  // 回滚：让第二个文件写失败
  const rollbackSource = new MemorySource({
    'd.json': script('D', ['e']),
    'e.json': script('E'),
  })
  const rollbackGraph = new ScriptGraphService({ source: rollbackSource, catalog })
  await rollbackGraph.refresh()
  const rollbackDocuments = new DocumentServiceImpl({
    catalog,
    transport: new MemoryDocTransport(rollbackSource),
    diagnostics: new DiagnosticsStore(),
    pushDebounceMs: 1,
    validateDebounceMs: 1,
  })
  const rollbackMutations = new ScriptMutationService({
    source: rollbackSource,
    graph: rollbackGraph,
    documents: rollbackDocuments,
    catalog,
  })
  const rollbackPreview = await rollbackMutations.previewRefs('E', 'E2')
  rollbackSource.failSavePath = 'e.json'
  const rollback = await rollbackMutations.applyRefs('E', 'E2', rollbackPreview.ok ? rollbackPreview.files.length : 0)
  check('改 id：写失败回滚标记', rollback.ok === false && rollback.rolledBack === true, rollback)
  check('改 id：回滚后引用恢复', JSON.stringify(rollbackSource.files.get('d.json')).includes('"e"'),
    rollbackSource.files.get('d.json'))
  check('改 id：回滚后源 id 未改', (rollbackSource.files.get('e.json')?.meta as JsonObject).id === 'E')

  documents.dispose()
  rollbackDocuments.dispose()
}

await main()
console.log(`summary ok=${ok} fail=${fail}`)
if (fail > 0) {
  process.exitCode = 1
}
