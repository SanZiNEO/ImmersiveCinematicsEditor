/**
 * 11 轮规则动作纯函数：九动作字段面 / 边界校验 + 唯一摘要生成处。
 *
 * 动作恒作用于触发实例；动作数组顺序即执行顺序（上下移由命令层处理）；
 * 超时动作数组可空，其中不允许命令动作（编辑器合同拦截）。
 */

import type { JsonObject, JsonValue } from '../../core/doc/types.ts'
import {
  describe,
  isFiniteNumber,
  isJsonArray,
  isJsonObject,
} from '../../core/doc/json.ts'
import type { BehaviorProblem } from './shared.ts'
import {
  ACTION_TYPES,
  ADJUST_CHANNELS,
  CAMERA_CHANNELS,
  CAMERA_MODES,
  OVERLAY_LAYER_TYPES,
  actionTypeInfo,
  type BehaviorRefs,
} from '../../core/schema/catalog/behaviorRules.ts'

// ── 上下文 ──────────────────────────────────────────────────────────────────

/** 动作校验 / 摘要上下文。 */
export interface ActionContext {
  refs?: BehaviorRefs
  /** 是否处于超时动作数组（`on_timeout`）；其中命令动作按合同拦截。 */
  timedOut?: boolean
  basePath?: string
}

function problem(
  code: string,
  severity: BehaviorProblem['severity'],
  message: string,
  jsonPath: string,
): BehaviorProblem {
  return { code, severity, message, jsonPath }
}

const HEX_COLOR = /^#?[0-9a-fA-F]{6}$/

// ── 动作数组校验 ──────────────────────────────────────────────────────────────

/** 校验动作数组（主动作或超时动作；`timedOut` 区分合同约束）。 */
export function validateActions(actions: JsonValue, ctx: ActionContext = {}): BehaviorProblem[] {
  const basePath = ctx.basePath ?? 'actions'
  const issues: BehaviorProblem[] = []

  if (!isJsonArray(actions)) {
    issues.push(problem('ACTIONS_TYPE', 'block', 'actions 需要数组（元素 = 动作对象）', basePath))
    return issues
  }

  actions.forEach((action, index) => {
    issues.push(...validateAction(action, index, { ...ctx, basePath: `${basePath}[${index}]` }))
  })

  return issues
}

function validateAction(action: JsonValue, index: number, ctx: ActionContext): BehaviorProblem[] {
  const issues: BehaviorProblem[] = []
  const path = ctx.basePath ?? `actions[${index}]`

  if (!isJsonObject(action)) {
    issues.push(problem('ACTION_TYPE', 'block', '动作需要对象', path))
    return issues
  }

  const type = action.type
  if (typeof type !== 'string' || type.length === 0) {
    issues.push(problem('ACTION_TYPE_MISSING', 'block', '动作类型缺失（必填 type）', `${path}.type`))
    return issues
  }

  const info = actionTypeInfo(type)
  if (!info) {
    issues.push(problem('ACTION_TYPE_UNKNOWN', 'block',
      `规则动作不支持该类型: ${type}（可选: ${ACTION_TYPES.join(' / ')}）`, `${path}.type`))
    return issues
  }

  const knownKeys = new Set(['type', ...info.fields.map((field) => field.key)])
  for (const key of Object.keys(action)) {
    if (!knownKeys.has(key)) {
      issues.push(problem('ACTION_UNKNOWN_KEY', 'block',
        `未知键（${type} 可用: ${[...knownKeys].filter((k) => k !== 'type').join(' / ')}）`, `${path}.${key}`))
    }
  }

  if (info.noParams) {
    const extra = Object.keys(action).filter((key) => key !== 'type')
    if (extra.length > 0) {
      issues.push(problem('ACTION_NO_PARAM', 'block',
        `${type} 是无参动作，不接受额外键: ${extra.join(' / ')}`, `${path}.${extra[0]}`))
    }
    return issues
  }

  switch (type) {
    case 'camera_set':
      validateCameraSet(action, path, issues)
      break
    case 'overlay_set':
      validateOverlaySet(action, path, issues)
      break
    case 'adjust_set':
      validateAdjustSet(action, path, issues)
      break
    case 'goto_clip':
      validateGotoClip(action, path, ctx, issues)
      break
    case 'play_sound':
      validatePlaySound(action, path, issues)
      break
    case 'emit_command':
      validateEmitCommand(action, path, ctx, issues)
      break
    default:
      break
  }

  return issues
}

