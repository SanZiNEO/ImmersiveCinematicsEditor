/**
 * `core.workbench` manifest（04-11）。
 *
 * 内置插件，不是业务插件：贡献三页、预览面板、诊断抽屉、shell 命令、状态项、六个设置分区。
 * 不注册 `clip.effects` / `selection.properties` 的真实业务内容（05/06 提供），
 * 也不 import 时间轴 / 效果控件 / 图 / 字幕 / 触发器组件。
 *
 * 内置三主题由主题层的 `ThemeRegistry` 作为「builtin 来源」注册（04-07 来源 1），
 * 这里不重复声明同 ID，避免重复注册。
 */
import type { PluginManifest } from '../../workbench/api/contributions.ts'
import { CORE_STATUS_ITEMS } from './statusItems.ts'
import { registerCoreCommands } from './commands.ts'

/** 内置插件 ID。 */
export const CORE_WORKBENCH_ID = 'core.workbench'

/** 七个核心设置分区（03 追加 updates，order 55）。 */
export const CORE_SETTINGS_SECTIONS = [
  { sectionId: 'appearance', titleKey: 'settings.appearance', order: 10, component: () => import('../../workbench/settings/AppearanceSection.vue').then((module) => module.default) },
  { sectionId: 'workspace', titleKey: 'settings.workspace', order: 20, component: () => import('../../workbench/settings/WorkspaceSection.vue').then((module) => module.default) },
  { sectionId: 'shortcuts', titleKey: 'settings.shortcuts', order: 30, component: () => import('../../workbench/settings/ShortcutsSection.vue').then((module) => module.default) },
  { sectionId: 'language', titleKey: 'settings.language', order: 40, component: () => import('../../workbench/settings/LanguageSection.vue').then((module) => module.default) },
  { sectionId: 'about', titleKey: 'settings.about', order: 50, component: () => import('../../workbench/settings/AboutSection.vue').then((module) => module.default) },
  { sectionId: 'updates', titleKey: 'settings.updates', order: 55, component: () => import('../../workbench/settings/UpdateSection.vue').then((module) => module.default) },
  { sectionId: 'advanced', titleKey: 'settings.advanced', order: 60, component: () => import('../../workbench/settings/AdvancedSection.vue').then((module) => module.default) },
]

/** core.workbench manifest。 */
const coreWorkbench: PluginManifest = {
  id: CORE_WORKBENCH_ID,
  name: '工作台内核',
  version: '0.1.0',
  apiVersion: '1',
  contributes: {
    pages: [
      {
        pageId: 'project',
        route: 'project',
        titleKey: 'nav.project',
        order: 10,
        component: () => import('../../workbench/shell/ProjectPage.vue').then((module) => module.default),
      },
      {
        pageId: 'document',
        route: 'document',
        titleKey: 'nav.document',
        order: 20,
        component: () => import('../../workbench/shell/DocumentPage.vue').then((module) => module.default),
      },
      {
        pageId: 'settings',
        route: 'settings',
        titleKey: 'nav.settings',
        order: 30,
        component: () => import('../../workbench/shell/SettingsPage.vue').then((module) => module.default),
      },
    ],
    panels: [
      {
        panelId: 'workbench.preview',
        titleKey: 'panel.preview',
        component: () => import('../../workbench/shell/PreviewPanel.vue').then((module) => module.default),
        defaultSlot: 'document.center',
        order: 10,
        minWidth: 320,
        keepAlive: true,
        closable: false,
        singleton: true,
      },
    ],
    drawerTabs: [
      {
        tabId: 'diagnostics',
        titleKey: 'drawer.diagnostics',
        component: () => import('../../workbench/drawer/DiagnosticsPanel.vue').then((module) => module.default),
        order: 50,
        minHeight: 160,
        keepAlive: true,
      },
    ],
    statusItems: CORE_STATUS_ITEMS,
    settings: CORE_SETTINGS_SECTIONS,
    commands: [],
  },
  activate: (ctx) => {
    registerCoreCommands(ctx)
  },
}

export { coreWorkbench }
export default coreWorkbench
