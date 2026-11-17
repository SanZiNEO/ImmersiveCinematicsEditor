<script setup lang="ts">
/**
 * 抽屉标签内容宿主（04-06）。
 *
 * 与 `PanelHost` 同构：解析 `DrawerTabContribution` → 懒加载 → 上下文 → 错误边界。
 * 区别只在 tab 来自 `DRAWER_TAB_REGISTRY`，以及 keepAlive 语义按 tab 处理。
 */
import {
  computed,
  inject,
  markRaw,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
  type Component,
} from 'vue'
import type { DrawerTabContribution } from '../api/contributions.ts'
import type { DrawerTabRegistry } from '../api/registries.ts'
import type { I18nApi } from '../api/context.ts'
import type { DiagnosticSink } from '../api/diagnostics.ts'
import { DRAWER_TAB_REGISTRY, DIAGNOSTICS_SERVICE, I18N_SERVICE } from '../api/tokens.ts'
import PanelBoundary from '../host/PanelBoundary.vue'
import PanelSlot from '../host/PanelSlot.vue'
import HostError from '../host/HostError.vue'
import MissingPanel from '../host/MissingPanel.vue'
import { usePanelHostSetup } from '../host/usePanelHostSetup.ts'
import { WORKBENCH_SERVICES_KEY } from '../host/panelContext.ts'

const props = defineProps<{
  tabId: string
  pageId: string
  groupId: string
  active: boolean
  /** 抽屉来源节点在插件卸载后仍能定位；注册表命中时以注册表为准。 */
  pluginId: string
}>()

type LoadPhase = 'idle' | 'pending' | 'ready' | 'error'

const services = inject(WORKBENCH_SERVICES_KEY, null)
const registry: DrawerTabRegistry | undefined = services?.get(DRAWER_TAB_REGISTRY)
const i18n: I18nApi | undefined = services?.get(I18N_SERVICE)
const diagnostics: DiagnosticSink | undefined = services?.get(DIAGNOSTICS_SERVICE)

const version = ref(0)
const unsubscribers: Array<() => void> = []
const entry = computed(() => {
  void version.value
  return registry?.get(props.tabId)
})
const contribution = computed<DrawerTabContribution | undefined>(() => entry.value?.contribution)
const pluginId = computed(() => entry.value?.pluginId ?? props.pluginId)

const setup = usePanelHostSetup({
  pageId: props.pageId,
  pluginId: props.pluginId,
  panelId: props.tabId,
})
const { contextError, actions } = setup

const scope = computed(() => `panel:${pluginId.value}:${props.tabId}`)
const keepAlive = computed(() => contribution.value?.keepAlive === true)
const everShown = ref(false)
const phase = ref<LoadPhase>('idle')
const loaded = shallowRef<Component | null>(null)
const loadError = ref('')
let loadToken = 0

const title = computed(() => {
  const current = contribution.value
  if (current === undefined) {
    return i18n?.t('panel.missing') ?? '插件未安装或已禁用'
  }
  return i18n?.t(current.titleKey) ?? current.titleKey
})

const slotState = computed<'loading' | 'error' | 'ready'>(() => {
  if (phase.value === 'ready' && loaded.value !== null) {
    return 'ready'
  }
  return phase.value === 'error' ? 'error' : 'loading'
})

const shouldRender = computed(() => props.active || (keepAlive.value && everShown.value))

const loadMessage = computed(() => i18n?.t('panel.error') ?? '面板加载失败')
const retryLabel = computed(() => i18n?.t('panel.retry') ?? '重试')

async function loadComponent(): Promise<void> {
  const current = contribution.value
  if (current === undefined || contextError.value !== null) {
    return
  }
  if (phase.value === 'pending' || (phase.value === 'ready' && loaded.value !== null)) {
    return
  }
  const token = ++loadToken
  phase.value = 'pending'
  loadError.value = ''
  try {
    const component = await current.component()
    if (token !== loadToken) {
      return
    }
    loaded.value = markRaw(component)
    phase.value = 'ready'
  } catch (error) {
    if (token !== loadToken) {
      return
    }
    phase.value = 'error'
    loadError.value = error instanceof Error ? error.message : String(error)
    diagnostics?.report({
      severity: 'error',
      source: 'panel',
      pluginId: pluginId.value,
      message: `抽屉标签加载失败：${props.tabId}`,
      detail: loadError.value,
    })
  }
}

function retryLoad(): void {
  phase.value = 'idle'
  void loadComponent()
}

watch(
  [() => props.active, () => contribution.value !== undefined],
  ([isActive, hasContribution]) => {
    if (!isActive || !hasContribution) {
      return
    }
    everShown.value = true
    void loadComponent()
  },
  { immediate: true },
)

onMounted(() => {
  if (registry !== undefined) {
    const unsubscribe = registry.subscribe(() => {
      version.value += 1
    })
    unsubscribers.push(unsubscribe)
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
  <div
    v-if="shouldRender"
    v-show="active"
    class="drawer-tab-host"
    :data-focus-scope="scope"
    :aria-label="title"
    role="region"
  >
    <MissingPanel
      v-if="contribution === undefined"
      :plugin-id="pluginId"
      :panel-id="tabId"
      :page-id="pageId"
    />
    <HostError
      v-else-if="contextError !== null"
      :message="`抽屉标签上下文不可用：${title}`"
      :detail="contextError"
      :retryable="false"
    >
      <template #actions>
        <button type="button" class="drawer-tab-host__button" @click="actions?.resetLayout()">
          重置布局
        </button>
      </template>
    </HostError>
    <PanelBoundary
      v-else
      :plugin-id="pluginId"
      :panel-id="tabId"
      :title="title"
      @disable="actions?.removePanel({ pluginId, panelId: tabId })"
    >
      <PanelSlot
        :state="slotState"
        :message="loadMessage"
        :detail="loadError"
        :retry-label="retryLabel"
        @retry="retryLoad"
      >
        <component :is="loaded" v-if="loaded !== null" />
      </PanelSlot>
    </PanelBoundary>
  </div>
</template>

<style scoped>
.drawer-tab-host {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-panel);
}

.drawer-tab-host__button {
  padding: 4px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.drawer-tab-host__button:hover {
  background: var(--bg-hover);
}

.drawer-tab-host__button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}
</style>
