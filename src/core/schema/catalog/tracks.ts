/**
 * 七轨字段：`TrackSchemas.all()` 的注册顺序、共用 playControl 与各轨 objects。
 *
 * 来源全部是 `script/schema/TrackSchemas.java`：
 * - `TRACK_ORDER` 抄 `all()` 的 `map.put` 顺序（`:27-33`）；
 * - `PLAY_CONTROL_FIELDS` 抄 `playControl()`（`:86-93`），七轨共用同一份声明；
 * - `TRACK_OBJECTS` 抄各 `xxxObjects()`，顺序即 Java 侧 `add(...)` 调用顺序。
 *
 * `ObjectDef` 的构造期归一化逐条体现：`interp` 未声明时归一为 `none`、空白 `requires`
 * 归一为 `null`（目录省略该键）、`type=nullable_float` 隐含 `nullable=true`。
 * 循环生成的条目（调色通道 / 调色曲线 / 运动模型 / 选择器调用点）的 `sourceRef` 指向循环语句行号。
 *
 * playControl 的 `id` 用 `track.playControl.<key>`、不带轨道名：这 5 条声明被 7 轨共用同一个对象
 * （`TrackSchemas.PLAY_CONTROL` 是单一静态实例），带轨道名就无法共享同一份声明；轨道归属由
 * `TrackCatalog.playControl` 与索引键 `type:key` 表达。
 */
import type { FieldEntry, FieldInterp, FieldMode, ObjectType } from '../types.ts'

export const TRACK_ORDER: readonly string[] = [
  'CAMERA',
  'LETTERBOX',
  'AUDIO',
  'EVENT',
  'MOD_EVENT',
  'OVERLAY',
  'ADJUST',
]

export const PLAY_CONTROL_FIELDS: FieldEntry[] = [
  {
    id: 'track.playControl.start_time',
    segment: 'tracks',
    scope: [],
    key: 'start_time',
    type: 'float',
    default: null,
    hasDefault: false,
    required: true,
    section: 'playback',
    sourceRef: 'TrackSchemas#playControl:88',
  },
  {
    id: 'track.playControl.duration',
    segment: 'tracks',
    scope: [],
    key: 'duration',
    type: 'float',
    default: null,
    hasDefault: false,
    required: true,
    section: 'playback',
    sourceRef: 'TrackSchemas#playControl:89',
  },
  {
    id: 'track.playControl.loop',
    segment: 'tracks',
    scope: [],
    key: 'loop',
    type: 'bool',
    default: false,
    hasDefault: true,
    required: false,
    section: 'playback',
    sourceRef: 'TrackSchemas#playControl:90',
  },
  {
    id: 'track.playControl.loop_count',
    segment: 'tracks',
    scope: [],
    key: 'loop_count',
    type: 'int',
    default: -1,
    hasDefault: true,
    required: false,
    section: 'playback',
    sourceRef: 'TrackSchemas#playControl:91',
  },
  {
    id: 'track.playControl.loop_mode',
    segment: 'tracks',
    scope: [],
    key: 'loop_mode',
    type: 'enum',
    default: 'repeat',
    hasDefault: true,
    required: false,
    enumValues: ['repeat', 'pingpong'],
    section: 'playback',
    sourceRef: 'TrackSchemas#playControl:92',
  },
]

/** `ObjectDef.Builder` 的非必需声明项；未给出的键不进 `FieldEntry`。 */
interface ObjectOptions {
  required?: boolean
  enumValues?: string[]
  min?: number
  max?: number
  requires?: string
  appliesTo?: string[]
  section?: string
  group?: string
  unit?: string
}

/** 按 `ObjectDef` 的构造期归一化生成一条轨道对象；`default` 为 `null` 即无缺省。 */
function objectEntry(
  track: string,
  path: string,
  mode: FieldMode,
  type: ObjectType,
  interp: FieldInterp,
  def: unknown,
  options: ObjectOptions,
  sourceRef: string,
): FieldEntry {
  const result: FieldEntry = {
    id: `track.${track}.object.${path}`,
    segment: 'tracks',
    scope: [track],
    key: path,
    type,
    mode,
    interp,
    default: def,
    hasDefault: def !== null,
    required: options.required === true,
    sourceRef,
  }
  if (options.enumValues !== undefined && options.enumValues.length > 0) {
    result.enumValues = options.enumValues
  }
  if (type === 'nullable_float') {
    result.nullable = true
  }
  if (options.min !== undefined) {
    result.min = options.min
  }
  if (options.max !== undefined) {
    result.max = options.max
  }
  if (options.requires !== undefined) {
    result.requires = options.requires
  }
  if (options.appliesTo !== undefined && options.appliesTo.length > 0) {
    result.appliesTo = options.appliesTo
  }
  if (options.section !== undefined) {
    result.section = options.section
  }
  if (options.group !== undefined) {
    result.group = options.group
  }
  if (options.unit !== undefined) {
    result.unit = options.unit
  }
  return result
}

/** `TrackSchemas.animated(path, type, interp, def)`：mode=animated，interp 显式给出。 */
function animated(
  track: string,
  path: string,
  type: ObjectType,
  interp: FieldInterp,
  def: unknown,
  options: ObjectOptions,
  sourceRef: string,
): FieldEntry {
  return objectEntry(track, path, 'animated', type, interp, def, options, sourceRef)
}

/** `TrackSchemas.value(path, type, def)`：mode=value，构造期 interp 归一为 none。 */
function valueOnly(
  track: string,
  path: string,
  type: ObjectType,
  def: unknown,
  options: ObjectOptions,
  sourceRef: string,
): FieldEntry {
  return objectEntry(track, path, 'value', type, 'none', def, options, sourceRef)
}

