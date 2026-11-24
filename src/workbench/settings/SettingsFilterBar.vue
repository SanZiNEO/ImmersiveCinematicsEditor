<script setup lang="ts">
/** 设置导航的受控过滤条：搜索、级别开关、已修改开关。 */
import { useI18n } from '../shell/useWorkbench.ts'

defineProps<{
  query: string
  showAdvanced: boolean
  showExperimental: boolean
  experimentalAvailable: boolean
  onlyModified: boolean
  modifiedCount: number
}>()

const emit = defineEmits<{
  'update:query': [value: string]
  'update:showAdvanced': [value: boolean]
  'update:showExperimental': [value: boolean]
  'update:onlyModified': [value: boolean]
}>()

const i18n = useI18n()

function checkboxValue(event: Event): boolean {
  return event.target instanceof HTMLInputElement && event.target.checked
}
</script>

<template>
  <div class="settings-filter" data-settings-filter>
    <div class="settings-filter__search" role="search">
      <input
        :value="query"
        type="search"
        class="settings-filter__input"
        :aria-label="i18n.t('settings.search.label')"
        :placeholder="i18n.t('settings.search.placeholder')"
        @input="emit('update:query', ($event.target as HTMLInputElement).value)"
      />
      <button
        v-if="query.length > 0"
        type="button"
        class="settings-filter__clear"
        :aria-label="i18n.t('settings.search.clear')"
        @click="emit('update:query', '')"
      >
        ✕
      </button>
    </div>

    <div class="settings-filter__toggles">
      <label class="settings-filter__toggle">
        <input
          type="checkbox"
          :checked="showAdvanced"
          @change="emit('update:showAdvanced', checkboxValue($event))"
        />
        <span>{{ i18n.t('settings.filter.showAdvanced') }}</span>
      </label>
      <label v-if="experimentalAvailable" class="settings-filter__toggle">
        <input
          type="checkbox"
          :checked="showExperimental"
          @change="emit('update:showExperimental', checkboxValue($event))"
        />
        <span>{{ i18n.t('settings.filter.showExperimental') }}</span>
      </label>
      <label class="settings-filter__toggle">
        <input
          type="checkbox"
          :checked="onlyModified"
          @change="emit('update:onlyModified', checkboxValue($event))"
        />
        <span>{{ i18n.t('settings.filter.modifiedOnly') }}</span>
        <span v-if="modifiedCount > 0" class="settings-filter__count">{{ modifiedCount }}</span>
      </label>
    </div>
  </div>
</template>

<style scoped>
.settings-filter {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 2px 8px;
  border-bottom: 1px solid var(--border);
}

.settings-filter__search {
  position: relative;
  display: flex;
  align-items: center;
}

.settings-filter__input {
  width: 100%;
  min-width: 0;
  padding: 5px 24px 5px 7px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 12px;
}

.settings-filter__input:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.settings-filter__clear {
  position: absolute;
  right: 4px;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}

.settings-filter__clear:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.settings-filter__clear:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.settings-filter__toggles {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.settings-filter__toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.settings-filter__toggle input:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.settings-filter__count {
  min-width: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--bg-selected);
  color: var(--text);
  text-align: center;
}
</style>
