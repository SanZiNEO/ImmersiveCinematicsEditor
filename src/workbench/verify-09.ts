/**
 * 09 轮自检（真实入口）：`node --experimental-strip-types src/workbench/verify-09.ts`
 *
 * 覆盖：字段面矩阵 / 层切换（只删不加 + 一次撤销）/ 颜色与渐变与遮罩 / 图片几何 /
 * 字幕 @lang / 画幅 / 层级与同轨重叠 / 预设注册与原子应用 / round-trip / 文档与模组状态。
 *
 * 画面观感与真游戏冒烟不在这里伪装通过：那些只能由人进游戏确认，输出里明确标注。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CatalogIndex } from '../core/schema/index.ts'
import { buildCatalog, indexCatalog } from '../core/schema/index.ts'
import { metaKeys } from '../core/doc/keys.ts'
import { parseDoc } from '../core/doc/parse.ts'
import { serializeDoc } from '../core/doc/serialize.ts'
import { DocStore } from '../core/doc/store.ts'
import { isJsonObject } from '../core/doc/json.ts'
import type { DocCommand } from '../core/doc/commands.ts'
import type { JsonObject, JsonValue, ObjectKeyframe } from '../core/doc/types.ts'
import type { DocTransport } from '../core/doc/io.ts'
import type { ValidationTransport } from '../core/doc/validate.ts'
import type { ClipViewEntry, TrackViewEntry } from '../workbench/api/documents.ts'
import { DocumentServiceImpl } from './app/DocumentServiceImpl.ts'
import { DiagnosticsStore } from './kernel/DiagnosticsStore.ts'
import { ServiceRegistryImpl } from './kernel/ServiceRegistryImpl.ts'
import type { PluginContext } from '../workbench/api/context.ts'
import { CATALOG_SERVICE } from '../workbench/api/tokens.ts'

import {
  OVERLAY_FIELD_PATHS,
  declaredLayerType,
  effectiveLayerType,
  gateLetterboxRows,
  gateOverlayRows,
  hiddenOverlayFieldReason,
  isOverlayFieldApplicable,
  planLayerSwitch,
  readGradientStruct,
} from '../features/overlay/layers.ts'
import {
  appendGradientStop,
  baseColorPatch,
  colorHexView,
  gradientValue,
  maskShapePatch,
  normalizeHexColor,
  removeGradientRemovePaths,
  updateGradientStop,
  validateGradientValue,
} from '../features/overlay/colorMask.ts'
import {
  filterMediaFiles,
  mediaKindOfPath,
  mediaPresence,
  parseResourceList,
  validateMediaPathInput,
} from '../features/overlay/media.ts'
import {
  escapeLangLiteral,
  estimateSubtitleLayout,
  isLangReference,
  langKeyOf,
  previewSubtitleText,
  splitSubtitleLines,
  subtitleInvisible,
  validateSubtitleText,
} from '../features/overlay/subtitle.ts'
import {
  checkCrop,
  imageSketch,
  letterboxBars,
  normalizeRect,
  subtitleSketch,
} from '../features/overlay/geometry.ts'
import {
  letterboxPreview,
  validateAspectInput,
} from '../features/overlay/letterbox.ts'
import {
  clipActiveAt,
  collectActiveLayers,
  layerOrderWarnings,
  overlayTrackOverlaps,
  zIndexOf,
} from '../features/overlay/zorder.ts'
import {
  OVERLAY_PRESETS,
  planPresetApplication,
  planPresetCreation,
  presetsFor,
  validateAllPresets,
} from '../features/overlay/presets.ts'
import {
  hasBlockingIssue,
  validateLetterboxObjects,
  validateOverlayObjects,
} from '../features/overlay/validation.ts'
import { propertyRowsFor } from '../features/effects/clipContext.ts'
import { customFieldFor } from '../features/effects/customFields.ts'
import activate from '../plugins/core.overlay/index.ts'
import { ensureExplicitLayerTypeCommands } from '../plugins/core.overlay/commit.ts'
import { check, counts, exitCode, format, notRun } from './verify-kit.ts'

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const MODULE_ROOT_ENV = (process.env.IC_MODULE_ROOT ?? '').trim()
const MODULE_ROOT = MODULE_ROOT_ENV !== '' ? MODULE_ROOT_ENV : join(dirname(REPO_ROOT), 'ImmersiveCinematics')

function near(actual: number, expected: number, epsilon = 1e-9): boolean {
  return Math.abs(actual - expected) <= epsilon
}

function valueOf(objects: JsonObject, path: string): unknown {
  const raw = objects[path]
  return isJsonObject(raw) ? raw.value : undefined
}

function framesOf(objects: JsonObject, path: string): ObjectKeyframe[] {
  const raw = objects[path]
  if (!isJsonObject(raw) || !Array.isArray(raw.keyframes)) return []
  return raw.keyframes as unknown as ObjectKeyframe[]
}

/** 09 夹具：一条 OVERLAY 轨（fade → image 重叠 → subtitle）、一条第二 OVERLAY 轨、两条 LETTERBOX 轨。 */
function fixture(): JsonObject {
  const meta = {
    id: 'verify09',
    name: 'Verify 09',
    author: '',
    play_mode: 'exclusive',
    interruptible: false,
    skippable: false,
    hold_at_end: true,
    priority: 0,
    macro_loop: false,
    macro_loop_count: 0,
    macro_loop_mode: 'restart',
  }
  return {
    meta,
    timeline: {
      tracks: [
        {
          type: 'OVERLAY',
          name: '覆盖层',
          clips: [
            {
              id: 'fade',
              start_time: 0,
              duration: 3,
              objects: {
                layer_type: { value: 'fade' },
                color: { value: '#112233' },
                'color.r': { value: 0.2, keyframes: [{ time: 0, value: 0.2 }, { time: 1, value: 0.8 }] },
                mask_shape: { value: 'rect' },
                mask_x: { value: 0.5 },
                mask_y: { value: 0.5 },
                mask_width: { value: 0.6 },
                mask_height: { value: 0.3 },
                mask_radius: { value: 0.4 },
                gradient: { value: { type: 'linear', stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }] } },
                gradient_angle: { value: 90 },
                gradient_center_x: { value: 0.5 },
                gradient_center_y: { value: 0.5 },
                gradient_radius: { value: 0.5 },
                blend_mode: { value: 'multiply' },
                opacity: { value: 1 },
                z_index: { value: -1 },
              },
            },
            {
              id: 'image',
              start_time: 2.5,
              duration: 2.5,
              objects: {
                layer_type: { value: 'image' },
                path: { value: 'images/test.png' },
                x: { value: 0.5 },
                y: { value: 0.5 },
                anchor_x: { value: 0.5 },
                anchor_y: { value: 0.5 },
                scale_x: { value: 1.5 },
                scale_y: { value: 1.5 },
                'source.x': { value: 0.1 },
                'source.y': { value: 0.1 },
                'source.w': { value: 0.8 },
                'source.h': { value: 0.8 },
                opacity: { value: 0.9 },
                z_index: { value: 10 },
              },
            },
            {
              id: 'subtitle',
              start_time: 5,
              duration: 2,
              objects: {
                layer_type: { value: 'subtitle' },
                text: { value: '@lang:test.hello\n第二行' },
                x: { value: 0.5 },
                y: { value: 0.9 },
                anchor_x: { value: 0.5 },
                anchor_y: { value: 0.5 },
                scale_x: { value: 1 },
                scale_y: { value: 1 },
                font_scale: { value: 1.2 },
                opacity: { value: 1 },
                z_index: { value: 20 },
              },
            },
          ],
        },
        {
          type: 'OVERLAY',
          name: '第二条覆盖层',
          clips: [
            {
              id: 'overlay-b1',
              start_time: 0,
              duration: 4,
              objects: {
                layer_type: { value: 'fade' },
                color: { value: '#000000' },
                mask_shape: { value: 'full' },
                blend_mode: { value: 'normal' },
                opacity: { value: 0.5 },
                z_index: { value: 10 },
              },
            },
            {
              id: 'overlay-b2',
              start_time: 4.5,
              duration: 3,
              objects: {
                layer_type: { value: 'image' },
                path: { value: 'images/other.gif' },
                opacity: { value: 1 },
                z_index: { value: 20 },
              },
            },
          ],
        },
        {
          type: 'LETTERBOX',
          name: '画幅',
          clips: [
            { id: 'lb1', start_time: 0, duration: 8, objects: { aspect_ratio: { value: 2.35 }, opacity: { value: 1 } } },
          ],
        },
        {
          type: 'LETTERBOX',
          name: '第二画幅',
          clips: [
            { id: 'lb2', start_time: 2, duration: 5, objects: { aspect_ratio: { value: 1.85 }, opacity: { value: 0.8 } } },
          ],
        },
      ],
    },
  }
}

