/**
 * 分隔线预览注入（04-05 / 04-03）。
 *
 * `LayoutRenderer` 监听 `dock-resize-preview` 事件后把临时比例放进这个 ref，
 * 递归节点只读它渲染；临时比例不写布局、不进历史。
 */
import type { InjectionKey, Ref } from 'vue'

export type LayoutPreviewSizes = Readonly<Record<string, readonly number[]>>

export const LAYOUT_PREVIEW_KEY: InjectionKey<Ref<LayoutPreviewSizes>> = Symbol(
  'host.layout.preview',
)
