/**
 * 演示：从仓库外的临时夹具加载复杂关系网（约 100 脚本 / 5 文件夹 / 7 层前置链），
 * 验证力导向与文件夹分块两种布局、双渲染模式、卡片工具栏的真实观感并截图。
 *
 * 夹具不在仓库内：用 `IC_DEMO_FIXTURES` 指向外部 fixtures.json；
 * 未设置时跳过（保证仓库本身不含演示数据）。
 */
import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { installFakeWebUi } from './fakeWebUi.ts'

const ARTIFACTS = 'e2e-artifacts'
const USER_DATA = path.join(process.cwd(), ARTIFACTS, 'user-data-demo')
const FIXTURES = process.env.IC_DEMO_FIXTURES ?? ''

let app: ElectronApplication
let page: Page
let files: Record<string, unknown> | null = null

test.beforeAll(async () => {
  if (FIXTURES === '') {
    return
  }
  files = JSON.parse(await readFile(FIXTURES, 'utf8')) as Record<string, unknown>
  await mkdir(ARTIFACTS, { recursive: true })
  await rm(USER_DATA, { recursive: true, force: true })
  app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      IC_EDITOR_DEV_URL: 'http://localhost:5173',
      IC_WEBUI_TOKEN_FILE: '',
      IC_EDITOR_USER_DATA: USER_DATA,
    },
  })
  page = await app.firstWindow()
  await page.addInitScript(installFakeWebUi, files)
  await page.reload()
  await page.waitForSelector('.workspace-shell', { timeout: 60_000 })
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
})

test('演示：复杂关系网 + 双模式 + 卡片工具栏', async () => {
  test.skip(FIXTURES === '' || files === null, '未提供 IC_DEMO_FIXTURES，跳过演示')
  await expect(page.locator('[data-graph-node]').first()).toBeVisible({ timeout: 30_000 })
  expect(await page.locator('[data-graph-node]').count()).toBe(Object.keys(files).length)

  await expect(page.locator('.graph-canvas')).toHaveAttribute('data-graph-mode', 'dot')
  await page.screenshot({ path: `${ARTIFACTS}/demo-dot.png` })
  await page.locator('.graph-toolbar button', { hasText: '适配' }).click()
  await page.screenshot({ path: `${ARTIFACTS}/demo-dot-fit.png` })

  // 卡片模式
  await page.locator('.tool-button--mode').click()
  await expect(page.locator('.graph-canvas')).toHaveAttribute('data-graph-mode', 'card')
  await page.screenshot({ path: `${ARTIFACTS}/demo-card.png` })
  await page.locator('.tool-button--mode').click()

  // 悬停看卡片
  await page.locator('[data-graph-node]').nth(0).hover()
  await expect(page.locator('[data-hover-card="true"]')).toBeVisible({ timeout: 8_000 })
  await page.screenshot({ path: `${ARTIFACTS}/demo-hover.png` })
})