interface Opened {
  service: DocumentServiceImpl
  catalog: CatalogIndex
}

async function openFixture(catalog: CatalogIndex): Promise<Opened> {
  const raw = fixture()
  const transport: DocTransport & ValidationTransport = {
    load: async () => ({ path: 'verify09.json', doc: raw }),
    save: async (path) => ({ path }),
    validate: async () => ({ ok: true, issues: [] }),
    pushScript: async () => ({ ok: true }),
    newScript: async () => ({ path: 'new.json', doc: fixture() }),
    seek: async () => undefined,
  }
  const service = new DocumentServiceImpl({
    catalog,
    transport,
    diagnostics: new DiagnosticsStore(),
  })
  const opened = await service.open('verify09.json')
  if (!opened.ok) {
    throw new Error(`fixture 打开失败: ${format(opened)}`)
  }
  return { service, catalog }
}

function trackOf(service: DocumentServiceImpl, type: string, index = 0): TrackViewEntry {
  const view = service.view()
  if (view === null) throw new Error('文档未打开')
  const tracks = view.tracks.filter((track) => track.type === type)
  const track = tracks[index]
  if (track === undefined) throw new Error(`缺少 ${type}#${index} 轨道`)
  return track
}

function clipOf(service: DocumentServiceImpl, type: string, index = 0): ClipViewEntry {
  const track = trackOf(service, type, index)
  const clip = track.clips[0]
  if (clip === undefined) throw new Error(`${type} 轨道没有片段`)
  return clip
}

function rowsFor(service: DocumentServiceImpl, catalog: CatalogIndex, clipKey: string, objects: JsonObject) {
  return propertyRowsFor({ clipKey, trackType: 'OVERLAY', objects, catalog, panel: 'properties' })
}

