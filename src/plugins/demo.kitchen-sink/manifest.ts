/**
 * `demo.kitchen-sink` manifest（04-11）。
 *
 * 七类贡献各至少一个，ID 固定；面板只提供宿主合同演示，不冒充 05+ 的业务面板，
 * 每个面板/抽屉/设置分区都在界面上显式标 `demo`。
 *
 * `titleKey` 是可读文本：本轮没有插件 i18n 资源注册 API，`i18n.t()` 缺失时原样返回，
 * 因此这里不写点分 key，避免把 key 显示给用户。
 */
import type { PluginManifest } from '../../workbench/api/contributions.ts'
import { DEMO_COMMANDS } from './commands.ts'
import activate from './index.ts'
import { DEMO_PLUGIN_ID, DEMO_PLUGIN_VERSION, pingCount } from './state.ts'
import { THEME_FILES } from './themes/index.ts'

const demoKitchenSink: PluginManifest = {
  id: DEMO_PLUGIN_ID,
  name: 'Demo 厨房水槽',
  version: DEMO_PLUGIN_VERSION,
  apiVersion: '1',
  contributes: {
    pages: [
      {
        pageId: 'demo.sandbox',
        route: 'sandbox',
        titleKey: 'Demo · 沙盒页',
        order: 40,
        component: () => import('./pages/SandboxPage.vue').then((module) => module.default),
      },
    ],
    panels: [
      {
        panelId: 'demo.panel.effects',
        titleKey: 'Demo · 效果槽',
        component: () => import('./panels/DemoEffectsPanel.vue').then((module) => module.default),
        defaultSlot: 'document.left',
        order: 10,
        minWidth: 420,
        keepAlive: true,
      },
      {
        panelId: 'demo.panel.properties',
        titleKey: 'Demo · 属性槽',
        component: () => import('./panels/DemoPropertiesPanel.vue').then((module) => module.default),
        defaultSlot: 'document.right',
        order: 10,
        minWidth: 280,
        maxWidth: 560,
      },
      {
        panelId: 'demo.panel.bottom',
        titleKey: 'Demo · 底部槽',
        component: () => import('./panels/DemoBottomPanel.vue').then((module) => module.default),
        defaultSlot: 'document.bottom',
        order: 10,
        minHeight: 120,
      },
    ],
    drawerTabs: [
      {
        tabId: 'demo.drawer.notes',
        titleKey: 'Demo · 备注',
        component: () => import('./drawers/NotesTab.vue').then((module) => module.default),
        order: 60,
        minHeight: 120,
        keepAlive: true,
      },
      {
        tabId: 'demo.drawer.log',
        titleKey: 'Demo · 日志',
        component: () => import('./drawers/LogTab.vue').then((module) => module.default),
        order: 70,
        minHeight: 120,
      },
    ],
    commands: DEMO_COMMANDS,
    statusItems: [
      {
        itemId: 'demo.status.plugin',
        align: 'right',
        order: 90,
        text: () => `ping: ${pingCount.value}`,
        commandId: 'demo.command.ping',
        severity: () => 'normal',
      },
    ],
    settings: [
      {
        sectionId: 'demo.settings.section',
        titleKey: 'Demo · 插件设置',
        order: 70,
        component: () => import('./settings/DemoSettingsSection.vue').then((module) => module.default),
      },
    ],
    themes: THEME_FILES.map((file) => ({
      themeId: file.definition.id,
      labelKey: file.definition.label,
      appearance: file.definition.appearance,
      path: file.path,
      preview: file.preview,
    })),
  },
  activate,
}

/** manifest（具名 + 默认导出，builtin 清单两种写法都能用）。 */
export { demoKitchenSink }
export default demoKitchenSink
