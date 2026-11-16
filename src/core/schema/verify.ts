/**
 * 本地验收入口：加载目录、跑自检、跑查询断言、跑反例断言、跑对账断言、校验离线快照。
 *
 * 每条断言输出一行 `ok   <描述>` 或 `FAIL <描述>：<实际值>`；任一失败把 `process.exitCode` 置 1，
 * 最后一行固定输出 `summary ok=<n> fail=<n> catalogHash=<64 hex>`。
 */
import { readFile } from 'node:fs/promises'

import type { CurveParamEntry, DriftKind, DriftReport, FieldCatalog, FieldEntry, Segment } from './types.ts'
import { buildCatalog, computeCatalogHash, indexCatalog, sealCatalog } from './index.ts'
import { catalogFromSchemaGet, diffCatalog } from './reconcile.ts'
import { validateCatalog, validateEntry } from './validate.ts'

const SOURCE_COMMIT = 'd4840b172511de3ddddb270f26c2cd0029ab0c30'
const GAME_VERSION = '1.20.1'
const MOD_VERSION = '0.3.6'
const CAPTURED_AT = '2025-01-01T00:00:00Z'
/** `类名#方法:行号`（可带 `-结束行号`）。 */
const SOURCE_REF_PATTERN = /^[A-Za-z][A-Za-z0-9]*#\w+:\d+(-\d+)?$/
const FIXTURES_DIR = new URL('./fixtures/', import.meta.url)

let ok = 0
let fail = 0
let catalogHash = ''

/** 把断言实际值压成一行；长数组/长字符串截断到 300 字符。 */
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
  let text: string
  try {
    text = JSON.stringify(value) ?? String(value)
  } catch {
    text = String(value)
  }
  return text.length > 300 ? `${text.slice(0, 300)}…` : text
}

/** 记一条断言；条件为真记 ok，否则记 FAIL 并附实际值。 */
function check(label: string, condition: boolean, actual?: unknown): void {
  if (condition) {
    ok += 1
    console.log(`ok   ${label}`)
    return
  }
  fail += 1
  console.log(`FAIL ${label}：${format(actual)}`)
}

/** 深比较：数组按顺序、对象按键集合与值。 */
function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, i) => sameValue(item, right[i]))
  }
  if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object') {
    const a = left as Record<string, unknown>
    const b = right as Record<string, unknown>
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length
      && keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && sameValue(a[key], b[key]))
  }
  return false
}

function expectEqual(label: string, actual: unknown, expected: unknown): void {
  check(label, sameValue(actual, expected), actual)
}

/** 走 `validateCatalog` 的反例夹具用的最小目录壳；夹具的 `catalog` 按顶层键覆盖。 */
function minimalCatalog(): FieldCatalog {
  return {
    catalogHash: '',
    sourceCommit: SOURCE_COMMIT,
    meta: [],
    screenLayers: { fixed: [], spaces: {}, valueType: 'bool', dynamic: true },
    tracks: {},
    triggers: { types: [], conditions: {}, triggerFields: [] },
    models: {},
    curveTypes: {},
    scriptStructure: { sections: {}, enums: {} },
    discovered: { tracks: [], triggers: [] },
  }
}

/** 读 `src/core/schema/fixtures/` 下的 JSON 文件。 */
async function readJson(relative: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(relative, FIXTURES_DIR), 'utf8')) as unknown
}

/** 目录内全部 `FieldEntry` 与 `CurveParamEntry`（sourceRef 覆盖率与 wire 值检查共用）。 */
function collectEntries(catalog: FieldCatalog): { fields: FieldEntry[]; curves: CurveParamEntry[] } {
  const fields: FieldEntry[] = [
    ...catalog.meta,
    ...Object.values(catalog.tracks).flatMap((track) => [...track.playControl, ...track.objects]),
    ...Object.values(catalog.triggers.conditions).flat(),
    ...catalog.triggers.triggerFields,
    ...Object.values(catalog.models).flatMap((model) => model.params),
    ...Object.values(catalog.scriptStructure.sections).flat(),
  ]
  const curves: CurveParamEntry[] = Object.values(catalog.curveTypes).flatMap((curve) => curve.params)
  return { fields, curves }
}

