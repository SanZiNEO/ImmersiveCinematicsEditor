/**
 * `core.meta` 插件清单：脚本 meta 面板。
 *
 * 对应剪辑软件的「草稿参数」：选择域为 `none`（点时间轴空白）时显示脚本级字段。
 * 触发器不在本插件里——它有独立面板（`core.behavior`）。
 */
import type { PluginManifest } from '../../workbench/api/contributions.ts'
import activate from './index.ts'

/** 插件 ID。 */
export const META_PLUGIN_ID = 'core.meta'

/** 面板 ID。 */
export const META_PANEL_ID = 'meta.properties'

const coreMeta: PluginManifest = {
  id: META_PLUGIN_ID,
  name: '脚本属性',
  version: '0.1.0',
  apiVersion: '1',
  contributes: {
    panels: [
      {
        panelId: META_PANEL_ID,
        titleKey: '脚本属性',
        component: () => import('./panels/MetaPanel.vue').then((module) => module.default),
        defaultSlot: 'document.right',
        order: 5,
        minWidth: 280,
        maxWidth: 560,
        keepAlive: true,
        closable: false,
        available: (ctx) => ctx.pageId === 'document',
      },
    ],
  },
  activate,
}

export { coreMeta }
export default coreMeta
