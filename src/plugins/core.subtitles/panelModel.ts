/**
 * 字幕面板模型装配（12-15）：把文档服务视图折成 `features/subtitles` 的纯输入结构。
 *
 * 面板不直接读 store；这里只做视图 → 纯数据的映射，派生 / 打包 / 编译都在 feature 层。
 */
import type { JsonObject } from '../../core/doc/types.ts'
import type { ScriptView } from '../../workbench/api/documents.ts'
import type { RawTrack } from '../../features/subtitles/cues.ts'

/** 把 `ScriptView.tracks` 折成纯轨道输入。 */
export function rawTracksFromView(
  view: ScriptView | null,
  objectsOf: (clipKey: string) => JsonObject | null,
): RawTrack[] {
  if (view === null) return []
  return view.tracks.map((track) => ({
    type: track.type,
    name: track.name,
    clips: track.clips.map((clip) => ({
      clipKey: clip.clipKey,
      start: clip.start,
      duration: clip.duration,
      objects: objectsOf(clip.clipKey) ?? {},
    })),
  }))
}
