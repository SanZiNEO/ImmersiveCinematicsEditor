/**
 * 覆盖层便利预设（09-08）。
 *
 * 约束（09-08 §4.1 / §4.2，注册期就报错）：
 * - 只写 OVERLAY / LETTERBOX 的既有字段；
 * - 关键帧路径必须是 `mode=animated`；
 * - 删除项只能删目标层类型不适用的字段；
 * - 不写视图 / 轨道 / 合成 / 相机 / 过渡 / 调色字段。
 *
 * 预设本身不序列化：应用只产出普通 `DocCommand[]`，由调用方一次 `commitBatch`。
 */
import type { CatalogIndex } from '../../core/schema/index.ts'
import type { FieldEntry } from '../../core/schema/types.ts'
import type { JsonObject, JsonValue, ObjectKeyframe } from '../../core/doc/types.ts'
import type { DocCommand } from '../../core/doc/commands.ts'
import { isJsonObject } from '../../core/doc/json.ts'
import { effectiveLayerType, hiddenOverlayFieldReason, isOverlayLayerType, planLayerSwitch } from './layers.ts'
import type { OverlayLayerType } from './layers.ts'

/** 预设分组。 */
export type PresetGroup = 'fade' | 'image' | 'subtitle' | 'letterbox' | 'layer'

/** 预设应用模式。 */
export type PresetMode = 'new' | 'apply' | 'both'

/** 关键帧时间：绝对秒 / 片段末尾 / 片段末尾往前 N 秒。 */
export type PresetFrameTime = number | 'end' | { endMinus: number }

/** 一条关键帧规格。 */
export interface PresetFrameSpec {
  at: PresetFrameTime
  value: JsonValue
}

/** 一个预设。 */
export interface OverlayPreset {
  id: string
  name: string
  group: PresetGroup
  trackType: 'OVERLAY' | 'LETTERBOX'
  /** OVERLAY 预设的目标层类型；LETTERBOX 不需要。 */
  targetLayerType?: OverlayLayerType
  /** 层类型无关的预设（只改 `z_index`，不触发层转换）。 */
  anyLayerType?: boolean
  mode: PresetMode
  description: string
  /** 静态写入（value-only 或动画字段的静态值）。 */
  fields: Array<{ path: string; value: JsonValue }>
  /** 关键帧写入（替换同路径已有帧）。 */
  keyframes?: Array<{ path: string; frames: PresetFrameSpec[] }>
  /** 显式删除（只用于层类型转换后的死字段之外的清理）。 */
  remove?: string[]
}

/** 预设注册错误。 */
export interface PresetIssue {
  presetId: string
  message: string
}

/** 判断路径是否属于允许写的轨道（拒绝相机 / 过渡 / 调色等）。 */
function isAllowedTrack(trackType: string): boolean {
  return trackType === 'OVERLAY' || trackType === 'LETTERBOX'
}

/** 注册期校验用的伪对象：由预设声明反推目标层类型 / 渐变类型 / 遮罩形状。 */
function presetObjectsForValidation(preset: OverlayPreset): JsonObject {
  const objects: JsonObject = {}
  if (preset.targetLayerType !== undefined) {
    objects.layer_type = { value: preset.targetLayerType }
  }
  for (const field of preset.fields) {
    objects[field.path] = { value: field.value }
  }
  return objects
}

