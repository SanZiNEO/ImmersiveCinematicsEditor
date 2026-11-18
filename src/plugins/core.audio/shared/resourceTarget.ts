/**
 * 资源抽屉的“当前填充目标”（10-08）。
 *
 * 只存会话内指针（clipKey / path / 期望类别 / 插件来源），不写文档；
 * 资源抽屉只读取它，点文件时把路径写回目标字段。
 */
export type ResourceFillKind = 'audio' | 'image' | 'video' | 'media' | 'lut'

export interface ResourceFillTarget {
  clipKey: string
  trackType: string
  path: string
  kind: ResourceFillKind
  /** 字段当前值（用于高亮同目录）。 */
  current: string
}

let target: ResourceFillTarget | null = null
const listeners = new Set<(target: ResourceFillTarget | null) => void>()

export function setResourceFillTarget(next: ResourceFillTarget | null): void {
  target = next
  for (const listener of listeners) {
    try {
      listener(target)
    } catch {
      // 单个监听器抛错不影响其他监听器。
    }
  }
}

export function getResourceFillTarget(): ResourceFillTarget | null {
  return target
}

export function subscribeResourceFillTarget(
  listener: (target: ResourceFillTarget | null) => void,
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 测试用清空。 */
export function resetResourceFillTarget(): void {
  target = null
  listeners.clear()
}
