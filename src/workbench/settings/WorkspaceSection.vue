<script setup lang="ts">
/**
 * 设置 · 工作区（04-02 / 04-08）。
 *
 * 布局预设切换、恢复默认、删除用户预设、打开 `userData` 目录。
 * 布局写入只走 `WorkspaceLayoutService`，本组件不碰 `layout.json`。
 */
import { computed, onScopeDispose, ref } from 'vue'

import type { WorkspaceLayoutService } from '../api/layout.ts'
import { LAYOUT_SERVICE, STATUS_SERVICE } from '../api/tokens.ts'
import type { StatusApi } from '../api/context.ts'
import type { PageRouter } from '../api/registries.ts'
import { PAGE_ROUTER } from '../api/tokens.ts'
import { useHost, useI18n, useLayout, useRouter, useServices } from '../shell/useWorkbench.ts'

const services = useServices()
const i18n = useI18n()
const layout = useLayout()
const router = useRouter()
const host = useHost()

const BUILTIN_PRESETS = ['default', 'camera', 'subtitle', 'behavior', 'compact'] as const

const tick = ref(0)
const unsubscribe = layout.subscribe(() => {
  tick.value += 1
})
onScopeDispose(unsubscribe)

const pageId = computed(() => {
  void tick.value
  const current = router.currentPageId
  return current === 'settings' ? 'document' : current
})

const presetId = computed(() => {
  void tick.value
  return layout.getPage(pageId.value).presetId
})

const allPresets = computed(() => {
  void tick.value
  return layout.presets(pageId.value)
})

const userPresets = computed(() => allPresets.value.filter((id) => !(BUILTIN_PRESETS as readonly string[]).includes(id)))

const newPresetName = ref('')

function statusOf(): StatusApi {
  return services.require(STATUS_SERVICE)
}

function layoutService(): WorkspaceLayoutService {
  return services.require(LAYOUT_SERVICE)
}

function routerPort(): PageRouter {
  return services.require(PAGE_ROUTER)
}

function switchTo(id: string): void {
  layoutService().applyPreset(pageId.value, id)
  statusOf().notify(i18n.t('workspace.presetApplied', { id }))
}

function resetLayout(): void {
  layoutService().resetLayout(pageId.value)
  statusOf().notify(i18n.t('workspace.resetDone'))
}

function savePreset(): void {
  const name = newPresetName.value.trim()
  if (name.length === 0) {
    return
  }
  try {
    layoutService().savePreset(pageId.value, name)
    newPresetName.value = ''
    statusOf().notify(i18n.t('workspace.presetSaved', { id: name }))
  } catch (error) {
    statusOf().notify(error instanceof Error ? error.message : String(error), 'error')
  }
}

function deletePreset(id: string): void {
  layoutService().deletePreset(pageId.value, id)
  statusOf().notify(i18n.t('workspace.presetDeleted', { id }))
}

function revealUserData(): void {
  host.storage.revealUserData()
}

void routerPort
</script>

<template>
  <section class="section">
    <h3>{{ i18n.t('settings.workspace') }}</h3>
    <p class="hint">{{ i18n.t('workspace.hint', { page: pageId }) }}</p>

    <h4>{{ i18n.t('workspace.builtinPresets') }}</h4>
    <div class="row wrap">
      <button
        v-for="preset in BUILTIN_PRESETS"
        :key="preset"
        type="button"
        class="ghost"
        :class="{ active: presetId === preset }"
        :aria-pressed="presetId === preset"
        @click="switchTo(preset)"
      >
        {{ preset }}
      </button>
    </div>

    <h4>{{ i18n.t('workspace.userPresets') }}</h4>
    <p v-if="userPresets.length === 0" class="hint">{{ i18n.t('workspace.noUserPresets') }}</p>
    <ul v-else class="preset-list">
      <li v-for="preset in userPresets" :key="preset" class="preset-row">
        <button type="button" class="ghost" :aria-pressed="presetId === preset" @click="switchTo(preset)">{{ preset }}</button>
        <button type="button" class="link danger" @click="deletePreset(preset)">{{ i18n.t('project.remove') }}</button>
      </li>
    </ul>

    <div class="row">
      <input v-model="newPresetName" class="text" type="text" :placeholder="i18n.t('workspace.presetName')" />
      <button type="button" class="ghost" :disabled="newPresetName.trim().length === 0" @click="savePreset">
        {{ i18n.t('workspace.savePreset') }}
      </button>
    </div>

    <div class="row">
      <button type="button" class="ghost" @click="resetLayout">{{ i18n.t('cmd.layout.reset') }}</button>
      <button type="button" class="ghost" @click="revealUserData">{{ i18n.t('workspace.openUserData') }}</button>
    </div>
    <p class="hint">{{ i18n.t('workspace.resetKeepPresets') }}</p>
  </section>
</template>

<style scoped>
.section { display: flex; flex-direction: column; gap: 10px; color: var(--text); font-size: 12px; }
.section h3 { margin: 0; font-size: 13px; }
.section h4 { margin: 10px 0 0; font-size: 12px; color: var(--text-secondary); }
.hint { color: var(--text-muted); margin: 0; }
.row { display: flex; align-items: center; gap: 8px; }
.wrap { flex-wrap: wrap; }
.ghost {
  background: var(--bg-raised);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 5px 10px;
  font-size: 12px;
  cursor: pointer;
}
.ghost.active { border-color: var(--accent); color: var(--accent); }
.ghost:disabled { opacity: 0.5; cursor: default; }
.ghost:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.text {
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-size: 12px;
  padding: 5px 8px;
  min-width: 180px;
}
.preset-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.preset-row { display: flex; align-items: center; gap: 8px; }
.link { background: transparent; border: 0; font-size: 11px; cursor: pointer; color: var(--accent); }
.link.danger { color: var(--error); }
</style>