/** 注册期校验：字段存在、关键帧路径可动画、删除路径存在且不属于目标字段面。 */
export function validatePreset(preset: OverlayPreset, catalog: CatalogIndex): PresetIssue[] {
  const issues: PresetIssue[] = []
  const push = (message: string): void => {
    issues.push({ presetId: preset.id, message })
  }
  if (!isAllowedTrack(preset.trackType)) {
    push(`轨道类型 ${preset.trackType} 不允许（只允许 OVERLAY / LETTERBOX）`)
    return issues
  }
  if (preset.trackType === 'OVERLAY' && preset.targetLayerType === undefined && preset.anyLayerType !== true) {
    push('OVERLAY 预设必须声明目标层类型（或显式 anyLayerType）')
  }
  if (preset.trackType === 'OVERLAY' && preset.targetLayerType === undefined && preset.anyLayerType === true) {
    // 层类型无关的预设：只允许写三种层都读取的字段（典型是 z_index / opacity）。
    for (const field of preset.fields) {
      const def = catalog.objectDef('OVERLAY', field.path)
      if (def === undefined) {
        push(`字段不在 schema: ${field.path}`)
        continue
      }
      const applies = def.appliesTo ?? []
      if (applies.length > 0) {
        push(`层类型无关的预设不能写只作用于 ${applies.join('/')} 的字段: ${field.path}`)
      }
    }
  }
  if (preset.trackType === 'OVERLAY' && preset.targetLayerType !== undefined && !isOverlayLayerType(preset.targetLayerType)) {
    push(`目标层类型非法: ${String(preset.targetLayerType)}`)
  }
  for (const field of preset.fields) {
    const def = catalog.objectDef(preset.trackType, field.path)
    if (def === undefined) {
      push(`字段不在 schema: ${field.path}`)
      continue
    }
    if (def.mode === 'event') {
      push(`事件字段不能写静态值: ${field.path}`)
    }
    if (field.value === undefined) {
      push(`预设值不能是 undefined: ${field.path}`)
    }
  }
  for (const group of preset.keyframes ?? []) {
    const def = catalog.objectDef(preset.trackType, group.path)
    if (def === undefined) {
      push(`关键帧字段不在 schema: ${group.path}`)
      continue
    }
    if (def.mode !== 'animated') {
      push(`关键帧路径不是动画字段: ${group.path}（mode=${def.mode ?? 'value'}）`)
    }
    if (group.frames.length < 1) {
      push(`关键帧组为空: ${group.path}`)
    }
    let previous: number | null = null
    for (const frame of group.frames) {
      if (typeof frame.at === 'number') {
        if (!Number.isFinite(frame.at) || frame.at < 0) {
          push(`关键帧时间非法: ${group.path} at=${frame.at}`)
        } else if (previous !== null && frame.at <= previous) {
          push(`关键帧时间必须严格递增: ${group.path} ${previous} → ${frame.at}`)
        } else {
          previous = frame.at
        }
      }
    }
  }
  for (const path of preset.remove ?? []) {
    const def = catalog.objectDef(preset.trackType, path)
    if (def === undefined) {
      push(`删除项不在 schema: ${path}`)
      continue
    }
    if (preset.trackType === 'OVERLAY' && preset.targetLayerType !== undefined) {
      // 删除项必须是目标层类型**在给定子形态下**不读取的字段：
      // 线性渐变不读半径、径向不读角度；矩形不读半径、圆不读宽高。
      const pseudo = presetObjectsForValidation(preset)
      const reason = hiddenOverlayFieldReason(preset.targetLayerType, pseudo, path)
      if (reason === null) {
        push(`删除项在当前目标层类型 / 子形态下仍会被读取: ${path}`)
      }
    }
  }
  return issues
}

/** 解析关键帧时间（片段时长）。 */
export function resolveFrameTime(at: PresetFrameTime, duration: number): number | null {
  if (typeof at === 'number') {
    return Number.isFinite(at) && at >= 0 ? at : null
  }
  if (at === 'end') {
    return Number.isFinite(duration) && duration >= 0 ? duration : null
  }
  const value = duration - at.endMinus
  return Number.isFinite(value) && value >= 0 ? value : null
}

/** 预设差异（09-08 §4.1：新增 / 修改 / 删除 / 关键帧四类）。 */
export interface PresetDiff {
  added: Array<{ path: string; value: JsonValue }>
  modified: Array<{ path: string; before: JsonValue | undefined; after: JsonValue }>
  removed: Array<{ path: string; before: JsonValue | undefined }>
  keyframes: Array<{ path: string; action: 'add' | 'replace'; frames: ObjectKeyframe[]; beforeCount: number }>
  /** 层类型转换（如果发生）。 */
  layerSwitch: { from: OverlayLayerType; to: OverlayLayerType } | null
  /** 不阻塞的提示。 */
  notes: string[]
}

/** 应用计划的产出。 */
export interface PresetPlan {
  presetId: string
  commands: DocCommand[]
  diff: PresetDiff
  /** 阻止应用的问题（非空 = 不产生 commands）。 */
  blockers: string[]
  /** 目标层类型（OVERLAY）。 */
  targetLayerType: OverlayLayerType | null
  keyframeTimes: Array<{ path: string; frames: ObjectKeyframe[] }>
}