/** `ObjectDef.builder(path, event, event_record)`：无缺省、interp 归一为 none。 */
function eventRecord(track: string, path: string, section: string, sourceRef: string): FieldEntry {
  return objectEntry(track, path, 'event', 'event_record', 'none', null, { section }, sourceRef)
}

/** `TrackSchemas.CAMERA_COLOR_CHANNELS`（`:478`）：57 = 47 标量 + 10 曲线强度，顺序即旧 kfs 登记顺序。 */
const CAMERA_COLOR_CHANNELS: readonly string[] = [
  'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks',
  'hue', 'saturation', 'vibrance', 'lightness',
  'temperature', 'tint',
  'red', 'green', 'blue',
  'mix_rr', 'mix_rg', 'mix_rb', 'mix_gr', 'mix_gg', 'mix_gb', 'mix_br', 'mix_bg', 'mix_bb',
  'curve_strength', 'r_curve_strength', 'g_curve_strength', 'b_curve_strength',
  'lift_r', 'lift_g', 'lift_b', 'gamma_r', 'gamma_g', 'gamma_b', 'gain_r', 'gain_g', 'gain_b',
  'hv_h_strength', 'hv_s_strength', 'hv_l_strength', 'lv_s_strength', 'sv_s_strength', 'sv_l_strength',
  'hue_red', 'sat_red', 'hue_yellow', 'sat_yellow', 'hue_green', 'sat_green',
  'hue_cyan', 'sat_cyan', 'hue_blue', 'sat_blue', 'hue_magenta', 'sat_magenta',
  'grayscale', 'invert',
]

/** `TrackSchemas.ADJUST_CHANNELS`（`:492`）：59 = CAMERA 57 + `lut_strength` + `blend_amount`。 */
const ADJUST_CHANNELS: readonly string[] = [
  'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks',
  'hue', 'saturation', 'vibrance', 'lightness',
  'temperature', 'tint',
  'red', 'green', 'blue',
  'mix_rr', 'mix_rg', 'mix_rb', 'mix_gr', 'mix_gg', 'mix_gb', 'mix_br', 'mix_bg', 'mix_bb',
  'curve_strength', 'r_curve_strength', 'g_curve_strength', 'b_curve_strength',
  'lift_r', 'lift_g', 'lift_b', 'gamma_r', 'gamma_g', 'gamma_b', 'gain_r', 'gain_g', 'gain_b',
  'lut_strength',
  'hv_h_strength', 'hv_s_strength', 'hv_l_strength', 'lv_s_strength', 'sv_s_strength', 'sv_l_strength',
  'hue_red', 'sat_red', 'hue_yellow', 'sat_yellow', 'hue_green', 'sat_green',
  'hue_cyan', 'sat_cyan', 'hue_blue', 'sat_blue', 'hue_magenta', 'sat_magenta',
  'grayscale', 'invert', 'blend_amount',
]

/** `TrackSchemas.DEFAULT_ONE_CHANNELS`（`:507`）：缺省 1 的强度类通道。 */
const DEFAULT_ONE_CHANNELS: readonly string[] = [
  'curve_strength', 'r_curve_strength', 'g_curve_strength', 'b_curve_strength',
  'hv_h_strength', 'hv_s_strength', 'hv_l_strength', 'lv_s_strength', 'sv_s_strength', 'sv_l_strength',
  'lut_strength', 'blend_amount',
]

/** `TrackSchemas.ZERO_ONE_CHANNELS`（`:513`）：取值范围 [0,1] 的通道。 */
const ZERO_ONE_CHANNELS: readonly string[] = [
  'curve_strength', 'r_curve_strength', 'g_curve_strength', 'b_curve_strength',
  'hv_h_strength', 'hv_s_strength', 'hv_l_strength', 'lv_s_strength', 'sv_s_strength', 'sv_l_strength',
  'lut_strength', 'blend_amount', 'grayscale', 'invert',
]

/** `TrackSchemas.channelDefault`（`:518`）：强度类缺省 1，其余 0。 */
function channelDefault(channel: string): number {
  return DEFAULT_ONE_CHANNELS.includes(channel) ? 1 : 0
}

/** `TrackSchemas.channelMin`（`:522`）：`exposure` 下界 -5，`[0,1]` 通道下界 0，其余 -1。 */
function channelMin(channel: string): number {
  if (channel === 'exposure') {
    return -5
  }
  return ZERO_ONE_CHANNELS.includes(channel) ? 0 : -1
}

/** `TrackSchemas.channelMax`（`:529`）：`exposure` 上界 5，其余 1。 */
function channelMax(channel: string): number {
  return channel === 'exposure' ? 5 : 1
}

/** `ObjectCallpoints.NEW_CALLPOINTS`（`script/object/ObjectCallpoints.java:20-22`）。 */
const NEW_CALLPOINTS: readonly string[] = [
  'position_origin',
  'look_at',
  'yaw_base',
  'yaw_base_from',
  'yaw_base_to',
  'facing_target',
  'facing_entity',
]

/** 调色曲线名（相机与 ADJUST 各 10 条，顺序 = 旧 clip 级声明顺序）。 */
const COLOR_CURVES: readonly string[] = [
  'rgb_curve', 'r_curve', 'g_curve', 'b_curve',
  'hv_h_curve', 'hv_s_curve', 'hv_l_curve', 'lv_s_curve', 'sv_s_curve', 'sv_l_curve',
]

