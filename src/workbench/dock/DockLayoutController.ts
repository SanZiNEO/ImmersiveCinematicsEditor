/**
 * 面板拖动状态机（04-03）。
 *
 * idle → pending → dragging → idle。
 * 只把指针手势翻译成一次 04-02 事务；拖动中不持久化、不进布局历史。
 * 无 DOM 依赖，`verify.ts` 可直接用假的 `WorkspaceLayoutService` 驱动。
 */
import type { LayoutNode, LayoutTree, LayoutTransaction, WorkspaceLayoutService } from '../api/layout.ts'
import type { Orientation, PanelRef } from '../api/ids.ts'
import { samePanel } from '../api/ids.ts'
import type { DockPoint, DropTarget } from './DropTarget.ts'
import { DOCK_DRAG_THRESHOLD_PX } from './dockContext.ts'

/** 手势状态。 */
export type DockGestureState = 'idle' | 'pending' | 'dragging'

/** 控制器构造参数。 */
export interface DockControllerOptions {
  layout: WorkspaceLayoutService
  pageId: string
  /** 状态/落点变化时通知外壳重绘；不用于持久化。 */
  onChange?: () => void
}

/** `pointerUp` 结果。 */
export interface DockCommitResult {
  committed: boolean
  /** `below-threshold`、`same-position`、`no-target`、`cancelled` 或异常消息。 */
  reason?: string
}

/** 面板拖动控制器。每次 `DockSurface` 挂载创建独立实例。 */
export class DockLayoutController {
  private readonly layout: WorkspaceLayoutService
  private readonly pageId: string
  private readonly onChange: (() => void) | undefined

  private gesture: DockGestureState = 'idle'
  private source: PanelRef | null = null
  private fromGroupId: string | null = null
  private sourcePanelIndex: number | null = null
  private downPoint: DockPoint | null = null
  private target: DropTarget | null = null
  private snapshot: LayoutTree | null = null
  private cancelReason: string | null = null

  constructor(options: DockControllerOptions) {
    this.layout = options.layout
    this.pageId = options.pageId
    this.onChange = options.onChange
  }

  /** 当前状态。 */
  state(): DockGestureState {
    return this.gesture
  }

  /** 是否已超过 4px 阈值。 */
  isDragging(): boolean {
    return this.gesture === 'dragging'
  }

  /** 拖动源；未拖动时为 null。 */
  sourceRef(): PanelRef | null {
    return this.source === null ? null : { ...this.source }
  }

  /** 源面板所在 group。 */
  fromGroup(): string | null {
    return this.fromGroupId
  }

  /** 源面板在 group 内的索引。 */
  sourceIndex(): number | null {
    return this.sourcePanelIndex
  }

  /** 当前落点（由 `DockSurface` 用 `computeDropTarget` 计算后写入）。 */
  currentTarget(): DropTarget | null {
    return this.target === null ? null : { ...this.target }
  }

  /** 最近一次取消原因。 */
  lastCancelReason(): string | null {
    return this.cancelReason
  }

  /**
   * 拖动中的临时树：拖动前的只读快照（深拷贝）。
   * 落点预览由 `DockSurface` 画矩形/插入线，不修改真实树。
   */
  previewTree(): LayoutTree {
    const base = this.snapshot ?? this.layout.getTree(this.pageId)
    return cloneTree(base)
  }

  /** 指针按下：进入 pending，记录源与拖动前快照。 */
  pointerDown(source: PanelRef, groupId: string, point: DockPoint): void {
    if (this.gesture !== 'idle') this.cancel('interrupted')
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return

    const tree = this.layout.getTree(this.pageId)
    this.source = { ...source }
    this.fromGroupId = groupId
    this.sourcePanelIndex = findPanelIndex(tree, groupId, source)
    this.downPoint = { ...point }
    this.target = null
    this.snapshot = cloneTree(tree)
    this.cancelReason = null
    this.gesture = 'pending'
    this.notify()
  }

