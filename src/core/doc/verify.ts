/**
 * 03 自检：脚本文档模型（03-01 ~ 03-08）。
 *
 * 运行：`node --experimental-strip-types src/core/doc/verify.ts`
 * 输出：每条断言一行 `ok   <描述>` / `FAIL <描述>：<实际值>`，最后 `summary ok=<n> fail=<n>`。
 * 任一失败把 `process.exitCode` 置 1。
 *
 * 覆盖：
 * - 顶层键 / 片段键 / 未知键策略；
 * - `AnimObject` 三形态 + 九种值 + 关键帧规则；
 * - 选择身份（重排 / 跨轨 / 撤销 / 复制 / 引用完整性）；
 * - 无损序列化往返（6 个真实夹具）；
 * - `commit` / `undo` / `redo` 与回滚；
 * - L01–L34 结构检查 + 20 个非法夹具；
 * - 打开 / 新建 / 保存 / 推送（内存 transport）；
 * - `CatalogIndex` 绑定与 `catalogHash`。
 */
import { readFile, readdir } from 'node:fs/promises'

import { buildCatalog, indexCatalog } from '../schema/index.ts'
import type { CatalogIndex } from '../schema/index.ts'
import type { FieldCatalog, FieldEntry } from '../schema/types.ts'
import { bindDocument, bindingMatches } from './binding.ts'
import { readClip } from './clip.ts'
import * as docBarrel from './index.ts'

import { ClipRegistry, repairSelection } from './identity.ts'
import { cloneJson, isJsonObject, sameJson } from './json.ts'
import { metaKeys } from './keys.ts'
import { readAnimObject, writeAnimObject } from './object.ts'
import { parseDoc } from './parse.ts'
import { serializeDoc, serializeForPreview } from './serialize.ts'
import { DocStore } from './store.ts'
import type { DocIssue, JsonObject, JsonValue, ScriptDoc } from './types.ts'
import { DocIo, buildNewDoc } from './io.ts'
import type { DocTransport } from './io.ts'
import { validateStructure } from './structural.ts'
import { ValidationBridge, parseServerIssue } from './validate.ts'
import { checkValue } from './value.ts'

const SOURCE_COMMIT = 'd4840b172511de3ddddb270f26c2cd0029ab0c30'
const FIXTURES = new URL('../schema/fixtures/scripts/', import.meta.url)
const DOC_DIR = new URL('./', import.meta.url)

let ok = 0
let fail = 0

/** 断言实际值压成一行。 */
function format(value: unknown): string {
  if (value === undefined) {
    return 'undefined'
  }
  if (typeof value === 'string') {
    return value
  }
  if (value instanceof Error) {
    return value.message
  }
  try {
    const text = JSON.stringify(value)
    return text === undefined ? String(value) : text.length > 300 ? `${text.slice(0, 300)}…` : text
  } catch {
    return String(value)
  }
}

/** 记一条断言。 */
function check(label: string, condition: boolean, actual?: unknown): void {
  if (condition) {
    ok += 1
    console.log(`ok   ${label}`)
    return
  }
  fail += 1
  console.log(`FAIL ${label}：${format(actual)}`)
}

/** 读夹具 JSON。 */
async function readJson(relative: string): Promise<JsonValue> {
  return JSON.parse(await readFile(new URL(relative, FIXTURES), 'utf8')) as JsonValue
}

/** 读源码文件（grep 断言用）。 */
async function readSource(name: string): Promise<string> {
  return readFile(new URL(name, DOC_DIR), 'utf8')
}

/** 本地结构检查。 */
function localIssues(doc: ScriptDoc, catalog: CatalogIndex, registry: ClipRegistry): DocIssue[] {
  return validateStructure(doc, { catalog, metaKeys: metaKeys(catalog), registry })
}

/** 构造文档并同步身份表。 */
function makeDoc(
  json: JsonValue,
  catalog: CatalogIndex,
): { doc: ScriptDoc; registry: ClipRegistry; issues: DocIssue[] } {
  const parsed = parseDoc(json, { metaKeys: metaKeys(catalog) })
  if (!parsed.ok) {
    throw new Error(`夹具无法解析: ${parsed.issues.map((issue) => issue.message).join('；')}`)
  }
  const registry = new ClipRegistry()
  registry.sync(parsed.doc)
  return { doc: parsed.doc, registry, issues: parsed.issues }
}

/** 构造文档并同步身份表（非法夹具用：允许 meta/timeline 未知键，仍做结构检查）。 */
function makeDocLenient(
  json: JsonValue,
  catalog: CatalogIndex,
): { doc: ScriptDoc; registry: ClipRegistry } {
  if (!isJsonObject(json) || !isJsonObject(json.meta) || !isJsonObject(json.timeline)) {
    throw new Error('夹具缺少 meta / timeline 对象')
  }
  const doc: ScriptDoc = {
    root: json,
    meta: json.meta,
    timeline: json.timeline,
    authoring: {},
    clipAuthoring: {},
  }
  const registry = new ClipRegistry()
  registry.sync(doc)
  void catalog
  return { doc, registry }
}

/** 断言 issue 列表里有一条命中（code + 关键字）。 */
function hasIssue(issues: readonly DocIssue[], code: string, keyword?: string): boolean {
  return issues.some((issue) => issue.code === code && (keyword === undefined || issue.message.includes(keyword)))
}

/** 内存传输：模拟 `script.*` / `editor.*`。 */
class MemoryTransport implements DocTransport {
  readonly files = new Map<string, string>()
  readonly pushes: string[] = []
  readonly seeks: number[] = []
  failSave = false
  pushAck = true
  validateResult: { ok: boolean; issues: string[] } = { ok: true, issues: [] }

  async load(path: string): Promise<{ path: string; doc: JsonValue }> {
    const text = this.files.get(path)
    if (text === undefined) {
      throw new Error(`file not found: ${path}`)
    }
    return { path, doc: JSON.parse(text) as JsonValue }
  }

  async loadRaw(path: string): Promise<string> {
    const text = this.files.get(path)
    if (text === undefined) {
      throw new Error(`file not found: ${path}`)
    }
    return text
  }

  async save(path: string, doc: JsonObject): Promise<{ path: string }> {
    if (this.failSave) {
      throw new Error('save failed (injected)')
    }
    this.files.set(path, JSON.stringify(doc))
    return { path }
  }

  async validate(): Promise<{ ok: boolean; issues: string[] }> {
    return this.validateResult
  }

  async pushScript(script: string): Promise<{ ok: boolean; reason?: string }> {
    this.pushes.push(script)
    return this.pushAck ? { ok: true } : { ok: false, reason: 'disconnected' }
  }

  async newScript(): Promise<{ path: string; doc: JsonValue }> {
    const path = `untitled-${this.files.size + 1}.json`
    return {
      path,
      doc: {
        meta: { id: 'untitled', name: 'Untitled', author: '' },
        timeline: { tracks: [] },
      },
    }
  }

  async seek(time: number): Promise<void> {
    this.seeks.push(time)
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path)
  }
}

/** 深拷贝一份目录并改一处（验证「目录变化不改作者值」）。 */
function mutateCatalog(
  catalog: FieldCatalog,
  mutate: (copy: FieldCatalog) => void,
): FieldCatalog {
  const copy = structuredClone(catalog)
  mutate(copy)
  return copy
}

