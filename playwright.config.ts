/**
 * Playwright E2E 配置（04 轮真实端到端验收）。
 *
 * 按 Electron 官方测试指南用 `_electron.launch`（Spectron 已废弃）：
 * - 先构建 `dist/`（生产入口）或起 vite dev（`webServer`）走开发模式；
 * - 当前用例跑开发模式：`electron.launch({ args: ['.'] })` + `IC_EDITOR_DEV_URL`，
 *   这样渲染进程的 dev 调试钩子可用，能驱动真实 router 而不引入产品期钩子。
 */
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'e2e-artifacts',
  webServer: {
    command: 'npx vite --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 90_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
