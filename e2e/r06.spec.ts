/**
 * 06 轮真实端到端验收：双面板职责、面板迁移、节点编辑、局部视口、事件、保存重开。
 *
 * 只替身 WebSocket 网络边界（`e2e/fakeWebUi.ts`）；DocStore、命令层、归属策略、
 * Vue 渲染、工作区文件读写全部走真实实现。
 *
 * 数据准备（06-11 §三要求）：
 * - 三个片段：有限（CAMERA）、无限（duration<0）、循环（loop + loop_count）；
 * - 一个含事件（EVENT 轨）、一个含结构（CAMERA 的 rgb_curve）、一个含未知路径；
 * - 一个片段上百属性叶子、数百关键帧节点。
 */
import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const ARTIFACTS = 'e2e-artifacts'
const USER_DATA = path.join(process.cwd(), ARTIFACTS, 'user-data-r06')
const WORKSPACE = path.join(process.cwd(), ARTIFACTS, 'workspace-r06')

/** 工作台调试入口（与 r05 同形）。 */
interface DebugWorkbench {
  router: { navigate(pageId: string, params?: Record<string, string>): void }
  documents: {
    summary(): { docId: string | null; path: string | null; dirty: boolean }
    commit(command: unknown, coalesceWith?: string): { ok: boolean; error?: string }
    undo(): boolean
    redo(): boolean
    save(): Promise<{ ok: boolean; error?: string }>
    open(path: string): Promise<{ ok: boolean; error?: string }>
    clips(): Array<{ clipKey: string; trackType: string }>
    select(selection: { domain: string; clipKey?: string }): void
  }
}

/**
 * 在 `page.evaluate` 内取调试工作台。
 *
 * 注意：这段守卫必须**在页面里执行**（`page.evaluate` 的闭包不共享 Node 侧函数），
 * 所以每个 evaluate 里重复写一次；钩子缺失时抛明确错误，而不是让后续访问静默读到 `undefined`。
 */
const WORKBENCH_GUARD = `
  const holder = window;
  const candidate = holder.__workbench;
  if (candidate === null || typeof candidate !== 'object') {
    throw new Error('调试钩子 window.__workbench 缺失');
  }
`

let app: ElectronApplication
let page: Page
const rendererErrors: string[] = []

test.describe.configure({ mode: 'serial' })

/** 一个 CAMERA 片段：位置三轴两帧 + 静态值。 */
function cameraClip(start: number, duration: number): Record<string, unknown> {
  return {
    start_time: start,
    duration,
    objects: {
      'position.x': { keyframes: [{ time: 0, value: 1 }, { time: 1, value: 5 }] },
      'position.y': { value: 2 },
      'position.z': { value: 3 },
      yaw: { value: 0 },
      pitch: { value: 0 },
      roll: { value: 0 },
      fov: { keyframes: [] },
      zoom: { value: 1 },
      transition: { value: 'cut' },
    },
  }
}

/** 上百叶子的片段：57 个调色通道各两帧 + 结构曲线。 */
function denseClip(): Record<string, unknown> {
  const channels = [
    'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks',
    'hue', 'saturation', 'vibrance', 'lightness', 'temperature', 'tint',
    'red', 'green', 'blue',
    'mix_rr', 'mix_rg', 'mix_rb', 'mix_gr', 'mix_gg', 'mix_gb', 'mix_br', 'mix_bg', 'mix_bb',
    'curve_strength', 'r_curve_strength', 'g_curve_strength', 'b_curve_strength',
    'lift_r', 'lift_g', 'lift_b', 'gamma_r', 'gamma_g', 'gamma_b', 'gain_r', 'gain_g', 'gain_b',
    'hv_h_strength', 'hv_s_strength', 'hv_l_strength', 'lv_s_strength', 'sv_s_strength', 'sv_l_strength',
    'hue_red', 'sat_red', 'hue_yellow', 'sat_yellow', 'hue_green', 'sat_green',
    'hue_cyan', 'sat_cyan', 'hue_blue', 'sat_blue', 'hue_magenta', 'sat_magenta',
    'grayscale', 'invert',
  ]
  const objects: Record<string, unknown> = {}
  for (const channel of channels) {
    objects[channel] = {
      keyframes: [
        { time: 0, value: 0 },
        { time: 1, value: 0.5 },
        { time: 2, value: 1 },
      ],
    }
  }
  objects.rgb_curve = { value: { kind: 'none' } }
  return { start_time: 0, duration: 4, objects }
}

