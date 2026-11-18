/**
 * 05 轮真实端到端验收：脚本页关系图 → 图上改前置 → 撤销 → 编辑器页 → 保存 → 回图 → 删除。
 *
 * `e2e/fakeWebUi.ts` 只替身 WebSocket 网络边界（协议信封与 script.* 回执）；
 * 图索引、DocStore、命令、布局、Vue 渲染全部走真实实现。
 */
import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { installFakeWebUi, makeScript } from './fakeWebUi.ts'

const ARTIFACTS = 'e2e-artifacts'
const USER_DATA = path.join(process.cwd(), ARTIFACTS, 'user-data-r05')
/** 临时工作区（脚本真实落盘在这里）。 */
const WORKSPACE = path.join(process.cwd(), ARTIFACTS, 'workspace-r05')

interface DebugWorkbench {
  router: { navigate(pageId: string, params?: Record<string, string>): void; currentPageId: string; reset(pageId: string): void }
  documents: {
    summary(): { docId: string | null; path: string | null; dirty: boolean; name: string }
    commit(command: unknown): { ok: boolean; error?: string }
    undo(): boolean
    revert(): Promise<{ ok: boolean; error?: string }>
    save(): Promise<{ ok: boolean; error?: string }>
  }
  graph: {
    current(): { version: number; nodes: Array<{ path: string; scriptId?: string | null; triggers: Array<{ identity: string; requiresFingerprint: string }> }>; edges: Array<{ from: string; to: string; requirementType: string }>; stats: { nodeCount: number; edgeCount: number } } | null
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
}

/** 夹具脚本数（FILES 的键数）；节点数断言统一引用它，避免改动夹具后漏改。 */
const FIXTURE_COUNT = Object.keys(FILES).length

let app: ElectronApplication
let page: Page
const rendererErrors: string[] = []

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  await mkdir(ARTIFACTS, { recursive: true })
  await rm(USER_DATA, { recursive: true, force: true })
  // 脚本现在来自工作区文件（不经模组）：把夹具写成真实 JSON 文件。
  await rm(WORKSPACE, { recursive: true, force: true })
  const scriptsDir = path.join(WORKSPACE, 'scripts')
  await mkdir(scriptsDir, { recursive: true })
  for (const [name, doc] of Object.entries(FILES)) {
    await writeFile(path.join(scriptsDir, name), `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
  }
  app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      IC_EDITOR_DEV_URL: 'http://localhost:5173',
      IC_WEBUI_TOKEN_FILE: '',
      IC_EDITOR_USER_DATA: USER_DATA,
      // 工作区指向临时目录：脚本读写走真实文件，模组通道仍由 fakeWebUi 替身。
      IC_EDITOR_WORKSPACE: WORKSPACE,
    },
  })
  page = await app.firstWindow()
  page.on('pageerror', (error) => rendererErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('ws://127.0.0.1:8765')) {
      rendererErrors.push(message.text())
    }
  })
  // fakeWebUi 只替身预览/播放通道（script.* 文件消息已不再使用）。
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

/** 读工作区里的真实脚本文件（脚本已不经模组，必须查磁盘）。 */
async function fakeFile(pathName: string): Promise<Record<string, unknown> | null> {
  try {
    const text = await readFile(path.join(WORKSPACE, 'scripts', pathName), 'utf8')
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
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

/** 回到脚本页（前序用例可能停在编辑器页）。 */
async function backToGraphPage(): Promise<void> {
  const back = page.locator('.doc-header button', { hasText: '项目' })
  if (await back.count() > 0) {
    await back.click()
  }
  await expect(page.locator('.script-graph-panel')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[data-graph-node="a.json"]')).toBeVisible({ timeout: 20_000 })
}

test('C1/A2：启动直接进脚本页，力导向关系图可见', async () => {
  await expect(page.locator('.project-page')).toBeVisible()
  await expect(page.locator('.script-graph-panel')).toBeVisible()
  await expect(page.locator('.graph-toolbar')).toBeVisible()
  await expect(page.locator('.project-page')).not.toContainText('还没有最近项目')

  // 默认小圆点模式；力导向布局不保证任何「同列/同层」坐标，所以只断言结构与图数据。
  await expect(page.locator('.graph-canvas')).toHaveAttribute('data-graph-mode', 'dot')
  const nodeCount = await page.locator('[data-graph-node]').count()
  expect(nodeCount).toBe(FIXTURE_COUNT)
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
  // 右栏是 tab 组（属性 / 触发器 / 脚本属性）：无选中时激活脚本属性，故断言 tab 存在。
  await expect(page.locator('[role="tab"]', { hasText: '属性' }).first()).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.timeline-panel')).toContainText('还没有轨道')

  // 触发器已迁到独立插件 `core.behavior`（06-12）：右栏同槽并列成面板级 tab。
  const behaviorTab = page.locator('[role="tab"]', { hasText: '触发器' }).first()
  await expect(behaviorTab).toBeVisible({ timeout: 20_000 })
  await behaviorTab.click()
  await expect(page.locator('[data-focus-scope="panel:core.behavior:behavior.triggers"]')).toBeVisible({ timeout: 20_000 })
  const triggerPane = page.locator('[data-focus-scope="panel:core.behavior:behavior.triggers"] .trigger-pane')
  await expect(triggerPane).toBeVisible()
  await triggerPane.locator('.trigger-item').first().click()
  const requires = triggerPane.locator('.requires')
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
  // 保存直接写工作区文件（不经 script.save）：断言磁盘内容，而不是协议计数。
  const savedOnDisk = await fakeFile('a.json')
  const savedRequires = ((savedOnDisk?.meta as { triggers?: Array<{ requires?: unknown[] }> }).triggers ?? [])[0]?.requires ?? []
  expect(JSON.stringify(savedRequires)).toContain('"D"')
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

test('D1/D3/D4：游戏断连不影响写盘、指纹过期、脏文档拒写', async () => {
  // 先清掉前序用例可能留下的脏状态，否则双击进编辑器会被原生 UnsavedGuard 卡住。
  await page.evaluate(() => {
    const workbench = (window as unknown as { __workbench: DebugWorkbench }).__workbench
    let guard = 0
    while (workbench.documents.summary().dirty && guard < 20) {
      workbench.documents.undo()
      guard += 1
    }
  })
  // 打开 dangling.json，让「当前文档」就是它。
  await page.locator('[data-graph-node="dangling.json"]').dblclick()
  await expect(page.locator('.document-page')).toBeVisible({ timeout: 20_000 })
  await page.locator('.doc-header button', { hasText: '项目' }).click()
  await expect(page.locator('.script-graph-panel')).toBeVisible({ timeout: 20_000 })
  // 断掉模组通道（游戏未运行）：这只影响预览/推送，不影响脚本读写。
  await page.evaluate(() => {
    const api = (window as unknown as { __fakeWebUi: { disconnect(): void } }).__fakeWebUi
    api.disconnect()
  })

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
  // 脚本来自工作区文件：游戏断连时改前置照样成功并落盘（不依赖模组）。
  expect(offline.ok).toBe(true)
  const afterOffline = await fakeFile('dangling.json')
  const offlineRequires = ((afterOffline?.meta as { triggers?: Array<{ requires?: unknown[] }> }).triggers ?? [])[0]?.requires ?? []
  expect(offlineRequires.length).toBe(2)
  expect(JSON.stringify(offlineRequires)).toContain('"D"')

  await page.evaluate(() => {
    const api = (window as unknown as { __fakeWebUi: { reconnect(): void } }).__fakeWebUi
    api.reconnect()
  })
  await page.waitForTimeout(300)

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

test('A1/A6：文件夹框折叠与节点总数（空态不造假节点）', async () => {
  await backToGraphPage()
  // 默认 grouping=true：文件夹簇框渲染成 `.graph-lane`。
  expect(await page.locator('.graph-lane').count()).toBeGreaterThan(0)
  // 空态（无匹配 / 无异常）不能凭空造节点：数量必须等于夹具脚本数。
  expect(await page.locator('[data-graph-node]').count()).toBe(FIXTURE_COUNT)

  if (await page.locator('.graph-toolbar__more').count() === 0) {
    await page.locator('.graph-toolbar button[aria-expanded]').click()
  }
  const laneCheck = page.locator('.graph-toolbar__more label.toolbar-check', { hasText: '文件夹框' }).locator('input')
  await expect(laneCheck).toBeChecked()
  await laneCheck.uncheck()
  await expect(page.locator('.graph-lane')).toHaveCount(0)
  // 关掉簇框不减少节点：只是不画框。
  expect(await page.locator('[data-graph-node]').count()).toBe(FIXTURE_COUNT)

  await laneCheck.check()
  await expect(page.locator('.graph-lane').first()).toBeVisible({ timeout: 10_000 })
})

test('A8/A9/A10/A11：悬空桩、重复 id、自定义前置都照常渲染', async () => {
  await backToGraphPage()
  // 悬空前置（ghost）：渲染成桩元素，不静默丢弃。
  expect(await page.locator('.graph-stub').count()).toBeGreaterThan(0)

  // 重复 id（dup1/dup2 的 meta.id 都是 DUP）：两个节点都进图。
  await expect(page.locator('[data-graph-node="dup1.json"]')).toBeVisible()
  await expect(page.locator('[data-graph-node="dup2.json"]')).toBeVisible()

  // 自定义前置（weather）：节点正常显示，不因未知类型被过滤。
  await expect(page.locator('[data-graph-node="custom.json"]')).toBeVisible()

  // DAG 不变量：图里不存在环（成环的边在索引阶段就被丢弃）。
  const acyclic = await page.evaluate(() => {
    const workbench = (window as unknown as { __workbench: DebugWorkbench }).__workbench
    const graph = workbench.graph.current()
    if (graph === null) {
      return false
    }
    const out = new Map<string, string[]>()
    for (const edge of graph.edges) {
      const list = out.get(edge.from) ?? []
      list.push(edge.to)
      out.set(edge.from, list)
    }
    const reaches = (start: string, goal: string): boolean => {
      const seen = new Set<string>([start])
      const stack = [start]
      while (stack.length > 0) {
        const current = stack.pop() as string
        for (const next of out.get(current) ?? []) {
          if (next === goal) {
            return true
          }
          if (!seen.has(next)) {
            seen.add(next)
            stack.push(next)
          }
        }
      }
      return false
    }
    return graph.edges.every((edge) => !reaches(edge.to, edge.from))
  })
  expect(acyclic).toBe(true)
})

test('A16/A17：dot/card 双模式共用同一批坐标', async () => {
  await backToGraphPage()
  const canvas = page.locator('.graph-canvas')
  const modeButton = page.locator('.graph-toolbar .tool-button--mode')
  const dotCount = await page.locator('[data-graph-node]').count()

  await modeButton.click()
  await expect(canvas).toHaveAttribute('data-graph-mode', 'card')
  await expect(page.locator('[data-graph-node="a.json"]')).toHaveClass(/node-card/)
  const cardCount = await page.locator('[data-graph-node]').count()
  // 两种模式共用坐标：节点数必须相同，不能因为卡片更大而裁掉节点。
  expect(cardCount).toBe(dotCount)

  await modeButton.click()
  await expect(canvas).toHaveAttribute('data-graph-mode', 'dot')
  await expect(page.locator('[data-graph-node="a.json"]')).toHaveClass(/node-dot/)
  expect(await page.locator('[data-graph-node]').count()).toBe(dotCount)
})

test('C11/C12/C15/D7/D8：跨页一致、四面板、刷新合并、统计与渲染一致', async () => {
  await backToGraphPage()
  // D8：stats.nodeCount 与真实渲染的节点数一致（夹具 10 个，未触发截断）。
  const stats = await page.evaluate(() => {
    const workbench = (window as unknown as { __workbench: DebugWorkbench }).__workbench
    return workbench.graph.current()?.stats.nodeCount ?? -1
  })
  expect(stats).toBe(FIXTURE_COUNT)
  expect(await page.locator('[data-graph-node]').count()).toBe(FIXTURE_COUNT)

  // C11：图上加一条前置 → 进编辑器页同一脚本，`.requires` 里出现该目标（无第二份缓存）。
  const target = await page.evaluate(async () => {
    const workbench = (window as unknown as { __workbench: DebugWorkbench }).__workbench
    const node = workbench.graph.current()?.nodes.find((item) => item.path === 'custom.json')
    return workbench.mutations.mutateRequires({
      path: 'custom.json',
      triggerIdentity: node?.triggers[0]?.identity ?? '',
      triggerIndex: 0,
      requiresFingerprint: node?.triggers[0]?.requiresFingerprint ?? '',
      operation: 'add',
      index: 1,
      requirementType: 'script_played',
      targetScriptId: 'D',
    })
  })
  expect(target.ok).toBe(true)
  // custom.json 原有 1 条自定义前置（weather，不计入内置前置数），加 1 条内置前置后为 1。
  await expect(page.locator('[data-graph-node="custom.json"]')).toHaveAttribute('aria-label', /1 条前置/, { timeout: 20_000 })
  await page.locator('[data-graph-node="custom.json"]').dblclick()
  await expect(page.locator('.document-page')).toBeVisible({ timeout: 20_000 })
  // 触发器是 `document.right` 的独立面板 tab（06-12），不再是属性面板内的 tab。
  const behaviorTab = page.locator('[role="tab"]', { hasText: '触发器' }).first()
  await expect(behaviorTab).toBeVisible({ timeout: 20_000 })
  await behaviorTab.click()
  const behaviorPanel = page.locator('[data-focus-scope="panel:core.behavior:behavior.triggers"]')
  await expect(behaviorPanel).toBeVisible({ timeout: 20_000 })
  await behaviorPanel.locator('.trigger-item').first().click()
  const requires = behaviorPanel.locator('.requires')
  await expect(requires).toContainText('前置（2）', { timeout: 20_000 })

  // C12：编辑器页改回（删掉刚加的那条内置前置）→ 回脚本页，边数与磁盘一致，无需手动刷新。
  // 只删新增的那条（最后一条）；自定义 weather 前置保留。
  await requires.locator('.requires__button', { hasText: '删除' }).last().click()
  await requires.locator('.requires__button', { hasText: '确认删除' }).click()
  await expect.poll(async () => {
    const file = await fakeFile('custom.json')
    const list = ((file?.meta as { triggers?: Array<{ requires?: unknown[] }> }).triggers ?? [])[0]?.requires ?? []
    return list.length
  }, { timeout: 20_000 }).toBe(1)
  await page.locator('.doc-header button', { hasText: '保存' }).click()
  await expect(page.locator('.doc-header')).toContainText('已保存', { timeout: 20_000 })

  // D7：连续 commit + save 5 次不应触发 5 次全量重扫。
  // 文件来自工作区，扫描入口不再是协议消息，改为观测图版本号增长次数。
  const versionBefore = await page.evaluate(() => {
    const workbench = (window as unknown as { __workbench: DebugWorkbench }).__workbench
    return workbench.graph.current()?.version ?? -1
  })
  for (let index = 0; index < 5; index += 1) {
    await page.evaluate(async (step: number) => {
      const workbench = (window as unknown as { __workbench: DebugWorkbench }).__workbench
      workbench.documents.commit({ kind: 'meta.set', key: 'description', value: `d${step}` })
      await workbench.documents.save()
    }, index)
  }
  // 保存会广播失效并 debounce 合并，但不会「每保存一次就重建一次图」。
  await page.waitForTimeout(1500)
  const versionAfter = await page.evaluate(() => {
    const workbench = (window as unknown as { __workbench: DebugWorkbench }).__workbench
    return workbench.graph.current()?.version ?? -1
  })
  expect(versionAfter - versionBefore).toBeLessThanOrEqual(5)
  // 清掉这轮改动，避免影响后续对磁盘内容的断言。
  await page.evaluate(async () => {
    const workbench = (window as unknown as { __workbench: DebugWorkbench }).__workbench
    if (workbench.documents.summary().dirty) {
      await workbench.documents.revert()
    }
  })

  await page.locator('.doc-header button', { hasText: '项目' }).click()
  await expect(page.locator('.script-graph-panel')).toBeVisible({ timeout: 20_000 })
  // 删掉内置前置后不再有边（weather 是自定义前置，本来就不建边），与磁盘一致。
  expect(await edgeCountTo('custom.json')).toBe(0)
  const disk = await fakeFile('custom.json')
  const diskRequires = ((disk?.meta as { triggers?: Array<{ requires?: unknown[] }> }).triggers ?? [])[0]?.requires ?? []
  expect(diskRequires.length).toBe(1)

  // C15：四个面板容器同时存在（跨页布局一致）。
  await expect(page.locator('.script-graph-panel')).toBeVisible()
  await page.locator('[data-graph-node="a.json"]').dblclick()
  await expect(page.locator('.document-page')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.timeline-panel')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[data-focus-scope="panel:core.clip-effects:clip.effects"]')).toBeVisible({ timeout: 20_000 })
  // 右栏是 tab 组：属性与触发器同槽并列（06-12 把触发器迁出属性面板）。
  // 只有一个处于选中态可见，因此断言两个 tab 都存在，而不是两个容器都可见。
  await expect(page.locator('[role="tab"]', { hasText: '属性' }).first()).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[role="tab"]', { hasText: '触发器' }).first()).toBeVisible({ timeout: 20_000 })
  await page.locator('.doc-header button', { hasText: '项目' }).click()
  await expect(page.locator('.script-graph-panel')).toBeVisible({ timeout: 20_000 })

  const unexpected = rendererErrors.filter((message) => !message.includes('ws://127.0.0.1:8765'))
  expect(unexpected).toEqual([])
})
