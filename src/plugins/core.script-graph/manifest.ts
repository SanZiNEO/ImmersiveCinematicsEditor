/**
 * `core.script-graph` manifest（05-13）。
 *
 * 脚本页（`project`）的 `project.main` 唯一主体：无限画布上的脚本前置关系图。
 * 不做启动器、不做轨道/片段编辑；命令在 `activate` 里注册。
 *
 * `titleKey` 用可读中文：本轮没有插件 i18n 资源注册 API，`i18n.t()` 缺失时原样返回，
 * 写点分 key 会把 key 直接显示给用户。
 */
import type { PluginManifest } from '../../workbench/api/contributions.ts'
import activate from './index.ts'
import { GRAPH_PANEL_ID, GRAPH_PLUGIN_ID } from './state.ts'

const scriptGraph: PluginManifest = {
  id: GRAPH_PLUGIN_ID,
  name: '脚本关系图',
  version: '0.1.0',
  apiVersion: '1',
  contributes: {
    panels: [
      {
        panelId: GRAPH_PANEL_ID,
        titleKey: '脚本关系图',
        component: () => import('./GraphPanel.vue').then((module) => module.default),
        defaultSlot: 'project.main',
        order: 10,
        keepAlive: true,
        closable: false,
        singleton: true,
        available: (ctx) => ctx.pageId === 'project',
      },
    ],
    commands: [],
  },
  activate,
}

/** manifest（具名 + 默认导出，builtin 清单两种写法都能用）。 */
export { scriptGraph }
export default scriptGraph