  /** 指针移动：超过 4px 才进入 dragging。 */
  pointerMove(point: DockPoint): void {
    if (this.gesture === 'idle' || this.downPoint === null) return
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return
    if (this.gesture === 'pending') {
      const dx = point.x - this.downPoint.x
      const dy = point.y - this.downPoint.y
      if (dx * dx + dy * dy > DOCK_DRAG_THRESHOLD_PX * DOCK_DRAG_THRESHOLD_PX) {
        this.gesture = 'dragging'
        this.notify()
      }
    }
  }

  /** 拖动中更新落点；只在 dragging 状态生效。 */
  setDropTarget(target: DropTarget | null): void {
    if (this.gesture !== 'dragging') return
    this.target = target === null ? null : { ...target }
    this.notify()
  }

  /**
   * 指针松开。`target` 未传时使用 `setDropTarget` 的结果。
   * pending（未超阈值）视为点击，不写布局；原位/非法落点同样取消。
   */
  pointerUp(target?: DropTarget | null): DockCommitResult {
    if (this.gesture === 'idle') return { committed: false, reason: 'idle' }
    if (this.gesture === 'pending') {
      this.reset()
      this.notify()
      return { committed: false, reason: 'below-threshold' }
    }

    const resolved = target === undefined ? this.target : target
    const result = this.commit(resolved)
    this.reset()
    this.notify()
    return result
  }

  /** 取消：回滚到拖动前快照，不写盘、不进历史。 */
  cancel(reason: string = 'cancelled'): void {
    if (this.gesture === 'idle') return
    this.cancelReason = reason
    this.reset()
    this.notify()
  }

  private commit(target: DropTarget | null): DockCommitResult {
    if (this.source === null || this.fromGroupId === null) {
      return { committed: false, reason: 'no-source' }
    }
    if (target === null || target.kind === 'none') {
      return { committed: false, reason: target?.reason ?? 'no-target' }
    }
    if (this.isSamePosition(target)) {
      return { committed: false, reason: 'same-position' }
    }

    let transaction: LayoutTransaction | null = null
    try {
      transaction = this.layout.beginTransaction(this.pageId)
      this.applyTarget(target, this.source, this.fromGroupId)
      transaction.commit()
      return { committed: true }
    } catch (error) {
      try {
        transaction?.rollback()
      } catch {
        // 回滚失败不能再破坏布局；错误原样返回给调用方提示。
      }
      return { committed: false, reason: errorMessage(error) }
    }
  }

  private applyTarget(
    target: DropTarget,
    source: PanelRef,
    fromGroupId: string,
  ): void {
    switch (target.kind) {
      case 'merge':
      case 'reorder': {
        const groupId = requireGroupId(target)
        const rawIndex = target.index ?? this.groupPanelCount(groupId)
        const sourceIndex = this.sourcePanelIndex
        const index =
          fromGroupId === groupId && sourceIndex !== null && rawIndex > sourceIndex
            ? rawIndex - 1
            : rawIndex
        this.layout.movePanel(this.pageId, source, groupId, index)
        return
      }
      case 'split': {
        const groupId = requireGroupId(target)
        if (target.orientation === undefined || target.side === undefined) {
          throw new Error('拆分落点缺少方向')
        }
        this.applySplit(groupId, target.orientation, target.side, source)
        return
      }
      case 'new-group': {
        this.applyNewGroup(fromGroupId, source)
        return
      }
      case 'drawer': {
        const groupId = requireGroupId(target)
        this.layout.movePanel(this.pageId, source, groupId, this.groupPanelCount(groupId))
        return
      }
      case 'none':
        throw new Error('非法落点')
      default:
        throw new Error(`未知落点: ${String(target.kind)}`)
    }
  }

  /**
   * 在目标 group 的对应边缘拆出一个新 group，再把源面板移入。
   * `splitGroup` 的 `atIndex` 决定新 group 在 split children 中的位置：
   * left/top 是 0，right/bottom 是 1。
   */
  private applySplit(
    groupId: string,
    orientation: Orientation,
    side: 'left' | 'right' | 'top' | 'bottom',
    source: PanelRef,
  ): void {
    const before = groupIdsOf(this.layout.getTree(this.pageId))
    const atIndex = side === 'left' || side === 'top' ? 0 : 1
    this.layout.splitGroup(this.pageId, groupId, orientation, atIndex)
    const newGroupId = newGroupIdAfter(this.layout.getTree(this.pageId), before)
    if (newGroupId === null) throw new Error('拆分后找不到新 group')
    this.layout.movePanel(this.pageId, source, newGroupId, 0)
  }

