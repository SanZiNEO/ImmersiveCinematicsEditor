/**
 * 04 轮真实端到端验收（Playwright `_electron.launch`，见 Electron 官方测试指南）。
 *
 * 跑的是真实 Electron：真主进程、真 preload、真 BrowserWindow、真渲染进程、真 dist/vite 页面。
 * 断言全部基于可见 DOM 与真实主进程状态；截图走 `page.screenshot`（软件内截屏）。
 *
 * 运行：`npm run test:e2e`（内部先 build，再 `playwright test`）
 */
import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'

/** dev 页面上暴露的调试钩子（仅 `import.meta.env.DEV` 存在）。 */
interface WorkbenchDebug {
  router: { navigate(pageId: string, params?: Record<string, string>): void; currentPageId: string }
  layout: {
    resetLayout(pageId: string): void
    presets(pageId: string): string[]
    applyPreset(pageId: string, presetId: string): void
    getGroup(pageId: string, groupId: string): { visible: boolean; collapsed: boolean; panels: unknown[] } | undefined
    getTree(pageId: string): { root: { type: string; id: string; children?: Array<{ id: string; type: string }> } }
  }
  documents: { summary(): { docId: string | null; dirty: boolean } }
  themes: { mode(): string }
}

const ARTIFACTS = 'e2e-artifacts'
/** 测试专用 userData：每次运行前清空，绝不污染真实用户目录。 */
const E2E_USER_DATA = path.join(process.cwd(), ARTIFACTS, 'user-data')

let app: ElectronApplication
let page: Page
const rendererErrors: string[] = []

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  await mkdir(ARTIFACTS, { recursive: true })
  await rm(E2E_USER_DATA, { recursive: true, force: true })
  app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      IC_EDITOR_DEV_URL: 'http://localhost:5173',
      IC_WEBUI_TOKEN_FILE: '',
      IC_EDITOR_USER_DATA: E2E_USER_DATA,
    },
  })
  page = await app.firstWindow()
  page.on('pageerror', (error) => rendererErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') {
      rendererErrors.push(message.text())
    }
  })
  await page.waitForSelector('.workspace-shell', { timeout: 60_000 })
})

test.afterAll(async () => {
  await app.close().catch(() => undefined)
})