async function main(): Promise<void> {
  // ── 1. 基础 ────────────────────────────────────────────────────────────────
  let catalog: FieldCatalog
  try {
    catalog = buildCatalog(SOURCE_COMMIT)
    check('buildCatalog(SOURCE_COMMIT) 返回目录且 validateCatalog issues=0', true)
  } catch (error) {
    check('buildCatalog(SOURCE_COMMIT) 返回目录且 validateCatalog issues=0', false, error)
    return
  }

  catalogHash = await computeCatalogHash(catalog)
  check('catalogHash 匹配 /^[0-9a-f]{64}$/', /^[0-9a-f]{64}$/.test(catalogHash), catalogHash)

  const sealed = sealCatalog(catalog, catalogHash)
  const index = indexCatalog(sealed)

  expectEqual('sealed.catalogHash === catalogHash', sealed.catalogHash, catalogHash)
  expectEqual('computeCatalogHash(sealed) === catalogHash（幂等）', await computeCatalogHash(sealed), catalogHash)

  // ── 1b. 重复键与目录变化 ──────────────────────────────────────────────────
  const duplicateId = structuredClone(sealed)
  duplicateId.tracks.CAMERA.objects.push({ ...duplicateId.tracks.CAMERA.objects[0] })
  let duplicateRejected = false
  try {
    indexCatalog(duplicateId)
  } catch {
    duplicateRejected = true
  }
  check('重复对象键在 indexCatalog 阶段抛错', duplicateRejected)

  const changedDefault = structuredClone(sealed)
  changedDefault.meta[0].default = 'changed'
  const changedHash = await computeCatalogHash(changedDefault)
  check('catalogHash 在字段变更后变化', changedHash !== catalogHash, changedHash)
  expectEqual('纯查询不改变 catalogHash', await computeCatalogHash(sealed), catalogHash)

  // ── 2. 条目数与结构 ────────────────────────────────────────────────────────
  expectEqual('sealed.meta.length', sealed.meta.length, 23)
  expectEqual('sealed.screenLayers.fixed.length', sealed.screenLayers.fixed.length, 15)
  expectEqual('sealed.screenLayers.dynamic', sealed.screenLayers.dynamic, true)
  expectEqual('sealed.screenLayers.valueType', sealed.screenLayers.valueType, 'bool')
  expectEqual(
    'sealed.screenLayers.spaces 覆盖全部 fixed 层',
    Object.keys(sealed.screenLayers.spaces).sort(),
    [...sealed.screenLayers.fixed].sort(),
  )
  expectEqual('sealed.screenLayers.spaces.viewmodel', sealed.screenLayers.spaces.viewmodel, 'WORLD')
  expectEqual('sealed.screenLayers.spaces.view_bobbing', sealed.screenLayers.spaces.view_bobbing, 'VIEW')
  expectEqual('sealed.screenLayers.spaces.screen_effects', sealed.screenLayers.spaces.screen_effects, 'POST')
  expectEqual('sealed.screenLayers.spaces.player_model', sealed.screenLayers.spaces.player_model, 'WORLD')
  expectEqual('sealed.screenLayers.spaces.hud.hotbar', sealed.screenLayers.spaces['hud.hotbar'], 'HUD')
  expectEqual('sealed.discovered', sealed.discovered, { tracks: [], triggers: [] })
  expectEqual(
    'Object.keys(sealed.tracks)',
    Object.keys(sealed.tracks),
    ['CAMERA', 'LETTERBOX', 'AUDIO', 'EVENT', 'MOD_EVENT', 'OVERLAY', 'ADJUST'],
  )
  for (const [type, track] of Object.entries(sealed.tracks)) {
    expectEqual(`tracks.${type}.playControl.length`, track.playControl.length, 5)
  }

  const expectedObjects: Record<string, number> = {
    CAMERA: 218,
    LETTERBOX: 2,
    AUDIO: 13,
    EVENT: 2,
    MOD_EVENT: 3,
    OVERLAY: 32,
    ADJUST: 72,
  }
  let objectTotal = 0
  for (const [type, expected] of Object.entries(expectedObjects)) {
    const actual = sealed.tracks[type]?.objects.length
    objectTotal += actual ?? 0
    expectEqual(`tracks.${type}.objects.length`, actual, expected)
  }
  expectEqual('tracks.objects 合计', objectTotal, 342)

  expectEqual('sealed.triggers.types.length', sealed.triggers.types.length, 27)
  expectEqual('Object.keys(sealed.triggers.conditions).length', Object.keys(sealed.triggers.conditions).length, 27)
  expectEqual('sealed.triggers.triggerFields.length', sealed.triggers.triggerFields.length, 2)
  expectEqual('Object.keys(sealed.models).length', Object.keys(sealed.models).length, 11)
  expectEqual('Object.keys(sealed.curveTypes).length', Object.keys(sealed.curveTypes).length, 11)

  const expectedSections: Record<string, number> = {
    clips: 5,
    'clips.exit': 3,
    rules: 4,
    'rules.policy': 6,
    rule_bindings: 7,
    'rule_bindings.gate': 1,
    'rule_bindings.schedule': 6,
    'rule_bindings.exit': 3,
    paths: 7,
    'paths.geometry': 2,
    'paths.timing': 2,
    'condition_fact_types.clip_fact': 2,
    'condition_fact_types.rule_fact': 2,
  }
  for (const [section, expected] of Object.entries(expectedSections)) {
    expectEqual(`scriptStructure.sections['${section}'].length`, sealed.scriptStructure.sections[section]?.length, expected)
  }
  expectEqual(
    'Object.keys(scriptStructure.sections) 集合',
    Object.keys(sealed.scriptStructure.sections).sort(),
    Object.keys(expectedSections).sort(),
  )
  expectEqual(
    'Object.keys(scriptStructure.enums)',
    Object.keys(sealed.scriptStructure.enums),
    ['action_types', 'exit_kinds', 'schedule_kinds', 'condition_fact_types'],
  )

  // ── 3. sourceRef 覆盖率（全目录） ─────────────────────────────────────────
  const { fields, curves } = collectEntries(sealed)
  const sourceRefOffenders = [...fields, ...curves]
    .filter((entry) => !SOURCE_REF_PATTERN.test(entry.sourceRef))
    .map((entry) => `${'id' in entry ? entry.id : entry.key}: sourceRef=${format(entry.sourceRef)}`)
  check(
    `sourceRef 覆盖率 100%（${fields.length} FieldEntry + ${curves.length} CurveParamEntry = ${fields.length + curves.length} 条）`,
    sourceRefOffenders.length === 0,
    sourceRefOffenders,
  )

  // ── 4. 查询断言 ────────────────────────────────────────────────────────────
  const metaId = index.meta('id')
  expectEqual("meta('id').type", metaId?.type, 'string')
  expectEqual("meta('id').required", metaId?.required, true)
  expectEqual("meta('id').default", metaId?.default, 'untitled')

  const skipVote = index.meta('skip_vote_ratio')
  expectEqual("meta('skip_vote_ratio').type", skipVote?.type, 'int')
  expectEqual("meta('skip_vote_ratio').min", skipVote?.min, 10)
  expectEqual("meta('skip_vote_ratio').max", skipVote?.max, 100)
  expectEqual("meta('skip_vote_ratio').hasDefault", skipVote?.hasDefault, false)

  const baseResolution = index.meta('base_resolution')
  expectEqual("meta('base_resolution').type", baseResolution?.type, 'object')
  expectEqual("meta('base_resolution').hasDefault", baseResolution?.hasDefault, false)

  const parseInterval = index.meta('trigger_poll_interval')
  expectEqual("meta('trigger_poll_interval').type", parseInterval?.type, 'int')
  expectEqual("meta('trigger_poll_interval').min", parseInterval?.min, 1)
  expectEqual("meta('trigger_poll_interval').max", parseInterval?.max, 600)

  const metaTriggers = index.meta('triggers')
  expectEqual("meta('triggers').type", metaTriggers?.type, 'array')
  expectEqual("meta('triggers').section", metaTriggers?.section, 'parse-only')

  const positionX = index.objectDef('CAMERA', 'position.x')
  expectEqual("objectDef('CAMERA','position.x').mode", positionX?.mode, 'animated')
  expectEqual("objectDef('CAMERA','position.x').type", positionX?.type, 'float')
  expectEqual("objectDef('CAMERA','position.x').interp", positionX?.interp, 'linear')
  expectEqual("objectDef('CAMERA','position.x').section", positionX?.section, 'position')
  expectEqual("objectDef('CAMERA','position.x').group", positionX?.group, 'position')

  const yawLock = index.objectDef('CAMERA', 'yaw_lock')
  expectEqual("objectDef('CAMERA','yaw_lock').type", yawLock?.type, 'nullable_float')
  expectEqual("objectDef('CAMERA','yaw_lock').nullable", yawLock?.nullable, true)
  expectEqual("objectDef('CAMERA','yaw_lock').unit", yawLock?.unit, 'degree')

  const orient = index.objectDef('CAMERA', 'orient')
  expectEqual("objectDef('CAMERA','orient').mode", orient?.mode, 'value')
  expectEqual("objectDef('CAMERA','orient').interp", orient?.interp, 'none')

  expectEqual("objectDef('CAMERA','zoom').interp", index.objectDef('CAMERA', 'zoom')?.interp, 'geometric')

  const eventField = index.objectDef('EVENT', 'event')
  expectEqual("objectDef('EVENT','event').mode", eventField?.mode, 'event')
  expectEqual("objectDef('EVENT','event').type", eventField?.type, 'event_record')
  expectEqual("objectDef('EVENT','event').interp", eventField?.interp, 'none')

  expectEqual("objectDef('CAMERA','mask_width').min", index.objectDef('CAMERA', 'mask_width')?.min, 0)

  const blendAmount = index.objectDef('ADJUST', 'blend_amount')
  expectEqual("objectDef('ADJUST','blend_amount').default", blendAmount?.default, 1)
  expectEqual("objectDef('ADJUST','blend_amount').min", blendAmount?.min, 0)
  expectEqual("objectDef('ADJUST','blend_amount').max", blendAmount?.max, 1)

  const layerType = index.objectDef('OVERLAY', 'layer_type')
  expectEqual("objectDef('OVERLAY','layer_type').required", layerType?.required, true)
  expectEqual("objectDef('OVERLAY','layer_type').enumValues", layerType?.enumValues, ['fade', 'image', 'subtitle'])

  expectEqual("objectDef('OVERLAY','mask_x').appliesTo", index.objectDef('OVERLAY', 'mask_x')?.appliesTo, ['fade'])

  const selectorAnchor = index.objectDef('CAMERA', 'selector_anchor_look_at')
  check("objectDef('CAMERA','selector_anchor_look_at') 存在", selectorAnchor !== undefined, selectorAnchor)
  expectEqual(
    "objectDef('CAMERA','selector_anchor_look_at').enumValues",
    selectorAnchor?.enumValues,
    ['camera', 'player', 'target', 'origin'],
  )

  const cameraPaths = index.paths('CAMERA')
  expectEqual("paths('CAMERA').length", cameraPaths.length, 218)
  check(
    "paths('CAMERA') 含 position.x/y/z 三条独立条目",
    ['position.x', 'position.y', 'position.z'].every((path) => cameraPaths.includes(path))
      && new Set(cameraPaths).size === cameraPaths.length,
    cameraPaths.filter((path) => path.startsWith('position.')),
  )

  const cameraGroups = index.sectionGroups('CAMERA')
  check(
    "sectionGroups('CAMERA').position 含 position.x",
    (cameraGroups.position ?? []).includes('position.x'),
    cameraGroups.position,
  )

  const adjustGroups = index.sectionGroups('ADJUST')
  for (const section of ['color', 'curve', 'lut', 'blend']) {
    check(
      `sectionGroups('ADJUST') 含分组 ${section}`,
      Object.prototype.hasOwnProperty.call(adjustGroups, section),
      Object.keys(adjustGroups).sort(),
    )
  }
  check(
    "sectionGroups('ADJUST').color 含 exposure",
    (adjustGroups.color ?? []).includes('exposure'),
    adjustGroups.color,
  )

  const availabilityManual = index.availability('CAMERA', 'yaw_offset', { orient: 'manual' })
  expectEqual("availability('CAMERA','yaw_offset',{orient:'manual'}).available", availabilityManual.available, false)
  const availabilityTangent = index.availability('CAMERA', 'yaw_offset', { orient: 'tangent' })
  expectEqual("availability('CAMERA','yaw_offset',{orient:'tangent'}).available", availabilityTangent.available, true)
  const availabilityDefault = index.availability('CAMERA', 'yaw_offset', {})
  expectEqual("availability('CAMERA','yaw_offset',{}) 取缺省 manual", availabilityDefault.available, false)

  expectEqual("trigger('login')", index.trigger('login'), [])
  expectEqual(
    "trigger('location') 的 key 列表",
    (index.trigger('location') ?? []).map((entry) => entry.key),
    ['dimension', 'position', 'radius', 'corner1', 'corner2'],
  )
  expectEqual("trigger('nope')", index.trigger('nope'), undefined)

  const continuitySweep = index.triggerField('continuity.sweep')
  expectEqual("triggerField('continuity.sweep').key", continuitySweep?.key, 'sweep')
  expectEqual("triggerField('continuity.sweep').type", continuitySweep?.type, 'bool')
  expectEqual("triggerField('continuity.sweep').default", continuitySweep?.default, false)
  const continuityDwell = index.triggerField('continuity.dwell')
  expectEqual("triggerField('continuity.dwell').min", continuityDwell?.min, 0)
  expectEqual("triggerField('continuity.dwell').max", continuityDwell?.max, 1200)

  const spring = index.model('spring')
  expectEqual("model('spring').params.length", spring?.params.length, 3)
  expectEqual(
    "model('spring') 参数 key",
    (spring?.params ?? []).map((entry) => entry.key),
    ['stiffness', 'damping', 'initial_velocity'],
  )
  expectEqual("model('linear').params.length", index.model('linear')?.params.length, 0)

  const blend = index.model('blend')
  expectEqual(
    "model('blend').weight.default",
    blend?.params.find((entry) => entry.key === 'weight')?.default,
    0.5,
  )
  expectEqual("model('blend').a.type", blend?.params.find((entry) => entry.key === 'a')?.type, 'model')
  expectEqual("model('blend').b.type", blend?.params.find((entry) => entry.key === 'b')?.type, 'model')

  expectEqual(
    "model('chain').models.type",
    index.model('chain')?.params.find((entry) => entry.key === 'models')?.type,
    'model_list',
  )
  expectEqual("model('spring').domains", spring?.domains, ['scalar', 'angle', 'vector', 'color'])
  expectEqual("model('spring').maxDepth", spring?.maxDepth, 8)
  expectEqual("model('spring').maxNodes", spring?.maxNodes, 32)
  expectEqual("model('spring').fallback", spring?.fallback, 'linear')

  const nurbs = index.curveType('nurbs')
  expectEqual("curveType('nurbs').capabilities.length", nurbs?.capabilities.length, 3)
  expectEqual("curveType('nurbs').params.length", nurbs?.params.length, 4)
  const linearCurve = index.curveType('linear')
  expectEqual("curveType('linear').capabilities.length", linearCurve?.capabilities.length, 0)
  expectEqual("curveType('linear').params.length", linearCurve?.params.length, 0)
  expectEqual("curveType('fourier').params.length", index.curveType('fourier')?.params.length, 7)

  const catmullParameterization = index.curveType('catmull_rom')?.params.find((param) => param.key === 'parameterization')
  expectEqual("curveType('catmull_rom').parameterization.kind", catmullParameterization?.kind, 'ENUM')
  expectEqual("curveType('catmull_rom').parameterization.enumValues.length", catmullParameterization?.enumValues?.length, 3)
  expectEqual("curveType('catmull_rom').parameterization.default", catmullParameterization?.default, 'centripetal')

  const arcParams = index.curveType('arc')?.params ?? []
  expectEqual(
    "curveType('arc').params.normal.default",
    arcParams.find((param) => param.key === 'normal')?.default,
    { x: 0, y: 1, z: 0 },
  )
  expectEqual(
    "curveType('arc').params.reference_axis.default",
    arcParams.find((param) => param.key === 'reference_axis')?.default,
    { x: 1, y: 0, z: 0 },
  )

  const clips = index.scriptSection('clips') ?? []
  expectEqual("scriptSection('clips').length", clips.length, 5)
  expectEqual("scriptSection('clips')[1].enumValues", clips[1]?.enumValues, [
    'CAMERA', 'LETTERBOX', 'AUDIO', 'EVENT', 'MOD_EVENT', 'OVERLAY', 'ADJUST',
  ])
  const pathsGeometry = index.scriptSection('paths.geometry') ?? []
  expectEqual("scriptSection('paths.geometry')[0].enumValues.length", pathsGeometry[0]?.enumValues?.length, 12)
  expectEqual("scriptSection('paths.geometry')[0].enumValues[0]", pathsGeometry[0]?.enumValues?.[0], 'line')

  expectEqual("scriptEnum('action_types').length", index.scriptEnum('action_types')?.length, 9)
  expectEqual("scriptEnum('exit_kinds').length", index.scriptEnum('exit_kinds')?.length, 5)
  expectEqual("scriptEnum('schedule_kinds').length", index.scriptEnum('schedule_kinds')?.length, 5)
  expectEqual("scriptEnum('condition_fact_types')", index.scriptEnum('condition_fact_types'), ['clip_fact', 'rule_fact'])

  expectEqual("search({segment:'meta'}).length", index.search({ segment: 'meta' }).length, 23)
  const fadeFields = index.search({ segment: 'tracks', scope: 'AUDIO', key: 'fade' }).map((entry) => entry.key)
  for (const key of ['fade_in', 'fade_out']) {
    check(`search({segment:'tracks', scope:'AUDIO', key:'fade'}) 含 ${key}`, fadeFields.includes(key), fadeFields)
  }

  // ── 5. wire 值小写 / 枚举名大写 ───────────────────────────────────────────
  const wireOffenders: string[] = []
  for (const entry of fields) {
    const values: Array<[string, unknown]> = [
      ['type', entry.type],
      ['mode', entry.mode],
      ['interp', entry.interp],
    ]
    for (const [name, value] of values) {
      if (typeof value === 'string' && value !== value.toLowerCase()) {
        wireOffenders.push(`${entry.id}.${name}=${value}`)
      }
    }
  }
  check(`wire 值全小写（${fields.length} 条 FieldEntry 的 type/mode/interp）`, wireOffenders.length === 0, wireOffenders)

  const curveCaseOffenders: string[] = []
  for (const [type, curve] of Object.entries(sealed.curveTypes)) {
    for (const param of curve.params) {
      if (param.kind !== param.kind.toUpperCase()) {
        curveCaseOffenders.push(`curveTypes.${type}.${param.key}.kind=${param.kind}`)
      }
    }
    for (const capability of curve.capabilities) {
      if (capability !== capability.toUpperCase()) {
        curveCaseOffenders.push(`curveTypes.${type}.capabilities=${capability}`)
      }
    }
  }
  check(
    `curveTypes 的 kind/capabilities 全大写（${curves.length} 条 CurveParamEntry）`,
    curveCaseOffenders.length === 0,
    curveCaseOffenders,
  )

  // ── 6. 反例断言（V3） ──────────────────────────────────────────────────────
  const positionEntry = sealed.tracks.CAMERA.objects.find((entry) => entry.key === 'position.x')
  if (positionEntry !== undefined) {
    for (const key of ['position[0]', 'Position.X', 'position..x']) {
      const issues = validateEntry({ ...positionEntry, id: `track.CAMERA.object.${key}`, key })
      check(`validateEntry 拒绝路径 ${key}`, issues.length > 0, issues)
    }
  }

  let invalidNames: string[] = []
  try {
    const loaded = await readJson('invalid/index.json')
    if (Array.isArray(loaded)) {
      invalidNames = loaded.filter((item): item is string => typeof item === 'string')
      expectEqual('fixtures/invalid/index.json 用例数', invalidNames.length, 20)
    } else {
      check('fixtures/invalid/index.json 为字符串数组', false, loaded)
    }
  } catch (error) {
    check('读取 fixtures/invalid/index.json', false, error)
  }

  for (const name of invalidNames) {
    const fileName = name.endsWith('.json') ? name : `${name}.json`
    let fixture: {
      name?: string
      expect?: string[]
      knownPaths?: string[]
      entry: FieldEntry
      catalog?: Partial<FieldCatalog>
    }
    try {
      const url = new URL(`invalid/${fileName}`, FIXTURES_DIR)
      // 文件名来自 fixtures/invalid/index.json 的运行时列表，无法静态导入。
      const module = await import(url.href, { with: { type: 'json' } }) as { default: typeof fixture }
      fixture = module.default
    } catch (error) {
      check(`fixtures/invalid/${fileName} 可加载`, false, error)
      continue
    }
    const issues = fixture.catalog === undefined
      ? validateEntry(fixture.entry, fixture.knownPaths)
      : validateCatalog({ ...minimalCatalog(), ...fixture.catalog })
    const expected = Array.isArray(fixture.expect) ? fixture.expect : []
    const label = fixture.name ?? fileName
    const matched = issues.length > 0
      && (expected.length === 0 || issues.some((issue) => expected.some((keyword) => issue.includes(keyword))))
    check(`invalid ${label}：至少一条 issue 命中 [${expected.join('|')}]`, matched, issues)
    console.log(`case ${label} -> ${issues.length} issue(s)`)
  }

  // ── 7. 对账断言（V4） ──────────────────────────────────────────────────────
  const before = await computeCatalogHash(sealed)
  let remote: FieldCatalog | undefined
  let report: DriftReport | undefined
  try {
    const remoteSchema = await readJson('remote-schema.json')
    const remoteRaw = catalogFromSchemaGet(remoteSchema, SOURCE_COMMIT)
    const remoteHash = await computeCatalogHash(remoteRaw)
    try {
      remoteRaw.catalogHash = remoteHash
      remote = remoteRaw
    } catch {
      remote = { ...remoteRaw, catalogHash: remoteHash }
    }
    report = diffCatalog(sealed, remote, {
      gameVersion: GAME_VERSION,
      modVersion: MOD_VERSION,
      capturedAt: CAPTURED_AT,
    })
    check("catalogFromSchemaGet + diffCatalog 跑通（fixtures/remote-schema.json）", true)
  } catch (error) {
    check("catalogFromSchemaGet + diffCatalog 跑通（fixtures/remote-schema.json）", false, error)
  }

  if (report !== undefined && remote !== undefined) {
    const kinds = new Set(report.entries.map((entry) => entry.kind))
    const expectedKinds: DriftKind[] = ['missing', 'added', 'typeChanged', 'enumChanged', 'segmentMissing']
    for (const kind of expectedKinds) {
      check(`report.entries 的 kind 含 ${kind}`, kinds.has(kind), [...kinds].sort())
    }

    const metaDrifts: Array<[string, DriftKind]> = [
      ['hold_at_end', 'missing'],
      ['not_a_real_field', 'added'],
      ['priority', 'typeChanged'],
      ['play_mode', 'enumChanged'],
    ]
    for (const [key, kind] of metaDrifts) {
      const found = report.entries.find((entry) => entry.segment === 'meta' && entry.key === key && entry.kind === kind)
      check(`report.entries 含 {segment:'meta', key:'${key}', kind:'${kind}'}`, found !== undefined, found)
    }

    const missingSegments = new Set(
      report.entries.filter((entry) => entry.kind === 'segmentMissing').map((entry) => entry.segment),
    )
    const expectedMissingSegments: Segment[] = ['tracks', 'triggers', 'models', 'curveTypes', 'script_structure']
    for (const segment of expectedMissingSegments) {
      check(`segmentMissing 覆盖 ${segment}`, missingSegments.has(segment), [...missingSegments].sort())
    }

    expectEqual('report.catalogHashLocal === catalogHash', report.catalogHashLocal, catalogHash)
    expectEqual('report.catalogHashRemote === remote.catalogHash', report.catalogHashRemote, remote.catalogHash)

    let sorted = true
    let firstBreak = ''
    for (let i = 1; i < report.entries.length; i += 1) {
      const previous = report.entries[i - 1]
      const current = report.entries[i]
      const previousKey = `${previous.segment}${previous.scope.join('.')}${previous.key}${previous.kind}`
      const currentKey = `${current.segment}${current.scope.join('.')}${current.key}${current.kind}`
      if (previousKey > currentKey) {
        sorted = false
        firstBreak = `${previousKey} > ${currentKey}`
        break
      }
    }
    check('report.entries 按 segment+scope+key+kind 升序', sorted, firstBreak)
  }

  expectEqual('computeCatalogHash(sealed) 在 diff 之后未变（local 只读）', await computeCatalogHash(sealed), before)

  // ── 8. 离线快照 ────────────────────────────────────────────────────────────
  let snapshot: { source?: Record<string, unknown>; catalog?: FieldCatalog } | undefined
  try {
    snapshot = await readJson('snapshot.json') as { source?: Record<string, unknown>; catalog?: FieldCatalog }
    check('fixtures/snapshot.json 可加载', true)
  } catch (error) {
    check('fixtures/snapshot.json 可加载', false, error)
  }

  if (snapshot !== undefined) {
    expectEqual('snapshot.source.catalogHash === catalogHash', snapshot.source?.catalogHash, catalogHash)
    expectEqual('snapshot.source.sourceCommit === SOURCE_COMMIT', snapshot.source?.sourceCommit, SOURCE_COMMIT)
    expectEqual(
      'computeCatalogHash(snapshot.catalog) === catalogHash',
      snapshot.catalog === undefined ? undefined : await computeCatalogHash(snapshot.catalog),
      catalogHash,
    )
    expectEqual('snapshot.catalog.meta.length', snapshot.catalog?.meta.length, 23)
  }
}

main()
  .catch((error: unknown) => {
    check('verify 执行未抛出未捕获异常', false, error)
  })
  .finally(() => {
    const shown = /^[0-9a-f]{64}$/.test(catalogHash) ? catalogHash : '<unavailable>'
    console.log(`summary ok=${ok} fail=${fail} catalogHash=${shown}`)
    if (fail > 0) {
      process.exitCode = 1
    }
  })