/** `TrackSchemas.cameraObjects()`（`:109`）。 */
function cameraObjects(): FieldEntry[] {
  const objects: FieldEntry[] = []

  // 位置：点源 + 偏移。组级 step 参数与 position.x/y/z 平级；group 供切换对齐校验。
  objects.push(
    animated('CAMERA', 'position.x', 'float', 'linear', 0, { section: 'position', group: 'position' }, 'TrackSchemas#cameraObjects:113'),
    animated('CAMERA', 'position.y', 'float', 'linear', 0, { section: 'position', group: 'position' }, 'TrackSchemas#cameraObjects:115'),
    animated('CAMERA', 'position.z', 'float', 'linear', 0, { section: 'position', group: 'position' }, 'TrackSchemas#cameraObjects:117'),
    animated('CAMERA', 'position_mode', 'enum', 'step', 'relative', {
      enumValues: ['relative', 'absolute'],
      section: 'position',
      group: 'position',
    }, 'TrackSchemas#cameraObjects:119'),
    animated('CAMERA', 'position_space', 'enum', 'step', 'world', {
      enumValues: ['world', 'base'],
      section: 'position',
      group: 'position',
    }, 'TrackSchemas#cameraObjects:121'),
    animated('CAMERA', 'position_origin', 'ref', 'step', '', { section: 'position', group: 'position' }, 'TrackSchemas#cameraObjects:123'),
    animated('CAMERA', 'position_origin_x', 'float', 'linear', null, { section: 'position', group: 'position' }, 'TrackSchemas#cameraObjects:125'),
    animated('CAMERA', 'position_origin_y', 'float', 'linear', null, { section: 'position', group: 'position' }, 'TrackSchemas#cameraObjects:127'),
    animated('CAMERA', 'position_origin_z', 'float', 'linear', null, { section: 'position', group: 'position' }, 'TrackSchemas#cameraObjects:129'),
    animated('CAMERA', 'position_origin_freeze', 'bool', 'step', false, { section: 'position', group: 'position' }, 'TrackSchemas#cameraObjects:131'),
  )

  // 方向源（position_space=base 的基准系）
  objects.push(
    animated('CAMERA', 'facing_source', 'enum', 'step', 'auto', {
      enumValues: ['auto', 'world', 'entity', 'line'],
      section: 'position',
      group: 'position',
    }, 'TrackSchemas#cameraObjects:135'),
    animated('CAMERA', 'facing_target', 'ref', 'step', '', { section: 'position', group: 'position' }, 'TrackSchemas#cameraObjects:137'),
    animated('CAMERA', 'facing_target_x', 'float', 'linear', null, { section: 'position', group: 'position' }, 'TrackSchemas#cameraObjects:139'),
    animated('CAMERA', 'facing_target_y', 'float', 'linear', null, { section: 'position', group: 'position' }, 'TrackSchemas#cameraObjects:141'),
    animated('CAMERA', 'facing_target_z', 'float', 'linear', null, { section: 'position', group: 'position' }, 'TrackSchemas#cameraObjects:143'),
    animated('CAMERA', 'facing_target_offset.x', 'float', 'linear', 0, { section: 'position', group: 'position' }, 'TrackSchemas#cameraObjects:145'),
    animated('CAMERA', 'facing_target_offset.y', 'float', 'linear', 0, { section: 'position', group: 'position' }, 'TrackSchemas#cameraObjects:147'),
    animated('CAMERA', 'facing_target_offset.z', 'float', 'linear', 0, { section: 'position', group: 'position' }, 'TrackSchemas#cameraObjects:149'),
    animated('CAMERA', 'facing_target_offset.space', 'enum', 'step', 'world', {
      enumValues: ['world', 'base'],
      section: 'position',
      group: 'position',
    }, 'TrackSchemas#cameraObjects:151'),
    animated('CAMERA', 'facing_target_freeze', 'bool', 'step', false, { section: 'position', group: 'position' }, 'TrackSchemas#cameraObjects:153'),
    animated('CAMERA', 'facing_entity', 'ref', 'step', '', { section: 'position', group: 'position' }, 'TrackSchemas#cameraObjects:155'),
  )

  // 朝向：三轴角度（显式 angle）、方向锁、基准与 look_at
  objects.push(
    animated('CAMERA', 'yaw', 'float', 'angle', 0, { unit: 'degree', section: 'orientation', group: 'orientation' }, 'TrackSchemas#cameraObjects:159'),
    animated('CAMERA', 'pitch', 'float', 'angle', 0, { unit: 'degree', section: 'orientation', group: 'orientation' }, 'TrackSchemas#cameraObjects:161'),
    animated('CAMERA', 'roll', 'float', 'angle', 0, { unit: 'degree', section: 'orientation', group: 'orientation' }, 'TrackSchemas#cameraObjects:163'),
    animated('CAMERA', 'yaw_lock', 'nullable_float', 'angle', null, { unit: 'degree', section: 'orientation', group: 'orientation' }, 'TrackSchemas#cameraObjects:165'),
    animated('CAMERA', 'pitch_lock', 'nullable_float', 'angle', null, { unit: 'degree', section: 'orientation', group: 'orientation' }, 'TrackSchemas#cameraObjects:167'),
    animated('CAMERA', 'yaw_base', 'enum', 'step', 'world', {
      enumValues: ['world', 'entity', 'line'],
      section: 'orientation',
      group: 'orientation',
    }, 'TrackSchemas#cameraObjects:169'),
    animated('CAMERA', 'pitch_base', 'enum', 'step', 'world', {
      enumValues: ['world', 'entity', 'line'],
      section: 'orientation',
      group: 'orientation',
    }, 'TrackSchemas#cameraObjects:171'),
    animated('CAMERA', 'yaw_base_selector', 'ref', 'step', '@p', { section: 'orientation', group: 'orientation' }, 'TrackSchemas#cameraObjects:173'),
    animated('CAMERA', 'yaw_base_from', 'ref', 'step', '', { section: 'orientation', group: 'yaw_base_from' }, 'TrackSchemas#cameraObjects:175'),
    animated('CAMERA', 'yaw_base_from_x', 'float', 'linear', null, { section: 'orientation', group: 'yaw_base_from' }, 'TrackSchemas#cameraObjects:177'),
    animated('CAMERA', 'yaw_base_from_y', 'float', 'linear', null, { section: 'orientation', group: 'yaw_base_from' }, 'TrackSchemas#cameraObjects:179'),
    animated('CAMERA', 'yaw_base_from_z', 'float', 'linear', null, { section: 'orientation', group: 'yaw_base_from' }, 'TrackSchemas#cameraObjects:181'),
    animated('CAMERA', 'yaw_base_from_offset.x', 'float', 'linear', 0, { section: 'orientation', group: 'yaw_base_from' }, 'TrackSchemas#cameraObjects:183'),
    animated('CAMERA', 'yaw_base_from_offset.y', 'float', 'linear', 0, { section: 'orientation', group: 'yaw_base_from' }, 'TrackSchemas#cameraObjects:185'),
    animated('CAMERA', 'yaw_base_from_offset.z', 'float', 'linear', 0, { section: 'orientation', group: 'yaw_base_from' }, 'TrackSchemas#cameraObjects:187'),
    animated('CAMERA', 'yaw_base_from_offset.space', 'enum', 'step', 'world', {
      enumValues: ['world', 'base'],
      section: 'orientation',
      group: 'yaw_base_from',
    }, 'TrackSchemas#cameraObjects:189'),
    animated('CAMERA', 'yaw_base_from_freeze', 'bool', 'step', false, { section: 'orientation', group: 'yaw_base_from' }, 'TrackSchemas#cameraObjects:191'),
    animated('CAMERA', 'yaw_base_to', 'ref', 'step', '', { section: 'orientation', group: 'yaw_base_to' }, 'TrackSchemas#cameraObjects:193'),
    animated('CAMERA', 'yaw_base_to_x', 'float', 'linear', null, { section: 'orientation', group: 'yaw_base_to' }, 'TrackSchemas#cameraObjects:195'),
    animated('CAMERA', 'yaw_base_to_y', 'float', 'linear', null, { section: 'orientation', group: 'yaw_base_to' }, 'TrackSchemas#cameraObjects:197'),
    animated('CAMERA', 'yaw_base_to_z', 'float', 'linear', null, { section: 'orientation', group: 'yaw_base_to' }, 'TrackSchemas#cameraObjects:199'),
    animated('CAMERA', 'yaw_base_to_offset.x', 'float', 'linear', 0, { section: 'orientation', group: 'yaw_base_to' }, 'TrackSchemas#cameraObjects:201'),
    animated('CAMERA', 'yaw_base_to_offset.y', 'float', 'linear', 0, { section: 'orientation', group: 'yaw_base_to' }, 'TrackSchemas#cameraObjects:203'),
    animated('CAMERA', 'yaw_base_to_offset.z', 'float', 'linear', 0, { section: 'orientation', group: 'yaw_base_to' }, 'TrackSchemas#cameraObjects:205'),
    animated('CAMERA', 'yaw_base_to_offset.space', 'enum', 'step', 'world', {
      enumValues: ['world', 'base'],
      section: 'orientation',
      group: 'yaw_base_to',
    }, 'TrackSchemas#cameraObjects:207'),
    animated('CAMERA', 'yaw_base_to_freeze', 'bool', 'step', false, { section: 'orientation', group: 'yaw_base_to' }, 'TrackSchemas#cameraObjects:209'),
    animated('CAMERA', 'look_at', 'enum', 'step', 'none', {
      enumValues: ['none', 'player', 'coordinate', 'entity', 'block'],
      section: 'orientation',
      group: 'look_at',
    }, 'TrackSchemas#cameraObjects:211'),
    animated('CAMERA', 'look_at_selector', 'ref', 'step', '@p', { section: 'orientation', group: 'look_at' }, 'TrackSchemas#cameraObjects:214'),
    animated('CAMERA', 'look_at_part.x', 'float', 'linear', 50, { section: 'orientation', group: 'look_at' }, 'TrackSchemas#cameraObjects:216'),
    animated('CAMERA', 'look_at_part.y', 'float', 'linear', 50, { section: 'orientation', group: 'look_at' }, 'TrackSchemas#cameraObjects:218'),
    animated('CAMERA', 'look_at_part.z', 'float', 'linear', 50, { section: 'orientation', group: 'look_at' }, 'TrackSchemas#cameraObjects:220'),
    animated('CAMERA', 'look_at_target_x', 'float', 'linear', null, { section: 'orientation', group: 'look_at' }, 'TrackSchemas#cameraObjects:222'),
    animated('CAMERA', 'look_at_target_y', 'float', 'linear', null, { section: 'orientation', group: 'look_at' }, 'TrackSchemas#cameraObjects:224'),
    animated('CAMERA', 'look_at_target_z', 'float', 'linear', null, { section: 'orientation', group: 'look_at' }, 'TrackSchemas#cameraObjects:226'),
    animated('CAMERA', 'look_at_target_structure', 'string', 'step', '', { section: 'orientation', group: 'look_at' }, 'TrackSchemas#cameraObjects:228'),
    animated('CAMERA', 'look_at_target_block', 'string', 'step', '', { section: 'orientation', group: 'look_at' }, 'TrackSchemas#cameraObjects:230'),
    animated('CAMERA', 'look_at_offset.x', 'float', 'linear', 0, { section: 'orientation', group: 'look_at' }, 'TrackSchemas#cameraObjects:232'),
    animated('CAMERA', 'look_at_offset.y', 'float', 'linear', 0, { section: 'orientation', group: 'look_at' }, 'TrackSchemas#cameraObjects:234'),
    animated('CAMERA', 'look_at_offset.z', 'float', 'linear', 0, { section: 'orientation', group: 'look_at' }, 'TrackSchemas#cameraObjects:236'),
    animated('CAMERA', 'look_at_offset.space', 'enum', 'step', 'world', {
      enumValues: ['world', 'base'],
      section: 'orientation',
      group: 'look_at',
    }, 'TrackSchemas#cameraObjects:238'),
    animated('CAMERA', 'look_at_freeze', 'bool', 'step', false, { section: 'orientation', group: 'look_at' }, 'TrackSchemas#cameraObjects:240'),
    valueOnly('CAMERA', 'orient', 'enum', 'manual', {
      enumValues: ['manual', 'tangent'],
      section: 'orientation',
      group: 'orientation',
    }, 'TrackSchemas#cameraObjects:242'),
    animated('CAMERA', 'yaw_offset', 'float', 'angle', 0, {
      unit: 'degree',
      requires: 'orient=tangent',
      section: 'orientation',
      group: 'orientation',
    }, 'TrackSchemas#cameraObjects:244'),
    animated('CAMERA', 'pitch_offset', 'float', 'angle', 0, {
      unit: 'degree',
      requires: 'orient=tangent',
      section: 'orientation',
      group: 'orientation',
    }, 'TrackSchemas#cameraObjects:247'),
  )

  // 光学与 lane 合成
  objects.push(
    animated('CAMERA', 'fov', 'float', 'linear', 70, { section: 'camera' }, 'TrackSchemas#cameraObjects:252'),
    animated('CAMERA', 'zoom', 'float', 'geometric', 1, { section: 'camera' }, 'TrackSchemas#cameraObjects:253'),
    animated('CAMERA', 'opacity', 'float', 'linear', 1, { section: 'composite' }, 'TrackSchemas#cameraObjects:254'),
    animated('CAMERA', 'dest.x', 'float', 'linear', 0, { section: 'composite' }, 'TrackSchemas#cameraObjects:255'),
    animated('CAMERA', 'dest.y', 'float', 'linear', 0, { section: 'composite' }, 'TrackSchemas#cameraObjects:256'),
    animated('CAMERA', 'dest.w', 'float', 'linear', 1, { section: 'composite' }, 'TrackSchemas#cameraObjects:257'),
    animated('CAMERA', 'dest.h', 'float', 'linear', 1, { section: 'composite' }, 'TrackSchemas#cameraObjects:258'),
    animated('CAMERA', 'source.x', 'float', 'linear', 0, { section: 'composite' }, 'TrackSchemas#cameraObjects:259'),
    animated('CAMERA', 'source.y', 'float', 'linear', 0, { section: 'composite' }, 'TrackSchemas#cameraObjects:260'),
    animated('CAMERA', 'source.w', 'float', 'linear', 1, { section: 'composite' }, 'TrackSchemas#cameraObjects:261'),
    animated('CAMERA', 'source.h', 'float', 'linear', 1, { section: 'composite' }, 'TrackSchemas#cameraObjects:262'),
    animated('CAMERA', 'mask_x', 'float', 'linear', 0.5, { section: 'composite' }, 'TrackSchemas#cameraObjects:263'),
    animated('CAMERA', 'mask_y', 'float', 'linear', 0.5, { section: 'composite' }, 'TrackSchemas#cameraObjects:264'),
    animated('CAMERA', 'mask_width', 'float', 'linear', 1, { min: 0, section: 'composite' }, 'TrackSchemas#cameraObjects:265'),
    animated('CAMERA', 'mask_height', 'float', 'linear', 1, { min: 0, section: 'composite' }, 'TrackSchemas#cameraObjects:267'),
    animated('CAMERA', 'mask_radius', 'float', 'linear', 0.5, { min: 0, section: 'composite' }, 'TrackSchemas#cameraObjects:269'),
    valueOnly('CAMERA', 'mask_shape', 'enum', 'full', {
      enumValues: ['full', 'rect', 'circle'],
      section: 'composite',
    }, 'TrackSchemas#cameraObjects:271'),
    valueOnly('CAMERA', 'dimension', 'string', '', { section: 'composite' }, 'TrackSchemas#cameraObjects:273'),
  )

  // lane 级调色：57 通道，名字/缺省与 adjustObjects() 的同名通道完全一致
  for (const channel of CAMERA_COLOR_CHANNELS) {
    objects.push(animated('CAMERA', channel, 'float', 'linear', channelDefault(channel), {
      min: channelMin(channel),
      max: channelMax(channel),
      section: 'color',
    }, 'TrackSchemas#cameraObjects:276'))
  }

  // 调色曲线（value-only 结构）：曲线定义一次、不随时间变
  for (const curve of COLOR_CURVES) {
    objects.push(valueOnly('CAMERA', curve, 'struct', null, { section: 'color' }, 'TrackSchemas#cameraObjects:282'))
  }

  // 相机参数运动模型（value-only 结构）
  for (const channel of ['motion_position', 'motion_yaw', 'motion_pitch', 'motion_roll', 'motion_fov', 'motion_zoom']) {
    objects.push(valueOnly('CAMERA', channel, 'struct', null, { section: 'motion' }, 'TrackSchemas#cameraObjects:288'))
  }

  // 手持呼吸（value-only）
  objects.push(
    valueOnly('CAMERA', 'cam_breath_enabled', 'bool', false, { section: 'breath' }, 'TrackSchemas#cameraObjects:294'),
    valueOnly('CAMERA', 'cam_breath_intensity', 'float', 0.05, { section: 'breath' }, 'TrackSchemas#cameraObjects:295'),
    valueOnly('CAMERA', 'cam_breath_seed', 'int', 0, { section: 'breath' }, 'TrackSchemas#cameraObjects:296'),
    valueOnly('CAMERA', 'cam_breath_type', 'enum', 'perlin', {
      enumValues: ['perlin', 'perlin_axis', 'sine', 'trauma'],
      section: 'breath',
    }, 'TrackSchemas#cameraObjects:297'),
    valueOnly('CAMERA', 'cam_breath_speed', 'float', 1, { section: 'breath' }, 'TrackSchemas#cameraObjects:299'),
    valueOnly('CAMERA', 'cam_breath_trauma', 'float', 1, { section: 'breath' }, 'TrackSchemas#cameraObjects:300'),
    valueOnly('CAMERA', 'cam_breath_decay', 'float', 0.5, { section: 'breath' }, 'TrackSchemas#cameraObjects:301'),
  )

  // 过渡（value-only）
  objects.push(
    valueOnly('CAMERA', 'transition', 'enum', 'cut', {
      enumValues: ['cut', 'morph'],
      section: 'transition',
    }, 'TrackSchemas#cameraObjects:304'),
    valueOnly('CAMERA', 'transition_duration', 'float', 0.5, { min: 0, section: 'transition' }, 'TrackSchemas#cameraObjects:306'),
    valueOnly('CAMERA', 'transition_curve', 'struct', null, { section: 'transition' }, 'TrackSchemas#cameraObjects:308'),
    valueOnly('CAMERA', 'transition_params', 'struct', null, { section: 'transition' }, 'TrackSchemas#cameraObjects:309'),
    valueOnly('CAMERA', 'transition_interrupt', 'enum', 'blend', {
      enumValues: ['blend', 'snap'],
      section: 'transition',
    }, 'TrackSchemas#cameraObjects:310'),
  )

  // 覆盖链 Modifier（value-only）
  objects.push(
    valueOnly('CAMERA', 'modifier', 'struct', null, { section: 'modifier' }, 'TrackSchemas#cameraObjects:314'),
    valueOnly('CAMERA', 'suppress_modifiers', 'bool', false, { section: 'modifier' }, 'TrackSchemas#cameraObjects:315'),
  )

  // 选择器策略（通用 + 7 个调用点覆盖）
  objects.push(
    animated('CAMERA', 'selector_refresh', 'float', 'step', 1, { section: 'selector' }, 'TrackSchemas#cameraObjects:318'),
    animated('CAMERA', 'selector_switch_while_alive', 'bool', 'step', true, { section: 'selector' }, 'TrackSchemas#cameraObjects:319'),
    animated('CAMERA', 'selector_switch_interval', 'float', 'step', 1, { section: 'selector' }, 'TrackSchemas#cameraObjects:321'),
    animated('CAMERA', 'selector_switch_smooth', 'float', 'step', 0, { section: 'selector' }, 'TrackSchemas#cameraObjects:323'),
    animated('CAMERA', 'selector_anchor', 'enum', 'step', 'camera', {
      enumValues: ['camera', 'player', 'target', 'origin'],
      section: 'selector',
    }, 'TrackSchemas#cameraObjects:325'),
    animated('CAMERA', 'selector_pick', 'enum', 'step', 'first', {
      enumValues: ['first', 'nearest', 'alive'],
      section: 'selector',
    }, 'TrackSchemas#cameraObjects:327'),
  )
  for (const callpoint of NEW_CALLPOINTS) {
    objects.push(
      animated('CAMERA', `selector_refresh_${callpoint}`, 'float', 'step', null, { section: 'selector' }, 'TrackSchemas#cameraObjects:329'),
      animated('CAMERA', `selector_switch_while_alive_${callpoint}`, 'bool', 'step', null, { section: 'selector' }, 'TrackSchemas#cameraObjects:329'),
      animated('CAMERA', `selector_switch_interval_${callpoint}`, 'float', 'step', null, { section: 'selector' }, 'TrackSchemas#cameraObjects:329'),
      animated('CAMERA', `selector_switch_smooth_${callpoint}`, 'float', 'step', null, { section: 'selector' }, 'TrackSchemas#cameraObjects:329'),
      animated('CAMERA', `selector_anchor_${callpoint}`, 'enum', 'step', null, {
        enumValues: ['camera', 'player', 'target', 'origin'],
        section: 'selector',
      }, 'TrackSchemas#cameraObjects:329'),
      animated('CAMERA', `selector_pick_${callpoint}`, 'enum', 'step', null, {
        enumValues: ['first', 'nearest', 'alive'],
        section: 'selector',
      }, 'TrackSchemas#cameraObjects:329'),
    )
  }

  return objects
}