async function layerSurfaceSection(service: DocumentServiceImpl, catalog: CatalogIndex): Promise<void> {
  const overlayTrack = trackOf(service, 'OVERLAY')
  const fadeKey = overlayTrack.clips[0]?.clipKey ?? ''
  const imageKey = overlayTrack.clips[1]?.clipKey ?? ''
  const subtitleKey = overlayTrack.clips[2]?.clipKey ?? ''
  const fade = service.clipObjects(fadeKey) ?? {}
  const image = service.clipObjects(imageKey) ?? {}
  const subtitle = service.clipObjects(subtitleKey) ?? {}
  check('09-01 三条 OVERLAY 片段键存在', fadeKey !== '' && imageKey !== '' && subtitleKey !== '')
  check('09-01 缺 layer_type 时有效层类型 = fade（本夹具显式 fade 之外的缺失样本）',
    effectiveLayerType({}) === 'fade' && declaredLayerType({}) === null)
  check('09-01 非法 layer_type 的字段面回退 fade，且本地校验拦截',
    effectiveLayerType({ layer_type: { value: 'bogus' } }) === 'fade' &&
    hasBlockingIssue(validateOverlayObjects({ layer_type: { value: 'bogus' } })))
  const firstEditPrefix = ensureExplicitLayerTypeCommands('first-edit', { opacity: { value: 1 } }, 'opacity')
  check('09-01 首次编辑 fade 字段补写显式 layer_type=fade',
    firstEditPrefix.some((command) => command.kind === 'object.setValue' && command.path === 'layer_type' && command.value === 'fade'))
  const zEditPrefix = ensureExplicitLayerTypeCommands('first-edit-z', {}, 'z_index')
  check('09-01 首次编辑 z_index 也补写显式 layer_type=fade',
    zEditPrefix.some((command) => command.kind === 'object.setValue' && command.path === 'layer_type' && command.value === 'fade'))

  for (const path of OVERLAY_FIELD_PATHS.fade) {
    check(`09-01 fade 字段 ${path} 在 schema 中`, catalog.objectDef('OVERLAY', path) !== undefined)
  }
  for (const path of OVERLAY_FIELD_PATHS.image) {
    check(`09-01 image 字段 ${path} 在 schema 中`, catalog.objectDef('OVERLAY', path) !== undefined)
  }
  for (const path of OVERLAY_FIELD_PATHS.subtitle) {
    check(`09-01 subtitle 字段 ${path} 在 schema 中`, catalog.objectDef('OVERLAY', path) !== undefined)
  }

  const fadeRows = rowsFor(service, catalog, fadeKey, fade)
  const fadeGate = gateOverlayRows(fadeRows, fade, { panel: 'properties' })
  const fadePaths = new Set(fadeGate.rows.map((row) => row.path))
  check('09-01 fade：位置 / 锚点 / 缩放零命中',
    !fadePaths.has('x') && !fadePaths.has('y') && !fadePaths.has('anchor_x') && !fadePaths.has('scale_x'))
  check('09-01 fade：path / text / font_scale 零命中',
    !fadePaths.has('path') && !fadePaths.has('text') && !fadePaths.has('font_scale'))
  check('09-01 fade：渐变存在时基色 / 通道收起',
    !fadePaths.has('color') && !fadePaths.has('color.r') && !fadePaths.has('color.g') && !fadePaths.has('color.b'))
  check('09-01 fade：线性渐变不显示 gradient_radius、矩形遮罩不显示 mask_radius',
    !fadePaths.has('gradient_radius') && !fadePaths.has('mask_radius') &&
    fadePaths.has('gradient_angle') && fadePaths.has('mask_width') && fadePaths.has('mask_height'))
  const unknownObjects: JsonObject = {
    ...fade,
    future_key: { value: 'keep-me' },
  }
  const unknownRows = rowsFor(service, catalog, 'unknown-fixture', unknownObjects)
  const unknownGate = gateOverlayRows(unknownRows, unknownObjects, { panel: 'properties' })
  check('09-01 未登记路径以只读行展示、不隐藏',
    unknownGate.rows.some((row) => row.path === 'future_key' && row.unknown && row.mode === 'unknown'))
  const unknownSwitch = planLayerSwitch(unknownObjects, 'image')
  check('09-01 层切换不删除未登记路径',
    unknownSwitch.keep.includes('future_key') && !unknownSwitch.remove.includes('future_key'), unknownSwitch)

  const imageRows = rowsFor(service, catalog, imageKey, image)
  const imageGate = gateOverlayRows(imageRows, image, { panel: 'properties' })
  const imagePaths = new Set(imageGate.rows.map((row) => row.path))
  check('09-01 image：颜色 / 遮罩 / 渐变 / 文本零命中',
    !imagePaths.has('color') && !imagePaths.has('mask_shape') && !imagePaths.has('gradient') &&
    !imagePaths.has('text') && !imagePaths.has('font_scale'))
  check('09-01 image：素材与取材可见',
    imagePaths.has('path') && imagePaths.has('source.x') && imagePaths.has('x') && imagePaths.has('z_index'))

  const subtitleRows = rowsFor(service, catalog, subtitleKey, subtitle)
  const subtitleGate = gateOverlayRows(subtitleRows, subtitle, { panel: 'properties' })
  const subtitlePaths = new Set(subtitleGate.rows.map((row) => row.path))
  check('09-01 subtitle：素材 / 颜色 / 遮罩 / 渐变零命中',
    !subtitlePaths.has('path') && !subtitlePaths.has('color') && !subtitlePaths.has('mask_shape') &&
    !subtitlePaths.has('gradient') && !subtitlePaths.has('source.x'))
  check('09-01 subtitle：文本 / 字号 / 几何可见',
    subtitlePaths.has('text') && subtitlePaths.has('font_scale') && subtitlePaths.has('x') && subtitlePaths.has('y'))

  const fadeEffectRows = gateOverlayRows(fadeRows, fade, { panel: 'effects' }).rows
  check('09-01 value-only 字段在效果面板零命中',
    fadeEffectRows.every((row) => row.mode !== 'value'),
    fadeEffectRows.filter((row) => row.mode === 'value').map((row) => row.path))
}

async function layerSwitchSection(service: DocumentServiceImpl, catalog: CatalogIndex): Promise<void> {
  const overlayTrack = trackOf(service, 'OVERLAY')
  const fadeKey = overlayTrack.clips[0]?.clipKey ?? ''
  const imageKey = overlayTrack.clips[1]?.clipKey ?? ''
  const before = JSON.stringify(service.clipObjects(fadeKey))
  const plan = planLayerSwitch(service.clipObjects(fadeKey) ?? {}, 'image')
  check('09-01 切换 fade→image：保留 opacity / z_index',
    plan.keep.includes('opacity') && plan.keep.includes('z_index'), plan.keep)
  check('09-01 切换 fade→image：移除颜色 / 遮罩 / 渐变 / 混合模式',
    plan.remove.includes('color') && plan.remove.includes('mask_width') &&
    plan.remove.includes('gradient') && plan.remove.includes('blend_mode'), plan.remove)
  const commands: DocCommand[] = []
  if (plan.writeLayerType) {
    commands.push({ kind: 'object.setValue', clipKey: fadeKey, path: 'layer_type', value: 'image' })
  }
  for (const path of plan.remove) {
    commands.push({ kind: 'object.remove', clipKey: fadeKey, path })
  }
  check('09-01 切换命令只写 layer_type + 删除，不补缺省值',
    commands.filter((command) => command.kind === 'object.setValue').length === 1, commands)
  const outcome = service.commitBatch(commands, 'verify-layer-switch')
  check('09-01 切换一次 commitBatch 成功', outcome.ok, outcome)
  const after = service.clipObjects(fadeKey) ?? {}
  check('09-01 切换后 layer_type=image', valueOf(after, 'layer_type') === 'image')
  check('09-01 切换后不适用字段消失',
    !isJsonObject(after.color) && !isJsonObject(after.mask_shape) && !isJsonObject(after.gradient) &&
    !isJsonObject(after.path) && !isJsonObject(after.x))
  check('09-01 切换后新类型字段面不补缺省 path / text',
    !isJsonObject(after.path) && !isJsonObject(after.text))
  check('09-01 切换后 opacity / z_index 保留',
    valueOf(after, 'opacity') === 1 && valueOf(after, 'z_index') === -1)
  const undo = service.undo()
  check('09-01 切换一次撤销完全回退', undo && JSON.stringify(service.clipObjects(fadeKey)) === before,
    service.clipObjects(fadeKey))

  const imageBefore = JSON.stringify(service.clipObjects(imageKey))
  const toSubtitle = planLayerSwitch(service.clipObjects(imageKey) ?? {}, 'subtitle')
  const switchCommands: DocCommand[] = []
  if (toSubtitle.writeLayerType) {
    switchCommands.push({ kind: 'object.setValue', clipKey: imageKey, path: 'layer_type', value: 'subtitle' })
  }
  for (const path of toSubtitle.remove) {
    switchCommands.push({ kind: 'object.remove', clipKey: imageKey, path })
  }
  const second = service.commitBatch(switchCommands, 'verify-layer-switch-2')
  const subtitleAfter = service.clipObjects(imageKey) ?? {}
  check('09-01 image→subtitle：保留几何 / opacity / z_index',
    second.ok && valueOf(subtitleAfter, 'x') === 0.5 && valueOf(subtitleAfter, 'scale_x') === 1.5 &&
    valueOf(subtitleAfter, 'opacity') === 0.9 && valueOf(subtitleAfter, 'z_index') === 10)
  check('09-01 image→subtitle：source / path 删除且不补 text 缺省值',
    !isJsonObject(subtitleAfter['source.x']) && !isJsonObject(subtitleAfter.path) && !isJsonObject(subtitleAfter.text))
  const secondUndo = service.undo()
  check('09-01 第二次切换一次撤销完全回退',
    secondUndo && JSON.stringify(service.clipObjects(imageKey)) === imageBefore)
}

