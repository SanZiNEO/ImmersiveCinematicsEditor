<script setup lang="ts">
/**
 * 面板宿主（04-05）。
 *
 * 唯一把 `pluginId + panelId` 解析成插件组件的地方：注册表 → 懒加载 → 上下文 → 错误边界。
 * 宿主不读文档 store、不写布局、不缓存属性值；面板只通过 `PanelContext` 取数据。
 */
import {
  computed,
  markRaw,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
  type Component,
} from 'vue'
import type {
  DrawerTabContribution,
  PanelAvailabilityContext,
  PanelContribution,
} from '../api/contributions.ts'
import type { PanelNode } from '../api/layout.ts'
import type { PanelRef } from '../api/ids.ts'
import PanelBoundary from './PanelBoundary.vue'
import PanelSlot from './PanelSlot.vue'
import HostError from './HostError.vue'
import MissingPanel from './MissingPanel.vue'
import { FOCUS_SERVICE } from '../api/tokens.ts'
import { usePanelHostSetup } from './usePanelHostSetup.ts'
import { activePanelOf } from './layoutGeometry.ts'

const props = defineProps<{
  pluginId: string
  panelId: string
  pageId: string
  groupId: string
}>()

type LoadPhase = 'idle' | 'pending' | 'ready' | 'error'

const rootEl = ref<HTMLElement | null>(null)
const panelRef: PanelRef = { pluginId: props.pluginId, panelId: props.panelId }
const scope = `panel:${props.pluginId}:${props.panelId}`

const setup = usePanelHostSetup({
  pageId: props.pageId,
  pluginId: props.pluginId,
  panelId: props.panelId,
})
const { services, registry, drawerTabs, layout, documentService, i18n, diagnostics, contextError, actions } = setup

const version = ref(0)
const unsubscribers: Array<() => void> = []

type ResolvedPanel = PanelContribution | DrawerTabContribution

const contribution = computed<ResolvedPanel | undefined>(() => {
  void version.value
  const panel = registry?.get(props.pluginId, props.panelId)
  if (panel !== undefined) {
    return panel
  }
  const tab = drawerTabs?.get(props.panelId)
  if (tab !== undefined && tab.pluginId === props.pluginId) {
    return tab.contribution
  }
  return undefined
})

const group = computed(() => {
  void version.value
  return layout?.getGroup(props.pageId, props.groupId)
})

const node = computed<PanelNode | undefined>(() => {
  const current = group.value
  if (current === undefined) {
    return undefined
  }
  return current.panels.find(
    (candidate) => candidate.pluginId === props.pluginId && candidate.panelId === props.panelId,
  )
})

const active = computed(() => {
  const current = group.value
  if (current === undefined) {
    return false
  }
  return node.value !== undefined && activePanelOf(current)?.id === node.value.id
})

const keepAlive = computed(() => contribution.value?.keepAlive === true)

const documentOpen = computed(() => {
  void version.value
  const summary = documentService?.summary()
  return summary !== undefined && summary.docId !== null
})

const available = computed(() => {
  const current = contribution.value
  if (current === undefined || current.available === undefined) {
    return true
  }
  const availability: PanelAvailabilityContext = {
    pageId: props.pageId,
    documentOpen: documentOpen.value,
    services: setup.services,
  }
  try {
    return current.available(availability)
  } catch (error) {
    diagnostics?.report({
      severity: 'warning',
      source: 'panel',
      pluginId: props.pluginId,
      message: `面板可用性求值失败：${props.pluginId}:${props.panelId}`,
      detail: error instanceof Error ? error.message : String(error),
    })
    return false
  }
})

const everShown = ref(false)
const loadPhase = ref<LoadPhase>('idle')
const loadedComponent = shallowRef<Component | null>(null)
const loadError = ref('')
let loadToken = 0

const title = computed(() => {
  const current = contribution.value
  if (current === undefined) {
    return i18n?.t('panel.missing') ?? '插件未安装或已禁用'
  }
  return i18n?.t(current.titleKey) ?? current.titleKey
})

const shouldRender = computed(() => {
  if (node.value === undefined) {
    return false
  }
  return active.value || (keepAlive.value && everShown.value)
})

const slotState = computed<'loading' | 'error' | 'ready'>(() => {
  if (loadPhase.value === 'ready' && loadedComponent.value !== null) {
    return 'ready'
  }
  return loadPhase.value === 'error' ? 'error' : 'loading'
})

const loadMessage = computed(() => i18n?.t('panel.error') ?? '面板加载失败')
const retryLabel = computed(() => i18n?.t('panel.retry') ?? '重试')

