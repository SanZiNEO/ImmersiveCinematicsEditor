/**
 * 10 轮真实端到端冒烟：音频字段面、调色字段面、资源/曲线抽屉与媒体检查。
 *
 * 只读 UI 与调试钩子；不改生产代码，不伪造 WebUI。资源服务在未连接游戏实例时
 * 必须显示为不可用，不能把空清单当成“文件不存在”。
 */
import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const ARTIFACTS = 'e2e-artifacts'
const USER_DATA = path.join(process.cwd(), ARTIFACTS, 'user-data-r10')
const WORKSPACE = path.join(process.cwd(), ARTIFACTS, 'workspace-r10')

interface DebugWorkbench {
  router: { navigate(pageId: string): void }
  documents: {
    open(path: string): Promise<{ ok: boolean; error?: string }>
    clips(): Array<{ clipKey: string; trackType: string }>
    select(selection: { domain: string; clipKey?: string }): void
  }
}

const AUDIO_DOC = {
  meta: { id: 'R10A', name: 'Round 10 audio', author: 'e2e', listener: 'camera' },
  timeline: {
    tracks: [
      {
        type: 'AUDIO',
        clips: [{
          start_time: 0,
          duration: 3,
          objects: {
            sound: { value: 'audio/example.ogg' },
            source: { value: 'file' },
            volume: { value: 1 },
            x: { value: 2 },
            y: { value: 0 },
            z: { value: 0 },
            pitch: { value: 1 },
            file_loop: { value: true },
            fade_in: { value: 2 },
            fade_out: { value: 2 },
            attenuation: { value: 'linear' },
            position_mode: { value: 'relative' },
            category: { value: 'ambient' },
          },
        }],
      },
      {
        type: 'CAMERA',
        clips: [{ start_time: 0, duration: 3, objects: { fov: { value: 70 } } }],
      },
    ],
  },
}

const COLOR_DOC = {
  meta: { id: 'R10C', name: 'Round 10 color', author: 'e2e' },
  timeline: {
    tracks: [
      { type: 'CAMERA', clips: [{ start_time: 0, duration: 4, objects: { fov: { value: 70 } } }] },
      {
        type: 'ADJUST',
        clips: [{
          start_time: 0,
          duration: 4,
          objects: {
            exposure: { value: 0.5 },
            contrast: { value: 0 },
            highlights: { value: 0 },
            shadows: { value: 0 },
            whites: { value: 0 },
            blacks: { value: 0 },
            hue: { value: 0 },
            saturation: { value: 0 },
            vibrance: { value: 0 },
            lightness: { value: 0 },
            temperature: { value: 0 },
            tint: { value: 0 },
            red: { value: 1 },
            green: { value: 1 },
            blue: { value: 1 },
            mix_rr: { value: 0 },
            blend_mode: { value: 'soft_light' },
            lut: { value: 'luts/example.cube' },
            lut_input_gamma: { value: 1 },
            lut_strength: { value: 0.5 },
          },
        }],
      },
    ],
  },
}

let app: ElectronApplication
let page: Page
const rendererErrors: string[] = []

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  await mkdir(ARTIFACTS, { recursive: true })
  await rm(USER_DATA, { recursive: true, force: true })
  await rm(WORKSPACE, { recursive: true, force: true })
  const scripts = path.join(WORKSPACE, 'scripts')
  await mkdir(scripts, { recursive: true })
  await writeFile(path.join(scripts, 'r10-audio.json'), `${JSON.stringify(AUDIO_DOC, null, 2)}\n`, 'utf8')
  await writeFile(path.join(scripts, 'r10-color.json'), `${JSON.stringify(COLOR_DOC, null, 2)}\n`, 'utf8')
  app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      IC_EDITOR_DEV_URL: process.env.IC_EDITOR_TEST_URL ?? 'http://localhost:5173',
      IC_WEBUI_TOKEN_FILE: '',
      IC_EDITOR_USER_DATA: USER_DATA,
      IC_EDITOR_WORKSPACE: WORKSPACE,
    },
  })
  page = await app.firstWindow()
  page.on('pageerror', (error) => rendererErrors.push(error.message))
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app.close().catch(() => undefined)
})