/** `TrackSchemas.letterboxObjects()`（`:349`）。 */
function letterboxObjects(): FieldEntry[] {
  return [
    animated('LETTERBOX', 'aspect_ratio', 'float', 'linear', 2.35, { min: 0, section: 'letterbox' }, 'TrackSchemas#letterboxObjects:351'),
    animated('LETTERBOX', 'opacity', 'float', 'linear', 1, { min: 0, max: 1, section: 'letterbox' }, 'TrackSchemas#letterboxObjects:353'),
  ]
}

/** `TrackSchemas.audioObjects()`（`:358`）。 */
function audioObjects(): FieldEntry[] {
  return [
    animated('AUDIO', 'volume', 'float', 'linear', 1, { section: 'audio' }, 'TrackSchemas#audioObjects:360'),
    animated('AUDIO', 'x', 'float', 'linear', 0, { section: 'audio' }, 'TrackSchemas#audioObjects:361'),
    animated('AUDIO', 'y', 'float', 'linear', 0, { section: 'audio' }, 'TrackSchemas#audioObjects:362'),
    animated('AUDIO', 'z', 'float', 'linear', 0, { section: 'audio' }, 'TrackSchemas#audioObjects:363'),
    valueOnly('AUDIO', 'sound', 'string', null, { required: true, section: 'audio' }, 'TrackSchemas#audioObjects:365'),
    valueOnly('AUDIO', 'source', 'enum', 'file', {
      enumValues: ['file', 'minecraft'],
      section: 'audio',
    }, 'TrackSchemas#audioObjects:366'),
    valueOnly('AUDIO', 'pitch', 'float', 1, { section: 'audio' }, 'TrackSchemas#audioObjects:368'),
    valueOnly('AUDIO', 'file_loop', 'bool', false, { section: 'audio' }, 'TrackSchemas#audioObjects:369'),
    valueOnly('AUDIO', 'fade_in', 'float', 0, { min: 0, section: 'audio' }, 'TrackSchemas#audioObjects:370'),
    valueOnly('AUDIO', 'fade_out', 'float', 0, { min: 0, section: 'audio' }, 'TrackSchemas#audioObjects:371'),
    valueOnly('AUDIO', 'attenuation', 'enum', 'linear', {
      enumValues: ['none', 'linear'],
      section: 'audio',
    }, 'TrackSchemas#audioObjects:372'),
    valueOnly('AUDIO', 'position_mode', 'enum', 'relative', {
      enumValues: ['relative', 'absolute'],
      section: 'audio',
    }, 'TrackSchemas#audioObjects:374'),
    valueOnly('AUDIO', 'category', 'enum', 'music', {
      enumValues: ['music', 'ambient'],
      section: 'audio',
    }, 'TrackSchemas#audioObjects:376'),
  ]
}

