const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, screen, session, shell } = require('electron')
const crypto = require('crypto')
const fs = require('fs')
const fsp = require('node:fs/promises')
const os = require('os')
const path = require('path')
const { fileURLToPath } = require('url')

const APP_TITLE = 'Immersive Cinematics Editor'

// 窗口默认值与最小尺寸（04-09）。
const DEFAULT_WIDTH = 1600
const DEFAULT_HEIGHT = 900
const MIN_WIDTH = 1280
const MIN_HEIGHT = 720
const WINDOW_STATE_DEBOUNCE_MS = 500
const OVERLAY_HEIGHT = 36

// 草稿约束（04-08/04-09）。
const DRAFT_MAX_BYTES = 5 * 1024 * 1024
const DRAFT_MAX_COUNT = 50
const DRAFT_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/

// 字幕导入约束（12-12）：扩展名白名单 + 大小上限；解码失败给信号，不猜编码。
const SUBTITLE_MAX_BYTES = 2 * 1024 * 1024
const SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt'])

// 启动底色兜底（preferences.json 没有 themeCache 时）。
const DEFAULT_BACKGROUND = '#151519'
const DEFAULT_SYMBOL_COLOR = '#e6e6e6'

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:*",
  "object-src 'none'",
  "frame-src 'none'",
].join('; ')

// storage 端口白名单：三个固定文件 + themes/、drafts/ 命名空间。
const STORAGE_ROOT_FILES = new Set(['preferences.json', 'layout.json', 'window-state.json', 'graph-layout.json'])
const STORAGE_NAMESPACES = ['themes', 'drafts']

const APPEARANCES = new Set(['dark', 'light', 'high-contrast'])
const MENU_GROUPS = ['file', 'edit', 'view', 'help']

const DIST_ROOT = path.join(__dirname, '..', 'dist')
const PRELOAD_PATH = path.join(__dirname, 'preload.cjs')
/** 运行时窗口/任务栏图标（构建产物里随 electron/ 一起打包）。 */
const WINDOW_ICON_PATH = path.join(__dirname, 'icon.png')
// 可选：dev server URL（正常 `electron .` 加载 dist；开发时可指向 vite）。
const DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL || process.env.IC_EDITOR_DEV_URL || ''

let mainWindow = null
let closeConfirmed = false
let quitRequested = false
let lastMenuState = []
let lastWindowBackground = DEFAULT_BACKGROUND
let windowStateAdapter = null

/** 经 file 对话框 / 最近项目批准过的路径（shell 端口白名单）。 */
const approvedShellPaths = new Set()

// ── 基础工具 ────────────────────────────────────────────────

// 测试/多实例隔离：允许用 IC_EDITOR_USER_DATA 覆盖 userData（E2E 用临时目录，
// 避免把测试语言/主题写进真实用户数据）。必须在 app ready 之前设置。
const USER_DATA_OVERRIDE = process.env.IC_EDITOR_USER_DATA
if (USER_DATA_OVERRIDE && USER_DATA_OVERRIDE.trim()) {
  const overrideDir = path.resolve(USER_DATA_OVERRIDE.trim())
  fs.mkdirSync(overrideDir, { recursive: true })
  app.setPath('userData', overrideDir)
}

function userDataDir() {
  return app.getPath('userData')
}

function webuiTokenFile() {
  const override = process.env.IC_WEBUI_TOKEN_FILE
  if (override && override.trim()) return override.trim()
  return path.join(os.homedir(), '.immersivecinematics', 'webui-token')
}

/**
 * WebUI 握手 token：异步读文件（游戏重启会轮换 token，每次连接前重新取）。
 * 读不到返回空串，由渲染层如实显示「缺少 token」，不伪造令牌。
 */
async function readWebuiToken() {
  try {
    const text = await fsp.readFile(webuiTokenFile(), 'utf8')
    return text.trim()
  } catch {
    return ''
  }
}

/** 主题 token 是纯 CSS 字面量；主进程只接受无注入风险的颜色字符串。 */
function isColorLiteral(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 64
    && /^[#a-zA-Z0-9(),.%\s-]+$/.test(value)
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function intersects(a, b) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  if (width <= 0 || height <= 0) return null
  return { width, height }
}

function isVisibleOnArea(bounds, area) {
  const overlap = intersects(bounds, area)
  return overlap !== null && overlap.width >= 64 && overlap.height >= 32
}

function clampSize(width, height, area) {
  const maxWidth = Math.max(MIN_WIDTH, Math.round(area.width))
  const maxHeight = Math.max(MIN_HEIGHT, Math.round(area.height))
  return {
    width: Math.min(Math.max(Math.round(width), MIN_WIDTH), maxWidth),
    height: Math.min(Math.max(Math.round(height), MIN_HEIGHT), maxHeight),
  }
}

function centerInside(area, width, height) {
  return {
    x: Math.max(area.x, Math.round(area.x + (area.width - width) / 2)),
    y: Math.max(area.y, Math.round(area.y + (area.height - height) / 2)),
    width,
    height,
  }
}

function clampInside(bounds, area) {
  const size = clampSize(bounds.width, bounds.height, area)
  const maxX = Math.max(area.x, Math.round(area.x + area.width - size.width))
  const maxY = Math.max(area.y, Math.round(area.y + area.height - size.height))
  return {
    x: Math.min(Math.max(Math.round(bounds.x), area.x), maxX),
    y: Math.min(Math.max(Math.round(bounds.y), area.y), maxY),
    width: size.width,
    height: size.height,
  }
}

/**
 * 同步原子写（**仅保留给窗口状态 `window-state.json`**：防抖保存 + 关闭 flush，
 * 单文件、KB 级、不在脚本/资源热路径上）。其余 IPC 文件读写一律用
 * `atomicWriteTextAsync` / `fsp` 异步版本。
 *
 * **不生成 `.bak`**：工作区脚本可能有上万个，逐个备份既浪费空间又拖慢写入；
 * 版本历史交给 git（工作区本身就是仓库），损坏文件另有 `quarantineCorrupt` 单独处理。
 */
function atomicWriteText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  try {
    fs.writeFileSync(tmp, text, 'utf8')
    fs.renameSync(tmp, file)
  } catch (error) {
    try {
      fs.unlinkSync(tmp)
    } catch {
      // ignore
    }
    throw error
  }
}

