/**
 * `core.overlay` 的写入辅助（只产出命令，不直接碰 store）。
 *
 * 所有多字段编辑（层切换、预设、遮罩几何清理、渐变删除）都走 `commitBatch`：
 * 一次应用一个撤销项；任何一条失败整批回滚（08 的既有能力）。
 */
import type { DocCommand } from '../../core/doc/commands.ts'
import type { JsonObject, JsonValue } from '../../core/doc/types.ts'
import type { FieldPatch } from '../../features/overlay/colorMask.ts'
import type { DocumentCommands } from '../../workbench/api/documents.ts'
import { declaredLayerType, effectiveLayerType, isOverlayLayerType, isOverlayFieldApplicable } from '../../features/overlay/layers.ts'

/** 把 patch 列表折成命令（`remove` 是 `object.remove`）。 */
export function patchCommands(clipKey: string, patches: readonly FieldPatch[]): DocCommand[] {
  return patches.map((patch) => ('remove' in patch
    ? { kind: 'object.remove', clipKey, path: patch.path }
    : { kind: 'object.setValue', clipKey, path: patch.path, value: patch.value }))
}

/** 提交一批 patch；空列表视为 no-op 成功。 */
export function commitPatches(
  commands: DocumentCommands,
  clipKey: string,
  patches: readonly FieldPatch[],
  coalesceWith?: string,
): { ok: boolean; error?: string; warnings: string[] } {
  if (patches.length === 0) {
    return { ok: true, warnings: [] }
  }
  return commands.commitBatch(patchCommands(clipKey, patches), coalesceWith)
}

/** 单个静态字段写入。 */
export function commitField(
  commands: DocumentCommands,
  clipKey: string,
  path: string,
  value: JsonValue,
  coalesceWith?: string,
  prefix: readonly DocCommand[] = [],
): { ok: boolean; error?: string; warnings: string[] } {
  const command: DocCommand = { kind: 'object.setValue', clipKey, path, value }
  if (prefix.length === 0) {
    return commands.commit(command, coalesceWith)
  }
  return commands.commitBatch([...prefix, command], coalesceWith)
}

/**
 * 首次编辑 fade 字段时补写显式 `layer_type: "fade"`（09-01 §4.3）。
 *
 * 条件：OVERLAY、脚本没写 `layer_type`、字段确属 fade 字段面。返回值只含一条命令或空。
 */
export function ensureExplicitLayerTypeCommands(clipKey: string, objects: JsonObject, path: string): DocCommand[] {
  if (declaredLayerType(objects) !== null) {
    return []
  }
  if (effectiveLayerType(objects) !== 'fade') {
    return []
  }
  if (!isOverlayFieldApplicable('fade', path)) {
    return []
  }
  if (path === 'layer_type') {
    return []
  }
  return [{ kind: 'object.setValue', clipKey, path: 'layer_type', value: 'fade' }]
}

/** 当前层类型文案：显式 / 缺省 / 非法。 */
export function layerTypeSummary(objects: JsonObject): string {
  const declared = declaredLayerType(objects)
  if (declared === null) {
    return '有效层类型：fade（脚本未写 layer_type）'
  }
  if (!isOverlayLayerType(declared)) {
    return `layer_type="${declared}" 非法：运行时不建层`
  }
  return `层类型：${declared}`
}
