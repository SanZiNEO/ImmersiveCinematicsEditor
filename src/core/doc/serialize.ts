/**
 * 无损序列化（03-04）：保存与预览推送共用同一套写出规则。
 *
 * 定义：对任意输入 JSON `R`，`serialize(load(R))` 与 `R` 只允许这些差异——
 * 对象成员顺序、数字表示（`1` 与 `1.0`）、空白。
 *
 * 因此本模块**不烘焙、不剥离、不裁剪、不排序、不补默认值**：
 * - 显式等于目录默认值的值保留；
 * - 空 `keyframes: []` 保留；
 * - `null`（`nullable_float`）保留；
 * - STRUCT 嵌套对象 / 数组原样；
 * - 事件记录原样；
 * - 四类集合的数组顺序与 `id` 原样。
 *
 * 编辑器自己的 `authoring` / `clipKey` / UI 视图状态从不进入 `root`，所以这里天然不写。
 */
import { cloneJson, isJsonObject } from './json.ts'
import type { JsonArray, JsonObject, ScriptDoc } from './types.ts'

/** 序列化为可写盘 / 可推送的 JSON（深拷贝，调用方改返回值不影响文档）。 */
export function serializeDoc(doc: ScriptDoc): JsonObject {
  return cloneJson(doc.root)
}

/** 预览裁剪谓词：返回 `true` 的 AUDIO 轨在推送副本上 `clips=[]`。 */
export type MutedAudioPredicate = (track: JsonObject, index: number) => boolean

/**
 * 预览推送用的序列化副本（03-04 / 03-07）：
 * 只对静音的 AUDIO 轨裁剪 `clips=[]`，其余与 `serializeDoc` 完全一致。
 *
 * `doc` 与保存文件不受影响；静音是 session 状态，不写盘。
 */
export function serializeForPreview(doc: ScriptDoc, mutedAudio: MutedAudioPredicate): JsonObject {
  const payload = serializeDoc(doc)
  const timeline = payload.timeline
  if (!isJsonObject(timeline)) {
    return payload
  }
  const tracks = timeline.tracks
  if (!Array.isArray(tracks)) {
    return payload
  }
  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index]
    if (!isJsonObject(track) || track.type !== 'AUDIO') {
      continue
    }
    if (!mutedAudio(track, index)) {
      continue
    }
    const clips: JsonArray = []
    track.clips = clips
  }
  return payload
}