function colorMaskSection(catalog: CatalogIndex): void {
  check('09-02 基色 # 可省 / 大小写归一', normalizeHexColor('AABBCC') === '#aabbcc')
  check('09-02 非法基色被拦截', baseColorPatch('abcd').ok === false && baseColorPatch('#12345g').ok === false)
  const colorView = colorHexView({ color: { value: '#102030' } }, { r: 0.5, g: 0.25, b: 0.75, animated: false })
  check('09-02 无通道帧时 hex 可编辑', colorView.editable === true && colorView.hex.startsWith('#'))
  const frameView = colorHexView({}, { r: 0.5, animated: true })
  check('09-02 有通道帧时 hex 只读并说明', frameView.editable === false && frameView.note !== null)
  const overrideView = colorHexView({}, { r: 0.5, animated: false, overridden: true })
  check('09-02 通道有显式值时 hex 只读并说明', overrideView.editable === false && overrideView.note !== null)

  const goodGradient = { type: 'linear', stops: [{ offset: 0.2, color: '#000000' }, { offset: 0.8, color: '#ffffff' }] }
  check('09-02 渐变 0.2/0.8 合法', validateGradientValue(goodGradient).length === 0)
  check('09-02 渐变少于两项被拦截', validateGradientValue({ type: 'linear', stops: [{ offset: 0, color: '#000000' }] }).length > 0)
  check('09-02 渐变 offset 非递增被拦截',
    validateGradientValue({ type: 'linear', stops: [{ offset: 0, color: '#000000' }, { offset: 0, color: '#ffffff' }] }).length > 0)
  check('09-02 渐变 ARGB / 非法颜色被拦截',
    validateGradientValue({ type: 'linear', stops: [{ offset: 0, color: '#000000ff' }, { offset: 1, color: '#ffffff' }] }).length > 0)
  const appended = appendGradientStop({ type: 'linear', stops: [{ offset: 0.2, color: '#000000' }, { offset: 0.8, color: '#ffffff' }] }, '#ffffff')
  check('09-02 追加色标落在最后一段中间',
    appended.stops.length === 3 && near(appended.stops[1]?.offset ?? -1, 0.5) && appended.stops[1]?.color === '#ffffff')
  const unknownGradient = readGradientStruct({
    gradient: { value: {
      type: 'linear',
      future_root: 'keep',
      stops: [
        { offset: 0, color: '#000000', future_stop: 7 },
        { offset: 1, color: '#ffffff' },
      ],
    } },
  })
  const unknownGradientValue = unknownGradient === null ? null : gradientValue(unknownGradient)
  check('09-02 渐变定义 / 色标的未知键读取后仍保留',
    unknownGradientValue !== null && unknownGradientValue.future_root === 'keep' &&
    Array.isArray(unknownGradientValue.stops) && unknownGradientValue.stops.length > 0 &&
    isJsonObject(unknownGradientValue.stops[0]) && unknownGradientValue.stops[0].future_stop === 7)
  const updatedStop = unknownGradient === null ? null : updateGradientStop(unknownGradient, 0, { offset: 0.1 })
  check('09-02 改色标 offset 不丢该色标的未知键',
    updatedStop !== null && updatedStop.stops[0]?.future_stop === 7 && near(updatedStop.stops[0]?.offset ?? -1, 0.1))

  const full = maskShapePatch('full')
  check('09-02 切到 full：全部遮罩几何删除',
    full.remove.includes('mask_x') && full.remove.includes('mask_width') && full.remove.includes('mask_radius'))
  const rect = maskShapePatch('rect')
  check('09-02 切到 rect：只删半径', rect.remove.includes('mask_radius') && !rect.remove.includes('mask_width'))
  const circle = maskShapePatch('circle')
  check('09-02 切到 circle：只删宽高', circle.remove.includes('mask_width') && circle.remove.includes('mask_height') && !circle.remove.includes('mask_radius'))
  check('09-02 删除整个渐变包含全部几何',
    removeGradientRemovePaths().includes('gradient') && removeGradientRemovePaths().includes('gradient_angle') &&
    removeGradientRemovePaths().includes('gradient_radius'))

  const issues = validateOverlayObjects({ layer_type: { value: 'fade' }, color: { value: '#bad' }, opacity: { value: 2 } })
  check('09-02 校验器拦截非法基色与 opacity 越界', hasBlockingIssue(issues), issues)
  check('09-02 校验器对合法 fade 零阻塞',
    !hasBlockingIssue(validateOverlayObjects({
      layer_type: { value: 'fade' }, color: { value: '#112233' }, mask_shape: { value: 'full' }, blend_mode: { value: 'normal' },
    })))
  check('09-02 catalog 有 overlay 字段定义',
    catalog.objectDef('OVERLAY', 'color') !== undefined && isOverlayFieldApplicable('fade', 'color'))
}

