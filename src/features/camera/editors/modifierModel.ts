/**
 * 覆盖链 `modifier` 结构的纯解析 / 草稿 / 序列化（08-01 §三 / §4.3）。
 *
 * 运行时契约以模组 `ScriptParser#parseClipModifier:677` 与 `CameraChannels` 为准：
 * - `modifier` 是一个对象路径（`type=struct`、`mode=value`，不可打帧）；
 * - 形态 `{ channels: [...], mode?: 'add'|'multiply'|'replace', priority?: 整数, <通道值> }`；
 * - 勾选的通道才出现值键；未勾选通道残留值键会被解析器直接拒绝，取消勾选必须删键；
 * - `mode` 缺省档 = 逐通道缺省，落盘时不写 `mode` 键；
 * - `priority` 缺省 0；清空输入即不写键；
 * - 结构键 / 通道名之外的未知键：读取时记下来，提交时原样带回，不静默删除。
 *
 * 本模块不读 store、不写文档、不提交；所有回退只用于界面读数，不夹紧作者输入。
 */
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import { isFiniteNumber, isJsonObject, sameJson } from '../../../core/doc/json.ts'
import {
  MODIFIER_CHANNELS,
  MODIFIER_KEYS,
  MODIFIER_MODES,
  type ModifierMode,
} from '../fieldSurface.ts'
import type { TransitionChannel } from '../transition/model.ts'

/** 通道的三轴分量（仅 `position` 通道）。 */
export const POSITION_AXES = ['x', 'y', 'z'] as const
export type PositionAxis = (typeof POSITION_AXES)[number]

/**
 * 模式三态 + 逐通道缺省档。
 *
 * `null` = 逐通道缺省：不写 `mode` 键（position/yaw/pitch/roll 走 add、fov/zoom 走 multiply）。
 */
export type ModeChoice = ModifierMode | null

/** 草稿：勾选状态、各通道输入、模式、优先级、原样带回的未知键。 */
export interface ModifierDraft {
  /** 已勾选（声明）的通道。 */
  channels: Set<TransitionChannel>
  /** 标量通道 → 输入文本。 */
  scalar: Record<TransitionChannel, string>
  /** `position` 通道三轴输入文本。 */
  position: Record<PositionAxis, string>
  /** 合成模式选择；`null` = 逐通道缺省（不写 `mode` 键）。 */
  mode: ModeChoice
  /** 优先级输入文本；空串 = 不写 `priority` 键。 */
  priority: string
  /** 不在契约内的未知键（提交时原样带回）。 */
  unknown: Record<string, JsonValue>
}

/** 单通道 / 单分量校验失败时的可读原因（`null` = 合法）。 */
export type DraftIssue = string | null

/** 标量值 → 输入文本（非有限数字时保留原始展示，不夹紧）。 */
function scalarText(raw: JsonValue | undefined): string {
  if (raw === undefined) {
    return ''
  }
  if (isFiniteNumber(raw)) {
    return String(raw)
  }
  return typeof raw === 'string' ? raw : ''
}

/** 读取文档对象，初始化一份草稿。 */
export function draftFromDoc(source: JsonObject | null): ModifierDraft {
  const emptyScalar = Object.fromEntries(
    MODIFIER_CHANNELS.filter((channel) => channel !== 'position').map((channel) => [channel, '']),
  ) as Record<TransitionChannel, string>

  const draft: ModifierDraft = {
    channels: new Set<TransitionChannel>(),
    scalar: emptyScalar,
    position: { x: '', y: '', z: '' },
    mode: null,
    priority: '',
    unknown: {},
  }

  if (source === null) {
    return draft
  }

  const channelNames = new Set<string>(MODIFIER_CHANNELS)
  const knownKeys = new Set<string>([
    MODIFIER_KEYS.channels,
    MODIFIER_KEYS.mode,
    MODIFIER_KEYS.priority,
    ...MODIFIER_CHANNELS,
  ])

  // 通道掩码：文档 `channels` 数组里属于六通道名的项；未知 / 重复项由解析器拒绝，
  // 界面只认已知通道，其余不回填勾选。
  const declared = source[MODIFIER_KEYS.channels]
  if (Array.isArray(declared)) {
    for (const item of declared) {
      if (typeof item === 'string' && channelNames.has(item)) {
        draft.channels.add(item as TransitionChannel)
      }
    }
  }

  for (const channel of MODIFIER_CHANNELS) {
    if (!draft.channels.has(channel)) {
      continue
    }
    const raw = source[channel]
    if (channel === 'position') {
      if (isJsonObject(raw)) {
        for (const axis of POSITION_AXES) {
          draft.position[axis] = scalarText(raw[axis])
        }
      }
    } else {
      draft.scalar[channel] = scalarText(raw)
    }
  }

  const modeRaw = source[MODIFIER_KEYS.mode]
  draft.mode = typeof modeRaw === 'string' && isModifierMode(modeRaw) ? modeRaw : null

  const priorityRaw = source[MODIFIER_KEYS.priority]
  draft.priority = isFiniteNumber(priorityRaw) ? String(priorityRaw) : ''

  for (const key of Object.keys(source)) {
    if (!knownKeys.has(key)) {
      draft.unknown[key] = source[key]
    }
  }

  return draft
}

/** 是否为合法合成模式取值。 */
function isModifierMode(value: string): value is ModifierMode {
  return MODIFIER_MODES.includes(value as ModifierMode)
}

