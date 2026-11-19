/**
 * 12 轮「字幕链路」自检（12-12 导入 / 12-13 批次 / 12-14 编译 / 12-15 面板）。
 *
 * 独立跑：`node --experimental-strip-types src/workbench/verify12/subtitles.ts`
 * 集成：`verify-12.ts` 调 `runSubtitles(check, ctx)`。
 *
 * 覆盖 12-16 字幕组与合同回归字幕条：解析 / 编码 / 前缀转义、草稿零残留、自动分轨、
 * 重开恢复、重导入四类、批量移动 / 删除事务与撤销、编译字段面 / 时间精确对应 /
 * 重叠拒绝 / 关键帧保留 / 空文本跳过 / 警告 / 结构校验，以及面板纯视图模型。
 */
import { fileURLToPath } from 'node:url'
import { validateStructure } from '../../core/doc/structural.ts'
import { createCheckRunner } from './harness.ts'
import { createVerifyContext } from './context.ts'
import type { DocCommand } from '../../core/doc/commands.ts'
import type { DocStore } from '../../core/doc/store.ts'
import type { JsonObject, JsonValue, ObjectKeyframe, ScriptDoc } from '../../core/doc/types.ts'
import type { CheckFn } from './harness.ts'
import { clipsOf, objectsOf, tracksOf, type VerifyContext } from './context.ts'

import { decodeSubtitleBytes } from '../../features/subtitles/decode.ts'
import {
  parseSubtitleText,
  subtitleFormatOf,
  type ParsedCue,
} from '../../features/subtitles/parse.ts'
import {
  deriveCueRows,
  deriveTracks,
  planPackCues,
  type CueRow,
  type RawTrack,
} from '../../features/subtitles/cues.ts'
import {
  makeEmptyDraftCue,
  planBatchDelete,
  planBatchMove,
  planReimportDiff,
  planTimeEdit,
} from '../../features/subtitles/batch.ts'
import {
  planCompile,
  SUBTITLE_COMPILE_PATHS,
  type CompileCue,
} from '../../features/subtitles/compile.ts'
import {
  filterCueRows,
  panelDisabledState,
  summarizeRows,
  trackCheckViews,
} from '../../features/subtitles/viewmodel.ts'

// ── 夹具 ────────────────────────────────────────────────────────────────────────

function subtitleObjects(text: string, extra?: Record<string, JsonValue>): JsonObject {
  return {
    layer_type: { value: 'subtitle' },
    text: { value: text },
    x: { value: 0.5 },
    y: { value: 0.88 },
    anchor_x: { value: 0.5 },
    anchor_y: { value: 0.5 },
    scale_x: { value: 1 },
    scale_y: { value: 1 },
    font_scale: { value: 1 },
    opacity: { value: 1 },
    z_index: { value: 10 },
    ...extra,
  }
}

function clipEntry(start: number, duration: number, objects: JsonObject): JsonObject {
  return { start_time: start, duration, objects }
}

function overlayTrack(clips: JsonObject[], name?: string): RawTrack {
  return {
    type: 'OVERLAY',
    name,
    clips: clips.map((clip, index) => ({
      clipKey: `clip#${index}`,
      start: Number(clip.start_time ?? 0),
      duration: Number(clip.duration ?? 0),
      objects: (clip.objects ?? {}) as JsonObject,
    })),
  }
}

function rootFromTracks(tracks: RawTrack[]): JsonObject {
  const root: JsonObject = {
    meta: { id: 'verify12sub', name: 'verify12-sub', author: 'verify12' },
    timeline: {
      tracks: tracks.map((track) => {
        const entry: JsonObject = {
          type: track.type,
          clips: track.clips.map((clip) => ({
            start_time: clip.start,
            duration: clip.duration,
            objects: clip.objects,
          })),
        }
        if (track.name !== undefined) entry.name = track.name
        return entry
      }),
    },
  }
  return root
}