function mediaSection(): void {
  check('09-03 图片扩展名仅 png/gif',
    filterMediaFiles(['a.png', 'b.GIF', 'c.jpg', 'd.mp4'], 'image').join(',') === 'a.png,b.GIF')
  check('09-03 视频扩展名仅 mp4/webm/mkv',
    filterMediaFiles(['a.MP4', 'b.webm', 'c.mkv', 'd.avi'], 'video').join(',') === 'a.MP4,b.webm,c.mkv')
  check('09-04 大写扩展名识别', mediaKindOfPath('VIDEO.MP4') === 'video' && mediaKindOfPath('PHOTO.PNG') === 'image')
  check('09-03 jpg 不属于图片层', mediaKindOfPath('x.jpg') === 'unsupported' && validateMediaPathInput('x.jpg').ok === false)
  check('09-03 空路径合法', validateMediaPathInput('').ok === true && validateMediaPathInput('  ').ok === true)
  check('09-03 不存在路径不误报缺失（列表可用时）', mediaPresence('a.png', ['b.png'], true) === 'missing')
  check('09-03 列表不可用时不判定缺失', mediaPresence('a.png', [], false) === 'unknown')
  const parsed = parseResourceList({ kind: 'image', dir: '', total: 2, truncated: false, files: ['a.png', 'b.gif'] }, 'image')
  check('09-03 resource.list 回执可解析', parsed !== null && parsed.kind === 'image' && parsed.files.length === 2)
}

function subtitleSection(): void {
  check('09-05 split 保留末尾空行', splitSubtitleLines('a\n\n').length === 3 && splitSubtitleLines('a\n\n')[2] === '')
  const layout = estimateSubtitleLayout({ text: 'a\nlonger', fontScale: 2, scaleX: 1, scaleY: 1, screenWidth: 1920, screenHeight: 1080 })
  check('09-05 行数为分割行数、行高为 9', layout.lines.length === 2 && near(layout.lineHeight, 9))
  check('09-05 总高 = 行数 × 9 × fontScale × scaleY', near(layout.displayHeight, 2 * 9 * 2 * 1))
  check('09-05 不自动换行（最长行宽为单行宽度）', layout.maxLineWidth > 0 && layout.lines.join('') === 'alonger')
  check('09-05 非法 key 原样显示', langKeyOf('@lang:bad-key') === null && previewSubtitleText('@lang:bad-key', {}, 'en_us').kind === 'invalid-key')
  check('09-05 @lang 命中当前语言', previewSubtitleText('@lang:test.hello', { zh_cn: { 'test.hello': '你好' } }, 'zh_cn').kind === 'resolved')
  check('09-05 @lang 回退 en_us', previewSubtitleText('@lang:test.hello', { en_us: { 'test.hello': 'Hello' } }, 'zh_cn').kind === 'fallback')
  check('09-05 @lang 未命中回退引用串',
    previewSubtitleText('@lang:test.hello', {}, 'zh_cn').kind === 'missing' &&
    previewSubtitleText('@lang:test.hello', {}, 'zh_cn').text === '@lang:test.hello')
  check('09-05 @@ 转义为字面', isLangReference('@@lang:test.hello') === false &&
    escapeLangLiteral('@lang:test.hello') === '@@lang:test.hello')
  check('09-05 低透明度提示不可见', subtitleInvisible(0).reason !== null && subtitleInvisible(1).reason === null)
  check('09-05 CR 文本被拦截', validateSubtitleText('a\rb').ok === false)
}

function geometrySection(): void {
  const crop = checkCrop({ x: -0.2, y: 0, w: 1.4, h: 1 })
  check('09-03 取材越界被钳制', crop.clamped.x === 0 && crop.clamped.w === 1 && crop.issues.length > 0, crop)
  const negative = checkCrop({ x: 0, y: 0, w: -1, h: 1 })
  check('09-03 负宽高被拦截', negative.issues.length > 0 && negative.clamped.w === 0)
  check('09-03 负宽高不绘制', negative.draws === false && negative.clamped.w === 0)
  check('09-03 有效取材可绘制', checkCrop({ x: 0, y: 0, w: 1, h: 1 }).draws === true)
  check('09-03 normalizeRect 16:9 输出比例', near(normalizeRect({ x: 0, y: 0, width: 1920, height: 1080 }, 1920, 1080).width, 1))
  const baseSketch = imageSketch({}, 320, 180, 1920, 1080)
  const halfBaseSketch = imageSketch({}, 320, 180, 3840, 2160)
  check('09-03 基准分辨率减半时图片元素显示尺寸减半',
    near(baseSketch.element.width, 1) && near(halfBaseSketch.element.width, 0.5),
    { base: baseSketch.element, half: halfBaseSketch.element })
  const oneLine = subtitleSketch({ text: { value: 'A' } }, 320, 180)
  const doubledFont = subtitleSketch({ text: { value: 'A' }, font_scale: { value: 2 } }, 320, 180)
  check('09-05 font_scale 翻倍时字幕块宽度翻倍',
    oneLine.width > 0 && near(doubledFont.width, oneLine.width * 2))

  const wide = letterboxBars(2.35, 16, 9)
  check('09-06 2.35 在 16:9 出上下黑边', wide.orientation === 'horizontal' && wide.top > 0 && wide.bottom > 0, wide)
  const tall = letterboxBars(9 / 16, 16, 9)
  check('09-06 竖屏出左右黑边', tall.orientation === 'vertical' && tall.left > 0 && tall.right > 0, tall)
  const same = letterboxBars(16 / 9, 16, 9)
  check('09-06 同比例无黑边', same.orientation === 'none' && same.top === 0 && same.bottom === 0)
  const zero = letterboxPreview({ aspect_ratio: { value: 0 }, opacity: { value: 1 } })
  check('09-06 aspect=0 不绘制黑边', zero.visible === false && zero.orientation === 'invisible')
  const hidden = letterboxPreview({ aspect_ratio: { value: 2.35 }, opacity: { value: 0 } })
  check('09-06 opacity=0 不绘制黑边', hidden.visible === false)
  check('09-07 画幅预览方向不影响 aspect', near(letterboxPreview({ aspect_ratio: { value: 2.35 }, opacity: { value: 1 } }).aspect, 2.35))
  check('09-06 画幅比输入拒绝负数 / 空', validateAspectInput('-1').ok === false && validateAspectInput('').ok === false)
}

