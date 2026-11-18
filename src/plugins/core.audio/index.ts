/**
 * `core.audio` 激活入口（10）。
 *
 * 只注册显示与控件：不改文档模型、不合并通道、不发明联动；所有写入仍走
 * 06 面板 / 09 自定义控件共同使用的 `ctx.commands.commit`。
 */
import { defineAsyncComponent } from 'vue'
import type { Component } from 'vue'
import { registerCustomField } from '../../features/effects/customFields.ts'
import {
  registerFieldSurfaces,
  registerMetaFieldSurface,
  registerPanelBanner,
} from '../../workbench/api/fieldSurface.ts'
import type { FieldSurfaceContribution } from '../../workbench/api/fieldSurface.ts'
import type { PluginContext } from '../../workbench/api/context.ts'
import { AUDIO_GROUPS, AUDIO_PATHS, audioGroupOf } from './shared/audioSpec.ts'
import {
  COLOR_CURVES,
  COLOR_GROUPS,
  HUE_BANDS,
  MATRIX_PATHS,
  colorGroupOf,
} from './shared/colorSpec.ts'

const PLUGIN_ID = 'core.audio'

const loadSlider = () => import('./panels/SliderField.vue').then((module) => module.default)
const loadAudioSource = () => import('./panels/AudioSourceField.vue').then((module) => module.default)
const loadAudioEnum = () => import('./panels/AudioEnumField.vue').then((module) => module.default)
const loadAudioFileLoop = () => import('./panels/AudioFileLoopField.vue').then((module) => module.default)
const loadAudioEnvelope = () => import('./panels/AudioEnvelopeField.vue').then((module) => module.default)
const loadColorMatrix = () => import('./panels/ColorMatrixField.vue').then((module) => module.default)
const loadColorBands = () => import('./panels/ColorBandsField.vue').then((module) => module.default)
const loadColorCurves = () => import('./panels/ColorCurvesSummary.vue').then((module) => module.default)
const loadColorTriple = () => import('./panels/ColorTripleField.vue').then((module) => module.default)
const loadColorLut = () => import('./panels/ColorLutField.vue').then((module) => module.default)
const loadColorLutGamma = () => import('./panels/ColorLutGammaField.vue').then((module) => module.default)
const loadColorLutStrength = () => import('./panels/ColorLutStrengthField.vue').then((module) => module.default)
const loadColorCurveStrength = () => import('./panels/ColorCurveStrengthField.vue').then((module) => module.default)
const loadColorEnum = () => import('./panels/ColorEnumField.vue').then((module) => module.default)

const SliderField = defineAsyncComponent(loadSlider)
const AudioSourceField = defineAsyncComponent(loadAudioSource)
const AudioEnumField = defineAsyncComponent(loadAudioEnum)
const AudioFileLoopField = defineAsyncComponent(loadAudioFileLoop)
const AudioEnvelopeField = defineAsyncComponent(loadAudioEnvelope)
const ColorMatrixField = defineAsyncComponent(loadColorMatrix)
const ColorBandsField = defineAsyncComponent(loadColorBands)
const ColorCurvesSummary = defineAsyncComponent(loadColorCurves)
const ColorTripleField = defineAsyncComponent(loadColorTriple)
const ColorLutField = defineAsyncComponent(loadColorLut)
const ColorLutGammaField = defineAsyncComponent(loadColorLutGamma)
const ColorLutStrengthField = defineAsyncComponent(loadColorLutStrength)
const ColorCurveStrengthField = defineAsyncComponent(loadColorCurveStrength)
const ColorEnumField = defineAsyncComponent(loadColorEnum)

/** 哪些颜色通道是可动画数值（有帧时从属性面板撤走值控件）。 */
const COLOR_ANIMATED_PATHS: ReadonlySet<string> = new Set([
  ...COLOR_GROUPS.flatMap((group) => group.paths),
])

/** 数值控件之外的特殊控件；其余动画通道统一用滑杆 + 数字。 */
const COLOR_FIELD_LOADERS = new Map<string, () => Promise<Component>>([
  ['mix_rr', loadColorMatrix],
  ['hue_red', loadColorBands],
  ['rgb_curve', loadColorCurves],
  ['lift_r', loadColorTriple],
  ['gamma_r', loadColorTriple],
  ['gain_r', loadColorTriple],
  ['lut', loadColorLut],
  ['lut_input_gamma', loadColorLutGamma],
  ['lut_strength', loadColorLutStrength],
  ['blend_mode', loadColorEnum],
  ['curve_strength', loadColorCurveStrength],
  ['r_curve_strength', loadColorCurveStrength],
  ['g_curve_strength', loadColorCurveStrength],
  ['b_curve_strength', loadColorCurveStrength],
])

