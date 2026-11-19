/**
 * 12 轮「联调夹具」生成入口（只写运行时脚本 JSON，不手写 JSON）。
 *
 * 全部走编辑器真实代码路径：
 * - 模板：`planGeneration(GenerationRequest)` → `store.commit(plan.command)` → `serializeDoc`；
 * - 字幕：`parseSubtitleText` → `planPackCues` → `planCompile({mode:'draft', source:'import'})`
 *   → 复合命令一次提交 → `serializeDoc`。
 *
 * 每份写盘前必须 `parseDoc` 回读 + `validateStructure` 0 issue，否则抛错退出。
 *
 * 运行：`node --experimental-strip-types src/workbench/emit-fixtures-12.ts`（或 `npm run fixtures:12`）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createVerifyContext, clipsOf, objectsOf, tracksOf, type VerifyContext } from './verify12/context.ts'
import {
  planGeneration,
  templateById,
  defaultParams,
  type GenerationRequest,
  type ParamValue,
  type PoseValue,
} from '../features/templates/public.ts'
import { parseSubtitleText, type ParsedCue } from '../features/subtitles/parse.ts'
import { planPackCues } from '../features/subtitles/cues.ts'
import { planCompile, type CompileCue } from '../features/subtitles/compile.ts'
import { parseDoc } from '../core/doc/parse.ts'
import { serializeDoc } from '../core/doc/serialize.ts'
import { validateStructure } from '../core/doc/structural.ts'
import type { DocCommand } from '../core/doc/commands.ts'
import type { DocStore } from '../core/doc/store.ts'
import type { JsonObject, ScriptDoc } from '../core/doc/types.ts'

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const MODULE_ROOT = process.env.IC_MODULE_ROOT ?? join(dirname(REPO_ROOT), 'ImmersiveCinematics')
const SCRIPTS_DIR = join(MODULE_ROOT, 'fabric', 'run', 'immersive_cinematics', 'scripts')
const OUTPUT_TXT = process.env.FIXTURES_OUTPUT_TXT
  ?? join(REPO_ROOT, 'e2e-artifacts', 'fixtures-12-output.txt')

const logLines: string[] = []
function log(line: string): void {
  logLines.push(line)
  console.log(line)
}

function pose(over: Partial<PoseValue> = {}): PoseValue {
  return {
    position: { x: 0, y: 1.6, z: 0 },
    yaw: 0, pitch: 0, roll: 0, fov: 70, zoom: 1,
    ...over,
  }
}

interface FixtureMeta {
  id: string
  name: string
  author: string
}

function seededDoc(ctx: VerifyContext, meta: FixtureMeta): ScriptDoc {
  const root: JsonObject = {
    meta: { id: meta.id, name: meta.name, author: meta.author },
    timeline: { tracks: [] },
  }
  return ctx.docFrom(root)
}

function openSeededStore(ctx: VerifyContext, meta: FixtureMeta): DocStore {
  const store = ctx.createStore()
  store.open(seededDoc(ctx, meta), null)
  return store
}

function commitPlan(store: DocStore, plan: ReturnType<typeof planGeneration>, label: string): void {
  if (!plan.ok || plan.command === null) {
    throw new Error(`${label} 计划失败：${plan.diagnostics.map((d) => `${d.code} ${d.message}`).join('；')}`)
  }
  const outcome = store.commit(plan.command)
  if (!outcome.ok) {
    throw new Error(`${label} 提交失败：${outcome.error ?? 'unknown'}`)
  }
}

function commitCompound(store: DocStore, commands: DocCommand[]): void {
  if (commands.length === 0) throw new Error('编译计划为空命令序列')
  const outcome = store.commit({ kind: 'compound', commands })
  if (!outcome.ok) throw new Error(`复合命令提交失败：${outcome.error ?? 'unknown'}`)
}

interface DocStats {
  trackCount: number
  clipCount: number
  subtitleClipCount: number
  pathCount: number
}

function statsOf(doc: ScriptDoc): DocStats {
  const tracks = tracksOf(doc)
  let clipCount = 0
  let subtitleClipCount = 0
  for (const track of tracks) {
    for (const clip of clipsOf(track)) {
      clipCount += 1
      const objects = objectsOf(clip)
      const layer = objects.layer_type
      if (layer !== undefined && (layer as JsonObject).value === 'subtitle') {
        subtitleClipCount += 1
      }
    }
  }
  const paths = doc.root.paths
  const pathCount = Array.isArray(paths) ? paths.length : 0
  return { trackCount: tracks.length, clipCount, subtitleClipCount, pathCount }
}

/** 序列化 → parseDoc 回读 → validateStructure；通过后写盘。返回回读校验结果。 */
function writeValidated(ctx: VerifyContext, store: DocStore, fileName: string, label: string): {
  absolutePath: string
  stats: DocStats
  parseOk: boolean
  issues: string[]
} {
  const doc = store.doc
  if (doc === null) throw new Error(`${label} 文档未打开`)
  const root = serializeDoc(doc)

  const parsed = parseDoc(root, { metaKeys: ctx.metaKeys })
  if (!parsed.ok) {
    throw new Error(`${label} parseDoc 回读失败：${parsed.issues.map((i) => `${i.code} ${i.jsonPath}: ${i.message}`).join('；')}`)
  }
  const issues = validateStructure(parsed.doc, { catalog: ctx.catalog, metaKeys: ctx.metaKeys, registry: store.registry })
  const blockIssues = issues.filter((issue) => issue.severity === 'block' || issue.severity === 'error')
  if (blockIssues.length > 0) {
    throw new Error(`${label} validateStructure 未通过：${blockIssues.map((i) => `${i.code} ${i.message}`).join('；')}`)
  }

  mkdirSync(SCRIPTS_DIR, { recursive: true })
  const absolutePath = join(SCRIPTS_DIR, fileName)
  writeFileSync(absolutePath, JSON.stringify(root, null, 2), 'utf8')

  return { absolutePath, stats: statsOf(parsed.doc), parseOk: parsed.ok, issues: issues.map((i) => `${i.severity} ${i.code} ${i.message}`) }
}