function writeJsonAtomic(file, value) {
  atomicWriteText(file, JSON.stringify(value, null, 2))
}

/** 异步原子写（IPC 热路径用；不生成 `.bak`，版本历史交给 git）。 */
async function atomicWriteTextAsync(file, text) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  try {
    await fsp.writeFile(tmp, text, 'utf8')
    await fsp.rename(tmp, file)
  } catch (error) {
    try {
      await fsp.unlink(tmp)
    } catch {
      // ignore
    }
    throw error
  }
}

async function writeJsonAtomicAsync(file, value) {
  await atomicWriteTextAsync(file, JSON.stringify(value, null, 2))
}

/**
 * 有界并发映射：一次 `Promise.all` 可能对上万个文件打爆文件句柄与事件循环，
 * 这里用固定数量的 worker 消费队列，结果按原顺序回传。
 */
async function mapBounded(items, limit, fn) {
  const out = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      out[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return out
}

/** 脚本 stat 并发上限（增量扫描热路径）。 */
const SCRIPT_STAT_CONCURRENCY = 16
/** 目录遍历中每收集多少条目让出一次事件循环，避免长递归阻塞主进程。 */
const WALK_YIELD_BUDGET = 64

// ── 工作区（<gameDir>/immersive_cinematics）───────────────
//
// 编辑器直接读写这里的脚本与资源，不经模组 WebSocket：
// 一次目录扫描拿全量路径，按 mtime+size 做增量解析（10 万脚本可用）。
// 注意：脚本写入不生成 .bak（脚本是用户作品，不引入备份文件）。

const WORKSPACE_DIR_NAME = 'immersive_cinematics'
const WORKSPACE_SCRIPTS_DIR = 'scripts'
const WORKSPACE_MARKER_FILE = 'workspace.json'

/** 工作区根：用户显式设置过的优先，其次猜游戏目录旁的默认位置。 */
function workspaceRootFile() {
  return path.join(userDataDir(), WORKSPACE_MARKER_FILE)
}

/** 工作区根：显式设置过的优先；E2E 可用 `IC_EDITOR_WORKSPACE` 直接指定。 */
async function readWorkspaceRoot() {
  const override = process.env.IC_EDITOR_WORKSPACE
  if (typeof override === 'string' && override.trim() !== '') {
    return override.trim()
  }
  try {
    const raw = JSON.parse(await fsp.readFile(workspaceRootFile(), 'utf8'))
    const root = typeof raw?.root === 'string' ? raw.root.trim() : ''
    return root === '' ? null : root
  } catch {
    return null
  }
}

function scriptsDirOf(root) {
  return path.join(root, WORKSPACE_SCRIPTS_DIR)
}

/** 归一化脚本相对路径：只接受 `scripts/` 下的 .json，拒绝绝对路径与 `..`。 */
function normalizeScriptRelative(relativePath) {
  if (typeof relativePath !== 'string') return null
  const raw = relativePath.replace(/\\/g, '/').trim()
  if (raw === '' || raw.length > 512) return null
  if (!raw.toLowerCase().endsWith('.json')) return null
  const segments = raw.split('/')
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') return null
    if (/^[a-zA-Z]:/.test(segment)) return null
  }
  return segments.join('/')
}

function scriptAbsolutePath(root, relativePath) {
  const normalized = normalizeScriptRelative(relativePath)
  if (normalized === null) throw new Error(`工作区: 非法脚本路径 ${String(relativePath)}`)
  const full = path.join(scriptsDirOf(root), ...normalized.split('/'))
  // 二次防线：拼出来的路径必须仍在 scripts/ 下。
  const base = path.resolve(scriptsDirOf(root))
  if (!path.resolve(full).startsWith(base + path.sep) && path.resolve(full) !== base) {
    throw new Error(`工作区: 路径越界 ${normalized}`)
  }
  return full
}

/** 递归列出脚本相对路径（跳过隐藏目录与 .bak/.tmp）；异步遍历，分批让出事件循环。 */
async function listScriptFiles(root) {
  const base = scriptsDirOf(root)
  const out = []
  let yieldBudget = 0
  const walk = async (dir, prefix) => {
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const name = entry.name
      if (name.startsWith('.')) continue
      const relative = prefix === '' ? name : `${prefix}/${name}`
      if (entry.isDirectory()) {
        await walk(path.join(dir, name), relative)
        continue
      }
      if (!entry.isFile()) continue
      if (!name.toLowerCase().endsWith('.json')) continue
      if (name.endsWith('.bak') || name.includes('.tmp-')) continue
      out.push(relative)
      yieldBudget += 1
      if (yieldBudget >= WALK_YIELD_BUDGET) {
        yieldBudget = 0
        await Promise.resolve()
      }
    }
  }
  await walk(base, '')
  out.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
  return out
}

/** 脚本指纹（`mtime:size`）；增量扫描用。stat 有界并发，不一次性 `Promise.all` 上万个。 */
async function scriptStamps(root) {
  const files = await listScriptFiles(root)
  const pairs = await mapBounded(files, SCRIPT_STAT_CONCURRENCY, async (relative) => {
    try {
      const stat = await fsp.stat(scriptAbsolutePath(root, relative))
      return [relative, `${Math.round(stat.mtimeMs)}:${stat.size}`]
    } catch {
      // 扫描与 stat 之间被删掉：当作不存在，下次扫描自然消失。
      return null
    }
  })
  const stamps = {}
  for (const pair of pairs) {
    if (pair !== null) stamps[pair[0]] = pair[1]
  }
  return stamps
}

async function requireWorkspaceRoot() {
  const root = await readWorkspaceRoot()
  if (root === null) throw new Error('工作区未设置：请先选择游戏目录')
  return root
}

/** 坏文件另存一份（按内容 hash 去重），原文件保留给上层决定如何回退。 */
function quarantineCorrupt(file, text) {
  try {
    const hash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 8)
    const target = `${file}.corrupt-${hash}.json`
    if (!fs.existsSync(target)) fs.writeFileSync(target, text, 'utf8')
    return target
  } catch {
    return null
  }
}

