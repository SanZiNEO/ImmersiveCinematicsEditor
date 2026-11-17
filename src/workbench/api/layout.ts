/**
 * 布局模型与服务端口（04-02）。
 *
 * 布局树只存 `{ pluginId, panelId }`；不存组件路径、DOM 或业务数据。
 * 外壳只调 `getTree` 渲染，不持有第二份尺寸状态。
 */
import type { Orientation, PanelRef } from './ids.ts'

/** 面板节点（group 内）。 */
export interface PanelNode extends PanelRef {
  type: 'panel'
  /** `p:<pluginId>:<panelId>`。 */
  id: string
  visible: boolean
  collapsed?: boolean
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
}

/** 组节点：一组标签。 */
export interface GroupNode {
  type: 'group'
  id: string
  /** 有序，决定标签顺序。 */
  panels: PanelNode[]
  activePanelId?: string
  /**
   * 抽屉 group 的活动标签（全局 `tabId`，如 `demo.drawer.notes`）。
   *
   * 抽屉的标签来自 `drawerTab` 贡献，不是 `panels`；普通 group 用 `activePanelId`。
   */
  activeTabId?: string
  visible: boolean
  collapsed: boolean
  /** 折叠前的高度/比例参考（恢复用）。 */
  lastSize?: number
}

/** 分割节点。 */
export interface SplitNode {
  type: 'split'
  id: string
  orientation: Orientation
  children: LayoutNode[]
  /** 比例，和为 1，至少两个子节点。 */
  sizes: number[]
  /** 像素下限；与 children 对齐。 */
  minSizes?: number[]
}

/** 布局节点。 */
export type LayoutNode = SplitNode | GroupNode

/** 一页的完整布局树。 */
export interface LayoutTree {
  root: LayoutNode
}

/** 一页的预设集合。 */
export interface PageLayout {
  presetId: string
  presets: Record<string, LayoutTree>
}

/** 布局文件（`userData/layout.json`）。 */
export interface LayoutFile {
  version: 1
  currentPageId: string
  pages: Record<string, PageLayout>
}

/** group 状态补丁：只改传入字段。 */
export interface GroupStatePatch {
  visible?: boolean
  collapsed?: boolean
  activeTabId?: string
  /** 折叠 / 展开前的尺寸参考（抽屉高度、折叠面板宽度等）。 */
  lastSize?: number
}

/** 视口（像素）。 */
export interface Viewport {
  width: number
  height: number
}

/** 布局事务：拖动/缩放的临时树只在内存，提交一次。 */
export interface LayoutTransaction {
  /** 提交：写持久化 + 进布局历史。 */
  commit(): void
  /** 回滚：丢弃临时树，不写盘、不进历史。 */
  rollback(): void
  /** 事务内取当前（未提交）树，用于拖动预览。 */
  tree(): LayoutTree
}

/** 布局校验结果。 */
export interface LayoutValidationResult {
  ok: boolean
  /** 该页被回退为默认（环 / 负比例 / split 子节点不足）。 */
  reverted: boolean
  /** 保留节点但标记缺失的 panel。 */
  missing: PanelRef[]
  /** 被移除的重复 panel。 */
  duplicates: PanelRef[]
  messages: string[]
}

/** 工作区布局服务（04-02）：唯一写入者。 */
export interface WorkspaceLayoutService {
  getPage(pageId: string): PageLayout
  getTree(pageId: string): LayoutTree
  applyViewport(pageId: string, viewport: Viewport): void
  viewport(): Viewport

  movePanel(pageId: string, panel: PanelRef, targetGroupId: string, index: number): void
  splitGroup(pageId: string, groupId: string, orientation: Orientation, atIndex: number): void
  resizeSplit(pageId: string, splitId: string, index: number, ratio: number): void
  hidePanel(pageId: string, panel: PanelRef): void
  showPanel(pageId: string, panel: PanelRef): void
  setActivePanel(pageId: string, groupId: string, panel: PanelRef): void

  /** 取一个 group（抽屉这类没有 panel 的 group 也要能操作）。 */
  getGroup(pageId: string, groupId: string): GroupNode | undefined
  /** 改 group 的可见 / 折叠 / 活动项 / 上次尺寸；抽屉开关与标签切换都走它。 */
  setGroupState(pageId: string, groupId: string, patch: GroupStatePatch): void
  /** 低窗降级：把主轴压到 `axisPx`，抽屉拉回 `lastSize`。 */
  squeezeAxis(pageId: string, drawerGroupId: string, axisPx: number): void
  /** 撤掉低窗降级：按抽屉打开前的比例还自主轴。 */
  restoreAxis(pageId: string): void

  applyPreset(pageId: string, presetId: string): void
  savePreset(pageId: string, name: string): void
  deletePreset(pageId: string, presetId: string): void
  presets(pageId: string): string[]
  resetLayout(pageId: string): void
  removeMissingPanels(pageId: string): void
  /** 移除一个具体面板节点（缺失占位的「移除」按钮）。 */
  removePanel(pageId: string, panel: PanelRef): void

  beginTransaction(pageId: string): LayoutTransaction
  undo(pageId: string): void
  redo(pageId: string): void
  canUndo(pageId: string): boolean
  canRedo(pageId: string): boolean

  /** 载入 `layout.json` 文本（坏 JSON → 默认 + corrupt 备份）。 */
  load(text: string | null): void
  /** 序列化当前布局（原子写由存储端口做）。 */
  serialize(): string
  subscribe(listener: () => void): () => void
  /** 布局恢复 / 缺失 / 重复等诊断回调由服务构造时注入。 */
}

/** 面板在布局里的实际几何（PanelContext.layout 只读）。 */
export interface PanelLayoutInfo {
  pageId: string
  visible: boolean
  collapsed: boolean
  width: number
  height: number
}