function templateParams(ctx: VerifyContext, templateId: string, overrides: Record<string, ParamValue>): Record<string, ParamValue> {
  const def = templateById(templateId)
  if (def === null) throw new Error(`模板未登记：${templateId}`)
  return { ...defaultParams(def), ...overrides }
}

// ── 夹具 A：script.camera_intro（脚本层单链路）──────────────────────────────────

function emitCameraIntro(ctx: VerifyContext): void {
  const meta: FixtureMeta = { id: 'r12_camera_intro', name: 'R12 相机开场', author: 'fixtures-12' }
  const store = openSeededStore(ctx, meta)

  const params = templateParams(ctx, 'script.camera_intro', {
    cameraPose: pose(),
    cameraDuration: 3,
    letterboxRatio: 2.35,
    blackDuration: 1,
  })
  const request: GenerationRequest = {
    templateId: 'script.camera_intro',
    params,
    target: { mode: 'newDocument' },
    doc: store.doc,
    catalog: ctx.catalog,
    playhead: 0,
    selectedClipKeys: [],
  }
  const plan = planGeneration(request)
  commitPlan(store, plan, 'r12_camera_intro')

  const result = writeValidated(ctx, store, 'r12_camera_intro.json', 'r12_camera_intro')
  log(`[A] r12_camera_intro`)
  log(`    路径: ${result.absolutePath}`)
  log(`    结构: 轨道 ${result.stats.trackCount} / 片段 ${result.stats.clipCount} / 路径 ${result.stats.pathCount}`)
  log(`    回读 parseDoc: ok=${result.parseOk}；validateStructure issues=${result.issues.length}${result.issues.length > 0 ? `（${result.issues.join('；')}）` : ''}`)
}

// ── 夹具 B：camera_intro + clip.dolly(atPlayhead) + track.orbit_full(appendTrack) ─

function emitTemplateMix(ctx: VerifyContext): void {
  const meta: FixtureMeta = { id: 'r12_template_mix', name: 'R12 模板混合', author: 'fixtures-12' }
  const store = openSeededStore(ctx, meta)

  // 1) 脚本层：相机开场，落出首条相机片段 [0,3)。
  const introParams = templateParams(ctx, 'script.camera_intro', {
    cameraPose: pose(),
    cameraDuration: 3,
    letterboxRatio: 2.35,
    blackDuration: 1,
  })
  const introPlan = planGeneration({
    templateId: 'script.camera_intro',
    params: introParams,
    target: { mode: 'newDocument' },
    doc: store.doc,
    catalog: ctx.catalog,
    playhead: 0,
    selectedClipKeys: [],
  })
  commitPlan(store, introPlan, 'r12_template_mix / camera_intro')

  // 2) 片段层：dolly 放到相机轨道、播放头 3s 处 → [3,6)。
  const dollyParams = templateParams(ctx, 'clip.dolly', {
    duration: 3,
    startPose: pose({ position: { x: 0, y: 1.6, z: 0 }, yaw: 0, pitch: 0 }),
    endPose: pose({ position: { x: 4, y: 2, z: -3 }, yaw: 20, pitch: -5 }),
    lookMode: 'angles',
  })
  const dollyPlan = planGeneration({
    templateId: 'clip.dolly',
    params: dollyParams,
    target: { mode: 'atPlayhead' },
    doc: store.doc,
    catalog: ctx.catalog,
    playhead: 3,
    selectedClipKeys: [],
  })
  commitPlan(store, dollyPlan, 'r12_template_mix / clip.dolly')

  // 3) 轨道层：整圈环绕追加到相机轨道末端 → 6s 起四段。
  const orbitParams = templateParams(ctx, 'track.orbit_full', {
    duration: 8,
    centerX: 0,
    centerZ: 0,
    height: 2,
    radius: 5,
    turns: 1,
    segments: 4,
    clockwise: false,
    lookMode: 'center',
    fov: 70,
  })
  const orbitPlan = planGeneration({
    templateId: 'track.orbit_full',
    params: orbitParams,
    target: { mode: 'appendTrack' },
    doc: store.doc,
    catalog: ctx.catalog,
    playhead: 0,
    selectedClipKeys: [],
  })
  commitPlan(store, orbitPlan, 'r12_template_mix / track.orbit_full')

  const result = writeValidated(ctx, store, 'r12_template_mix.json', 'r12_template_mix')
  log(`[B] r12_template_mix`)
  log(`    路径: ${result.absolutePath}`)
  log(`    结构: 轨道 ${result.stats.trackCount} / 片段 ${result.stats.clipCount} / 路径 ${result.stats.pathCount}`)
  log(`    回读 parseDoc: ok=${result.parseOk}；validateStructure issues=${result.issues.length}${result.issues.length > 0 ? `（${result.issues.join('；')}）` : ''}`)
}