// ── camera_set ────────────────────────────────────────────────────────────────

function validateCameraSet(action: JsonObject, path: string, issues: BehaviorProblem[]): void {
  const channels = action.channels
  if (!isJsonArray(channels) || channels.length === 0) {
    issues.push(problem('ACTION_CAMERA_CHANNELS_EMPTY', 'block',
      `camera_set 需要非空 channels 数组（通道: ${CAMERA_CHANNELS.join(' / ')}）`, `${path}.channels`))
    return
  }

  const selected = new Set<string>()
  channels.forEach((entry, index) => {
    if (typeof entry !== 'string') {
      issues.push(problem('ACTION_CAMERA_CHANNEL_TYPE', 'error',
        `channels[${index}] 需要字符串通道名`, `${path}.channels[${index}]`))
      return
    }
    if (!CAMERA_CHANNELS.includes(entry)) {
      issues.push(problem('ACTION_CAMERA_CHANNEL_UNKNOWN', 'error',
        `camera_set 未知通道: ${entry}（可用: ${CAMERA_CHANNELS.join(' / ')}）`, `${path}.channels[${index}]`))
      return
    }
    if (selected.has(entry)) {
      issues.push(problem('ACTION_CAMERA_CHANNEL_DUPLICATE', 'error',
        `camera_set 通道重复: ${entry}`, `${path}.channels[${index}]`))
      return
    }
    selected.add(entry)
  })

  // 选中通道必须给值；给值但未选通道 = 错误。
  for (const channel of CAMERA_CHANNELS) {
    const value = action[channel]
    const isSelected = selected.has(channel)
    if (isSelected) {
      if (channel === 'position') {
        if (value === undefined) {
          issues.push(problem('ACTION_CAMERA_VALUE_MISSING', 'error',
            '选中通道 position 需要对象 {x,y,z} 值', `${path}.position`))
        } else {
          validatePosition(value, `${path}.position`, issues)
        }
      } else if (!isFiniteNumber(value)) {
        issues.push(problem('ACTION_CAMERA_VALUE_MISSING', 'error',
          `选中通道 ${channel} 需要有限数字值`, `${path}.${channel}`))
      }
    } else if (value !== undefined) {
      issues.push(problem('ACTION_CAMERA_VALUE_UNSELECTED', 'error',
        `写了 ${channel} 值但未在 channels 中选中该通道`, `${path}.${channel}`))
    }
  }

  const mode = action.mode
  if (mode !== undefined && (typeof mode !== 'string' || !CAMERA_MODES.includes(mode))) {
    issues.push(problem('ACTION_CAMERA_MODE', 'error',
      `mode 需要 add / multiply / replace，实际: ${describe(mode)}`, `${path}.mode`))
  }

  const priority = action.priority
  if (priority !== undefined && (!isFiniteNumber(priority) || !Number.isInteger(priority))) {
    issues.push(problem('ACTION_CAMERA_PRIORITY', 'error',
      `priority 需要整数，实际: ${describe(priority)}`, `${path}.priority`))
  }
}

function validatePosition(value: JsonValue | undefined, path: string, issues: BehaviorProblem[]): void {
  if (!isJsonObject(value)) {
    issues.push(problem('ACTION_CAMERA_POSITION', 'error', 'position 需要对象 {x,y,z}', path))
    return
  }
  for (const axis of ['x', 'y', 'z'] as const) {
    if (!isFiniteNumber(value[axis])) {
      issues.push(problem(`ACTION_CAMERA_POSITION_${axis.toUpperCase()}`, 'error',
        `position.${axis} 需要有限数字`, `${path}.${axis}`))
    }
  }
}

