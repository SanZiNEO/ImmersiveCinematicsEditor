/**
 * 12-09 几何工具常量：两套坐标系标签、固定预览口径与示意声明。
 *
 * 事实基准（模组只读核对）：
 * - `overlay/CanvasTransform.java`：缺省基准分辨率 1920×1080；
 * - plan 12-09 §三：预览窗口固定 1920×1080、60 帧，编辑器不提供其他预览尺寸 / 帧率入口。
 */

/** 运行时缺省基准分辨率宽（`CanvasTransform.DEFAULT_BASE_WIDTH`）。 */
export const DEFAULT_BASE_WIDTH = 1920
/** 运行时缺省基准分辨率高（`CanvasTransform.DEFAULT_BASE_HEIGHT`）。 */
export const DEFAULT_BASE_HEIGHT = 1080

/** 固定预览视口宽（唯一；界面上不出现其他预览尺寸入口）。 */
export const PREVIEW_VIEW_WIDTH = 1920
/** 固定预览视口高（唯一；界面上不出现其他预览尺寸入口）。 */
export const PREVIEW_VIEW_HEIGHT = 1080
/** 固定预览帧率（唯一；界面上不出现其他帧率入口）。 */
export const PREVIEW_FPS = 60

/** 两套坐标系标签：覆盖层走「裁切像素 × 统一系数 × 作者倍数」；相机走 0–1 归一化。 */
export type GeometrySpace = 'overlay' | 'camera'

/** 坐标系面向作者的说明（面板固定标注当前在算哪一套）。 */
export const GEOMETRY_SPACE_LABELS: Record<GeometrySpace, string> = {
  overlay: '覆盖层坐标系：裁切后素材像素 × 统一系数 × 缩放倍数',
  camera: '相机坐标系：目标与源裁切均为 0–1 归一化，不乘系数、不读基准分辨率',
}

/** 几何示意固定声明（契约 §5：不把编辑器示意当游戏画面）。 */
export const SKETCH_DISCLAIMER = '几何示意，最终以游戏为准'