/** 读一个 AnimObject 的显式值 / 帧数。 */
function objectState(objects: JsonObject, path: string): { present: boolean; value: JsonValue | undefined; frames: ObjectKeyframe[] } {
  const raw = objects[path]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { present: false, value: undefined, frames: [] }
  }
  const record = raw as Record<string, unknown>
  return {
    present: true,
    value: record.value as JsonValue | undefined,
    frames: Array.isArray(record.keyframes) ? record.keyframes as ObjectKeyframe[] : [],
  }
}

/** 深比较（JSON 语义；用于 diff）。 */
function sameValue(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (left === right) {
    return true
  }
  if (left === undefined || right === undefined) {
    return false
  }
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

/**
 * 构造应用计划（应用到当前片段）。
 *
 * - 目标层类型不符 → 先产出层转换命令（只删不加 + 写 layer_type），两步合成一次 batch；
 * - 动画字段的静态写入若已有关键帧 → blocker（不让静态值静默失效）；
 * - 关键帧写入用 `object.setKeyframes` 替换同路径帧；
 * - 保留未知键与未涉及字段。
 */
export function planPresetApplication(input: {
  preset: OverlayPreset
  clipKey: string
  objects: JsonObject
  duration: number
  catalog: CatalogIndex
}): PresetPlan {
  const { preset, clipKey, objects, duration, catalog } = input
  const blockers: string[] = []
  const notes: string[] = []
  const commands: DocCommand[] = []
  const diff: PresetDiff = {
    added: [],
    modified: [],
    removed: [],
    keyframes: [],
    layerSwitch: null,
    notes,
  }
  const keyframeTimes: Array<{ path: string; frames: ObjectKeyframe[] }> = []

  const registrationIssues = validatePreset(preset, catalog)
  if (registrationIssues.length > 0) {
    blockers.push(...registrationIssues.map((issue) => issue.message))
    return { presetId: preset.id, commands, diff, blockers, targetLayerType: null, keyframeTimes }
  }

  // 层类型转换（OVERLAY）。
  let nextObjects = objects
  if (preset.trackType === 'OVERLAY' && preset.targetLayerType !== undefined) {
    const currentType = effectiveLayerType(objects)
    if (currentType !== preset.targetLayerType) {
      const plan = planLayerSwitch(objects, preset.targetLayerType)
      commands.push({ kind: 'object.setValue', clipKey, path: 'layer_type', value: preset.targetLayerType })
      for (const path of plan.remove) {
        commands.push({ kind: 'object.remove', clipKey, path })
        diff.removed.push({ path, before: objectState(objects, path).value })
      }
      if (plan.writeLayerType) {
        const before = objectState(objects, 'layer_type').value
        diff.modified.push({ path: 'layer_type', before, after: preset.targetLayerType })
      }
      diff.layerSwitch = { from: currentType, to: preset.targetLayerType }
      // 后续写入按目标层类型判断，不需要真实对象预览；patch 用克隆后的对象。
      nextObjects = { ...objects }
      nextObjects.layer_type = { value: preset.targetLayerType } as unknown as JsonObject
      for (const path of plan.remove) {
        delete nextObjects[path]
      }
    }
  }

  // 静态字段。
  for (const field of preset.fields) {
    const before = objectState(nextObjects, field.path)
    if (preset.trackType === 'OVERLAY' && preset.targetLayerType !== undefined) {
      const def = catalog.objectDef('OVERLAY', field.path)
      if (def?.appliesTo !== undefined && def.appliesTo.length > 0 && !def.appliesTo.includes(preset.targetLayerType)) {
        blockers.push(`字段 ${field.path} 不适用于 layer_type=${preset.targetLayerType}`)
        continue
      }
    }
    if (before.frames.length > 0) {
      blockers.push(
        `字段 ${field.path} 已有关键帧：预设的静态值不会生效；请先在效果面板关闭该属性的动画，或改用带关键帧的预设`,
      )
      continue
    }
    const value = isJsonObject(before.value) && isJsonObject(field.value)
      ? { ...before.value, ...field.value }
      : field.value
    commands.push({ kind: 'object.setValue', clipKey, path: field.path, value })
    if (!before.present) {
      diff.added.push({ path: field.path, value })
    } else if (!sameValue(before.value, value)) {
      diff.modified.push({ path: field.path, before: before.value, after: value })
    }
    nextObjects[field.path] = { value } as unknown as JsonObject
  }

  // 关键帧字段。
  for (const group of preset.keyframes ?? []) {
    if (preset.trackType === 'OVERLAY' && preset.targetLayerType !== undefined) {
      const def = catalog.objectDef('OVERLAY', group.path)
      if (def?.appliesTo !== undefined && def.appliesTo.length > 0 && !def.appliesTo.includes(preset.targetLayerType)) {
        blockers.push(`关键帧字段 ${group.path} 不适用于 layer_type=${preset.targetLayerType}`)
        continue
      }
    }
    const frames: ObjectKeyframe[] = []
    for (const frame of group.frames) {
      const time = resolveFrameTime(frame.at, duration)
      if (time === null) {
        blockers.push(`关键帧时间无法解析: ${group.path} at=${JSON.stringify(frame.at)}（片段时长 ${duration}s）`)
        break
      }
      frames.push({ time, value: frame.value })
    }
    if (frames.length !== group.frames.length) {
      continue
    }
    for (let index = 1; index < frames.length; index += 1) {
      if (frames[index].time <= frames[index - 1].time) {
        blockers.push(`关键帧时间必须严格递增: ${group.path}`)
        break
      }
    }
    if (blockers.length > 0) {
      continue
    }
    const before = objectState(nextObjects, group.path)
    commands.push({ kind: 'object.setKeyframes', clipKey, path: group.path, keyframes: frames })
    diff.keyframes.push({
      path: group.path,
      action: before.frames.length === 0 ? 'add' : 'replace',
      frames,
      beforeCount: before.frames.length,
    })
    keyframeTimes.push({ path: group.path, frames })
    nextObjects[group.path] = { ...(nextObjects[group.path] as JsonObject | undefined), keyframes: frames } as unknown as JsonObject
  }

  // 预设显式删除。
  for (const path of preset.remove ?? []) {
    const before = objectState(objects, path)
    if (!before.present) {
      continue
    }
    commands.push({ kind: 'object.remove', clipKey, path })
    diff.removed.push({ path, before: before.value })
    delete nextObjects[path]
  }

  if (commands.length === 0 && blockers.length === 0) {
    notes.push('预设与当前片段完全一致：没有需要写入的字段')
  }
  return {
    presetId: preset.id,
    commands,
    diff,
    blockers,
    targetLayerType: preset.targetLayerType ?? null,
    keyframeTimes,
  }
}

/** 新建片段的预设计划（`clip.add`）。 */
export function planPresetCreation(input: {
  preset: OverlayPreset
  trackIndex: number
  startTime: number
  duration: number
  catalog: CatalogIndex
  /** 新建片段的 `id` 由命令层分配时省略。 */
  clipId?: string
}): PresetPlan & { clip: JsonObject } {
  const { preset, startTime, duration, catalog } = input
  const blockers: string[] = []
  const issues = validatePreset(preset, catalog)
  if (issues.length > 0) {
    blockers.push(...issues.map((issue) => issue.message))
  }
  if (preset.mode === 'apply') {
    blockers.push(`预设 ${preset.id} 只能应用到当前片段，不能新建`)
  }
  if (!Number.isFinite(startTime) || startTime < 0) {
    blockers.push(`新建片段起始时间非法: ${startTime}`)
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    blockers.push(`新建片段时长非法: ${duration}`)
  }
  const objects: JsonObject = {}
  const diff: PresetDiff = { added: [], modified: [], removed: [], keyframes: [], layerSwitch: null, notes: [] }
  const keyframeTimes: Array<{ path: string; frames: ObjectKeyframe[] }> = []
  if (blockers.length > 0) {
    return {
      presetId: preset.id,
      commands: [],
      diff,
      blockers,
      targetLayerType: preset.targetLayerType ?? null,
      keyframeTimes,
      clip: {},
    }
  }
  for (const field of preset.fields) {
    objects[field.path] = { value: field.value } as unknown as JsonObject
    diff.added.push({ path: field.path, value: field.value })
  }
  for (const group of preset.keyframes ?? []) {
    const frames: ObjectKeyframe[] = []
    for (const frame of group.frames) {
      const time = resolveFrameTime(frame.at, duration)
      if (time === null) {
        blockers.push(`关键帧时间无法解析: ${group.path}`)
        break
      }
      frames.push({ time, value: frame.value })
    }
    if (blockers.length > 0) {
      break
    }
    objects[group.path] = { keyframes: frames } as unknown as JsonObject
    diff.keyframes.push({ path: group.path, action: 'add', frames, beforeCount: 0 })
    keyframeTimes.push({ path: group.path, frames })
  }
  const clip: JsonObject = {
    ...(input.clipId === undefined ? {} : { id: input.clipId }),
    start_time: startTime,
    duration,
    objects,
  }
  const commands: DocCommand[] = blockers.length === 0
    ? [{ kind: 'clip.add', trackIndex: input.trackIndex, clip }]
    : []
  return {
    presetId: preset.id,
    commands,
    diff,
    blockers,
    targetLayerType: preset.targetLayerType ?? null,
    keyframeTimes,
    clip,
  }
}

/** 字段写入辅助。 */
const field = (path: string, value: JsonValue): { path: string; value: JsonValue } => ({ path, value })

/** 颜色层预设（09-08 §三）。 */
const FADE_PRESETS: OverlayPreset[] = [
  {
    id: 'fade.in',
    name: '淡入',
    group: 'fade',
    trackType: 'OVERLAY',
    targetLayerType: 'fade',
    mode: 'both',
    description: '黑色整窗遮罩，不透明度 0 → 1（1 秒）',
    fields: [
      field('layer_type', 'fade'),
      field('color', '#000000'),
      field('mask_shape', 'full'),
      field('blend_mode', 'normal'),
    ],
    keyframes: [{ path: 'opacity', frames: [{ at: 0, value: 0 }, { at: 1, value: 1 }] }],
  },
  {
    id: 'fade.out',
    name: '淡出',
    group: 'fade',
    trackType: 'OVERLAY',
    targetLayerType: 'fade',
    mode: 'both',
    description: '黑色整窗遮罩，不透明度 1 → 0（末尾 1 秒）',
    fields: [
      field('layer_type', 'fade'),
      field('color', '#000000'),
      field('mask_shape', 'full'),
      field('blend_mode', 'normal'),
    ],
    keyframes: [{ path: 'opacity', frames: [{ at: { endMinus: 1 }, value: 1 }, { at: 'end', value: 0 }] }],
  },
  {
    id: 'fade.flash',
    name: '闪白',
    group: 'fade',
    trackType: 'OVERLAY',
    targetLayerType: 'fade',
    mode: 'both',
    description: '白色整窗遮罩：0 → 1 → 0（0.15s / 0.4s）',
    fields: [
      field('layer_type', 'fade'),
      field('color', '#ffffff'),
      field('mask_shape', 'full'),
      field('blend_mode', 'normal'),
    ],
    keyframes: [{
      path: 'opacity',
      frames: [{ at: 0, value: 0 }, { at: 0.15, value: 1 }, { at: 0.4, value: 0 }],
    }],
  },
  {
    id: 'fade.solid',
    name: '纯色罩',
    group: 'fade',
    trackType: 'OVERLAY',
    targetLayerType: 'fade',
    mode: 'both',
    description: '整窗纯色，不透明度 1（静态）',
    fields: [
      field('layer_type', 'fade'),
      field('color', '#000000'),
      field('mask_shape', 'full'),
      field('blend_mode', 'normal'),
      field('opacity', 1),
    ],
  },
  {
    id: 'fade.gradient.linear',
    name: '线性渐变罩',
    group: 'fade',
    trackType: 'OVERLAY',
    targetLayerType: 'fade',
    mode: 'both',
    description: '黑 → 白线性渐变（只写 angle / center，不写 radius）',
    fields: [
      field('layer_type', 'fade'),
      field('mask_shape', 'full'),
      field('blend_mode', 'normal'),
      field('opacity', 1),
      field('gradient', { type: 'linear', stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }] }),
      field('gradient_angle', 90),
      field('gradient_center_x', 0.5),
      field('gradient_center_y', 0.5),
    ],
    remove: ['gradient_radius'],
  },
  {
    id: 'fade.gradient.radial',
    name: '径向渐变罩',
    group: 'fade',
    trackType: 'OVERLAY',
    targetLayerType: 'fade',
    mode: 'both',
    description: '黑 → 白径向渐变（只写 center / radius，不写 angle）',
    fields: [
      field('layer_type', 'fade'),
      field('mask_shape', 'full'),
      field('blend_mode', 'normal'),
      field('opacity', 1),
      field('gradient', { type: 'radial', stops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#000000' }] }),
      field('gradient_center_x', 0.5),
      field('gradient_center_y', 0.5),
      field('gradient_radius', 0.5),
    ],
    remove: ['gradient_angle'],
  },
  {
    id: 'fade.block.rect',
    name: '矩形色块',
    group: 'fade',
    trackType: 'OVERLAY',
    targetLayerType: 'fade',
    mode: 'both',
    description: '居中 60%×30% 矩形色块（只写宽高，不写半径）',
    fields: [
      field('layer_type', 'fade'),
      field('color', '#000000'),
      field('mask_shape', 'rect'),
      field('blend_mode', 'normal'),
      field('opacity', 1),
      field('mask_x', 0.5),
      field('mask_y', 0.5),
      field('mask_width', 0.6),
      field('mask_height', 0.3),
    ],
    remove: ['mask_radius'],
  },
  {
    id: 'fade.block.circle',
    name: '圆形色块',
    group: 'fade',
    trackType: 'OVERLAY',
    targetLayerType: 'fade',
    mode: 'both',
    description: '居中半径 25% 圆形色块（只写半径，不写宽高）',
    fields: [
      field('layer_type', 'fade'),
      field('color', '#000000'),
      field('mask_shape', 'circle'),
      field('blend_mode', 'normal'),
      field('opacity', 1),
      field('mask_x', 0.5),
      field('mask_y', 0.5),
      field('mask_radius', 0.25),
    ],
    remove: ['mask_width', 'mask_height'],
  },
]

/** 图片 / 视频预设（只写几何与取材，不写 path）。 */
const IMAGE_PRESETS: OverlayPreset[] = [
  {
    id: 'image.center',
    name: '居中',
    group: 'image',
    trackType: 'OVERLAY',
    targetLayerType: 'image',
    mode: 'both',
    description: '位置 50%/50%，锚点中心，缩放 1',
    fields: [
      field('layer_type', 'image'),
      field('x', 0.5), field('y', 0.5),
      field('anchor_x', 0.5), field('anchor_y', 0.5),
      field('scale_x', 1), field('scale_y', 1),
      field('opacity', 1),
    ],
  },
  {
    id: 'image.bottom',
    name: '下方居中',
    group: 'image',
    trackType: 'OVERLAY',
    targetLayerType: 'image',
    mode: 'both',
    description: '位置 50%/82%，锚点中心',
    fields: [
      field('layer_type', 'image'),
      field('x', 0.5), field('y', 0.82),
      field('anchor_x', 0.5), field('anchor_y', 0.5),
      field('scale_x', 0.6), field('scale_y', 0.6),
      field('opacity', 1),
    ],
  },
  {
    id: 'image.top-left',
    name: '左上角',
    group: 'image',
    trackType: 'OVERLAY',
    targetLayerType: 'image',
    mode: 'both',
    description: '位置 22%/22%，锚点中心，缩放 0.5',
    fields: [
      field('layer_type', 'image'),
      field('x', 0.22), field('y', 0.22),
      field('anchor_x', 0.5), field('anchor_y', 0.5),
      field('scale_x', 0.5), field('scale_y', 0.5),
      field('opacity', 1),
    ],
  },
  {
    id: 'image.crop.center',
    name: '中央裁切',
    group: 'image',
    trackType: 'OVERLAY',
    targetLayerType: 'image',
    mode: 'both',
    description: '取材 25%~75% 的中央区域',
    fields: [
      field('layer_type', 'image'),
      field('x', 0.5), field('y', 0.5),
      field('anchor_x', 0.5), field('anchor_y', 0.5),
      field('scale_x', 1), field('scale_y', 1),
      field('source.x', 0.25), field('source.y', 0.25),
      field('source.w', 0.5), field('source.h', 0.5),
      field('opacity', 1),
    ],
  },
  {
    id: 'image.crop.top',
    name: '上半裁切',
    group: 'image',
    trackType: 'OVERLAY',
    targetLayerType: 'image',
    mode: 'both',
    description: '取材上半（0~50% 高）',
    fields: [
      field('layer_type', 'image'),
      field('x', 0.5), field('y', 0.5),
      field('anchor_x', 0.5), field('anchor_y', 0.5),
      field('scale_x', 1), field('scale_y', 1),
      field('source.x', 0), field('source.y', 0),
      field('source.w', 1), field('source.h', 0.5),
      field('opacity', 1),
    ],
  },
  {
    id: 'image.half',
    name: '半尺寸',
    group: 'image',
    trackType: 'OVERLAY',
    targetLayerType: 'image',
    mode: 'both',
    description: '居中，缩放 0.5',
    fields: [
      field('layer_type', 'image'),
      field('x', 0.5), field('y', 0.5),
      field('anchor_x', 0.5), field('anchor_y', 0.5),
      field('scale_x', 0.5), field('scale_y', 0.5),
      field('opacity', 1),
    ],
  },
  {
    id: 'image.pip',
    name: '画中画起始',
    group: 'image',
    trackType: 'OVERLAY',
    targetLayerType: 'image',
    mode: 'both',
    description: '左上角 30% 尺寸，锚点中心',
    fields: [
      field('layer_type', 'image'),
      field('x', 0.28), field('y', 0.28),
      field('anchor_x', 0.5), field('anchor_y', 0.5),
      field('scale_x', 0.3), field('scale_y', 0.3),
      field('opacity', 1),
    ],
  },
]

/** 字幕预设（只写位置 / 锚点 / 字号 / 缩放）。 */
const SUBTITLE_PRESETS: OverlayPreset[] = [
  {
    id: 'subtitle.bottom',
    name: '下方字幕',
    group: 'subtitle',
    trackType: 'OVERLAY',
    targetLayerType: 'subtitle',
    mode: 'both',
    description: '底部居中，字号 1，缩放 1',
    fields: [
      field('layer_type', 'subtitle'),
      field('x', 0.5), field('y', 0.88),
      field('anchor_x', 0.5), field('anchor_y', 0.5),
      field('font_scale', 1),
      field('scale_x', 1), field('scale_y', 1),
      field('opacity', 1),
    ],
  },
  {
    id: 'subtitle.title',
    name: '居中标题',
    group: 'subtitle',
    trackType: 'OVERLAY',
    targetLayerType: 'subtitle',
    mode: 'both',
    description: '画面中间，字号 1.8',
    fields: [
      field('layer_type', 'subtitle'),
      field('x', 0.5), field('y', 0.45),
      field('anchor_x', 0.5), field('anchor_y', 0.5),
      field('font_scale', 1.8),
      field('scale_x', 1), field('scale_y', 1),
      field('opacity', 1),
    ],
  },
  {
    id: 'subtitle.top',
    name: '上方注释',
    group: 'subtitle',
    trackType: 'OVERLAY',
    targetLayerType: 'subtitle',
    mode: 'both',
    description: '顶部居中，字号 0.9',
    fields: [
      field('layer_type', 'subtitle'),
      field('x', 0.5), field('y', 0.12),
      field('anchor_x', 0.5), field('anchor_y', 0.5),
      field('font_scale', 0.9),
      field('scale_x', 1), field('scale_y', 1),
      field('opacity', 1),
    ],
  },
  {
    id: 'subtitle.two-lines',
    name: '两行字幕',
    group: 'subtitle',
    trackType: 'OVERLAY',
    targetLayerType: 'subtitle',
    mode: 'both',
    description: '底部居中，占位文本「第一行\\n第二行」（不自动折行）',
    fields: [
      field('layer_type', 'subtitle'),
      field('x', 0.5), field('y', 0.85),
      field('anchor_x', 0.5), field('anchor_y', 0.5),
      field('font_scale', 1),
      field('scale_x', 1), field('scale_y', 1),
      field('opacity', 1),
      field('text', '第一行\n第二行'),
    ],
  },
]

/** 画幅预设。 */
const LETTERBOX_PRESETS: OverlayPreset[] = [
  {
    id: 'letterbox.2.35',
    name: '2.35:1 宽银幕',
    group: 'letterbox',
    trackType: 'LETTERBOX',
    mode: 'both',
    description: '上下黑边，不透明度 1',
    fields: [field('aspect_ratio', 2.35), field('opacity', 1)],
  },
  {
    id: 'letterbox.1.85',
    name: '1.85:1 宽银幕',
    group: 'letterbox',
    trackType: 'LETTERBOX',
    mode: 'both',
    description: '上下黑边，不透明度 1',
    fields: [field('aspect_ratio', 1.85), field('opacity', 1)],
  },
  {
    id: 'letterbox.16.9',
    name: '16:9',
    group: 'letterbox',
    trackType: 'LETTERBOX',
    mode: 'both',
    description: '与 16:9 屏幕同比例：无黑边（仍写字段，便于后续改比例）',
    fields: [field('aspect_ratio', 16 / 9), field('opacity', 1)],
  },
  {
    id: 'letterbox.1.0',
    name: '1:1 方画幅',
    group: 'letterbox',
    trackType: 'LETTERBOX',
    mode: 'both',
    description: '竖屏出左右黑边（pillarbox）',
    fields: [field('aspect_ratio', 1), field('opacity', 1)],
  },
  {
    id: 'letterbox.fade-in',
    name: '黑边淡入',
    group: 'letterbox',
    trackType: 'LETTERBOX',
    mode: 'both',
    description: '2.35:1 黑边，不透明度 0 → 1（0.5 秒）',
    fields: [field('aspect_ratio', 2.35)],
    keyframes: [{ path: 'opacity', frames: [{ at: 0, value: 0 }, { at: 0.5, value: 1 }] }],
  },
]

/** 层级预设（只改 z_index）。 */
const LAYER_PRESETS: OverlayPreset[] = [
  {
    id: 'layer.below-letterbox',
    name: '置于画幅之下',
    group: 'layer',
    trackType: 'OVERLAY',
    anyLayerType: true,
    mode: 'apply',
    description: 'z_index = -1（会被 z=0 的画幅黑边盖住）',
    fields: [field('z_index', -1)],
  },
  {
    id: 'layer.same-as-letterbox',
    name: '画幅同层',
    group: 'layer',
    trackType: 'OVERLAY',
    anyLayerType: true,
    mode: 'apply',
    description: 'z_index = 0（与画幅层同层，通常绘制在黑边之上）',
    fields: [field('z_index', 0)],
  },
  {
    id: 'layer.above-letterbox',
    name: '画幅之上',
    group: 'layer',
    trackType: 'OVERLAY',
    anyLayerType: true,
    mode: 'apply',
    description: 'z_index = 1（在黑边之上）',
    fields: [field('z_index', 1)],
  },
  {
    id: 'layer.default',
    name: '默认层级',
    group: 'layer',
    trackType: 'OVERLAY',
    anyLayerType: true,
    mode: 'apply',
    description: 'z_index = 10（脚本缺省）',
    fields: [field('z_index', 10)],
  },
  {
    id: 'layer.top',
    name: '顶层',
    group: 'layer',
    trackType: 'OVERLAY',
    anyLayerType: true,
    mode: 'apply',
    description: 'z_index = 100（覆盖其他覆盖层）',
    fields: [field('z_index', 100)],
  },
]

/** 全部预设。 */
export const OVERLAY_PRESETS: readonly OverlayPreset[] = [
  ...FADE_PRESETS,
  ...IMAGE_PRESETS,
  ...SUBTITLE_PRESETS,
  ...LETTERBOX_PRESETS,
  ...LAYER_PRESETS,
]

/** 按分组取预设；`layerType` 用于 OVERLAY 的层类型分组。 */
export function presetsFor(group: PresetGroup, trackType: 'OVERLAY' | 'LETTERBOX', layerType?: OverlayLayerType): OverlayPreset[] {
  return OVERLAY_PRESETS.filter((preset) => {
    if (preset.group !== group || preset.trackType !== trackType) {
      return false
    }
    if (trackType === 'OVERLAY' && preset.group === 'layer') {
      return true
    }
    if (preset.anyLayerType === true) {
      return true
    }
    return layerType === undefined || preset.targetLayerType === layerType
  })
}

/** 注册全部预设（启动时跑一次；返回问题清单）。 */
export function validateAllPresets(catalog: CatalogIndex): PresetIssue[] {
  const issues: PresetIssue[] = []
  for (const preset of OVERLAY_PRESETS) {
    issues.push(...validatePreset(preset, catalog))
  }
  return issues
}
