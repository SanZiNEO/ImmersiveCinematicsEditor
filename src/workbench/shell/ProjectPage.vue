<script setup lang="ts">
/**
 * 脚本页（05-02）：project.main 的关系图 + 页面工具条。
 *
 * 05 收敛了 04 的启动器主体：最近项目/打开入口保留在页面顶条，主体交给 `script.graph`
 * 面板；这里不扫描磁盘、不造项目统计。
 */
import DockSurface from '../dock/DockSurface.vue'
import type { ShellActionsPort } from '../api/actions.ts'
import { SHELL_ACTIONS_SERVICE } from '../api/tokens.ts'
import { useDocumentSummary, useI18n, useServices } from './useWorkbench.ts'

const services = useServices()
const i18n = useI18n()
const summary = useDocumentSummary()

function actions(): ShellActionsPort {
  return services.require(SHELL_ACTIONS_SERVICE)
}
</script>

<template>
  <section class="project-page">
    <header class="project-toolbar">
      <div class="project-actions">
        <button type="button" class="primary" @click="actions().newDocument()">
          {{ i18n.t('project.newScript') }}
        </button>
        <button type="button" class="ghost" @click="actions().openScriptFile()">
          {{ i18n.t('project.openScript') }}
        </button>
        <button type="button" class="ghost" @click="actions().openFolder()">
          {{ i18n.t('project.openFolder') }}
        </button>
      </div>
      <span class="connection" :class="{ online: summary.connected }" role="status">
        {{ summary.connected ? i18n.t('status.connected') : i18n.t('status.offline') }}
      </span>
    </header>
    <DockSurface page-id="project" />
  </section>
</template>

<style scoped>
.project-page {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  background: var(--bg-app);
  color: var(--text);
}
.project-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}
.project-actions { display: flex; align-items: center; gap: 8px; }
.primary, .ghost {
  border-radius: 4px;
  font-size: 12px;
  padding: 6px 12px;
  cursor: pointer;
}
.primary { background: var(--accent); color: var(--bg-app); border: 1px solid var(--accent); }
.ghost { background: var(--bg-raised); color: var(--text); border: 1px solid var(--border-strong); }
.primary:focus-visible, .ghost:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.connection {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-muted);
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
}
.connection.online { color: var(--success); border-color: var(--success); }
</style>
