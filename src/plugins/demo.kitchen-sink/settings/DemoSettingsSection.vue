<script setup lang="ts">
/**
 * `demo.settings.section`（04-08 / 04-11）。
 *
 * 设置页里的 demo 分区：显示插件 ID/版本，并提供一个只属于本插件的开关。
 * 开关值走 `preferences.plugins['demo.kitchen-sink']`（插件作用域偏好），
 * 不读整份 `preferences.json`，也不影响文档/布局/主题。
 */
import { DEMO_PLUGIN_ID, DEMO_PLUGIN_VERSION, demoPreferenceReady, demoToggle, setDemoToggle } from '../state.ts'

function onToggle(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) {
    return
  }
  setDemoToggle(target.checked)
}
</script>

<template>
  <section class="demo-settings" aria-label="Demo 插件设置">
    <header class="demo-settings__header">
      <span class="demo-badge">demo</span>
      <h2 class="demo-settings__title">Demo 插件设置</h2>
    </header>

    <dl class="demo-settings__facts">
      <dt>插件 ID</dt>
      <dd>{{ DEMO_PLUGIN_ID }}</dd>
      <dt>版本</dt>
      <dd>{{ DEMO_PLUGIN_VERSION }}</dd>
      <dt>偏好位置</dt>
      <dd>preferences.plugins['{{ DEMO_PLUGIN_ID }}']</dd>
    </dl>

    <label class="demo-settings__toggle">
      <input
        type="checkbox"
        :checked="demoToggle"
        :disabled="!demoPreferenceReady"
        @change="onToggle"
      />
      <span>启用 demo 开关（只属于本插件）</span>
    </label>

    <p class="demo-settings__state" role="status" aria-live="polite">
      当前值：{{ demoToggle ? 'on' : 'off' }}
      <template v-if="demoPreferenceReady">；修改后由偏好服务落盘，重启保留。</template>
      <template v-else>；偏好服务不可用，修改只在本次会话生效。</template>
    </p>
  </section>
</template>

<style scoped>
.demo-settings {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 12px 14px;
  color: var(--text);
  font-size: 12px;
  line-height: 1.5;
}

.demo-settings__header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.demo-badge {
  padding: 1px 6px;
  border: 1px solid var(--warning);
  border-radius: 3px;
  color: var(--warning);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.demo-settings__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.demo-settings__facts {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 3px 12px;
  margin: 0;
  color: var(--text-secondary);
}

.demo-settings__facts dt {
  color: var(--text-muted);
}

.demo-settings__facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.demo-settings__toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-raised);
  cursor: pointer;
}

.demo-settings__toggle input:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.demo-settings__state {
  margin: 0;
  color: var(--text-secondary);
}
</style>