/** `TrackSchemas.eventObjects()`（`:381`）。 */
function eventObjects(): FieldEntry[] {
  return [
    eventRecord('EVENT', 'event', 'event', 'TrackSchemas#eventObjects:383'),
    valueOnly('EVENT', 'event_type', 'string', 'command', { section: 'event' }, 'TrackSchemas#eventObjects:385'),
  ]
}

/** `TrackSchemas.modEventObjects()`（`:389`）。 */
function modEventObjects(): FieldEntry[] {
  return [
    eventRecord('MOD_EVENT', 'mod_event', 'event', 'TrackSchemas#modEventObjects:391'),
    valueOnly('MOD_EVENT', 'event_type', 'string', 'mod_event', { section: 'event' }, 'TrackSchemas#modEventObjects:393'),
    valueOnly('MOD_EVENT', 'data', 'struct', null, { section: 'event' }, 'TrackSchemas#modEventObjects:394'),
  ]
}

/** `TrackSchemas.overlayObjects()`（`:398`）。 */
function overlayObjects(): FieldEntry[] {
  const objects: FieldEntry[] = [
    animated('OVERLAY', 'x', 'float', 'linear', 0.5, { section: 'layout' }, 'TrackSchemas#overlayObjects:400'),
    animated('OVERLAY', 'y', 'float', 'linear', 0.5, { section: 'layout' }, 'TrackSchemas#overlayObjects:401'),
    animated('OVERLAY', 'anchor_x', 'float', 'linear', 0.5, { section: 'layout' }, 'TrackSchemas#overlayObjects:402'),
    animated('OVERLAY', 'anchor_y', 'float', 'linear', 0.5, { section: 'layout' }, 'TrackSchemas#overlayObjects:403'),
    animated('OVERLAY', 'scale_x', 'float', 'linear', 1, { section: 'layout' }, 'TrackSchemas#overlayObjects:404'),
    animated('OVERLAY', 'scale_y', 'float', 'linear', 1, { section: 'layout' }, 'TrackSchemas#overlayObjects:405'),
    animated('OVERLAY', 'source.x', 'float', 'linear', 0, { appliesTo: ['image'], section: 'source' }, 'TrackSchemas#overlayObjects:406'),
    animated('OVERLAY', 'source.y', 'float', 'linear', 0, { appliesTo: ['image'], section: 'source' }, 'TrackSchemas#overlayObjects:408'),
    animated('OVERLAY', 'source.w', 'float', 'linear', 1, { appliesTo: ['image'], section: 'source' }, 'TrackSchemas#overlayObjects:410'),
    animated('OVERLAY', 'source.h', 'float', 'linear', 1, { appliesTo: ['image'], section: 'source' }, 'TrackSchemas#overlayObjects:412'),
    animated('OVERLAY', 'opacity', 'float', 'linear', 1, { min: 0, max: 1, section: 'composite' }, 'TrackSchemas#overlayObjects:414'),
    animated('OVERLAY', 'font_scale', 'float', 'linear', 1, { appliesTo: ['subtitle'], section: 'text' }, 'TrackSchemas#overlayObjects:416'),
    animated('OVERLAY', 'color.r', 'float', 'linear', 0, { appliesTo: ['fade'], section: 'color' }, 'TrackSchemas#overlayObjects:418'),
    animated('OVERLAY', 'color.g', 'float', 'linear', 0, { appliesTo: ['fade'], section: 'color' }, 'TrackSchemas#overlayObjects:420'),
    animated('OVERLAY', 'color.b', 'float', 'linear', 0, { appliesTo: ['fade'], section: 'color' }, 'TrackSchemas#overlayObjects:422'),
    animated('OVERLAY', 'mask_x', 'float', 'linear', 0.5, { appliesTo: ['fade'], section: 'mask' }, 'TrackSchemas#overlayObjects:424'),
    animated('OVERLAY', 'mask_y', 'float', 'linear', 0.5, { appliesTo: ['fade'], section: 'mask' }, 'TrackSchemas#overlayObjects:426'),
    animated('OVERLAY', 'mask_width', 'float', 'linear', 1, { min: 0, appliesTo: ['fade'], section: 'mask' }, 'TrackSchemas#overlayObjects:428'),
    animated('OVERLAY', 'mask_height', 'float', 'linear', 1, { min: 0, appliesTo: ['fade'], section: 'mask' }, 'TrackSchemas#overlayObjects:430'),
    animated('OVERLAY', 'mask_radius', 'float', 'linear', 0.5, { min: 0, appliesTo: ['fade'], section: 'mask' }, 'TrackSchemas#overlayObjects:432'),
    animated('OVERLAY', 'gradient_angle', 'float', 'linear', 0, { appliesTo: ['fade'], section: 'gradient' }, 'TrackSchemas#overlayObjects:434'),
    animated('OVERLAY', 'gradient_center_x', 'float', 'linear', 0.5, { appliesTo: ['fade'], section: 'gradient' }, 'TrackSchemas#overlayObjects:436'),
    animated('OVERLAY', 'gradient_center_y', 'float', 'linear', 0.5, { appliesTo: ['fade'], section: 'gradient' }, 'TrackSchemas#overlayObjects:438'),
    animated('OVERLAY', 'gradient_radius', 'float', 'linear', 0.5, { min: 0, appliesTo: ['fade'], section: 'gradient' }, 'TrackSchemas#overlayObjects:440'),
    valueOnly('OVERLAY', 'layer_type', 'enum', 'fade', {
      enumValues: ['fade', 'image', 'subtitle'],
      required: true,
      section: 'layer',
    }, 'TrackSchemas#overlayObjects:443'),
    valueOnly('OVERLAY', 'color', 'string', '#000000', { section: 'layer' }, 'TrackSchemas#overlayObjects:445'),
    valueOnly('OVERLAY', 'gradient', 'struct', null, { appliesTo: ['fade'], section: 'layer' }, 'TrackSchemas#overlayObjects:446'),
    valueOnly('OVERLAY', 'mask_shape', 'enum', 'full', {
      enumValues: ['full', 'rect', 'circle'],
      appliesTo: ['fade'],
      section: 'layer',
    }, 'TrackSchemas#overlayObjects:448'),
    valueOnly('OVERLAY', 'blend_mode', 'enum', 'normal', {
      enumValues: ['normal', 'multiply', 'screen', 'soft_light', 'overlay'],
      appliesTo: ['fade'],
      section: 'layer',
    }, 'TrackSchemas#overlayObjects:450'),
    valueOnly('OVERLAY', 'path', 'string', '', { section: 'layer' }, 'TrackSchemas#overlayObjects:453'),
    valueOnly('OVERLAY', 'text', 'string', '', { section: 'layer' }, 'TrackSchemas#overlayObjects:454'),
    valueOnly('OVERLAY', 'z_index', 'int', 10, { section: 'layer' }, 'TrackSchemas#overlayObjects:455'),
  ]
  return objects
}

