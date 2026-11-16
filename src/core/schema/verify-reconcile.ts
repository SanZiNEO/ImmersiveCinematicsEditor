/**
 * 02 轮独立验收入口：`schema.get` 对账 8 类差异 + 离线快照读写。
 *
 * 用 `fixtures/reconcile/remote-schema-8kinds.json` 构造远端响应，断言：
 * - `missing`：本地有 `meta.hold_at_end`，远端没有；
 * - `added`：远端多出 `meta.not_a_real_field`；
 * - `typeChanged` / `defaultChanged`：`meta.priority` 远端 float / 999，本地 int / 0；
 * - `enumChanged`：`meta.play_mode` 远端只有 parallel/exclusive，本地三态；
 * - `rangeChanged`：`tracks.CAMERA.objects.mask_width` 远端 min 0.5，本地 min 0；
 * - `dependencyChanged`：`yaw_offset` 远端 requires orient=manual，本地 orient=tangent；
 * - `segmentMissing`：远端 models / curveTypes / script_structure 为空。
 *
 * 远端 `FieldDef` 不导出 min / max / requires / appliesTo，所以本地带区间的 meta 字段
 * （`skip_vote_ratio` / `trigger_poll_interval`）也会各产生一条 `rangeChanged`；本文件只
 * 针对夹具声明的那条 `mask_width` 做断言，kind 集合仍是 8 类。
 *
 * 快照部分用 `node:os` 的临时目录验证：同名不覆盖、列表排序、回读、目录缺失行为。
 * 不修改 `verify.ts`，本文件是独立可运行入口。
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { DriftEntry, DriftKind, DriftReport, FieldCatalog, Segment } from './types.ts'
import { buildCatalog, computeCatalogHash, sealCatalog } from './index.ts'
import { catalogFromSchemaGet, diffCatalog } from './reconcile.ts'
import type { SnapshotSource } from './snapshots.ts'
import { loadSnapshot, listSnapshots, saveSnapshot, snapshotFileName } from './snapshots.ts'

const SOURCE_COMMIT = 'd4840b172511de3ddddb270f26c2cd0029ab0c30'
const GAME_VERSION = '1.20.1'
const MOD_VERSION = '0.3.6'
const CAPTURED_AT = '2025-01-01T00:00:00Z'
const FIXTURE_URL = new URL('./fixtures/reconcile/remote-schema-8kinds.json', import.meta.url)

const DRIFT_KINDS: readonly DriftKind[] = [
  'missing',
  'added',
  'typeChanged',
  'enumChanged',
  'defaultChanged',
  'rangeChanged',
  'dependencyChanged',
  'segmentMissing',
]

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

/** 读对象成员；非对象或键不存在时返回 `undefined`，不做猜测。 */
function member(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  return Reflect.get(value, key) as unknown
}

function findDrift(
  report: DriftReport,
  segment: Segment,
  scope: string[],
  key: string,
  kind: DriftKind,
): DriftEntry | undefined {
  return report.entries.find((entry) =>
    entry.segment === segment
    && sameValue(entry.scope, scope)
    && entry.key === key
    && entry.kind === kind)
}

/** segment → scope.join('.') → key → kind 的字典序（与 `reconcile.ts` 的排序口径一致）。 */
function compareDrift(left: DriftEntry, right: DriftEntry): number {
  const pairs: Array<[string, string]> = [
    [left.segment, right.segment],
    [left.scope.join('.'), right.scope.join('.')],
    [left.key, right.key],
    [left.kind, right.kind],
  ]
  for (const [a, b] of pairs) {
    if (a < b) {
      return -1
    }
    if (a > b) {
      return 1
    }
  }
  return 0
}

