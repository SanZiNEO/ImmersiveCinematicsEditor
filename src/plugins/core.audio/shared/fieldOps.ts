/**
 * 10 专用字段控件的值读写助手（只走 `PanelContext.commands`）。
 *
 * 10 的字段在属性面板里一旦有帧就只留“在效果面板”入口（`hideWhenFramed`），
 * 所以这里的控件只处理静态值；矩阵/色相带网格会自行逐路径判断（见组件内）。
 */
import type { JsonObject, JsonValue } from '../../../core/doc/types.ts'
import type { DocumentCommands } from '../../../workbench/api/documents.ts'
import type { PropertyRow } from '../../../features/effects/types.ts'

/** 读取对象里某路径的显式值（没有 `value` 键返回 `undefined`）。 */
export function explicitValueOf(objects: JsonObject, path: string): JsonValue | undefined {
  const property = objects[path]
  if (typeof property !== 'object' || property === null || Array.isArray(property)) return undefined
  const record = property as Record<string, JsonValue>
  return Object.prototype.hasOwnProperty.call(record, 'value') ? record.value : undefined
}

/** 当前控件显示值：显式值 → 目录默认值。 */
export function currentValueOf(row: PropertyRow, objects: JsonObject): JsonValue | undefined {
  const explicit = explicitValueOf(objects, row.path)
  if (explicit !== undefined) return explicit
  return row.hasDefault ? (row.defaultValue as JsonValue | undefined) : undefined
}

/** 数值字段的显示值。 */
export function currentNumberOf(row: PropertyRow, objects: JsonObject): number | null {
  const value = currentValueOf(row, objects)
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 静态写值；返回命令层的真实结果。 */
export function commitStaticValue(
  commands: DocumentCommands,
  row: PropertyRow,
  value: JsonValue,
): { ok: boolean; error?: string } {
  return commands.commit({
    kind: 'object.setValue',
    clipKey: row.clipKey,
    path: row.path,
    value,
  })
}

/**
 * 写某个路径（矩阵单格/色相带单通道）：有帧时只在播放头正好落在帧上才写帧值，
 * 否则拒绝并提示去效果面板——不在属性面板悄悄制造新帧。
 */
export function commitPathValue(
  commands: DocumentCommands,
  row: PropertyRow,
  objects: JsonObject,
  path: string,
  value: JsonValue,
  playhead: number,
): { ok: boolean; error?: string } {
  const property = objects[path]
  const frames = typeof property === 'object' && property !== null && !Array.isArray(property)
    ? (property as Record<string, JsonValue>).keyframes
    : undefined
  if (!Array.isArray(frames) || frames.length === 0) {
    return commands.commit({ kind: 'object.setValue', clipKey: row.clipKey, path, value })
  }
  const exact = frames.find((frame) => {
    if (typeof frame !== 'object' || frame === null) return false
    const time = (frame as Record<string, JsonValue>).time
    return typeof time === 'number' && Math.abs(time - playhead) <= 1e-6
  })
  if (exact === undefined) {
    return {
      ok: false,
      error: `${path} 已有 ${frames.length} 个帧；播放头不在帧上，先到效果面板把播放头移到帧或新增帧。`,
    }
  }
  return commands.commit({
    kind: 'object.setKeyframeValue',
    clipKey: row.clipKey,
    path,
    time: playhead,
    value,
  })
}

/** 数值范围：优先目录 min/max，其次调用方给的回退。 */
export function rangeOf(
  row: PropertyRow,
  fallback: { min: number; max: number; step: number },
): { min: number; max: number; step: number } {
  const min = typeof row.min === 'number' && Number.isFinite(row.min) ? row.min : fallback.min
  const max = typeof row.max === 'number' && Number.isFinite(row.max) ? row.max : fallback.max
  return { min, max, step: fallback.step }
}

/** 把数字夹到范围内并去掉浮点尾巴。 */
export function clampNumber(value: number, min: number, max: number, step: number): number {
  const clamped = Math.max(min, Math.min(max, value))
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3
  return Number(clamped.toFixed(decimals))
}
