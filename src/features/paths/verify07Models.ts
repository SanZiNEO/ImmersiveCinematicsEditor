/**
 * 07-09 数学模型编辑器自检切片（真 DocStore + 真 catalog + 真 commit）。
 *
 * 运行：`node --experimental-strip-types src/features/paths/verify07Models.ts`
 * 覆盖 07-09「六、实现结果」可自动化条目：
 * - 六通道默认未设置、摘要正确；类型摘要与保存 JSON 一致；
 * - chain / blend 递归编辑后写回结构正确；weight 越界 / chain 空 / blend 缺分支被拦；
 * - 深度 > 8、节点 > 32 禁用应用并给超限路径；四类参数越界字段级拦下；
 * - 未知类型只警告、可显式转 linear；未知参数保留、可显式清理；值域不匹配只警告；
 * - 重置为 linear 一次撤销可恢复；保存 / 重开模型树与未知字段原样；序列化不含 authoring。
 */
import type { CatalogIndex } from '../../core/schema/index.ts'
import { buildCatalog, indexCatalog } from '../../core/schema/index.ts'
import { metaKeys } from '../../core/doc/keys.ts'
import { parseDoc } from '../../core/doc/parse.ts'
import { serializeDoc } from '../../core/doc/serialize.ts'
import { DocStore } from '../../core/doc/store.ts'
import type { JsonObject, JsonValue, ScriptDoc } from '../../core/doc/types.ts'
import { sameJson } from '../../core/doc/json.ts'
import {
  MOTION_CHANNELS,
  channelDomain,
  channelSummary,
  channelValidation,
  channelOverLimit,
  countDepth,
  countNodes,
  discardDraft,
  isModelUnset,
  readDraft,
  resetModelValue,
  sampleModelResponse,
  serializeAppliedModel,
  writeDraft,
} from './modelEditor.ts'
import {
  addChainChildOnRaw,
  applyRaw,
  cleanUnknownParamsOnRaw,
  convertUnknownToLinearOnRaw,
  createDraft,
  moveChainChildOnRaw,
  removeChainChildOnRaw,
  replaceBlendChildOnRaw,
  serializeDraft,
  setParamOnRaw,
  setTypeOnRaw,
} from './curveEditorModel.ts'

export type SliceCheck = (label: string, condition: boolean, actual?: unknown) => void

function near(actual: number, expected: number, epsilon = 1e-9): boolean {
  return Math.abs(actual - expected) <= epsilon
}

function cameraScript(objects: JsonObject): JsonObject {
  return {
    meta: { id: 'verify07models', name: 'Verify 07 Models', author: '' },
    timeline: {
      tracks: [
        { type: 'CAMERA', clips: [{ id: 'c1', start_time: 0, duration: 2, objects }] },
      ],
    },
  }
}

function openStore(catalog: CatalogIndex, raw: JsonObject): { store: DocStore; clipKey: string; doc: ScriptDoc } {
  const keys = metaKeys(catalog)
  const parsed = parseDoc(raw, { metaKeys: keys })
  if (!parsed.ok) {
    throw new Error(`fixture parse failed: ${JSON.stringify(parsed.issues)}`)
  }
  const store = new DocStore({ catalog, metaKeys: keys })
  store.open(parsed.doc, 'verify07models.json')
  const handle = store.registry.handles()[0]
  return { store, clipKey: handle.key, doc: parsed.doc }
}

function clipObjects(store: DocStore): JsonObject {
  const tracks = store.doc!.timeline.tracks as unknown as JsonObject[]
  const clips = tracks[0].clips as unknown as JsonObject[]
  return clips[0].objects as JsonObject
}

function modelOf(objects: JsonObject, path: string): JsonValue | undefined {
  const property = objects[path]
  if (!isJsonObjectLike(property)) {
    return undefined
  }
  return property.value
}

