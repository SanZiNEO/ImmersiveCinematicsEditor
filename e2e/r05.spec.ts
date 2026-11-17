/**
 * 05 轮真实端到端验收：脚本页关系图 → 图上改前置 → 撤销 → 编辑器页 → 保存 → 回图 → 删除。
 *
 * `e2e/fakeWebUi.ts` 只替身 WebSocket 网络边界（协议信封与 script.* 回执）；
 * 图索引、DocStore、命令、布局、Vue 渲染全部走真实实现。
 */
import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { installFakeWebUi, makeScript } from './fakeWebUi.ts'

const ARTIFACTS = 'e2e-artifacts'
const USER_DATA = path.join(process.cwd(), ARTIFACTS, 'user-data-r05')

interface DebugWorkbench {
  router: { navigate(pageId: string, params?: Record<string, string>): void; currentPageId: string; reset(pageId: string): void }
  documents: {
    summary(): { docId: string | null; path: string | null; dirty: boolean; name: string }
    commit(command: unknown): { ok: boolean; error?: string }
    undo(): boolean
    revert(): Promise<{ ok: boolean; error?: string }>
  }
  graph: {
    current(): { nodes: Array<{ path: string; scriptId?: string | null; triggers: Array<{ identity: string; requiresFingerprint: string }> }>; edges: Array<{ from: string; to: string; requirementType: string }> } | null
    stale(): boolean
    connected(): boolean
  }
  mutations: {
    mutateRequires(request: Record<string, unknown>): Promise<{ ok: boolean; code?: string; message?: string }>
  }
}

const FILES = {
  'd.json': makeScript('D', 'D'),
  'c.json': makeScript('C', 'C'),
  'b.json': makeScript('B', 'B', ['D']),
  'a.json': makeScript('A', 'A', ['B', { type: 'script_started', data: { script: 'C' } }]),
  'dangling.json': makeScript('DANGLING', 'Dangling', ['ghost']),
  'custom.json': makeScript('CUSTOM', 'Custom', [{ type: 'weather', data: { value: 'rain' } }]),
  'dup1.json': makeScript('DUP', 'Dup1'),
  'dup2.json': makeScript('DUP', 'Dup2'),
  'cycle-a.json': makeScript('CA', 'CycleA', ['CB']),
  'cycle-b.json': makeScript('CB', 'CycleB', ['CA']),
}

let app: ElectronApplication
let page: Page
const rendererErrors: string[] = []

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
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
  page.on('pageerror', (error) => rendererErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('ws://127.0.0.1:8765')) {
      rendererErrors.push(message.text())
    }
  })
  await page.addInitScript(installFakeWebUi, FILES)
  await page.reload()
  await page.waitForSelector('.workspace-shell', { timeout: 60_000 })
  await expect(page.locator('[data-graph-node="a.json"]')).toBeVisible({ timeout: 30_000 })
})

test.afterAll(async () => {
  await app.close().catch(() => undefined)
})

function debug(): DebugWorkbench {
  return (window as unknown as { __workbench?: DebugWorkbench }).__workbench as DebugWorkbench
}

async function fakeFile(pathName: string): Promise<Record<string, unknown> | null> {
  return page.evaluate((name) => {
    const api = (window as unknown as { __fakeWebUi?: { get(path: string): unknown } }).__fakeWebUi
    return (api?.get(name) ?? null) as Record<string, unknown> | null
  }, pathName)
}

/** 指向 `pathName` 的边数量（力导向布局没有坐标契约，前置数只能查图数据）。 */
async function edgeCountTo(pathName: string): Promise<number> {
  return page.evaluate((name) => {
    // 渲染进程把调试入口挂在 window 上且没有类型声明；只在这里读一次。
    const holder = window as unknown as { __workbench?: DebugWorkbench }
    const graph = holder.__workbench?.graph.current() ?? null
    if (graph === null) {
      return 0
    }
    return graph.edges.filter((edge) => edge.to === name).length
  }, pathName)
}

/** 悬停节点并等悬停卡片出现；先把指针挪出画布，保证 pointerenter 一定重新触发。 */
async function hoverNode(pathName: string): Promise<void> {
  await page.mouse.move(2, 2)
  await page.mouse.move(4, 4)
  await page.waitForTimeout(80)
  // 等上一张悬停卡片消失，避免状态残留。
  await expect(page.locator('[data-hover-card="true"]')).toHaveCount(0, { timeout: 5_000 })
  await page.locator(`[data-graph-node="${pathName}"]`).hover()
  await expect(page.locator('[data-hover-card="true"]')).toBeVisible({ timeout: 8_000 })
}