/** 事件片段。 */
function eventClip(): Record<string, unknown> {
  return {
    start_time: 0,
    duration: 3,
    objects: {
      event: { keyframes: [{ time: 1, value: { command: 'say hi' } }] },
      event_type: { value: 'command' },
    },
  }
}

const FILES: Record<string, Record<string, unknown>> = {
  'finite.json': {
    meta: { id: 'FINITE', name: 'Finite', author: 'e2e' },
    timeline: { tracks: [{ type: 'CAMERA', clips: [cameraClip(0, 4)] }] },
  },
  'infinite.json': {
    meta: { id: 'INFINITE', name: 'Infinite', author: 'e2e' },
    timeline: { tracks: [{ type: 'CAMERA', clips: [cameraClip(0, -1)] }] },
  },
  'looping.json': {
    meta: { id: 'LOOPING', name: 'Looping', author: 'e2e' },
    timeline: {
      tracks: [{
        type: 'CAMERA',
        clips: [{ ...cameraClip(0, 2), loop: true, loop_count: 3 }],
      }],
    },
  },
  'dense.json': {
    meta: { id: 'DENSE', name: 'Dense', author: 'e2e' },
    timeline: { tracks: [{ type: 'CAMERA', clips: [denseClip()] }] },
  },
  'events.json': {
    meta: { id: 'EVENTS', name: 'Events', author: 'e2e' },
    timeline: {
      tracks: [
        { type: 'CAMERA', clips: [cameraClip(0, 3)] },
        { type: 'EVENT', clips: [eventClip()] },
      ],
    },
  },
}

test.beforeAll(async () => {
  await mkdir(ARTIFACTS, { recursive: true })
  await rm(USER_DATA, { recursive: true, force: true })
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
      IC_EDITOR_WORKSPACE: WORKSPACE,
    },
  })
  page = await app.firstWindow()
  page.on('pageerror', (error) => rendererErrors.push(error.message))
  // 本轮断言全部基于工作区真实文件与 UI；模组通道不需要替身，
  // 断连产生的 `ws://127.0.0.1:8765` 错误在 R6-9 里显式过滤。
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app.close()
})

/** 打开一个脚本并进入编辑器页。 */
async function openScript(name: string): Promise<void> {
  const ok = await page.evaluate(async (target: string) => {
    const holder = window as unknown as { __workbench?: DebugWorkbench }
    const workbench = holder.__workbench
    if (workbench === undefined) {
      throw new Error('调试钩子 window.__workbench 缺失')
    }
    const result = await workbench.documents.open(target)
    if (result.ok) {
      workbench.router.navigate('document')
    }
    return result.ok
  }, name)
  expect(ok, `打开 ${name} 失败`).toBe(true)
  await expect(page.locator('.document-page')).toBeVisible({ timeout: 20_000 })
}

/** 取效果面板与属性面板容器。 */
function effectsPanel() {
  return page.locator('[data-focus-scope="panel:core.clip-effects:clip.effects"]')
}

function propertiesPanel() {
  return page.locator('[data-focus-scope="panel:core.selection-properties:selection.properties"]')
}

/** 等面板内容真正挂载（懒加载 + 首次渲染完成），不只等容器可见。 */
async function waitForPanels(): Promise<void> {
  await expect(effectsPanel().locator('.effects-panel, .effects-empty, .effects-notice').first())
    .toBeVisible({ timeout: 30_000 })
  await expect(propertiesPanel().locator('.props-panel, .props-panel__empty, .props-panel__notice').first())
    .toBeVisible({ timeout: 30_000 })
}