async function verifyReconcile(): Promise<FieldCatalog> {
  // ── 1. 本地目录与远端响应 ──────────────────────────────────────────────────
  const catalog = buildCatalog(SOURCE_COMMIT)
  catalogHash = await computeCatalogHash(catalog)
  check('buildCatalog(SOURCE_COMMIT) + catalogHash 形状', /^[0-9a-f]{64}$/.test(catalogHash), catalogHash)
  const sealed = sealCatalog(catalog, catalogHash)
  const before = await computeCatalogHash(sealed)
  expectEqual('sealCatalog 后 catalogHash 幂等', before, catalogHash)

  const response = JSON.parse(await readFile(FIXTURE_URL, 'utf8')) as unknown
  const remoteRaw = catalogFromSchemaGet(response, SOURCE_COMMIT)
  const remoteHash = await computeCatalogHash(remoteRaw)
  check('远端 catalog hash 形状', /^[0-9a-f]{64}$/.test(remoteHash), remoteHash)
  remoteRaw.catalogHash = remoteHash

  const report = diffCatalog(sealed, remoteRaw, {
    gameVersion: GAME_VERSION,
    modVersion: MOD_VERSION,
    capturedAt: CAPTURED_AT,
  })

  // ── 2. 8 类 kind 全覆盖 ───────────────────────────────────────────────────
  const kinds = new Set<DriftKind>(report.entries.map((entry) => entry.kind))
  for (const kind of DRIFT_KINDS) {
    check(`8 类 kind 覆盖 ${kind}`, kinds.has(kind), [...kinds].sort())
  }

  // ── 3. 每类差异的定位与取值 ──────────────────────────────────────────────
  const holdAtEnd = findDrift(report, 'meta', [], 'hold_at_end', 'missing')
  check("含 {segment:'meta', key:'hold_at_end', kind:'missing'}", holdAtEnd !== undefined, holdAtEnd)
  expectEqual('missing.local 保留本地条目', member(holdAtEnd?.local, 'key'), 'hold_at_end')

  const notARealField = findDrift(report, 'meta', [], 'not_a_real_field', 'added')
  check("含 {segment:'meta', key:'not_a_real_field', kind:'added'}", notARealField !== undefined, notARealField)
  expectEqual('added.remote 记录远端条目', member(notARealField?.remote, 'key'), 'not_a_real_field')

  const priorityType = findDrift(report, 'meta', [], 'priority', 'typeChanged')
  check("含 {segment:'meta', key:'priority', kind:'typeChanged'}", priorityType !== undefined, priorityType)
  expectEqual('priority typeChanged int → float', [priorityType?.local, priorityType?.remote], ['int', 'float'])

  const playModeEnum = findDrift(report, 'meta', [], 'play_mode', 'enumChanged')
  check("含 {segment:'meta', key:'play_mode', kind:'enumChanged'}", playModeEnum !== undefined, playModeEnum)
  expectEqual(
    'play_mode enumChanged 远端只有 parallel/exclusive',
    playModeEnum?.remote,
    ['parallel', 'exclusive'],
  )
  expectEqual(
    'play_mode enumChanged 本地三态',
    playModeEnum?.local,
    ['parallel', 'exclusive', 'interruptible'],
  )

  const priorityDefault = findDrift(report, 'meta', [], 'priority', 'defaultChanged')
  check("含 {segment:'meta', key:'priority', kind:'defaultChanged'}", priorityDefault !== undefined, priorityDefault)
  expectEqual(
    'priority defaultChanged 0 → 999',
    [member(priorityDefault?.local, 'default'), member(priorityDefault?.remote, 'default')],
    [0, 999],
  )
  expectEqual(
    'priority defaultChanged 两侧 hasDefault 都是 true',
    [member(priorityDefault?.local, 'hasDefault'), member(priorityDefault?.remote, 'hasDefault')],
    [true, true],
  )

  const maskWidthRange = findDrift(report, 'tracks', ['CAMERA'], 'mask_width', 'rangeChanged')
  check("含 {segment:'tracks', scope:['CAMERA'], key:'mask_width', kind:'rangeChanged'}", maskWidthRange !== undefined, maskWidthRange)
  expectEqual(
    'mask_width rangeChanged local.min 0 → remote.min 0.5',
    [member(maskWidthRange?.local, 'min'), member(maskWidthRange?.remote, 'min')],
    [0, 0.5],
  )

  const yawOffsetDependency = findDrift(report, 'tracks', ['CAMERA'], 'yaw_offset', 'dependencyChanged')
  check("含 {segment:'tracks', scope:['CAMERA'], key:'yaw_offset', kind:'dependencyChanged'}", yawOffsetDependency !== undefined, yawOffsetDependency)
  expectEqual(
    'yaw_offset dependencyChanged orient=tangent → orient=manual',
    [member(yawOffsetDependency?.local, 'requires'), member(yawOffsetDependency?.remote, 'requires')],
    ['orient=tangent', 'orient=manual'],
  )

  for (const segment of ['models', 'curveTypes', 'script_structure'] as Segment[]) {
    const drift = findDrift(report, segment, [], '', 'segmentMissing')
    check(`含 {segment:'${segment}', kind:'segmentMissing'}`, drift !== undefined, drift)
    check(
      `segmentMissing ${segment}：local 条目数 > 0 且 remote = 0`,
      typeof drift?.local === 'number' && drift.local > 0 && drift.remote === 0,
      drift,
    )
  }
  const missingSegments = [...new Set(
    report.entries.filter((entry) => entry.kind === 'segmentMissing').map((entry) => entry.segment),
  )].sort()
  expectEqual(
    'segmentMissing 恰好覆盖 models/curveTypes/script_structure',
    missingSegments,
    ['curveTypes', 'models', 'script_structure'],
  )

  // ── 4. 排序与只读 ─────────────────────────────────────────────────────────
  let sorted = true
  let firstBreak = ''
  for (let i = 1; i < report.entries.length; i += 1) {
    const previous = report.entries[i - 1]
    const current = report.entries[i]
    if (compareDrift(previous, current) > 0) {
      sorted = false
      firstBreak = `${previous.segment}/${previous.scope.join('.')}/${previous.key}/${previous.kind}`
        + ` > ${current.segment}/${current.scope.join('.')}/${current.key}/${current.kind}`
      break
    }
  }
  check('report.entries 按 segment+scope+key+kind 升序', sorted, firstBreak)

  expectEqual('report.catalogHashLocal === catalogHash', report.catalogHashLocal, catalogHash)
  expectEqual('report.catalogHashRemote === remoteHash', report.catalogHashRemote, remoteHash)
  expectEqual(
    'report.gameVersion / modVersion / capturedAt',
    [report.gameVersion, report.modVersion, report.capturedAt],
    [GAME_VERSION, MOD_VERSION, CAPTURED_AT],
  )
  expectEqual('diff 后本地 catalog hash 不变', await computeCatalogHash(sealed), before)
  expectEqual('diff 后 sealed.catalogHash 不变', sealed.catalogHash, catalogHash)
  return sealed
}