function orderSection(service: DocumentServiceImpl, catalog: CatalogIndex): void {
  const view = service.view()
  if (view === null) throw new Error('文档未打开')
  const readObjects = (key: string) => service.clipObjects(key)
  const entries = collectActiveLayers(view, 2.5, readObjects)
  check('09-07 层级预览不含相机 / 其他轨', entries.every((entry) => entry.trackType === 'OVERLAY' || entry.trackType === 'LETTERBOX'))
  check('09-07 播放头 2.5 活跃层含画幅', entries.some((entry) => entry.source === 'letterbox'))
  check('09-07 层级预览仍可读到 OVERLAY 字段目录', catalog.paths('OVERLAY').length > 0)
  const sorted = entries.every((entry, index) => index === 0 || entries[index - 1]!.drawOrder < entry.drawOrder)
  check('09-07 绘制顺序按下标递增', sorted)
  const negative = entries.some((entry) => entry.zIndex < 0)
  check('09-07 负层级被列出并有提示', negative && layerOrderWarnings(entries).some((warning) => warning.kind === 'negative'))
  const tie = layerOrderWarnings([
    { clipKey: 'tie-a', trackType: 'OVERLAY', trackIndex: 0, clipIndex: 0, label: 'A', layerType: 'fade', zIndex: 10, drawOrder: 0, summary: '', source: 'overlay' },
    { clipKey: 'tie-b', trackType: 'OVERLAY', trackIndex: 1, clipIndex: 1, label: 'B', layerType: 'image', zIndex: 10, drawOrder: 1, summary: '', source: 'overlay' },
  ]).find((warning) => warning.kind === 'tie')
  check('09-07 同层级有 tie 提示且给出顺序来源',
    tie !== undefined && tie.message.includes('加入顺序') && tie.clipKeys.length === 2)
  const multi = layerOrderWarnings(entries).some((warning) => warning.kind === 'multi-letterbox')
  check('09-06 多画幅轨有叠加提示', multi)

  const overlaps = overlayTrackOverlaps(view)
  check('09-07 同轨重叠区间被识别', overlaps.length >= 1 && overlaps[0]!.shadowed.length >= 1, overlaps)
  check('09-07 同轨重叠给出后者不成层文案',
    overlaps.length > 0 && overlaps[0]!.winner.clipKey !== overlaps[0]!.shadowed[0]!.clipKey)
  check('09-07 同轨只取文档顺序第一个活跃片段（后者不成层）',
    entries.every((entry) => {
      const track = view.tracks[entry.trackIndex]
      if (track === undefined) return false
      const firstIndex = track.clips.findIndex((clip) => clipActiveAt(clip, 2.5))
      return firstIndex >= 0 && entry.clipIndex === firstIndex
    }), entries)
  check('09-07 z_index 缺失 / 非法回落 10', zIndexOf({}) === 10 && zIndexOf({ z_index: { value: 1.5 } }) === 10)
  check('09-07 零层级提示独立于其它条目',
    layerOrderWarnings([{ clipKey: 'a', trackType: 'OVERLAY', trackIndex: 0, clipIndex: 0, label: 'A', layerType: 'fade', zIndex: 0, drawOrder: 0, summary: '', source: 'overlay' }])
      .some((warning) => warning.kind === 'zero'))
  check('09-07 非法 layer_type 在层级预览给出提示',
    layerOrderWarnings([{ clipKey: 'bad', trackType: 'OVERLAY', trackIndex: 0, clipIndex: 0, label: 'Bad', layerType: 'fade', declaredLayerType: 'bogus', zIndex: 10, drawOrder: 0, summary: '', source: 'overlay' }])
      .some((warning) => warning.kind === 'invalid-layer-type'))
  const beforePreview = service.serialize()
  collectActiveLayers(service.view(), 2.5, readObjects)
  layerOrderWarnings(entries)
  overlayTrackOverlaps(service.view())
  check('09-07 层级预览不写文档（读数后序列化不变）',
    service.serialize() === beforePreview)
}

