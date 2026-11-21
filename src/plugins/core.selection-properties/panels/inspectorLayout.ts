import type { JsonObject } from '../../../core/doc/types.ts'
import { buildGroups } from '../../../features/effects/membership.ts'
import { effectiveStaticValue, type ClipTiming } from '../../../features/effects/rows.ts'
import type { EffectGroup, PropertyRow } from '../../../features/effects/types.ts'
import type { InspectorValueOptions } from '../../../features/effects/panels/inspectorValueOptions.ts'
import { effectiveLayerType, maskShapeOf } from '../../../features/overlay/layers.ts'
import { displayGroupFor } from '../../../workbench/api/fieldSurface.ts'

export interface InspectorPage {
  key: string
  label: string
  groups: EffectGroup[]
  initiallyOpen: readonly string[]
}

type PageDefinition = readonly [key: string, label: string, initiallyOpen?: readonly string[]]
type Placement = readonly [page: string, key: string, label: string, order: number]

const PAGES: Readonly<Record<string, readonly PageDefinition[]>> = {
  CAMERA: [
    ['lens', '镜头', ['position']], ['motion', '运动'],
    ['composition', '构图', ['picture']], ['color', '调色', ['color.basic']],
    ['transition', '转场', ['transition']],
  ],
  AUDIO: [['sound', '声音', ['audio.source', 'audio.volume']], ['space', '空间', ['audio.space']]],
  ADJUST: [['color', '调色', ['color.basic']], ['mix', 'LUT 与混合', ['adjust.lut']]],
  LETTERBOX: [['main', '画幅', ['letterbox']]],
  EVENT: [['main', '事件记录', ['event']]],
  MOD_EVENT: [['main', '事件记录', ['event']]],
}

const SELECTOR_SOURCES = [
  ['position_origin', '位置原点'], ['look_at', '注视目标'], ['yaw_base', '朝向基准'],
  ['yaw_base_from', '朝向连线起点'], ['yaw_base_to', '朝向连线终点'],
  ['facing_target', '基准轴方向目标'], ['facing_entity', '基准轴方向实体'],
] as const

const COLOR_GROUPS: Readonly<Record<string, readonly [label: string, order: number]>> = {
  'color.basic': ['明暗', 0], 'color.hsl': ['色彩与白平衡', 1],
  'color.channels': ['通道系数', 2], 'color.matrix': ['通道混合', 3],
  'color.curve_strength': ['通道曲线强度', 4], 'color.lgg': ['暗部、中间调与亮部', 5],
  'color.hue_strength': ['色彩曲线强度', 6], 'color.hue_band': ['六色带', 7],
  'color.curves': ['曲线定义', 8], 'color.transform': ['风格', 9],
}

function colorPlacement(key: string): Placement | undefined {
  if (key === 'color.lut_def' || key === 'color.lut_strength') return ['mix', 'adjust.lut', 'LUT', 0]
  if (key === 'color.layer') return ['mix', 'adjust.blend', '层级混合', 1]
  const merged = key === 'color.white_balance' ? 'color.hsl' : key
  const entry = COLOR_GROUPS[merged]
  return entry === undefined ? undefined : ['color', merged, entry[0], entry[1]]
}

