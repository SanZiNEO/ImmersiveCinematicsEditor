/**
 * 选择域驱动右栏标签切换（06-12 补充，对齐剪辑软件的"点什么给什么面板"）。
 *
 * 规则（用户裁决）：
 * | 选择域 | 显示面板 |
 * |---|---|
 * | `none`（点时间轴空白 / 清空） | `meta.properties`（脚本属性） |
 * | `clip` / `object` / `keyframe` | `selection.properties`（片段属性） |
 * | `path` / `rule` / `binding` | 停在当前面板（不属于片段属性，也不属于脚本 meta） |
 *
 * 只切**活动标签**，不改面板集合、不改尺寸、不写文档。用户手动点标签后，
 * 直到选择域再次变化才会被切回去——不做"强制锁定"，避免抢用户的操作。
 */
import type { Selection } from '../../core/doc/types.ts'
import type { WorkspaceLayoutService } from '../api/layout.ts'
import type { PanelRef } from '../api/ids.ts'
import type { SelectionServicePort } from '../api/selection.ts'

/** 右栏所在 group（默认布局的 `document.right` 槽位即 group id）。 */
const RIGHT_GROUP_ID = 'document.right'

/** 参与自动切换的面板。 */
const META_PANEL: PanelRef = { pluginId: 'core.meta', panelId: 'meta.properties' }
const PROPERTIES_PANEL: PanelRef = { pluginId: 'core.selection-properties', panelId: 'selection.properties' }

/** 选择域 → 目标面板；返回 `null` 表示"这次不切"。 */
export function targetPanelFor(selection: Selection): PanelRef | null {
  switch (selection.domain) {
    case 'none':
      return META_PANEL
    case 'clip':
    case 'object':
    case 'keyframe':
      return PROPERTIES_PANEL
    default:
      // path / rule / binding：不属于片段属性，也不属于脚本 meta，保持用户当前标签。
      return null
  }
}

/** 选择驱动器的依赖。 */
export interface SelectionPanelSyncDeps {
  pageId: string
  layout: WorkspaceLayoutService
  selection: SelectionServicePort
  /**
   * 文档服务订阅：选区也可能被 `DocumentServiceImpl.select`（宿主命令面）改动，
   * 那条路径不经过 `SelectionServiceImpl.requestSelect`，所以必须同时订阅文档变化。
   */
  documents?: { subscribe(listener: () => void): () => void }
  /** 诊断（切换失败不静默）。 */
  report?: (message: string) => void
}

/**
 * 启动选择驱动切换；返回释放函数。
 *
 * 切换条件：选择域**变化**，或目标面板当前不是右栏的活动标签。
 * 后者保证"用户手动切走后再点空白仍能切回来"，同时不打扰同域内的正常操作。
 */
export function startSelectionPanelSync(deps: SelectionPanelSyncDeps): () => void {
  let lastDomain: string | null = null
  const apply = (selection: Selection): void => {
    const target = targetPanelFor(selection)
    if (target === null) {
      lastDomain = selection.domain
      return
    }
    const domainChanged = selection.domain !== lastDomain
    lastDomain = selection.domain
    if (!domainChanged && isAlreadyActive(deps.layout, deps.pageId, target)) {
      return
    }
    try {
      deps.layout.setActivePanel(deps.pageId, RIGHT_GROUP_ID, target)
    } catch (error) {
      deps.report?.(`切换右栏标签失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  apply(deps.selection.snapshot().selection)
  const disposers: Array<() => void> = []
  disposers.push(deps.selection.subscribe((snapshot) => {
    apply(snapshot.selection)
  }))
  if (deps.documents !== undefined) {
    disposers.push(deps.documents.subscribe(() => {
      apply(deps.selection.snapshot().selection)
    }))
  }
  return () => {
    for (const dispose of disposers) {
      dispose()
    }
  }
}

/** 目标面板是否已经是右栏的活动标签。 */
function isAlreadyActive(layout: WorkspaceLayoutService, pageId: string, panel: PanelRef): boolean {
  const group = layout.getGroup(pageId, RIGHT_GROUP_ID)
  if (group === undefined) {
    return false
  }
  const expectedId = `p:${panel.pluginId}:${panel.panelId}`
  return group.activePanelId === expectedId
}
