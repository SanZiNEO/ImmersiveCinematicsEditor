/**
 * 几何工具面板视图模型（12-09）：纯函数，吃普通数据，产出面板渲染 / 断言可用的模型。
 *
 * 面板 `.vue` 只做接线：从 `DocumentService` 取只读快照与选区，调本模块函数，
 * 写文档只走 `PanelContext.commands`。自检直接断言本模块与 `features/geometry` 的纯函数，
 * 不靠看界面。
 */
import type { JsonObject, Selection } from '../../core/doc/types.ts'
import { explicitValue } from '../../features/overlay/layers.ts'
import { DEFAULT_ANCHOR, DEFAULT_POSITION, elementRect, normalizeRect } from '../../features/overlay/geometry.ts'
import type { ScriptView } from '../../workbench/api/documents.ts'
import {
  GEOMETRY_SPACE_LABELS,
  PREVIEW_VIEW_HEIGHT,
  PREVIEW_VIEW_WIDTH,
  resolveBaseResolution,
  overlayChain,
  cameraRectToNormalized,
  readCameraComposite,
  regionPlan,
} from '../../features/geometry/index.ts'
import type {
  BaseResolution,
  CameraRectResult,
  CropRect,
  GeometrySpace,
  NormalizedRect,
  OverlayChainResult,
  RegionPlanResult,
  TargetRect,
} from '../../features/geometry/index.ts'

/** 固定预览视口（唯一；面板上不出现其他尺寸 / 帧率入口）。 */
export const PREVIEW = {
  width: PREVIEW_VIEW_WIDTH,
  height: PREVIEW_VIEW_HEIGHT,
} as const

/** 选区在几何工具里的归类。 */
export interface GeometrySelection {
  kind: 'none' | 'single' | 'multi'
  clipKey: string | null
  trackType: string | null
  objects: JsonObject | null
}

function trackTypeOf(view: ScriptView | null, clipKey: string): string | null {
  if (view === null) {
    return null
  }
  for (const track of view.tracks) {
    if (track.clips.some((clip) => clip.clipKey === clipKey)) {
      return track.type
    }
  }
  return null
}

/**
 * 解析当前选区：
 * - 主选区命中单个片段 → `single`；
 * - 批选 ≥2 → `multi`（Gizmo 只显示包围盒）；
 * - 其余 → `none`（文档级视图）。
 */
export function resolveGeometrySelection(
  view: ScriptView | null,
  selection: Selection,
  clipKeys: readonly string[],
  objectsOf: (clipKey: string) => JsonObject | null,
): GeometrySelection {
  if (clipKeys.length > 1) {
    const first = clipKeys[0] ?? null
    return {
      kind: 'multi',
      clipKey: first,
      trackType: first !== null ? trackTypeOf(view, first) : null,
      objects: first !== null ? objectsOf(first) : null,
    }
  }
  const clipKey = selection.domain === 'clip' ? selection.clipKey ?? null : null
  if (clipKey === null) {
    return { kind: 'none', clipKey: null, trackType: null, objects: null }
  }
  return {
    kind: 'single',
    clipKey,
    trackType: trackTypeOf(view, clipKey),
    objects: objectsOf(clipKey),
  }
}

/** 覆盖层检查器输入（素材原始像素由作者填写；未知 = null）。 */
export interface InspectorInput {
  objects: JsonObject
  base: BaseResolution
  sourceWidth: number | null
  sourceHeight: number | null
}

/** 覆盖层检查器模型。 */
export interface InspectorModel {
  chain: OverlayChainResult
  layerType: string | null
  isSubtitle: boolean
  isImageLike: boolean
}

/** 读显式层类型（缺失 = null，不替作者猜）。 */
export function layerTypeOf(objects: JsonObject): string | null {
  const explicit = explicitValue(objects, 'layer_type')
  return explicit.present && typeof explicit.value === 'string' ? explicit.value : null
}

/** 构建覆盖层链路模型（固定预览视口作为播放窗口示意）。 */
export function buildInspector(input: InspectorInput): InspectorModel {
  const objects = input.objects
  const geometry = readOverlayFields(objects)
  const chain = overlayChain({
    playW: PREVIEW.width,
    playH: PREVIEW.height,
    baseW: input.base.width,
    baseH: input.base.height,
    sourceWidth: input.sourceWidth,
    sourceHeight: input.sourceHeight,
    crop: geometry.crop,
    scaleX: geometry.scaleX,
    scaleY: geometry.scaleY,
    x: geometry.x,
    y: geometry.y,
    anchorX: geometry.anchorX,
    anchorY: geometry.anchorY,
  })
  const layerType = layerTypeOf(objects)
  return {
    chain,
    layerType,
    isSubtitle: layerType === 'subtitle',
    isImageLike: layerType === 'image',
  }
}

/** 从 objects 读覆盖层几何字段（缺省与目录 / 运行时一致）。 */
function readOverlayFields(objects: JsonObject): {
  x: number
  y: number
  anchorX: number
  anchorY: number
  scaleX: number
  scaleY: number
  crop: CropRect
} {
  const read = (path: string, fallback: number): number => {
    const explicit = explicitValue(objects, path)
    return explicit.present && typeof explicit.value === 'number' && Number.isFinite(explicit.value)
      ? explicit.value
      : fallback
  }
  return {
    x: read('x', DEFAULT_POSITION),
    y: read('y', DEFAULT_POSITION),
    anchorX: read('anchor_x', DEFAULT_ANCHOR),
    anchorY: read('anchor_y', DEFAULT_ANCHOR),
    scaleX: read('scale_x', 1),
    scaleY: read('scale_y', 1),
    crop: {
      x: read('source.x', 0),
      y: read('source.y', 0),
      w: read('source.w', 1),
      h: read('source.h', 1),
    },
  }
}