function rawTracksOfDoc(doc: ScriptDoc, handles?: Array<{ trackIndex: number; clipIndex: number; key: string }>): RawTrack[] {
  return tracksOf(doc).map((track, trackIndex) => ({
    type: typeof track.type === 'string' ? track.type : '',
    name: typeof track.name === 'string' ? track.name : undefined,
    clips: clipsOf(track).map((clip, clipIndex) => {
      const handle = handles?.find((item) => item.trackIndex === trackIndex && item.clipIndex === clipIndex)
      return {
        clipKey: handle?.key ?? `clip#${trackIndex}:${clipIndex}`,
        start: Number(clip.start_time ?? 0),
        duration: Number(clip.duration ?? 0),
        objects: objectsOf(clip),
      }
    }),
  }))
}

function rawTracksOfStore(store: DocStore): RawTrack[] {
  const doc = store.doc
  if (doc === null) throw new Error('文档未打开')
  return rawTracksOfDoc(doc, store.registry.handles())
}

function openStore(ctx: VerifyContext, tracks: RawTrack[]): DocStore {
  const store = ctx.createStore()
  store.open(ctx.docFrom(rootFromTracks(tracks)), null)
  return store
}

function commitCompound(store: DocStore, commands: DocCommand[]): void {
  if (commands.length === 0) return
  const outcome = store.commit({ kind: 'compound', commands })
  if (!outcome.ok) throw new Error(`命令提交失败: ${outcome.error ?? 'unknown'}`)
}

function cueOf(cue: ParsedCue, draft = true): CompileCue {
  return {
    cueId: draft ? `draft#${cue.ordinal}` : `clip#${cue.ordinal}`,
    clipKey: draft ? null : `clip#${cue.ordinal}`,
    trackIndex: draft ? null : 0,
    ordinal: cue.ordinal,
    start: cue.start,
    end: cue.end,
    text: cue.text,
    draft,
  }
}

// ── 入口 ──────────────────────────────────────────────────────────────────────────