test('主进程跑的是开发模式，窗口与安全选项真实生效', async () => {
  const state = await app.evaluate(async ({ app: electronApp, BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    const preferences = window.webContents.getLastWebPreferences()
    return {
      isPackaged: electronApp.isPackaged,
      windows: BrowserWindow.getAllWindows().length,
      title: window.getTitle(),
      contextIsolation: preferences.contextIsolation,
      nodeIntegration: preferences.nodeIntegration,
      sandbox: preferences.sandbox,
      url: window.webContents.getURL(),
    }
  })
  expect(state.isPackaged).toBe(false)
  expect(state.windows).toBe(1)
  expect(state.contextIsolation).toBe(true)
  expect(state.nodeIntegration).toBe(false)
  expect(state.sandbox).toBe(true)
  expect(state.url).toContain('localhost:5173')
  await page.screenshot({ path: `${ARTIFACTS}/01-project-page.png` })
})

test('项目页渲染真实入口与脚本页空态（无启动器主体）', async () => {
  await expect(page.locator('.project-page')).toBeVisible()
  await expect(page.locator('.project-page .primary')).toHaveText('新建脚本')
  await expect(page.locator('.project-page')).toContainText('打开脚本文件')
  await expect(page.locator('.project-page')).toContainText('打开文件夹')
  await expect(page.locator('.script-graph-panel')).toBeVisible()
  await expect(page.locator('.graph-toolbar')).toBeVisible()
  // 脚本来自工作区文件：未选工作区时提示的是「工作区不可用」，不再提「未连接模组」。
  await expect(page.locator('.project-page')).toContainText('工作区不可用')
  await expect(page.locator('.project-page')).not.toContainText('还没有最近项目')
  await expect(page.locator('.statusbar')).toContainText('页面：project')

  const shell = await page.evaluate(() => ({
    topbar: document.querySelectorAll('.topbar').length,
    menus: document.querySelectorAll('.menus .menu-button').length,
    statusItems: document.querySelectorAll('.statusbar .status-item').length,
    themeId: document.documentElement.getAttribute('data-theme-id'),
    appearance: document.documentElement.getAttribute('data-theme-appearance'),
  }))
  expect(shell.topbar).toBe(1)
  expect(shell.menus).toBeGreaterThanOrEqual(5)
  expect(shell.statusItems).toBeGreaterThanOrEqual(6)
  expect(shell.themeId).toBeTruthy()
  expect(shell.appearance).toBe('dark')
})

test('未设置工作区时新建脚本：真实失败提示，不伪造成功', async () => {
  // 该用例不注入工作区（workbench.spec 不设 IC_EDITOR_WORKSPACE）：
  // 新建要写工作区文件，没有工作区就必须失败并提示，不能假装成功。
  await page.locator('.project-page .primary').click()
  await expect(page.locator('.statusbar')).toContainText(/失败|工作区/, { timeout: 20_000 })
  const summary = await page.evaluate(() => {
    const workbench = (window as unknown as { __workbench?: WorkbenchDebug }).__workbench
    return workbench?.documents.summary() ?? null
  })
  expect(summary?.docId).toBeNull()
})

test('视图菜单可用：布局重置与显示面板对话框', async () => {
  await page.locator('.menus .menu-button', { hasText: '视图' }).click()
  await expect(page.locator('.menu-list')).toBeVisible()
  await page.locator('.menu-item', { hasText: '恢复默认布局' }).click()
  await expect(page.locator('.statusbar')).toContainText('布局已恢复默认')

  await page.locator('.menus .menu-button', { hasText: '视图' }).click()
  await page.locator('.menu-item', { hasText: '显示面板' }).click()
  await expect(page.locator('[role="dialog"]')).toContainText('显示面板')
  await page.keyboard.press('Escape')
  await expect(page.locator('[role="dialog"]')).toHaveCount(0)
})

test('document 页：默认布局渲染左右中下面板与抽屉（真实组件）', async () => {
  await page.evaluate(() => {
    const workbench = (window as unknown as { __workbench?: WorkbenchDebug }).__workbench
    workbench?.router.navigate('document')
  })
  await expect(page.locator('.document-page')).toBeVisible()
  await expect(page.locator('.doc-header')).toContainText('离线')
  // 面板是懒加载：等真实内容挂上再统计 DOM（不是等固定时间）。
  await expect(page.locator('canvas.preview-canvas')).toHaveCount(1, { timeout: 30_000 })
  await expect(page.locator('[data-focus-scope="panel:core.clip-effects:clip.effects"]')).toBeVisible({ timeout: 30_000 })
  // 右栏是 tab 组：无选中时默认激活「脚本属性」，有选中片段时切到「属性」。
  // 两者都存在，这里断言 tab 存在而不是容器可见（只有活动 tab 可见）。
  await expect(page.locator('[role="tab"]', { hasText: '属性' }).first()).toBeVisible({ timeout: 30_000 })

  const state = await page.evaluate(() => {
    const workbench = (window as unknown as { __workbench?: WorkbenchDebug }).__workbench
    const tree = workbench?.layout.getTree('document')
    const drawerGroup = workbench?.layout.getGroup('document', 'document.drawer')
    return {
      panels: [...document.querySelectorAll('[data-focus-scope^="panel:"]')].map((node) => node.getAttribute('data-focus-scope')),
      drawerDom: document.querySelectorAll('[data-dock-kind="drawer"]').length,
      previewCanvas: document.querySelectorAll('canvas.preview-canvas').length,
      separators: document.querySelectorAll('[role="separator"]').length,
      missing: document.body.innerText.includes('面板不可用'),
      treeRoot: tree === undefined ? null : `${tree.root.type}:${tree.root.id}`,
      treeChildren: (tree?.root.children ?? []).map((child) => `${child.type}:${child.id}`),
      drawerGroup: drawerGroup === undefined ? null : { visible: drawerGroup.visible, collapsed: drawerGroup.collapsed, panels: drawerGroup.panels.length },
      panelTexts: [...document.querySelectorAll('[data-focus-scope^="panel:"]')].map((node) => ({
        scope: node.getAttribute('data-focus-scope'),
        text: (node.textContent ?? '').replace(/\s+/g, ' ').slice(0, 80),
      })),
    }
  })
  const debug = JSON.stringify(state)
  expect(state.panels.length, debug).toBeGreaterThanOrEqual(4)
  expect(state.previewCanvas, debug).toBe(1)
  expect(state.separators, debug).toBeGreaterThanOrEqual(2)
  expect(state.missing, debug).toBe(false)
  expect(state.drawerGroup, debug).not.toBeNull()
  expect(state.drawerDom, debug).toBe(1)
  await page.screenshot({ path: `${ARTIFACTS}/02-document-layout.png` })
})

test('抽屉：打开 diagnostics、显示真实诊断、再点折叠', async () => {
  const drawer = page.locator('[data-dock-kind="drawer"]')
  await expect(drawer).toHaveCount(1)
  // 折叠条里的标签是 role=tab（不是 button）。
  const tabs = await drawer.locator('[role="tab"]').count()
  const tabTexts = await drawer.locator('[role="tab"]').allInnerTexts()
  const drawerBox = await drawer.boundingBox()
  const hit = await page.evaluate(() => {
    const tab = document.querySelector('[data-dock-kind="drawer"] [role="tab"]')
    if (tab === null) {
      return { tab: false }
    }
    const rect = tab.getBoundingClientRect()
    const center = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return {
      tab: true,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      hitTag: center?.tagName ?? null,
      hitClass: center?.className ?? null,
      hitText: (center?.textContent ?? '').slice(0, 20),
    }
  })
  const panes = await page.evaluate(() => {
    const surface = document.querySelector('.dock-surface')
    const surfaceRect = surface === null ? null : surface.getBoundingClientRect()
    const list = [...document.querySelectorAll('.layout-split__pane')].slice(0, 8).map((pane) => {
      const rect = pane.getBoundingClientRect()
      const child = pane.firstElementChild
      return {
        child: child === null ? null : `${child.className}`.slice(0, 60),
        y: Math.round(rect.y),
        h: Math.round(rect.height),
        w: Math.round(rect.width),
      }
    })
    return {
      surface: surfaceRect === null ? null : { y: Math.round(surfaceRect.y), h: Math.round(surfaceRect.height) },
      list,
    }
  })
  console.log('[e2e-drawer]', JSON.stringify({ tabs, tabTexts, drawerBox, hit, panes }))
  const diagnosticsTab = drawer.locator('[role="tab"]', { hasText: '诊断' }).first()
  await expect(diagnosticsTab, JSON.stringify({ tabs, tabTexts })).toBeVisible()
  await diagnosticsTab.click()

  // 打开后抽屉进入可见态：出现关闭按钮与内容区。
  await expect(drawer.locator('.drawer-group__close')).toBeVisible({ timeout: 20_000 })
  await expect(drawer.locator('.drawer-group__body')).toBeVisible({ timeout: 20_000 })
  const bodyText = await drawer.innerText()
  expect(bodyText.length).toBeGreaterThan(10)
  await page.screenshot({ path: `${ARTIFACTS}/03-drawer-diagnostics.png` })

  // 再点当前 tab → 折叠整个抽屉（04-06）。
  await diagnosticsTab.click()
  await expect(drawer.locator('.drawer-group__body')).toHaveCount(0, { timeout: 15_000 })
  await expect(drawer).toHaveClass(/drawer-group--collapsed/)
})

test('命令面板：Mod+Shift+P 打开、搜索、执行 demo 命令', async () => {
  await page.keyboard.press('Control+Shift+P')
  await expect(page.locator('[role="dialog"] .palette-input')).toBeVisible()
  await page.locator('.palette-input').fill('ping')
  await expect(page.locator('.palette-item')).toHaveCount(1)
  await page.locator('.palette-item').first().click()
  await expect(page.locator('[role="dialog"]')).toHaveCount(0)
  await expect(page.locator('.statusbar')).toContainText('ping: 1', { timeout: 15_000 })
})

test('快捷键：F6 焦点循环、Esc 关闭弹窗', async () => {
  await page.keyboard.press('F6')
  const first = await page.evaluate(() => document.activeElement?.getAttribute('data-focus-scope') ?? null)
  await page.keyboard.press('F6')
  const second = await page.evaluate(() => document.activeElement?.getAttribute('data-focus-scope') ?? null)
  expect(first !== null || second !== null).toBe(true)

  await page.keyboard.press('Control+Shift+P')
  await expect(page.locator('[role="dialog"]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('[role="dialog"]')).toHaveCount(0)
})

test('设置页：分区导航 + 主题切换真实改根变量', async () => {
  await page.evaluate(() => {
    const workbench = (window as unknown as { __workbench?: WorkbenchDebug }).__workbench
    workbench?.router.navigate('settings', { section: 'appearance' })
  })
  await expect(page.locator('.settings-page')).toBeVisible()
  await expect(page.locator('.settings-nav')).toContainText('外观')

  const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme-id'))
  const debugSettings = await page.evaluate(() => ({
    cards: [...document.querySelectorAll('.theme-card')].map((node) => (node.textContent ?? '').trim().slice(0, 40)),
    sectionText: (document.querySelector('.settings-content')?.textContent ?? '').slice(0, 160),
    nav: [...document.querySelectorAll('.settings-nav button')].map((node) => node.textContent?.trim()),
  }))
  const lightCard = page.locator('.theme-card', { hasText: '浅色' }).first()
  await expect(lightCard, JSON.stringify(debugSettings)).toBeVisible({ timeout: 15_000 })
  await lightCard.click()
  await expect
    .poll(async () => page.evaluate(() => document.documentElement.getAttribute('data-theme-appearance')))
    .toBe('light')
  const after = await page.evaluate(() => document.documentElement.getAttribute('data-theme-id'))
  expect(after).not.toBe(before)
  await page.screenshot({ path: `${ARTIFACTS}/04-settings-light.png` })

  await page.locator('.theme-card', { hasText: '深色' }).first().click()
  await expect
    .poll(async () => page.evaluate(() => document.documentElement.getAttribute('data-theme-appearance')))
    .toBe('dark')
})

test('语言切换：en_us 后顶栏/状态区文案立即变', async () => {
  // 每个用例自己导航：serial 模式下单独跑 -g 时不依赖前一个用例的副作用。
  await page.evaluate(() => {
    const workbench = (window as unknown as { __workbench?: WorkbenchDebug }).__workbench
    workbench?.router.navigate('settings', { section: 'language' })
  })
  await expect(page.locator('.settings-page')).toBeVisible()
  const langButton = page.locator('.settings-nav button', { hasText: '语言' }).first()
  await expect(langButton).toBeVisible({ timeout: 10_000 })
  await langButton.click()

  const radios = page.locator('.settings-content input[type="radio"]')
  await expect(radios).toHaveCount(2, { timeout: 10_000 })
  await radios.nth(1).check()
  await expect(page.locator('.topbar')).toContainText('File', { timeout: 15_000 })
  await expect(page.locator('.statusbar')).toContainText('Issues')

  await radios.nth(0).check()
  await expect(page.locator('.topbar')).toContainText('文件', { timeout: 15_000 })
  await expect(page.locator('.statusbar')).toContainText('问题')
})

test('窗口：最大化/还原/最小化走真实主进程', async () => {
  const maximized = await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.maximize()
    return window.isMaximized()
  })
  expect(maximized).toBe(true)

  const restored = await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.unmaximize()
    return window.isMaximized()
  })
  expect(restored).toBe(false)

  const size = await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    return window.getSize()
  })
  expect(size[0]).toBeGreaterThanOrEqual(1280)
  expect(size[1]).toBeGreaterThanOrEqual(720)
})

