<script setup lang="ts">
/**
 * 工作台外壳（04-04）。
 *
 * 只做四件事：取当前页交给 PageHost；渲染顶栏/状态区；提供唯一服务注入与焦点作用域；
 * 安装唯一键盘入口（快捷键表 → 命令表）。
 * 不持有尺寸、不读文档字段、不实现业务面板。
 */
import { nextTick, onBeforeUnmount, onMounted, provide, ref, shallowRef } from 'vue'

import type { CommandRegistryPort, FocusServicePort, KeyContext, KeybindingRegistryPort } from '../api/commands.ts'
import type { HostPort } from '../api/host.ts'
import type { ServiceRegistry } from '../api/services.ts'
import {
  COMMAND_SERVICE,
  FILE_DIALOG_PORT,
  HOST_SERVICE,
  KEYBINDING_SERVICE,
  FOCUS_SERVICE,
  I18N_SERVICE,
  PREFERENCES_SERVICE,
} from '../api/tokens.ts'
import { WORKBENCH_SERVICES_KEY } from '../host/panelContext.ts'
import AppStatusBar from './AppStatusBar.vue'
import AppTopBar from './AppTopBar.vue'
import CommandPalette from './CommandPalette.vue'
import PageHost from './PageHost.vue'
import SettingsDialog from './SettingsDialog.vue'
import ShowPanelDialog from './ShowPanelDialog.vue'
import type { ShellActionsPort } from '../api/actions.ts'
import { SHELL_ACTIONS_SERVICE } from '../api/tokens.ts'
import { ONBOARDING_VERSION } from '../api/preferences.ts'
import { registerShellFocusRegions } from './focusRegions.ts'
import {
  PREVIEW_RENDER_STATUS_KEY,
  useCurrentPageId,
  type PreviewRenderStatus,
} from './useWorkbench.ts'
import { bindShellCommandDeps } from '../../plugins/core.workbench/commands.ts'

const props = defineProps<{ services: ServiceRegistry }>()

provide(WORKBENCH_SERVICES_KEY, props.services)
provide(PREVIEW_RENDER_STATUS_KEY, shallowRef<PreviewRenderStatus | null>(null))

const pageId = useCurrentPageId()
let unregisterFocus: (() => void) | null = null

const paletteOpen = ref(false)
const showPanelOpen = ref(false)
const settingsOpen = ref(false)
const settingsSection = ref<string | undefined>(undefined)
const announcement = ref('')

function commands(): CommandRegistryPort {
  return props.services.require(COMMAND_SERVICE)
}

function keybindings(): KeybindingRegistryPort {
  return props.services.require(KEYBINDING_SERVICE)
}

function focus(): FocusServicePort {
  return props.services.require(FOCUS_SERVICE)
}

function actions(): ShellActionsPort {
  return props.services.require(SHELL_ACTIONS_SERVICE)
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
}

function keyContext(editable: boolean): KeyContext {
  return {
    pageId: pageId.value,
    region: focus().currentRegion(),
    editable,
    composing: false,
    dialogOpen: paletteOpen.value || showPanelOpen.value || settingsOpen.value,
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented) {
    return
  }
  const rule = keybindings().resolve(
    {
      key: event.key,
      code: event.code,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      isComposing: event.isComposing,
      keyCode: event.keyCode,
    },
    {
      ...keyContext(isEditable(event.target)),
      composing: event.isComposing,
      editable: isEditable(event.target),
    },
  )
  if (rule === undefined) {
    return
  }
  event.preventDefault()
  void commands()
    .execute({ pageId: pageId.value, services: props.services }, rule.commandId)
    .then((ok) => {
      if (!ok) {
        announcement.value = `命令未执行：${rule.commandId}`
      }
    })
}

onMounted(() => {
  actions().setSettingsHandler?.((sectionId) => {
    settingsSection.value = sectionId
    settingsOpen.value = true
  })

  bindShellCommandDeps({
    notify: (message, severity) => actions().notify(message, severity),
    guard: () => actions().guard(),
    closeDocument: () => actions().closeDocument(),
    openScriptFile: () => actions().openScriptFile(),
    newDocument: () => actions().newDocument(),
    revertDocument: () => actions().revertDocument(),
    openPalette: () => {
      paletteOpen.value = true
    },
    openSettings: (sectionId) => actions().openSettings(sectionId),
    openThemePicker: () => actions().openSettings('appearance'),
    openShowPanel: () => {
      showPanelOpen.value = true
    },
    openShortcutsHelp: () => actions().openSettings('shortcuts'),
    openAbout: () => actions().openSettings('about'),
    backToProject: () => actions().backToProject(),
    openDocumentRename: () => actions().openDocumentRename(),
    confirmPendingBake: async (lines) => {
      const files = props.services.get(FILE_DIALOG_PORT)
      if (files === undefined) {
        // 没有对话框端口时不做选择：返回"取消"，绝不静默丢弃会话缓动。
        return 2
      }
      const i18n = props.services.get(I18N_SERVICE)
      const title = i18n?.t('doc.pendingBakeTitle') ?? '有未烘焙的段缓动'
      const detail = i18n?.t('doc.pendingBakeDetail') ?? '会话缓动不会写进文档。选择如何处理：'
      const buttons = [
        i18n?.t('doc.pendingBakeBake') ?? '烘焙后保存',
        i18n?.t('doc.pendingBakeDiscard') ?? '仅保存节点',
        i18n?.t('common.cancel') ?? '取消',
      ]
      return files.confirm(title, `${detail}\n\n${lines.join('\n')}`, buttons)
    },
  })

  const host: HostPort = props.services.require(HOST_SERVICE)
  host.window.onCloseRequest(() => {
    void (async () => {
      const result = await actions().guard()
      if (result === 'proceed') {
        host.window.confirmClose()
      }
    })()
  })

  window.addEventListener('keydown', onKeydown)
  unregisterFocus = registerShellFocusRegions(focus())

  // 首次启动（或引导版本升级）：自动打开设置弹窗的引导分区。
  // 偏好已在 WorkbenchApp.start() 里加载完成，这里只读快照。
  const onboarding = props.services.require(PREFERENCES_SERVICE).get().settings
  const needsOnboarding =
    (onboarding.onboardingVersion ?? 0) < ONBOARDING_VERSION && onboarding.onboardingDismissed !== true
  if (needsOnboarding) {
    void nextTick(() => {
      settingsSection.value = 'onboarding'
      settingsOpen.value = true
    })
  }
})

onBeforeUnmount(() => {
  actions().setSettingsHandler?.(null)
  window.removeEventListener('keydown', onKeydown)
  unregisterFocus?.()
  unregisterFocus = null
})
</script>

<template>
  <div class="workspace-shell">
    <AppTopBar />
    <PageHost />
    <AppStatusBar />
    <CommandPalette v-if="paletteOpen" :page-id="pageId" @close="paletteOpen = false" />
    <SettingsDialog v-if="settingsOpen" :section-id="settingsSection" @close="settingsOpen = false" />
    <ShowPanelDialog v-if="showPanelOpen" :page-id="pageId" @close="showPanelOpen = false" />
    <p class="sr-only" aria-live="polite" @keydown.esc="announcement = ''">{{ announcement }}</p>
  </div>
</template>

<style scoped>
.workspace-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  min-height: 0;
  background: var(--bg-app);
  color: var(--text);
  overflow: hidden;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  clip-path: inset(50%);
  overflow: hidden;
  white-space: nowrap;
}
</style>