function readPreferencesFile() {
  try {
    const text = fs.readFileSync(path.join(userDataDir(), 'preferences.json'), 'utf8')
    const parsed = JSON.parse(text)
    return isPlainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** 主进程只消费 themeCache（防白闪），不解释偏好其他字段。 */
function readThemeCache() {
  const preferences = readPreferencesFile()
  const theme = preferences !== null && isPlainObject(preferences.theme) ? preferences.theme : null
  const cache = theme !== null && isPlainObject(theme.themeCache) ? theme.themeCache : null
  if (cache === null) return null
  if (typeof cache.themeId !== 'string' || !APPEARANCES.has(cache.appearance)) return null
  if (!isColorLiteral(cache.bgApp)) return null
  const tokens = {}
  const rawTokens = isPlainObject(cache.tokens) ? cache.tokens : {}
  for (const [key, value] of Object.entries(rawTokens)) {
    if (typeof value === 'string' && isColorLiteral(value)) tokens[key] = value
  }
  return {
    themeId: cache.themeId,
    appearance: cache.appearance,
    bgApp: cache.bgApp,
    tokens,
  }
}

function preferencesLanguage() {
  const preferences = readPreferencesFile()
  return preferences !== null && preferences.language === 'en_us' ? 'en_us' : 'zh_cn'
}

function approveShellPath(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return
  try {
    approvedShellPaths.add(path.resolve(raw))
  } catch {
    // ignore
  }
}

function isInsidePath(parent, child) {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function isShellPathAllowed(target) {
  if (isInsidePath(userDataDir(), target)) return true
  for (const approved of approvedShellPaths) {
    if (target === approved || isInsidePath(approved, target)) return true
    try {
      const stat = await fsp.stat(approved)
      if (stat.isFile() && path.dirname(approved) === target) return true
    } catch {
      // ignore
    }
  }
  return false
}

/**
 * 解码字幕字节（12-12）：BOM（UTF-8 / UTF-16LE / UTF-16BE）优先；无标记先按严格
 * UTF-8；`forcedEncoding` 为作者显式选择（utf-8 / gb18030）。解码失败返回 `null`，
 * 由调用方给「需要选择编码 / 无法解码」信号，主进程不猜编码。
 */
function decodeSubtitleBytes(bytes, forcedEncoding) {
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(3)), encoding: 'utf-8' }
    } catch {
      return null
    }
  }
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
    try {
      return { text: new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2)), encoding: 'utf-16le' }
    } catch {
      return null
    }
  }
  if (bytes.length >= 2 && bytes[1] !== undefined && bytes[0] === 0xFE && bytes[1] === 0xFF) {
    try {
      return { text: new TextDecoder('utf-16be', { fatal: true }).decode(bytes.subarray(2)), encoding: 'utf-16be' }
    } catch {
      return null
    }
  }
  const encoding = forcedEncoding === 'gb18030' ? 'gb18030' : 'utf-8'
  try {
    return { text: new TextDecoder(encoding, { fatal: true }).decode(bytes), encoding }
  } catch {
    return null
  }
}

function approveRecentProjectPaths() {
  const preferences = readPreferencesFile()
  const recent = preferences !== null && Array.isArray(preferences.recentProjects) ? preferences.recentProjects : []
  for (const entry of recent) {
    if (isPlainObject(entry) && typeof entry.path === 'string') approveShellPath(entry.path)
  }
}

// ── 窗口状态（43.2 自研 adapter） ────────────────────────────

function normalizeWindowState(raw) {
  if (!isPlainObject(raw) || raw.version !== 1 || !isPlainObject(raw.bounds)) return null
  const { x, y, width, height } = raw.bounds
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) return null
  if (width <= 0 || height <= 0) return null
  return {
    version: 1,
    bounds: {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
    },
    maximized: raw.maximized === true,
    displayId: typeof raw.displayId === 'string' ? raw.displayId : undefined,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
  }
}

function displayWithLargestIntersection(displays, bounds) {
  let best = null
  let bestArea = 0
  for (const display of displays) {
    const overlap = intersects(bounds, display.workArea)
    const area = overlap === null ? 0 : overlap.width * overlap.height
    if (area > bestArea) {
      best = display
      bestArea = area
    }
  }
  return best
}

class WindowStateAdapter {
  constructor(file) {
    this.file = file
    this.win = null
    this.dirty = false
    this.timer = null
    this.disposers = []
    this.saved = this.load()
  }