test('C1/A2：启动直接进脚本页，力导向关系图可见', async () => {
  await expect(page.locator('.project-page')).toBeVisible()
  await expect(page.locator('.script-graph-panel')).toBeVisible()
  await expect(page.locator('.graph-toolbar')).toBeVisible()
  await expect(page.locator('.project-page')).not.toContainText('还没有最近项目')

  // 默认小圆点模式；力导向布局不保证任何「同列/同层」坐标，所以只断言结构与图数据。
  await expect(page.locator('.graph-canvas')).toHaveAttribute('data-graph-mode', 'dot')
  const nodeCount = await page.locator('[data-graph-node]').count()
  expect(nodeCount).toBe(10)
  await expect(page.locator('[data-graph-node="a.json"]')).toHaveClass(/node-dot/)
  await expect(page.locator('[data-graph-node="a.json"] .node-dot__circle')).toBeVisible()

  // 默认 showEdges=true：边线 SVG 与 path 都渲染。
  await expect(page.locator('.graph-edges')).toBeVisible()
  expect(await page.locator('.graph-edges path.graph-edge').count()).toBeGreaterThan(0)

  // 默认 grouping=true：文件夹簇框渲染成 `.graph-lane`。
  expect(await page.locator('.graph-lane').count()).toBeGreaterThan(0)

  await page.screenshot({ path: `${ARTIFACTS}/05-01-project-graph.png` })
})

test('A7/C2：选中高亮上下游；悬停显示全部触发器与前置操作', async () => {
  const aNode = page.locator('[data-graph-node="a.json"]')
  await aNode.click()
  await expect(aNode).toHaveAttribute('aria-pressed', 'true')
  // 默认 dot 模式：上下游高亮落在 `node-dot--up` 上。
  await expect(page.locator('[data-graph-node="b.json"]')).toHaveClass(/node-dot--up/)
  await expect(page.locator('[data-graph-node="c.json"]')).toHaveClass(/node-dot--up/)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(aNode).toHaveAttribute('aria-pressed', 'false')

  await hoverNode('a.json')
  const hover = page.locator('[data-hover-card="true"]')
  await expect(hover).toContainText('播放过')
  await expect(hover).toContainText('开始过')
  await expect(hover).toContainText('login')
  await expect(hover).toContainText('换目标')
  await expect(hover).toContainText('删除')
  await page.screenshot({ path: `${ARTIFACTS}/05-02-hover-card.png` })
})

test('C3/C4：图上加一条前置并撤销一次', async () => {
  const aNode = page.locator('[data-graph-node="a.json"]')
  await hoverNode('a.json')
  const hover = page.locator('[data-hover-card="true"]')
  await expect(hover).toBeVisible({ timeout: 3_000 })
  // 悬停卡片跟随指针移动，鼠标点击会追不上按钮；用真实键盘激活（focus + Enter）代替。
  await hover.locator('.trigger-block__add').first().focus()
  await page.keyboard.press('Enter')

  const dialog = page.locator('.dependency-dialog')
  await expect(dialog).toBeVisible()
  await dialog.locator('.form-grid select').first().selectOption('script_completed')
  await dialog.locator('.target-item').filter({ has: page.locator('.target-item__path', { hasText: 'd.json' }) }).click()
  await dialog.locator('.dialog-button--primary').click()
  await expect(dialog).toHaveCount(0, { timeout: 10_000 })

  const added = await fakeFile('a.json')
  const triggers = (added?.meta as { triggers?: Array<{ requires?: unknown[] }> }).triggers ?? []
  expect(triggers[0]?.requires?.length).toBe(3)
  // dot 模式下节点上没有「前置 N」文本；先等 aria-label（图重载完成），再查图数据。
  await expect(page.locator('[data-graph-node="a.json"]')).toHaveAttribute('aria-label', /3 条前置/, { timeout: 10_000 })
  expect(await edgeCountTo('a.json')).toBe(3)

  // 撤销在「更多」面板里：先确保展开，再点。
  if (await page.locator('.graph-toolbar__more').count() === 0) {
    await page.locator('.graph-toolbar button[aria-expanded]').click()
  }
  await expect(page.locator('.graph-toolbar__more')).toBeVisible()
  await page.locator('.graph-toolbar .tool-button', { hasText: '撤销' }).click()
  const undone = await fakeFile('a.json')
  const undoneTriggers = (undone?.meta as { triggers?: Array<{ requires?: unknown[] }> }).triggers ?? []
  expect(undoneTriggers[0]?.requires?.length).toBe(2)
  await expect(aNode).toHaveAttribute('aria-label', /2 条前置/, { timeout: 10_000 })
  expect(await edgeCountTo('a.json')).toBe(2)
  await page.screenshot({ path: `${ARTIFACTS}/05-03-c3-c4.png` })
})

