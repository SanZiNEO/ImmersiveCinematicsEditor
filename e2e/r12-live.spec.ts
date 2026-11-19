/**
 * 12 轮真实联调验收（Playwright 驱动真实 Electron 编辑器）。
 *
 * 链路：编辑器打开脚本 → 回放面板「校验」→「推送并跳转」→「播放」→ 面板状态 / 服务端时间 /
 * 预览帧回传编辑器。所有断言都读真实 UI 文案与真实 WebSocket 传输层；不调用 `ic play` /
 * `icinematics play`，也不使用绕开编辑器的独立 WS 探针。
 *
 * 运行前提：游戏客户端已在世界内运行、预览屏已打开（8765 监听）、token 文件就绪。
 * 未设 `IC_LIVE` 时整体 skip，不影响离线 CI。
 *
 * 运行：`$env:IC_LIVE='1'; npx playwright test e2e/r12-live.spec.ts`
 */
import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const ARTIFACTS = 'e2e-artifacts'
const USER_DATA = path.join(process.cwd(), ARTIFACTS, 'user-data-r12-live')
/** 工作区 = 游戏端 `immersive_cinematics` 目录；默认取仓库同级的模组开发运行目录，可用 IC_WORKSPACE 覆盖。 */
const WORKSPACE = path.resolve(
  process.env.IC_WORKSPACE
    ?? path.join(process.cwd(), '..', 'ImmersiveCinematics', 'fabric', 'run', 'immersive_cinematics'),
)

interface DebugWorkbench {
  router: { navigate(pageId: string): void }
  layout: {
    showPanel(pageId: string, panel: { pluginId: string; panelId: string }): void
    getTree(pageId: string): unknown
    getGroup(pageId: string, groupId: string): unknown
  }
  documents: {
    open(path: string): Promise<{ ok: boolean; error?: string; reason?: string }>
    summary(): { docId: string | null; path: string | null; dirty: boolean }
    validate(): Promise<{ ok: boolean; issues: Array<{ severity: string; message: string }> }>
    localIssues(): Array<{ severity: string; message: string }>
  }
  transport: {
    connected(): boolean
    stats(): { sent?: number; captured?: number; dropped?: number; fps?: number } | null
    playback(): { time: number; playing: boolean }
    lastFrameAt(): number | null
    onFrame(listener: (frame: unknown) => void): () => void
  }
}

/** 三份待验收夹具（相对工作区 `scripts/` 的文件名）。 */
const FIXTURES = [
  { slug: 'r12-camera-intro', file: 'r12_camera_intro.json' },
  { slug: 'r12-template-mix', file: 'r12_template_mix.json' },
  { slug: 'r12-subtitles', file: 'r12_subtitles.json' },
] as const

test.skip(!process.env.IC_LIVE, 'IC_LIVE 未设置：跳过真实游戏联调（需要已运行的客户端与 8765 服务）')

