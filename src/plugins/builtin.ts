/**
 * 编译期插件清单（04-01 / 05-13）：唯一入口。
 *
 * 只允许静态 import；不允许运行时扫目录 / 读插件文件夹 / 从网络拉 manifest。
 * 发布构建可通过构建期常量排除 `demo.*`。
 */
import type { PluginManifest } from '../workbench/api/contributions.ts'
import coreWorkbench from './core.workbench/manifest.ts'
import scriptGraph from './core.script-graph/manifest.ts'
import timelinePlugin from './core.timeline/manifest.ts'
import coreClipEffects from './core.clip-effects/manifest.ts'
import coreSelectionProperties from './core.selection-properties/manifest.ts'
import coreBehavior from './core.behavior/manifest.ts'
import coreMeta from './core.meta/manifest.ts'
import coreTransitionPanel from './core.transition-panel/manifest.ts'
import coreCameraInspect from './core.camera-inspect/manifest.ts'
import corePaths from './core.paths/manifest.ts'
import coreOverlay from './core.overlay/manifest.ts'
import demoExtra from './demo.extra/manifest.ts'
import demoKitchenSink from './demo.kitchen-sink/manifest.ts'

/** 全部内置插件（顺序即声明顺序；依赖由 `requires` 决定拓扑）。 */
export const BUILTIN_PLUGINS: PluginManifest[] = [
  coreWorkbench,
  scriptGraph,
  timelinePlugin,
  coreClipEffects,
  coreSelectionProperties,
  coreBehavior,
  coreMeta,
  coreTransitionPanel,
  coreCameraInspect,
  corePaths,
  coreOverlay,
  demoExtra,
  demoKitchenSink,
]
