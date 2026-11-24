/**
 * Electron 宿主适配（04-09）。
 *
 * `window.workbench` 由 `electron/preload.cjs` 暴露，形状即 `WorkbenchBridge`；
 * 这里只做同形映射，不额外包装逻辑（工作台不 import `electron`）。
 */
import type { HostPort, WorkbenchBridge } from '../../api/host.ts'

export function createElectronHost(bridge: WorkbenchBridge): HostPort {
  if (bridge.kind !== 'electron') {
    throw new Error(`createElectronHost: 期望 electron 桥，收到 ${String(bridge.kind)}`)
  }
  return {
    kind: 'electron',
    platform: bridge.platform,
    app: bridge.app,
    updates: bridge.updates,
    window: bridge.window,
    files: bridge.files,
    shell: bridge.shell,
    theme: bridge.theme,
    drafts: bridge.drafts,
    menu: bridge.menu,
    storage: bridge.storage,
    workspace: bridge.workspace,
  }
}