  load() {
    let text
    try {
      text = fs.readFileSync(this.file, 'utf8')
    } catch {
      return null
    }
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      quarantineCorrupt(this.file, text)
      return null
    }
    const state = normalizeWindowState(parsed)
    if (state === null) quarantineCorrupt(this.file, text)
    return state
  }

  /** 启动时把保存的 bounds 夹到某个 workArea 内；不可见则主屏居中。 */
  resolveInitialBounds() {
    const displays = screen.getAllDisplays()
    const primary = screen.getPrimaryDisplay()
    const saved = this.saved
    if (saved === null) {
      const size = clampSize(DEFAULT_WIDTH, DEFAULT_HEIGHT, primary.workArea)
      return {
        bounds: centerInside(primary.workArea, size.width, size.height),
        maximized: false,
        displayId: String(primary.id),
      }
    }

    let target = primary
    if (saved.displayId !== undefined) {
      // displayId 是上次保存的屏幕；拔屏后回主屏。
      target = displays.find((display) => String(display.id) === saved.displayId) || primary
    } else {
      target = displayWithLargestIntersection(displays, saved.bounds) || primary
    }

    // 不在任何 workArea 内（或原 display 已拔掉）→ 主屏居中，保证可见。
    if (!isVisibleOnArea(saved.bounds, target.workArea)) {
      const primarySize = clampSize(saved.bounds.width, saved.bounds.height, primary.workArea)
      return {
        bounds: centerInside(primary.workArea, primarySize.width, primarySize.height),
        maximized: saved.maximized,
        displayId: String(primary.id),
      }
    }
    return {
      bounds: clampInside(saved.bounds, target.workArea),
      maximized: saved.maximized,
      displayId: String(target.id),
    }
  }

  attach(win) {
    this.win = win
    const onGeometry = () => this.scheduleSave()
    const onMaximize = () => this.saveNow()
    const onUnmaximize = () => this.saveNow()
    const onClose = () => {
      this.dirty = true
      this.flush()
    }
    win.on('move', onGeometry)
    win.on('resize', onGeometry)
    win.on('maximize', onMaximize)
    win.on('unmaximize', onUnmaximize)
    win.on('close', onClose)
    this.disposers.push(() => {
      win.removeListener('move', onGeometry)
      win.removeListener('resize', onGeometry)
      win.removeListener('maximize', onMaximize)
      win.removeListener('unmaximize', onUnmaximize)
      win.removeListener('close', onClose)
    })
  }

  observeScreens() {
    const refit = () => this.fitToVisibleArea()
    screen.on('display-metrics-changed', refit)
    screen.on('display-removed', refit)
    screen.on('display-added', refit)
    this.disposers.push(() => {
      screen.removeListener('display-metrics-changed', refit)
      screen.removeListener('display-removed', refit)
      screen.removeListener('display-added', refit)
    })
  }

  scheduleSave() {
    this.dirty = true
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.persist()
    }, WINDOW_STATE_DEBOUNCE_MS)
  }

  saveNow() {
    this.dirty = true
    this.flush()
  }

  flush() {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.dirty) return
    this.persist()
  }

  persist() {
    this.dirty = false
    const win = this.win
    if (win === null || win.isDestroyed()) return
    try {
      const bounds = win.getNormalBounds()
      const display = screen.getDisplayMatching(bounds)
      const state = {
        version: 1,
        bounds,
        maximized: win.isMaximized(),
        displayId: String(display.id),
        updatedAt: new Date().toISOString(),
      }
      writeJsonAtomic(this.file, state)
    } catch (error) {
      console.error('[window-state] 保存失败', error)
    }
  }

  /** 换屏 / 拔屏 / 改 DPI：把窗口夹回可见 workArea。 */
  fitToVisibleArea() {
    const win = this.win
    if (win === null || win.isDestroyed() || win.isMaximized() || win.isFullScreen()) return
    const displays = screen.getAllDisplays()
    const bounds = win.getBounds()
    const target = displays.find((display) => isVisibleOnArea(bounds, display.workArea))
      || screen.getPrimaryDisplay()
    const size = clampSize(bounds.width, bounds.height, target.workArea)
    const next = isVisibleOnArea(bounds, target.workArea)
      ? clampInside(bounds, target.workArea)
      : centerInside(target.workArea, size.width, size.height)
    if (next.x !== bounds.x || next.y !== bounds.y || next.width !== bounds.width || next.height !== bounds.height) {
      win.setBounds(next)
    }
    this.saveNow()
  }

  dispose() {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    for (const dispose of this.disposers.splice(0)) {
      try {
        dispose()
      } catch {
        // ignore
      }
    }
    this.win = null
  }
}

// ── storage 白名单 ──────────────────────────────────────────

function normalizeStorageName(raw) {
  if (typeof raw !== 'string') return null
  const name = raw.replace(/\\/g, '/').trim()
  if (name.length === 0 || name.length > 512) return null
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return null
  const segments = name.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null
  if (segments.length === 1) {
    if (STORAGE_ROOT_FILES.has(name)) return name
    if (/^graph-layout\.corrupt[.-][A-Za-z0-9._-]+\.json$/.test(name)) return name
    return null
  }
  if (!STORAGE_NAMESPACES.includes(segments[0])) return null
  return name
}

function normalizeStoragePrefix(raw) {
  if (raw === undefined || raw === null || raw === '') return ''
  if (typeof raw !== 'string') return null
  const name = raw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (name === '') return ''
  if (STORAGE_ROOT_FILES.has(name)) return name
  const segments = name.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null
  if (!STORAGE_NAMESPACES.includes(segments[0])) return null
  return name
}

function storagePathOf(name) {
  return path.join(userDataDir(), ...name.split('/'))
}

function isAuxiliaryName(fileName) {
  return fileName.endsWith('.bak') || fileName.includes('.tmp-') || fileName.includes('.corrupt-')
}

async function walkFiles(dir, base, out) {
  let entries
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const relative = base === '' ? entry.name : `${base}/${entry.name}`
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await walkFiles(full, relative, out)
    else if (entry.isFile()) out.push(relative)
  }
}

async function storageEntryExists(target) {
  try {
    await fsp.stat(target)
    return true
  } catch {
    return false
  }
}

async function listStorageNames(rawPrefix, corruptOnly) {
  const prefix = normalizeStoragePrefix(rawPrefix)
  if (prefix === null) throw new Error(`storage: 非法前缀 ${String(rawPrefix)}`)
  const root = userDataDir()
  const files = []
  if (prefix === '') {
    for (const file of STORAGE_ROOT_FILES) {
      if (await storageEntryExists(path.join(root, file))) files.push(file)
    }
    for (const namespace of STORAGE_NAMESPACES) {
      await walkFiles(path.join(root, namespace), namespace, files)
    }
  } else if (STORAGE_ROOT_FILES.has(prefix)) {
    if (await storageEntryExists(path.join(root, prefix))) files.push(prefix)
  } else {
    const full = storagePathOf(prefix)
    let stat = null
    try {
      stat = await fsp.stat(full)
    } catch {
      stat = null
    }
    if (stat !== null && stat.isDirectory()) await walkFiles(full, prefix, files)
    else if (stat !== null && stat.isFile()) files.push(prefix)
  }
  const filtered = files.filter((name) => {
    const base = path.posix.basename(name)
    return corruptOnly ? base.includes('.corrupt-') : !isAuxiliaryName(base)
  })
  return filtered.sort()
}

// ── 草稿（drafts 端口） ─────────────────────────────────────

function draftDir() {
  return path.join(userDataDir(), 'drafts')
}

function draftFilePath(draftId) {
  return path.join(draftDir(), `${draftId}.json`)
}

function isValidDraftId(draftId) {
  return typeof draftId === 'string' && DRAFT_ID_PATTERN.test(draftId)
}

async function countDraftFiles() {
  let entries
  try {
    entries = await fsp.readdir(draftDir(), { withFileTypes: true })
  } catch {
    return 0
  }
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json') && !isAuxiliaryName(entry.name)).length
}