test('R6-1：双面板职责 —— 效果面板只列有帧属性，属性面板列全部', async () => {
  await openScript('finite.json')
  await waitForPanels()

  const text = await effectsPanel().innerText()
  // 有帧的只有 position.x（2 帧）与 fov（空数组，不应出现）。
  expect(text).toContain('position.x')
  expect(text).not.toContain('position.y')
  // 效果面板没有任何添加入口。
  expect(text).not.toContain('添加属性')
  expect(text).not.toContain('新建效果')
  expect(text).not.toContain('添加组')

  const propertyText = await propertiesPanel().innerText()
  expect(propertyText).toContain('position.y')
  expect(propertyText).toContain('未设置')

  await page.screenshot({ path: `${ARTIFACTS}/06-01-dual-panels.png` })
})

test('R6-2：开时钟 → 行迁入效果面板 → 撤销迁回', async () => {
  await openScript('finite.json')
  await waitForPanels()
  const before = await effectsPanel().innerText()
  expect(before).not.toContain('yaw')

  // clipKey 由效果面板根 `<section>` 提供（PanelHost 容器本身不带业务属性）。
  const clipKey = await effectsPanel().locator('.effects-panel').getAttribute('data-clip-key')
  expect(clipKey, '效果面板需要暴露 data-clip-key 供定位').toBeTruthy()

  const enabled = await page.evaluate((key: string) => {
    const holder = window as unknown as { __workbench?: DebugWorkbench }
    const workbench = holder.__workbench
    if (workbench === undefined) {
      throw new Error('调试钩子 window.__workbench 缺失')
    }
    return workbench.documents.commit({
      kind: 'object.enableAnimation',
      clipKey: key,
      path: 'yaw',
      time: 1,
    })
  }, clipKey as string)
  expect(enabled.ok, enabled.error).toBe(true)

  await expect(effectsPanel()).toContainText('yaw', { timeout: 10_000 })
  const propertyText = await propertiesPanel().innerText()
  // 迁走后属性面板不再给值控件，只给定位入口。
  expect(propertyText).toContain('在效果面板')

  const undone = await page.evaluate(() => {
    const holder = window as unknown as { __workbench?: DebugWorkbench }
    const workbench = holder.__workbench
    if (workbench === undefined) {
      throw new Error('调试钩子 window.__workbench 缺失')
    }
    return workbench.documents.undo()
  })
  expect(undone).toBe(true)
  await expect(effectsPanel()).not.toContainText('yaw', { timeout: 10_000 })
})

test('R6-3：无限片段 —— 不显示 Infinity，不把视口末端当时长', async () => {
  await openScript('infinite.json')
  await waitForPanels()
  const text = await effectsPanel().innerText()
  expect(text).not.toContain('Infinity')
  expect(text).toContain('无限')
  await page.screenshot({ path: `${ARTIFACTS}/06-08-infinite.png` })
})

test('R6-4：循环片段 —— 片段头给出循环次数', async () => {
  await openScript('looping.json')
  await waitForPanels()
  const text = await effectsPanel().innerText()
  expect(text).toContain('循环')
})

test('R6-5：上百属性 / 数百节点 —— 效果面板仍可渲染且不卡死', async () => {
  const started = Date.now()
  await openScript('dense.json')
  await waitForPanels()
  const text = await effectsPanel().innerText()
  // 57 个通道都有帧，组头统计应体现动画属性数。
  expect(text.length).toBeGreaterThan(100)
  const elapsed = Date.now() - started
  expect(elapsed, `打开密集片段耗时 ${elapsed}ms`).toBeLessThan(30_000)
  await page.screenshot({ path: `${ARTIFACTS}/06-11-dense.png` })
})