function isJsonObjectLike(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function runModelChecks(check: SliceCheck): void {
  const catalog = indexCatalog(buildCatalog('verify-07'))

  // ── 六通道默认未设置、摘要与值域 ──────────────────────────────────────────
  for (const channel of MOTION_CHANNELS) {
    check(`${channel.field} 默认未设置`, isModelUnset(undefined))
    check(`${channel.field} 摘要为「未设置」`, channelSummary(undefined) === '未设置')
    check(`${channel.field} 值域 = ${channel.domain}`, channelDomain(channel.field) === channel.domain)
    const validation = channelValidation(undefined, channel.field)
    check(`${channel.field} 未设置无错误`, validation.valid, validation.errors)
  }

  // ── 类型摘要与写回 JSON 一致 ─────────────────────────────────────────────
  const typedCases: Array<{ name: string; model: JsonObject }> = [
    { name: 'linear', model: { type: 'linear' } },
    { name: 'spring', model: { type: 'spring', stiffness: 6, damping: 0.9, initial_velocity: 0 } },
    {
      name: 'chain',
      model: { type: 'chain', models: [{ type: 'exponential_smooth', tau: 0.2 }, { type: 'linear' }] },
    },
    {
      name: 'blend',
      model: { type: 'blend', a: { type: 'linear' }, b: { type: 'linear' }, weight: 0.3 },
    },
  ]
  for (const item of typedCases) {
    const saved = serializeAppliedModel(item.model)
    check(`${item.name} 写回保留原结构`, saved !== undefined && sameJson(saved, item.model), saved)
    const draft = createDraft(item.model)
    check(`${item.name} 摘要可生成`, channelSummary(item.model) === channelSummary(serializeDraft(draft)))
    check(`${item.name} 校验通过`, draft.validation.valid, draft.validation.errors)
  }

  // ── chain / blend 递归编辑后写回结构正确 ──────────────────────────────────
  {
    const source: JsonObject = {
      type: 'chain',
      models: [{ type: 'spring', stiffness: 8, damping: 0.75 }],
    }
    let draft = createDraft(source)
    let raw = addChainChildOnRaw(draft.raw, '')
    draft = applyRaw(draft, raw)
    check('chain 追加子模型后 3 个节点', countNodes(draft.raw) === 3, draft.raw)

    raw = setParamOnRaw(draft.raw, 'models[1]', 'type', undefined)
    raw = setTypeOnRaw(raw, 'models[1]', 'exponential_smooth')
    raw = setParamOnRaw(raw, 'models[1]', 'tau', 0.25)
    draft = applyRaw(draft, raw)
    const firstChild = (draft.root.children[0]?.raw as JsonObject)
    check('chain 首子模型保留 spring', firstChild?.type === 'spring')

    raw = moveChainChildOnRaw(draft.raw, '', 0, 1)
    draft = applyRaw(draft, raw)
    check('chain 子模型下移顺序正确', (draft.root.children[0]?.raw as JsonObject)?.type === 'exponential_smooth')

    raw = removeChainChildOnRaw(draft.raw, '', 0)
    draft = applyRaw(draft, raw)
    check('chain 删除子模型后回到 2 个', countNodes(draft.raw) === 2, draft.raw)

    const blendSource: JsonObject = {
      type: 'blend',
      a: { type: 'linear' },
      b: { type: 'ease_out' },
      weight: 0.4,
    }
    let blendDraft = createDraft(blendSource)
    let blendRaw = replaceBlendChildOnRaw(blendDraft.raw, '', 'b', { type: 'smoothstep' })
    blendDraft = applyRaw(blendDraft, blendRaw)
    check('blend 替换 b 分支', (blendDraft.root.children[1]?.raw as JsonObject)?.type === 'smoothstep')
    blendRaw = setParamOnRaw(blendDraft.raw, '', 'weight', 0.6)
    blendDraft = applyRaw(blendDraft, blendRaw)
    const savedBlend = serializeDraft(blendDraft)
    check('blend 写回 a/b/weight 齐全',
      isJsonObjectLike(savedBlend?.a) && isJsonObjectLike(savedBlend?.b) && savedBlend?.weight === 0.6,
      savedBlend)
  }

  // ── 结构 / 参数越界被拦（error 级，字段定位） ─────────────────────────────
  {
    const badWeight: JsonObject = { type: 'blend', a: { type: 'linear' }, b: { type: 'linear' }, weight: 1.2 }
    const weightIssues = channelValidation(badWeight, 'motion_fov')
    check('blend weight 越界拦下', !weightIssues.valid && weightIssues.errors.some((issue) => issue.field.endsWith('weight')), weightIssues.errors)

    const emptyChain: JsonObject = { type: 'chain', models: [] }
    const chainIssues = channelValidation(emptyChain, 'motion_yaw')
    check('chain 空子模型拦下', !chainIssues.valid && chainIssues.errors.some((issue) => issue.kind === 'structure'), chainIssues.errors)

    const missingBranch: JsonObject = { type: 'blend', a: { type: 'linear' }, weight: 0.5 }
    const branchIssues = channelValidation(missingBranch, 'motion_yaw')
    check('blend 缺 b 分支拦下', !branchIssues.valid && branchIssues.errors.some((issue) => issue.field.endsWith('b')), branchIssues.errors)

    const badTau: JsonObject = { type: 'exponential_smooth', tau: 0 }
    check('tau 非正拦下', !channelValidation(badTau, 'motion_fov').valid)
    const badStiffness: JsonObject = { type: 'spring', stiffness: 0, damping: 0.75 }
    check('stiffness 非正拦下', !channelValidation(badStiffness, 'motion_fov').valid)
    const badDamping: JsonObject = { type: 'spring', stiffness: 8, damping: -1 }
    check('damping 为负拦下', !channelValidation(badDamping, 'motion_fov').valid)
    const badVelocity: JsonObject = { type: 'inertia', stiffness: 8, damping: 0.75, initial_velocity: Infinity }
    check('initial_velocity 非有限拦下', !channelValidation(badVelocity, 'motion_fov').valid)
    const badBezier: JsonObject = { type: 'cubic_bezier', x1: 0.2, y1: 1.5, x2: 0.8, y2: 0.5 }
    const bezierIssues = channelValidation(badBezier, 'motion_fov')
    check('bezier 控制点越界拦下', !bezierIssues.valid && bezierIssues.errors.some((issue) => issue.field.endsWith('y1')), bezierIssues.errors)
  }

  // ── 深度 > 8 / 节点 > 32：应用禁用并给超限路径 ─────────────────────────────
  {
    let deep: JsonValue = { type: 'linear' }
    for (let depth = 0; depth < 8; depth += 1) {
      deep = { type: 'chain', models: [deep] }
    }
    check('深度 9 超限', channelOverLimit(deep) && countDepth(deep) > 8)
    const deepIssues = channelValidation(deep, 'motion_position')
    check('深度超限给错误与路径', !deepIssues.valid && deepIssues.limitPaths.length > 0, deepIssues.limitPaths)

    const many: JsonObject = {
      type: 'chain',
      models: new Array(33).fill(0).map(() => ({ type: 'linear' })),
    }
    check('节点 33 超限', channelOverLimit(many) && countNodes(many) > 32)
    const manyIssues = channelValidation(many, 'motion_position')
    check('节点超限给错误与路径', !manyIssues.valid && manyIssues.limitPaths.length > 0, manyIssues.limitPaths)

    const within: JsonObject = {
      type: 'chain',
      models: [{ type: 'spring', stiffness: 8, damping: 0.75 }, { type: 'blend', a: { type: 'linear' }, b: { type: 'linear' }, weight: 0.5 }],
    }
    check('合法组合不超限', !channelOverLimit(within) && countDepth(within) <= 8 && countNodes(within) <= 32)
  }

  // ── 未知类型：只警告，显式转 linear 后才变 ─────────────────────────────────
  {
    const unknown: JsonObject = { type: 'made_up', foo: 1 }
    const issues = channelValidation(unknown, 'motion_fov')
    check('未知类型无 error（只警告）', issues.valid && issues.warnings.some((issue) => issue.kind === 'unknown-type'), issues)

    let draft = createDraft(unknown)
    check('未知类型原文保留', sameJson(draft.raw, unknown))
    draft = applyRaw(draft, convertUnknownToLinearOnRaw(draft.raw, ''))
    const converted = serializeDraft(draft)
    check('显式转 linear 后 JSON 变 linear', sameJson(converted, { type: 'linear' }), converted)
    check('转换后未知参数不保留', converted !== undefined && !('foo' in converted))
  }

  // ── 未知参数：保留 + 警告，显式清理才移除 ──────────────────────────────────
  {
    const withUnknown: JsonObject = { type: 'spring', stiffness: 8, weird_param: 2 }
    const issues = channelValidation(withUnknown, 'motion_fov')
    check('未知参数只警告', issues.valid && issues.warnings.some((issue) => issue.kind === 'unknown-param'), issues)

    let draft = createDraft(withUnknown)
    const kept = serializeDraft(draft)
    check('未知参数写回保留', kept !== undefined && kept.weird_param === 2, kept)

    draft = applyRaw(draft, cleanUnknownParamsOnRaw(draft.raw, ''))
    const cleaned = serializeDraft(draft)
    check('显式清理后未知参数移除、声明参数保留',
      cleaned !== undefined && !('weird_param' in cleaned) && cleaned.stiffness === 8,
      cleaned)
  }

  // ── 值域不匹配只警告，不拦下 ──────────────────────────────────────────────
  {
    const mismatched: JsonObject = { type: 'linear', domain: 'vector' }
    const issues = channelValidation(mismatched, 'motion_fov')
    check('值域不匹配无 error', issues.valid)
    check('值域不匹配给警告', issues.warnings.some((issue) => issue.kind === 'domain'), issues.warnings)
  }

  // ── 草稿会话：按片段 + 路径保存，未提交不落盘 ──────────────────────────────
  {
    writeDraft('c1', 'motion_zoom', { type: 'spring', stiffness: 12 })
    const draft = readDraft('c1', 'motion_zoom')
    check('草稿按路径取回', draft.has && sameJson(draft.model, { type: 'spring', stiffness: 12 }), draft)
    discardDraft('c1', 'motion_zoom')
    check('丢弃草稿后无草稿', !readDraft('c1', 'motion_zoom').has)
  }

  // ── 真 store：重置为 linear 一次撤销可恢复旧树 ─────────────────────────────
  {
    const original: JsonObject = { type: 'spring', stiffness: 6, damping: 0.9 }
    const objects: JsonObject = { motion_zoom: { value: original } }
    const { store, clipKey } = openStore(catalog, cameraScript(objects))
    const before = modelOf(clipObjects(store), 'motion_zoom')
    check('提交前旧模型在文档里', sameJson(before, original), before)

    const resetCommit = store.commit({
      kind: 'object.setValue',
      clipKey,
      path: 'motion_zoom',
      value: resetModelValue(),
    })
    check('重置 linear 提交成功', resetCommit.ok, resetCommit)
    const afterReset = modelOf(clipObjects(store), 'motion_zoom')
    check('重置后为 linear', sameJson(afterReset, { type: 'linear' }), afterReset)

    const undone = store.undo()
    check('撤销成功', undone)
    const restored = modelOf(clipObjects(store), 'motion_zoom')
    check('撤销后旧树原样恢复', sameJson(restored, original), restored)
  }

  // ── 保存 / 重开：模型树与未知字段原样，序列化不含 authoring ─────────────────
  {
    const model: JsonObject = {
      type: 'chain',
      models: [
        { type: 'spring', stiffness: 8, damping: 0.75, author_extra: 'keep-me' },
        { type: 'blend', a: { type: 'linear' }, b: { type: 'ease_in_out' }, weight: 0.5 },
      ],
    }
    const { store, clipKey } = openStore(catalog, cameraScript({ motion_pitch: { value: model } }))
    const commit = store.commit({ kind: 'object.setValue', clipKey, path: 'motion_pitch', value: model })
    check('模型写入提交成功', commit.ok, commit)

    const text = JSON.stringify(serializeDoc(store.doc!))
    check('序列化不含 authoring', !text.includes('"authoring"'))
    check('序列化保留未知字段', text.includes('author_extra'))

    const reopened = parseDoc(JSON.parse(text), { metaKeys: metaKeys(catalog) })
    check('重开解析成功', reopened.ok)
    if (reopened.ok) {
      const reopenedTracks = reopened.doc.timeline.tracks as unknown as JsonObject[]
      const reopenedClips = reopenedTracks[0].clips as JsonObject[]
      const reopenedObjects = reopenedClips[0].objects as JsonObject
      const reopenedModel = modelOf(reopenedObjects, 'motion_pitch')
      check('重开后模型树原样', reopenedModel !== undefined && sameJson(reopenedModel, model), reopenedModel)
      const springChild = isJsonObjectLike(reopenedModel) && Array.isArray(reopenedModel.models)
        ? reopenedModel.models[0] as JsonObject
        : undefined
      check('重开后未知字段原样', springChild?.author_extra === 'keep-me', springChild)
    }
  }

  // ── 响应曲线示意：合法模型出样本，超限不画 ─────────────────────────────────
  {
    const linearSamples = sampleModelResponse({ type: 'linear' }, 'scalar', 17)
    check('linear 出 17 个样本', linearSamples !== null && linearSamples.length === 17)
    check('linear 端点 0 → 1',
      linearSamples !== null && near(linearSamples[0].values[0], 0) && near(linearSamples[16].values[0], 1))
    const vectorSamples = sampleModelResponse({ type: 'smoothstep' }, 'vector', 9)
    check('vector 通道三轴', vectorSamples !== null && vectorSamples[0].values.length === 3)
    let deep: JsonValue = { type: 'linear' }
    for (let depth = 0; depth < 8; depth += 1) {
      deep = { type: 'chain', models: [deep] }
    }
    check('超限模型不画预览', sampleModelResponse(deep, 'vector') === null)
  }
}

// ── 直跑段 ─────────────────────────────────────────────────────────────────

const direct = process.argv[1] !== undefined
  && process.argv[1].replace(/\\/g, '/').endsWith('verify07Models.ts')

if (direct) {
  let ok = 0
  let fail = 0
  runModelChecks((label, condition, actual) => {
    if (condition) {
      ok += 1
      console.log(`ok   ${label}`)
      return
    }
    fail += 1
    console.log(`FAIL ${label}: ${typeof actual === 'string' ? actual : JSON.stringify(actual)}`)
  })
  console.log(`summary ok=${ok} fail=${fail}`)
  if (fail > 0) {
    process.exitCode = 1
  }
}