/** `TrackSchemas.adjustObjects()`（`:459`）。 */
function adjustObjects(): FieldEntry[] {
  const objects: FieldEntry[] = []

  for (const channel of ADJUST_CHANNELS) {
    objects.push(animated('ADJUST', channel, 'float', 'linear', channelDefault(channel), {
      min: channelMin(channel),
      max: channelMax(channel),
      section: 'color',
    }, 'TrackSchemas#adjustObjects:461'))
  }

  for (const curve of COLOR_CURVES) {
    objects.push(valueOnly('ADJUST', curve, 'struct', null, { section: 'curve' }, 'TrackSchemas#adjustObjects:466'))
  }

  objects.push(
    valueOnly('ADJUST', 'lut', 'string', null, { section: 'lut' }, 'TrackSchemas#adjustObjects:470'),
    valueOnly('ADJUST', 'lut_input_gamma', 'float', 1, { min: 0, section: 'lut' }, 'TrackSchemas#adjustObjects:471'),
    valueOnly('ADJUST', 'blend_mode', 'enum', 'normal', {
      enumValues: ['normal', 'multiply', 'screen', 'soft_light', 'overlay'],
      section: 'blend',
    }, 'TrackSchemas#adjustObjects:472'),
  )

  return objects
}

export const TRACK_OBJECTS: Record<string, FieldEntry[]> = {
  CAMERA: cameraObjects(),
  LETTERBOX: letterboxObjects(),
  AUDIO: audioObjects(),
  EVENT: eventObjects(),
  MOD_EVENT: modEventObjects(),
  OVERLAY: overlayObjects(),
  ADJUST: adjustObjects(),
}
