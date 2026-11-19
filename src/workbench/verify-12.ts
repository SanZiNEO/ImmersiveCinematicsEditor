/**
 * 12 轮自检入口：模板 / 嵌套 / 九个模板 / 生成校验 / 面板 / 快捷效果 / 飞控九槽 /
 * 几何工具 / 曲线工具 / 字幕链路 / 静态边界 / 回归。
 *
 * 与 verify.ts、verify-05…verify-11 同一口径：`ok  <label>` / `FAIL <label>: <实际>`，
 * 末行 `summary ok=N fail=M`；任一 FAIL 退出码 1。
 *
 * 本文件只做**编排与静态边界**：各能力的断言在 `verify12/*.ts`，回归复用既有脚本，
 * 不复制它们的断言内容。
 *
 * 运行：`node --experimental-strip-types src/workbench/verify-12.ts`（或 `npm run verify:12`）。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createVerifyContext } from './verify12/context.ts'
import { createCheckRunner, formatActual, type CheckFn } from './verify12/harness.ts'
import { runTemplateModel } from './verify12/templates.ts'
import { runNesting } from './verify12/nesting.ts'
import { runClipTemplates } from './verify12/clipTemplates.ts'
import { runTrackTemplates } from './verify12/trackTemplates.ts'
import { runScriptTemplates } from './verify12/scriptTemplates.ts'
import { runGenerationValidation } from './verify12/generation.ts'
import { runTemplatePanel } from './verify12/panel.ts'
import { runQuickEffects } from './verify12/quickEffects.ts'
import { runFlightPoseBank } from './verify12/flight.ts'
import { runGeometryTools } from './verify12/geometry.ts'
import { runCurveTools } from './verify12/curve.ts'
import { runSubtitles } from './verify12/subtitles.ts'

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))

const runner = createCheckRunner()
const check: CheckFn = runner.check

/** 分组表头（只打印，不计入断言）。 */
function group(title: string): void {
  console.log(`── ${title}`)
}

// ── 静态边界（12-16「合同回归」组：不许新增的东西真的没新增）────────────────────

/** 递归收集给定目录下 `.ts` / `.vue` 文件（相对仓库根）。 */
function sourceFiles(relDirs: readonly string[]): string[] {
  const found: string[] = []
  const walk = (rel: string): void => {
    let entries: string[] = []
    try {
      entries = readdirSync(join(REPO_ROOT, rel))
    } catch {
      return
    }
    for (const entry of entries) {
      const childRel = `${rel}/${entry}`
      const stats = statSync(join(REPO_ROOT, childRel))
      if (stats.isDirectory()) {
        walk(childRel)
        continue
      }
      if (entry.endsWith('.ts') || entry.endsWith('.vue')) {
        found.push(childRel)
      }
    }
  }
  for (const rel of relDirs) {
    walk(rel)
  }
  return found
}

const round12Dirs = [
  'src/features/templates',
  'src/features/generation',
  'src/features/flight',
  'src/features/geometry',
  'src/features/subtitles',
  'src/plugins/core.templates',
  'src/plugins/core.flight',
  'src/plugins/core.geometry',
  'src/plugins/core.subtitles',
  'src/workbench/verify12',
] as const

/** 去掉注释后的源码（静态扫描只看真实代码，避免把"我们不许写 X"的注释当成 X）。 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
}

/** 12 轮新增文件全文（静态扫描用；注释已剥离）。 */
function round12Texts(): Array<{ rel: string; text: string }> {
  return sourceFiles(round12Dirs).map((rel) => ({ rel, text: stripComments(readFileSync(join(REPO_ROOT, rel), 'utf8')) }))
}