test('A4/A5：搜索过滤与只显异常', async () => {
  const search = page.locator('.graph-toolbar .search-input')
  await search.fill('B')
  await expect(page.locator('[data-graph-node="b.json"]')).toBeVisible()
  await expect(page.locator('[data-graph-node="a.json"]')).toHaveCount(0)
  await search.fill('')
  await expect(page.locator('[data-graph-node="a.json"]')).toBeVisible()

  await page.locator('.graph-toolbar .toolbar-check', { hasText: '只显异常' }).locator('input').check()
  await expect(page.locator('[data-graph-node="custom.json"]')).toHaveCount(0)
  await expect(page.locator('[data-graph-node="dangling.json"]')).toBeVisible()
  await expect(page.locator('[data-graph-node="dup1.json"]')).toBeVisible()
  await page.locator('.graph-toolbar .toolbar-check', { hasText: '只显异常' }).locator('input').uncheck()
  await expect(page.locator('[data-graph-node="custom.json"]')).toBeVisible()
})

test('B1/B2：圆点 ↔ 卡片双模式切换', async () => {
  const canvas = page.locator('.graph-canvas')
  const modeButton = page.locator('.graph-toolbar .tool-button--mode')
  await expect(canvas).toHaveAttribute('data-graph-mode', 'dot')
  await expect(modeButton).toHaveText('卡片视图')

  await modeButton.click()
  await expect(canvas).toHaveAttribute('data-graph-mode', 'card')
  await expect(page.locator('[data-graph-node="a.json"]')).toHaveClass(/node-card/)
  await expect(page.locator('[data-graph-node="a.json"]')).toContainText('前置 2')
  await expect(modeButton).toHaveText('圆点视图')
  await page.screenshot({ path: `${ARTIFACTS}/05-02b-card-mode.png` })

  await modeButton.click()
  await expect(canvas).toHaveAttribute('data-graph-mode', 'dot')
  await expect(page.locator('[data-graph-node="a.json"]')).toHaveClass(/node-dot/)
  await expect(modeButton).toHaveText('卡片视图')
})

test('B4：边线开关隐藏并恢复 .graph-edges', async () => {
  const edges = page.locator('.graph-edges')
  // 边线是「更多」面板里的复选框；先确保展开（前面的用例可能已切换过）。
  if (await page.locator('.graph-toolbar__more').count() === 0) {
    await page.locator('.graph-toolbar button[aria-expanded]').click()
  }
  await expect(page.locator('.graph-toolbar__more')).toBeVisible()
  const edgeCheck = page.locator('.graph-toolbar__more label.toolbar-check', { hasText: '边线' }).locator('input')
  await expect(edgeCheck).toBeChecked()
  await expect(edges).toBeVisible()

  await edgeCheck.uncheck()
  await expect(edges).toHaveCount(0)
  await page.screenshot({ path: `${ARTIFACTS}/05-02c-edges-off.png` })

  await edgeCheck.check()
  await expect(edges).toBeVisible()
  expect(await page.locator('.graph-edges path.graph-edge').count()).toBeGreaterThan(0)
})

