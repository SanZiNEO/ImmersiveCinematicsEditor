/**
 * 编译期插件清单（04-01）：唯一入口。
 *
 * 只允许静态 import；不允许运行时扫目录 / 读插件文件夹 / 从网络拉 manifest。
 * 发布构建可通过构建期常量排除 `demo.kitchen-sink`。
 */
import type { PluginManifest } from '../workbench/api/contributions.ts'
import demoKitchenSink from './demo.kitchen-sink/manifest.ts'
import coreWorkbench from './core.workbench/manifest.ts'

/** 全部内置插件（顺序即声明顺序；依赖由 `requires` 决定拓扑）。 */
export const BUILTIN_PLUGINS: PluginManifest[] = [coreWorkbench, demoKitchenSink]
