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

  // WebUI 握手 token：主进程读 mod 写的 token 文件；每次连接都取新值。
  webuiToken: () => ipcRenderer.sendSync('webui:token'),
}

contextBridge.exposeInMainWorld('workbench', workbench)
