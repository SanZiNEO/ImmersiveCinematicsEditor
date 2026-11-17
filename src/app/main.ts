/**
 * 编辑器入口（04-04 / 04-09）。
 *
 * 挂载顺序：先落启动主题变量（防白闪）→ 构造 `WorkbenchApp` → start() →
 * 挂 `WorkspaceShell`（唯一服务注入点）→ 卸载时 dispose。
 *
 * 入口不持有布局/文档状态；所有能力都在 `src/workbench/` 里。
 */
import { createApp } from 'vue'

import './global.css'

import WorkspaceShell from '../workbench/shell/WorkspaceShell.vue'
import { WORKBENCH_SERVICES_KEY } from '../workbench/host/panelContext.ts'
import { WorkbenchApp } from '../workbench/app/WorkbenchApp.ts'
import { cssVarOf } from '../workbench/api/theme.ts'
import type { ThemeCache, ThemeTokens } from '../workbench/api/theme.ts'

/** dev 期调试钩子（仅 `import.meta.env.DEV`）：驱动真实 router / 服务，供 04 实测探针使用。 */
interface WorkbenchDebugWindow {
  __workbench?: WorkbenchApp
}

/** preload 注入的启动主题缓存读取器（只有 Electron 构建存在）。 */
interface InitialThemeSource {
  initialTheme?: () => ThemeCache | null
}

/** 从 `window.workbench.theme` 上窄化取启动缓存；形状不对就返回 null。 */
function initialThemeCache(): ThemeCache | null {
  const bridge: unknown = Reflect.get(window, 'workbench')
  if (typeof bridge !== 'object' || bridge === null || !('theme' in bridge)) {
    return null
  }
  const theme: unknown = bridge.theme
  if (typeof theme !== 'object' || theme === null || !('initialTheme' in theme)) {
    return null
  }
  const read = (theme as InitialThemeSource).initialTheme
  if (typeof read !== 'function') {
    return null
  }
  try {
    const cache = read.call(theme)
    return isThemeCache(cache) ? cache : null
  } catch {
    return null
  }
}

/** 运行期校验缓存形状（跨进程数据，不能信任）。 */
function isThemeCache(value: unknown): value is ThemeCache {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  if (!('themeId' in value) || typeof value.themeId !== 'string') {
    return false
  }
  if (!('appearance' in value)) {
    return false
  }
  const appearance = value.appearance
  if (appearance !== 'dark' && appearance !== 'light' && appearance !== 'high-contrast') {
    return false
  }
  if (!('bgApp' in value) || typeof value.bgApp !== 'string') {
    return false
  }
  return 'tokens' in value && typeof value.tokens === 'object' && value.tokens !== null
}

/** 在挂载前把缓存 token 写成 CSS 变量，避免首帧白闪。 */
function applyCacheBeforeMount(cache: ThemeCache | null): void {
  if (cache === null) {
    return
  }
  const root = document.documentElement
  const tokens: Partial<ThemeTokens> = cache.tokens
  for (const token of Object.keys(tokens)) {
    const value = tokens[token as keyof ThemeTokens]
    if (typeof value === 'string') {
      root.style.setProperty(cssVarOf(token), value)
    }
  }
  root.style.setProperty(cssVarOf('bg-app'), cache.bgApp)
  root.setAttribute('data-theme-id', cache.themeId)
  root.setAttribute('data-theme-appearance', cache.appearance)
  root.style.colorScheme = cache.appearance === 'light' ? 'light' : 'dark'
}

async function boot(): Promise<void> {
  const container = document.getElementById('app')
  if (container === null) {
    throw new Error('缺少 #app 容器')
  }

  applyCacheBeforeMount(initialThemeCache())

  const workbench = new WorkbenchApp()
  await workbench.start()

  if (import.meta.env.DEV) {
    ;(window as unknown as WorkbenchDebugWindow).__workbench = workbench
  }

  const app = createApp(WorkspaceShell, { services: workbench.services })
  // 应用级注入：`inject` 只看父级链，根组件 inject 不到自己 provide 的值，
  // 所以根组件的组合式函数必须在 app 级 provide 下才可用。
  app.provide(WORKBENCH_SERVICES_KEY, workbench.services)
  app.mount(container)

  // 关闭窗口前 flush 布局与草稿（04-09）；卸载时释放插件与文档。
  window.addEventListener('pagehide', () => {
    void workbench.dispose()
  })
}

void boot().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
  const container = document.getElementById('app')
  if (container !== null) {
    container.textContent = `工作台启动失败：${message}`
  }
  console.error('[workbench] 启动失败', error)
})