/** 标量通道草稿是否可解析为有限数字。 */
export function scalarIssue(channel: TransitionChannel, draft: ModifierDraft): DraftIssue {
  if (channel === 'position') {
    return positionIssue(draft)
  }
  const text = draft.scalar[channel].trim()
  const number = Number(text)
  if (!Number.isFinite(number)) {
    return `${channel} 需要有限数字`
  }
  return null
}

/** `position` 三轴是否都可解析为有限数字。 */
export function positionIssue(draft: ModifierDraft): DraftIssue {
  for (const axis of POSITION_AXES) {
    const number = Number(draft.position[axis].trim())
    if (!Number.isFinite(number)) {
      return `position.${axis} 需要有限数字`
    }
  }
  return null
}

/** 优先级输入是否可解析为整数；空串 = 不写键（合法）。 */
export function priorityIssue(draft: ModifierDraft): DraftIssue {
  const text = draft.priority.trim()
  if (text === '') {
    return null
  }
  const number = Number(text)
  if (!Number.isFinite(number) || !Number.isInteger(number)) {
    return 'priority 需要整数（留空则不写键，运行时按 0）'
  }
  return null
}

/** 整表校验：返回第一条不可提交的原因；`null` = 可提交。 */
export function draftProblem(draft: ModifierDraft): DraftIssue {
  if (draft.channels.size === 0) {
    return '至少声明一个通道'
  }
  for (const channel of MODIFIER_CHANNELS) {
    if (!draft.channels.has(channel)) {
      continue
    }
    const issue = scalarIssue(channel, draft)
    if (issue !== null) {
      return issue
    }
  }
  return priorityIssue(draft)
}

/** 把草稿序列化成可提交的对象值；调用前必须 `draftProblem` 为 `null`。 */
export function draftToObject(draft: ModifierDraft): JsonObject {
  const object: JsonObject = {}

  object[MODIFIER_KEYS.channels] = MODIFIER_CHANNELS.filter((channel) => draft.channels.has(channel))

  if (draft.mode !== null) {
    object[MODIFIER_KEYS.mode] = draft.mode
  }

  const priorityText = draft.priority.trim()
  if (priorityText !== '') {
    object[MODIFIER_KEYS.priority] = Number(priorityText)
  }

  for (const channel of MODIFIER_CHANNELS) {
    if (!draft.channels.has(channel)) {
      continue
    }
    if (channel === 'position') {
      object.position = {
        x: Number(draft.position.x.trim()),
        y: Number(draft.position.y.trim()),
        z: Number(draft.position.z.trim()),
      }
    } else {
      object[channel] = Number(draft.scalar[channel].trim())
    }
  }

  // 契约外的未知键原样带回，不静默删除。
  for (const [key, value] of Object.entries(draft.unknown)) {
    object[key] = value
  }

  return object
}

/** 草稿是否与文档一致（未提交改动提示用）。比较已勾选通道、各值、模式、优先级。 */
export function draftMatchesDoc(draft: ModifierDraft, source: JsonObject | null): boolean {
  if (source === null) {
    return (
      draft.channels.size === 0
      && draft.mode === null
      && draft.priority.trim() === ''
      && Object.keys(draft.unknown).length === 0
    )
  }

  const channelsRaw = source[MODIFIER_KEYS.channels]
  const docChannels = Array.isArray(channelsRaw)
    ? channelsRaw.filter((item): item is TransitionChannel =>
        typeof item === 'string' && MODIFIER_CHANNELS.includes(item as TransitionChannel))
    : []
  const draftChannels = MODIFIER_CHANNELS.filter((channel) => draft.channels.has(channel))
  if (docChannels.length !== draftChannels.length) {
    return false
  }
  const docChannelSet = new Set(docChannels)
  if (draftChannels.some((channel) => !docChannelSet.has(channel))) {
    return false
  }

  const docMode = source[MODIFIER_KEYS.mode]
  const docModeChoice: ModeChoice = typeof docMode === 'string' && isModifierMode(docMode) ? docMode : null
  if (draft.mode !== docModeChoice) {
    return false
  }

  const docPriority = source[MODIFIER_KEYS.priority]
  const docPriorityText = isFiniteNumber(docPriority) ? String(docPriority) : ''
  if (draft.priority.trim() !== docPriorityText) {
    return false
  }

  const unknownKeys = Object.keys(draft.unknown)
  const docUnknownKeys = Object.keys(source).filter(
    (key) => !MODIFIER_CHANNELS.includes(key as TransitionChannel)
      && key !== MODIFIER_KEYS.channels
      && key !== MODIFIER_KEYS.mode
      && key !== MODIFIER_KEYS.priority,
  )
  if (unknownKeys.length !== docUnknownKeys.length) {
    return false
  }
  for (const key of unknownKeys) {
    if (!sameJson(draft.unknown[key], source[key])) {
      return false
    }
  }

  for (const channel of MODIFIER_CHANNELS) {
    if (!draft.channels.has(channel)) {
      continue
    }
    const raw = source[channel]
    if (channel === 'position') {
      if (!isJsonObject(raw)) {
        return false
      }
      for (const axis of POSITION_AXES) {
        if (draft.position[axis].trim() !== scalarText(raw[axis])) {
          return false
        }
      }
    } else if (draft.scalar[channel].trim() !== scalarText(raw)) {
      return false
    }
  }

  return true
}