  /**
   * 空白工作区：04-02 没有独立的 `addGroup` 命令，用源 group 右侧拆分来新建 group。
   * 新 group 由 `splitGroup` 生成，随后把源面板移入；不直接改树。
   */
  private applyNewGroup(
    fromGroupId: string,
    source: PanelRef,
  ): void {
    const before = groupIdsOf(this.layout.getTree(this.pageId))
    this.layout.splitGroup(this.pageId, fromGroupId, 'horizontal', 1)
    const newGroupId = newGroupIdAfter(this.layout.getTree(this.pageId), before)
    if (newGroupId === null) throw new Error('新建 group 失败')
    this.layout.movePanel(this.pageId, source, newGroupId, 0)
  }

  /** 拖回源 group 的原位置：不提交。 */
  private isSamePosition(target: DropTarget): boolean {
    if (this.fromGroupId === null) return false
    if (target.groupId !== this.fromGroupId) return false
    if (target.kind === 'merge' || target.kind === 'reorder') {
      if (this.sourcePanelIndex === null) return false
      if (target.index === undefined) return target.kind === 'merge'
      return target.index === this.sourcePanelIndex || target.index === this.sourcePanelIndex + 1
    }
    if (target.kind === 'drawer') return true
    return false
  }

  private groupPanelCount(groupId: string): number {
    const group = findGroup(this.layout.getTree(this.pageId).root, groupId)
    return group?.panels.length ?? 0
  }

  private reset(): void {
    this.gesture = 'idle'
    this.source = null
    this.fromGroupId = null
    this.sourcePanelIndex = null
    this.downPoint = null
    this.target = null
    this.snapshot = null
  }

  private notify(): void {
    if (this.onChange === undefined) return
    try {
      this.onChange()
    } catch {
      // 外壳回调异常不能让状态机停在脏状态。
    }
  }
}

function requireGroupId(target: DropTarget): string {
  if (target.groupId === undefined || target.groupId.length === 0) {
    throw new Error('落点缺少 groupId')
  }
  return target.groupId
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function findPanelIndex(tree: LayoutTree, groupId: string, source: PanelRef): number | null {
  const group = findGroup(tree.root, groupId)
  if (group === null) return null
  const index = group.panels.findIndex((panel) => samePanel(panel, source))
  return index >= 0 ? index : null
}

function findGroup(node: LayoutNode, groupId: string): Extract<LayoutNode, { type: 'group' }> | null {
  if (node.type === 'group') return node.id === groupId ? node : null
  for (const child of node.children) {
    const found = findGroup(child, groupId)
    if (found !== null) return found
  }
  return null
}

function groupIdsOf(tree: LayoutTree): Set<string> {
  const ids = new Set<string>()
  collectGroupIds(tree.root, ids)
  return ids
}

function collectGroupIds(node: LayoutNode, ids: Set<string>): void {
  if (node.type === 'group') {
    ids.add(node.id)
    return
  }
  for (const child of node.children) collectGroupIds(child, ids)
}

function newGroupIdAfter(tree: LayoutTree, before: ReadonlySet<string>): string | null {
  const after = groupIdsOf(tree)
  for (const id of after) {
    if (!before.has(id)) return id
  }
  return null
}

function cloneTree(tree: LayoutTree): LayoutTree {
  return { root: cloneNode(tree.root) }
}

function cloneNode(node: LayoutNode): LayoutNode {
  if (node.type === 'group') {
    return {
      ...node,
      panels: node.panels.map((panel) => ({ ...panel })),
    }
  }
  return {
    ...node,
    sizes: [...node.sizes],
    minSizes: node.minSizes === undefined ? undefined : [...node.minSizes],
    children: node.children.map(cloneNode),
  }
}