// ── 夹具 C：字幕导入（SRT 解析 → 打包分轨 → 草稿编译）────────────────────────────

const SRT_FIXTURE = [
  '1',
  '00:00:01,000 --> 00:00:03,000',
  '第一行字幕',
  '第二行字幕',
  '',
  '2',
  '00:00:02,500 --> 00:00:04,000',
  '重叠分轨第二条',
  '',
  '3',
  '00:00:05,000 --> 00:00:07,000',
  '@lang:menu.title',
  '',
  '4',
  '00:00:07,500 --> 00:00:09,500',
  '第四条收尾字幕',
].join('\n')

function cueOf(cue: ParsedCue): CompileCue {
  return {
    cueId: `draft#${cue.ordinal}`,
    clipKey: null,
    trackIndex: null,
    ordinal: cue.ordinal,
    start: cue.start,
    end: cue.end,
    text: cue.text,
    draft: true,
  }
}

function emitSubtitles(ctx: VerifyContext): void {
  const meta: FixtureMeta = { id: 'r12_subtitles', name: 'R12 字幕夹具', author: 'fixtures-12' }
  const store = openSeededStore(ctx, meta)

  const parsed = parseSubtitleText(SRT_FIXTURE, 'srt')
  if (parsed.empty || parsed.cues.length === 0) {
    throw new Error(`字幕解析为空：errors=${parsed.errors.map((e) => e.message).join('；')}`)
  }
  const badCues = parsed.cues.filter((cue) => cue.error !== undefined)
  if (badCues.length > 0 || parsed.errors.length > 0) {
    throw new Error(`字幕解析存在错误：cues=${badCues.map((c) => `${c.ordinal}:${c.error}`).join('；')}；errors=${parsed.errors.map((e) => e.message).join('；')}`)
  }

  const pack = planPackCues({ cues: parsed.cues, tracks: [] })
  const assignments = pack.assignments.map((a) => `cue#${a.cueOrdinal}→轨${a.trackIndex}${a.createNew ? '(新)' : ''}`).join('，')

  const plan = planCompile({
    mode: 'draft',
    cues: parsed.cues.map((cue) => cueOf(cue)),
    tracks: [],
    source: 'import',
  })
  if (plan.blockers.length > 0) {
    throw new Error(`字幕编译被阻塞：${plan.blockers.join('；')}`)
  }
  commitCompound(store, plan.commands)

  const result = writeValidated(ctx, store, 'r12_subtitles.json', 'r12_subtitles')
  log(`[C] r12_subtitles`)
  log(`    路径: ${result.absolutePath}`)
  log(`    解析 cue 数: ${parsed.cues.length}；打包分轨: ${assignments}；新建轨数: ${pack.newTrackCount}`)
  log(`    结构: 轨道 ${result.stats.trackCount} / 片段 ${result.stats.clipCount} / 字幕片段 ${result.stats.subtitleClipCount}`)
  log(`    编译 blockers=${plan.blockers.length} skippedCues=${plan.skippedCues} warnings=${plan.warnings.length}`)
  log(`    回读 parseDoc: ok=${result.parseOk}；validateStructure issues=${result.issues.length}${result.issues.length > 0 ? `（${result.issues.join('；')}）` : ''}`)
}

function main(): void {
  const ctx = createVerifyContext('fixtures-12')
  log(`编辑器仓库: ${REPO_ROOT}`)
  log(`模组仓库: ${MODULE_ROOT}`)
  log(`脚本目录: ${SCRIPTS_DIR}`)
  log('')

  emitCameraIntro(ctx)
  log('')
  emitTemplateMix(ctx)
  log('')
  emitSubtitles(ctx)

  mkdirSync(dirname(OUTPUT_TXT), { recursive: true })
  writeFileSync(OUTPUT_TXT, `${logLines.join('\n')}\n`, 'utf8')
  log('')
  log(`夹具输出记录: ${OUTPUT_TXT}`)
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  log(`FATAL 夹具生成失败: ${message}`)
  mkdirSync(dirname(OUTPUT_TXT), { recursive: true })
  writeFileSync(OUTPUT_TXT, `${logLines.join('\n')}\n`, 'utf8')
  process.exitCode = 1
}