function normalizeDraftRecord(raw) {
  if (!isPlainObject(raw)) return null
  if (raw.version !== 1 || !isValidDraftId(raw.draftId)) return null
  if (typeof raw.docId !== 'string' || raw.docId.length === 0) return null
  if (typeof raw.capturedAt !== 'string' || raw.capturedAt.length === 0) return null
  if (!isFiniteNumber(raw.docRevision) || raw.docRevision < 0) return null
  if (typeof raw.hash !== 'string' || raw.hash.length === 0) return null
  if (typeof raw.payload !== 'string') return null
  if (raw.sourcePath !== undefined && typeof raw.sourcePath !== 'string') return null
  const record = {
    version: 1,
    draftId: raw.draftId,
    docId: raw.docId,
    capturedAt: raw.capturedAt,
    docRevision: Math.floor(raw.docRevision),
    hash: raw.hash,
    payload: raw.payload,
  }
  if (typeof raw.sourcePath === 'string') record.sourcePath = raw.sourcePath
  return record
}

async function readDraftRecord(draftId) {
  if (!isValidDraftId(draftId)) return null
  const file = draftFilePath(draftId)
  let text
  try {
    text = await fsp.readFile(file, 'utf8')
  } catch {
    return null
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    quarantineCorrupt(file, text)
    return null
  }
  return normalizeDraftRecord(parsed)
}

async function listDraftSummaries() {
  let entries
  try {
    entries = await fsp.readdir(draftDir(), { withFileTypes: true })
  } catch {
    return []
  }
  const draftIds = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json') || isAuxiliaryName(entry.name)) continue
    const draftId = entry.name.slice(0, -'.json'.length)
    if (isValidDraftId(draftId)) draftIds.push(draftId)
  }
  const records = await mapBounded(draftIds, SCRIPT_STAT_CONCURRENCY, async (draftId) => {
    const record = await readDraftRecord(draftId)
    if (record === null) return null
    let bytes = 0
    try {
      bytes = (await fsp.stat(draftFilePath(draftId))).size
    } catch {
      bytes = 0
    }
    const summary = {
      draftId: record.draftId,
      docId: record.docId,
      capturedAt: record.capturedAt,
      docRevision: record.docRevision,
      hash: record.hash,
      bytes,
    }
    if (record.sourcePath !== undefined) summary.sourcePath = record.sourcePath
    return summary
  })
  const summaries = records.filter((summary) => summary !== null)
  summaries.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
  return summaries
}

async function writeDraftRecord(raw) {
  const record = normalizeDraftRecord(raw)
  if (record === null) throw new Error('drafts: 记录格式错误')
  const file = draftFilePath(record.draftId)
  const serialized = JSON.stringify(record)
  if (Buffer.byteLength(serialized, 'utf8') > DRAFT_MAX_BYTES) {
    throw new Error('drafts: 单条草稿超过 5 MB，拒绝写入')
  }
  const exists = await storageEntryExists(file)
  if (!exists && await countDraftFiles() >= DRAFT_MAX_COUNT) {
    throw new Error('drafts: 草稿数量已达上限 50 条，拒绝新增')
  }
  await writeJsonAtomicAsync(file, record)
}

async function removeDraftRecord(draftId) {
  if (!isValidDraftId(draftId)) return
  try {
    await fsp.unlink(draftFilePath(draftId))
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error
  }
}

// ── IPC 公共 ────────────────────────────────────────────────

function isMainSender(event) {
  const win = mainWindow
  if (win === null || win.isDestroyed()) return false
  if (event.sender !== win.webContents) return false
  const frame = event.senderFrame
  if (frame === undefined || frame === null) return false
  return frame === win.webContents.mainFrame
}

function sendToMain(channel, payload) {
  if (mainWindow !== null && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

function onMain(channel, handler) {
  ipcMain.on(channel, (event, ...args) => {
    if (!isMainSender(event)) return
    handler(...args)
  })
}

function handleMain(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isMainSender(event)) throw new Error(`IPC 拒绝非主窗口来源: ${channel}`)
    return handler(...args)
  })
}

// ── 菜单 ────────────────────────────────────────────────────

function menuGroupLabels() {
  if (process.platform === 'darwin' && preferencesLanguage() === 'en_us') {
    return { file: 'File', edit: 'Edit', view: 'View', help: 'Help' }
  }
  return { file: '文件', edit: '编辑', view: '视图', help: '帮助' }
}

function sanitizeMenuItems(input) {
  if (!Array.isArray(input)) return []
  const items = []
  for (const raw of input) {
    if (!isPlainObject(raw)) continue
    const commandId = typeof raw.commandId === 'string' ? raw.commandId.trim() : ''
    if (commandId.length === 0 || commandId.length > 200) continue
    const menu = MENU_GROUPS.includes(raw.menu) ? raw.menu : 'view'
    items.push({
      commandId,
      label: typeof raw.label === 'string' && raw.label.length > 0 ? raw.label.slice(0, 200) : commandId,
      enabled: raw.enabled !== false,
      checked: raw.checked === true,
      accelerator: typeof raw.accelerator === 'string' && raw.accelerator.length <= 100 ? raw.accelerator : undefined,
      menu,
      group: typeof raw.group === 'string' ? raw.group.slice(0, 100) : undefined,
      order: isFiniteNumber(raw.order) ? raw.order : 0,
    })
  }
  items.sort((a, b) => a.order - b.order || a.commandId.localeCompare(b.commandId))
  return items
}

function buildMenuSubmenu(items) {
  const submenu = []
  let lastGroup = null
  for (const item of items) {
    if (lastGroup !== null && item.group !== lastGroup) submenu.push({ type: 'separator' })
    lastGroup = item.group
    submenu.push({
      label: item.label,
      accelerator: item.accelerator,
      enabled: item.enabled,
      type: item.checked ? 'checkbox' : 'normal',
      checked: item.checked,
      click: () => sendToMain('menu:command', item.commandId),
    })
  }
  return submenu
}