// ── overlay_set ──────────────────────────────────────────────────────────────

function validateOverlaySet(action: JsonObject, path: string, issues: BehaviorProblem[]): void {
  const layerType = action.layer_type
  if (typeof layerType !== 'string' || !OVERLAY_LAYER_TYPES.includes(layerType)) {
    issues.push(problem('ACTION_OVERLAY_TYPE', 'block',
      `layer_type 需要 ${OVERLAY_LAYER_TYPES.join(' / ')}，实际: ${describe(layerType)}`, `${path}.layer_type`))
  }

  const color = action.color
  if (color !== undefined && (typeof color !== 'string' || !HEX_COLOR.test(color))) {
    issues.push(problem('ACTION_OVERLAY_COLOR', 'error',
      'color 需要六位十六进制颜色（# 可省，如 #000000）', `${path}.color`))
  }

  const opacity = action.opacity
  if (opacity !== undefined && (!isFiniteNumber(opacity) || opacity < 0 || opacity > 1)) {
    issues.push(problem('ACTION_OVERLAY_OPACITY', 'error',
      `opacity 需要 0 ~ 1，实际: ${describe(opacity)}`, `${path}.opacity`))
  }

  const zIndex = action.z_index
  if (zIndex !== undefined && (!isFiniteNumber(zIndex) || !Number.isInteger(zIndex))) {
    issues.push(problem('ACTION_OVERLAY_Z_INDEX', 'error',
      `z_index 需要整数，实际: ${describe(zIndex)}`, `${path}.z_index`))
  }
}

// ── adjust_set ────────────────────────────────────────────────────────────────

function validateAdjustSet(action: JsonObject, path: string, issues: BehaviorProblem[]): void {
  const written = ADJUST_CHANNELS.filter((channel) => action[channel] !== undefined)
  if (written.length === 0) {
    issues.push(problem('ACTION_ADJUST_EMPTY', 'block',
      `adjust_set 至少写一个通道（可用: ${ADJUST_CHANNELS.join(' / ')}）`, path))
  }
  for (const channel of ADJUST_CHANNELS) {
    const value = action[channel]
    if (value === undefined) continue
    if (!isFiniteNumber(value)) {
      issues.push(problem('ACTION_ADJUST_CHANNEL', 'error',
        `通道 ${channel} 需要有限数字，实际: ${describe(value)}`, `${path}.${channel}`))
    }
  }
}

// ── goto_clip ────────────────────────────────────────────────────────────────

function validateGotoClip(
  action: JsonObject,
  path: string,
  ctx: ActionContext,
  issues: BehaviorProblem[],
): void {
  // 旧形态字段（track / at）已废弃：拒绝，不静默忽略。
  if (action.track !== undefined) {
    issues.push(problem('ACTION_GOTO_TRACK_LEGACY', 'block',
      'goto_clip 旧字段 track 已废弃：新形态用 clip 片段 id 寻址', `${path}.track`))
  }
  if (action.at !== undefined) {
    issues.push(problem('ACTION_GOTO_AT_LEGACY', 'block',
      'goto_clip 旧字段 at 已废弃：入口时间用 entry_time', `${path}.at`))
  }

  const clip = action.clip
  if (typeof clip !== 'string' || clip.length === 0) {
    issues.push(problem('ACTION_GOTO_CLIP_MISSING', 'block', 'goto_clip 缺少目标片段 id（clip）', `${path}.clip`))
  } else if (ctx.refs && !ctx.refs.clipIds.has(clip)) {
    issues.push(problem('ACTION_GOTO_CLIP_UNKNOWN', 'block', `未知片段引用: ${clip}`, `${path}.clip`))
  }

  const entryTime = action.entry_time
  if (entryTime !== undefined && (!isFiniteNumber(entryTime) || entryTime < 0)) {
    issues.push(problem('ACTION_GOTO_ENTRY_TIME', 'error',
      `entry_time 需要 >= 0 的有限数字（入口局部秒），实际: ${describe(entryTime)}`, `${path}.entry_time`))
  }
}

