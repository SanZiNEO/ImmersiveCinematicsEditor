/**
 * 自定义字段组件注册表（09 集成面，最小扩展）。
 *
 * 06 的 `PropertyValueForm` 是冻结的共享面；09 不往里塞层类型分支，而是让属性面板在
 * 渲染某一行之前查询本注册表：命中 `轨道类型:路径` 时用插件提供的专用控件，
 * 未命中仍走 06 的通用控件。
 *
 * 只允许面板侧注册；注册项是纯渲染组件，写入仍走 `PanelContext.commands`。
 */
import { ref, type Component } from 'vue'
import type { DocCommand } from '../../core/doc/commands.ts'
import type { JsonObject } from '../../core/doc/types.ts'
import type { ClipTiming } from './rows.ts'
import type { PropertyRow } from './types.ts'

/** 自定义字段组件收到的 props（面板侧只读 + 命令上下文由组件自己 inject）。 */
export interface CustomFieldProps {
  row: PropertyRow
  /** 片段当前对象（只读克隆）。 */
  objects: JsonObject
  timing: ClipTiming
  playhead: number
  disabled: boolean
}

/** 注册键：`<trackType>:<path>`。 */
export type CustomFieldKey = `${string}:${string}`

/** 注册项。 */
export interface CustomFieldRegistration {
  key: CustomFieldKey
  component: Component
}

const registry = new Map<CustomFieldKey, Component>()

/** 注册表版本：普通 Map 不是响应式，属性行需要这个信号重新查询。 */
export const customFieldsRevision = ref(0)

/** 注册一个字段组件（同一键后注册覆盖先注册）。 */
export function registerCustomField(trackType: string, path: string, component: Component): () => void {
  const key = `${trackType}:${path}` as CustomFieldKey
  registry.set(key, component)
  customFieldsRevision.value += 1
  return () => {
    if (registry.get(key) === component) {
      registry.delete(key)
      customFieldsRevision.value += 1
    }
  }
}

/** 查询字段组件；无注册返回 `undefined`。 */
export function customFieldFor(trackType: string | undefined, path: string): Component | undefined {
  if (trackType === undefined) {
    return undefined
  }
  return registry.get(`${trackType}:${path}` as CustomFieldKey)
}

/** 清空注册表（测试 / 插件卸载用）。 */
export function clearCustomFields(): void {
  registry.clear()
  customFieldsRevision.value += 1
}

/**
 * 提交前缀提供者（09 集成）：通用控件写入某路径时，先附带的命令。
 *
 * 用于「首次编辑 fade 字段补写显式 layer_type」这类跨字段约束；只在通用
 * `PropertyValueForm` 路径生效，自定义控件自己调用同一提供者。
 */
export type CommitPrefixProvider = (context: {
  trackType: string
  path: string
  clipKey: string
  objects: JsonObject
}) => readonly DocCommand[]

const prefixProviders: CommitPrefixProvider[] = []

/** 注册前缀提供者；返回取消函数。 */
export function registerCommitPrefix(provider: CommitPrefixProvider): () => void {
  prefixProviders.push(provider)
  return () => {
    const index = prefixProviders.indexOf(provider)
    if (index >= 0) {
      prefixProviders.splice(index, 1)
    }
  }
}

/** 取该行全部前缀命令（多个提供者按注册顺序拼接）。 */
export function commitPrefixFor(
  trackType: string | undefined,
  path: string,
  clipKey: string,
  objects: JsonObject,
): DocCommand[] {
  if (trackType === undefined) {
    return []
  }
  return prefixProviders.flatMap((provider) => provider({ trackType, path, clipKey, objects }))
}

/** 清空前缀提供者（测试用）。 */
export function clearCommitPrefixes(): void {
  prefixProviders.length = 0
}