function placement(trackType: string, row: PropertyRow, firstPage: string): Placement {
  if (row.unknown) return [firstPage, '__unknown__', '未知属性', 1000]
  const contribution = displayGroupFor(trackType, row.path)
  const path = row.path
  if (trackType === 'CAMERA') {
    switch (row.section) {
      case 'position': return ['lens', 'position', '位置', 0]
      case 'orientation': return ['lens', 'orientation', '朝向', 1]
      case 'camera': return ['lens', 'optics', '镜头参数', 2]
      case 'breath': return ['motion', 'breath', '镜头呼吸', 0]
      case 'motion': return ['motion', 'motion-models', '运动模型', 1]
      case 'modifier': return ['motion', 'modifier', '相机修饰', 2]
      case 'selector': {
        const source = SELECTOR_SOURCES.findIndex(([suffix]) => path.endsWith(`_${suffix}`))
        return source < 0 ? ['motion', 'selector', '实体选择策略', 3]
          : ['motion', `selector.${SELECTOR_SOURCES[source][0]}`, `${SELECTOR_SOURCES[source][1]}的选择策略`, 4 + source]
      }
      case 'composite':
        if (path.startsWith('dest.')) return ['composition', 'target-area', '目标区域', 1]
        if (path.startsWith('source.')) return ['composition', 'source-area', '源画面裁切', 2]
        if (path.startsWith('mask_')) return ['composition', 'mask', '遮罩', 3]
        return ['composition', 'picture', '画面', 0]
      case 'transition': return ['transition', 'transition', '相邻镜头切换', 0]
    }
  }
  if (trackType === 'CAMERA' || trackType === 'ADJUST') {
    const color = colorPlacement(contribution?.key ?? '')
    if (color !== undefined) return color
    if (path === 'blend_mode') return ['mix', 'adjust.blend', '层级混合', 1]
    if (row.section === 'color' || row.section === 'curve') return ['color', 'color.other', '其他调色参数', 10]
    if (row.section === 'lut') return ['mix', 'adjust.lut', 'LUT', 0]
    if (row.section === 'blend') return ['mix', 'adjust.blend', '层级混合', 1]
  }
  if (trackType === 'AUDIO') {
    switch (path) {
      case 'source': case 'sound': case 'file_loop': return ['sound', 'audio.source', '音源', 0]
      case 'volume': case 'pitch': return ['sound', 'audio.volume', '音量与音高', 1]
      case 'fade_in': case 'fade_out': return ['sound', 'audio.envelope', '淡入淡出', 2]
      case 'category': case 'position_mode': case 'attenuation': case 'x': case 'y': case 'z':
        return ['space', 'audio.space', '空间定位', 0]
    }
  }
  if (trackType === 'OVERLAY') {
    if (path === 'opacity' || path === 'z_index') return ['layer', 'layer.order', '层级与透明度', 1]
    if (path.startsWith('mask_')) return ['mask', 'mask', '遮罩形状', 0]
    if (path.startsWith('gradient_')) return ['mask', 'gradient', '渐变形状', 1]
    if (row.section === 'layout') return ['layout', 'layout', '位置与缩放', 0]
    if (row.section === 'source') return ['layout', 'source-area', '源画面裁切', 1]
    return ['layer', 'layer.content', '图层内容', 0]
  }
  if (trackType === 'LETTERBOX') return ['main', 'letterbox', '画幅', 0]
  if (trackType === 'EVENT' || trackType === 'MOD_EVENT') return ['main', 'event', '事件记录', 0]
  return [firstPage, contribution?.key ?? row.groupKey, contribution?.label ?? row.groupLabel, contribution?.order ?? 998]
}

function applicable(trackType: string, path: string, get: (path: string) => unknown, mask: string): boolean {
  if (trackType === 'AUDIO') {
    if (path === 'file_loop' && get('source') === 'minecraft') return false
    if (['x', 'y', 'z', 'position_mode', 'attenuation'].includes(path) && get('category') !== 'ambient') return false
  }
  if (trackType === 'CAMERA') {
    if (path.startsWith('transition_')) return get('transition') === 'morph'
    if (path === 'mask_x' || path === 'mask_y') return mask === 'rect' || mask === 'circle'
    if (path === 'mask_width' || path === 'mask_height') return mask === 'rect'
    if (path === 'mask_radius') return mask === 'circle'
  }
  return true
}

const FIRST_ROW: Readonly<Record<string, string>> = {
  'audio.source': 'source', 'audio.space': 'category', 'layer.content': 'layer_type',
  'layer.order': 'opacity', mask: 'mask_shape', transition: 'transition',
}