async function main(): Promise<void> {
  // ── 0. 目录 ────────────────────────────────────────────────────────────────
  let catalog: FieldCatalog
  try {
    catalog = buildCatalog(SOURCE_COMMIT)
    check('buildCatalog(SOURCE_COMMIT) 成功', true)
  } catch (error) {
    check('buildCatalog(SOURCE_COMMIT) 成功', false, error)
    return
  }
  const index = indexCatalog(catalog)
  const keys = metaKeys(index)
  check('metaKeys 来自 02 目录（23 条）', keys.length === 23, keys.length)

  const objectsDemoRaw = await readJson('valid/objects-demo.json')
  const stepRaw = await readJson('valid/step.json')
  const collectionsRaw = await readJson('valid/collections.json')
  const sevenTracksRaw = await readJson('valid/seven-tracks.json')

  // ── 1. 03-01 顶层形状 ─────────────────────────────────────────────────────
  {
    const parsed = parseDoc(objectsDemoRaw, { metaKeys: keys })
    check('03-01 打开 objects-demo 成功', parsed.ok)
  }
  {
    const withCustom = cloneJson(objectsDemoRaw) as JsonObject
    withCustom.x_custom = { anything: [1, 2, 3] }
    const parsed = parseDoc(withCustom, { metaKeys: keys })
    check('03-01 根未知键 x_custom 打开不报错', parsed.ok)
    check(
      '03-01 根未知键产生 info L34',
      parsed.ok && parsed.issues.some((issue) => issue.code === 'L34' && issue.severity === 'info'),
    )
    if (parsed.ok) {
      const out = serializeDoc(parsed.doc)
      check('03-01 根未知键保存后仍在', sameJson(out.x_custom as JsonValue, { anything: [1, 2, 3] }))
    }
  }
  {
    const badMeta = cloneJson(objectsDemoRaw) as JsonObject
    const meta = badMeta.meta as JsonObject
    meta.no_such_field = 3
    const parsed = parseDoc(badMeta, { metaKeys: keys })
    check('03-01 meta 目录外键打开即阻断', !parsed.ok)
    check(
      '03-01 meta 目录外键定位 meta.no_such_field',
      !parsed.ok && parsed.issues.some((issue) => issue.jsonPath === 'meta.no_such_field' && issue.severity === 'block'),
    )
  }
  {
    const badTimeline = cloneJson(objectsDemoRaw) as JsonObject
    const timeline = badTimeline.timeline as JsonObject
    timeline.total_duration = 5
    const parsed = parseDoc(badTimeline, { metaKeys: keys })
    check('03-01 timeline 目录外键打开即阻断', !parsed.ok)
    check(
      '03-01 timeline 目录外键定位 timeline.total_duration',
      !parsed.ok && parsed.issues.some((issue) => issue.jsonPath === 'timeline.total_duration'),
    )
  }
  {
    const standalone = cloneJson(collectionsRaw) as JsonObject
    const clips = standalone.clips as JsonValue[]
    const clip = clips[0] as JsonObject
    clip.start_time = 0
    const { doc, registry } = makeDoc(standalone, index)
    const issues = localIssues(doc, index, registry)
    check('03-01 独立片段写 start_time 报 L09 block', hasIssue(issues, 'L09', 'start_time'))
  }
  {
    const { doc, registry } = makeDoc(collectionsRaw, index)
    const issues = localIssues(doc, index, registry)
    check('03-01 collections 夹具本地检查无 block', !issues.some((issue) => issue.severity === 'block'), issues)
    const out = serializeDoc(doc)
    const clips = out.clips as JsonValue[]
    const paths = out.paths as JsonValue[]
    const rules = out.rules as JsonValue[]
    const bindings = out.rule_bindings as JsonValue[]
    check('03-01 四类集合数量保留', clips.length === 1 && paths.length === 1 && rules.length === 1 && bindings.length === 1)
    check(
      '03-01 集合顺序与 id 保留',
      (clips[0] as JsonObject).id === 'clip_collect'
      && (paths[0] as JsonObject).id === 'path_collect'
      && (rules[0] as JsonObject).id === 'rule_collect'
      && (bindings[0] as JsonObject).id === 'bind_collect',
    )
    check('03-01 不写 timeline 总时长', !Object.prototype.hasOwnProperty.call(out.timeline as JsonObject, 'total_duration'))
  }

  // ── 2. 03-02 属性对象与值模型 ─────────────────────────────────────────────
  {
    const { doc, registry } = makeDoc(objectsDemoRaw, index)
    const handle = registry.handles()[0]
    const result = readClip(handle.clip, {
      inline: true,
      jsonPath: 'timeline.tracks[0].clips[0]',
      trackType: handle.trackType,
      catalog: index,
    })
    check('03-02 objects-demo 片段无 block', !result.problems.some((problem) => problem.severity === 'block'), result.problems)
    const objects = handle.clip.objects as JsonObject
    const frameCount = (path: string): number => {
      const property = objects[path] as JsonObject
      const frames = property.keyframes
      return Array.isArray(frames) ? frames.length : 0
    }
    check(
      '03-02 position.x/y/z 各 2 帧、yaw 2 帧、fov 无关键帧',
      frameCount('position.x') === 2 && frameCount('position.y') === 2 && frameCount('position.z') === 2
        && frameCount('yaw') === 2 && frameCount('fov') === 0,
    )
    for (const path of ['position.x', 'position.y', 'position.z', 'yaw', 'fov']) {
      const def = index.objectDef('CAMERA', path)
      if (def === undefined) {
        check(`03-02 ${path} 有目录声明`, false)
        continue
      }
      const raw = (objects[path] as JsonObject) as JsonValue
      const read = readAnimObject(def, raw, { jsonPath: path, duration: 4, infinite: false })
      check(`03-02 write(read(${path})) 语义相等`, sameJson(writeAnimObject(read.object), raw), writeAnimObject(read.object))
    }
    void doc
  }
  {
    const yawRaw = cloneJson(objectsDemoRaw) as JsonObject
    const yawTracks = (yawRaw.timeline as JsonObject).tracks as JsonValue[]
    const yawClip = ((yawTracks[0] as JsonObject).clips as JsonValue[])[0] as JsonObject
    const yawObjects = yawClip.objects as JsonObject
    yawObjects.yaw = { keyframes: [{ time: 1, value: 0 }] }
    const store = new DocStore({ catalog: index, metaKeys: keys })
    const parsed = parseDoc(yawRaw, { metaKeys: keys })
    if (!parsed.ok) {
      check('03-02 store 打开 yaw 夹具', false, parsed.issues)
      return
    }
    store.open(parsed.doc, 'yaw.json')
    const before = store.undoDepth()
    const result = store.commit({ kind: 'object.addKeyframe', clipKey: store.registry.handles()[0].key, path: 'yaw', time: 2, value: 180 })
    const objects = store.registry.handles()[0].clip.objects as JsonObject
    const yaw = objects.yaw as JsonObject
    const positionX = objects['position.x'] as JsonObject
    check('03-02 加 yaw@2 帧成功', result.ok, result)
    check('03-02 yaw 帧数 +1', Array.isArray(yaw.keyframes) && yaw.keyframes.length === 2)
    check('03-02 position.x 帧数不变', Array.isArray(positionX.keyframes) && positionX.keyframes.length === 2)
    check('03-02 commit 后 dirty=true', store.dirty)
    check('03-02 撤销栈 +1', store.undoDepth() === before + 1)
    check('03-02 撤销一次回原状', store.undo() && store.undoDepth() === before)
    const afterUndo = store.registry.handles()[0].clip.objects as JsonObject
    const yawAfter = afterUndo.yaw as JsonObject
    check('03-02 撤销后 yaw 回到 1 帧', Array.isArray(yawAfter.keyframes) && yawAfter.keyframes.length === 1)
  }
  {
    const cases: Array<[string, string, string, string]> = [
      ['value-with-keyframes.json', 'L12', 'mode=value', 'value 模式带 keyframes'],
      ['event-empty-keyframes.json', 'L12', 'mode=event', 'event 空 keyframes'],
      ['keyframe-time-equal.json', 'L15', '单调递增', '关键帧时间相等'],
      ['keyframe-time-desc.json', 'L15', '单调递增', '关键帧时间倒序'],
      ['keyframe-time-negative.json', 'L15', '负数', '关键帧时间负数'],
      ['string-number.json', 'L13', '需要有限数字', '字符串数字'],
      ['int-fraction.json', 'L13', '需要整数', 'int 小数'],
      ['null-non-nullable.json', 'L13', '需要有限数字', 'null 给非 nullable'],
    ]
    for (const [file, code, keyword, label] of cases) {
      const raw = await readJson(`invalid/${file}`)
      const { doc, registry } = makeDocLenient(raw, index)
      const issues = localIssues(doc, index, registry)
      check(`03-02 反例：${label} → ${code}`, hasIssue(issues, code, keyword), issues)
    }
    const nanRaw = JSON.parse(await readFile(new URL('invalid/nan.json', FIXTURES), 'utf8')) as JsonValue
    const { doc, registry } = makeDoc(nanRaw, index)
    const issues = localIssues(doc, index, registry)
    check(
      '03-02 反例：NaN / Infinity → block',
      issues.some((issue) => issue.severity === 'block' && (issue.code === 'L15' || issue.code === 'L13' || issue.code === 'L16')),
      issues,
    )
  }
  {
    const adjust = cloneJson(sevenTracksRaw) as JsonObject
    const tracks = (adjust.timeline as JsonObject).tracks as JsonValue[]
    const adjustTrack = tracks.find((track) => isJsonObject(track) && track.type === 'ADJUST') as JsonObject
    const clip = (adjustTrack.clips as JsonValue[])[0] as JsonObject
    const objects = clip.objects as JsonObject
    objects.blend_amount = { value: 1.5 }
    const { doc, registry } = makeDoc(adjust, index)
    const issues = localIssues(doc, index, registry)
    check(
      '03-02 反例：越界 min/max → error',
      issues.some((issue) => issue.severity === 'error' && issue.message.includes('超出范围')),
      issues,
    )
  }
  {
    const { doc, registry } = makeDoc(objectsDemoRaw, index)
    const issues = localIssues(doc, index, registry)
    check('03-02 合法 objects-demo 无 block / error', !issues.some((issue) => issue.severity === 'block' || issue.severity === 'error'), issues)
    void doc
    void registry
  }
  {
    const raw = cloneJson(objectsDemoRaw) as JsonObject
    const tracks = (raw.timeline as JsonObject).tracks as JsonValue[]
    const clip = ((tracks[0] as JsonObject).clips as JsonValue[])[0] as JsonObject
    const objects = clip.objects as JsonObject
    objects['position.x'] = { value: 1, extra_member: 2 }
    const { doc, registry } = makeDoc(raw, index)
    const issues = localIssues(doc, index, registry)
    check('03-02 属性对象未知成员 → block L11', hasIssue(issues, 'L11', '未知成员'), issues)
  }
  {
    const raw = cloneJson(objectsDemoRaw) as JsonObject
    const tracks = (raw.timeline as JsonObject).tracks as JsonValue[]
    const clip = ((tracks[0] as JsonObject).clips as JsonValue[])[0] as JsonObject
    const objects = clip.objects as JsonObject
    objects['position.x'] = { keyframes: [{ time: 10, value: 1 }] }
    const { doc, registry } = makeDoc(raw, index)
    const issues = localIssues(doc, index, registry)
    const frames = ((registry.handles()[0].clip.objects as JsonObject)['position.x'] as JsonObject).keyframes as JsonValue[]
    check('03-02 超界帧保留（time > duration 不报错）', !issues.some((issue) => issue.code === 'L15') && frames.length === 1, issues)
  }
  {
    const cases: Array<[string, FieldEntry, JsonValue, boolean]> = []
    const boolEntry = index.search({ segment: 'tracks' }).find((entry) => entry.type === 'bool')
    const stringEntry = index.search({ segment: 'tracks' }).find((entry) => entry.type === 'string')
    const refEntry = index.search({ segment: 'tracks' }).find((entry) => entry.type === 'ref')
    if (boolEntry !== undefined) {
      cases.push(['bool 合法', boolEntry, true, true])
      cases.push(['bool 拒绝数字', boolEntry, 1, false])
    }
    if (stringEntry !== undefined) {
      cases.push(['string 合法', stringEntry, 'text', true])
      cases.push(['string 拒绝数字', stringEntry, 1, false])
    }
    if (refEntry !== undefined) {
      cases.push(['ref 合法', refEntry, 'minecraft:overworld', true])
      cases.push(['ref 拒绝数字', refEntry, 1, false])
    }
    for (const [label, entry, value, expected] of cases) {
      const result = checkValue(entry, value)
      check(`03-02 九种值：${label}`, result.ok === expected, result)
    }
    const enumDef = index.objectDef('OVERLAY', 'layer_type')
    check('03-02 九种值：enum 合法', enumDef !== undefined && checkValue(enumDef, 'fade').ok)
    check('03-02 九种值：enum 拒绝未知值', enumDef !== undefined && !checkValue(enumDef, 'nope').ok)
    const floatDef = index.objectDef('CAMERA', 'fov')
    check('03-02 九种值：float 合法', floatDef !== undefined && checkValue(floatDef, 70).ok)
    check('03-02 九种值：float 拒绝字符串数字', floatDef !== undefined && !checkValue(floatDef, '70').ok)
    const intDef = index.objectDef('CAMERA', 'cam_breath_seed')
    check('03-02 九种值：int 合法', intDef !== undefined && checkValue(intDef, 2).ok)
    check('03-02 九种值：int 拒绝小数', intDef !== undefined && !checkValue(intDef, 2.5).ok)
    const nullableDef = index.objectDef('CAMERA', 'yaw_lock')
    check('03-02 九种值：nullable_float 接受 null', nullableDef !== undefined && checkValue(nullableDef, null).ok)
    const structDef = index.objectDef('ADJUST', 'rgb_curve')
    check('03-02 九种值：struct 接受嵌套对象', structDef !== undefined && checkValue(structDef, { points: [[0, 0]] }).ok)
    const eventDef = index.objectDef('EVENT', 'event')
    check(
      '03-02 九种值：event_record 接受事件记录',
      eventDef !== undefined && checkValue(eventDef, { command: 'say x', event_type: 'command' }).ok,
    )
    check(
      '03-02 九种值：event_record 拒绝未知成员',
      eventDef !== undefined && !checkValue(eventDef, { command: 'say x', unknown: 1 }).ok,
    )
  }
  {
    const { doc } = makeDoc(objectsDemoRaw, index)
    const store = new DocStore({ catalog: index, metaKeys: keys })
    store.open(doc, 'redo.json')
    const handle = store.registry.handles()[0]
    const added = store.commit({ kind: 'object.addKeyframe', clipKey: handle.key, path: 'yaw', time: 2.5, value: 45 })
    const afterCommit = JSON.stringify(serializeDoc(store.doc as ScriptDoc))
    const undone = store.undo()
    const afterUndo = JSON.stringify(serializeDoc(store.doc as ScriptDoc))
    const redone = store.redo()
    check(
      '03-05 redo 恢复 commit 后的文档',
      added.ok && undone && redone && JSON.stringify(serializeDoc(store.doc as ScriptDoc)) === afterCommit
      && afterUndo !== afterCommit,
    )
  }

  // ── 3. 03-03 片段身份与选择 ───────────────────────────────────────────────
  {
    const twoClips: JsonValue = {
      meta: { id: 'two', name: 'Two', author: '' },
      timeline: {
        tracks: [
          {
            type: 'CAMERA',
            clips: [
              { start_time: 0, duration: 2, objects: { fov: { value: 70 } } },
              { start_time: 2, duration: 2, objects: { fov: { value: 80 } } },
            ],
          },
          { type: 'CAMERA', clips: [] },
        ],
      },
    }
    const { doc, registry } = makeDoc(twoClips, index)
    const store = new DocStore({ catalog: index, metaKeys: keys })
    store.open(doc, 'two.json')
    const handles = store.registry.handles()
    const secondKey = handles[1].key
    const firstKey = handles[0].key
    const moved = store.commit({ kind: 'clip.move', clipKey: secondKey, trackIndex: 0, index: 0 })
    check('03-03 重排成功', moved.ok, moved)
    check('03-03 重排后 clipKey 不变（有/无 id 都按对象引用）', store.registry.handle(secondKey) !== undefined && store.registry.handle(firstKey) !== undefined)
    const cross = store.commit({ kind: 'clip.move', clipKey: secondKey, trackIndex: 1, index: 0 })
    check('03-03 跨轨成功', cross.ok, cross)
    check('03-03 跨轨后 clipKey 不变', store.registry.handle(secondKey) !== undefined && store.registry.handle(secondKey)?.trackIndex === 1)
    const beforeUndoKey = store.registry.handle(secondKey)?.clip
    check('03-03 撤销前片段存在', beforeUndoKey !== undefined)
    store.undo()
    check('03-03 撤销后 clipKey 仍指向同一片段', store.registry.handle(secondKey) !== undefined)
    const duplicated = store.commit({ kind: 'clip.duplicate', clipKey: secondKey })
    check('03-03 复制成功', duplicated.ok, duplicated)
    check('03-03 复制获新键', store.registry.handles().length === 3 && new Set(store.registry.handles().map((handle) => handle.key)).size === 3)
    void registry
  }
  {
    const { doc } = makeDoc(collectionsRaw, index)
    const store = new DocStore({ catalog: index, metaKeys: keys })
    store.open(doc, 'collections.json')
    const handle = store.registry.handles().find((item) => item.id === 'clip_collect')
    if (handle === undefined) {
      check('03-03 collections 含 clip_collect', false)
      return
    }
    const renamed = store.commit({ kind: 'clip.setId', clipKey: handle.key, value: 'hero_collect', updateReferences: true })
    const root = store.doc?.root as JsonObject
    const paths = root.paths as JsonValue[]
    const bindings = root.rule_bindings as JsonValue[]
    check('03-03 改 id 成功', renamed.ok, renamed)
    check('03-03 改 id 同步 paths[0].clip', (paths[0] as JsonObject).clip === 'hero_collect')
    check('03-03 改 id 同步 rule_bindings[0].clip', (bindings[0] as JsonObject).clip === 'hero_collect')
    store.undo()
    const restored = store.doc?.root as JsonObject
    const restoredPaths = restored.paths as JsonValue[]
    const restoredBindings = restored.rule_bindings as JsonValue[]
    check(
      '03-03 撤销一次全回退',
      (restoredPaths[0] as JsonObject).clip === 'clip_collect'
      && (restoredBindings[0] as JsonObject).clip === 'clip_collect',
    )
    const removed = store.commit({ kind: 'clip.remove', clipKey: store.registry.handles().find((item) => item.id === 'clip_collect')?.key ?? '' })
    check('03-03 删除被引用片段被阻止', !removed.ok && removed.error?.includes('被引用') === true, removed)
    const afterRemove = store.doc?.root as JsonObject
    check('03-03 阻止后引用条目保留', ((afterRemove.paths as JsonValue[]).length === 1))
    const key = store.registry.handles().find((item) => item.id === 'clip_collect')?.key ?? ''
    const removeEndpoint = store.commit({ kind: 'object.removeKeyframe', clipKey: key, path: 'position.x', time: 0 })
    check('03-03 删除路径端点关键帧被阻止', !removeEndpoint.ok && removeEndpoint.error?.includes('路径端点') === true, removeEndpoint)
    // Java `ScriptValidator.java:757-780`：路径 to 必须与 from 相邻；端点区间内插帧会产生不合法文档，
    // 编辑器拦截这次编辑（不回退为只警告写入）。断言：拒绝、错误含「端点区间」、文档未变、撤销栈无新增。
    const rootBefore = store.doc?.root as JsonObject
    const collectBefore = (Array.isArray(rootBefore.clips) ? rootBefore.clips : []).find(
      (clip): clip is JsonObject => isJsonObject(clip) && clip.id === 'clip_collect',
    )
    const xBefore = collectBefore !== undefined && isJsonObject(collectBefore.objects) && isJsonObject(collectBefore.objects['position.x'])
      ? collectBefore.objects['position.x'].keyframes
      : undefined
    const xFrameCountBefore = Array.isArray(xBefore) ? xBefore.length : -1
    const pathsBefore = Array.isArray(rootBefore.paths) ? rootBefore.paths.length : -1
    const undoBefore = store.canUndo()
    const insert = store.commit({ kind: 'object.addKeyframe', clipKey: key, path: 'position.x', time: 1.5, value: 1 })
    const rootAfter = store.doc?.root as JsonObject
    const collectAfter = (Array.isArray(rootAfter.clips) ? rootAfter.clips : []).find(
      (clip): clip is JsonObject => isJsonObject(clip) && clip.id === 'clip_collect',
    )
    const xAfter = collectAfter !== undefined && isJsonObject(collectAfter.objects) && isJsonObject(collectAfter.objects['position.x'])
      ? collectAfter.objects['position.x'].keyframes
      : undefined
    const xFrameCountAfter = Array.isArray(xAfter) ? xAfter.length : -1
    check(
      '03-03 端点区间内插帧被拦截（不写入非法文档）',
      !insert.ok
        && insert.error?.includes('端点区间') === true
        && (Array.isArray(rootAfter.paths) ? rootAfter.paths.length : -1) === pathsBefore
        && xFrameCountAfter === xFrameCountBefore
        && store.canUndo() === undoBefore,
      { insert, pathsBefore, pathsAfter: Array.isArray(rootAfter.paths) ? rootAfter.paths.length : -1, xFrameCountBefore, xFrameCountAfter, undoBefore, undoAfter: store.canUndo() },
    )
  }
  {
    const { doc } = makeDoc(objectsDemoRaw, index)
    const store = new DocStore({ catalog: index, metaKeys: keys })
    store.open(doc, 'objects-demo.json')
    const handle = store.registry.handles()[0]
    store.select({ domain: 'keyframe', clipKey: handle.key, objectPath: 'yaw', keyframeTime: 2 })
    const add = store.commit({ kind: 'object.addKeyframe', clipKey: handle.key, path: 'position.x', time: 1, value: 1 })
    check('03-03 为选择测试补 position.x@1', add.ok, add)
    const remove = store.commit({ kind: 'object.removeKeyframe', clipKey: handle.key, path: 'position.x', time: 1 })
    const selection = store.session.selection
    check(
      '03-03 删除别的属性帧后选择仍指 yaw@2',
      remove.ok && selection.domain === 'keyframe' && selection.objectPath === 'yaw' && selection.keyframeTime === 2,
      selection,
    )
    const repaired = repairSelection(store.doc as ScriptDoc, store.registry, { domain: 'keyframe', clipKey: handle.key, objectPath: 'yaw', keyframeTime: 99 })
    check('03-03 不存在的帧降级到属性域', repaired.domain === 'object' && repaired.objectPath === 'yaw', repaired)
  }
  {
    const sources = await readdir(DOC_DIR)
    let offender = ''
    for (const name of sources) {
      if (!name.endsWith('.ts') || name === 'verify.ts') {
        continue
      }
      const text = await readSource(name)
      if (/\bselection\.track\b/.test(text) || text.includes('selectedClips') || text.includes('.selection.keyframe]')) {
        offender = name
        break
      }
    }
    check('03-03 grep selection.track / 下标选择 0 命中', offender === '', offender)
  }

  // ── 4. 03-04 无损序列化 ───────────────────────────────────────────────────
  {
    const validFiles = ['objects-demo.json', 'value.json', 'step.json', 'collections.json', 'seven-tracks.json', 'meta.json']
    for (const file of validFiles) {
      const raw = await readJson(`valid/${file}`)
      const parsed = parseDoc(raw, { metaKeys: keys })
      if (!parsed.ok) {
        check(`03-04 ${file} 可解析`, false, parsed.issues)
        continue
      }
      const out = serializeDoc(parsed.doc)
      check(`03-04 ${file} serialize(load(R)) 与 R 语义相等`, sameJson(out, raw), out)
    }
  }
  {
    const raw = cloneJson(objectsDemoRaw) as JsonObject
    const tracks = (raw.timeline as JsonObject).tracks as JsonValue[]
    const objects = ((tracks[0] as JsonObject).clips as JsonValue[])[0] as JsonObject
    const properties = objects.objects as JsonObject
    properties['position.x'] = { keyframes: [] }
    properties.yaw_lock = { value: null }
    const { doc } = makeDoc(raw, index)
    const out = serializeDoc(doc)
    const outObjects = (((((out.timeline as JsonObject).tracks as JsonValue[])[0] as JsonObject).clips as JsonValue[])[0] as JsonObject).objects as JsonObject
    check('03-04 空 keyframes 保留', sameJson((outObjects['position.x'] as JsonObject).keyframes as JsonValue, []))
    check('03-04 nullable null 保留', (outObjects.yaw_lock as JsonObject).value === null)
  }
  {
    const adjust = cloneJson(sevenTracksRaw) as JsonObject
    const tracks = (adjust.timeline as JsonObject).tracks as JsonValue[]
    const adjustTrack = tracks.find((track) => isJsonObject(track) && track.type === 'ADJUST') as JsonObject
    const clip = (adjustTrack.clips as JsonValue[])[0] as JsonObject
    ;(clip.objects as JsonObject).rgb_curve = { value: { points: [[0, 0], [1, 1]] } }
    const { doc, registry } = makeDoc(adjust, index)
    const issues = localIssues(doc, index, registry)
    check('03-04 STRUCT 嵌套数组原样（本地检查无 block）', !issues.some((issue) => issue.severity === 'block'), issues)
    const out = serializeDoc(doc)
    const outTracks = (out.timeline as JsonObject).tracks as JsonValue[]
    const outAdjust = outTracks.find((track) => isJsonObject(track) && track.type === 'ADJUST') as JsonObject
    const outObjects = ((outAdjust.clips as JsonValue[])[0] as JsonObject).objects as JsonObject
    check(
      '03-04 STRUCT 嵌套数组保存原样',
      sameJson(((outObjects.rgb_curve as JsonObject).value as JsonObject).points as JsonValue, [[0, 0], [1, 1]]),
    )
  }
  {
    const { doc } = makeDoc(sevenTracksRaw, index)
    const store = new DocStore({ catalog: index, metaKeys: keys })
    store.open(doc, 'seven-tracks.json')
    const out = serializeDoc(doc)
    const tracks = (out.timeline as JsonObject).tracks as JsonValue[]
    const eventTrack = tracks.find((track) => isJsonObject(track) && track.type === 'EVENT') as JsonObject
    const eventObjects = ((eventTrack.clips as JsonValue[])[0] as JsonObject).objects as JsonObject
    const record = ((eventObjects.event as JsonObject).keyframes as JsonValue[])[0] as JsonObject
    check(
      '03-04 事件记录原样',
      sameJson((record.value as JsonObject).command as JsonValue, 'say seven_tracks')
      && sameJson((record.value as JsonObject).event_type as JsonValue, 'command'),
    )
    store.setTrackMuted('AUDIO', 2, true)
    const preview = serializeForPreview(doc, (_track, trackIndex) => store.isAudioMuted(trackIndex))
    const previewTracks = (preview.timeline as JsonObject).tracks as JsonValue[]
    const audioPreview = previewTracks.find((track) => isJsonObject(track) && track.type === 'AUDIO') as JsonObject
    const audioDoc = tracks.find((track) => isJsonObject(track) && track.type === 'AUDIO') as JsonObject
    check('03-04 静音 AUDIO 推送副本 clips=[]', sameJson(audioPreview.clips as JsonValue, []))
    check('03-04 静音 AUDIO 文档与保存内容仍在', Array.isArray(audioDoc.clips) && (audioDoc.clips as JsonValue[]).length === 1)
    doc.authoring.internal = 'x'
    check('03-04 authoring 不写盘', !Object.prototype.hasOwnProperty.call(serializeDoc(doc), 'authoring'))
  }

  // ── 5. 03-05 状态与命令撤销 ───────────────────────────────────────────────
  {
    const { doc } = makeDoc(objectsDemoRaw, index)
    const store = new DocStore({ catalog: index, metaKeys: keys })
    store.open(doc, 'objects-demo.json')
    const initial = JSON.stringify(serializeDoc(doc))
    const handle = store.registry.handles()[0]
    for (const time of [0.5, 1.5, 2.5]) {
      const result = store.commit({ kind: 'object.addKeyframe', clipKey: handle.key, path: 'yaw', time, value: 10 })
      check(`03-05 commit 第 ${time} 次成功`, result.ok, result)
    }
    check('03-05 3 次 commit 后撤销栈 = 3', store.undoDepth() === 3)
    check('03-05 undo 3 次都成功', store.undo() && store.undo() && store.undo())
    check('03-05 撤销 3 次回到初始', JSON.stringify(serializeDoc(store.doc as ScriptDoc)) === initial)
    const failing = store.commit({ kind: 'object.addKeyframe', clipKey: handle.key, path: 'orient', time: 1, value: 'x' })
    check('03-05 非法命令（mode=value 加帧）失败', !failing.ok, failing)
    check('03-05 失败后撤销栈不变', store.undoDepth() === 0)
    const yawFrames = (store.registry.handles()[0].clip.objects as JsonObject).yaw as JsonObject
    check('03-05 失败后文档不变', Array.isArray(yawFrames.keyframes) && yawFrames.keyframes.length === 2)
    const move = store.commit({ kind: 'object.moveKeyframe', clipKey: handle.key, path: 'yaw', from: 1, to: 2 })
    check('03-05 移动帧到已存在时间失败并回滚', !move.ok && move.error !== undefined, move)
    store.doc!.authoring.undefinedField = undefined
    const committed = store.commit({ kind: 'meta.set', key: 'name', value: 'Renamed' })
    check('03-05 带 undefined 的 authoring 可提交', committed.ok, committed)
    check('03-05 undo 恢复 authoring', store.undo() && Object.prototype.hasOwnProperty.call(store.doc!.authoring, 'undefinedField'))
  }
  // ── 5b. 06-05 连续编辑合并（同一串只产生一个撤销项） ─────────────────────
  {
    const { doc } = makeDoc(objectsDemoRaw, index)
    let clock = 1000
    const store = new DocStore({
      catalog: index,
      metaKeys: keys,
      coalesceWindowMs: 400,
      now: () => clock,
    })
    store.open(doc, 'objects-demo.json')
    const handle = store.registry.handles()[0]
    store.commit({ kind: 'object.addKeyframe', clipKey: handle.key, path: 'yaw', time: 1, value: 0 })
    const baseline = store.undoDepth()
    const before = JSON.stringify(serializeDoc(store.doc as ScriptDoc))

    // 窗口内同一串：3 次改同一节点值只产生 1 个撤销项。
    for (const value of [10, 20, 30]) {
      clock += 100
      const result = store.commit(
        { kind: 'object.setKeyframeValue', clipKey: handle.key, path: 'yaw', time: 1, value },
        `yaw@1`,
      )
      check(`06-05 同串第 ${value} 次提交成功`, result.ok, result)
    }
    check('06-05 窗口内同串只加 1 个撤销项', store.undoDepth() === baseline + 1, store.undoDepth())
    const yaw = (store.registry.handles()[0].clip.objects as JsonObject).yaw as JsonObject
    const frames = yaw.keyframes as JsonValue[]
    check('06-05 同串编辑后值是最后一次输入', isJsonObject(frames[0]) && frames[0].value === 30, frames[0])

    // 撤销一次回到该串开始之前（值仍是 0），不是回到上一次输入。
    check('06-05 撤销一次回到串开始前', store.undo())
    check('06-05 撤销后文档等于串开始前', JSON.stringify(serializeDoc(store.doc as ScriptDoc)) === before)
    check('06-05 撤销后撤销栈回到基线', store.undoDepth() === baseline, store.undoDepth())

    // 窗口外：新串必须有自己的撤销项。
    store.redo()
    clock += 1000
    store.commit({ kind: 'object.setKeyframeValue', clipKey: handle.key, path: 'yaw', time: 1, value: 40 }, 'yaw@1')
    check('06-05 窗口外另起一个撤销项', store.undoDepth() === baseline + 2, store.undoDepth())

    // 串身份变化：立刻打断合并。
    store.commit({ kind: 'object.setKeyframeValue', clipKey: handle.key, path: 'yaw', time: 1, value: 50 }, 'yaw@2')
    check('06-05 串身份变化另起一个撤销项', store.undoDepth() === baseline + 3, store.undoDepth())

    // 撤销本身打断合并：撤销后再提交必须新开一个串。
    store.undo()
    clock += 100
    store.commit({ kind: 'object.setKeyframeValue', clipKey: handle.key, path: 'yaw', time: 1, value: 60 }, 'yaw@2')
    check('06-05 撤销后重新开串', store.undoDepth() === baseline + 3, store.undoDepth())
  }
  {
    const sources = await readdir(DOC_DIR)
    let offender = ''
    for (const name of sources) {
      if (!name.endsWith('.ts') || name === 'verify.ts') {
        continue
      }
      const text = await readSource(name)
      if (text.includes('total_duration')) {
        offender = name
        break
      }
    }
    check('03-05 grep 时间线总时长 0 命中', offender === '', offender)
  }

  // ── 6. 03-06 校验分层 ─────────────────────────────────────────────────────
  {
    const { doc, registry } = makeDoc(objectsDemoRaw, index)
    const issues = localIssues(doc, index, registry)
    check('03-06 合法 CAMERA 片段本地检查空', issues.length === 0, issues)
  }
  {
    const raw = cloneJson(objectsDemoRaw) as JsonObject
    ;(raw.meta as JsonObject).version = 3
    const { doc, registry } = makeDocLenient(raw, index)
    const issues = localIssues(doc, index, registry)
    check('03-06 meta.version → block', hasIssue(issues, 'L02') && issues.some((issue) => issue.jsonPath === 'meta.version' && issue.severity === 'block'), issues)
  }
  {
    const raw = cloneJson(stepRaw) as JsonObject
    const tracks = (raw.timeline as JsonObject).tracks as JsonValue[]
    const clip = ((tracks[0] as JsonObject).clips as JsonValue[])[0] as JsonObject
    const objects = clip.objects as JsonObject
    const y = objects['position.y'] as JsonObject
    y.keyframes = (y.keyframes as JsonValue[]).filter((frame) => isJsonObject(frame) && frame.time !== 2)
    const z = objects['position.z'] as JsonObject
    z.keyframes = (z.keyframes as JsonValue[]).filter((frame) => isJsonObject(frame) && frame.time !== 2)
    const { doc, registry } = makeDoc(raw, index)
    const issues = localIssues(doc, index, registry)
    const switchIssue = issues.find((issue) => issue.code === 'L24')
    check('03-06 切换点缺轴 → error', switchIssue?.severity === 'error', issues)
    check(
      '03-06 切换点提示缺 position.y / position.z',
      switchIssue !== undefined && switchIssue.message.includes('position.y') && switchIssue.message.includes('position.z'),
      switchIssue,
    )
  }
  {
    const raw = await readJson('invalid/paths-not-adjacent.json')
    const { doc, registry } = makeDoc(raw, index)
    const issues = localIssues(doc, index, registry)
    check('03-06 端点不相邻 → block L27', hasIssue(issues, 'L27', '相邻'), issues)
  }
  {
    const raw: JsonValue = {
      meta: { id: 'absolute_base', name: 'Absolute Base', author: '' },
      timeline: {
        tracks: [
          {
            type: 'CAMERA',
            clips: [
              {
                start_time: 0,
                duration: 2,
                objects: {
                  position_mode: { value: 'absolute' },
                  position_space: { value: 'base' },
                  'position.x': { value: 0 },
                  'position.y': { value: 0 },
                  'position.z': { value: 0 },
                },
              },
            ],
          },
        ],
      },
    }
    const { doc, registry } = makeDoc(raw, index)
    const issues = localIssues(doc, index, registry)
    check('03-06 absolute + base → error L20', hasIssue(issues, 'L20', 'position_space=base'), issues)
    check('03-06 absolute + base 不阻断保存（severity=error）', issues.every((issue) => issue.severity !== 'block' || issue.code !== 'L20'))
  }
  {
    const raw: JsonValue = {
      meta: { id: 'overlap', name: 'Overlap', author: '' },
      timeline: {
        tracks: [
          {
            type: 'CAMERA',
            clips: [
              { start_time: 0, duration: 3, objects: { fov: { value: 70 } } },
              { start_time: 1, duration: 3, objects: { fov: { value: 80 } } },
            ],
          },
        ],
      },
    }
    const { doc, registry } = makeDoc(raw, index)
    const issues = localIssues(doc, index, registry)
    check('03-06 片段重叠 → 无 issue', issues.length === 0, issues)
  }
  {
    // 本套 03-06 非法夹具（非 behavior）；第 11 轮新增的 behavior-* 夹具按合同码逐件核对，
    // 覆盖在 `src/workbench/verify-11.ts` 与夹具 README 表，不在此循环内做中文子串匹配。
    const allNames = (await readdir(new URL('invalid/', FIXTURES))).filter((name) => name.endsWith('.json') && name !== 'index.json')
    const names = allNames.filter((name) => !name.startsWith('behavior-'))
    let matched = 0
    for (const name of names) {
      const text = await readFile(new URL(`invalid/${name}`, FIXTURES), 'utf8')
      const raw = JSON.parse(text) as JsonObject
      const expectRaw = raw.expect
      const expectations = Array.isArray(expectRaw) ? expectRaw.filter((item): item is string => typeof item === 'string') : []
      const { doc, registry } = makeDocLenient(raw, index)
      const issues = localIssues(doc, index, registry)
      const hit = issues.some((issue) => expectations.some((keyword) => issue.message.includes(keyword)))
      if (hit) {
        matched += 1
      } else {
        check(`03-06 invalid/${name} 本地检查命中 [${expectations.join('|')}]`, false, issues)
      }
    }
    check(`03-06 本套 20 件非法夹具全部命中（${matched}/${names.length}）`, matched === names.length && names.length === 20, { matched, total: names.length })
  }
  {
    const { doc, registry } = makeDoc(objectsDemoRaw, index)
    const issues = localIssues(doc, index, registry)
    const allowed = /^L(0[1-9]|1[0-9]|2[0-9]|3[0-4])$/
    check('03-06 本地 issue code 全在 L01–L34 封闭集合', issues.every((issue) => allowed.test(issue.code)), issues.map((issue) => issue.code))
  }
  {
    const store = new DocStore({ catalog: index, metaKeys: keys })
    const parsed = parseDoc(objectsDemoRaw, { metaKeys: keys })
    if (!parsed.ok) {
      check('03-06 校验桥初始化', false)
    } else {
      store.open(parsed.doc, 'objects-demo.json')
      const transport = new MemoryTransport()
      transport.validateResult = { ok: false, issues: ['[警告] timeline.tracks[0].clips[0].objects.yaw: 示例警告', 'timeline.tracks[0].clips[0].objects.fov: 示例错误'] }
      const bridge = new ValidationBridge({ transport, store, debounceMs: 1 })
      await bridge.flush()
      const serverIssues = store.derived.serverIssues
      check('03-06 服务端 issue 解析为 warn / error', serverIssues.length === 2 && serverIssues[0].severity === 'warn' && serverIssues[1].severity === 'error', serverIssues)
      check('03-06 服务端 issue 尽力定位 clipKey', serverIssues[0].clipKey === store.registry.handles()[0].key, serverIssues[0])
      store.setConnected(false)
      check('03-06 断连保留 issue 并标过期', store.derived.serverIssuesStale && store.derived.serverIssues.every((issue) => issue.stale === true))
      const located = parseServerIssue('无法定位的文本', store.doc as ScriptDoc, store.registry)
      check('03-06 无法定位时保留原文不猜', located.jsonPath === '<server>' && located.clipKey === undefined, located)
      bridge.dispose()
    }
  }

  // ── 7. 03-07 打开 / 新建 / 保存 / 推送 ───────────────────────────────────
  {
    const transport = new MemoryTransport()
    transport.files.set('a.json', JSON.stringify(objectsDemoRaw))
    const store = new DocStore({ catalog: index, metaKeys: keys })
    const io = new DocIo({ transport, catalog: index, metaKeys: keys, store, debounceMs: 1, hash: async (text) => `h:${text.length}:${text.slice(0, 16)}` })
    const opened = await io.open('a.json')
    check('03-07 打开成功', opened.ok, opened)
    check('03-07 打开后 dirty=false', !store.dirty)
    // 检查器改版：打开脚本先显示脚本参数，不再自动选中第一个 CAMERA 片段。
    check('03-07 打开后选择为空（脚本参数）', store.session.selection.domain === 'none', store.session.selection)
    check('03-07 打开后推送一次 + seek(0)', transport.pushes.length === 1 && transport.seeks[0] === 0)
    const saved = await io.save()
    check('03-07 无修改保存成功', saved.ok, saved)
    check('03-07 保存内容与原文语义相等', sameJson(JSON.parse(transport.files.get('a.json') as string) as JsonValue, objectsDemoRaw))
    check('03-07 保存后 dirty=false', !store.dirty)
    io.dispose()
  }
  {
    const transport = new MemoryTransport()
    const store = new DocStore({ catalog: index, metaKeys: keys })
    const io = new DocIo({ transport, catalog: index, metaKeys: keys, store, debounceMs: 1 })
    const created = await io.newDocument()
    check('03-07 新建成功', created.ok, created)
    check('03-07 新建即脏', store.dirty)
    const tracks = (store.doc?.root.timeline as JsonObject).tracks as JsonValue[]
    check('03-07 新建 7 条内置轨道', tracks.length === 7 && tracks.every((track) => isJsonObject(track) && Array.isArray(track.clips)))
    const camera = tracks.find((track) => isJsonObject(track) && track.type === 'CAMERA') as JsonObject
    const guide = (camera.clips as JsonValue[])[0] as JsonObject
    const objects = guide.objects as JsonObject
    check(
      '03-07 引导片段全部固定值',
      (objects.position_mode as JsonObject).value === 'relative'
      && (objects['position.y'] as JsonObject).value === 2
      && (objects.fov as JsonObject).value === 70
      && (objects.transition as JsonObject).value === 'cut'
      && !Object.prototype.hasOwnProperty.call(objects['position.y'] as JsonObject, 'keyframes'),
    )
    check('03-07 新建不自动保存', transport.files.size === 0)
    const firstPath = store.session.currentPath ?? ''
    transport.files.set(firstPath, JSON.stringify({ meta: {}, timeline: {} }))
    const conflict = await io.save()
    check('03-07 首次保存不得覆盖已有文件', !conflict.ok && conflict.reason === 'needs-path', conflict)
    io.dispose()
  }
  {
    const transport = new MemoryTransport()
    transport.files.set('blocked.json', JSON.stringify(objectsDemoRaw))
    const store = new DocStore({ catalog: index, metaKeys: keys })
    const io = new DocIo({ transport, catalog: index, metaKeys: keys, store, debounceMs: 1 })
    await io.open('blocked.json')
    const handle = store.registry.handles()[0]
    const objects = handle.clip.objects as JsonObject
    objects.orient = { keyframes: [{ time: 0, value: 'manual' }] }
    store.recomputeDerived()
    const saved = await io.save()
    check('03-07 有 block issue 时保存中止', !saved.ok && saved.reason === 'blocked', saved)
    check('03-07 中止后文件未被改动', sameJson(JSON.parse(transport.files.get('blocked.json') as string) as JsonValue, objectsDemoRaw))
    delete objects.orient
    const committed = store.commit({ kind: 'meta.set', key: 'name', value: 'Dirty Name' })
    check('03-07 提交后 dirty=true', committed.ok && store.dirty, committed)
    transport.failSave = true
    const failed = await io.save()
    check('03-07 保存失败 dirty 不清', !failed.ok && store.dirty, failed)
    io.dispose()
  }
  {
    const transport = new MemoryTransport()
    transport.files.set('audio.json', JSON.stringify(sevenTracksRaw))
    const store = new DocStore({ catalog: index, metaKeys: keys })
    const io = new DocIo({ transport, catalog: index, metaKeys: keys, store, debounceMs: 1 })
    await io.open('audio.json')
    const audioIndex = ((store.doc?.root.timeline as JsonObject).tracks as JsonValue[]).findIndex((track) => isJsonObject(track) && track.type === 'AUDIO')
    store.setTrackMuted('AUDIO', audioIndex, true)
    transport.pushes.length = 0
    const pushed = await io.push()
    const payload = JSON.parse(transport.pushes[0]) as JsonObject
    const payloadTracks = (payload.timeline as JsonObject).tracks as JsonValue[]
    const payloadAudio = payloadTracks.find((track) => isJsonObject(track) && track.type === 'AUDIO') as JsonObject
    check('03-07 静音 AUDIO 推送 clips=[]', pushed.ok && sameJson(payloadAudio.clips as JsonValue, []))
    const docTracks = (store.doc?.root.timeline as JsonObject).tracks as JsonValue[]
    const docAudio = docTracks.find((track) => isJsonObject(track) && track.type === 'AUDIO') as JsonObject
    check('03-07 静音不污染文档', Array.isArray(docAudio.clips) && (docAudio.clips as JsonValue[]).length === 1)
    transport.files.delete('audio.json')
    const saved = await io.save()
    check('03-07 保存文件仍含 AUDIO clips', saved.ok && JSON.stringify(JSON.parse(transport.files.get('audio.json') as string)).includes('"sound"'))
    io.dispose()
  }
  {
    const transport = new MemoryTransport()
    transport.files.set('conflict.json', JSON.stringify(objectsDemoRaw))
    const store = new DocStore({ catalog: index, metaKeys: keys })
    const io = new DocIo({ transport, catalog: index, metaKeys: keys, store, debounceMs: 1, hash: async (text) => `h:${text.length}:${text.slice(0, 16)}` })
    await io.open('conflict.json')
    const changed = cloneJson(objectsDemoRaw) as JsonObject
    ;(changed.meta as JsonObject).name = 'External Change'
    transport.files.set('conflict.json', JSON.stringify(changed))
    const saved = await io.save()
    check('03-07 外部改动 → 冲突不覆盖', !saved.ok && saved.reason === 'conflict', saved)
    io.dispose()
  }
  {
    const transport = new MemoryTransport()
    const store = new DocStore({ catalog: index, metaKeys: keys })
    const io = new DocIo({ transport, catalog: index, metaKeys: keys, store, debounceMs: 1 })
    await io.newDocument()
    const first = store.session.currentPath as string
    transport.files.set(first, '{}')
    const blocked = await io.save()
    check('03-07 新建后目标路径已存在 → needs-path（不覆盖）', !blocked.ok && blocked.reason === 'needs-path', blocked)
    const second = await io.newDocument()
    check('03-07 再次新建仍可用（服务端临时名）', second.ok)
    store.session.currentPath = first
    const blockedAgain = await io.save()
    check('03-07 第二次存同名文件被阻止', !blockedAgain.ok && blockedAgain.reason === 'needs-path', blockedAgain)
    io.dispose()
  }
  {
    const changedCatalog = mutateCatalog(catalog, (copy) => {
      const nameEntry = copy.meta.find((entry) => entry.key === 'name')
      if (nameEntry !== undefined) {
        nameEntry.default = '目录默认名'
      }
    })
    const changedIndex = indexCatalog(changedCatalog)
    const doc = buildNewDoc(changedIndex)
    check('03-07 新建 meta 默认值来自 02 目录（改目录即变）', (doc.meta as JsonObject).name === '目录默认名', doc.meta)
  }

  // ── 8. 03-08 字段目录接入 ────────────────────────────────────────────────
  {
    const { doc, registry } = makeDoc(objectsDemoRaw, index)
    const binding = bindDocument(doc, index, 'hash-a', registry)
    const camera = binding.tracks[0]
    check('03-08 CAMERA 轨道绑定成功', camera !== undefined && camera.known && !camera.thirdParty)
    const x = camera.objects.get('position.x')
    const y = camera.objects.get('position.y')
    const z = camera.objects.get('position.z')
    check(
      '03-08 position.x/y/z 三条独立 ObjectDef',
      x?.def?.key === 'position.x' && y?.def?.key === 'position.y' && z?.def?.key === 'position.z'
      && x.def.type === 'float' && y.def.type === 'float' && z.def.type === 'float',
    )
    check('03-08 catalogHash 记录在绑定上', bindingMatches(binding, 'hash-a') && !bindingMatches(binding, 'hash-b'))
    const playControl = camera.playControl.map((entry) => entry.key)
    check('03-08 playControl 5 字段来自目录', playControl.length === 5, playControl)
  }
  {
    const raw = cloneJson(objectsDemoRaw) as JsonObject
    const tracks = (raw.timeline as JsonObject).tracks as JsonValue[]
    const clip = ((tracks[0] as JsonObject).clips as JsonValue[])[0] as JsonObject
    ;(clip.objects as JsonObject).no_such_path = { value: 1 }
    const { doc, registry } = makeDoc(raw, index)
    const issues = localIssues(doc, index, registry)
    const hit = issues.find((issue) => issue.code === 'L34' && issue.objectPath === 'no_such_path')
    check('03-08 未登记路径 → block 并定位片段 + 路径', hit?.severity === 'block' && hit.clipKey === registry.handles()[0].key, issues)
    check('03-08 未登记路径原值保留', isJsonObject((registry.handles()[0].clip.objects as JsonObject).no_such_path))
  }
  {
    const raw: JsonValue = {
      meta: { id: 'third_party', name: 'Third Party', author: '' },
      timeline: {
        tracks: [
          {
            type: 'modid:foo',
            clips: [
              {
                start_time: 0,
                duration: 1,
                objects: {
                  custom_path: { value: 3 },
                },
              },
            ],
          },
        ],
      },
    }
    const { doc, registry } = makeDoc(raw, index)
    const issues = localIssues(doc, index, registry)
    check('03-08 第三方轨道能打开', true)
    check('03-08 第三方轨道只报 info，不报未知字段', issues.every((issue) => issue.code === 'L23' && issue.severity === 'info'), issues)
    check('03-08 第三方轨道原样保存', sameJson(serializeDoc(doc), raw))
  }
  {
    const changedCatalog = mutateCatalog(catalog, (copy) => {
      const overlay = copy.tracks.OVERLAY
      const layerType = overlay.objects.find((entry) => entry.key === 'layer_type')
      if (layerType !== undefined) {
        layerType.enumValues = ['image', 'subtitle']
      }
    })
    const changedIndex = indexCatalog(changedCatalog)
    const { doc, registry } = makeDoc(sevenTracksRaw, changedIndex)
    const issues = localIssues(doc, changedIndex, registry)
    check(
      '03-08 目录 enum 变化 → 既有值标 error（不改写）',
      issues.some((issue) => issue.code === 'L13' && issue.severity === 'error' && issue.message.includes('不在枚举内')),
      issues,
    )
    const value = (((((doc.timeline.tracks as JsonValue[]).find((track) => isJsonObject(track) && track.type === 'OVERLAY') as JsonObject).clips as JsonValue[])[0] as JsonObject).objects as JsonObject).layer_type as JsonObject
    check('03-08 目录变化不改作者值', value.value === 'fade')
    const binding = bindDocument(doc, changedIndex, 'hash-new', registry)
    check('03-08 重绑使用新目录指纹', bindingMatches(binding, 'hash-new'))
  }
  {
    const sources = await readdir(DOC_DIR)
    let offender = ''
    for (const name of sources) {
      if (!name.endsWith('.ts') || name === 'verify.ts' || name === 'types.ts') {
        continue
      }
      const text = await readSource(name)
      if (/enumValues\s*:\s*\[/.test(text) || /\bmin\s*:\s*-?\d/.test(text) || /\bmax\s*:\s*-?\d/.test(text)) {
        offender = name
        break
      }
    }
    check('03-08 grep 文档模型 0 处硬编码 enumValues / min / max', offender === '', offender)
  }

  // ── 8.5 04 消费面：docRevision / clipKeys / selectionInvalid（04-05 / 04-10） ──
  {
    check(
      '04 消费面：doc barrel 导出 DocStore / DocIo / validateStructure / serializeDoc',
      typeof docBarrel.DocStore === 'function'
        && typeof docBarrel.DocIo === 'function'
        && typeof docBarrel.validateStructure === 'function'
        && typeof docBarrel.serializeDoc === 'function',
      Object.keys(docBarrel).length,
    )

    const raw: JsonValue = {
      meta: { id: 'revdoc', name: 'Rev Doc', author: '' },
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
    const parsed = parseDoc(raw, { metaKeys: keys })
    if (!parsed.ok) {
      throw new Error('revision 夹具无法解析')
    }
    const store = new DocStore({ catalog: index, metaKeys: keys })
    check('04-05 revision 初始为 0', store.revision === 0, store.revision)
    store.open(parsed.doc, 'rev.json')
    check('04-05 open 后 revision 递增', store.revision === 1, store.revision)
    check('04-05 open 清空 clipKeys', store.session.clipKeys.length === 0, store.session.clipKeys)

    const handles = store.registry.handles()
    check('04-05 夹具含两个片段', handles.length === 2, handles.length)
    const first = handles[0].key
    const second = handles[1].key

    store.select({ domain: 'clip', clipKey: first })
    check(
      '04-05 select 维护单元素 clipKeys',
      store.session.clipKeys.length === 1 && store.session.clipKeys[0] === first,
      store.session.clipKeys,
    )
    check('04-05 select 清除失效记录', store.session.selectionInvalid === null)

    store.selectMany([first, second, second])
    check(
      '04-05 selectMany 去重并保持顺序',
      store.session.clipKeys.length === 2
        && store.session.clipKeys[0] === first
        && store.session.clipKeys[1] === second,
      store.session.clipKeys,
    )
    check(
      '04-05 selectMany 主选区取第一个',
      store.session.selection.domain === 'clip' && store.session.selection.clipKey === first,
      store.session.selection,
    )

    const beforeCommit = store.revision
    const committed = store.commit({ kind: 'object.setValue', clipKey: second, path: 'position.x', value: 7 })
    check('04-05 commit 成功', committed.ok, committed)
    check('04-05 commit 后 revision 递增', store.revision === beforeCommit + 1, store.revision)
    check('04-05 commit 后批选保留', store.session.clipKeys.length === 2, store.session.clipKeys)

    const beforeUndo = store.revision
    store.undo()
    check('04-05 undo 后 revision 递增', store.revision === beforeUndo + 1, store.revision)
    const beforeRedo = store.revision
    store.redo()
    check('04-05 redo 后 revision 递增', store.revision === beforeRedo + 1, store.revision)

    store.select({ domain: 'clip', clipKey: second })
    const removed = store.commit({ kind: 'clip.remove', clipKey: second })
    check('04-05 删除被选片段成功', removed.ok, removed)
    check('04-05 删除后选择退回 none', store.session.selection.domain === 'none', store.session.selection)
    check('04-05 删除后记录失效原因', store.session.selectionInvalid !== null, store.session.selectionInvalid)
    check('04-05 删除后批选剪枝', !store.session.clipKeys.includes(second), store.session.clipKeys)

    store.select({ domain: 'clip', clipKey: first })
    check('04-05 重新选择清空失效记录', store.session.selectionInvalid === null)
    check(
      '04-05 批选只含存活片段',
      store.session.clipKeys.every((key) => store.registry.handle(key) !== undefined),
      store.session.clipKeys,
    )
    store.selectMany(['missing-key'])
    check('04-05 selectMany 过滤不存在的键', store.session.clipKeys.length === 0, store.session.clipKeys)
    check('04-05 selectMany 过滤后选择为 none', store.session.selection.domain === 'none')

    const beforeClose = store.revision
    store.close()
    check('04 close 后没有文档', store.doc === null)
    check('04 close 后 revision 递增', store.revision === beforeClose + 1, store.revision)
    check('04 close 清空选择与批选', store.session.selection.domain === 'none' && store.session.clipKeys.length === 0)
    check('04 close 清空脏标记与历史', store.dirty === false && store.canUndo() === false)
    check('04 close 后 commit 被拒绝', store.commit({ kind: 'meta.set', key: 'name', value: 'x' }).ok === false)
  }

  // ── 9. 校验桥断连与推送 ack 边界（协议缺口记录） ─────────────────────────
  {
    const transport = new MemoryTransport()
    transport.files.set('ack.json', JSON.stringify(objectsDemoRaw))
    const store = new DocStore({ catalog: index, metaKeys: keys })
    const io = new DocIo({ transport, catalog: index, metaKeys: keys, store, debounceMs: 1 })
    await io.open('ack.json')
    transport.pushAck = false
    const pushed = await io.push()
    check('03-07 推送失败标「预览过期」', !pushed.ok && store.derived.previewStale)
    transport.pushAck = true
    await io.push()
    check('03-07 推送成功清「预览过期」', !store.derived.previewStale)
    io.dispose()
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