let app: ElectronApplication
let page: Page
const rendererErrors: string[] = []
const consoleLogs: Array<{ type: string; text: string }> = []
/** 逐夹具遥测快照，跑完落盘到 e2e-artifacts/r12-live-telemetry.json 供报告核对。 */
const telemetry: Array<Record<string, unknown>> = []

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  await mkdir(ARTIFACTS, { recursive: true })
  await rm(USER_DATA, { recursive: true, force: true })

  const env: NodeJS.ProcessEnv = { ...process.env }
  // 必须读游戏端写的真实 token 文件；不能像离线用例那样把 token 文件置空。
  delete env.IC_WEBUI_TOKEN_FILE

  app = await electron.launch({
    args: ['.'],
    env: {
      ...env,
      IC_EDITOR_DEV_URL: process.env.IC_EDITOR_TEST_URL ?? 'http://localhost:5173',
      IC_EDITOR_USER_DATA: USER_DATA,
      IC_EDITOR_WORKSPACE: WORKSPACE,
    },
  })
  page = await app.firstWindow()
  page.on('pageerror', (error) => rendererErrors.push(error.message))
  page.on('console', (message) => {
    consoleLogs.push({ type: message.type(), text: message.text() })
    if (message.type() === 'error') rendererErrors.push(message.text())
  })
  await page.waitForLoadState('domcontentloaded')
  await page.waitForSelector('.workspace-shell', { timeout: 60_000 })
  // 最大化窗口，避免低窗布局把右栏/抽屉面板挤压到按钮行不可点。
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.maximize())

  // 等真实 WebSocket 连上游戏端（127.0.0.1:8765）。
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const workbench = (window as unknown as { __workbench?: DebugWorkbench }).__workbench
          return workbench?.transport?.connected() ?? false
        }),
      { timeout: 20_000, message: '编辑器 WebSocket 未连上 127.0.0.1:8765' },
    )
    .toBe(true)

  // 在真实传输层挂帧计数回调（transport.onFrame），断言帧 >0 且持续增长。
  await page.evaluate(() => {
    const holder = window as unknown as { __workbench?: DebugWorkbench; __r12Frames?: number; __r12Clicks?: unknown[] }
    holder.__r12Frames = 0
    holder.__r12Clicks = []
    holder.__workbench?.transport.onFrame(() => {
      holder.__r12Frames = (holder.__r12Frames ?? 0) + 1
    })
    // 录制真实按钮点击（含面板归属），用于核对是否误触「播放」。
    document.addEventListener(
      'click',
      (event) => {
        const button = (event.target as HTMLElement | null)?.closest('button')
        if (button === null) return
        holder.__r12Clicks?.push({
          at: Date.now(),
          text: (button.textContent ?? '').trim(),
          inPanel: button.closest('.inspect-panel') !== null,
        })
      },
      true,
    )
  })
})

test.afterAll(async () => {
  telemetry.push({ consoleLogs, rendererErrors })
  await writeFile(
    path.join(ARTIFACTS, 'r12-live-telemetry.json'),
    JSON.stringify(telemetry, null, 2),
    'utf8',
  ).catch(() => undefined)
  await Promise.race([app.close(), new Promise((resolve) => setTimeout(resolve, 5_000))]).catch(() => undefined)
})

async function readTelemetry() {
  return page.evaluate(() => {
    const workbench = (window as unknown as { __workbench?: DebugWorkbench; __r12Frames?: number }).__workbench
    if (workbench === undefined) throw new Error('调试钩子缺失')
    const t = workbench.transport
    return {
      connected: t.connected(),
      playback: t.playback(),
      stats: t.stats(),
      lastFrameAt: t.lastFrameAt(),
      frames: (window as unknown as { __r12Frames?: number }).__r12Frames ?? 0,
      summary: workbench.documents.summary(),
    }
  })
}

/** 读取回放面板当前可见状态 + 传输层遥测 + 真实点击记录，供失败现场核对。 */
async function readPanelState() {
  return page.evaluate(() => {
    const holder = window as unknown as {
      __workbench?: DebugWorkbench
      __r12Frames?: number
      __r12Clicks?: Array<{ at: number; text: string; inPanel: boolean }>
    }
    const wb = holder.__workbench
    const root = document.querySelector('.inspect-panel')
    const textOf = (selector: string) => root?.querySelector(selector)?.textContent?.trim() ?? null
    return {
      phase: textOf('.phase'),
      compare: textOf('.compare'),
      issues: [...(root?.querySelectorAll('.issue-list li') ?? [])].map((li) => li.textContent?.trim() ?? ''),
      error: textOf('.error-card'),
      buttons: [...(root?.querySelectorAll('button') ?? [])].map((b) => ({
        text: (b.textContent ?? '').trim(),
        disabled: b.disabled,
      })),
      playback: wb?.transport.playback(),
      stats: wb?.transport.stats(),
      frames: holder.__r12Frames ?? 0,
      clicks: holder.__r12Clicks ?? [],
    }
  })
}