/** 这里仅决定呈现位置。行类型、适用性基础和写入约束仍由目录与原字段面提供。 */
export function inspectorPages(trackType: string, rows: readonly PropertyRow[], objects: JsonObject, timing: ClipTiming): InspectorPage[] {
  const definitions: readonly PageDefinition[] = trackType === 'OVERLAY'
    ? [['layer', '图层', ['layer.content']], effectiveLayerType(objects) === 'fade'
      ? ['mask', '遮罩', ['mask']] : ['layout', '布局', ['layout']]]
    : PAGES[trackType] ?? [['main', '属性']]
  const firstPage = definitions[0][0]
  const byPath = new Map(rows.map((row) => [row.path, row]))
  const get = (path: string): unknown => {
    const row = byPath.get(path)
    return row === undefined ? undefined : effectiveStaticValue(row)
  }
  const mask = maskShapeOf(objects)
  const byPage = new Map<string, { rows: PropertyRow[]; order: Map<string, number> }>()
  for (const row of rows) {
    if (!row.unknown && !applicable(trackType, row.path, get, mask)) continue
    const [page, key, label, order] = placement(trackType, row, firstPage)
    if (!byPage.has(page)) byPage.set(page, { rows: [], order: new Map() })
    const group = byPage.get(page)!
    group.rows.push({ ...row, label: inspectorLabel(row), groupKey: key, groupLabel: label })
    group.order.set(key, order)
  }
  return definitions.flatMap(([key, label, initiallyOpen]) => {
    const projected = byPage.get(key)
    if (projected === undefined) return []
    const groups = buildGroups(projected.rows, timing)
    groups.sort((a, b) => (projected.order.get(a.key) ?? 0) - (projected.order.get(b.key) ?? 0))
    for (const group of groups) {
      const first = FIRST_ROW[group.key]
      const index = group.rows.findIndex((row) => row.path === first)
      if (index > 0) group.rows.unshift(...group.rows.splice(index, 1))
    }
    return [{ key, label, groups, initiallyOpen: initiallyOpen ?? (PAGES[trackType] === undefined ? [groups[0].key] : []) }]
  })
}

const LABELS: Readonly<Record<string, string>> = {
  fov: '视野角', zoom: '变焦倍率', opacity: '不透明度', dimension: '镜头维度',
  'dest.x': '横向', 'dest.y': '纵向', 'dest.w': '宽度', 'dest.h': '高度',
  'source.x': '横向', 'source.y': '纵向', 'source.w': '宽度', 'source.h': '高度',
  mask_shape: '形状', mask_x: '中心 X', mask_y: '中心 Y', mask_width: '宽度', mask_height: '高度', mask_radius: '半径',
  aspect_ratio: '画幅比例', source: '来源', sound: '声音', volume: '音量', pitch: '音高倍率',
  file_loop: '文件循环', fade_in: '淡入', fade_out: '淡出', category: '声音类别',
  position_mode: '定位方式', attenuation: '衰减方式', x: '位置 X', y: '位置 Y', z: '位置 Z',
  layer_type: '图层类型', color: '填充颜色', gradient: '渐变', path: '素材', text: '字幕文本',
  font_scale: '字号倍率', z_index: '层级', scale_x: '横向缩放', scale_y: '纵向缩放',
  anchor_x: '横向锚点', anchor_y: '纵向锚点', gradient_angle: '渐变角度',
  gradient_center_x: '中心 X', gradient_center_y: '中心 Y', gradient_radius: '渐变半径',
  'color.r': '红色分量', 'color.g': '绿色分量', 'color.b': '蓝色分量',
  transition: '过渡方式', transition_duration: '混合时长', transition_curve: '过渡曲线',
  transition_params: '过渡参数', transition_interrupt: '中断时',
  selector_refresh: '刷新间隔', selector_switch_while_alive: '存活时可切换',
  selector_switch_interval: '切换间隔', selector_switch_smooth: '切换平滑时长', selector_anchor: '选择距离基准',
  selector_pick: '目标选择', suppress_modifiers: '忽略修饰器', modifier: '修饰配置',
  event: '命令记录', mod_event: '模组事件记录', event_type: '默认事件名', data: '默认事件数据',
  exposure: '曝光', contrast: '对比度', highlights: '高光', shadows: '阴影', whites: '白场', blacks: '黑场',
  temperature: '色温', tint: '色调', hue: '色相', saturation: '饱和度', vibrance: '鲜艳度', lightness: '明度',
  red: '红通道', green: '绿通道', blue: '蓝通道', grayscale: '灰度', invert: '反相',
  curve_strength: 'RGB 曲线强度', r_curve_strength: '红通道曲线强度',
  g_curve_strength: '绿通道曲线强度', b_curve_strength: '蓝通道曲线强度',
  hv_h_strength: '色相对色相', hv_s_strength: '色相对饱和度', hv_l_strength: '色相对亮度',
  lv_s_strength: '亮度对饱和度', sv_s_strength: '饱和度对饱和度', sv_l_strength: '饱和度对亮度',
  rgb_curve: '调色曲线', lut: 'LUT 资源', lut_input_gamma: '输入伽马', lut_strength: 'LUT 强度',
  blend_mode: '混合模式', blend_amount: '混合强度',
}