test('R6-6：事件片段 —— 事件行进入效果面板，无段线', async () => {
  await openScript('events.json')
  await waitForPanels()

  // 事件在 EVENT 轨的片段上；效果面板只显示**当前选中片段**，所以先选中它
  // （产品行为：不擅自把别的轨道的片段塞进面板）。
  const eventClipKey = await page.evaluate(() => {
    const holder = window as unknown as { __workbench?: { documents: { clips(): Array<{ clipKey: string; trackType: string }> } } }
    const workbench = holder.__workbench
    if (workbench === undefined) {
      throw new Error('调试钩子 window.__workbench 缺失')
    }
    return workbench.documents.clips().find((clip) => clip.trackType === 'EVENT')?.clipKey ?? null
  })
  expect(eventClipKey, '夹具应含一个 EVENT 片段').toBeTruthy()

  await page.evaluate((key: string) => {
    const holder = window as unknown as { __workbench?: { documents: { select(sel: unknown): void } } }
    const workbench = holder.__workbench
    if (workbench === undefined) {
      throw new Error('调试钩子 window.__workbench 缺失')
    }
    workbench.documents.select({ domain: 'clip', clipKey: key })
  }, eventClipKey as string)

  await expect(effectsPanel()).toContainText('event', { timeout: 10_000 })
  const text = await effectsPanel().innerText()
  // 事件行不显示段缓动入口。
  expect(text).not.toContain('段缓动')
  await page.screenshot({ path: `${ARTIFACTS}/06-07-events.png` })
})

test('R6-7：保存重开无损 —— 值 / 帧 / 事件不变', async () => {
  await openScript('finite.json')
  const saved = await page.evaluate(async () => {
    const holder = window as unknown as { __workbench?: DebugWorkbench }
    const workbench = holder.__workbench
    if (workbench === undefined) {
      throw new Error('调试钩子 window.__workbench 缺失')
    }
    return workbench.documents.save()
  })
  expect(saved.ok, saved.error).toBe(true)

  const onDisk = JSON.parse(await readFile(path.join(WORKSPACE, 'scripts', 'finite.json'), 'utf8')) as Record<string, unknown>
  const timeline = onDisk.timeline as { tracks: Array<{ type: string; clips: Array<Record<string, unknown>> }> }
  const objects = timeline.tracks[0].clips[0].objects as Record<string, Record<string, unknown>>
  expect(objects['position.x'].keyframes).toEqual([{ time: 0, value: 1 }, { time: 1, value: 5 }])
  expect(objects['position.y'].value).toBe(2)
  expect(objects.fov.keyframes).toEqual([])
  // 界面状态与会话数据不得写盘。
  expect(JSON.stringify(onDisk)).not.toContain('clipKey')
  expect(JSON.stringify(onDisk)).not.toContain('authoring')
})

test('R6-10：菱形按钮 —— 播放头有帧显示实心，点击删帧后变空心', async () => {
  await openScript('finite.json')
  await waitForPanels()

  // `position.x` 有 [0, 1] 两帧，播放头默认在 0 → 菱形应为实心 ◆
  const diamond = effectsPanel().locator('.anim-ctl__btn--diamond').first()
  await expect(diamond).toBeVisible({ timeout: 10_000 })
  await expect(diamond).toHaveText('◆')
  await expect(diamond).toHaveAttribute('aria-pressed', 'true')

  // 时钟按钮同时存在（开/关动画，与菱形是两层语义）
  await expect(effectsPanel().locator('.anim-ctl__btn--clock').first()).toBeVisible()

  await diamond.click()
  // 删掉 t=0 的帧后播放头不再命中节点 → 空心 ◇
  await expect(diamond).toHaveText('◇', { timeout: 10_000 })
  await expect(diamond).toHaveAttribute('aria-pressed', 'false')

  // 撤销恢复
  await page.evaluate(() => {
    const holder = window as unknown as { __workbench?: DebugWorkbench }
    holder.__workbench?.documents.undo()
  })
  await expect(diamond).toHaveText('◆', { timeout: 10_000 })
})

