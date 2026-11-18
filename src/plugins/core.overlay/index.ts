/**
 * `core.overlay` 激活入口（09）。
 *
 * 注册三件事：
 * 1. 行过滤：按层类型矩阵收紧属性 / 效果面板的已知字段（未知键仍由 06 的只读组处理）；
 * 2. 专用字段控件：层类型、基色、渐变、遮罩形状、混合模式、素材、字幕、层级、画幅比；
 * 3. 提交前缀：首次编辑 fade 字段时补写显式 `layer_type: "fade"`。
 *
 * 字段组件用 `defineAsyncComponent` 懒加载，不全部进首屏包。
 */
import { defineAsyncComponent } from 'vue'
import type { PluginContext } from '../../workbench/api/context.ts'
import { CATALOG_SERVICE } from '../../workbench/api/tokens.ts'
import { registerCommitPrefix, registerCustomField } from '../../features/effects/customFields.ts'
import { registerRowFilter } from '../../features/effects/rowFilters.ts'
import { ensureExplicitLayerTypeCommands } from './commit.ts'
import {
  gateLetterboxRows,
  gateOverlayRows,
} from '../../features/overlay/layers.ts'
import { OVERLAY_FIELD_PATHS } from '../../features/overlay/layers.ts'
import { validateAllPresets } from '../../features/overlay/presets.ts'

const LayerTypeField = defineAsyncComponent(() => import('./fields/OverlayLayerTypeField.vue').then((m) => m.default))
const ColorField = defineAsyncComponent(() => import('./fields/OverlayColorField.vue').then((m) => m.default))
const GradientField = defineAsyncComponent(() => import('./fields/OverlayGradientField.vue').then((m) => m.default))
const MaskShapeField = defineAsyncComponent(() => import('./fields/OverlayMaskShapeField.vue').then((m) => m.default))
const BlendModeField = defineAsyncComponent(() => import('./fields/OverlayBlendModeField.vue').then((m) => m.default))
const MediaField = defineAsyncComponent(() => import('./fields/OverlayMediaField.vue').then((m) => m.default))
const SubtitleField = defineAsyncComponent(() => import('./fields/OverlaySubtitleField.vue').then((m) => m.default))
const ZIndexField = defineAsyncComponent(() => import('./fields/OverlayZIndexField.vue').then((m) => m.default))
const LetterboxAspectField = defineAsyncComponent(() => import('./fields/LetterboxAspectField.vue').then((m) => m.default))

/** 注册 OVERLAY 专用字段。 */
function registerOverlayFields(): Array<() => void> {
  return [
    registerCustomField('OVERLAY', 'layer_type', LayerTypeField),
    registerCustomField('OVERLAY', 'color', ColorField),
    registerCustomField('OVERLAY', 'gradient', GradientField),
    registerCustomField('OVERLAY', 'mask_shape', MaskShapeField),
    registerCustomField('OVERLAY', 'blend_mode', BlendModeField),
    registerCustomField('OVERLAY', 'path', MediaField),
    registerCustomField('OVERLAY', 'text', SubtitleField),
    registerCustomField('OVERLAY', 'z_index', ZIndexField),
  ]
}

/** 注册画幅专用字段。 */
function registerLetterboxFields(): () => void {
  return registerCustomField('LETTERBOX', 'aspect_ratio', LetterboxAspectField)
}

/** 注册行过滤。 */
function registerOverlayRowFilters(): () => void {
  return registerRowFilter((rows, context) => {
    if (context.trackType === 'OVERLAY') {
      const result = gateOverlayRows(rows, context.objects, { panel: context.panel })
      return { rows: result.rows, hidden: result.hidden }
    }
    if (context.trackType === 'LETTERBOX') {
      const result = gateLetterboxRows(rows, { panel: context.panel })
      return { rows: result.rows, hidden: result.hidden }
    }
    return { rows: [...rows] }
  })
}

/** 注册首次编辑 fade 字段的 `layer_type` 前缀。 */
function registerLayerTypePrefix(): () => void {
  const fadePaths = new Set(OVERLAY_FIELD_PATHS.fade.filter((path) => path !== 'layer_type'))
  return registerCommitPrefix((context) => {
    if (context.trackType !== 'OVERLAY' || !fadePaths.has(context.path)) {
      return []
    }
    return ensureExplicitLayerTypeCommands(context.clipKey, context.objects, context.path)
  })
}

/** 激活：注册控件 / 过滤 / 前缀，并做预设注册期校验。 */
export default function activate(ctx: PluginContext): void {
  const disposers = [
    ...registerOverlayFields(),
    registerLetterboxFields(),
    registerOverlayRowFilters(),
    registerLayerTypePrefix(),
  ]
  for (const dispose of disposers) {
    ctx.disposables?.add(dispose)
  }

  const catalog = ctx.services.get(CATALOG_SERVICE)
  if (catalog !== undefined) {
    const issues = validateAllPresets(catalog)
    for (const issue of issues) {
      ctx.logger.error(`预设 ${issue.presetId} 注册期校验失败: ${issue.message}`)
    }
  }
}