async function loadComponent(): Promise<void> {
  const current = contribution.value
  if (current === undefined || contextError.value !== null) {
    return
  }
  if (
    loadPhase.value === 'pending' ||
    (loadPhase.value === 'ready' && loadedComponent.value !== null)
  ) {
    return
  }
  const token = ++loadToken
  loadPhase.value = 'pending'
  loadError.value = ''
  try {
    const component = await current.component()
    if (token !== loadToken) {
      return
    }
    loadedComponent.value = markRaw(component)
    loadPhase.value = 'ready'
  } catch (error) {
    if (token !== loadToken) {
      return
    }
    loadPhase.value = 'error'
    loadError.value = error instanceof Error ? error.message : String(error)
    diagnostics?.report({
      severity: 'error',
      source: 'panel',
      pluginId: props.pluginId,
      message: `面板加载失败：${props.pluginId}:${props.panelId}`,
      detail: loadError.value,
    })
  }
}

function retryLoad(): void {
  loadPhase.value = 'idle'
  void loadComponent()
}

function resetLayout(): void {
  actions?.resetLayout()
}

function disablePanel(): void {
  if (actions !== null) {
    actions.disablePanel(panelRef)
    return
  }
  layout?.removePanel(props.pageId, panelRef)
  diagnostics?.report({
    severity: 'warning',
    source: 'panel',
    pluginId: props.pluginId,
    message: `面板已从布局移除：${props.pluginId}:${props.panelId}`,
    detail: '缺少动作端口，降级为直接移除布局节点',
  })
}

watch(
  [active, () => group.value?.visible === true && group.value?.collapsed !== true, () => contribution.value !== undefined],
  ([isActive, groupVisible, hasContribution]) => {
    if (!isActive || !groupVisible || !hasContribution) {
      return
    }
    everShown.value = true
    void loadComponent()
  },
  { immediate: true },
)

onMounted(() => {
  if (layout !== undefined) {
    unsubscribers.push(layout.subscribe(() => {
      version.value += 1
    }))
  }
  if (registry !== undefined) {
    unsubscribers.push(registry.subscribe(() => {
      version.value += 1
    }))
  }
  if (drawerTabs !== undefined) {
    unsubscribers.push(drawerTabs.subscribe(() => {
      version.value += 1
    }))
  }
  if (documentService !== undefined) {
    unsubscribers.push(documentService.subscribe(() => {
      version.value += 1
    }))
  }
  const focus = services?.get(FOCUS_SERVICE)
  if (focus !== undefined) {
    // 每个面板一个焦点作用域（04-10）：F6 只在「可见且已挂载」的区域之间循环。
    unsubscribers.push(focus.registerRegion({
      id: scope,
      order: 50,
      element: () => (rootEl.value !== null && rootEl.value.offsetParent !== null ? rootEl.value : null),
    }))
  }
})

onBeforeUnmount(() => {
  loadToken += 1
  for (const unsubscribe of unsubscribers) {
    unsubscribe()
  }
  unsubscribers.length = 0
})
</script>

<template>
  <section
    ref="rootEl"
    v-if="shouldRender"
    v-show="active"
    class="panel-host"
    :data-focus-scope="scope"
    :aria-label="title"
    role="region"
  >
    <MissingPanel
      v-if="contribution === undefined"
      :plugin-id="pluginId"
      :panel-id="panelId"
      :page-id="pageId"
    />
    <HostError
      v-else-if="contextError !== null"
      :message="`面板上下文不可用：${title}`"
      :detail="contextError"
      :retryable="false"
    >
      <template #actions>
        <button type="button" class="panel-host__button" @click="resetLayout">重置布局</button>
      </template>
    </HostError>
    <HostError
      v-else-if="!available"
      :message="`面板在当前上下文不可用：${title}`"
      detail="面板声明的 available() 返回 false；切换文档或打开对应页面后重试。"
      :retry-label="retryLabel"
      @retry="version += 1"
    >
      <template #actions>
        <button type="button" class="panel-host__button" @click="resetLayout">重置布局</button>
      </template>
    </HostError>
    <PanelBoundary
      v-else
      :plugin-id="pluginId"
      :panel-id="panelId"
      :title="title"
      @disable="disablePanel"
    >
      <PanelSlot
        :state="slotState"
        :message="loadMessage"
        :detail="loadError"
        :retry-label="retryLabel"
        @retry="retryLoad"
      >
        <component :is="loadedComponent" v-if="loadedComponent !== null" />
      </PanelSlot>
    </PanelBoundary>
  </section>
</template>

<style scoped>
.panel-host {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-panel);
}

.panel-host__button {
  padding: 4px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.panel-host__button:hover {
  background: var(--bg-hover);
}

.panel-host__button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}
</style>
