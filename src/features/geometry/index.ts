/**
 * 12-09 几何工具公开门面。
 *
 * 两套坐标系严格分离：
 * - 覆盖层链路（`overlayChain` / `regionPlan` / Gizmo）：裁切像素 × 统一系数 × 作者倍数；
 * - 相机链路（`cameraRectToNormalized`）：0–1 归一化，不乘系数、不读基准分辨率。
 */
export {
  DEFAULT_BASE_WIDTH,
  DEFAULT_BASE_HEIGHT,
  PREVIEW_VIEW_WIDTH,
  PREVIEW_VIEW_HEIGHT,
  PREVIEW_FPS,
  GEOMETRY_SPACE_LABELS,
  SKETCH_DISCLAIMER,
} from './constants.ts'
export type { GeometrySpace } from './constants.ts'

export {
  BASE_RESOLUTION_KEY,
  resolveBaseResolution,
  validateBaseResolutionInput,
  baseResolutionCommands,
} from './baseResolution.ts'
export type { BaseResolution, BaseResolutionInput, BaseResolutionValidation } from './baseResolution.ts'

export {
  overlayScaleFactor,
  overlayChain,
  clampCrop,
} from './overlayChain.ts'
export type { CropRect, PixelPair, OverlayChainInput, OverlayChainResult } from './overlayChain.ts'

export {
  cameraRectToNormalized,
  readCameraComposite,
  normalizedRectOf,
} from './cameraRect.ts'
export type { NormalizedRect, CameraRectInput, CameraRectResult } from './cameraRect.ts'

export {
  regionPlan,
  scaleIssues,
  stretchWarning,
  PLANNER_DEFAULT_SCALE,
} from './planner.ts'
export type { TargetRect, RegionPlanInput, RegionPlanResult } from './planner.ts'

export {
  GIZMO_HANDLES,
  GIZMO_ROTATION_HANDLES,
  readGizmoGeometry,
  planGizmoDrag,
  gizmoCommands,
  boundingBox,
} from './gizmo.ts'
export type {
  GizmoHandle,
  GizmoGeometry,
  GizmoViewport,
  GizmoDragInput,
  GizmoDraft,
} from './gizmo.ts'