/** macOS：native Menu；Windows/Linux 保持无原生菜单（04-09）。 */
function applyApplicationMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  const labels = menuGroupLabels()
  const template = [{ role: 'appMenu' }]
  for (const group of MENU_GROUPS) {
    const items = lastMenuState.filter((item) => item.menu === group)
    if (items.length === 0) continue
    template.push({ label: labels[group], submenu: buildMenuSubmenu(items) })
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ── 安全 ────────────────────────────────────────────────────

function isApplicationUrl(raw) {
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return false
  }
  if (DEV_SERVER_URL !== '') {
    try {
      if (new URL(DEV_SERVER_URL).origin === parsed.origin) return true
    } catch {
      // ignore
    }
  }
  if (parsed.protocol !== 'file:') return false
  try {
    const resolved = path.resolve(fileURLToPath(parsed))
    const root = path.resolve(DIST_ROOT)
    return resolved === root || resolved.startsWith(root + path.sep)
  } catch {
    return false
  }
}

function installSecurity() {
  const defaultSession = session.defaultSession

  // CSP：本地页面 + 本机 WebUI socket，不加载远程脚本 / iframe。
  defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = {}
    for (const [key, value] of Object.entries(details.responseHeaders || {})) {
      if (key.toLowerCase() !== 'content-security-policy') responseHeaders[key] = value
    }
    responseHeaders['Content-Security-Policy'] = [CSP]
    callback({ responseHeaders })
  })

  defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  defaultSession.setPermissionCheckHandler(() => false)

  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-attach-webview', (event) => event.preventDefault())
    contents.on('will-navigate', (event, url) => {
      if (!isApplicationUrl(url)) event.preventDefault()
    })
  })
}

// ── 窗口 ────────────────────────────────────────────────────

function createWindow() {
  const adapter = new WindowStateAdapter(path.join(userDataDir(), 'window-state.json'))
  windowStateAdapter = adapter
  const resolved = adapter.resolveInitialBounds()
  const themeCache = readThemeCache()
  const background = themeCache !== null ? themeCache.bgApp : lastWindowBackground || DEFAULT_BACKGROUND
  lastWindowBackground = background
  const symbolColor = themeCache !== null && isColorLiteral(themeCache.tokens.text)
    ? themeCache.tokens.text
    : DEFAULT_SYMBOL_COLOR

  const baseOptions = {
    x: resolved.bounds.x,
    y: resolved.bounds.y,
    width: resolved.bounds.width,
    height: resolved.bounds.height,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    title: APP_TITLE,
    icon: WINDOW_ICON_PATH,
    backgroundColor: background,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  }

  const useOverlay = process.platform === 'win32' || process.platform === 'linux'
  let win = null
  if (useOverlay) {
    try {
      win = new BrowserWindow({
        ...baseOptions,
        titleBarStyle: 'hidden',
        titleBarOverlay: {
          color: background,
          symbolColor,
          height: OVERLAY_HEIGHT,
        },
      })
    } catch (error) {
      // 平台/桌面不支持 overlay 时回退自绘三键。
      console.warn('[window] titleBarOverlay 不可用，回落 frame:false', error)
      win = new BrowserWindow({ ...baseOptions, frame: false })
    }
  } else {
    win = new BrowserWindow(baseOptions)
  }

  mainWindow = win
  closeConfirmed = false
  quitRequested = false

  adapter.attach(win)
  adapter.observeScreens()
  if (resolved.maximized) win.maximize()

  win.on('maximize', () => sendToMain('window:maximize-changed', true))
  win.on('unmaximize', () => sendToMain('window:maximize-changed', false))

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (!isApplicationUrl(url)) event.preventDefault()
  })

  // 关闭流程：先让渲染进程走 UnsavedGuard；确认后 window:confirm-close 才真正关闭。
  win.on('close', (event) => {
    if (closeConfirmed) return
    event.preventDefault()
    sendToMain('window:close-requested', {})
  })

  // 渲染进程崩溃时不再拦关闭，避免窗口关不掉。
  win.webContents.on('render-process-gone', () => {
    closeConfirmed = true
  })

  win.on('closed', () => {
    adapter.dispose()
    if (windowStateAdapter === adapter) windowStateAdapter = null
    if (mainWindow === win) mainWindow = null
  })

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show()
  })

  if (DEV_SERVER_URL !== '') {
    win.loadURL(DEV_SERVER_URL).catch((error) => console.error('[window] 加载 dev server 失败', error))
  } else {
    win.loadFile(path.join(DIST_ROOT, 'index.html')).catch((error) => console.error('[window] 加载页面失败', error))
  }
  return win
}

// ── IPC 注册 ────────────────────────────────────────────────

