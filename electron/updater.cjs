/**
 * 主进程更新模块（03-02）。
 *
 * 只做一件事：把 `electron-updater` 的原生事件收敛成 `UpdateState` 状态对象，
 * 让 IPC / 设置页只消费一种形状。契约见 `src/workbench/api/updates.ts`（03-03，形状冻结）。
 *
 * 边界：
 * - 只在 `app.isPackaged` 且平台为 win32/darwin 时启用；否则恒为 `unavailable`，不初始化 updater、不发网络请求。
 * - 不调用 `autoUpdater.setFeedURL()`：feed 由 electron-builder 依据 `publish` 块生成 `app-update.yml`。
 * - 没有 Release（404）是正常状态：归一到 `up-to-date`，不显示成失败。
 */
'use strict'

const { app, BrowserWindow, dialog } = require('electron')
const fsp = require('node:fs/promises')
const path = require('node:path')

const FIRST_CHECK_DELAY_MS = 5_000
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1_000
const LOG_MAX_BYTES = 1024 * 1024
const LOG_FILE_NAME = 'updater.log'
const LOG_ROLL_BYTES = LOG_MAX_BYTES

/** 网络类错误码 / 消息特征。 */
const NETWORK_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ESOCKETTIMEDOUT',
  'ERR_UPDATER_NETWORK_ERROR',
  'ERR_INTERNET_DISCONNECTED',
  'ERR_PROXY_CONNECTION_FAILED',
  'ERR_NAME_NOT_RESOLVED',
])

/** 无 Release / 频道文件缺失：对客户端来说就是"已是最新"。 */
const NO_RELEASE_CODES = new Set([
  'ERR_UPDATER_LATEST_YML_NOT_FOUND',
  'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND',
  'ERR_UPDATER_NO_RELEASE',
  'ERR_UPDATER_NO_PUBLISHED_VERSIONS',
  'ERR_UPDATER_INVALID_RELEASE_FEED',
])

/** 下载包签名 / 哈希校验失败。 */
const VERIFY_CODES = new Set([
  'ERR_UPDATER_SIGNATURE_CHECK_FAILED',
  'ERR_UPDATER_CHECKSUM_MISMATCH',
  'ERR_UPDATER_INVALID_SIGNATURE',
  'ERR_UPDATER_FILE_CHECKSUM_MISMATCH',
])

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 错误分类：返回 `{ kind, reason, code }`。
 * kind: 'no-release' | 'network' | 'verify' | 'other'
 */
function classifyError(error) {
  const code = typeof error?.code === 'string' ? error.code : undefined
  const message = typeof error?.message === 'string' ? error.message : String(error ?? '')
  const statusCode = typeof error?.statusCode === 'number' ? error.statusCode : undefined
  const lower = message.toLowerCase()

  const is404 = statusCode === 404 || /\b404\b/.test(message)
  const noReleaseByCode = code !== undefined && NO_RELEASE_CODES.has(code)
  const noReleaseByMessage = /no published versions|no releases? (?:on|found)|cannot find (?:channel|latest\.yml)/i.test(message)
  if (noReleaseByCode || noReleaseByMessage || (is404 && (lower.includes('latest.yml') || lower.includes('channel') || lower.includes('cannot find')))) {
    return {
      kind: 'no-release',
      code: code ?? 'HTTP_404',
      reason: `服务器上还没有可用的发布版本（${code ?? 'HTTP 404'}）`,
    }
  }

  const networkByCode = code !== undefined && NETWORK_CODES.has(code)
  const networkByMessage = /net::err_|econnreset|econnrefused|etimedout|enotfound|eai_again|socket hang up|network error/i.test(message)
  if (networkByCode || networkByMessage) {
    return {
      kind: 'network',
      code: code ?? 'NETWORK_ERROR',
      reason: `网络不可用，无法连接更新服务器（${code ?? 'NETWORK_ERROR'}）`,
    }
  }

  const verifyByCode = code !== undefined && VERIFY_CODES.has(code)
  const verifyByMessage = /checksum|sha512|signature|blockmap/i.test(message)
  if (verifyByCode || verifyByMessage) {
    return {
      kind: 'verify',
      code: code ?? 'VERIFY_FAILED',
      reason: `下载包校验失败（${code ?? 'VERIFY_FAILED'}）`,
    }
  }

  return {
    kind: 'other',
    code: code ?? 'UPDATER_ERROR',
    reason: `更新检查失败：${message.slice(0, 200)}（${code ?? 'UPDATER_ERROR'}）`,
  }
}