const CHANNELS: Readonly<Record<string, string>> = {
  red: '红', yellow: '黄', green: '绿', cyan: '青', blue: '蓝', magenta: '品红', r: '红', g: '绿', b: '蓝',
}

function inspectorLabel(row: PropertyRow): string {
  if (row.unknown) return row.path
  const path = row.path
  if (Object.hasOwn(LABELS, path)) return LABELS[path]
  if (row.section === 'selector') {
    const source = SELECTOR_SOURCES.find(([suffix]) => path.endsWith(`_${suffix}`))
    if (source !== undefined) return LABELS[path.slice(0, -(source[0].length + 1))] ?? row.label
  }
  const band = /^(hue|sat)_([a-z]+)$/.exec(path)
  if (band !== null && Object.hasOwn(CHANNELS, band[2])) return `${CHANNELS[band[2]]}色${band[1] === 'hue' ? '相' : '饱和度'}`
  const channel = /^(lift|gamma|gain)_([rgb])$/.exec(path)
  if (channel !== null) return `${channel[1] === 'lift' ? '暗部' : channel[1] === 'gamma' ? '中间调' : '亮部'} · ${CHANNELS[channel[2]]}`
  const matrix = /^mix_([rgb])([rgb])$/.exec(path)
  if (matrix !== null) return `${CHANNELS[matrix[1]]}输出 · ${CHANNELS[matrix[2]]}输入`
  return row.label
}

const ENUM_LABELS: Readonly<Record<string, string>> = {
  cut: '直接切换', morph: '平滑过渡', blend: '继续混合', snap: '立即切换',
  file: '本地文件', minecraft: '游戏声音', music: '音乐', ambient: '环境声',
  relative: '相对位置', absolute: '绝对位置', none: '关闭', linear: '线性', full: '整幅', rect: '矩形', circle: '圆形',
  first: '首个', nearest: '最近', alive: '存活', camera: '相机', player: '玩家', target: '目标', origin: '原点',
  normal: '正常', multiply: '正片叠底', screen: '滤色', soft_light: '柔光', overlay: '叠加',
}

const WORKING_RANGES: Readonly<Record<string, readonly [number, number, number]>> = {
  fov: [20, 120, 0.1], zoom: [0.2, 4, 0.01], opacity: [0, 1, 0.01],
  aspect_ratio: [1, 4, 0.01], volume: [0, 1, 0.01], pitch: [0.5, 2, 0.01],
}

export function inspectorOptions(row: PropertyRow): InspectorValueOptions | undefined {
  const labels = row.enumValues === undefined ? undefined : ENUM_LABELS
  const range = WORKING_RANGES[row.path] ?? (row.min !== undefined && row.max !== undefined && row.min < row.max
    ? [row.min, row.max, row.type === 'int' ? 1 : 0.01] as const : undefined)
  const multiline = row.type === 'string' && row.path === 'text'
  if (labels === undefined && range === undefined && !multiline) return undefined
  return {
    ...(labels === undefined ? {} : { labels }),
    ...(range === undefined ? {} : { range }),
    ...(multiline ? { multiline: true, stackedLabel: true } : {}),
  }
}