test('C5/B3/C6/C7：双击进编辑器页，触发器表单改前置并保存', async () => {
  // 双击手势按 `[data-graph-node]` 统一处理，与 dot/card 模式无关；
  // 先把指针挪出图视口，等悬停卡片自行消失，避免它盖住节点拦截双击。
  await page.mouse.move(5, 5)
  await expect(page.locator('[data-hover-card="true"]')).toHaveCount(0, { timeout: 5_000 })
  await page.locator('[data-graph-node="a.json"]').dblclick()
  await expect(page.locator('.document-page')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.doc-header')).toContainText('A')
  await expect(page.locator('[data-focus-scope="panel:core.timeline:timeline.main"]')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[data-focus-scope="panel:core.clip-effects:clip.effects"]')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[data-focus-scope="panel:core.selection-properties:selection.properties"]')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.timeline-panel')).toContainText('还没有轨道')

  await page.locator('#selection-tab-trigger').click()
  await expect(page.locator('.trigger-pane')).toBeVisible()
  await page.locator('.trigger-item').first().click()
  const requires = page.locator('.requires')
  await expect(requires).toContainText('前置（2）')
  await requires.locator('.requires__button', { hasText: '换目标' }).first().click()
  // 编辑器页只显示关系：表单只有「目标脚本」一个下拉（类型不再暴露）。
  await requires.locator('select.requires__input').first().selectOption('D')
  await requires.locator('button[type="submit"]').click()
  await expect(requires).toContainText('前置（2）', { timeout: 10_000 })

  const editorFile = await fakeFile('a.json')
  const editorRequires = ((editorFile?.meta as { triggers?: Array<{ requires?: unknown[] }> }).triggers ?? [])[0]?.requires ?? []
  expect(editorRequires.length).toBe(2)
  // 目标改为 D：关系成立即可（类型沿用原值）。
  expect(JSON.stringify(editorRequires)).toContain('"D"')

  await page.locator('.doc-header button', { hasText: '保存' }).click()
  await expect(page.locator('.doc-header')).toContainText('已保存', { timeout: 10_000 })
  const saveCalls = await page.evaluate(() => {
    const api = (window as unknown as { __fakeWebUi?: { requestCount(type: string): number } }).__fakeWebUi
    return api?.requestCount('script.save') ?? 0
  })
  expect(saveCalls).toBeGreaterThanOrEqual(1)
  await page.screenshot({ path: `${ARTIFACTS}/05-04-c5-c7.png` })
})

test('C8/C9：回脚本页图已刷新，再删一条前置', async () => {
  await page.locator('.doc-header button', { hasText: '项目' }).click()
  await expect(page.locator('.script-graph-panel')).toBeVisible({ timeout: 20_000 })
  // 用 b.json 做删除验证：它的前置（D）不被前面用例改动，避免状态污染。
  const bNode = page.locator('[data-graph-node="b.json"]')
  await expect(bNode).toHaveAttribute('aria-label', /1 条前置/, { timeout: 20_000 })
  expect(await edgeCountTo('b.json')).toBe(1)

  await hoverNode('b.json')
  const hover = page.locator('[data-hover-card="true"]')
  await expect(hover).toBeVisible({ timeout: 8_000 })
  const row = hover.locator('.requirement-row').last()
  await row.locator('button', { hasText: '删除' }).focus()
  await page.keyboard.press('Enter')
  const dialog = page.locator('.dependency-dialog')
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await dialog.locator('button', { hasText: '确认删除' }).click()
  // 以数据为准：最后一条删除后 requires 键消失（不是空数组）。
  await expect.poll(async () => {
    const file = await fakeFile('b.json')
    const trigger = ((file?.meta as { triggers?: Array<Record<string, unknown>> }).triggers ?? [])[0]
    return trigger === undefined ? -1 : (Array.isArray(trigger.requires) ? trigger.requires.length : 0)
  }, { timeout: 20_000 }).toBe(0)
  await expect(dialog).toHaveCount(0, { timeout: 20_000 })
  expect(await edgeCountTo('b.json')).toBe(0)
  await page.screenshot({ path: `${ARTIFACTS}/05-05-c8-c9.png` })
})

test('D1/D3/D4：断连拒写、指纹过期、脏文档拒写', async () => {
  // 先清掉前序用例可能留下的脏状态，否则双击进编辑器会被原生 UnsavedGuard 卡住。
  await page.evaluate(() => {
    const workbench = (window as unknown as { __workbench: DebugWorkbench }).__workbench
    let guard = 0
    while (workbench.documents.summary().dirty && guard < 20) {
      workbench.documents.undo()
      guard += 1
    }
  })
  // 打开 dangling.json，让「当前文档」就是它：断连时才会走 offline 分支。
  await page.locator('[data-graph-node="dangling.json"]').dblclick()
  await expect(page.locator('.document-page')).toBeVisible({ timeout: 20_000 })
  await page.locator('.doc-header button', { hasText: '项目' }).click()
  await expect(page.locator('.script-graph-panel')).toBeVisible({ timeout: 20_000 })
  const before = await fakeFile('dangling.json')
  await page.evaluate(() => {
    const api = (window as unknown as { __fakeWebUi: { disconnect(): void } }).__fakeWebUi
    api.disconnect()
  })
  await expect(page.locator('.graph-banners')).toContainText('未连接模组', { timeout: 10_000 })

  const offline = await page.evaluate(async () => {
    const workbench = (window as unknown as { __workbench: DebugWorkbench }).__workbench
    const node = workbench.graph.current()?.nodes.find((item) => item.path === 'dangling.json')
    return workbench.mutations.mutateRequires({
      path: 'dangling.json',
      triggerIdentity: node?.triggers[0]?.identity ?? 'DANGLING_trigger',
      triggerIndex: 0,
      requiresFingerprint: node?.triggers[0]?.requiresFingerprint ?? '',
      operation: 'add',
      index: 1,
      requirementType: 'script_played',
      targetScriptId: 'D',
    })
  })
  // 断连拒写：必须返回 offline，且文件不变。
  expect(offline.ok).toBe(false)
  expect(offline.code).toBe('offline')
  expect(await fakeFile('dangling.json')).toEqual(before)

  await page.evaluate(() => {
    const api = (window as unknown as { __fakeWebUi: { reconnect(): void } }).__fakeWebUi
    api.reconnect()
  })
  // 重连后服务会广播 reconnect，图面板 debounce 300ms 自动刷新；这里再手动刷一次兜底。
  await page.waitForTimeout(1200)
  await page.locator('.graph-toolbar button', { hasText: '刷新' }).click()
  await expect(page.locator('.graph-banners')).not.toContainText('未连接模组', { timeout: 20_000 })

  const stale = await page.evaluate(async () => {
    const workbench = (window as unknown as { __workbench: DebugWorkbench }).__workbench
    const node = workbench.graph.current()?.nodes.find((item) => item.path === 'dangling.json')
    return workbench.mutations.mutateRequires({
      path: 'dangling.json',
      triggerIdentity: node?.triggers[0]?.identity ?? '',
      triggerIndex: 0,
      requiresFingerprint: '0000000000000000',
      operation: 'remove',
      index: 0,
    })
  })
  expect(stale.ok).toBe(false)
  expect(stale.code).toBe('stale_requires')

  // 脏文档：必须在编辑器页打开 dangling.json 后制造脏状态，才能命中 dirty_conflict。
  await page.locator('[data-graph-node="dangling.json"]').dblclick()
  await expect(page.locator('.document-page')).toBeVisible({ timeout: 20_000 })
  const dirty = await page.evaluate(async () => {
    const workbench = (window as unknown as { __workbench: DebugWorkbench }).__workbench
    workbench.documents.commit({ kind: 'meta.set', key: 'name', value: 'DANGLING dirty' })
    const node = workbench.graph.current()?.nodes.find((item) => item.path === 'dangling.json')
    return workbench.mutations.mutateRequires({
      path: 'dangling.json',
      triggerIdentity: node?.triggers[0]?.identity ?? 'DANGLING_trigger',
      triggerIndex: 0,
      requiresFingerprint: node?.triggers[0]?.requiresFingerprint ?? '',
      operation: 'add',
      index: 1,
      requirementType: 'script_played',
      targetScriptId: 'D',
    })
  })
  expect(dirty.ok).toBe(false)
  expect(dirty.code).toBe('dirty_conflict')
  // 守卫用的是 Electron 原生 confirm 对话框（不是 DOM），e2e 点不到；
  // 因此这里必须把脏状态彻底清掉，否则后续切页/关窗会被原生对话框卡住。
  // undo 可能撤不掉（命令合并），用 revert 重新加载文档丢弃内存修改。
  await page.evaluate(async () => {
    const workbench = (window as unknown as { __workbench: DebugWorkbench }).__workbench
    if (workbench.documents.summary().dirty) {
      await workbench.documents.revert()
    }
  })
  await expect.poll(async () => page.evaluate(() => {
    const workbench = (window as unknown as { __workbench: DebugWorkbench }).__workbench
    return workbench.documents.summary().dirty
  }), { timeout: 15_000 }).toBe(false)

  const unexpected = rendererErrors.filter((message) => !message.includes('ws://127.0.0.1:8765'))
  expect(unexpected).toEqual([])
})