test('生产构建（dist）能启动并渲染外壳', async () => {
  // 不设 IC_EDITOR_DEV_URL → 主进程加载 dist/index.html，走真实打包产物。
  const prodUserData = path.join(process.cwd(), ARTIFACTS, 'user-data-prod')
  await rm(prodUserData, { recursive: true, force: true })
  const prodApp = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      IC_EDITOR_DEV_URL: '',
      IC_WEBUI_TOKEN_FILE: '',
      IC_EDITOR_USER_DATA: prodUserData,
    },
  })
  const prodPage = await prodApp.firstWindow()
  const prodErrors: string[] = []
  prodPage.on('pageerror', (error) => prodErrors.push(error.message))
  try {
    await expect(prodPage.locator('.workspace-shell')).toBeVisible({ timeout: 60_000 })
    await expect(prodPage.locator('.topbar')).toBeVisible()
    await expect(prodPage.locator('.statusbar')).toBeVisible()
    await expect(prodPage.locator('.project-page')).toBeVisible()
    const url = prodPage.url()
    expect(url.startsWith('file://')).toBe(true)
    expect(prodErrors).toEqual([])
  } finally {
    await prodApp.close().catch(() => undefined)
  }
})

test('插件全部激活，且没有 error 级诊断', async () => {
  const state = await page.evaluate(() => {
    const workbench = (window as unknown as {
      __workbench?: {
        plugins: { states(): Array<{ id: string; status: string; error?: string }> }
        diagnostics: { list(): Array<{ severity: string; source: string; message: string; detail?: string }> }
      }
    }).__workbench
    if (workbench === undefined) {
      return { hook: false, states: [], errors: [] }
    }
    return {
      hook: true,
      states: workbench.plugins.states().map((item) => ({ id: item.id, status: item.status, error: item.error })),
      // 只看插件/宿主装配类错误；用户操作失败（如离线新建）本来就应该进诊断，不算缺陷。
      errors: workbench.diagnostics
        .list()
        .filter((item) => item.severity === 'error' && (item.source === 'plugin' || item.source === 'preload' || item.source === 'ipc'))
        .map((item) => ({ source: item.source, message: item.message, detail: item.detail })),
    }
  })
  const debug = JSON.stringify(state)
  expect(state.hook, debug).toBe(true)
  expect(state.states.filter((item) => item.status !== 'active'), debug).toEqual([])
  expect(state.errors, debug).toEqual([])
})

test('渲染进程没有未捕获错误（离线时 WebUI 连接失败除外）', async () => {
  // 没有游戏在跑时连 ws://127.0.0.1:8765 必然失败，这是离线环境的真实状态，
  // 不是缺陷；除它以外的渲染进程错误一律算失败。
  const unexpected = rendererErrors.filter((message) => !message.includes('ws://127.0.0.1:8765'))
  expect(unexpected).toEqual([])
})
