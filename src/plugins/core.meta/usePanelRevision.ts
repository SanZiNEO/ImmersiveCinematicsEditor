/**
 * 面板刷新信号（06-12）。
 *
 * `PanelContext` 的 `selection` / `clipKeys` / `docRevision` 是实时 getter，不是 ref。
 * 面板用宿主公开的 `SelectionServicePort.subscribe` 与 `DocumentService.subscribe`
 * 把变化折成一个版本号，再在 `computed` 里实时读取上下文快照。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { Ref } from 'vue'
import type { PanelContext } from '../../workbench/api/context.ts'
import { DOCUMENT_SERVICE, SELECTION_SERVICE } from '../../workbench/api/tokens.ts'

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
  })

  onBeforeUnmount(() => {
    for (const dispose of disposers) {
      dispose()
    }
    disposers.length = 0
  })

  return revision
}