async function openScript(name: string): Promise<void> {
  const ok = await page.evaluate(async (target: string) => {
    const holder = window as unknown as { __workbench?: DebugWorkbench }
    const workbench = holder.__workbench
    if (workbench === undefined) throw new Error('调试钩子缺失')
    const result = await workbench.documents.open(target)
    if (result.ok) workbench.router.navigate('document')
    return result.ok
  }, name)
  expect(ok, `打开 ${name}`).toBe(true)
  await expect(page.locator('.document-page')).toBeVisible({ timeout: 20_000 })
}

async function selectClip(trackType: string): Promise<void> {
  const clipKey = await page.evaluate((type: string) => {
    const holder = window as unknown as { __workbench?: DebugWorkbench }
    const workbench = holder.__workbench
    const clip = workbench?.documents.clips().find((entry) => entry.trackType === type)
    if (workbench === undefined || clip === undefined) return null
    workbench.documents.select({ domain: 'clip', clipKey: clip.clipKey })
    return clip.clipKey
  }, trackType)
  expect(clipKey, `需要 ${trackType} 片段`).toBeTruthy()
  await expect(page.locator('.props-panel')).toBeVisible({ timeout: 20_000 })
}

test('R10-1：AUDIO 片段只出现 13 个字段与四个显示组，并显示包络/循环横幅', async () => {
  await openScript('r10-audio.json')
  const states = await page.evaluate(() => {
    const holder = window as unknown as { __workbench?: { plugins: { states(): unknown } } }
    return holder.__workbench?.plugins.states() ?? null
  })
  console.log('PLUGIN STATES', JSON.stringify(states, null, 2))
  const registries = await page.evaluate(async () => {
    const custom = await import('/src/features/effects/customFields.ts')
    const surface = await import('/src/workbench/api/fieldSurface.ts')
    const tokens = await import('/src/workbench/api/tokens.ts')
    const holder = window as unknown as { __workbench?: { services: { get<T>(token: unknown): T } } }
    const catalog = holder.__workbench?.services.get<{ objectDef(type: string, path: string): { scope: string[] } | undefined }>(tokens.CATALOG_SERVICE)
    return {
      sound: Boolean(custom.customFieldFor('AUDIO', 'sound')),
      fade: Boolean(custom.customFieldFor('AUDIO', 'fade_in')),
      group: Boolean(surface.displayGroupFor('AUDIO', 'sound')),
      meta: Boolean(surface.metaFieldSurfaceFor('listener')),
      soundScope: catalog?.objectDef('AUDIO', 'sound')?.scope ?? null,
    }
  })
  console.log('REGISTRIES', JSON.stringify(registries))
  console.log('PAGE ERRORS', JSON.stringify(rendererErrors, null, 2))
  await selectClip('AUDIO')
  await expect(page.locator('.wf-file-loop')).toBeVisible({ timeout: 20_000 })
  const text = await page.locator('.props-panel').innerText()
  for (const group of ['音源', '音量', '包络', '空间']) {
    expect(text, `显示组 ${group}`).toContain(group)
  }
  expect(text).toContain('文件循环')
  expect(text).toContain('淡入')
  expect(text).toContain('淡出')
  expect(text).not.toContain('LUT')
  expect(text).not.toContain('matrix')
  expect(text).not.toContain('motion_position')
  await expect(page.locator('.props-panel__bars')).toHaveCount(0)
  await expect(page.locator('.props-panel__models')).toHaveCount(0)
  const toggles = page.locator('.prop-group__toggle')
  const toggleCount = await toggles.count()
  for (let index = 0; index < toggleCount; index += 1) {
    const toggle = toggles.nth(index)
    if ((await toggle.getAttribute('aria-expanded')) === 'false') {
      await toggle.click()
    }
  }
  const paths = await page.locator('.prop-row').evaluateAll((elements) => (
    [...new Set(elements.map((element) => (element as HTMLElement).dataset.path ?? ''))].sort()
  ))
  // fade_in/fade_out 是一行包络控件（两条字段合并展示），所以 DOM 路径为 12 条而非 13。
  expect(paths).toEqual([
    'attenuation', 'category', 'fade_in', 'file_loop',
    'pitch', 'position_mode', 'sound', 'source', 'volume', 'x', 'y', 'z',
  ])
  expect(text).toContain('fade_out')
  await expect(page.locator('.wf-audio-banner')).toContainText('片段循环')
  await page.screenshot({ path: `${ARTIFACTS}/10-audio-panel.png` })
})