function registerIpcHandlers() {
  // WebUI 握手 token：异步读文件（游戏重启会轮换 token，每次连接/重连前由渲染层重新取）。
  ipcMain.handle('webui:token', async (event) => {
    if (!isMainSender(event)) return ''
    return readWebuiToken()
  })

  // 启动主题缓存：**这是全主进程唯一保留的同步 IPC**。
  // 理由（04-09 合同）：preload 在页面脚本执行前同步取一次主题缓存，
  // 让首屏底色在窗口显示前就应用上，避免白闪；只读一个小 JSON 文件，仅启动一次，
  // 不落在任何频繁调用的热路径上。除这里之外，其余文件读写一律走 `fs.promises` 异步版本。
  ipcMain.on('theme:initial', (event) => {
    event.returnValue = isMainSender(event) ? readThemeCache() : null
  })

  onMain('window:minimize', () => {
    if (mainWindow !== null && !mainWindow.isDestroyed()) mainWindow.minimize()
  })

  onMain('window:maximize', () => {
    const win = mainWindow
    if (win === null || win.isDestroyed()) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  onMain('window:close', () => {
    const win = mainWindow
    if (win === null || win.isDestroyed()) return
    win.close()
  })

  handleMain('window:isMaximized', () => {
    const win = mainWindow
    return win !== null && !win.isDestroyed() && win.isMaximized()
  })

  onMain('window:confirm-close', () => {
    const win = mainWindow
    if (win === null || win.isDestroyed()) return
    closeConfirmed = true
    const quitAfterClose = quitRequested
    quitRequested = false
    win.close()
    if (quitAfterClose) setImmediate(() => app.quit())
  })

  // ── 主题 ────────────────────────────────────────────────
  onMain('theme:set-source', (appearance) => {
    if (!APPEARANCES.has(appearance)) return
    // Electron 只有 system/light/dark；高对比度交给系统设置，不强行覆盖。
    nativeTheme.themeSource = appearance === 'high-contrast' ? 'system' : appearance
  })

  onMain('theme:set-background', (color) => {
    if (!isColorLiteral(color)) return
    lastWindowBackground = color
    const win = mainWindow
    if (win === null || win.isDestroyed()) return
    try {
      win.setBackgroundColor(color)
    } catch (error) {
      console.error('[window] 设置底色失败', error)
    }
    if (process.platform !== 'darwin') {
      try {
        win.setTitleBarOverlay({ color })
      } catch {
        // overlay 不支持时忽略（frame:false 回退）。
      }
    }
  })

  // ── 文件对话框（renderer 不读文件、不拼路径） ─────────────
  handleMain('files:open-script', async () => {
    const win = mainWindow
    if (win === null || win.isDestroyed()) return null
    const result = await dialog.showOpenDialog(win, {
      title: '打开脚本',
      filters: [{ name: 'Immersive Cinematics 脚本', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    approveShellPath(result.filePaths[0])
    return result.filePaths[0]
  })

  handleMain('files:open-folder', async () => {
    const win = mainWindow
    if (win === null || win.isDestroyed()) return null
    const result = await dialog.showOpenDialog(win, {
      title: '打开项目文件夹',
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    approveShellPath(result.filePaths[0])
    return result.filePaths[0]
  })

  handleMain('files:save-script', async (defaultPath) => {
    const win = mainWindow
    if (win === null || win.isDestroyed()) return null
    const result = await dialog.showSaveDialog(win, {
      title: '保存脚本',
      defaultPath: typeof defaultPath === 'string' && defaultPath.length > 0 ? defaultPath : undefined,
      filters: [{ name: 'Immersive Cinematics 脚本', extensions: ['json'] }],
    })
    if (result.canceled || typeof result.filePath !== 'string') return null
    approveShellPath(result.filePath)
    return result.filePath
  })

  handleMain('files:import-theme', async () => {
    const win = mainWindow
    if (win === null || win.isDestroyed()) return null
    const result = await dialog.showOpenDialog(win, {
      title: '导入主题',
      filters: [{ name: 'Immersive Cinematics 主题', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    approveShellPath(result.filePaths[0])
    return result.filePaths[0]
  })

  handleMain('files:read-text', async (targetPath) => {
    if (typeof targetPath !== 'string' || !targetPath.toLowerCase().endsWith('.json')) return null
    const resolved = path.resolve(targetPath)
    if (!(await isShellPathAllowed(resolved))) return null
    try {
      const stat = await fsp.stat(resolved)
      if (!stat.isFile() || stat.size > 256 * 1024) return null
      return await fsp.readFile(resolved, 'utf8')
    } catch {
      return null
    }
  })

  handleMain('files:pick-subtitle', async () => {
    const win = mainWindow
    if (win === null || win.isDestroyed()) return null
    const result = await dialog.showOpenDialog(win, {
      title: '导入字幕',
      filters: [{ name: '字幕文件', extensions: ['srt', 'vtt'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const resolved = path.resolve(result.filePaths[0])
    approveShellPath(resolved)
    return { path: resolved, name: path.basename(resolved) }
  })

  handleMain('files:read-subtitle', async (targetPath, encoding) => {
    if (typeof targetPath !== 'string' || targetPath.length === 0) {
      return { status: 'rejected', reason: 'extension' }
    }
    let resolved
    try {
      resolved = path.resolve(targetPath)
    } catch {
      return { status: 'rejected', reason: 'extension' }
    }
    if (!(await isShellPathAllowed(resolved))) {
      return { status: 'rejected', reason: 'extension' }
    }
    const ext = path.extname(resolved).toLowerCase()
    if (!SUBTITLE_EXTENSIONS.has(ext)) {
      return { status: 'rejected', reason: 'extension' }
    }
    let stat
    try {
      stat = await fsp.stat(resolved)
    } catch {
      return { status: 'rejected', reason: 'not-a-file' }
    }
    if (!stat.isFile()) {
      return { status: 'rejected', reason: 'not-a-file' }
    }
    if (stat.size > SUBTITLE_MAX_BYTES) {
      return { status: 'rejected', reason: 'size' }
    }
    let bytes
    try {
      bytes = await fsp.readFile(resolved)
    } catch {
      return { status: 'rejected', reason: 'not-a-file' }
    }
    const forced = encoding === 'gb18030' ? 'gb18030' : encoding === 'utf-8' ? 'utf-8' : undefined
    const decoded = decodeSubtitleBytes(bytes, forced)
    if (decoded === null) {
      return forced === undefined
        ? { status: 'needs-encoding', path: resolved, name: path.basename(resolved) }
        : { status: 'decode-failed' }
    }
    return {
      status: 'ok',
      path: resolved,
      name: path.basename(resolved),
      text: decoded.text,
      encoding: decoded.encoding,
    }
  })

  handleMain('files:confirm', async (message, detail, buttons) => {
    const win = mainWindow
    if (win === null || win.isDestroyed()) return -1
    const labels = Array.isArray(buttons) && buttons.length > 0
      ? buttons.slice(0, 8).map((button) => String(button).slice(0, 100))
      : ['确定', '取消']
    const result = await dialog.showMessageBox(win, {
      type: 'question',
      message: String(message ?? '').slice(0, 500),
      detail: typeof detail === 'string' ? detail.slice(0, 2000) : undefined,
      buttons: labels,
      defaultId: 0,
      cancelId: labels.length - 1,
      noLink: true,
    })
    return result.response
  })

  // ── shell（白名单） ─────────────────────────────────────
  onMain('shell:show-item-in-folder', async (target) => {
    if (typeof target !== 'string' || target.length === 0) return
    let resolved
    try {
      resolved = path.resolve(target)
    } catch {
      return
    }
    if (!(await isShellPathAllowed(resolved))) return
    if (!(await storageEntryExists(resolved))) return
    shell.showItemInFolder(resolved)
  })

  onMain('shell:open-external', (raw) => {
    if (typeof raw !== 'string') return
    let url
    try {
      url = new URL(raw)
    } catch {
      return
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return
    shell.openExternal(url.toString()).catch((error) => console.error('[shell] openExternal 失败', error))
  })

  // ── 草稿 ────────────────────────────────────────────────
  handleMain('drafts:list', async () => listDraftSummaries())
  handleMain('drafts:read', async (draftId) => readDraftRecord(draftId))
  handleMain('drafts:write', async (record) => {
    await writeDraftRecord(record)
  })
  handleMain('drafts:remove', async (draftId) => {
    await removeDraftRecord(draftId)
  })

  // ── 菜单同步（macOS native menu；其他平台只存快照） ───────
  onMain('menu:sync', (items) => {
    lastMenuState = sanitizeMenuItems(items)
    applyApplicationMenu()
  })

  // ── storage（原子写，不留 .bak）─────────────────────────
  handleMain('storage:read', async (name) => {
    const normalized = normalizeStorageName(name)
    if (normalized === null) throw new Error(`storage: 非法文件名 ${String(name)}`)
    const file = storagePathOf(normalized)
    let text
    try {
      text = await fs.promises.readFile(file, 'utf8')
    } catch (error) {
      if (error && error.code === 'ENOENT') return null
      throw error
    }
    if (normalized.endsWith('.json')) {
      try {
        JSON.parse(text)
      } catch {
        quarantineCorrupt(file, text)
      }
    }
    return text
  })

  handleMain('storage:write', async (name, text) => {
    const normalized = normalizeStorageName(name)
    if (normalized === null) throw new Error(`storage: 非法文件名 ${String(name)}`)
    if (typeof text !== 'string') throw new Error('storage: 内容必须是字符串')
    await atomicWriteTextAsync(storagePathOf(normalized), text)
  })

  handleMain('storage:remove', async (name) => {
    const normalized = normalizeStorageName(name)
    if (normalized === null) throw new Error(`storage: 非法文件名 ${String(name)}`)
    try {
      await fsp.unlink(storagePathOf(normalized))
    } catch (error) {
      if (error && error.code !== 'ENOENT') throw error
    }
  })

  handleMain('storage:list', async (prefix) => listStorageNames(prefix, false))
  handleMain('storage:list-corrupt', async (prefix) => listStorageNames(prefix, true))

  // 最近项目 missing 探测：只读布尔，不返回内容；相对路径一律 false。
  handleMain('storage:exists', async (target) => {
    if (typeof target !== 'string' || !path.isAbsolute(target)) return false
    return storageEntryExists(target)
  })

  onMain('storage:reveal', () => {
    shell.openPath(userDataDir()).catch((error) => console.error('[storage] 打开 userData 失败', error))
  })

  // ── 工作区（脚本/资源直读直写）────────────────────────────
  handleMain('workspace:root', async () => readWorkspaceRoot())

  handleMain('workspace:set-root', async (target) => {
    if (typeof target !== 'string' || !path.isAbsolute(target)) {
      throw new Error('工作区: 必须是绝对路径')
    }
    // 接受两种选择：`immersive_cinematics` 本身，或它所在的那一层目录。
    const direct = target
    const nested = path.join(target, WORKSPACE_DIR_NAME)
    const root = await storageEntryExists(scriptsDirOf(direct)) ? direct
      : await storageEntryExists(scriptsDirOf(nested)) ? nested
        : direct
    await fsp.mkdir(scriptsDirOf(root), { recursive: true })
    await writeJsonAtomicAsync(workspaceRootFile(), { root })
    return root
  })

  handleMain('workspace:list-scripts', async () => {
    const root = await requireWorkspaceRoot()
    return listScriptFiles(root)
  })

  handleMain('workspace:read-script', async (relativePath) => {
    const root = await requireWorkspaceRoot()
    const file = scriptAbsolutePath(root, relativePath)
    try {
      const text = await fsp.readFile(file, 'utf8')
      const stat = await fsp.stat(file)
      // 指纹随内容一起返回：与 `scriptStamps()` 同格式，上层才能判断「没变」。
      return { text, stamp: `${Math.round(stat.mtimeMs)}:${stat.size}` }
    } catch (error) {
      if (error && error.code === 'ENOENT') return null
      throw error
    }
  })

  handleMain('workspace:write-script', async (relativePath, text) => {
    if (typeof text !== 'string') throw new Error('工作区: 内容必须是字符串')
    const root = await requireWorkspaceRoot()
    const file = scriptAbsolutePath(root, relativePath)
    // 脚本是用户作品：原子写但不留 .bak。
    await fsp.mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
    try {
      await fsp.writeFile(tmp, text, 'utf8')
      await fsp.rename(tmp, file)
    } catch (error) {
      try {
        await fsp.unlink(tmp)
      } catch {
        // ignore
      }
      throw error
    }
  })

  handleMain('workspace:remove-script', async (relativePath) => {
    const root = await requireWorkspaceRoot()
    const file = scriptAbsolutePath(root, relativePath)
    try {
      await fsp.unlink(file)
    } catch (error) {
      if (error && error.code !== 'ENOENT') throw error
    }
  })

  handleMain('workspace:script-stamps', async () => {
    const root = await requireWorkspaceRoot()
    return scriptStamps(root)
  })

  handleMain('workspace:script-exists', async (relativePath) => {
    let file
    try {
      const root = await requireWorkspaceRoot()
      file = scriptAbsolutePath(root, relativePath)
    } catch {
      return false
    }
    return storageEntryExists(file)
  })

  // ── 系统主题变化（nativeTheme → renderer） ────────────────
  nativeTheme.on('updated', () => {
    sendToMain('theme:system-changed', {
      dark: nativeTheme.shouldUseDarkColors,
      highContrast: nativeTheme.shouldUseHighContrastColors,
    })
  })
}

// ── 生命周期 ────────────────────────────────────────────────

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  installSecurity()
  registerIpcHandlers()
  approveRecentProjectPaths()
  applyApplicationMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  quitRequested = true
  if (windowStateAdapter !== null) windowStateAdapter.flush()
})

app.on('will-quit', () => {
  if (windowStateAdapter !== null) {
    windowStateAdapter.flush()
    windowStateAdapter.dispose()
    windowStateAdapter = null
  }
})

app.on('window-all-closed', () => {
  if (windowStateAdapter !== null) windowStateAdapter.flush()
  if (process.platform !== 'darwin') app.quit()
})