/**
 * 创建 updater 实例。
 *
 * @param {{ onState?: (state: object) => void, requestInstall?: () => void | Promise<void> }} options
 */
function createUpdater(options = {}) {
  const onState = typeof options.onState === 'function' ? options.onState : null
  const requestInstall = typeof options.requestInstall === 'function' ? options.requestInstall : null

  const enabled = app.isPackaged === true && (process.platform === 'win32' || process.platform === 'darwin')
  let state = enabled ? { status: 'idle' } : { status: 'unavailable' }
  let firstTimer = null
  let intervalTimer = null
  let disposed = false
  let started = false
  let bound = false
  let currentVersion = ''
  let autoUpdater = null
  /** electron-updater 会同时发 error 事件并让 checkForUpdates() reject：同一个 error 对象只处理一次。 */
  let lastHandledError = null

  function setState(next) {
    if (disposed) return
    state = next
    if (onState !== null) {
      try {
        onState(next)
      } catch (error) {
        console.error('[updater] onState 回调失败', error)
      }
    }
  }

  async function writeLog(message) {
    const line = `[${new Date().toISOString()}] ${message}\n`
    console.log(`[updater] ${message}`)
    try {
      const file = path.join(app.getPath('userData'), LOG_FILE_NAME)
      await fsp.mkdir(path.dirname(file), { recursive: true })
      let size = 0
      try {
        const stat = await fsp.stat(file)
        size = stat.size
      } catch (error) {
        if (error && error.code !== 'ENOENT') throw error
      }
      if (size > LOG_ROLL_BYTES) {
        // 单文件 1 MB 滚动一次：清空重写，不保留旧段（没有 electron-log，不新增依赖）。
        await fsp.writeFile(file, '', 'utf8')
      }
      await fsp.appendFile(file, line, 'utf8')
    } catch (error) {
      console.error('[updater] 写 updater.log 失败', error)
    }
  }

  function requireAutoUpdater() {
    if (autoUpdater === null) {
      autoUpdater = require('electron-updater').autoUpdater
    }
    return autoUpdater
  }

  function bindEvents() {
    if (bound) return
    const updater = requireAutoUpdater()
    updater.autoDownload = true
    updater.autoInstallOnAppQuit = true
    updater.allowDowngrade = false
    updater.allowPrerelease = false
    // 不调用 setFeedURL：feed 来自 app-update.yml。

    updater.on('checking-for-update', () => {
      setState({ status: 'checking' })
      void writeLog('checking-for-update')
    })

    updater.on('update-available', (info) => {
      currentVersion = typeof info?.version === 'string' ? info.version : String(info?.version ?? '')
      setState({ status: 'available', version: currentVersion })
      void writeLog(`update available: ${currentVersion}`)
    })

    updater.on('update-not-available', (info) => {
      const checkedAt = new Date().toISOString()
      const version = typeof info?.version === 'string' ? info.version : String(info?.version ?? '')
      setState({ status: 'up-to-date', checkedAt })
      void writeLog(`not available (up-to-date): current=${app.getVersion()}${version === '' ? '' : ` latest=${version}`}`)
    })

    updater.on('download-progress', (progress) => {
      const percent = Number(progress?.percent)
      const transferred = Number(progress?.transferred)
      const total = Number(progress?.total)
      const bytesPerSecond = Number(progress?.bytesPerSecond)
      setState({
        status: 'downloading',
        version: currentVersion,
        percent: Number.isFinite(percent) ? percent : 0,
        transferred: Number.isFinite(transferred) ? transferred : 0,
        total: Number.isFinite(total) ? total : 0,
        bytesPerSecond: Number.isFinite(bytesPerSecond) ? bytesPerSecond : 0,
      })
    })

    updater.on('update-downloaded', (info) => {
      const version = typeof info?.version === 'string' ? info.version : currentVersion
      currentVersion = version
      setState({ status: 'downloaded', version })
      void writeLog(`update downloaded: ${version}`)
      void promptRestart(version)
    })

    updater.on('error', (error) => {
      handleError(error)
    })

    bound = true
  }

  /** 统一错误出口：404 / 无 Release → up-to-date；其余落 error，事件与 Promise 双触发时按对象身份去重。 */
  function handleError(error) {
    // 同一次检查的 error 事件与 rejection 携带同一个对象；下一次检查是新对象，必须照常处理，
    // 否则 5 秒内的第二次主动检查会被误吞，状态永远停在 checking。
    if (lastHandledError === error) return
    lastHandledError = error
    const classified = classifyError(error)
    if (classified.kind === 'no-release') {
      // 没有 Release 是正常结果：客户端看不到草稿 / prerelease（update-electron-app README:148）。
      setState({ status: 'up-to-date', checkedAt: new Date().toISOString() })
      void writeLog(`not available (no release): ${classified.reason}`)
      return
    }
    setState({ status: 'error', reason: classified.reason, code: classified.code })
    void writeLog(`error [${classified.code}] ${classified.reason}`)
  }

  async function promptRestart(version) {
    const title = '更新已就绪'
    const message = version === '' ? '新版本已下载完成' : `新版本 ${version} 已下载完成`
    const detail = '重启应用以完成安装。若当前文档有未保存修改，会先走保存 / 放弃 / 取消守卫。'
    const buttons = ['重启并安装', '稍后']
    const win = BrowserWindow.getAllWindows()[0] ?? null
    const boxOptions = {
      type: 'info',
      buttons,
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title,
      message,
      detail,
    }
    let response = 1
    try {
      const result = win !== null && !win.isDestroyed()
        ? await dialog.showMessageBox(win, boxOptions)
        : await dialog.showMessageBox(boxOptions)
      response = result.response
    } catch (error) {
      console.error('[updater] 弹出重启对话框失败', error)
      return
    }
    if (response !== 0) {
      void writeLog('user deferred install')
      return
    }
    if (requestInstall !== null) {
      await requestInstall()
      return
    }
    install()
  }

  /** 主动检查：返回当前状态；未启用时恒为 unavailable，且不触发任何网络请求。 */
  async function check() {
    if (!enabled) {
      setState({ status: 'unavailable' })
      return state
    }
    if (disposed) return state
    bindEvents()
    if (state.status === 'checking' || state.status === 'downloading') {
      return state
    }
    try {
      void writeLog('check requested')
      await requireAutoUpdater().checkForUpdates()
    } catch (error) {
      handleError(error)
    }
    return state
  }

  /** 启动：首查 5 s 后一次，之后每 4 小时一次；未启用时直接落 unavailable。 */
  function start() {
    if (!enabled) {
      setState({ status: 'unavailable' })
      return
    }
    if (disposed || started) return
    started = true
    bindEvents()
    void writeLog(`updater started (packaged=${String(app.isPackaged)} platform=${process.platform} version=${app.getVersion()})`)
    firstTimer = setTimeout(() => {
      firstTimer = null
      void check()
    }, FIRST_CHECK_DELAY_MS)
    intervalTimer = setInterval(() => {
      void check()
    }, CHECK_INTERVAL_MS)
  }

  /** 安装：只有 downloaded 才允许；其余状态如实返回 not-downloaded。 */
  function install() {
    if (state.status !== 'downloaded') {
      return { ok: false, reason: 'not-downloaded' }
    }
    void writeLog(`quitAndInstall: ${currentVersion}`)
    requireAutoUpdater().quitAndInstall(false, true)
    return { ok: true }
  }

  function dispose() {
    disposed = true
    if (firstTimer !== null) {
      clearTimeout(firstTimer)
      firstTimer = null
    }
    if (intervalTimer !== null) {
      clearInterval(intervalTimer)
      intervalTimer = null
    }
    if (bound && autoUpdater !== null) {
      autoUpdater.removeAllListeners()
      bound = false
    }
    // 未打包 / 未启用时不落 updater.log（用例 5 明确要求不产生该文件）。
    if (started) void writeLog('updater disposed')
  }

  function getState() {
    return isPlainObject(state) ? { ...state } : { status: 'unavailable' }
  }

  /** 未启用时也允许读状态；enabled 供主进程 / 测试判断。 */
  function isEnabled() {
    return enabled
  }

  return { start, check, install, state: getState, dispose, isEnabled }
}

module.exports = { createUpdater, classifyError }