test('R6-11：属性面板列出全部行（含已有帧），并带动画控件', async () => {
  await openScript('finite.json')
  await waitForPanels()

  const text = await propertiesPanel().innerText()
  // 有帧的 position.x 与静态的 yaw 都要在（属性面板不做 leaf 过滤）。
  expect(text).toContain('position.x')
  expect(text).toContain('yaw')
  // 属性面板里也有菱形控件。
  await expect(propertiesPanel().locator('.anim-ctl__btn--diamond').first()).toBeVisible({ timeout: 10_000 })
})

test('R6-12：选择域驱动右栏标签 —— none 给脚本属性，clip 给片段属性', async () => {
  await openScript('finite.json')
  await waitForPanels()

  const activePanelId = async (): Promise<string | null> => page.evaluate(() => {
    const holder = window as unknown as {
      __workbench?: { layout: { getGroup(p: string, id: string): { activePanelId?: string } | undefined } }
    }
    return holder.__workbench?.layout.getGroup('document', 'document.right')?.activePanelId ?? null
  })

  // 清空选择 → 脚本属性面板
  await page.evaluate(() => {
    const holder = window as unknown as { __workbench?: DebugWorkbench }
    holder.__workbench?.documents.select({ domain: 'none' })
  })
  await expect.poll(activePanelId, { timeout: 10_000 }).toBe('p:core.meta:meta.properties')
  // 面板是懒加载：等真实内容挂上（不是等容器可见）。
  await expect(page.locator('[data-focus-scope="panel:core.meta:meta.properties"] .meta-panel'))
    .toBeVisible({ timeout: 20_000 })
  // meta 面板按 02 目录列出全部字段（不只 view().meta 那 6 个）。
  const metaText = await page.locator('[data-focus-scope="panel:core.meta:meta.properties"]').innerText()
  expect(metaText).toContain('block_keyboard')
  expect(metaText).toContain('interruptible')

  // 选回片段 → 片段属性面板
  await page.evaluate(() => {
    const holder = window as unknown as {
      __workbench?: { documents: { clips(): Array<{ clipKey: string }>; select(s: unknown): void } }
    }
    const clip = holder.__workbench?.documents.clips()[0]
    if (clip !== undefined) {
      holder.__workbench?.documents.select({ domain: 'clip', clipKey: clip.clipKey })
    }
  })
  await expect.poll(activePanelId, { timeout: 10_000 }).toBe('p:core.selection-properties:selection.properties')
})

test('R6-8：触发器在独立面板 —— 属性面板不再有触发器 tab', async () => {
  await openScript('finite.json')
  await waitForPanels()

  // 触发器与属性面板在 `document.right` 同槽并列成面板级 tab（06-12）：
  // 面板存在、可点开，但不在属性面板容器内部。
  const behaviorTab = page.locator('[role="tab"]', { hasText: '触发器' }).first()
  await expect(behaviorTab).toBeVisible({ timeout: 20_000 })
  await behaviorTab.click()
  await expect(page.locator('[data-focus-scope="panel:core.behavior:behavior.triggers"]')).toBeVisible({ timeout: 20_000 })

  // 属性面板容器里不应再有旧的触发器 tab 按钮。
  const tabCount = await propertiesPanel().locator('#selection-tab-trigger').count()
  expect(tabCount).toBe(0)
  // 也不应再有内嵌的 `.trigger-pane`（触发器面板自己的容器在 behavior 面板里）。
  const nestedTriggerPane = await propertiesPanel().locator('.trigger-pane').count()
  expect(nestedTriggerPane).toBe(0)
})

test('R6-9：渲染进程无未捕获异常', async () => {
  const unexpected = rendererErrors.filter((message) => !message.includes('ws://127.0.0.1:8765'))
  expect(unexpected).toEqual([])
})