test('R10-2：ADJUST 片段出现调色组、曲线摘要、LUT 与层混合，CAMERA 不显示 LUT', async () => {
  await openScript('r10-color.json')
  await selectClip('ADJUST')
  await expect(page.locator('.wf-slider').first()).toBeVisible({ timeout: 20_000 })
  // 10-05 首次选中只展开“基础校色”；这里展开断言涉及的组，不绕过真实折叠。
  for (const group of ['通道混合', 'LUT 定义', '曲线定义', '层级混合']) {
    const toggle = page.locator('.prop-group__toggle').filter({ hasText: group }).first()
    if (await toggle.count() > 0 && (await toggle.getAttribute('aria-expanded')) === 'false') {
      await toggle.click()
    }
  }
  await expect(page.locator('.wf-matrix')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.wf-curves')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.wf-lut')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.wf-blend').first()).toBeVisible({ timeout: 20_000 })
  const text = await page.locator('.props-panel').innerText()
  for (const group of ['基础校色', 'HSL', 'LUT', '层级混合', '曲线定义']) {
    expect(text, `调色组 ${group}`).toContain(group)
  }
  expect(text).toContain('soft_light')
  expect(text).toContain('清空 10 条曲线')
  expect(await page.locator('.wf-lut__input').getAttribute('placeholder')).toContain('.cube')
  await page.screenshot({ path: `${ARTIFACTS}/10-color-panel.png` })

  await selectClip('CAMERA')
  await expect(page.locator('.props-panel__bars')).toHaveCount(1)
  const camera = await page.locator('.props-panel').innerText()
  await expect(page.locator('.wf-lut')).toHaveCount(0)
  expect(camera).not.toContain('soft_light')
})

test('R10-3：资源与检查抽屉可打开；未连接游戏时明确显示不可用，不伪造缺失', async () => {
  await openScript('r10-color.json')
  // 不依赖属性面板选择：抽屉 tab 由 core.audio manifest 注册。
  const drawer = page.locator('[data-dock-kind="drawer"]')
  await expect(drawer).toHaveCount(1)
  const resourcesTab = drawer.locator('[role="tab"]').filter({ hasText: '资源' }).first()
  await expect(resourcesTab).toBeVisible({ timeout: 20_000 })
  await resourcesTab.click()
  await expect(page.locator('.wf-resources')).toBeVisible({ timeout: 20_000 })
  const text = await page.locator('.wf-resources').innerText()
  expect(text).toContain('浏览')
  expect(text).toContain('检查')
  await page.screenshot({ path: `${ARTIFACTS}/10-resources-drawer.png` })

  const checksTab = page.locator('.wf-resources__modes button').filter({ hasText: '检查' })
  await checksTab.click()
  // 抽屉高度较小时检查页内容会被祖先滚动容器裁剪；这里验证已渲染与文案，不依赖视口可见性。
  await expect(page.locator('.wf-checks')).toContainText('当前片段', { timeout: 20_000 })
  const checks = await page.locator('.wf-checks').innerText()
  expect(checks).toContain('全局')
  expect(checks).toContain('资源清单不可用')
  await page.screenshot({ path: `${ARTIFACTS}/10-checks.png` })
})

test('R10-4：真实渲染无未捕获页面错误（WebUI 断连除外）', async () => {
  const unexpected = rendererErrors.filter((message) => !message.includes('ws://127.0.0.1:8765'))
  expect(unexpected, unexpected.join('\n')).toEqual([])
})
