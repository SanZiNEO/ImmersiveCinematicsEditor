<script setup lang="ts">
/**
 * 脚本关系图面板（05-02 / 05-13）。
 *
 * 唯一入口：工具栏 + 无限画布 + 诊断浮层 + 两个对话框。
 * 数据全部经 `PanelContext.services` 取端口服务，状态由 `GraphController` 持有；
 * 不 import 文档 store / 宿主，也不在面板里实现第二套图逻辑。
 */
import { computed, onBeforeUnmount, onMounted, provide, ref } from 'vue'
import { usePanelContext } from '../../workbench/host/panelContext.ts'
import DependencyEditor from './DependencyEditor.vue'
import DiagnosticsList from './DiagnosticsList.vue'
import GraphCanvas from './GraphCanvas.vue'
import GraphToolbar from './GraphToolbar.vue'
import RenameIdDialog from './RenameIdDialog.vue'
import { invalidationLabel } from './labels.ts'
import { GRAPH_CONTROLLER_KEY, graphController } from './state.ts'

const ctx = usePanelContext()
const controller = graphController()
const state = controller.state
provide(GRAPH_CONTROLLER_KEY, controller)

const rootEl = ref<HTMLElement | null>(null)

const stats = computed(() => controller.graph.value?.stats ?? null)
const hasGraph = computed(() => controller.graph.value !== null)
const showErrorBanner = computed(() => state.error !== null && hasGraph.value)
const showStaleBanner = computed(() =>
  state.stale && state.connected && hasGraph.value && state.error === null)
const showDisconnectedBanner = computed(() => !state.connected)

const editorNode = computed(() => {
  const target = state.editor
  if (target === null) {
    return null
  }
  return controller.graph.value?.nodes.find((node) => node.path === target.path) ?? null
})

const renameNode = computed(() => {
  const path = state.renamePath
  if (path === null) {
    return null
  }
  return controller.graph.value?.nodes.find((node) => node.path === path) ?? null
})

const hasBanners = computed(() =>
  state.layoutWarning !== null
  || (stats.value?.truncated === true)
  || showErrorBanner.value
  || showStaleBanner.value
  || showDisconnectedBanner.value)

function retry(): void {
  void controller.refresh()
}

function onEditorSaved(path: string): void {
  void controller.handleEditorSaved(path)
}

function onRenameSaved(): void {
  void controller.handleRenameSaved()
}

function confirmReset(): void {
  controller.resetLayout()
}

function cancelReset(): void {
  controller.cancelReset()
}

onMounted(() => {
  controller.setPanelElement(rootEl.value)
  controller.mount({
    services: ctx.services,
    status: ctx.status,
    i18n: ctx.i18n,
    pageId: ctx.pageId,
  })
})

onBeforeUnmount(() => {
  controller.setPanelElement(null)
  controller.unmount()
})
</script>

<template>
  <section
    ref="rootEl"
    class="script-graph-panel"
    role="region"
    aria-label="脚本关系图"
  >
    <GraphToolbar />

    <div v-if="state.refreshing" class="graph-progress" role="progressbar" aria-label="正在刷新脚本关系图" />

    <div v-if="hasBanners" class="graph-banners">
      <p v-if="!state.connected" class="banner banner--warn" role="status">
        工作区不可用：请先选择游戏目录（immersive_cinematics）。
        <span v-if="state.stale">当前图已过期。</span>
      </p>
      <p v-if="showErrorBanner" class="banner banner--error" role="alert">
        {{ state.error }}（保留上一次成功的图）
        <button type="button" class="banner-action" :disabled="state.refreshing" @click="retry">重试</button>
      </p>
      <p v-else-if="showStaleBanner" class="banner banner--warn" role="status">
        图已过期：{{ invalidationLabel(state.lastInvalidation) }}，将自动刷新。
        <button type="button" class="banner-action" :disabled="state.refreshing" @click="retry">立即刷新</button>
      </p>
      <p v-if="stats?.truncated === true" class="banner banner--warn" role="status">
        脚本过多，已截断显示 {{ controller.graph.value?.nodes.length ?? 0 }} 个节点 / {{ controller.graph.value?.edges.length ?? 0 }} 条边
        （真实 {{ stats.nodeCount }} 脚本 / {{ stats.edgeCount }} 前置）。统计与诊断仍按真实计数。
      </p>
      <p v-if="state.layoutWarning !== null" class="banner banner--info" role="status">
        {{ state.layoutWarning }}
      </p>
    </div>

    <GraphCanvas />

    <DiagnosticsList
      v-if="state.diagnosticsOpen"
      @close="controller.closeDiagnostics()"
    />

    <DependencyEditor
      v-if="state.editor !== null && editorNode !== null"
      :key="`deps:${state.editor.path}`"
      :node="editorNode"
      :trigger-identity="state.editor.triggerIdentity"
      :requirement-index="state.editor.requirementIndex"
      :intent="state.editor.intent"
      @close="controller.closeEditor()"
      @saved="onEditorSaved"
    />

    <RenameIdDialog
      v-if="state.renamePath !== null && renameNode !== null"
      :key="`rename:${state.renamePath}`"
      :node="renameNode"
      @close="controller.closeRename()"
      @saved="onRenameSaved"
    />

    <div v-if="state.confirmReset" class="confirm-backdrop" @pointerdown.self="cancelReset">
      <section class="confirm-box" role="dialog" aria-modal="true" aria-labelledby="graph-reset-title">
        <h2 id="graph-reset-title" class="confirm-title">重置图布局</h2>
        <p class="confirm-text">清空手摆的节点坐标与折叠分组，保留当前缩放与平移。脚本文件不会被修改。</p>
        <div class="confirm-actions">
          <button type="button" class="confirm-button" @click="cancelReset">取消</button>
          <button type="button" class="confirm-button confirm-button--danger" @click="confirmReset">重置布局</button>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.script-graph-panel {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-app);
  color: var(--text);
  /* 上下游高亮色（主题只提供基础 token）：不写死颜色，映射到主题色。 */
  --c1: var(--accent);
  --c2: var(--success);
}
.graph-progress {
  flex: 0 0 auto;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  background-size: 40% 100%;
  background-repeat: no-repeat;
  animation: graph-progress-run 1s linear infinite;
}
@keyframes graph-progress-run {
  from { background-position: -40% 0; }
  to { background-position: 140% 0; }
}
.graph-banners {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}
.banner {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 3px 6px;
  border-radius: 3px;
  font-size: 11px;
}
.banner--error { color: var(--error); background: var(--error-bg); }
.banner--warn { color: var(--warning); }
.banner--info { color: var(--text-secondary); }
.banner-action {
  padding: 1px 6px;
  border: 1px solid currentColor;
  border-radius: 3px;
  background: transparent;
  color: inherit;
  font-size: 10.5px;
  cursor: pointer;
}
.banner-action:disabled { opacity: 0.5; cursor: default; }
.banner-action:focus-visible, .confirm-button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}
.confirm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--overlay);
}
.confirm-box {
  width: 380px;
  max-width: calc(100vw - 48px);
  padding: 14px 16px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--bg-panel);
  box-shadow: 0 12px 36px var(--shadow);
}
.confirm-title { margin: 0 0 6px; font-size: 14px; }
.confirm-text { margin: 0 0 12px; color: var(--text-secondary); font-size: 12px; }
.confirm-actions { display: flex; justify-content: flex-end; gap: 8px; }
.confirm-button {
  padding: 4px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-raised);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}
.confirm-button:hover { background: var(--bg-hover); }
.confirm-button--danger { border-color: var(--error); color: var(--error); }
</style>
