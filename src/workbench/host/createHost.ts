/**
 * 宿主入口（04-09）。
 *
 * Electron 构建里 preload 暴露 `window.workbench`；纯浏览器 dev 用内存宿主，
 * 并在控制台记录一条 info 诊断（浏览器不等于桌面宿主，不假装有文件系统）。
 */
import type { HostPort, WorkbenchBridge } from '../api/host.ts'
import { createBrowserHost } from './browser/BrowserHost.ts'
import { createElectronHost } from './electron/ElectronHost.ts'

declare global {
  interface Window {
    /** preload 注入的桥；只有 Electron 构建存在。 */
    workbench?: WorkbenchBridge
  }
}

export function createHost(): HostPort {
  const bridge = typeof window === 'undefined' ? undefined : window.workbench
  if (bridge !== undefined && bridge !== null) {
    return createElectronHost(bridge)
  }
  console.info(
    '[workbench] 未检测到 window.workbench，使用浏览器 dev 宿主：storage 仅内存、files 返回 null、无 nativeTheme；浏览器不持久化、不假装有文件系统。',
  )
  return createBrowserHost()
}
