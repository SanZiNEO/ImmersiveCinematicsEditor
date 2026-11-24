const { contextBridge, ipcRenderer } = require('electron')

// 只暴露 typed `window.workbench`（形状来自 src/workbench/api/host.ts 的 WorkbenchBridge）。
// 不暴露 ipcRenderer / require / process / fs / path；所有能力都是薄 IPC 封装。

const PLATFORM = ['win32', 'darwin', 'linux'].includes(process.platform) ? process.platform : 'linux'

/** 启动主题缓存：同步读一次，首屏应用 token 后再显示窗口（防白闪）。 */
const initialTheme = ipcRenderer.sendSync('theme:initial')

function subscribe(channel, listener) {
  const wrapped = (_event, payload) => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => {
    ipcRenderer.removeListener(channel, wrapped)
  }
}

const workbench = {
  kind: 'electron',
  platform: PLATFORM,

  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onMaximizeChange: (listener) => subscribe('window:maximize-changed', listener),
    setBackground: (color) => ipcRenderer.send('theme:set-background', color),
    onCloseRequest: (listener) => subscribe('window:close-requested', listener),
    confirmClose: () => ipcRenderer.send('window:confirm-close'),
  },

  files: {
    openScript: () => ipcRenderer.invoke('files:open-script'),
    openFolder: () => ipcRenderer.invoke('files:open-folder'),
    saveScript: (defaultPath) => ipcRenderer.invoke('files:save-script', defaultPath),
    importTheme: () => ipcRenderer.invoke('files:import-theme'),
    confirm: (message, detail, buttons) => ipcRenderer.invoke('files:confirm', message, detail, buttons),
    readText: (path) => ipcRenderer.invoke('files:read-text', path),
    pickSubtitleFile: () => ipcRenderer.invoke('files:pick-subtitle'),
    readSubtitleFile: (path, encoding) => ipcRenderer.invoke('files:read-subtitle', path, encoding),
  },

  shell: {
    showItemInFolder: (path) => ipcRenderer.send('shell:show-item-in-folder', path),
    openExternal: (url) => ipcRenderer.send('shell:open-external', url),
  },

  theme: {
    setSource: (appearance) => ipcRenderer.send('theme:set-source', appearance),
    setWindowBackground: (color) => ipcRenderer.send('theme:set-background', color),
    onSystemChange: (listener) => subscribe('theme:system-changed', listener),
    initialTheme: () => initialTheme,
  },

  drafts: {
    list: () => ipcRenderer.invoke('drafts:list'),
    read: (draftId) => ipcRenderer.invoke('drafts:read', draftId),
    write: (record) => ipcRenderer.invoke('drafts:write', record),
    remove: (draftId) => ipcRenderer.invoke('drafts:remove', draftId),
  },

  menu: {
    sync: (items) => ipcRenderer.send('menu:sync', items),
    onCommand: (listener) => subscribe('menu:command', listener),
  },

  storage: {
    read: (name) => ipcRenderer.invoke('storage:read', name),
    write: (name, text) => ipcRenderer.invoke('storage:write', name, text),
    remove: (name) => ipcRenderer.invoke('storage:remove', name),
    list: (prefix) => ipcRenderer.invoke('storage:list', prefix),
    listCorrupt: (prefix) => ipcRenderer.invoke('storage:list-corrupt', prefix),
    exists: (path) => ipcRenderer.invoke('storage:exists', path),
    revealUserData: () => ipcRenderer.send('storage:reveal'),
  },

  // 工作区：直接读写 <gameDir>/immersive_cinematics（不经模组）。
  workspace: {
    root: () => ipcRenderer.invoke('workspace:root'),
    setRoot: (path) => ipcRenderer.invoke('workspace:set-root', path),
    listScripts: () => ipcRenderer.invoke('workspace:list-scripts'),
    readScript: (path) => ipcRenderer.invoke('workspace:read-script', path),
    writeScript: (path, text) => ipcRenderer.invoke('workspace:write-script', path, text),
    removeScript: (path) => ipcRenderer.invoke('workspace:remove-script', path),
    scriptStamps: () => ipcRenderer.invoke('workspace:script-stamps'),
    scriptExists: (path) => ipcRenderer.invoke('workspace:script-exists', path),
  },

  // 应用信息：版本只来自主进程 app.getVersion()（dev 读 package.json，打包后读注入值）。
  app: {
    version: () => ipcRenderer.invoke('app:version'),
  },

  // 自动更新（03）：版本复用 app:version；检查 / 安装 / 状态订阅走三条更新通道。
  // 只暴露这四个方法，不暴露 ipcRenderer，也不允许任意通道名。
  updates: {
    version: () => ipcRenderer.invoke('app:version'),
    check: () => ipcRenderer.invoke('updates:check'),
    install: () => ipcRenderer.invoke('updates:install'),
    onState: (listener) => {
      const off = subscribe('updates:state', listener)
      // 订阅时拉一次当前态：打开设置页能看到上一次检查的结果（不触发新的检查）。
      void ipcRenderer.invoke('updates:state').then((state) => listener(state)).catch(() => {})
      return off
    },
  },

  // WebUI 握手 token：异步取（主进程每次重读 token 文件，支持令牌轮换）；返回 Promise。
  webuiToken: () => ipcRenderer.invoke('webui:token'),
}

contextBridge.exposeInMainWorld('workbench', workbench)
