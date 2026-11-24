import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * e2e-system 专用 Vite 配置（仅 dev server 监听范围调整，不改构建产物与运行时语义）。
 *
 * 编辑器仓库根内除 src/electron 外还放有：e2e-system/artifacts（历次运行的 user-data 缓存、
 * 上万文件）、被复制进来的模组树 fabric/forge/common/legacy、.gradle、plan/docs 等。
 * Windows 下 Vite/chokidar 默认监听整个工程根，扫描这些非源码树会把 Node 事件循环
 * 占满，导致 dev server  accept 连接但永不响应 HTTP（GET / 超时），Electron 加载空白、
 * `.workspace-shell` 一直不出现。这里只把这些非源码目录排除出文件监听，源码热更新不受影响。
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')

export default defineConfig({
  root: repoRoot,
  base: './',
  plugins: [vue()],
  server: {
    watch: {
      ignored: [
        '**/e2e-system/artifacts/**',
        '**/example/**',
        '**/dist/**',
        '**/build/**',
        '**/.gradle/**',
        '**/fabric/**',
        '**/forge/**',
        '**/common/**',
        '**/legacy/**',
        '**/plan/**',
        '**/docs/**',
      ],
    },
  },
})