function presetSection(catalog: CatalogIndex, service: DocumentServiceImpl): void {
  const issues = validateAllPresets(catalog)
  check('09-08 全部预设注册期校验通过', issues.length === 0, issues)
  check('09-08 预设总数 29（颜色 8 / 图片视频 7 / 字幕 4 / 画幅 5 / 层级 5）',
    OVERLAY_PRESETS.length === 29,
    OVERLAY_PRESETS.map((preset) => preset.id))
  check('09-08 颜色组 8 个', presetsFor('fade', 'OVERLAY', 'fade').length === 8)
  check('09-08 图片视频组 7 个', presetsFor('image', 'OVERLAY', 'image').length === 7)
  check('09-08 字幕组 4 个', presetsFor('subtitle', 'OVERLAY', 'subtitle').length === 4)
  check('09-08 画幅组 5 个', presetsFor('letterbox', 'LETTERBOX').length === 5)
  check('09-08 层级组 5 个', presetsFor('layer', 'OVERLAY').length === 5)
  for (const preset of OVERLAY_PRESETS) {
    for (const field of preset.fields) {
      check(`09-08 预设 ${preset.id} 字段 ${field.path} 在 schema`,
        catalog.objectDef(preset.trackType, field.path) !== undefined)
    }
    for (const group of preset.keyframes ?? []) {
      const def = catalog.objectDef(preset.trackType, group.path)
      check(`09-08 预设 ${preset.id} 关键帧 ${group.path} 可动画`, def?.mode === 'animated')
    }
    const paths = preset.fields.map((field) => field.path)
    const forbidden = ['authoring', 'lane', 'composition', 'track', 'camera', 'transition', 'lut', 'curve']
    check(`09-08 预设 ${preset.id} 不写视图 / 轨道 / 相机 / 调色`, paths.every((path) => !forbidden.includes(path)))
  }

  const imagePresets = presetsFor('image', 'OVERLAY', 'image')
  check('09-08 媒体预设不写 path',
    imagePresets.every((preset) => !preset.fields.some((field) => field.path === 'path')))
  const subtitlePresets = presetsFor('subtitle', 'OVERLAY', 'subtitle')
  check('09-08 字幕预设无颜色 / 字体字段',
    subtitlePresets.every((preset) => preset.fields.every((field) =>
      !['color', 'font', 'font_family', 'text_color'].includes(field.path))))
  const letterboxPresets = presetsFor('letterbox', 'LETTERBOX')
  check('09-08 画幅预设只写 aspect_ratio / opacity',
    letterboxPresets.every((preset) => preset.fields.every((field) =>
      field.path === 'aspect_ratio' || field.path === 'opacity')))

  const overlayTrack = trackOf(service, 'OVERLAY')
  const fadeKey = overlayTrack.clips[0]?.clipKey ?? ''
  const objects = service.clipObjects(fadeKey) ?? {}
  const before = JSON.stringify(objects)
  const circle = OVERLAY_PRESETS.find((preset) => preset.id === 'fade.block.circle')
  if (circle === undefined) throw new Error('缺少圆形色块预设')
  const plan = planPresetApplication({ preset: circle, clipKey: fadeKey, objects, duration: 3, catalog })
  check('09-08 圆形色块应用无 blocker', plan.blockers.length === 0, plan.blockers)
  check('09-08 差异清单含删除 mask_width/mask_height',
    plan.diff.removed.some((item) => item.path === 'mask_width') && plan.diff.removed.some((item) => item.path === 'mask_height'),
    plan.diff)
  check('09-08 差异清单含字段修改 / 新增',
    plan.diff.modified.length + plan.diff.added.length > 0, plan.diff)
  const applyOutcome = service.commitBatch(plan.commands, 'verify-preset')
  check('09-08 预设一次提交成功', applyOutcome.ok, applyOutcome)
  const applied = service.clipObjects(fadeKey) ?? {}
  check('09-08 圆形色块只写半径不写宽高',
    valueOf(applied, 'mask_shape') === 'circle' && near(Number(valueOf(applied, 'mask_radius')), 0.25) &&
    !isJsonObject(applied.mask_width) && !isJsonObject(applied.mask_height))
  const unknownPlan = planPresetApplication({
    preset: circle,
    clipKey: fadeKey,
    objects: { ...applied, future_key: { value: 'keep-me' } },
    duration: 3,
    catalog,
  })
  check('09-08 预设应用不删除未登记路径',
    !unknownPlan.commands.some((command) => command.kind === 'object.remove' && command.path === 'future_key'), unknownPlan.commands)
  const gradientPreset = OVERLAY_PRESETS.find((preset) => preset.id === 'fade.gradient.linear')
  if (gradientPreset === undefined) throw new Error('缺少线性渐变预设')
  const gradientObjects = {
    gradient: { value: {
      type: 'linear',
      future_root: 'keep-preset',
      stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }],
    } },
  }
  const gradientPlan = planPresetApplication({
    preset: gradientPreset,
    clipKey: fadeKey,
    objects: gradientObjects,
    duration: 3,
    catalog,
  })
  const gradientCommand = gradientPlan.commands.find((command) => command.kind === 'object.setValue' && command.path === 'gradient')
  if (gradientCommand === undefined || gradientCommand.kind !== 'object.setValue') throw new Error('渐变预设没有产出 gradient 写入')
  const gradientCommandValue = gradientCommand.value
  check('09-08 应用渐变预设不删除渐变定义里的未知键',
    isJsonObject(gradientCommandValue) && gradientCommandValue.future_root === 'keep-preset',
    gradientCommand)
  const undo = service.undo()
  check('09-08 应用一次撤销完全回退', undo && JSON.stringify(service.clipObjects(fadeKey)) === before)

  const toImage = OVERLAY_PRESETS.find((preset) => preset.id === 'image.center')
  if (toImage === undefined) throw new Error('缺少图片居中预设')
  const switchPlan = planPresetApplication({ preset: toImage, clipKey: fadeKey, objects: service.clipObjects(fadeKey) ?? {}, duration: 3, catalog })
  check('09-08 预设目标层类型不符时先产出层转换',
    switchPlan.diff.layerSwitch !== null && switchPlan.commands.some((command) => command.kind === 'object.remove'),
    switchPlan.diff.layerSwitch)
  check('09-08 预设层转换只写 layer_type，不补新类型缺省 path',
    switchPlan.diff.layerSwitch?.to === 'image' &&
    switchPlan.commands.some((command) => command.kind === 'object.setValue' && command.path === 'layer_type' && command.value === 'image') &&
    !switchPlan.commands.some((command) => command.kind === 'object.setValue' && command.path === 'path'),
    switchPlan.commands)

  const creation = planPresetCreation({
    preset: OVERLAY_PRESETS[0]!,
    trackIndex: 0,
    startTime: 0,
    duration: 3,
    catalog,
  })
  check('09-08 新建预设计划生成命令', creation.commands.length > 0 && creation.blockers.length === 0, creation)
  check('09-08 新建预设不写 path / 轨道字段',
    creation.diff.added.every((item) => item.path !== 'path' && item.path !== 'track'))
}

function pluginSection(catalog: CatalogIndex): void {
  const services = new ServiceRegistryImpl()
  services.provide(CATALOG_SERVICE, catalog)
  const logged: string[] = []
  const ctx = {
    services,
    logger: { error: (message: string) => logged.push(message), warn: () => undefined, info: () => undefined, debug: () => undefined },
  } as unknown as PluginContext
  activate(ctx)
  check('09 插件注册 9 个专用字段控件',
    customFieldFor('OVERLAY', 'layer_type') !== undefined &&
    customFieldFor('OVERLAY', 'color') !== undefined &&
    customFieldFor('OVERLAY', 'gradient') !== undefined &&
    customFieldFor('OVERLAY', 'mask_shape') !== undefined &&
    customFieldFor('OVERLAY', 'blend_mode') !== undefined &&
    customFieldFor('OVERLAY', 'path') !== undefined &&
    customFieldFor('OVERLAY', 'text') !== undefined &&
    customFieldFor('OVERLAY', 'z_index') !== undefined &&
    customFieldFor('LETTERBOX', 'aspect_ratio') !== undefined)
  check('09 插件激活时预设校验无错误日志', logged.length === 0, logged)

  const fadeObjects: JsonObject = {
    layer_type: { value: 'fade' },
    color: { value: '#000000' },
    mask_shape: { value: 'full' },
    blend_mode: { value: 'normal' },
    opacity: { value: 1 },
    z_index: { value: 10 },
  }
  const filtered = propertyRowsFor({ clipKey: 'plugin-filter', trackType: 'OVERLAY', objects: fadeObjects, catalog, panel: 'properties' })
  check('09 插件行过滤在属性面板剔除 fade 不适用字段',
    !filtered.some((row) => row.path === 'x' || row.path === 'path' || row.path === 'text'))
  const effects = propertyRowsFor({ clipKey: 'plugin-filter', trackType: 'OVERLAY', objects: fadeObjects, catalog, panel: 'effects' })
  check('09 插件行过滤在效果面板剔除 value-only 字段',
    effects.every((row) => row.mode !== 'value' && row.mode !== 'unknown'), effects.map((row) => `${row.path}:${row.mode}`))
}