for (const fixture of FIXTURES) {
  test(`联调：${fixture.file} 打开 → 校验 → 推送并跳转 → 播放 → 帧回传`, async () => {
    const startedAt = new Date().toISOString()

    // 1. 打开脚本：原生文件对话框 Playwright 点不了，走仓库既有的调试钩子 documents.open。
    const openResult = await page.evaluate(async (target: string) => {
      const workbench = (window as unknown as { __workbench?: DebugWorkbench }).__workbench
      if (workbench === undefined) throw new Error('调试钩子缺失')
      const result = await workbench.documents.open(target)
      if (result.ok) workbench.router.navigate('document')
      return result
    }, fixture.file)
    expect(openResult.ok, `打开 ${fixture.file}`).toBe(true)
    await expect(page.locator('.document-page')).toBeVisible({ timeout: 20_000 })

    // 2. 打开「镜头检查」抽屉面板：抽屉已展开且本标签处于激活态时，重复点击会触发折叠切换，
    //    因此先核对面板是否已可见；未展开再点抽屉标签（等价命令打开面板），随后真实点「回放」tab。
    const panel = page.locator('.inspect-panel')
    if (!(await panel.isVisible())) {
      const drawerTab = page.locator('[data-dock-kind="drawer"] [role="tab"]', { hasText: '镜头检查' }).first()
      await expect(drawerTab).toBeVisible({ timeout: 20_000 })
      await drawerTab.click()
    }
    await expect(panel).toBeVisible({ timeout: 20_000 })
    await panel.getByRole('button', { name: /^回放/ }).click()

    // 几何探针：记录面板/按钮/分隔条矩形，便于排查遮挡（失败现场可核对）。
    const geometry = await page.evaluate(() => {
      const rect = (el: Element | null) => {
        if (el === null) return null
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
      }
      const root = document.querySelector('.inspect-panel')
      const content = root?.querySelector('.content') ?? null
      const buttons = [...(root?.querySelectorAll('button') ?? [])].map((b) => ({
        text: (b.textContent ?? '').trim(),
        disabled: b.disabled,
        rect: rect(b),
      }))
      const separators = [...document.querySelectorAll('[role="separator"]')].map((s) => ({
        aria: s.getAttribute('aria-label'),
        rect: rect(s),
      }))
      const wb = (window as unknown as { __workbench?: DebugWorkbench }).__workbench
      const tree = wb?.layout.getTree('document')
      const drawerGroup = wb?.layout.getGroup('document', 'document.drawer')
      return {
        innerSize: { w: window.innerWidth, h: window.innerHeight },
        panel: rect(root),
        content: content === null ? null : { rect: rect(content), scrollHeight: content.scrollHeight, clientHeight: content.clientHeight },
        buttons,
        separators,
        layoutTree: tree,
        drawerGroup,
      }
    })
    console.log('[r12-geometry]', JSON.stringify(geometry))
    telemetry.push({ fixture: fixture.file, geometry })

    // 3. 真实点击「校验」，轮询采样面板阶段直到「有效」；失败时把采样与诊断带回报错。
    const validateButton = panel.getByRole('button', { name: /校验/ }).first()
    await expect(validateButton).toBeEnabled({ timeout: 15_000 })
    await validateButton.click()

    const samples: Array<Record<string, unknown>> = []
    const deadline = Date.now() + 20_000
    let last: Record<string, unknown> = {}
    while (Date.now() < deadline) {
      last = await readPanelState()
      samples.push(last)
      if (last.phase === '有效') break
      await page.waitForTimeout(500)
    }
    const validateDump = await page
      .evaluate(async () => {
        const wb = (window as unknown as { __workbench?: DebugWorkbench }).__workbench
        if (wb === undefined) throw new Error('调试钩子缺失')
        const outcome = await wb.documents.validate()
        return {
          outcome,
          local: wb.documents.localIssues().map((issue) => ({ severity: issue.severity, message: issue.message })),
        }
      })
      .catch((error: unknown) => ({ error: String(error) }))
    telemetry.push({ fixture: fixture.file, validateSamples: samples, validateDump })
    const trace = samples.map((sample) => ({
      phase: sample.phase,
      compare: sample.compare,
      clicks: sample.clicks,
    }))
    expect(
      last.phase,
      `校验后阶段采样=${JSON.stringify(trace)}; validateDump=${JSON.stringify(validateDump)}`,
    ).toBe('有效')
    expect(last.error ?? '', '校验不应出现错误卡片').toBe('')

    // 4. 真实点击「推送并跳转」；等跳转回执回来、「播放」按钮可用。
    await panel.getByRole('button', { name: '推送并跳转' }).click()
    await expect(panel.getByRole('button', { name: '播放' })).toBeEnabled({ timeout: 20_000 })

    // 5. 基线后真实点击「播放」。
    const baseline = await readTelemetry()
    await panel.getByRole('button', { name: '播放' }).click()

    // 6. 快速采样（150ms 一档，最多 10s）捕获在播窗口：首份脚本仅 3s，固定 2s 滞后读取会错过在播段。
    // 首个 playing=true 回执可能仍带 time=0（刚起播）；首个在播样本后再采满 2s，保证首末在播读数间隔 ≥2s。
    const playSamples: Array<Record<string, unknown>> = []
    const playDeadline = Date.now() + 10_000
    let observedPlaying = false
    let maxServerTime = 0
    let firstPlayingAt: number | null = null
    let firstPlayingTime: number | null = null
    let lastPlayingTime: number | null = null
    while (Date.now() < playDeadline) {
      const state = await readPanelState()
      playSamples.push(state)
      const pb = state.playback
      if (pb !== undefined && pb.playing === true) {
        observedPlaying = true
        const t = Number(pb.time ?? 0)
        if (firstPlayingAt === null) {
          firstPlayingAt = Date.now()
          firstPlayingTime = t
        }
        lastPlayingTime = t
      }
      maxServerTime = Math.max(maxServerTime, Number(pb?.time ?? 0))
      if (firstPlayingAt !== null && Date.now() - firstPlayingAt >= 2_000) break
      await page.waitForTimeout(150)
    }

    const lastPlay = playSamples[playSamples.length - 1] ?? {}
    const framesBefore = baseline.frames
    const framesAfter = Number(lastPlay.frames ?? 0)
    const transportedFrames = Number(lastPlay.stats?.captured ?? lastPlay.stats?.sent ?? 0)
    const playTrace = playSamples.map((sample) => ({
      phase: sample.phase,
      compare: sample.compare,
      playback: sample.playback,
      frames: sample.frames,
    }))

    expect(observedPlaying, `采样中未观察到在播：${JSON.stringify(playTrace)}`).toBe(true)
    expect(maxServerTime, '服务端播放时间应从 0 向前推进').toBeGreaterThan(0)
    expect(lastPlayingTime ?? 0, '2s 采样窗内服务端播放头应继续前进').toBeGreaterThan(firstPlayingTime ?? 0)
    expect(framesAfter, '预览帧计数应大于 0').toBeGreaterThan(0)
    expect(framesAfter, '预览帧计数不应回退').toBeGreaterThanOrEqual(framesBefore)
    expect(transportedFrames, '传输层应有已捕获/已发送帧').toBeGreaterThan(0)

    // 7. 编辑器窗口截图（仅编辑器本体）。
    const screenshot = path.join(ARTIFACTS, `r12-live-${fixture.slug}.png`)
    await page.screenshot({ path: screenshot })

    telemetry.push({
      fixture: fixture.file,
      startedAt,
      finishedAt: new Date().toISOString(),
      baseline,
      playSamples: playTrace,
      framesBefore,
      framesAfter,
      maxServerTime,
      firstPlayingTime,
      lastPlayingTime,
      transportedFrames,
      statsAfter: lastPlay.stats,
      lastFrameAt: lastPlay.lastFrameAt,
      screenshot,
    })

    // 8. 停止本夹具播放，再切下一个。
    await panel.getByRole('button', { name: '停止' }).click()
    await expect(panel.locator('.compare')).toContainText('未播', { timeout: 10_000 })
  })
}

test('渲染进程没有未捕获错误（离线 WS 报错除外）', async () => {
  const unexpected = rendererErrors.filter((message) => !message.includes('ws://127.0.0.1:8765'))
  expect(unexpected).toEqual([])
})