export function runSubtitles(check: CheckFn, ctx: VerifyContext): void {
  // ── A. 解析 / 编码 / 前缀 ──────────────────────────────────────────────────────

  const srtBasic = [
    '1',
    '00:00:01,000 --> 00:00:03,500',
    '第一行',
    '第二行',
    '',
    '00:00:04,250 --> 00:00:06,000',
    '没有序号行的 cue',
  ].join('\n')
  const srtParsed = parseSubtitleText(srtBasic, 'srt')
  check('A1 SRT 解析出两条 cue', srtParsed.cues.length === 2, srtParsed.cues.length)
  check('A1 SRT 首条时间 1.000–3.500',
    Math.abs(srtParsed.cues[0].start - 1) < 1e-6 && Math.abs(srtParsed.cues[0].end - 3.5) < 1e-6,
    [srtParsed.cues[0].start, srtParsed.cues[0].end])
  check('A1 SRT 多行文本保留换行', srtParsed.cues[0].text === '第一行\n第二行', srtParsed.cues[0].text)
  check('A1 SRT 序号行可无', srtParsed.cues[1].text === '没有序号行的 cue', srtParsed.cues[1].text)

  const srtErrors = [
    '1',
    '00:00:01,000 --> 00:00:02,000',
    '',
    '',
    '2',
    '00:00:05,000 --> 00:00:04,000',
    '结束早于开始',
    '',
    '3',
    '这一块没有时间行',
  ].join('\n')
  const srtErrorParsed = parseSubtitleText(srtErrors, 'srt')
  check('A2 SRT 空文本标 error', srtErrorParsed.cues[0].error !== undefined, srtErrorParsed.cues[0].error)
  check('A2 SRT 结束≤开始标 error', srtErrorParsed.cues[1].error !== undefined, srtErrorParsed.cues[1].error)
  check('A2 SRT 时间行缺失标 error', srtErrorParsed.cues[2].error !== undefined, srtErrorParsed.cues[2].error)
  check('A2 SRT 三条错误都进 errors', srtErrorParsed.errors.length === 3, srtErrorParsed.errors.length)

  const vttSample = [
    'WEBVTT',
    '',
    'NOTE 这是注释块，整段跳过',
    '',
    'STYLE',
    '::cue { color: red; }',
    '',
    'REGION id:r1 width:40%',
    '',
    'cue-one',
    '00:00:01.000 --> 00:00:03.000 align:start position:10%',
    '<v Fred>你好 &amp; 世界</v>',
    '',
    '00:04.000 --> 00:06.000',
    '第二句 &lt;标签&gt; &amp;amp;',
  ].join('\n')
  const vttParsed = parseSubtitleText(vttSample, 'vtt')
  check('A3 VTT 解析出两条 cue', vttParsed.cues.length === 2, vttParsed.cues.length)
  check('A3 VTT 标记去除只留可读文本', vttParsed.cues[0].text === '你好 & 世界', vttParsed.cues[0].text)
  check('A3 VTT 实体解码一次（&amp;amp; 不二次解码）', vttParsed.cues[1].text === '第二句 <标签> &amp;', vttParsed.cues[1].text)
  check('A3 VTT 设置项整段忽略并计数', vttParsed.ignoredSettings === 1, vttParsed.ignoredSettings)
  check('A3 VTT 不带小时时间写法可用', Math.abs(vttParsed.cues[1].start - 4) < 1e-6, vttParsed.cues[1].start)

  const vttNoCue = 'WEBVTT\n\nNOTE 只有注释\n'
  const vttEmpty = parseSubtitleText(vttNoCue, 'vtt')
  check('A6 VTT 无 cue 视为错误且不生成空批次', vttEmpty.empty && vttEmpty.errors.length > 0 && vttEmpty.cues.length === 0,
    { empty: vttEmpty.empty, errors: vttEmpty.errors.length, cues: vttEmpty.cues.length })

  const langSample = [
    '1',
    '00:00:01,000 --> 00:00:02,000',
    '@lang:menu.title',
    '',
    '2',
    '00:00:03,000 --> 00:00:04,000',
    '@@lang:menu.keep',
    '',
    '3',
    '00:00:05,000 --> 00:00:06,000',
    '正文中间 @lang:middle 不动',
  ].join('\n')
  const langParsed = parseSubtitleText(langSample, 'srt')
  check('A4 单 @lang: 转义成 @@lang:', langParsed.cues[0].text === '@@lang:menu.title', langParsed.cues[0].text)
  check('A4 双 @@lang: 保留不改写', langParsed.cues[1].text === '@@lang:menu.keep', langParsed.cues[1].text)
  check('A4 双 @ 给警告', langParsed.cues[1].warnings.length > 0, langParsed.cues[1].warnings)
  check('A4 正文中间前缀不动', langParsed.cues[2].text === '正文中间 @lang:middle 不动', langParsed.cues[2].text)

  // 编码：UTF-8 BOM / UTF-16LE BOM / 严格 UTF-8 失败需选编码 / GB18030 / 仍失败。
  const utf8Bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('你好')])
  const utf8Ok = decodeSubtitleBytes(utf8Bom)
  check('A5 UTF-8 BOM 解码成功', utf8Ok.ok && utf8Ok.text === '你好' && utf8Ok.encoding === 'utf-8', utf8Ok)

  const utf16leBody = Buffer.from('你好', 'utf16le')
  const utf16le = new Uint8Array([0xff, 0xfe, ...utf16leBody])
  const utf16Ok = decodeSubtitleBytes(utf16le)
  check('A5 UTF-16LE BOM 解码成功', utf16Ok.ok && utf16Ok.text === '你好', utf16Ok)

  const invalidUtf8 = new Uint8Array([0xc3, 0x28])
  const needsEncoding = decodeSubtitleBytes(invalidUtf8)
  check('A5 严格 UTF-8 失败给 needs-encoding（不猜编码）', !needsEncoding.ok && needsEncoding.reason === 'needs-encoding', needsEncoding)

  const gbBytes = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3])
  const gbOk = decodeSubtitleBytes(gbBytes, 'gb18030')
  check('A5 显式 GB18030 解码成功', gbOk.ok && gbOk.text === '你好', gbOk)

  const stillFailed = decodeSubtitleBytes(invalidUtf8, 'utf-8')
  check('A5 显式 UTF-8 仍失败给 decode-failed', !stillFailed.ok && stillFailed.reason === 'decode-failed', stillFailed)

  check('A7 扩展名识别 srt/vtt', subtitleFormatOf('a.SRT') === 'srt' && subtitleFormatOf('b.vtt') === 'vtt',
    [subtitleFormatOf('a.SRT'), subtitleFormatOf('b.vtt')])

  // ── B. 草稿导入 / 自动分轨 / 重开恢复 ──────────────────────────────────────────

  const importCues = parseSubtitleText(
    ['1', '00:00:01,000 --> 00:00:03,000', '第一条', '', '2', '00:00:04,000 --> 00:00:06,000', '第二条'].join('\n'),
    'srt',
  ).cues

  // 确认前文档不变：计划只产命令，store 文档片段数为 0。
  const draftStore = openStore(ctx, [])
  const draftPlan = planCompile({ mode: 'draft', cues: importCues.map((cue) => cueOf(cue)), tracks: [], source: 'import' })
  const draftBefore = rawTracksOfStore(draftStore)
  check('B1 导入只产草稿计划，确认前文档片段数为 0',
    draftBefore.every((track) => track.clips.length === 0),
    draftBefore.reduce((n, track) => n + track.clips.length, 0))
  check('B1 草稿计划命令在确认后才提交', draftPlan.commands.length > 0, draftPlan.commands.length)

  commitCompound(draftStore, draftPlan.commands)
  const afterDraft = rawTracksOfDoc(draftStore.doc as ScriptDoc)
  check('B1 确认后编译出两条片段', afterDraft.reduce((n, track) => n + track.clips.length, 0) === 2, afterDraft)

  // 重叠 cue 自动分轨，同轨无重叠。
  const overlapCues: ParsedCue[] = [
    { ordinal: 1, start: 0, end: 2, text: 'A', sourceText: 'A', format: 'srt', warnings: [] },
    { ordinal: 2, start: 1, end: 3, text: 'B', sourceText: 'B', format: 'srt', warnings: [] },
    { ordinal: 3, start: 2.5, end: 4.5, text: 'C', sourceText: 'C', format: 'srt', warnings: [] },
  ]
  const pack = planPackCues({ cues: overlapCues, tracks: [] })
  const trackOfCue = new Map(pack.assignments.map((assignment) => [assignment.cueOrdinal, assignment.trackIndex]))
  check('B2 三条重叠 cue 分到两条轨', new Set(pack.assignments.map((a) => a.trackIndex)).size === 2, pack.assignments)
  check('B2 同轨不重叠',
    trackOfCue.get(1) !== trackOfCue.get(2) && trackOfCue.get(1) === trackOfCue.get(3),
    { a: trackOfCue.get(1), b: trackOfCue.get(2), c: trackOfCue.get(3) })

  // 保存重开：cue 表条数 / 时间 / 文本 / 布局一致。
  const seedTracks: RawTrack[] = [
    overlayTrack([
      clipEntry(0, 2, subtitleObjects('开场字幕')),
      clipEntry(3, 2.2, subtitleObjects('第二段')),
    ]),
  ]
  const persistStore = openStore(ctx, seedTracks)
  const beforeRows = deriveCueRows(rawTracksOfStore(persistStore))
  persistStore.open(persistStore.doc as ScriptDoc, null)
  const afterRows = deriveCueRows(rawTracksOfStore(persistStore))
  check('B3 重开后 cue 条数一致', beforeRows.length === afterRows.length, { before: beforeRows.length, after: afterRows.length })
  check('B3 重开后时间一致',
    beforeRows.every((row, index) => Math.abs(row.start - afterRows[index].start) < 1e-6 && Math.abs(row.end - afterRows[index].end) < 1e-6),
    afterRows.map((row) => [row.start, row.end]))
  check('B3 重开后文本一致', beforeRows.every((row, index) => row.text === afterRows[index].text), afterRows.map((row) => row.text))
  const beforeObjects = rawTracksOfStore(persistStore)[0].clips[0].objects
  const beforeX = beforeObjects.x as JsonObject | undefined
  const beforeY = beforeObjects.y as JsonObject | undefined
  check('B3 重开后布局一致', beforeX?.value === 0.5 && beforeY?.value === 0.88, beforeObjects)

  // ── C. 重导入 diff 四类 ────────────────────────────────────────────────────────

  const existingRows: CueRow[] = [
    { cueId: 'k-a', clipKey: 'k-a', trackIndex: 0, start: 0, end: 2, duration: 2, text: '你好', lines: 1, statuses: [], draft: false },
    { cueId: 'k-b', clipKey: 'k-b', trackIndex: 0, start: 3, end: 5, duration: 2, text: '再见', lines: 1, statuses: [], draft: false },
    { cueId: 'k-c', clipKey: 'k-c', trackIndex: 0, start: 7, end: 9, duration: 2, text: '缺失条', lines: 1, statuses: [], draft: false },
  ]
  const incoming: ParsedCue[] = [
    { ordinal: 1, start: 0.02, end: 2.02, text: '你好', sourceText: '你好', format: 'srt', warnings: [] },
    { ordinal: 2, start: 3, end: 5, text: '被手改后的文本', sourceText: '被手改后的文本', format: 'srt', warnings: [] },
    { ordinal: 3, start: 6, end: 8, text: '新增条', sourceText: '新增条', format: 'srt', warnings: [] },
  ]
  const diff = planReimportDiff({ incoming, existing: existingRows })
  const byCategory = (category: string) => diff.filter((entry) => entry.category === category)
  check('C1 diff 分类 unchanged', byCategory('unchanged').length === 1, byCategory('unchanged').map((e) => e.cueId))
  check('C1 diff 分类 changed（默认保留手改）', byCategory('changed').length === 1, byCategory('changed').map((e) => e.existing?.text))
  check('C1 diff 分类 added', byCategory('added').length === 1, byCategory('added').map((e) => e.incoming?.text))
  check('C1 diff 分类 missing（默认不删）', byCategory('missing').length === 1, byCategory('missing').map((e) => e.existing?.text))
  check('C1 diff 不产删除命令（默认保留）', diff.every((entry) => entry.category !== 'missing' || entry.existing !== undefined), diff)

  // ── D. 批量移动 / 删除事务与撤销 ───────────────────────────────────────────────

  const batchTracks: RawTrack[] = [
    overlayTrack([clipEntry(0, 2, subtitleObjects('甲')), clipEntry(3, 2, subtitleObjects('乙'))]),
  ]
  const moveStore = openStore(ctx, batchTracks)
  const moveRows = deriveCueRows(rawTracksOfStore(moveStore))
  const movePlan = planBatchMove([moveRows[0]], 1, deriveTracks(rawTracksOfStore(moveStore)))
  check('D1 批量移动产出一条事务命令', movePlan.blockers.length === 0 && movePlan.commands.length === 1, movePlan)
  commitCompound(moveStore, movePlan.commands)
  const movedRows = deriveCueRows(rawTracksOfStore(moveStore))
  check('D1 移动后起点 +1', Math.abs(movedRows[0].start - 1) < 1e-6, movedRows[0].start)
  moveStore.undo()
  const undoneRows = deriveCueRows(rawTracksOfStore(moveStore))
  check('D1 撤销后回到原起点', Math.abs(undoneRows[0].start - 0) < 1e-6, undoneRows[0].start)

  const deleteStore = openStore(ctx, batchTracks)
  const deleteRows = deriveCueRows(rawTracksOfStore(deleteStore))
  const deletePlan = planBatchDelete([deleteRows[0]])
  check('D2 批量删除一次事务多条 remove', deletePlan.blockers.length === 0 && deletePlan.commands.length === 1, deletePlan)
  commitCompound(deleteStore, deletePlan.commands)
  const afterDelete = rawTracksOfStore(deleteStore)
  check('D2 删除后剩一条片段（轨保留）', afterDelete.reduce((n, t) => n + t.clips.length, 0) === 1, afterDelete.length)
  deleteStore.undo()
  check('D2 撤销后片段恢复', rawTracksOfStore(deleteStore).reduce((n, t) => n + t.clips.length, 0) === 2)

  const negPlan = planBatchMove([moveRows[0]], -1, deriveTracks(rawTracksOfStore(moveStore)))
  check('D3 移动后越界汇总报错且不提交命令', negPlan.blockers.length > 0 && negPlan.commands.length === 0, negPlan.blockers)

  const timeEditPlan = planTimeEdit(deleteRows[0], 1, 3, deleteRows)
  check('D4 单条时间编辑产出 setStart + setDuration', timeEditPlan.commands.length === 2, timeEditPlan.commands)
  const overlapEdit = planTimeEdit(deleteRows[0], 2.5, 4, deleteRows)
  check('D4 时间编辑同轨重叠拒绝', overlapEdit.blockers.length > 0 && overlapEdit.commands.length === 0, overlapEdit.blockers)

  const emptyDraft = makeEmptyDraftCue({ playhead: 1.5, ordinal: 1 })
  check('D5 新建空 cue 播放头起点 / 默认两秒 / 空文本标记',
    emptyDraft.start === 1.5 && Math.abs(emptyDraft.end - 3.5) < 1e-6 && emptyDraft.text === '' && emptyDraft.error !== undefined,
    emptyDraft)

  // ── E. 编译 ────────────────────────────────────────────────────────────────────

  // E1 草稿编译：3.0–5.2 → start 3 duration 2.2；字段面完整且无越界键。
  const e1Cue: CompileCue = { cueId: 'draft#1', clipKey: null, trackIndex: null, ordinal: 1, start: 3, end: 5.2, text: '编译时间核对', draft: true }
  const e1Plan = planCompile({ mode: 'draft', cues: [e1Cue], tracks: [], source: 'hand' })
  check('E1 草稿编译无阻塞', e1Plan.blockers.length === 0, e1Plan.blockers)
  const e1Store = openStore(ctx, [])
  commitCompound(e1Store, e1Plan.commands)
  const e1Tracks = rawTracksOfDoc(e1Store.doc as ScriptDoc)
  const e1Clip = e1Tracks[0]?.clips[0]
  check('E1 cue 3.0–5.2 → start 3 / duration 2.2',
    e1Clip !== undefined && Math.abs(e1Clip.start - 3) < 1e-6 && Math.abs(e1Clip.duration - 2.2) < 1e-6,
    e1Clip ? [e1Clip.start, e1Clip.duration] : null)
  const e1Keys = e1Clip ? Object.keys(e1Clip.objects).sort() : []
  check('E1 产物字段面 = 固定字幕字段集合',
    e1Keys.length === SUBTITLE_COMPILE_PATHS.length && SUBTITLE_COMPILE_PATHS.every((path) => e1Keys.includes(path)),
    e1Keys)
  const forbidden = new Set([
    'color', 'color.r', 'color.g', 'color.b',
    'source.x', 'source.y', 'source.w', 'source.h',
    'path', 'gradient', 'mask_x', 'mask_y', 'mask_width', 'mask_height', 'mask_radius', 'mask_shape',
    'gradient_angle', 'gradient_center_x', 'gradient_center_y', 'gradient_radius', 'blend_mode',
  ])
  check('E1 产物不含颜色/素材/路径/遮罩/渐变/混合模式键',
    e1Keys.every((key) => !forbidden.has(key)),
    e1Keys)

  // E2 同轨重叠拒绝（变更编译）。
  const e2Tracks: RawTrack[] = [overlayTrack([
    clipEntry(0, 2, subtitleObjects('既有甲')),
    clipEntry(3, 2, subtitleObjects('既有乙')),
  ])]
  const e2Store = openStore(ctx, e2Tracks)
  const e2Existing = deriveCueRows(rawTracksOfStore(e2Store))
  const e2Plan = planCompile({
    mode: 'changed',
    cues: [{ cueId: e2Existing[0].cueId, clipKey: e2Existing[0].clipKey, trackIndex: 0, ordinal: 1, start: 3.5, end: 5.5, text: '压到同轨', draft: false }],
    tracks: rawTracksOfStore(e2Store),
    source: 'hand',
  })
  check('E2 同轨重叠编译被拒绝（blocker）', e2Plan.blockers.length > 0 && e2Plan.commands.length === 0, e2Plan.blockers)

  // E3 变更编译保留 exit / 透明度关键帧；超时长帧给警告。
  const opacityFrames = [{ time: 0, value: 1 }, { time: 1.5, value: 0.8 }]
  const e3Tracks: RawTrack[] = [overlayTrack([clipEntry(0, 2, subtitleObjects('旧文本', { opacity: { value: 1, keyframes: opacityFrames } }))])]
  const e3Seed = openStore(ctx, e3Tracks)
  const e3Existing = deriveCueRows(rawTracksOfStore(e3Seed))
  const e3Plan = planCompile({
    mode: 'changed',
    cues: [{ cueId: e3Existing[0].cueId, clipKey: e3Existing[0].clipKey, trackIndex: 0, ordinal: 1, start: 0, end: 1, text: '新文本', draft: false }],
    tracks: rawTracksOfStore(e3Seed),
    source: 'hand',
  })
  check('E3 变更编译不阻塞', e3Plan.blockers.length === 0, e3Plan.blockers)
  const e3Store = openStore(ctx, e3Tracks)
  commitCompound(e3Store, e3Plan.commands)
  const e3Clip = rawTracksOfStore(e3Store)[0].clips[0]
  const e3Opacity = e3Clip.objects.opacity as JsonObject
  const e3Frames = Array.isArray(e3Opacity.keyframes) ? (e3Opacity.keyframes as unknown as ObjectKeyframe[]) : []
  check('E3 透明度关键帧保留（不重置）',
    e3Frames.length === 2 && e3Frames[1].time === 1.5,
    e3Frames)
  check('E3 关键帧超出新时长给警告', e3Plan.warnings.some((warning) => warning.includes('超出新时长')), e3Plan.warnings)

  // E4 空文本跳过并警告。
  const e4Plan = planCompile({
    mode: 'draft',
    cues: [{ cueId: 'draft#1', clipKey: null, trackIndex: null, ordinal: 1, start: 0, end: 2, text: '   ', draft: true }],
    tracks: [],
    source: 'hand',
  })
  check('E4 空文本跳过且不产命令', e4Plan.skippedCues === 1 && e4Plan.commands.length === 0, { skipped: e4Plan.skippedCues, warnings: e4Plan.warnings })

  // E5 非正缩放 / 低透明度警告。
  const e5Plan = planCompile({
    mode: 'draft',
    cues: [{ cueId: 'draft#1', clipKey: null, trackIndex: null, ordinal: 1, start: 0, end: 2, text: '警告核对', draft: true }],
    tracks: [],
    source: 'hand',
  })
  const e5Tracks: RawTrack[] = [overlayTrack([clipEntry(0, 2, subtitleObjects('低可见', {
    scale_x: { value: 0 },
    font_scale: { value: -1 },
    opacity: { value: 0.0005 },
  }))])]
  const e5Seed = openStore(ctx, e5Tracks)
  const e5Existing = deriveCueRows(rawTracksOfStore(e5Seed))
  const e5Changed = planCompile({
    mode: 'changed',
    cues: [{ cueId: e5Existing[0].cueId, clipKey: e5Existing[0].clipKey, trackIndex: 0, ordinal: 1, start: 0, end: 2, text: '低可见', draft: false }],
    tracks: rawTracksOfStore(e5Seed),
    source: 'hand',
  })
  check('E5 非正缩放 / 字号给警告', e5Changed.warnings.some((w) => w.includes('缩放非正')) && e5Changed.warnings.some((w) => w.includes('字号非正')), e5Changed.warnings)
  check('E5 低透明度给警告', e5Changed.warnings.some((w) => w.includes('透明度低于可见阈值')), e5Changed.warnings)
  void e5Plan

  // E6 编译产物过结构校验。
  const e6Issues = validateStructure(e1Store.doc as ScriptDoc, {
    catalog: ctx.catalog,
    metaKeys: ctx.metaKeys,
    registry: e1Store.registry,
  })
  check('E6 草稿编译产物过 validateStructure', e6Issues.length === 0, e6Issues.map((issue) => `${issue.code} ${issue.message}`))

  // E7 外部导入未转义单前缀报错；手写允许。
  const e7Import = planCompile({
    mode: 'draft',
    cues: [{ cueId: 'draft#1', clipKey: null, trackIndex: null, ordinal: 1, start: 0, end: 2, text: '@lang:menu.title', draft: true }],
    tracks: [],
    source: 'import',
  })
  check('E7 外部导入未转义单前缀报错并提示回向导', e7Import.blockers.length > 0 && e7Import.commands.length === 0, e7Import.blockers)
  const e7Hand = planCompile({
    mode: 'draft',
    cues: [{ cueId: 'draft#1', clipKey: null, trackIndex: null, ordinal: 1, start: 0, end: 2, text: '@lang:menu.title', draft: true }],
    tracks: [],
    source: 'hand',
  })
  check('E7 手写单前缀允许', e7Hand.blockers.length === 0, e7Hand.blockers)

  // ── F. 面板纯视图模型 ─────────────────────────────────────────────────────────

  const disabledClosed = panelDisabledState({ docOpen: false, hasCompiledRows: false, selectedCount: 0, hasDraftCues: false })
  check('F1 文档未打开时全部禁用',
    disabledClosed.importDisabled && disabledClosed.reimportDisabled && disabledClosed.compileDisabled && disabledClosed.moveDisabled && disabledClosed.deleteDisabled,
    disabledClosed)
  const disabledOpen = panelDisabledState({ docOpen: true, hasCompiledRows: true, selectedCount: 1, hasDraftCues: false })
  check('F1 有文档有选中时移动启用 / 重导入启用',
    !disabledOpen.moveDisabled && !disabledOpen.reimportDisabled && disabledOpen.compileDisabled === false,
    disabledOpen)

  const summaryRows: CueRow[] = [
    { cueId: 'r1', clipKey: 'r1', trackIndex: 0, start: 0, end: 2, duration: 2, text: '甲', lines: 1, statuses: ['overlap'], draft: false },
    { cueId: 'r2', clipKey: 'r2', trackIndex: 1, start: 1, end: 3, duration: 2, text: '乙', lines: 1, statuses: ['conflict', 'empty-text'], draft: false },
    { cueId: 'd1', clipKey: null, trackIndex: null, start: 4, end: 6, duration: 2, text: '草稿', lines: 1, statuses: [], draft: true, issue: '文本为空' },
  ]
  const summary = summarizeRows(summaryRows, new Set(['r1']))
  check('F2 摘要数字：总数 / 已选 / 草稿 / 错误 / 重叠 / 冲突 / 空文本',
    summary.total === 3 && summary.selected === 1 && summary.draft === 1 && summary.errors === 1 &&
    summary.overlap === 1 && summary.conflict === 1 && summary.emptyText === 1,
    summary)

  const filtered = filterCueRows(summaryRows, { query: '乙', selectedTracks: null })
  check('F3 文本筛选命中一条', filtered.length === 1 && filtered[0].cueId === 'r2', filtered.map((r) => r.cueId))
  const trackViews = trackCheckViews(deriveTracks(e3Tracks), null, deriveCueRows(e3Tracks))
  check('F3 轨道勾选条默认全选且带 cue 数 / 时间范围',
    trackViews.length === 1 && trackViews[0].checked && trackViews[0].cueCount === 1 && trackViews[0].timeRange !== null,
    trackViews)
}

// ── 独立运行入口 ──────────────────────────────────────────────────────────────────

const invokedPath = process.argv[1] !== undefined ? fileURLToPath(import.meta.url) : ''
if (invokedPath !== '' && process.argv[1] === invokedPath) {
  const runner = createCheckRunner()
  const context = createVerifyContext('verify12-subtitles')
  runSubtitles(runner.check, context)
  runner.print()
}
