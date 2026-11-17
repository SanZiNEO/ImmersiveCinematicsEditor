/**
 * 手动演示（开发辅助，不参与构建）：
 * 真实 Electron 窗口 + 外部演示夹具，窗口保持打开供手动点击验证。
 *
 * 用法：
 *   IC_DEMO_FIXTURES=<fixtures.json> npx playwright test e2e/demo-manual.spec.ts --headed
 *   （不加 IC_DEMO_FIXTURES 时使用默认路径）
 *
 * 关闭窗口或 Ctrl+C 结束。默认等待 30 分钟。
 */
import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { installFakeWebUi } from './fakeWebUi.ts'

const ARTIFACTS = 'e2e-artifacts'
const USER_DATA = path.join(process.cwd(), ARTIFACTS, 'user-data-manual')
const FIXTURES = process.env.IC_DEMO_FIXTURES
  ?? 'C:/Users/yjsng/WorkBuddy/2026-11-17-15-11-26/demo-fixtures/fixtures.json'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  const files = JSON.parse(await readFile(FIXTURES, 'utf8')) as Record<string, unknown>
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
  await expect(page.locator('[data-graph-node]').first()).toBeVisible({ timeout: 30_000 })
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
})

test('手动演示：保持窗口打开 30 分钟', async () => {
  test.setTimeout(30 * 60 * 1000)
  // 保持窗口，供手动操作；超时或关闭窗口后结束。
  await page.waitForTimeout(30 * 60 * 1000)
})