function roundTripSection(service: DocumentServiceImpl): void {
  const serialized = service.serialize()
  const parsed = JSON.parse(serialized) as JsonValue
  const result = parseDoc(parsed, { metaKeys: metaKeys(indexCatalog(buildCatalog('verify-09-rt'))) })
  check('09 保存文本可重新解析', result.ok, result)
  check('09 round-trip 没有界面专属字段写盘',
    !serialized.includes('future_key') && !serialized.includes('authoring') && !serialized.includes('unknown'))
  check('09 round-trip 没有顶层 overlay 字段', !serialized.includes('"overlay"'))
  const raw = parsed as JsonObject
  check('09 只写 meta / timeline 顶层',
    Object.keys(raw).sort().join(',') === 'meta,timeline', Object.keys(raw))

  // 未知键的真实 parse/serialize round-trip：不经过 commitBatch（结构校验会拒绝整篇文档）。
  const withUnknown = JSON.parse(serialized) as JsonObject
  const timeline = withUnknown.timeline
  let injected = false
  if (isJsonObject(timeline) && Array.isArray(timeline.tracks)) {
    for (const track of timeline.tracks) {
      if (!isJsonObject(track) || !Array.isArray(track.clips)) continue
      for (const clip of track.clips) {
        if (!isJsonObject(clip) || !isJsonObject(clip.objects)) continue
        const objects = clip.objects
        if (isJsonObject(objects.layer_type)) {
          objects.future_key = { value: 'round-trip-unknown' }
          injected = true
          break
        }
      }
      if (injected) break
    }
  }
  const reparsed = parseDoc(withUnknown, { metaKeys: metaKeys(indexCatalog(buildCatalog('verify-09-rt-unknown'))) })
  const roundtripUnknown = reparsed.ok
    ? JSON.stringify(serializeDoc(reparsed.doc))
    : ''
  check('09 未知键经真实 parse / serialize round-trip 保留',
    injected && reparsed.ok && roundtripUnknown.includes('"future_key":{"value":"round-trip-unknown"}'))
}

function docsSection(): void {
  const planDir = fileURLToPath(new URL('../../plan/09/', import.meta.url))
  const files = readdirSync(planDir).filter((name) => name.endsWith('.md'))
  check('09 文档数量 10（README + 9 任务）', files.length === 10, files)
  const readme = readFileSync(`${planDir}README.md`, 'utf8')
  const taskDocs = [
    '09-01-overlay-field-surface.md', '09-02-fade-color-mask.md', '09-03-image-layer.md',
    '09-04-video-layer.md', '09-05-subtitle-layer.md', '09-06-letterbox.md',
    '09-07-layer-order-and-tracks.md', '09-08-overlay-presets.md', '09-09-r9-acceptance.md',
  ]
  for (const name of taskDocs) {
    check(`09 README 链接 ${name}`, readme.includes(name))
  }
  for (const name of taskDocs) {
    const text = readFileSync(`${planDir}${name}`, 'utf8')
    const h1 = text.split('\n').filter((line) => line.startsWith('# ')).length
    check(`09 文档 ${name} 恰好一个一级标题`, h1 === 1, h1)
    check(`09 文档 ${name} 有验收要点`, text.includes('### 验收要点'))
  }
}

function messageAndModSection(): void {
  const protocol = readFileSync(fileURLToPath(new URL('./host/webui/protocol.ts', import.meta.url)), 'utf8')
  const resources = readFileSync(fileURLToPath(new URL('./app/ResourceServiceImpl.ts', import.meta.url)), 'utf8')
  check('09 资源列表复用既有 resource.list 消息', resources.includes("'resource.list'"))
  check('09 推送 / 校验 / 定位复用既有消息',
    protocol.includes("editorPushScript: 'editor.pushScript'") && protocol.includes("scriptValidate: 'script.validate'") &&
    protocol.includes("editorSeek: 'editor.seek'"))
  check('09 没有新增 overlay / letterbox 消息',
    !protocol.toLowerCase().includes('overlay.') && !protocol.toLowerCase().includes('letterbox.'))
  const builtin = readFileSync(fileURLToPath(new URL('../plugins/builtin.ts', import.meta.url)), 'utf8')
  check('09 core.overlay 已登记进 builtin 清单', builtin.includes('core.overlay'))

  if (MODULE_ROOT_ENV === '') {
    notRun('09 模组仓库零改动', `未设置 IC_MODULE_ROOT；默认候选 ${MODULE_ROOT} ${existsSync(MODULE_ROOT) ? '存在' : '不存在'}，未显式指定的环境不计入 ok`)
    return
  }
  if (!existsSync(MODULE_ROOT)) {
    notRun('09 模组仓库零改动', `模组仓库目录不存在: ${MODULE_ROOT}`)
    return
  }
  try {
    execFileSync('git', ['--version'], { encoding: 'utf8' })
  } catch (error) {
    notRun('09 模组仓库零改动', `git 不可用: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  let modStatus = ''
  try {
    modStatus = execFileSync('git', ['-C', MODULE_ROOT, 'status', '--porcelain'], { encoding: 'utf8' })
  } catch (error) {
    notRun('09 模组仓库零改动', `git status 失败: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  check('09 模组仓库零改动', modStatus.trim() === '', modStatus)
}

async function main(): Promise<void> {
  const catalog = indexCatalog(buildCatalog('verify-09'))
  const opened = await openFixture(catalog)
  const { service } = opened

  layerSurfaceSection(service, catalog)
  await layerSwitchSection(service, catalog)
  colorMaskSection(catalog)
  mediaSection()
  subtitleSection()
  geometrySection()
  orderSection(service, catalog)
  presetSection(catalog, service)
  pluginSection(catalog)
  roundTripSection(service)
  docsSection()
  messageAndModSection()

  const { ok, fail } = counts()
  console.log(`\n09 自检: ${ok} ok, ${fail} fail`)
  console.log('未自动验收（需人进游戏确认）：真游戏冒烟的五层时序、黑边与渐变观感、拖动 / 缩放手感、编辑器像素预览。')
  process.exitCode = exitCode()
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