/** 快照文件名、创建、不覆盖、排序、回读与错误分支。 */
async function verifySnapshots(snapshotCatalog: FieldCatalog): Promise<void> {
  const source: SnapshotSource = {
    gameVersion: GAME_VERSION,
    modVersion: MOD_VERSION,
    capturedAt: CAPTURED_AT,
    sourceCommit: SOURCE_COMMIT,
    catalogHash,
  }
  const baseName = 'snapshot-1.20.1-0.3.6-20250101.json'
  expectEqual('snapshotFileName(ISO 日期) 取 YYYYMMDD', snapshotFileName(source), baseName)
  expectEqual(
    'snapshotFileName(非日期) 逐字符替换非字母数字',
    snapshotFileName({ ...source, capturedAt: 'build 2025/01/02' }),
    'snapshot-1.20.1-0.3.6-build-2025-01-02.json',
  )
  expectEqual(
    'snapshotFileName(非法日历日期) 不按日期处理',
    snapshotFileName({ ...source, capturedAt: '2025-02-30T00:00:00Z' }),
    'snapshot-1.20.1-0.3.6-2025-02-30T00-00-00Z.json',
  )

  const root = await mkdtemp(join(tmpdir(), 'ic-schema-snap-'))
  try {
    const dir = join(root, 'nested', 'snapshots')
    const first = await saveSnapshot(dir, { source, catalog: snapshotCatalog })
    expectEqual('saveSnapshot 创建缺失目录并返回完整路径', basename(first), baseName)
    const firstText = await readFile(first, 'utf8')

    const second = await saveSnapshot(dir, { source, catalog: snapshotCatalog })
    expectEqual('同名第二次保存改用 -2 后缀', basename(second), 'snapshot-1.20.1-0.3.6-20250101-2.json')
    expectEqual('同名第二次保存不覆盖首份内容', await readFile(first, 'utf8'), firstText)

    const sentinelHash = 'f'.repeat(64)
    const third = await saveSnapshot(dir, {
      source,
      catalog: { ...snapshotCatalog, catalogHash: sentinelHash },
    })
    expectEqual('同名第三次保存改用 -3 后缀', basename(third), 'snapshot-1.20.1-0.3.6-20250101-3.json')

    const loadedFirst = await loadSnapshot(first)
    expectEqual('loadSnapshot 回读 source', loadedFirst.source, source)
    expectEqual('loadSnapshot 回读 catalog.catalogHash', loadedFirst.catalog.catalogHash, catalogHash)
    const loadedThird = await loadSnapshot(third)
    expectEqual('-3 快照内容独立（首份未被覆盖）', loadedThird.catalog.catalogHash, sentinelHash)

    await writeFile(join(dir, 'README.txt'), 'not a snapshot\n', 'utf8')
    const listed = await listSnapshots(dir)
    expectEqual(
      'listSnapshots 返回按名称升序的 json 文件名',
      listed,
      [basename(first), basename(second), basename(third)].sort(),
    )
    check('listSnapshots 只收 .json', listed.every((name) => name.endsWith('.json')), listed)
    expectEqual('listSnapshots 目录不存在返回空数组', await listSnapshots(join(root, 'missing')), [])

    const noCatalog = join(root, 'no-catalog.json')
    await writeFile(noCatalog, JSON.stringify({ source }), 'utf8')
    let noCatalogError: unknown
    try {
      await loadSnapshot(noCatalog)
    } catch (error) {
      noCatalogError = error
    }
    check('loadSnapshot 缺少 catalog 时报错', noCatalogError instanceof Error, noCatalogError)

    const noSourceField = join(root, 'no-source-field.json')
    await writeFile(noSourceField, JSON.stringify({ source: { gameVersion: GAME_VERSION }, catalog: {} }), 'utf8')
    let noSourceError: unknown
    try {
      await loadSnapshot(noSourceField)
    } catch (error) {
      noSourceError = error
    }
    check('loadSnapshot 缺少 source 字段时报错', noSourceError instanceof Error, noSourceError)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  let sealed: FieldCatalog
  try {
    sealed = await verifyReconcile()
  } catch (error) {
    check('本地目录与远端对账执行', false, error)
    return
  }
  await verifySnapshots(sealed)
}

main()
  .catch((error: unknown) => {
    check('verify-reconcile 执行未抛出未捕获异常', false, error)
  })
  .finally(() => {
    const shown = /^[0-9a-f]{64}$/.test(catalogHash) ? catalogHash : '<unavailable>'
    console.log(`summary ok=${ok} fail=${fail} catalogHash=${shown}`)
    if (fail > 0) {
      process.exitCode = 1
    }
  })
