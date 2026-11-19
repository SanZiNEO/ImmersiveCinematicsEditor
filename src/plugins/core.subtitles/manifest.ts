/**
 * `core.subtitles` 插件清单（12-15 字幕面板）。
 *
 * 字幕是文档级批次概念：导入草稿、轨道勾选、cue 表、重导入冲突与编译都在本面板，
 * 默认停靠 `document.drawer`，不依赖当前选中片段。
 */
import type { PluginManifest } from '../../workbench/api/contributions.ts'
import activate from './index.ts'

/** 插件 ID（诊断 / 清单共用一份）。 */
export const SUBTITLES_PLUGIN_ID = 'core.subtitles'

/** 面板 ID（布局 / 冻结尺寸表 / 拖拽目标共用）。 */
export const SUBTITLES_PANEL_ID = 'subtitles'

const coreSubtitles: PluginManifest = {
  id: SUBTITLES_PLUGIN_ID,
  name: '字幕',
  version: '0.1.0',
  apiVersion: '1',
  contributes: {
    panels: [
      {
        panelId: SUBTITLES_PANEL_ID,
        titleKey: 'subtitle.panel.title',
        component: () => import('./panels/SubtitlesPanel.vue').then((module) => module.default),
        defaultSlot: 'document.drawer',
        order: 60,
        minWidth: 480,
        minHeight: 280,
        keepAlive: true,
        closable: true,
        available: (ctx) => ctx.pageId === 'document' && ctx.documentOpen,
      },
    ],
  },
  activate,
}

export { coreSubtitles }
export default coreSubtitles
