/**
 * `core.overlay` 插件清单（09）。
 *
 * 本插件不新建面板：属性面板的 OVERLAY / LETTERBOX 行由 06 的面板渲染，
 * 本插件只注册行过滤、专用字段控件与注册期校验，避免再开一套重复面板。
 */
import type { PluginManifest } from '../../workbench/api/contributions.ts'
import activate from './index.ts'

export const OVERLAY_PLUGIN_ID = 'core.overlay'

const coreOverlay: PluginManifest = {
  id: OVERLAY_PLUGIN_ID,
  name: '覆盖层与画幅',
  version: '0.1.0',
  apiVersion: '1',
  contributes: {},
  activate,
}

export { coreOverlay }
export default coreOverlay
