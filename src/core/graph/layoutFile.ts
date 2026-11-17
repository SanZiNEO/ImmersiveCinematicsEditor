/**
 * 05-04 `graph-layout.json` 数据模型。
 *
 * 只存世界坐标、视图与折叠目录；不存节点尺寸、颜色、选中、悬停、过滤条件，
 * 也不存边。布局文件独立于 04 的 `layout.json`，也不写进 `preferences.json`。
 */
import type { GraphViewState } from './layout.ts'

/** 固定项目键（05-04）。 */
export const GRAPH_PROJECT_KEY = 'immersive_cinematics/scripts'

/** 布局文件版本。 */
export const GRAPH_LAYOUT_VERSION = 1

/** 布局文件大小上限（1 MB）。 */
export const GRAPH_LAYOUT_MAX_BYTES = 1024 * 1024

/** 布局文件名（`userData/graph-layout.json`）。 */
export const GRAPH_LAYOUT_FILE = 'graph-layout.json'

/** 单个节点的持久化坐标。 */
export interface GraphNodeLayout {
  x: number
  y: number
  /** 写入时的 `meta.id`，用于 path 失效后的兜底重绑定。 */
  scriptId?: string | null
}

/** 布局文件。 */
export interface GraphLayoutFile {
  version: 1
  projectKey: string
  revision: number
  nodes: Record<string, GraphNodeLayout>
  view: GraphViewState
  /** 折叠的分组（目录 path；`""` = 根组）。 */
  collapsed: string[]
  /** ISO-8601，仅诊断。 */
  updatedAt: string
}

/** 新建默认布局文件。 */
export function createGraphLayoutFile(now = new Date()): GraphLayoutFile {
  return {
    version: GRAPH_LAYOUT_VERSION,
    projectKey: GRAPH_PROJECT_KEY,
    revision: 0,
    nodes: {},
    view: { scale: 1, tx: 0, ty: 0 },
    collapsed: [],
    updatedAt: now.toISOString(),
  }
}