// ── play_sound ────────────────────────────────────────────────────────────────

function validatePlaySound(action: JsonObject, path: string, issues: BehaviorProblem[]): void {
  const sound = action.sound
  if (typeof sound !== 'string' || sound.length === 0) {
    issues.push(problem('ACTION_SOUND_MISSING', 'block', 'play_sound 缺少音效 id（sound）', `${path}.sound`))
  }
  const volume = action.volume
  if (volume !== undefined && !isFiniteNumber(volume)) {
    issues.push(problem('ACTION_SOUND_VOLUME', 'error', `volume 需要有限数字，实际: ${describe(volume)}`, `${path}.volume`))
  }
  const pitch = action.pitch
  if (pitch !== undefined && !isFiniteNumber(pitch)) {
    issues.push(problem('ACTION_SOUND_PITCH', 'error', `pitch 需要有限数字，实际: ${describe(pitch)}`, `${path}.pitch`))
  }
}

// ── emit_command ──────────────────────────────────────────────────────────────

function validateEmitCommand(
  action: JsonObject,
  path: string,
  ctx: ActionContext,
  issues: BehaviorProblem[],
): void {
  if (ctx.timedOut) {
    issues.push(problem('ACTION_COMMAND_IN_TIMEOUT', 'block',
      '超时动作（on_timeout）里不允许 emit_command：命令表只编译主动作列表，超时动作无法解析命令',
      `${path}.command`))
  }

  const command = action.command
  if (typeof command !== 'string' || command.trim().length === 0) {
    issues.push(problem('ACTION_COMMAND_MISSING', 'block', 'emit_command 缺少命令原文（command）', `${path}.command`))
    return
  }
  if (command.startsWith('/')) {
    issues.push(problem('ACTION_COMMAND_SLASH', 'warn',
      '命令带前导斜杠：脚本命令原文不带 /，多条用 && 分隔', `${path}.command`))
  }
}

// ── 全脚本 pause / resume 配对诊断 ─────────────────────────────────────────────

/**
 * 全脚本扫描 pause / resume 配对（主动作 + `on_timeout` 都计入）。
 *
 * 口径对齐 `RuleRuntime.computePauseReleasable`：pause 的释放者 = 任一 `resume` 动作，
 * 或任一带非立即 `schedule` 的绑定（调度释放仍可能）。静态层只报「无释放者」与
 * 「无配对 pause」两类；运行时的可触发性判断不在编辑器内预测（11-10 §持有）。
 */
export function validatePauseResumePairing(root: JsonObject): BehaviorProblem[] {
  const issues: BehaviorProblem[] = []
  let pauseCount = 0
  let resumeCount = 0
  let hasScheduledBinding = false

  const rules = root.rules
  if (isJsonArray(rules)) {
    rules.forEach((rule) => {
      if (!isJsonObject(rule)) return
      countActionTypes(rule.actions, (type) => {
        if (type === 'pause') pauseCount += 1
        else if (type === 'resume') resumeCount += 1
      })
      const policy = rule.policy
      if (isJsonObject(policy) && isJsonArray(policy.on_timeout)) {
        countActionTypes(policy.on_timeout, (type) => {
          if (type === 'pause') pauseCount += 1
          else if (type === 'resume') resumeCount += 1
        })
      }
    })
  }

  const bindings = root.rule_bindings
  if (isJsonArray(bindings)) {
    for (const entry of bindings) {
      if (isJsonObject(entry) && entry.schedule !== undefined) hasScheduledBinding = true
    }
  }

  if (pauseCount > 0 && resumeCount === 0 && !hasScheduledBinding) {
    issues.push(problem('ACTION_PAUSE_UNPAIRED', 'warn',
      '存在 pause 动作，但脚本内没有任何 resume 配对（也没有带调度的绑定兜底）；运行时会告警并自动释放暂停持有',
      'rules'))
  }
  if (resumeCount > 0 && pauseCount === 0) {
    issues.push(problem('ACTION_RESUME_UNPAIRED', 'warn',
      '存在 resume 动作，但脚本内没有配对的 pause', 'rules'))
  }

  return issues
}

