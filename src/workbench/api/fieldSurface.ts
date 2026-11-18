/**
 * 字段面扩展注册表（10 轮引入，06 属性面板消费）。
 *
 * 目的：让后续轮次在不改 `PropertyValueForm` / `types.ts` / 归属策略的前提下，
 * 为特定 trackType + path 提供专用值控件、显示分组、合并行隐藏与面板横幅。
 *
 * 约束：
 * - 默认空注册表：没有贡献时 06 行为逐字节不变；
 * - 贡献按 pluginId 注册，返回注销函数；插件 dispose 时注销；
 * - 只改“显示与控件”，不改文档模型、不写会话。
 */
import type { JsonObject } from '../../core/doc/types.ts'

/** 显示分组：只决定分组键、标签与顺序；缺省回退到行自身的 section/group。 */
export interface FieldDisplayGroup {
  key: string
  label: string
  /** 组顺序（小的在前）；同序按首次出现。 */
  order: number
}

/** 一个字段面贡献。 */
export interface FieldSurfaceContribution {
  /** 注册者插件 id（注销与诊断用）。 */
  pluginId: string
  /** 适用的轨道类型；`*` 表示任意。 */
  trackTypes: readonly string[]
  /** 精确路径列表。 */
  paths: readonly string[]
  /** 专用值控件（异步组件加载器）；不提供则沿用 PropertyValueForm。 */
  component?: () => Promise<unknown>
  /** 显示分组覆盖；返回 null 表示不覆盖。 */
  group?: (path: string) => FieldDisplayGroup | null
  /**
   * 合并行隐藏：返回该对象下应隐藏的路径（例如矩阵 9 行合并为 3×3 网格，
   * 只保留一个承载行）。仅在静态（相关路径都无关键帧）时由贡献自行判断。
   */
  hiddenRows?: (objects: Readonly<JsonObject>) => readonly string[]
  /** 该路径有非空关键帧时，属性面板不显示值控件（10 文档的 leaf 回流规则）。 */
  hideWhenFramed?: boolean
}

/** meta 字段面贡献（脚本 meta 面板用）。 */
export interface MetaFieldSurfaceContribution {
  pluginId: string
  key: string
  component: () => Promise<unknown>
}

/** 面板横幅贡献（属性面板顶部）。 */
export interface PanelBannerContribution {
  pluginId: string
  trackTypes: readonly string[]
  component: () => Promise<unknown>
}

interface RegisteredSurface extends FieldSurfaceContribution {
  order: number
}

const surfaces: RegisteredSurface[] = []
let surfaceSeq = 0
const metaSurfaces = new Map<string, MetaFieldSurfaceContribution>()
const banners: Array<PanelBannerContribution & { order: number }> = []
let bannerSeq = 0

function matchesTrack(contribution: { trackTypes: readonly string[] }, trackType: string): boolean {
  return contribution.trackTypes.includes('*') || contribution.trackTypes.includes(trackType)
}

/** 注册一组字段面；返回注销。 */
export function registerFieldSurfaces(
  pluginId: string,
  contributions: readonly FieldSurfaceContribution[],
): () => void {
  const registered = contributions.map((contribution) => ({
    ...contribution,
    pluginId,
    order: surfaceSeq++,
  }))
  surfaces.push(...registered)
  return () => {
    for (const item of registered) {
      const index = surfaces.indexOf(item)
      if (index >= 0) surfaces.splice(index, 1)
    }
  }
}

/** 取某 trackType + path 的字段面（后注册优先）。 */
export function fieldSurfaceFor(trackType: string, path: string): RegisteredSurface | null {
  for (let index = surfaces.length - 1; index >= 0; index -= 1) {
    const contribution = surfaces[index]
    if (contribution !== undefined
      && matchesTrack(contribution, trackType)
      && contribution.paths.includes(path)) {
      return contribution
    }
  }
  return null
}

/** 显示分组覆盖。 */
export function displayGroupFor(trackType: string, path: string): FieldDisplayGroup | null {
  for (let index = surfaces.length - 1; index >= 0; index -= 1) {
    const contribution = surfaces[index]
    if (contribution === undefined || !matchesTrack(contribution, trackType)) continue
    if (!contribution.paths.includes(path) || contribution.group === undefined) continue
    const group = contribution.group(path)
    if (group !== null) return group
  }
  return null
}

/** 该路径有帧时是否从属性面板值控件区隐藏。 */
export function hideWhenFramed(trackType: string, path: string): boolean {
  for (let index = surfaces.length - 1; index >= 0; index -= 1) {
    const contribution = surfaces[index]
    if (contribution !== undefined
      && contribution.hideWhenFramed === true
      && matchesTrack(contribution, trackType)
      && contribution.paths.includes(path)) {
      return true
    }
  }
  return false
}

/** 合并行隐藏集合（只对匹配的贡献求并集）。 */
export function hiddenRowsFor(trackType: string, objects: Readonly<JsonObject>): Set<string> {
  const hidden = new Set<string>()
  for (const contribution of surfaces) {
    if (!matchesTrack(contribution, trackType) || contribution.hiddenRows === undefined) continue
    for (const path of contribution.hiddenRows(objects)) hidden.add(path)
  }
  return hidden
}

/** 注册 meta 字段面；返回注销。 */
export function registerMetaFieldSurface(
  contribution: MetaFieldSurfaceContribution,
): () => void {
  metaSurfaces.set(contribution.key, contribution)
  return () => {
    if (metaSurfaces.get(contribution.key) === contribution) metaSurfaces.delete(contribution.key)
  }
}

/** 取 meta 字段面。 */
export function metaFieldSurfaceFor(key: string): MetaFieldSurfaceContribution | null {
  return metaSurfaces.get(key) ?? null
}

/** 注册属性面板横幅；返回注销。 */
export function registerPanelBanner(contribution: PanelBannerContribution): () => void {
  const item = { ...contribution, order: bannerSeq++ }
  banners.push(item)
  return () => {
    const index = banners.indexOf(item)
    if (index >= 0) banners.splice(index, 1)
  }
}

/** 取某 trackType 的面板横幅（后注册优先）。 */
export function panelBannerFor(trackType: string): PanelBannerContribution | null {
  for (let index = banners.length - 1; index >= 0; index -= 1) {
    const banner = banners[index]
    if (banner !== undefined && matchesTrack(banner, trackType)) return banner
  }
  return null
}

/** 测试/验证用：清空全部注册（只在 verify 中调用）。 */
export function resetFieldSurfacesForTest(): void {
  surfaces.length = 0
  metaSurfaces.clear()
  banners.length = 0
  surfaceSeq = 0
  bannerSeq = 0
}
