/**
 * `core.audio` 插件清单（10）。
 *
 * 本轮不新建属性面板：AUDIO / CAMERA / ADJUST 的行仍由 06 属性面板渲染，
 * 本插件注册专用字段面、显示分组、合并行隐藏、面板横幅、meta.listener 卡片，
 * 以及资源 / 调色曲线两个抽屉页签。
 */
import type { PluginManifest } from '../../workbench/api/contributions.ts'
import activate from './index.ts'

export const AUDIO_PLUGIN_ID = 'core.audio'

const coreAudio: PluginManifest = {
  id: AUDIO_PLUGIN_ID,
  name: '音频与调色',
  version: '0.1.0',
  apiVersion: '1',
  contributes: {
    drawerTabs: [
      {
        tabId: 'resources',
        titleKey: 'drawer.resources',
        component: () => import('./drawers/MediaResourcesDrawer.vue').then((module) => module.default),
        order: 40,
        minHeight: 220,
        keepAlive: true,
      },
      {
        tabId: 'color-curves',
        titleKey: 'drawer.colorCurves',
        component: () => import('./drawers/ColorCurvesDrawer.vue').then((module) => module.default),
        order: 45,
        minHeight: 220,
        keepAlive: true,
      },
    ],
    commands: [],
  },
  activate,
}

export { coreAudio }
export default coreAudio