/** 构建相机合成矩形模型（归一化；不读基准分辨率 / 系数）。 */
export function buildCameraModel(objects: JsonObject): CameraRectResult {
  return cameraRectToNormalized(readCameraComposite(objects))
}

/** 区域规划输入。 */
export interface PlannerInput {
  target: TargetRect
  inspector: InspectorModel | null
}

/** 构建覆盖层区域规划建议。 */
export function buildPlanner(input: PlannerInput): RegionPlanResult {
  const chain = input.inspector?.chain ?? null
  const sourceAspect = chain !== null && chain.cropped.width !== null && chain.cropped.height !== null
    ? chain.cropped.width / chain.cropped.height
    : null
  return regionPlan({
    target: input.target,
    sourceAspect,
    croppedPixels: chain !== null ? chain.cropped : { width: null, height: null },
    factor: chain !== null ? chain.factor : null,
    playW: PREVIEW.width,
    playH: PREVIEW.height,
    anchorX: chain?.anchor.x ?? DEFAULT_ANCHOR,
    anchorY: chain?.anchor.y ?? DEFAULT_ANCHOR,
  })
}

/** 示意形状（两套坐标系用不同颜色 / 线型，由面板渲染层区分）。 */
export interface SketchShape {
  id: string
  space: GeometrySpace
  kind: 'overlayRect' | 'subtitleBlock' | 'center' | 'anchor' | 'cropBox' | 'cameraDest' | 'cameraSource' | 'multiBox'
  rect: NormalizedRect | null
  point: { x: number; y: number } | null
}

/** 锚点在窗口归一化下的屏幕位置（元素框未知时为 `null`）。 */
export function overlayAnchorPoint(chain: OverlayChainResult, rect: NormalizedRect | null): { x: number; y: number } | null {
  if (rect === null) {
    return null
  }
  return {
    x: rect.x + chain.anchor.x * rect.w,
    y: rect.y + chain.anchor.y * rect.h,
  }
}

/** 覆盖层元素框归一化矩形（素材未知时为 `null`，只画中心 / 锚点示意）。 */
export function overlayElementRect(chain: OverlayChainResult): NormalizedRect | null {
  if (chain.baseSize.width === null || chain.baseSize.height === null) {
    return null
  }
  const rect = elementRect({
    x: chain.center.x,
    y: chain.center.y,
    anchorX: chain.anchor.x,
    anchorY: chain.anchor.y,
    baseWidth: chain.baseSize.width,
    baseHeight: chain.baseSize.height,
    scaleX: chain.finalSize.width !== null ? chain.finalSize.width / chain.baseSize.width : 1,
    scaleY: chain.finalSize.height !== null ? chain.finalSize.height / chain.baseSize.height : 1,
    playWidth: PREVIEW.width,
    playHeight: PREVIEW.height,
  })
  const sketch = normalizeRect(rect, PREVIEW.width, PREVIEW.height)
  return { x: sketch.x, y: sketch.y, w: sketch.width, h: sketch.height }
}

/** 汇总预览示意形状：覆盖层元素 / 中心 / 锚点 / 裁切框 + 相机目标 / 源框 + 多选包围盒。 */
export function buildSketchShapes(options: {
  inspector: InspectorModel | null
  camera: CameraRectResult | null
  crop: CropRect | null
  multiBox: NormalizedRect | null
}): SketchShape[] {
  const shapes: SketchShape[] = []
  const chain = options.inspector?.chain ?? null

  if (chain !== null) {
    const rect = overlayElementRect(chain)
    const isSubtitle = options.inspector?.isSubtitle ?? false
    if (rect !== null) {
      shapes.push({ id: 'overlay-element', space: 'overlay', kind: 'overlayRect', rect, point: null })
      if (isSubtitle) {
        // 字幕文字块为近似示意：不声称等于游戏字体测量出的像素宽高。
        shapes.push({ id: 'subtitle-block', space: 'overlay', kind: 'subtitleBlock', rect, point: null })
      }
    }
    shapes.push({
      id: 'overlay-center',
      space: 'overlay',
      kind: 'center',
      rect: null,
      point: { x: chain.center.x, y: chain.center.y },
    })
    const anchorPoint = overlayAnchorPoint(chain, rect)
    if (anchorPoint !== null) {
      shapes.push({ id: 'overlay-anchor', space: 'overlay', kind: 'anchor', rect: null, point: anchorPoint })
    }
    if (options.crop !== null) {
      shapes.push({
        id: 'overlay-crop',
        space: 'overlay',
        kind: 'cropBox',
        rect: { x: options.crop.x, y: options.crop.y, w: options.crop.w, h: options.crop.h },
        point: null,
      })
    }
  }

  if (options.camera !== null) {
    shapes.push({ id: 'camera-dest', space: 'camera', kind: 'cameraDest', rect: options.camera.dest, point: null })
    shapes.push({ id: 'camera-source', space: 'camera', kind: 'cameraSource', rect: options.camera.source, point: null })
  }

  if (options.multiBox !== null) {
    shapes.push({ id: 'multi-box', space: 'overlay', kind: 'multiBox', rect: options.multiBox, point: null })
  }

  return shapes
}

/** 坐标系说明文案（面板头部固定标注当前在算哪一套）。 */
export function spaceLabel(space: GeometrySpace): string {
  return GEOMETRY_SPACE_LABELS[space]
}

/** 基准分辨率解析（文档 meta；缺省 / 非法回退 1920×1080）。 */
export function resolveDocBaseResolution(meta: JsonObject | null): BaseResolution {
  return resolveBaseResolution(meta === null ? null : { meta })
}