function countActionTypes(actions: JsonValue, onType: (type: string) => void): void {
  if (!isJsonArray(actions)) return
  for (const action of actions) {
    if (!isJsonObject(action)) continue
    if (typeof action.type === 'string') onType(action.type)
  }
}

// ── 旧字段收集 ────────────────────────────────────────────────────────────────

/** 返回当前动作类型字段表之外、残留的旧键（只读旧字段块用）。 */
export function legacyActionKeys(action: JsonValue): string[] {
  if (!isJsonObject(action)) return []
  const type = typeof action.type === 'string' ? action.type : undefined
  const info = type ? actionTypeInfo(type) : undefined
  const known = new Set(['type', ...(info ? info.fields.map((field) => field.key) : [])])
  return Object.keys(action).filter((key) => !known.has(key))
}

// ── 摘要（唯一生成处）─────────────────────────────────────────────────────────

/** 生成动作摘要；未知类型 / 非法形态给占位描述，不抛错。 */
export function describeAction(action: JsonValue, _ctx: ActionContext = {}): string {
  if (!isJsonObject(action)) return '动作不是对象'
  const type = typeof action.type === 'string' ? action.type : undefined
  if (!type) return '动作类型缺失'

  switch (type) {
    case 'camera_set':
      return describeCameraSet(action)
    case 'overlay_set':
      return describeOverlaySet(action)
    case 'adjust_set':
      return describeAdjustSet(action)
    case 'goto_clip':
      return describeGotoClip(action)
    case 'pause':
      return '暂停实例'
    case 'resume':
      return '恢复实例'
    case 'exit':
      return '结束当前播放实例（渐出）'
    case 'play_sound':
      return describePlaySound(action)
    case 'emit_command':
      return `执行命令 ${typeof action.command === 'string' ? action.command : '?'}`
    default:
      return `未知动作 ${type}`
  }
}

function describeCameraSet(action: JsonObject): string {
  const channels = isJsonArray(action.channels)
    ? action.channels.filter((entry): entry is string => typeof entry === 'string')
    : []
  const mode = typeof action.mode === 'string' ? action.mode : '缺省'
  const priority = isFiniteNumber(action.priority) ? action.priority : 0
  return `相机修改 ${channels.join('+') || '?'}（${mode}，优先级 ${priority}）`
}

function describeOverlaySet(action: JsonObject): string {
  const layer = typeof action.layer_type === 'string' ? action.layer_type : 'fade'
  const color = typeof action.color === 'string' ? action.color : '#000000'
  const opacity = isFiniteNumber(action.opacity) ? action.opacity : 1
  const zIndex = isFiniteNumber(action.z_index) ? action.z_index : 10
  return `覆盖层 ${layer} ${color} 不透明度 ${fmtNum(opacity)} z=${fmtNum(zIndex)}`
}

function describeAdjustSet(action: JsonObject): string {
  const written = ADJUST_CHANNELS.filter((channel) => action[channel] !== undefined)
  return `调色 ${written.join('+') || '?'}`
}

function describeGotoClip(action: JsonObject): string {
  const clip = typeof action.clip === 'string' ? action.clip : '?'
  const entryTime = isFiniteNumber(action.entry_time) ? action.entry_time : 0
  return `跳转片段 ${clip}（入口 ${fmtNum(entryTime)}s）`
}

function describePlaySound(action: JsonObject): string {
  const sound = typeof action.sound === 'string' ? action.sound : '?'
  const volume = isFiniteNumber(action.volume) ? action.volume : 1
  const pitch = isFiniteNumber(action.pitch) ? action.pitch : 1
  return `播放音效 ${sound}（音量 ${fmtNum(volume)}，音调 ${fmtNum(pitch)}）`
}

function fmtNum(value: number): string {
  return String(Math.round(value * 100) / 100)
}
