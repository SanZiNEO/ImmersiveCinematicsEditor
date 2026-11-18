/**
 * 调色曲线抽屉的当前曲线指针（会话内，不写文档）。
 */
let curveKey: string | null = null
let curveClip: string | null = null
const listeners = new Set<(key: string | null, clipKey: string | null) => void>()

export function setCurveTarget(next: { key: string; clipKey: string } | null): void {
  curveKey = next?.key ?? null
  curveClip = next?.clipKey ?? null
  for (const listener of listeners) listener(curveKey, curveClip)
}

export function getCurveTarget(): { key: string | null; clipKey: string | null } {
  return { key: curveKey, clipKey: curveClip }
}

export function subscribeCurveTarget(
  listener: (key: string | null, clipKey: string | null) => void,
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