/** 静态边界组。 */
function staticBoundaryGroup(): void {
  group('静态边界（无新增字段 / 无转场 / 无伴随文件 / 无全局层级表）')
  const texts = round12Texts()
  check('12 轮新增源文件可读（≥ 40 个）', texts.length >= 40, texts.length)

  // 1) 字幕样式字段面：编译产物只允许 09-05 已定义的字段（E 的断言用常量表，这里核对常量表本身）。
  const compileSource = texts.find((item) => item.rel === 'src/features/subtitles/compile.ts')?.text ?? ''
  const forbiddenStyleFields = ['font_family', 'font_size', 'color', 'stroke', 'outline', 'shadow', 'background', 'align', 'text_align', 'bold', 'italic']
  const styleHits = forbiddenStyleFields.filter((key) => new RegExp(`'${key}'|\\.${key}\\b`).test(compileSource))
  check('字幕编译不写样式类字段（颜色/字体/描边/对齐/背景）', styleHits.length === 0, styleHits)

  // 2) 模板产物不带片段级转场：模板源码里不出现片段级转场键。
  const templateTexts = texts.filter((item) => item.rel.startsWith('src/features/templates/'))
  const transitionHits = templateTexts.filter((item) =>
    /['"](?:transition|crossfade|transition_duration|transition_curve)['"]/.test(item.text))
  check('模板产物无片段级 transition/crossfade 键', transitionHits.length === 0, transitionHits.map((item) => item.rel))

  // 3) 不建伴随文件：新增 feature / plugin 目录里不直接写文件系统（写盘只属于 workbench 入口）。
  const ioHits = texts.filter((item) =>
    /from 'node:fs'|require\('fs'\)|writeFileSync|createWriteStream/.test(item.text))
  check('12 轮新增能力不直接写盘（无伴随文件）', ioHits.length === 0, ioHits.map((item) => item.rel))

  // 4) 不建全局层级表：没有新一类「层级 / 父子」登记表。
  const hierarchyHits = texts.filter((item) => /\bhierarchy\b|parent_id|layer_tree/.test(item.text))
  check('12 轮不新增全局层级表', hierarchyHits.length === 0, hierarchyHits.map((item) => item.rel))

  // 5) 插件只走 api 端口面：新插件目录不直接 import 文档 store / 宿主实现
  //    （`workbench/host/panelContext.ts` 是 04 提供给面板的合法端口，不算宿主实现）。
  const pluginTexts = texts.filter((item) => item.rel.startsWith('src/plugins/'))
  const storeImports = pluginTexts.filter((item) => {
    if (item.text.includes('workbench/host/panelContext')) {
      const withoutPanelContext = item.text.split('workbench/host/panelContext').join('')
      return /core\/doc\/store|workbench\/host\/|electron\//.test(withoutPanelContext)
    }
    return /core\/doc\/store|workbench\/host\/|electron\//.test(item.text)
  })
  check('新插件不 import 文档 store / 宿主实现', storeImports.length === 0, storeImports.map((item) => item.rel))

  // 6) 槽位与模板不落盘：槽库 / 模板参数不进序列化产物（模板源码不写 meta.version / total_duration）。
  //    只在**对象字面量的键**上判定（`'total_duration':` 这种），避免命中函数名 / 局部变量。
  const serializableHits = templateTexts.filter((item) =>
    /['"](?:total_duration|version|template_id|occurrence_id|template_params)['"]\s*:/.test(item.text))
  check('模板产物不写 total_duration / version / 模板身份键', serializableHits.length === 0, serializableHits.map((item) => item.rel))
}

// ── 回归（复用既有脚本，不复制断言）─────────────────────────────────────────────

/**
 * 回归脚本的运行环境：09 的静态边界检查需要 `git`。若当前 PATH 里没有 git，
 * 只从显式配置与常见安装位置补一个目录；找不到就原样继承，由子脚本如实报错。
 */
function gitEnv(): NodeJS.ProcessEnv {
  const candidates = [
    process.env.IC_GIT_DIR,
    'C:\\Program Files\\Git\\cmd',
    'C:\\Program Files\\Git\\bin',
    'C:\\Program Files (x86)\\Git\\cmd',
  ].filter((value): value is string => value !== undefined && value.length > 0)
  const dir = candidates.find((value) => existsSync(join(value, 'git.exe')) || existsSync(join(value, 'git')))
  if (dir === undefined) {
    return process.env
  }
  return { ...process.env, PATH: `${dir};${process.env.PATH ?? ''}` }
}

/** 跑一个 sibling 脚本并取末行 summary。 */
function runSibling(rel: string): { ok: number; fail: number; tail: string } {
  let stdout = ''
  try {
    stdout = execFileSync(process.execPath, ['--experimental-strip-types', rel], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 1 << 23,
      env: gitEnv(),
    })
  } catch (error) {
    stdout = ((error as { stdout?: string }).stdout ?? '') as string
  }
  const match = /summary ok=(\d+) fail=(\d+)/.exec(stdout)
  if (match !== null) {
    return { ok: Number(match[1]), fail: Number(match[2]), tail: '' }
  }
  // 05–09 的既有脚本用 `<轮> 自检: N ok, M fail` / `08 自检：ok 85 / fail 0` 两种末行格式。
  const legacy = /(\d+) ok, (\d+) fail/.exec(stdout)
  if (legacy !== null) {
    return { ok: Number(legacy[1]), fail: Number(legacy[2]), tail: '' }
  }
  const spaced = /ok (\d+) \/ fail (\d+)/.exec(stdout)
  if (spaced !== null) {
    return { ok: Number(spaced[1]), fail: Number(spaced[2]), tail: '' }
  }
  return { ok: -1, fail: -1, tail: stdout.slice(-320) }
}

/** 回归组。 */
function regressionGroup(): void {
  group('回归（01–11 既有自检）')
  const core = runSibling('src/core/doc/verify.ts')
  check('core/doc/verify.ts 基线 ok=198', core.ok === 198, core)

  const shell = runSibling('src/workbench/verify.ts')
  check('verify.ts 插件与外壳自检 fail=0', shell.fail === 0, shell)

  const pathRound = runSibling('src/workbench/verify-07.ts')
  check('verify-07 基线 ok=598（07 路径未被 12 轮改写）', pathRound.ok === 598, pathRound)

  for (const round of ['05', '06', '08', '09', '10', '11'] as const) {
    const sibling = runSibling(`src/workbench/verify-${round}.ts`)
    check(`verify-${round} fail=0`, sibling.fail === 0, sibling)
  }
}

// ── 主流程 ────────────────────────────────────────────────────────────────────

function main(): void {
  const ctx = createVerifyContext('verify-12')

  group('A 模板模型与嵌套（12-01 / 12-02）')
  runTemplateModel(check, ctx)
  runNesting(check, ctx)

  group('B 九个模板的产物契约（12-03 / 12-04 / 12-05）')
  runClipTemplates(check, ctx)
  runTrackTemplates(check, ctx)
  runScriptTemplates(check, ctx)

  group('C 生成校验链（12-11）')
  runGenerationValidation(check, ctx)

  group('D 模板面板与快捷效果（12-06 / 12-07）')
  runTemplatePanel(check, ctx)
  runQuickEffects(check, ctx)

  group('E 飞控九槽（12-08）')
  runFlightPoseBank(check, ctx)

  group('F 几何工具（12-09）')
  runGeometryTools(check, ctx)

  group('G 曲线工具（12-10）')
  runCurveTools(check, ctx)

  group('H 字幕导入 / 批次 / 编译 / 面板（12-12 ~ 12-15）')
  runSubtitles(check, ctx)

  staticBoundaryGroup()
  regressionGroup()

  const summary = runner.summary()
  console.log(`summary ok=${summary.ok} fail=${summary.fail}`)
  if (summary.fail > 0) {
    process.exitCode = 1
  }
}

try {
  main()
} catch (error) {
  console.log(`FAIL 未捕获异常: ${formatActual(error)}`)
  console.log('summary ok=0 fail=1')
  process.exitCode = 1
}
