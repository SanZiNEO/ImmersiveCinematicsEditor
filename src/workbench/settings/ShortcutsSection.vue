<script setup lang="ts">
/**
 * 设置 · 快捷键（04-10）。
 *
 * 列出命令 / 当前 chord / scope；录制覆盖；冲突拒绝并提示；恢复默认。
 * 覆盖只存 `{commandId, chord}`（scope 由命令定义固定）。
 */
import { computed, onScopeDispose, ref } from 'vue'

import type { RegisteredCommand } from '../api/commands.ts'
import { KEY_SCOPE_PRIORITY } from '../api/commands.ts'
import { COMMAND_SERVICE, KEYBINDING_SERVICE, PREFERENCES_SERVICE, STATUS_SERVICE } from '../api/tokens.ts'
import type { CommandRegistryPort, KeybindingRegistryPort } from '../api/commands.ts'
import type { PreferencesApi } from '../api/preferences.ts'
import type { StatusApi } from '../api/context.ts'
import { useI18n, useServices } from '../shell/useWorkbench.ts'

const services = useServices()
const i18n = useI18n()

const recording = ref<string | null>(null)
const tick = ref(0)

function commands(): CommandRegistryPort {
  return services.require(COMMAND_SERVICE)
}

function keybindings(): KeybindingRegistryPort {
  return services.require(KEYBINDING_SERVICE)
}

function preferences(): PreferencesApi {
  return services.require(PREFERENCES_SERVICE)
}

function status(): StatusApi {
  return services.require(STATUS_SERVICE)
}

const unsubscribe = commands().subscribe(() => {
  tick.value += 1
})
onScopeDispose(unsubscribe)

const rows = computed(() => {
  void tick.value
  return commands().list().map((entry: RegisteredCommand) => ({
    commandId: entry.definition.commandId,
    title: i18n.t(entry.definition.titleKey),
    category: entry.definition.category,
    scope: entry.definition.keybindingScope ?? 'global',
    chord: keybindings().chordOf(entry.definition.commandId) ?? '',
    override: preferences().get().shortcuts.find((item) => item.commandId === entry.definition.commandId)?.chord ?? '',
  }))
})

function conflicts(commandId: string, chord: string, scope: string): string | null {
  const normalized = chord.replace(/\s+/g, '')
  for (const rule of keybindings().rules()) {
    if (rule.commandId === commandId) {
      continue
    }
    if (rule.scope !== scope) {
      continue
    }
    if (rule.chord.replace(/\s+/g, '') === normalized) {
      return rule.commandId
    }
  }
  return null
}

function beginRecord(commandId: string): void {
  recording.value = commandId
}

function cancelRecord(): void {
  recording.value = null
}

function capture(chord: string): void {
  const commandId = recording.value
  if (commandId === null) {
    return
  }
  const row = rows.value.find((item) => item.commandId === commandId)
  if (row === undefined) {
    recording.value = null
    return
  }
  const conflict = conflicts(commandId, chord, row.scope)
  if (conflict !== null) {
    status().notify(i18n.t('shortcuts.conflict', { chord, command: conflict }), 'error')
    recording.value = null
    return
  }
  try {
    keybindings().setOverride(commandId, chord)
    const rest = preferences().get().shortcuts.filter((item) => item.commandId !== commandId)
    preferences().setSection('shortcuts', [...rest, { commandId, chord }])
    void preferences().flush()
    status().notify(i18n.t('shortcuts.saved', { chord }))
  } catch (error) {
    status().notify(error instanceof Error ? error.message : String(error), 'error')
  }
  recording.value = null
}

function clearBinding(commandId: string): void {
  keybindings().setOverride(commandId, null)
  preferences().setSection(
    'shortcuts',
    preferences().get().shortcuts.filter((item) => item.commandId !== commandId),
  )
  void preferences().flush()
}

function resetAll(): void {
  keybindings().clearOverrides()
  preferences().resetSection('shortcuts')
  void preferences().flush()
  status().notify(i18n.t('shortcuts.resetDone'))
}

function onRecordKey(event: KeyboardEvent): void {
  if (recording.value === null) {
    return
  }
  event.preventDefault()
  if (event.key === 'Escape') {
    cancelRecord()
    return
  }
  if (event.key === 'Backspace') {
    clearBinding(recording.value)
    recording.value = null
    return
  }
  if (event.key === 'Control' || event.key === 'Shift' || event.key === 'Alt' || event.key === 'Meta') {
    return
  }
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) {
    parts.push('Mod')
  }
  if (event.altKey) {
    parts.push('Alt')
  }
  if (event.shiftKey) {
    parts.push('Shift')
  }
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key
  parts.push(key)
  capture(parts.join('+'))
}

void KEY_SCOPE_PRIORITY
</script>

<template>
  <section class="section" @keydown="onRecordKey">
    <h3>{{ i18n.t('settings.shortcuts') }}</h3>
    <p class="hint">{{ i18n.t('shortcuts.hint') }}</p>
    <table class="table">
      <thead>
        <tr>
          <th>{{ i18n.t('shortcuts.command') }}</th>
          <th>{{ i18n.t('shortcuts.category') }}</th>
          <th>{{ i18n.t('shortcuts.scope') }}</th>
          <th>{{ i18n.t('shortcuts.chord') }}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.commandId">
          <td>{{ row.title }}</td>
          <td class="muted">{{ row.category }}</td>
          <td class="muted">{{ row.scope }}</td>
          <td>
            <span v-if="recording === row.commandId" class="recording">{{ i18n.t('shortcuts.recording') }}</span>
            <span v-else class="chord">{{ row.chord || i18n.t('shortcuts.unbound') }}</span>
            <span v-if="row.override" class="override">{{ i18n.t('shortcuts.overridden') }}</span>
          </td>
          <td class="actions">
            <button type="button" class="link" @click="beginRecord(row.commandId)">{{ i18n.t('shortcuts.record') }}</button>
            <button type="button" class="link danger" @click="clearBinding(row.commandId)">{{ i18n.t('shortcuts.clear') }}</button>
          </td>
        </tr>
      </tbody>
    </table>
    <div class="row">
      <button type="button" class="ghost" @click="resetAll">{{ i18n.t('shortcuts.resetAll') }}</button>
      <button v-if="recording" type="button" class="ghost" @click="cancelRecord">{{ i18n.t('common.cancel') }}</button>
    </div>
  </section>
</template>

<style scoped>
.section { display: flex; flex-direction: column; gap: 10px; color: var(--text); font-size: 12px; }
.section h3 { margin: 0; font-size: 13px; }
.hint { color: var(--text-muted); margin: 0; }
.table { width: 100%; border-collapse: collapse; }
.table th { text-align: left; color: var(--text-muted); font-weight: 500; padding: 4px 8px; border-bottom: 1px solid var(--border); }
.table td { padding: 4px 8px; border-bottom: 1px solid var(--border); }
.muted { color: var(--text-muted); }
.chord { font-family: var(--font-mono, ui-monospace, monospace); }
.recording { color: var(--accent); }
.override { margin-left: 6px; color: var(--warning); font-size: 11px; }
.actions { display: flex; gap: 6px; }
.link { background: transparent; border: 0; color: var(--accent); font-size: 11px; cursor: pointer; }
.link.danger { color: var(--error); }
.row { display: flex; gap: 8px; }
.ghost {
  background: var(--bg-raised);
  color: var(--text);
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  padding: 5px 10px;
  font-size: 12px;
  cursor: pointer;
}
.ghost:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
</style>
