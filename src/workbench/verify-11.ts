/**
 * 11 轮自检（真实入口）：`node --experimental-strip-types src/workbench/verify-11.ts`
 *
 * 覆盖：
 * - 行为目录静态合同（27 触发器 / 12 规则条件 / 9 动作 / 5 调度 / 5 出口 / 区域形态 / 事件记录字段表）；
 * - 合同码 L35–L90 连续性、级别折叠、未登记码抛错；
 * - 命令层事务性（增删改移 / 引用保护 / 身份回落 / 前置扁平写盘）；
 * - 26 件行为夹具逐件核对合同码与级别；
 * - 摘要一致性（7 类入口、列表 / 详情 / 悬停同一文案）；
 * - 事实索引六态与自引用口径；
 * - 时间轴事件标记定位 / 预览 / 分组；
 * - 静态边界扫描（behavior 页签单例、消费面板不挂详情表单、抽屉无第二套触发器编辑器、不新增脚本字段）；
 * - 回归：复用 verify.ts / verify-05 / verify-07 既有脚本。
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildCatalog, indexCatalog } from '../core/schema/index.ts'
import type { CatalogIndex } from '../core/schema/index.ts'
import { metaKeys, ROOT_KEYS } from '../core/doc/keys.ts'
import { parseDoc } from '../core/doc/parse.ts'
import { DocStore } from '../core/doc/store.ts'
import { ClipRegistry } from '../core/doc/identity.ts'
import { cloneJson, isJsonObject, sameJson } from '../core/doc/json.ts'
import type { JsonObject, JsonValue, ScriptDoc } from '../core/doc/types.ts'
import type { DocCommand } from '../core/doc/commands.ts'
import { validateStructure } from '../core/doc/structural.ts'
import { writeRequirement, newRequirement } from '../core/graph/requirements.ts'

import {
  TRIGGER_TYPES,
  TRIGGER_TYPE_KEYS,
  triggerTypeInfo,
  BUILTIN_REQUIREMENT_TYPES,
} from '../core/schema/catalog/behaviorTriggers.ts'
import {
  RULE_CONDITION_TYPES,
  STATE_CONDITION_TYPES,
  FACT_CONDITION_TYPES,
  COMBINATOR_CONDITION_TYPES,
  RULE_CONDITION_MAX_DEPTH,
  ACTION_TYPES,
  SCHEDULE_KINDS,
  EXIT_KINDS,
  CONTROL_KINDS,
  RULE_CONDITION_TYPE_INFO,
  RULE_ACTION_INFO,
  SCHEDULE_KIND_INFO,
  EXIT_KIND_INFO,
  CONTROL_KIND_INFO,
} from '../core/schema/catalog/behaviorRules.ts'
import {
  EVENT_RECORD_KEYS,
  MOD_EVENT_RECORD_KEYS,
  MOD_EVENT_FORBIDDEN_KEYS,
  POSITION_KEYS,
  POSITION_ABSOLUTE_KEYS,
  POSITION_RELATIVE_KEYS,
  recordAllowedKeys,
} from '../core/schema/catalog/behaviorEvents.ts'

import {
  CONTRACT_CHECKS,
  severityForContract,
  foldSeverity,
  contractCheck,
} from '../features/behavior/validation.ts'
import {
  SUMMARY_ENTRY,
  describeSummary,
  describeTrigger,
  describeTriggerCondition,
  describeRuleRow,
  describeRuleCondition,
  describeAction,
  describeBinding,
  describeEventRecord,
  isSummaryKind,
} from '../features/behavior/summary.ts'
import { factIndex } from '../features/behavior/facts.ts'
import { eventRecords, type EventMarker } from '../features/behavior/events.ts'
import { parseTriggerNode, triggerIdentity } from '../features/behavior/trigger.ts'
import { bindingsOfRule } from '../features/behavior/rules.ts'
import { referencesToBinding } from '../features/behavior/bindings.ts'
import {
  referrersOfRule,
  ruleIsReferenced,
  referrersOfBinding,
  bindingIsReferenced,
} from '../features/behavior/commands.ts'

import {
  PREVIEW_LEAD,
  resolveMarkers,
  groupMarkers,
  canPreview,
  previewStartOf,
} from '../plugins/core.timeline/eventMarkers.ts'
import type { ScriptView, ClipListEntry, ClipViewEntry } from './api/documents.ts'

// ── 计数器 / 断言骨架（沿用 verify.ts / verify-07.ts 口径）─────────────────────

let ok = 0
let fail = 0
let groupOk = 0
let groupFail = 0

function check(label: string, condition: boolean, actual?: unknown): void {
  if (condition) {
    ok += 1
    groupOk += 1
    console.log(`ok   ${label}`)
    return
  }
  fail += 1
  groupFail += 1
  console.log(`FAIL ${label}: ${format(actual)}`)
}

function format(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return value
  if (value instanceof Error) return `${value.name}: ${value.message}`
  try {
    const text = JSON.stringify(value)
    return text === undefined ? String(value) : text.length > 320 ? `${text.slice(0, 320)}...` : text
  } catch {
    return String(value)
  }
}

function groupEnd(title: string): void {
  console.log(`── [${title}] 小计 ok=${groupOk} fail=${groupFail} ──`)
  groupOk = 0
  groupFail = 0
}

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SRC_DIR = join(REPO_ROOT, 'src')
const FIXTURE_DIR = join(REPO_ROOT, 'src/core/schema/fixtures/scripts')

// ── 目录合同（G1）─────────────────────────────────────────────────────────────

const EXPECTED_LEAF_TYPES = [
  'location', 'advancement', 'biome', 'entity_kill', 'entity_interact', 'dimension_change',
  'login', 'inventory', 'item_craft', 'structure', 'gamestage', 'item_use', 'item_consume',
  'item_release', 'item_instant_use', 'item_use_interrupt', 'block_interact', 'item_on_interact',
  'xp', 'dimension', 'item_pickup', 'item_drop', 'observation', 'facing', 'death',
]

function catalogGroup(): void {
  // 触发器：25 叶子 + 2 组合器。
  check('触发器目录共 27 种类型', TRIGGER_TYPES.length === 27, TRIGGER_TYPES.length)
  const combinators = TRIGGER_TYPES.filter((entry) => entry.combinator)
  const leaves = TRIGGER_TYPES.filter((entry) => !entry.combinator)
  check('组合器恰为 all_of / any', combinators.map((entry) => entry.type).sort().join(',') === 'all_of,any', combinators.map((e) => e.type))
  check('叶子类型恰为 25 种且键集合一致', leaves.length === 25 && leaves.map((e) => e.type).sort().join(',') === [...EXPECTED_LEAF_TYPES].sort().join(','), leaves.map((e) => e.type))
  check('TRIGGER_TYPE_KEYS 与目录顺序一致', TRIGGER_TYPE_KEYS.join(',') === TRIGGER_TYPES.map((e) => e.type).join(','), TRIGGER_TYPE_KEYS)

  // 组合器字段面：仅 list；事件子条件窗口开关。
  for (const combo of combinators) {
    const fieldKeys = combo.fields.map((field) => field.key)
    check(`组合器 ${combo.type} 字段仅 list`, fieldKeys.join(',') === 'list', fieldKeys)
    check(`组合器 ${combo.type} 支持事件子条件窗口`, combo.timing.window === true, combo.timing)
    check(`组合器 ${combo.type} 角色为 mixed`, combo.role === 'mixed', combo.role)
  }

  // 区域形态：球形 / 方体共存的三类；角点归一。
  const regionTypes = TRIGGER_TYPES.filter((entry) => entry.region === 'sphere_or_box').map((e) => e.type)
  check('sphere_or_box 区域恰为 location / entity_kill / death', regionTypes.sort().join(',') === 'death,entity_kill,location', regionTypes)
  for (const type of ['location', 'entity_kill', 'death']) {
    const info = triggerTypeInfo(type)
    const fieldKeys = info?.fields.map((field) => field.key) ?? []
    for (const required of ['dimension', 'position', 'radius', 'corner1', 'corner2']) {
      check(`区域类型 ${type} 登记字段 ${required}`, fieldKeys.includes(required), fieldKeys)
    }
  }

  // 时序模板：事件类全 false；轮询类 onEnter / pollInterval / dwell 开。
  const eventRole = TRIGGER_TYPES.find((entry) => entry.type === 'advancement')
  check('事件驱动类型时序边缘字段全关', eventRole !== undefined && !eventRole.timing.onEnter && !eventRole.timing.exitBuffer
    && !eventRole.timing.pollInterval && !eventRole.timing.dwell && !eventRole.timing.window, eventRole?.timing)
  const pollRole = TRIGGER_TYPES.find((entry) => entry.type === 'biome')
  check('轮询类型支持 onEnter / pollInterval / dwell', pollRole !== undefined && pollRole.timing.onEnter === true
    && pollRole.timing.pollInterval === true && pollRole.timing.dwell === true, pollRole?.timing)

  // 内置前置 3 种，script 字段名固定。
  check('内置前置恰为 3 种', BUILTIN_REQUIREMENT_TYPES.length === 3, BUILTIN_REQUIREMENT_TYPES.map((e) => e.type))
  check('内置前置 script 字段名固定为 script', BUILTIN_REQUIREMENT_TYPES.every((entry) => entry.scriptField === 'script'), BUILTIN_REQUIREMENT_TYPES)

  // 规则条件 / 动作 / 调度 / 出口 / 控制。
  check('规则条件类型 12 种', RULE_CONDITION_TYPES.length === 12, RULE_CONDITION_TYPES)
  check('状态条件 8 种', STATE_CONDITION_TYPES.length === 8, STATE_CONDITION_TYPES)
  check('事实条件 2 种（clip_fact / rule_fact）', FACT_CONDITION_TYPES.join(',') === 'clip_fact,rule_fact', FACT_CONDITION_TYPES)
  check('组合器条件 2 种（all_of / any）', COMBINATOR_CONDITION_TYPES.join(',') === 'all_of,any', COMBINATOR_CONDITION_TYPES)
  check('规则条件组合器最大深度 8', RULE_CONDITION_MAX_DEPTH === 8, RULE_CONDITION_MAX_DEPTH)
  check('动作类型 9 种', ACTION_TYPES.length === 9, ACTION_TYPES)
  check('调度种类 5 种', SCHEDULE_KINDS.length === 5, SCHEDULE_KINDS)
  check('出口种类 5 种', EXIT_KINDS.length === 5, EXIT_KINDS)
  check('控制种类 2 种（observe / hold）', [...CONTROL_KINDS].sort().join(',') === 'hold,observe', CONTROL_KINDS)

  check('条件信息表覆盖全部 12 种', Object.keys(RULE_CONDITION_TYPE_INFO).sort().join(',') === [...RULE_CONDITION_TYPES].sort().join(','), Object.keys(RULE_CONDITION_TYPE_INFO))
  check('动作信息表覆盖全部 9 种', Object.keys(RULE_ACTION_INFO).sort().join(',') === [...ACTION_TYPES].sort().join(','), Object.keys(RULE_ACTION_INFO))
  check('调度信息表覆盖全部 5 种', Object.keys(SCHEDULE_KIND_INFO).sort().join(',') === [...SCHEDULE_KINDS].sort().join(','), Object.keys(SCHEDULE_KIND_INFO))
  check('出口信息表覆盖全部 5 种', Object.keys(EXIT_KIND_INFO).sort().join(',') === [...EXIT_KINDS].sort().join(','), Object.keys(EXIT_KIND_INFO))
  check('控制信息表覆盖全部 2 种', Object.keys(CONTROL_KIND_INFO).sort().join(',') === [...CONTROL_KINDS].sort().join(','), Object.keys(CONTROL_KIND_INFO))
  for (const noParam of ['pause', 'resume', 'exit']) {
    const info = RULE_ACTION_INFO[noParam]
    check(`动作 ${noParam} 无参数且字段表为空`, info !== undefined && info.noParams === true && info.fields.length === 0, info)
  }

  // 事件记录字段表。
  check('EVENT 记录键为 command / event_type / position / id', [...EVENT_RECORD_KEYS].join(',') === 'command,event_type,position,id', EVENT_RECORD_KEYS)
  check('MOD_EVENT 记录键为 event_type / data', [...MOD_EVENT_RECORD_KEYS].join(',') === 'event_type,data', MOD_EVENT_RECORD_KEYS)
  check('MOD_EVENT 禁止键 command / position / id', [...MOD_EVENT_FORBIDDEN_KEYS].join(',') === 'command,position,id', MOD_EVENT_FORBIDDEN_KEYS)
  check('recordAllowedKeys(EVENT) 与 EVENT 键表一致', [...recordAllowedKeys('EVENT')].join(',') === [...EVENT_RECORD_KEYS].join(','), recordAllowedKeys('EVENT'))
  check('recordAllowedKeys(MOD_EVENT) 与 MOD_EVENT 键表一致', [...recordAllowedKeys('MOD_EVENT')].join(',') === [...MOD_EVENT_RECORD_KEYS].join(','), recordAllowedKeys('MOD_EVENT'))
  check('位置键 4 个（x/z/dx/dz）', POSITION_KEYS.length === 4, POSITION_KEYS)
  check('绝对位置键 x / z', [...POSITION_ABSOLUTE_KEYS].join(',') === 'x,z', POSITION_ABSOLUTE_KEYS)
  check('相对位置键 dx / dz', [...POSITION_RELATIVE_KEYS].join(',') === 'dx,dz', POSITION_RELATIVE_KEYS)

  groupEnd('G1 目录合同')
}

// ── 合同码（G2）───────────────────────────────────────────────────────────────

function contractGroup(): void {
  check('合同码共 56 条（L35–L90）', CONTRACT_CHECKS.length === 56, CONTRACT_CHECKS.length)

  const codes = CONTRACT_CHECKS.map((checkItem) => checkItem.code)
  const expected: string[] = []
  for (let n = 35; n <= 90; n += 1) expected.push(`L${n}`)
  check('编号 L35–L90 连续无空洞', codes.join(',') === expected.join(','), codes)
  check('编号无重复', new Set(codes).size === codes.length, codes)

  for (const item of CONTRACT_CHECKS) {
    const shapeOk = typeof item.block === 'string' && item.block.length > 0
      && ['block', 'error', 'warn', 'info'].includes(item.severity)
      && typeof item.title === 'string' && item.title.length > 0
      && typeof item.detail === 'string' && typeof item.jsonPath === 'string'
      && item.sourceRef !== undefined && typeof item.sourceRef.file === 'string'
      && typeof item.sourceRef.line === 'number' && typeof item.sourceRef.symbol === 'string'
    check(`合同 ${item.code} 字段形状完整`, shapeOk, item)
    check(`severityForContract(${item.code}) 与注册表级别一致`, severityForContract(item.code) === item.severity, { code: item.code, actual: severityForContract(item.code), expected: item.severity })
  }

  let threwUnknown = false
  try {
    contractCheck('L99')
  } catch (error) {
    threwUnknown = error instanceof RangeError
  }
  check('contractCheck 未登记码抛 RangeError', threwUnknown)
  let threwSeverity = false
  try {
    severityForContract('L99')
  } catch {
    threwSeverity = true
  }
  check('severityForContract 未登记码抛错', threwSeverity)

  check('foldSeverity(block) → error', foldSeverity('block') === 'error', foldSeverity('block'))
  check('foldSeverity(error) → error', foldSeverity('error') === 'error', foldSeverity('error'))
  check('foldSeverity(warn) 原样 warn', foldSeverity('warn') === 'warn', foldSeverity('warn'))
  check('foldSeverity(info) 原样 info', foldSeverity('info') === 'info', foldSeverity('info'))

  const spot: Array<[string, string]> = [
    ['L42', 'error'], ['L44', 'error'], ['L46', 'block'], ['L47', 'block'],
    ['L48', 'error'], ['L49', 'error'], ['L50', 'error'], ['L51', 'block'],
    ['L53', 'block'], ['L56', 'block'], ['L72', 'warn'], ['L74', 'error'],
    ['L76', 'block'], ['L80', 'block'], ['L82', 'block'], ['L85', 'error'],
    ['L86', 'warn'], ['L90', 'info'],
  ]
  for (const [code, severity] of spot) {
    check(`合同码 ${code} 级别为 ${severity}`, severityForContract(code) === severity, severityForContract(code))
  }

  groupEnd('G2 合同码')
}

// ── 命令行为（G3）────────────────────────────────────────────────────────────

function minimalRaw(): JsonObject {
  return {
    meta: {
      id: 'cmd',
      name: 'Cmd',
      author: 'x',
      triggers: [
        { id: 't1', type: 'login', conditions: {} },
        { id: 't2', type: 'biome', conditions: { biome: 'minecraft:plains' } },
      ],
    },
    timeline: {
      tracks: [{
        type: 'CAMERA',
        clips: [{ id: 'c1', start_time: 0, duration: 2, objects: { fov: { value: 70 } } }],
      }],
    },
    rules: [
      { id: 'r1', condition: { type: 'time', at: 1 }, actions: [{ type: 'pause' }], policy: {} },
      { id: 'r2', condition: { type: 'time', at: 1 }, actions: [{ type: 'pause' }], policy: {} },
    ],
    rule_bindings: [
      { id: 'b1', rule: 'r1', clip: 'c1', gate: { at: 0 }, control: 'observe' },
    ],
  }
}

function openStore(catalog: CatalogIndex, raw: JsonObject): DocStore {
  const keys = metaKeys(catalog)
  const parsed = parseDoc(raw, { metaKeys: keys })
  if (!parsed.ok) throw new Error(`parse failed: ${format(parsed.issues)}`)
  const store = new DocStore({ catalog, metaKeys: keys })
  store.open(parsed.doc, 'verify-11.json')
  return store
}

function rootOf(store: DocStore): JsonObject {
  return store.doc!.root
}

function triggers(root: JsonObject): JsonObject[] {
  const meta = isJsonObject(root.meta) ? root.meta : {}
  return Array.isArray(meta.triggers) ? (meta.triggers as JsonObject[]) : []
}

function rulesOf(root: JsonObject): JsonObject[] {
  return Array.isArray(root.rules) ? (root.rules as JsonObject[]) : []
}

function bindingsOf(root: JsonObject): JsonObject[] {
  return Array.isArray(root.rule_bindings) ? (root.rule_bindings as JsonObject[]) : []
}

function commandGroup(catalog: CatalogIndex): void {
  // 每次断言都重新取活根：撤销 / 恢复可能整体替换 root 对象，缓存引用会读到 detached 副本。
  const freshRoot = (store: DocStore): JsonObject => rootOf(store)

  // ── 触发器增 / 删 / 改移，撤销回到原位 ──
  {
    const store = openStore(catalog, minimalRaw())
    const before = JSON.stringify(freshRoot(store))
    const added = store.commit({ kind: 'trigger.add', index: 1, fields: { type: 'login' } } satisfies DocCommand)
    check('trigger.add 成功', added.ok === true, added.error)
    check('trigger.add 后触发器数 3', triggers(freshRoot(store)).length === 3, triggers(freshRoot(store)).map((t) => t.id ?? t.type))
    check('trigger.add 可撤销回到原状', store.undo() === true && JSON.stringify(freshRoot(store)) === before)

    const removed = store.commit({ kind: 'trigger.remove', triggerIdentity: 't1' } satisfies DocCommand)
    check('trigger.remove 成功', removed.ok === true, removed.error)
    check('trigger.remove 后剩 t2', triggers(freshRoot(store)).map((t) => t.id).join(',') === 't2', triggers(freshRoot(store)))
    check('trigger.remove 可撤销回到原位', store.undo() === true && JSON.stringify(freshRoot(store)) === before)

    const moved = store.commit({ kind: 'trigger.move', from: 0, to: 1 } satisfies DocCommand)
    check('trigger.move 成功', moved.ok === true, moved.error)
    check('trigger.move 后顺序 t2,t1', triggers(freshRoot(store)).map((t) => t.id).join(',') === 't2,t1', triggers(freshRoot(store)).map((t) => t.id))
    check('trigger.move 可撤销回到原位', store.undo() === true && JSON.stringify(freshRoot(store)) === before)
  }

  // ── 规则增 / 删 / 改移，撤销回到原位 ──
  {
    const store = openStore(catalog, minimalRaw())
    const before = JSON.stringify(freshRoot(store))

    const added = store.commit({ kind: 'rule.add', index: 2, id: 'r3' } satisfies DocCommand)
    check('rule.add 成功', added.ok === true, added.error)
    check('rule.add 后规则数 3', rulesOf(freshRoot(store)).length === 3, rulesOf(freshRoot(store)).map((r) => r.id))
    check('rule.add 可撤销回到原状', store.undo() === true && JSON.stringify(freshRoot(store)) === before)

    const removed = store.commit({ kind: 'rule.remove', ruleId: 'r2' } satisfies DocCommand)
    check('rule.remove 未被引用时成功', removed.ok === true, removed.error)
    check('rule.remove 后剩 r1', rulesOf(freshRoot(store)).map((r) => r.id).join(',') === 'r1', rulesOf(freshRoot(store)).map((r) => r.id))
    check('rule.remove 可撤销回到原位', store.undo() === true && JSON.stringify(freshRoot(store)) === before)

    const moved = store.commit({ kind: 'rule.move', from: 0, to: 1 } satisfies DocCommand)
    check('rule.move 成功', moved.ok === true, moved.error)
    check('rule.move 后顺序 r2,r1', rulesOf(freshRoot(store)).map((r) => r.id).join(',') === 'r2,r1', rulesOf(freshRoot(store)).map((r) => r.id))
    check('rule.move 可撤销回到原位', store.undo() === true && JSON.stringify(freshRoot(store)) === before)
  }

  // ── 绑定增 / 删 / 改移，撤销回到原位 ──
  {
    const store = openStore(catalog, minimalRaw())
    const before = JSON.stringify(freshRoot(store))

    const added = store.commit({
      kind: 'binding.add',
      index: 1,
      binding: { id: 'b2', rule: 'r2', clip: 'c1', gate: { at: 0 }, control: 'observe' },
    } satisfies DocCommand)
    check('binding.add 成功', added.ok === true, added.error)
    check('binding.add 后绑定数 2', bindingsOf(freshRoot(store)).length === 2, bindingsOf(freshRoot(store)).map((b) => b.id))
    check('binding.add 可撤销回到原状', store.undo() === true && JSON.stringify(freshRoot(store)) === before)

    // 新文档：加入 b2 后删除未被引用的 b2。
    const storeRemove = openStore(catalog, minimalRaw())
    storeRemove.commit({
      kind: 'binding.add',
      index: 1,
      binding: { id: 'b2', rule: 'r2', clip: 'c1', gate: { at: 0 }, control: 'observe' },
    } satisfies DocCommand)
    const removed = storeRemove.commit({ kind: 'binding.remove', bindingId: 'b2' } satisfies DocCommand)
    check('binding.remove 未被引用时成功', removed.ok === true, removed.error)
    check('binding.remove 后剩 b1', bindingsOf(freshRoot(storeRemove)).map((b) => b.id).join(',') === 'b1', bindingsOf(freshRoot(storeRemove)).map((b) => b.id))

    // 新文档：两条绑定后移动位置。
    const storeMove = openStore(catalog, minimalRaw())
    storeMove.commit({
      kind: 'binding.add',
      index: 1,
      binding: { id: 'b2', rule: 'r2', clip: 'c1', gate: { at: 0 }, control: 'observe' },
    } satisfies DocCommand)
    const moved = storeMove.commit({ kind: 'binding.move', from: 0, to: 1 } satisfies DocCommand)
    check('binding.move 成功', moved.ok === true, moved.error)
    check('binding.move 后顺序 b2,b1', bindingsOf(freshRoot(storeMove)).map((b) => b.id).join(',') === 'b2,b1', bindingsOf(freshRoot(storeMove)).map((b) => b.id))
    check('binding.move 可撤销回到移动前顺序', storeMove.undo() === true && bindingsOf(freshRoot(storeMove)).map((b) => b.id).join(',') === 'b1,b2')
  }

  // ── 引用保护：被引用对象删除被拒绝，文档与撤销栈不变 ──
  {
    const store = openStore(catalog, minimalRaw())
    const before = JSON.stringify(freshRoot(store))
    const undoDepthBefore = store.undoDepth()

    const blockedRule = store.commit({ kind: 'rule.remove', ruleId: 'r1' } satisfies DocCommand)
    check('rule.remove 被绑定引用时拒绝', blockedRule.ok === false, blockedRule.error)
    check('规则删除被拒后文档未变', JSON.stringify(freshRoot(store)) === before)
    check('规则删除被拒后撤销栈未增长', store.undoDepth() === undoDepthBefore, store.undoDepth())

    // 增加一条事实调度绑定，再测绑定删除保护。
    const addFact = store.commit({
      kind: 'binding.add',
      index: 1,
      binding: { id: 'b2', rule: 'r2', clip: 'c1', gate: { at: 0 }, schedule: { on: 'fact', binding: 'b1', fact: 'succeeded' } },
    } satisfies DocCommand)
    check('事实调度绑定 b2 写入成功', addFact.ok === true, addFact.error)
    const blockedBinding = store.commit({ kind: 'binding.remove', bindingId: 'b1' } satisfies DocCommand)
    check('binding.remove 被事实调度引用时拒绝', blockedBinding.ok === false, blockedBinding.error)
    check('绑定删除被拒后文档未变', bindingsOf(freshRoot(store)).map((b) => b.id).join(',') === 'b1,b2', bindingsOf(freshRoot(store)).map((b) => b.id))

    const root = freshRoot(store)
    const refsRule = referrersOfRule(root, 'r1')
    check('referrersOfRule(r1) 命中 b1', refsRule.length === 1 && refsRule[0].id === 'b1', refsRule)
    check('ruleIsReferenced(r1) 为真', ruleIsReferenced(root, 'r1') === true)
    check('ruleIsReferenced(r2) 被 b2 引用为真', ruleIsReferenced(root, 'r2') === true)
    const refsBinding = referrersOfBinding(root, 'b1')
    check('referrersOfBinding(b1) 命中 b2 调度', refsBinding.length === 1, refsBinding)
    check('bindingIsReferenced(b1) 为真', bindingIsReferenced(root, 'b1') === true)
    check('bindingIsReferenced(b2) 为假', bindingIsReferenced(root, 'b2') === false)
  }

  // ── trigger.setId：置空 = 删除键，身份回落 type#index ──
  {
    const store = openStore(catalog, minimalRaw())
    const cleared = store.commit({ kind: 'trigger.setId', triggerIdentity: 't1', value: '' } satisfies DocCommand)
    check('trigger.setId 置空成功', cleared.ok === true, cleared.error)
    const t1 = triggers(freshRoot(store))[0]
    check('置空后 id 键被删除（不写空串 / null）', !('id' in t1), t1)
    const node = parseTriggerNode(t1, 0)
    check('身份回落 login#0', triggerIdentity(node, 0) === 'login#0', triggerIdentity(node, 0))

    const renamed = store.commit({ kind: 'trigger.setId', triggerIdentity: 'login#0', value: 't1x' } satisfies DocCommand)
    check('回落身份可再改名', renamed.ok === true, renamed.error)
    const dup = store.commit({ kind: 'trigger.setId', triggerIdentity: 't1x', value: 't2' } satisfies DocCommand)
    check('重名 id 被拒绝', dup.ok === false, dup.error)
  }

  // ── 同次保存：无 id 记录同时改字段 / 前置 / 类型 / id ──
  {
    const store = openStore(catalog, minimalRaw())
    store.commit({ kind: 'trigger.setId', triggerIdentity: 't1', value: '' } satisfies DocCommand)
    const before = JSON.stringify(freshRoot(store))
    const identity = triggerIdentity(parseTriggerNode(triggers(freshRoot(store))[0], 0), 0)
    const batch = store.commit({
      kind: 'compound',
      commands: [
        { kind: 'trigger.setFields', triggerIdentity: identity, patch: { delay: 1 } },
        { kind: 'trigger.setRequires', triggerIdentity: identity, requires: [newRequirement('script_played', 'other_script')] },
        { kind: 'trigger.setId', triggerIdentity: identity, value: 'qa_both' },
        { kind: 'trigger.setType', triggerIdentity: 'qa_both', value: 'login' },
      ],
    } satisfies DocCommand)
    check('无 id 同次改字段 / 前置 / 类型 / id 成功', batch.ok === true, batch.error)
    const saved = triggers(freshRoot(store))[0]
    check('同次保存落成新类型与 id', saved.type === 'login' && saved.id === 'qa_both', saved)
    check('同次保存保留字段与前置', saved.delay === 1 && Array.isArray(saved.requires) && saved.requires.length === 1, saved)
    check('同次保存一次撤销回到原状', store.undo() === true && JSON.stringify(freshRoot(store)) === before)
  }

  // ── 规则 / 绑定事务改名：自身 + 引用一并改，撤销回到原位 ──
  {
    const store = openStore(catalog, minimalRaw())
    const before = JSON.stringify(freshRoot(store))

    const renamedRule = store.commit({ kind: 'rule.setId', ruleId: 'r1', value: 'r1x' } satisfies DocCommand)
    check('rule.setId 成功', renamedRule.ok === true, renamedRule.error)
    check('规则自身 id 已改', rulesOf(freshRoot(store)).some((r) => r.id === 'r1x'))
    check('绑定 b1.rule 引用一并改为 r1x', bindingsOf(freshRoot(store))[0].rule === 'r1x', bindingsOf(freshRoot(store))[0])
    check('rule.setId 可撤销回到原位', store.undo() === true && JSON.stringify(freshRoot(store)) === before)

    // 事实调度 + 规则条件树里的绑定引用一并改。
    store.commit({
      kind: 'binding.add',
      index: 1,
      binding: { id: 'b2', rule: 'r2', clip: 'c1', gate: { at: 0 }, schedule: { on: 'fact', binding: 'b1', fact: 'succeeded' } },
    })
    const renamedBinding = store.commit({ kind: 'binding.setId', bindingId: 'b1', value: 'b1x' } satisfies DocCommand)
    check('binding.setId 成功', renamedBinding.ok === true, renamedBinding.error)
    const b2 = bindingsOf(freshRoot(store)).find((b) => b.id === 'b2')
    check('调度事实引用一并改为 b1x', b2?.schedule !== undefined && (b2.schedule as JsonObject).binding === 'b1x', b2?.schedule)
    check('binding.setId 可撤销', store.undo() === true && bindingsOf(freshRoot(store)).every((b) => b.id !== 'b1x'))
  }

  // ── 前置条目落盘为扁平 {type, script}，禁止嵌套 data ──
  {
    const fresh = newRequirement('script_started', 'demo_a')
    check('newRequirement 为扁平 {type, script}', sameJson(fresh, { type: 'script_started', script: 'demo_a' }), fresh)
    check('newRequirement 不含 data 键', !isJsonObject(fresh) || !('data' in fresh), fresh)

    const nested = writeRequirement(
      { type: 'script_played', data: { script: 'old', stage: 'chapter_one' }, stage: 'chapter_two' },
      'script_played',
      'demo_a',
    )
    check('writeRequirement 落盘扁平 type / script', isJsonObject(nested) && nested.type === 'script_played' && nested.script === 'demo_a', nested)
    check('writeRequirement 删除嵌套 data 键', isJsonObject(nested) && !('data' in nested), nested)
    check('顶层额外键优先并入（stage=chapter_two）', isJsonObject(nested) && nested.stage === 'chapter_two', nested)

    const shorthand = writeRequirement('demo_a', 'script_played', 'demo_a')
    check('字符串简写 + script_played 直接返回目标 id', shorthand === 'demo_a', shorthand)
  }

  groupEnd('G3 命令行为')
}

// ── 夹具 26 件（G4）────────────────────────────────────────────────────────────

interface FixtureExpect {
  code: string
  severity: string
}

const INVALID_EXPECT: Record<string, FixtureExpect> = {
  'behavior-binding-duplicate-id': { code: 'L56', severity: 'block' },
  'behavior-binding-gate-out-of-bounds': { code: 'L56', severity: 'block' },
  'behavior-binding-schedule-fact-unknown': { code: 'L56', severity: 'block' },
  'behavior-event-over-duration': { code: 'L72', severity: 'warn' },
  'behavior-event-pingpong': { code: 'L85', severity: 'error' },
  'behavior-event-position-mixed': { code: 'L76', severity: 'block' },
  'behavior-event-type-illegal': { code: 'L74', severity: 'error' },
  'behavior-mod-event-data-array': { code: 'L82', severity: 'block' },
  'behavior-mod-event-record-id': { code: 'L80', severity: 'block' },
  'behavior-requirement-missing-script': { code: 'L44', severity: 'error' },
  'behavior-requirement-self-reference': { code: 'L44', severity: 'error' },
  'behavior-rule-actions-empty': { code: 'L53', severity: 'block' },
  'behavior-rule-duplicate-id': { code: 'L53', severity: 'block' },
  'behavior-trigger-combinator-depth': { code: 'L46', severity: 'block' },
  'behavior-trigger-combinator-empty': { code: 'L46', severity: 'block' },
  'behavior-trigger-combinator-event-no-window': { code: 'L47', severity: 'block' },
  'behavior-trigger-duplicate-id': { code: 'L42', severity: 'error' },
  'behavior-trigger-dwell-on-event': { code: 'L51', severity: 'block' },
  'behavior-trigger-exit-buffer-on-facing': { code: 'L48', severity: 'error' },
  'behavior-trigger-poll-interval-on-event': { code: 'L49', severity: 'error' },
}

function loadFixture(dir: string, file: string): JsonObject {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, dir, file), 'utf8')) as JsonObject
}

function validateFixture(catalog: CatalogIndex, raw: JsonObject, knownScriptIds: string[]) {
  const meta = isJsonObject(raw.meta) ? raw.meta : {}
  const timeline = isJsonObject(raw.timeline) ? raw.timeline : {}
  const doc: ScriptDoc = { root: raw, meta, timeline, authoring: {}, clipAuthoring: {} }
  const registry = new ClipRegistry()
  registry.sync(doc)
  return validateStructure(doc, { catalog, metaKeys: metaKeys(catalog), registry, knownScriptIds })
}

function fixtureGroup(catalog: CatalogIndex): void {
  const validFiles = readdirSync(join(FIXTURE_DIR, 'valid')).filter((name) => name.startsWith('behavior-') && name.endsWith('.json'))
  const invalidFiles = readdirSync(join(FIXTURE_DIR, 'invalid')).filter((name) => name.startsWith('behavior-') && name.endsWith('.json'))
  check('行为夹具共 26 件（6 合法 + 20 非法）', validFiles.length + invalidFiles.length === 26, { valid: validFiles.length, invalid: invalidFiles.length })

  // 合法件：不得出现 block；error 只允许 L44（自引用声明件）；warn / info 放行。
  for (const file of validFiles) {
    const raw = loadFixture('valid', file)
    const meta = raw.meta as JsonObject | undefined
    const selfId = typeof meta?.id === 'string' ? String(meta.id) : undefined
    const known = [...(selfId === undefined ? [] : [selfId]), 'demo_other']
    const issues = validateFixture(catalog, raw, known)
    const codes = issues.map((issue) => `${issue.code}/${issue.severity}`)
    const block = issues.filter((issue) => issue.severity === 'block')
    const forbiddenError = issues.filter((issue) => issue.severity === 'error' && issue.code !== 'L44')
    check(`合法件 ${file} 无 block`, block.length === 0, block.map((i) => `${i.code}:${i.message}`))
    check(`合法件 ${file} error 仅允许 L44`, forbiddenError.length === 0, forbiddenError.map((i) => `${i.code}:${i.message}`))
    console.log(`      · ${file}: ${codes.length ? codes.join(', ') : '(clean)'}`)
  }

  // 非法件：必须命中声明的合同码与级别；其余既有轮次 issue 不阻断。
  for (const file of invalidFiles) {
    const base = file.replace(/\.json$/, '')
    const expect = INVALID_EXPECT[base]
    check(`非法件 ${base} 在期望映射表内`, expect !== undefined, base)
    if (expect === undefined) continue
    const raw = loadFixture('invalid', file)
    const meta = raw.meta as JsonObject | undefined
    const selfId = typeof meta?.id === 'string' ? String(meta.id) : undefined
    const known = base === 'behavior-requirement-missing-script'
      ? ['demo_other']
      : [...(selfId === undefined ? [] : [selfId])]
    const issues = validateFixture(catalog, raw, known)
    const codes = issues.map((issue) => `${issue.code}/${issue.severity}`)
    const hit = issues.some((issue) => issue.code === expect.code && issue.severity === expect.severity)
    check(`非法件 ${base} 命中 ${expect.code}/${expect.severity}`, hit, codes)
    console.log(`      · ${base}: ${codes.join(', ')}`)
  }

  groupEnd('G4 夹具校验')
}

// ── 摘要一致性（G5）────────────────────────────────────────────────────────────

function fixtureRoot(dir: string, base: string): JsonObject {
  return loadFixture(dir, `${base}.json`)
}

function summaryGroup(): void {
  check('摘要入口登记 7 类', SUMMARY_ENTRY.length === 7, SUMMARY_ENTRY.map((e) => e.kind))
  const registeredKinds = SUMMARY_ENTRY.map((entry) => entry.kind)
  check('7 类覆盖 SummaryKind 全集', registeredKinds.sort().join(',') === ['action', 'binding', 'event', 'rule', 'rule-condition', 'trigger', 'trigger-condition'].sort().join(','), registeredKinds)
  for (const entry of SUMMARY_ENTRY) {
    check(`摘要条目 ${entry.kind} module / fn / doc 非空`, entry.module.length > 0 && entry.fn.length > 0 && entry.doc.length > 0, entry)
    check(`isSummaryKind('${entry.kind}') 为真`, isSummaryKind(entry.kind) === true)
  }
  check('isSummaryKind 拒绝未登记种类', isSummaryKind('nope') === false)

  const triggersRoot = fixtureRoot('valid', 'behavior-triggers-single')
  const triggerRaw = triggers(triggersRoot)[0]
  const triggerNode = parseTriggerNode(triggerRaw, 0)
  const triggerViaSummary = describeSummary({ kind: 'trigger', node: triggerNode, index: 0 })
  check('触发器摘要：入口与生成处文案一致', triggerViaSummary === describeTrigger(triggerNode, 0), { summary: triggerViaSummary, direct: describeTrigger(triggerNode, 0) })
  check('触发器摘要非空', triggerViaSummary.length > 0, triggerViaSummary)

  const triggerConditionViaSummary = describeSummary({
    kind: 'trigger-condition',
    node: { type: triggerRaw.type as string, conditions: triggerRaw.conditions as JsonObject },
  })
  const triggerConditionDirect = describeTriggerCondition({ type: triggerRaw.type as string, conditions: triggerRaw.conditions as JsonObject })
  check('触发器条件摘要：入口与生成处文案一致', triggerConditionViaSummary === triggerConditionDirect, { summary: triggerConditionViaSummary, direct: triggerConditionDirect })
  check('触发器条件摘要非空', triggerConditionViaSummary.length > 0, triggerConditionViaSummary)

  const rulesRoot = fixtureRoot('valid', 'behavior-rules')
  const rule = rulesOf(rulesRoot)[0]
  const bindingCount = bindingsOfRule(rulesRoot, String(rule.id)).length
  const ruleViaSummary = describeSummary({ kind: 'rule', rule, bindingCount })
  check('规则摘要：入口与生成处文案一致', ruleViaSummary === describeRuleRow(rule, bindingCount), { summary: ruleViaSummary, direct: describeRuleRow(rule, bindingCount) })
  check('规则摘要非空', ruleViaSummary.length > 0, ruleViaSummary)

  const ruleCondition = rule.condition as JsonObject
  const ruleConditionViaSummary = describeSummary({ kind: 'rule-condition', node: ruleCondition })
  check('规则条件摘要：入口与生成处文案一致', ruleConditionViaSummary === describeRuleCondition(ruleCondition), { summary: ruleConditionViaSummary, direct: describeRuleCondition(ruleCondition) })
  check('规则条件摘要非空', ruleConditionViaSummary.length > 0, ruleConditionViaSummary)

  const action = (rule.actions as JsonObject[])[0]
  const actionViaSummary = describeSummary({ kind: 'action', action })
  check('动作摘要：入口与生成处文案一致', actionViaSummary === describeAction(action), { summary: actionViaSummary, direct: describeAction(action) })
  check('动作摘要非空', actionViaSummary.length > 0, actionViaSummary)

  const binding = bindingsOf(rulesRoot)[0]
  const bindingViaSummary = describeSummary({ kind: 'binding', binding })
  check('绑定摘要：入口与生成处文案一致', bindingViaSummary === describeBinding(binding), { summary: bindingViaSummary, direct: describeBinding(binding) })
  check('绑定摘要非空', bindingViaSummary.length > 0, bindingViaSummary)

  const eventsRoot = fixtureRoot('valid', 'behavior-events')
  const eventNode = eventRecords(eventsRoot)[0]
  const eventViaSummary = describeSummary({ kind: 'event', node: eventNode })
  check('事件摘要：入口与生成处文案一致', eventViaSummary === describeEventRecord(eventNode), { summary: eventViaSummary, direct: describeEventRecord(eventNode) })
  check('事件摘要非空', eventViaSummary.length > 0, eventViaSummary)

  groupEnd('G5 摘要一致性')
}

// ── 事实索引六态（G6）─────────────────────────────────────────────────────────

function factsGroup(): void {
  const emptyCtx = { scriptIds: new Set<string>(), clipIds: new Set<string>(), bindingIds: new Set<string>() }

  // 1. resolved：前置目标在脚本索引内。
  const resolvedRoot: JsonObject = {
    meta: { triggers: [{ id: 't', type: 'login', requires: [{ type: 'script_played', script: 'demo_a' }] }] },
  }
  const resolved = factIndex(resolvedRoot, { ...emptyCtx, scriptIds: new Set(['demo_a']) })
  const resolvedRef = resolved.references.find((item) => item.referenceType === 'requirement' && item.target === 'demo_a')
  check('索引内前置目标 → resolved', resolvedRef?.status === 'resolved', resolvedRef)

  // 2. missing：索引非空但目标缺席。
  const missingRoot: JsonObject = {
    meta: { triggers: [{ id: 't', type: 'login', requires: [{ type: 'script_played', script: 'ghost' }] }] },
  }
  const missingIndex = factIndex(missingRoot, { ...emptyCtx, scriptIds: new Set(['demo_a']) })
  const missingHit = missingIndex.references.find((item) => item.target === 'ghost')
  check('索引外前置目标 → missing', missingHit?.status === 'missing', missingHit)

  // 3. self_reference：前置指向自身；rule_fact 同规则才判自引用。
  const selfRoot: JsonObject = {
    meta: { triggers: [{ id: 't', type: 'login', requires: [{ type: 'script_played', script: 'self1' }] }] },
  }
  const self = factIndex(selfRoot, { ...emptyCtx, scriptIds: new Set(['self1']), selfScriptId: 'self1' })
  const selfRef = self.references.find((item) => item.target === 'self1')
  check('前置指向自身 → self_reference', selfRef?.status === 'self_reference', selfRef)

  const sameRuleRoot: JsonObject = {
    rules: [{ id: 'r1', condition: { type: 'rule_fact', binding: 'b1', fact: 'succeeded' } }],
    rule_bindings: [{ id: 'b1', rule: 'r1', clip: 'c1', gate: { at: 0 } }],
  }
  const sameRule = factIndex(sameRuleRoot, { ...emptyCtx, bindingIds: new Set(['b1']) })
  const sameRuleRef = sameRule.references.find((item) => item.referenceType === 'rule_fact' && item.target === 'b1')
  check('rule_fact 同规则 → self_reference', sameRuleRef?.status === 'self_reference', sameRuleRef)

  // 4. unknown_type：目标为空。
  const unknownRoot: JsonObject = {
    meta: { triggers: [{ id: 't', type: 'login', requires: [{ type: 'script_played', script: '' }] }] },
  }
  const unknown = factIndex(unknownRoot, { ...emptyCtx, scriptIds: new Set(['demo_a']) })
  const unknownRef = unknown.references.find((item) => item.target === '')
  check('空目标 → unknown_type', unknownRef?.status === 'unknown_type', unknownRef)

  // 5. custom_readonly：自定义前置类型。
  const customRoot: JsonObject = {
    meta: { triggers: [{ id: 't', type: 'login', requires: [{ type: 'custom_stage', script: 'demo_a', stage: 'x' }] }] },
  }
  const custom = factIndex(customRoot, emptyCtx)
  const customRef = custom.references.find((item) => item.fact === 'custom_stage')
  check('自定义前置类型 → custom_readonly', customRef?.status === 'custom_readonly', customRef)

  // 6. unresolved：索引空集，不判缺失。
  const unresolved = factIndex(missingRoot, emptyCtx)
  const unresolvedRef = unresolved.references.find((item) => item.target === 'ghost')
  check('脚本索引空集 → unresolved（不判 missing）', unresolvedRef?.status === 'unresolved', unresolvedRef)

  // 跨规则互引：不是自引用。
  const crossRoot: JsonObject = {
    rules: [
      { id: 'r1', condition: { type: 'rule_fact', binding: 'b1', fact: 'succeeded' } },
      { id: 'r2', condition: { type: 'time', at: 1 } },
    ],
    rule_bindings: [{ id: 'b1', rule: 'r2', clip: 'c1', gate: { at: 0 } }],
  }
  const cross = factIndex(crossRoot, { ...emptyCtx, bindingIds: new Set(['b1']) })
  const crossRef = cross.references.find((item) => item.referenceType === 'rule_fact' && item.target === 'b1')
  check('跨规则 rule_fact 互引 → resolved，不判自引用', crossRef?.status === 'resolved', crossRef)

  // 调度 fact 永不判自引用。
  const scheduleRoot: JsonObject = {
    rule_bindings: [{ id: 'b1', rule: 'r1', clip: 'c1', gate: { at: 0 }, schedule: { on: 'fact', binding: 'b1', fact: 'succeeded' } }],
  }
  const schedule = factIndex(scheduleRoot, { ...emptyCtx, bindingIds: new Set(['b1']) })
  const scheduleRef = schedule.references.find((item) => item.referenceType === 'schedule_fact' && item.target === 'b1')
  check('调度 fact 引用自身绑定 → resolved，不判自引用', scheduleRef?.status === 'resolved', scheduleRef)

  // 规则事实索引空集 → unresolved，不判缺失。
  const ruleFactEmpty = factIndex(sameRuleRoot, emptyCtx)
  const ruleFactEmptyRef = ruleFactEmpty.references.find((item) => item.referenceType === 'rule_fact')
  check('绑定索引空集 → unresolved', ruleFactEmptyRef?.status === 'unresolved', ruleFactEmptyRef)

  // 字符串简写前置在有索引时判缺失。
  const shorthandRoot: JsonObject = {
    meta: { triggers: [{ id: 't', type: 'login', requires: ['ghost'] }] },
  }
  const shorthand = factIndex(shorthandRoot, { ...emptyCtx, scriptIds: new Set(['demo_a']) })
  const shorthandRef = shorthand.references.find((item) => item.target === 'ghost')
  check('字符串简写前置索引外 → missing', shorthandRef?.status === 'missing', shorthandRef)

  groupEnd('G6 事实索引')
}

// ── 时间轴事件标记（G7）────────────────────────────────────────────────────────

function markersGroup(): void {
  check('PREVIEW_LEAD = 0.3s', Math.abs(PREVIEW_LEAD - 0.3) < 1e-9, PREVIEW_LEAD)

  const root: JsonObject = {
    meta: {},
    timeline: {
      tracks: [{
        type: 'CAMERA',
        clips: [{ id: 'c1', start_time: 0, duration: 4, objects: {} }],
      }],
    },
    clips: [{ id: 'c2', track: 'CAMERA', duration: 3, objects: {} }],
  }
  const inlineClipKey = 'timeline.tracks[0].clips[0]'
  const standaloneClipKey = 'clips[0]'

  const view: ScriptView = {
    docId: null,
    path: null,
    revision: 0,
    meta: { id: '', name: '', author: '', description: '', dimension: '', priority: 0 },
    triggers: [],
    tracks: [{
      trackId: 'CAMERA#0',
      type: 'CAMERA',
      index: 0,
      name: 'CAMERA',
      clips: [{
        clipKey: inlineClipKey,
        clipId: 'c1',
        start: 0,
        duration: 4,
        loop: false,
        infinite: false,
        label: 'c1',
        references: 0,
        warn: false,
      } satisfies ClipViewEntry],
    }],
    loopStart: null,
    loopEnd: null,
    contentEnd: null,
    infinite: false,
  }
  const standaloneClips: ClipListEntry[] = [
    { clipKey: standaloneClipKey, clipId: 'c2', trackType: 'CAMERA', inline: false, startTime: 5, duration: 3 },
  ]

  const eventRef = (clipKey: string, key: string) => ({ kind: 'event' as const, clipKey, trackType: 'EVENT' as const, key })
  const markers: EventMarker[] = [
    { ref: eventRef(inlineClipKey, 'm1'), clipKey: inlineClipKey, trackType: 'EVENT', objectPath: 'event', localTime: 1, globalTime: 1, kind: 'command', label: 'm1', overDuration: false, placeholder: false },
    { ref: eventRef(inlineClipKey, 'm1b'), clipKey: inlineClipKey, trackType: 'EVENT', objectPath: 'event', localTime: 1, globalTime: 1, kind: 'move', label: 'm1b', overDuration: false, placeholder: false },
    { ref: eventRef(standaloneClipKey, 'm2'), clipKey: standaloneClipKey, trackType: 'EVENT', objectPath: 'event', localTime: 1, globalTime: 6, kind: 'command', label: 'm2', overDuration: false, placeholder: false },
    { ref: eventRef('missing.clip', 'm3'), clipKey: 'missing.clip', trackType: 'EVENT', objectPath: 'event', localTime: 0.5, globalTime: 0.5, kind: 'placeholder', label: 'm3', overDuration: false, placeholder: true },
    { ref: eventRef(inlineClipKey, 'm4'), clipKey: inlineClipKey, trackType: 'EVENT', objectPath: 'event', localTime: 5, globalTime: 5, kind: 'command', label: 'm4', overDuration: true, placeholder: false },
  ]

  const views = resolveMarkers(markers, root, view, standaloneClips)
  const byKey = Object.fromEntries(views.map((item) => [item.marker.label, item]))

  check('内联片段标记定位成功并跟随活起点', byKey.m1?.positioned === true && byKey.m1?.attached === true, byKey.m1)
  check('内联标记全局时间 = 起点 + 局部时间', Math.abs(byKey.m1?.globalTime - 1) < 1e-9, byKey.m1?.globalTime)
  check('内联标记归入轨道组', byKey.m1?.groupKey.startsWith('CAMERA#0:'), byKey.m1?.groupKey)

  check('独立片段标记独立成组', byKey.m2?.standalone === true && byKey.m2?.groupKey.startsWith('standalone:'), byKey.m2)
  check('独立片段全局时间 = 独立起点 + 局部时间', Math.abs(byKey.m2?.globalTime - 6) < 1e-9, byKey.m2?.globalTime)

  check('取不到起点的标记不伪造位置', byKey.m3?.positioned === false, byKey.m3)
  check('无起点标记单独成未定位组', byKey.m3?.groupKey === 'unpositioned:missing.clip', byKey.m3?.groupKey)
  check('无起点标记保留原全局时间', Math.abs(byKey.m3?.globalTime - 0.5) < 1e-9, byKey.m3?.globalTime)

  check('超时长记录钳到片段末尾', Math.abs(byKey.m4?.globalTime - (4 - 1e-6)) < 1e-6, byKey.m4?.globalTime)

  check('canPreview：定位且局部时间 > 0 可预览', canPreview(byKey.m1) === true)
  check('canPreview：无几何不可预览', canPreview(byKey.m3) === false)

  const zeroView = resolveMarkers([
    { ref: eventRef(inlineClipKey, 'z'), clipKey: inlineClipKey, trackType: 'EVENT', objectPath: 'event', localTime: 0, globalTime: 0, kind: 'placeholder', label: 'z', overDuration: false, placeholder: true },
  ], root, view, standaloneClips)[0]
  check('canPreview：局部时间 0 不可预览', canPreview(zeroView) === false)

  check('previewStartOf = 起点 + max(0, 局部时间 - 0.3)', Math.abs(previewStartOf(byKey.m1) - 0.7) < 1e-9, previewStartOf(byKey.m1))
  check('previewStartOf 独立片段按独立起点换算', Math.abs(previewStartOf(byKey.m2) - 5.7) < 1e-9, previewStartOf(byKey.m2))
  const clipped = previewStartOf(byKey.m4)
  check('previewStartOf 末尾记录退到片段末尾之前', clipped <= 4 - 1e-6 && clipped > 3, clipped)

  // 分组聚合：同轨同位置聚合成组，组内按局部时间升序，组间按全局时间升序。
  check('同轨同位置两条标记归入同一组', byKey.m1.groupKey === byKey.m1b.groupKey, { a: byKey.m1.groupKey, b: byKey.m1b.groupKey })
  const grouped = groupMarkers(views)
  const groupKeys = grouped.map((group) => group.key)
  check('分组数 = 内联同位组 / 超时长组 / 独立片段组 / 未定位组', grouped.length === 4, groupKeys)
  const inlineGroup = grouped.find((group) => group.key === byKey.m1.groupKey)
  check('同位组内两条标记且按局部时间升序', inlineGroup !== undefined && inlineGroup.views.length === 2
    && inlineGroup.views.map((v) => v.localTime).join(',') === '1,1', inlineGroup?.views.map((v) => v.localTime))
  check('超时长标记单独成组（不与同位组合并）', byKey.m4.groupKey !== byKey.m1.groupKey, { m4: byKey.m4.groupKey, m1: byKey.m1.groupKey })
  check('组间按全局时间升序', grouped.map((g) => g.globalTime).join(',') === grouped.map((g) => g.globalTime).sort((a, b) => a - b).join(','), grouped.map((g) => g.globalTime))

  groupEnd('G7 事件标记')
}

// ── 静态边界扫描（G8）───────────────────────────────────────────────────────────

function walkSource(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'dist', '.output'].includes(entry.name)) continue
      walkSource(full, out)
    } else if (/\.(ts|vue|tsx|js)$/.test(entry.name)) {
      out.push(full)
    }
  }
}

function staticGroup(): void {
  const allFiles: string[] = []
  walkSource(SRC_DIR, allFiles)
  // 自检脚本自身含被扫字符串（守卫名 / 组件名），不纳入生产代码扫描。
  const files = allFiles.filter((file) => !/[\\/]workbench[\\/]verify(-[^\\]*)?\.ts$/.test(file))
  const sourceOf = new Map<string, string>()
  for (const file of files) sourceOf.set(file, readFileSync(file, 'utf8'))

  // 边界 1：behavior 抽屉页签全仓仅一处注册。
  const behaviorTabRefs: string[] = []
  for (const file of files) {
    const source = sourceOf.get(file) ?? ''
    if (/tabId:\s*'behavior'/.test(source)) behaviorTabRefs.push(relative(REPO_ROOT, file))
  }
  check("tabId: 'behavior' 全仓仅一处注册", behaviorTabRefs.length === 1, behaviorTabRefs)
  check('唯一注册位于 core.behavior/manifest.ts', behaviorTabRefs[0] === join('src/plugins/core.behavior/manifest.ts'), behaviorTabRefs)

  // 边界 2：EventRecordEditor.vue 文件保留，但不被任何 plugins 引用；两个消费面板只挂摘要。
  const editorFiles = files.filter((file) => file.endsWith('EventRecordEditor.vue'))
  check('EventRecordEditor.vue 文件仍在', editorFiles.length === 1, editorFiles.map((f) => relative(REPO_ROOT, f)))
  const externalRefs: string[] = []
  for (const file of files) {
    if (file.endsWith('EventRecordEditor.vue')) continue
    if (sourceOf.get(file)?.includes('EventRecordEditor')) externalRefs.push(relative(REPO_ROOT, file))
  }
  check('EventRecordEditor 不被其它文件引用', externalRefs.length === 0, externalRefs)

  const effectsPanel = join(SRC_DIR, 'plugins/core.clip-effects/panels/ClipEffectsPanel.vue')
  const propsPanel = join(SRC_DIR, 'plugins/core.selection-properties/panels/ClipPropertiesPanel.vue')
  for (const panel of [effectsPanel, propsPanel]) {
    const source = sourceOf.get(panel) ?? ''
    check(`${relative(REPO_ROOT, panel)} 不挂载 EventRecordEditor`, !source.includes('EventRecordEditor'))
    check(`${relative(REPO_ROOT, panel)} 只引用摘要模块 eventRecordSummary`, /eventRecordSummary/.test(source))
  }

  // 边界 1 行为侧栏：触发器只有一个弹窗编辑器，结构树本身没有字段输入控件。
  const drawerDir = join(SRC_DIR, 'plugins/core.behavior/drawer')
  const drawerFiles = files.filter((file) => file.startsWith(drawerDir))
  const drawerPanelsImports: string[] = []
  for (const file of drawerFiles) {
    const source = sourceOf.get(file) ?? ''
    if (/from\s+['"]\.\.\/panels\/[^'"]+\.vue['"]/.test(source)
      || /from\s+['"]\.\.\/\.\.\/panels\/[^'"]+\.vue['"]/.test(source)) {
      drawerPanelsImports.push(relative(REPO_ROOT, file))
    }
  }
  const triggerDialog = join(drawerDir, 'TriggerDialog.vue')
  const triggerDialogSource = sourceOf.get(triggerDialog) ?? ''
  check('行为侧栏只有 TriggerDialog 挂载触发器字段区', drawerPanelsImports.length === 0
    && triggerDialogSource.includes('../editor/TriggerIdentitySection.vue')
    && triggerDialogSource.includes('../editor/TriggerConditionsSection.vue'), drawerPanelsImports)

  const behaviorTree = join(drawerDir, 'BehaviorTree.vue')
  const treeSource = sourceOf.get(behaviorTree) ?? ''
  check('抽屉触发器摘要行不含字段输入控件（input / select / FieldInput）',
    !/<input/.test(treeSource) && !/<select/.test(treeSource) && !/FieldInput/.test(treeSource))

  // 边界 3：不新增脚本字段——顶层键 / meta 键集合与 02 目录一致。
  check('顶层脚本键集合未变（6 个）', [...ROOT_KEYS].join(',') === 'meta,timeline,clips,paths,rules,rule_bindings', ROOT_KEYS)
  const keys = metaKeys(catalog01)
  check('meta 键集合仍为 23 个（02 目录登记）', keys.length === 23, keys)
  const behaviorCatalogFiles = files.filter((file) => /catalog[\\/]behavior/.test(file))
  const metaRegistrations = behaviorCatalogFiles.filter((file) => /segment:\s*'meta'/.test(sourceOf.get(file) ?? ''))
  check('behavior 目录未登记新的 meta 段键', metaRegistrations.length === 0, metaRegistrations.map((f) => relative(REPO_ROOT, f)))

  groupEnd('G8 静态边界')
}

// ── 回归（G9）：复用既有 verify 脚本，不复制内容 ───────────────────────────────

function runSibling(rel: string): { ok: number; fail: number } {
  let stdout = ''
  try {
    stdout = execFileSync(process.execPath, ['--experimental-strip-types', rel], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 1 << 22,
    })
  } catch (error) {
    stdout = ((error as { stdout?: string }).stdout ?? '') as string
  }
  const match = /summary ok=(\d+) fail=(\d+)/.exec(stdout)
  if (match === null) {
    check(`回归脚本 ${rel} 输出 summary 行`, false, stdout.slice(-320))
    return { ok: -1, fail: -1 }
  }
  const siblingOk = Number(match[1])
  const siblingFail = Number(match[2])
  check(`回归脚本 ${rel} fail=0`, siblingFail === 0, { ok: siblingOk, fail: siblingFail })
  return { ok: siblingOk, fail: siblingFail }
}

function regressionGroup(): void {
  const verifyCore = runSibling('src/core/doc/verify.ts')
  check('verify.ts 基线 ok=198', verifyCore.ok === 198, verifyCore.ok)
  const verify05 = runSibling('src/workbench/verify-05.ts')
  check('verify-05 基线可复跑', verify05.fail === 0, verify05)
  const verify07 = runSibling('src/workbench/verify-07.ts')
  check('verify-07 基线 ok=598', verify07.ok === 598, verify07.ok)

  groupEnd('G9 回归')
}

// ── 主流程 ────────────────────────────────────────────────────────────────────

const catalog01 = indexCatalog(buildCatalog('verify-11'))

function main(): void {
  catalogGroup()
  contractGroup()
  commandGroup(catalog01)
  fixtureGroup(catalog01)
  summaryGroup()
  factsGroup()
  markersGroup()
  staticGroup()
  regressionGroup()

  console.log(`summary ok=${ok} fail=${fail}`)
  if (fail > 0) process.exitCode = 1
}

main()