/** 矩阵承载行之外，其余格子在静态时隐藏；一旦有帧拆回逐行。 */
function hiddenMatrixRows(objects: Readonly<Record<string, unknown>>): string[] {
  const framed = MATRIX_PATHS.filter((path) => hasFrames(objects, path))
  if (framed.length === 0) {
    return MATRIX_PATHS.filter((path) => path !== 'mix_rr')
  }
  return MATRIX_PATHS.filter((path) => path !== 'mix_rr' && !framed.includes(path))
}

/** 六色带同理：静态合并为六行两列，有帧拆回逐通道。 */
function hiddenBandRows(objects: Readonly<Record<string, unknown>>): string[] {
  const paths = HUE_BANDS.flatMap((band) => [band.hue, band.sat])
  const framed = paths.filter((path) => hasFrames(objects, path))
  if (framed.length === 0) {
    return paths.filter((path) => path !== 'hue_red')
  }
  return paths.filter((path) => path !== 'hue_red' && !framed.includes(path))
}

/** Lift/Gamma/Gain：静态三通道一行，有帧拆回逐通道。 */
function hiddenTripleRows(
  objects: Readonly<Record<string, unknown>>,
  base: 'lift' | 'gamma' | 'gain',
): string[] {
  const paths = [`${base}_r`, `${base}_g`, `${base}_b`]
  const framed = paths.filter((path) => hasFrames(objects, path))
  if (framed.length === 0) {
    return paths.filter((path) => path !== `${base}_r`)
  }
  return paths.filter((path) => path !== `${base}_r` && !framed.includes(path))
}

/** 曲线定义为 value-only：只留 RGB 主曲线承载行，其余九行隐藏。 */
function hiddenCurveRows(): string[] {
  return COLOR_CURVES.slice(1).map((curve) => curve.key)
}

function hasFrames(objects: Readonly<Record<string, unknown>>, path: string): boolean {
  const property = objects[path]
  if (typeof property !== 'object' || property === null || Array.isArray(property)) {
    return false
  }
  const frames = (property as Record<string, unknown>).keyframes
  return Array.isArray(frames) && frames.length > 0
}

function field(
  trackTypes: readonly string[],
  path: string,
  loader: () => Promise<unknown>,
  options: Pick<FieldSurfaceContribution, 'group' | 'hideWhenFramed' | 'hiddenRows'> = {},
): FieldSurfaceContribution {
  return { pluginId: PLUGIN_ID, trackTypes, paths: [path], component: loader, ...options }
}

function buildContributions(): FieldSurfaceContribution[] {
  const list: FieldSurfaceContribution[] = []

  // ── AUDIO：13 字段 ──────────────────────────────────────────
  const audioTrack = ['AUDIO']
  list.push(field(audioTrack, 'sound', loadAudioSource, { group: audioGroupOf }))
  for (const path of ['source', 'attenuation', 'position_mode', 'category']) {
    list.push(field(audioTrack, path, loadAudioEnum, { group: audioGroupOf }))
  }
  list.push(field(audioTrack, 'file_loop', loadAudioFileLoop, { group: audioGroupOf }))
  list.push(field(audioTrack, 'fade_in', loadAudioEnvelope, { group: audioGroupOf }))
  list.push(field(audioTrack, 'fade_out', loadAudioEnvelope, { group: audioGroupOf }))
  for (const path of ['volume', 'x', 'y', 'z', 'pitch']) {
    list.push(field(audioTrack, path, loadSlider, {
      group: audioGroupOf,
      hideWhenFramed: path !== 'pitch',
    }))
  }
  list.push({
    pluginId: PLUGIN_ID,
    trackTypes: audioTrack,
    paths: [...AUDIO_PATHS],
    hiddenRows: () => ['fade_out'],
  })

  // ── COLOR：CAMERA 57 / ADJUST 59 ──────────────────────────
  const colorTracks = ['CAMERA', 'ADJUST']
  const colorPaths = COLOR_GROUPS.flatMap((group) => group.paths)
  for (const path of colorPaths) {
    const loader = COLOR_FIELD_LOADERS.get(path) ?? loadSlider
    const framedRule = path.startsWith('mix_') && path !== 'mix_rr'
      ? true
      : path.startsWith('hue_') && path !== 'hue_red'
        ? true
        : (path.startsWith('lift_') || path.startsWith('gamma_') || path.startsWith('gain_')) && !path.endsWith('_r')
          ? true
          : COLOR_ANIMATED_PATHS.has(path) && !COLOR_FIELD_LOADERS.has(path)
    list.push(field(colorTracks, path, loader, {
      group: colorGroupOf,
      hideWhenFramed: framedRule,
    }))
  }
  // 曲线定义的九个非承载行始终隐藏（value-only，不允许有帧）。
  list.push({
    pluginId: PLUGIN_ID,
    trackTypes: colorTracks,
    paths: [...COLOR_CURVES.map((curve) => curve.key)],
    hiddenRows: hiddenCurveRows,
  })
  list.push({
    pluginId: PLUGIN_ID,
    trackTypes: colorTracks,
    paths: [...MATRIX_PATHS],
    hiddenRows: hiddenMatrixRows,
  })
  list.push({
    pluginId: PLUGIN_ID,
    trackTypes: colorTracks,
    paths: HUE_BANDS.flatMap((band) => [band.hue, band.sat]),
    hiddenRows: hiddenBandRows,
  })
  for (const base of ['lift', 'gamma', 'gain'] as const) {
    list.push({
      pluginId: PLUGIN_ID,
      trackTypes: colorTracks,
      paths: [`${base}_r`, `${base}_g`, `${base}_b`],
      hiddenRows: (objects) => hiddenTripleRows(objects, base),
    })
  }

  return list
}

