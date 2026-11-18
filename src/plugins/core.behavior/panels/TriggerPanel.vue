<script setup lang="ts">
/**
 * 右栏「行为触发器」面板外壳（11-01 / 11-02…11-05）。
 *
 * 职责：
 * - 从 `root()` 原始 JSON 组装触发器行视图（纯逻辑在 `triggerPanelModel.ts`）；
 * - 跨面板定位：挂载时与每次 `onFocus` 通知各 `takeFocus('right-panel')`，命中身份后交给
 *   `TriggerPane` 选中；只选中，不播放 / 不 seek / 不改主选择；
 * - 面板内部异常就地隔离：模型装配抛错时面板内显示说明，不拖垮主轴与其他面板。
 *
 * 注意：本面板不写 `state.selection`；「定位到片段」才走既有选择命令通道。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { DOCUMENT_SERVICE, GRAPH_SERVICE } from '../../../workbench/api/tokens.ts'
import type { GraphServicePort } from '../../../workbench/api/graph.ts'
import type { JsonObject } from '../../../core/doc/types.ts'
import { isJsonObject } from '../../../core/doc/json.ts'
import { onFocus, takeFocus } from '../../../features/behavior/focus.ts'
import type { FocusRequest } from '../../../features/behavior/focus.ts'
import { usePanelRevision } from '../usePanelRevision.ts'
import {
  buildPanelTriggers,
  type PanelScriptContext,
  type PanelTrigger,
} from './triggerPanelModel.ts'
import TriggerPane from './TriggerPane.vue'

const ctx = usePanelContext()
const revision = usePanelRevision(ctx)

const assemblyError = ref('')
const focusRequest = ref<FocusRequest | null>(null)

function readScriptContext(root: JsonObject | null, graph: GraphServicePort | null): PanelScriptContext {
  const meta = root?.meta
  const selfScriptId = isJsonObject(meta) && typeof meta.id === 'string' ? meta.id : undefined
  const counts = new Map<string, number>()
  if (graph !== null) {
    for (const node of graph.current()?.nodes ?? []) {
      if (typeof node.scriptId === 'string' && node.scriptId.length > 0) {
        counts.set(node.scriptId, (counts.get(node.scriptId) ?? 0) + 1)
      }
    }
  }
  const knownScriptIds = [...counts.keys()]
  const ambiguousScriptIds = [...counts].filter(([, count]) => count > 1).map(([id]) => id)
  return { selfScriptId, knownScriptIds, ambiguousScriptIds }
}

const root = computed<JsonObject | null>(() => {
  void revision.value
  return ctx.services.require(DOCUMENT_SERVICE).root()
})

const metaObject = computed<JsonObject | null>(() => {
  void revision.value
  return ctx.services.require(DOCUMENT_SERVICE).metaObject()
})

const scriptContext = computed<PanelScriptContext>(() => {
  void revision.value
  const graph = ctx.services.get(GRAPH_SERVICE) ?? null
  return readScriptContext(root.value, graph)
})

const rows = computed<PanelTrigger[]>(() => {
  assemblyError.value = ''
  try {
    return buildPanelTriggers(root.value, scriptContext.value)
  } catch (error) {
    assemblyError.value = error instanceof Error ? error.message : String(error)
    return []
  }
})

let disposeFocus: (() => void) | undefined

function consumeFocus(request: FocusRequest): void {
  if (request.target.kind !== 'trigger') return
  focusRequest.value = request
}

onMounted(() => {
  const pending = takeFocus('right-panel')
  if (pending !== null) consumeFocus(pending)
  disposeFocus = onFocus((request) => {
    if (request.surface !== 'right-panel') return
    consumeFocus(takeFocus('right-panel') ?? request)
  })
})

onBeforeUnmount(() => {
  disposeFocus?.()
})

function clearFocusRequest(): void {
  focusRequest.value = null
}
</script>

<template>
  <div class="trigger-panel">
    <p v-if="assemblyError" class="trigger-panel__empty" role="alert">
      触发器面板装配失败：{{ assemblyError }}
    </p>
    <p v-else-if="root === null" class="trigger-panel__empty">当前脚本未打开</p>
    <TriggerPane
      v-else
      :rows="rows"
      :meta="metaObject"
      :script-context="scriptContext"
      :focus-request="focusRequest"
      @focus-consumed="clearFocusRequest"
    />
  </div>
</template>

<style scoped>
.trigger-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.trigger-panel__empty {
  margin: 8px;
  color: var(--text-muted, #888);
  font-size: 12px;
}
</style>
