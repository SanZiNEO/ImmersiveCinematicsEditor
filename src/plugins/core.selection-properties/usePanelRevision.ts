/**
 * 面板刷新信号（05-13）。
 *
 * `PanelContext` 的 `selection` / `clipKeys` / `docRevision` 是实时 getter，不是 ref。
 * 面板订阅宿主公开的选区 / 文档 / 图服务，把变化折成一个版本号；
 * 组件在 `computed` 里重新读取快照，不缓存跨 revision 的值。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { Ref } from 'vue'
import type { PanelContext } from '../../workbench/api/context.ts'
import { DOCUMENT_SERVICE, GRAPH_SERVICE, SELECTION_SERVICE } from '../../workbench/api/tokens.ts'

export function usePanelRevision(ctx: PanelContext): Ref<number> {
  const revision = ref(0)
  const disposers: Array<() => void> = []

  onMounted(() => {
    const selection = ctx.services.get(SELECTION_SERVICE)
    if (selection !== undefined) {
      disposers.push(
        selection.subscribe(() => {
          revision.value += 1
        }),
      )
    }
    const documentService = ctx.services.get(DOCUMENT_SERVICE)
    if (documentService !== undefined) {
      disposers.push(
        documentService.subscribe(() => {
          revision.value += 1
        }),
      )
    }
    const graph = ctx.services.get(GRAPH_SERVICE)
    if (graph !== undefined) {
      disposers.push(
        graph.subscribe(() => {
          revision.value += 1
        }),
      )
    }
  })

  onBeforeUnmount(() => {
    for (const dispose of disposers) {
      dispose()
    }
    disposers.length = 0
  })

  return revision
}