function registerCustomFields(): Array<() => void> {
  const disposers: Array<() => void> = []
  const audio: Array<[string, Component]> = [
    ['sound', AudioSourceField],
    ['source', AudioEnumField],
    ['attenuation', AudioEnumField],
    ['position_mode', AudioEnumField],
    ['category', AudioEnumField],
    ['file_loop', AudioFileLoopField],
    ['fade_in', AudioEnvelopeField],
    ['fade_out', AudioEnvelopeField],
    ['volume', SliderField],
    ['x', SliderField],
    ['y', SliderField],
    ['z', SliderField],
    ['pitch', SliderField],
  ]
  for (const [path, component] of audio) {
    disposers.push(registerCustomField('AUDIO', path, component))
  }

  const color: Array<[string, Component]> = [
    ['mix_rr', ColorMatrixField],
    ['hue_red', ColorBandsField],
    ['rgb_curve', ColorCurvesSummary],
    ['lift_r', ColorTripleField],
    ['gamma_r', ColorTripleField],
    ['gain_r', ColorTripleField],
    ['lut', ColorLutField],
    ['lut_input_gamma', ColorLutGammaField],
    ['lut_strength', ColorLutStrengthField],
    ['blend_mode', ColorEnumField],
    ['curve_strength', ColorCurveStrengthField],
    ['r_curve_strength', ColorCurveStrengthField],
    ['g_curve_strength', ColorCurveStrengthField],
    ['b_curve_strength', ColorCurveStrengthField],
    ['hv_h_strength', ColorCurveStrengthField],
    ['hv_s_strength', ColorCurveStrengthField],
    ['hv_l_strength', ColorCurveStrengthField],
    ['lv_s_strength', ColorCurveStrengthField],
    ['sv_s_strength', ColorCurveStrengthField],
    ['sv_l_strength', ColorCurveStrengthField],
  ]
  for (const track of ['CAMERA', 'ADJUST']) {
    for (const [path, component] of color) {
      disposers.push(registerCustomField(track, path, component))
    }
  }
  return disposers
}

export default function activate(ctx: PluginContext): void {
  const disposers: Array<() => void> = []
  disposers.push(registerFieldSurfaces(PLUGIN_ID, buildContributions()))
  disposers.push(...registerCustomFields())
  disposers.push(registerMetaFieldSurface({
    pluginId: PLUGIN_ID,
    key: 'listener',
    component: () => import('./panels/ScriptListenerField.vue').then((module) => module.default),
  }))
  disposers.push(registerPanelBanner({
    pluginId: PLUGIN_ID,
    trackTypes: ['AUDIO'],
    component: () => import('./panels/AudioBanner.vue').then((module) => module.default),
  }))
  disposers.push(registerPanelBanner({
    pluginId: PLUGIN_ID,
    trackTypes: ['CAMERA', 'ADJUST'],
    component: () => import('./panels/ColorBanner.vue').then((module) => module.default),
  }))
  for (const dispose of disposers) {
    ctx.disposables.add(dispose)
  }
}

export { activate }
