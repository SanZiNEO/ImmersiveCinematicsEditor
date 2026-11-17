/**
 * demo 主题文件表（04-07 / 04-11）。
 *
 * JSON 是纯数据：只描述 token，不执行代码、不加载远程资源。
 * `path` 是 manifest 贡献里的身份/诊断路径；真正的主题定义来自 JSON import，
 * 由 `activate` 注册到 `ThemeRegistry`（同一份数据，不在 manifest 里重复写 token）。
 */
import type { ThemeDefinition, ThemePreview } from '../../../workbench/api/theme.ts'
import sepiaJson from './sepia.json'
import midnightJson from './midnight.json'

/** 一个 demo 主题文件：定义 + 清单路径 + 预览色块。 */
export interface DemoThemeFile {
  definition: ThemeDefinition
  path: string
  preview: ThemePreview
}

/**
 * 把 JSON import 收窄成 `ThemeDefinition`。
 *
 * JSON 的字符串字面量在 TS 里推断为宽 `string`，不能直接赋值给 `appearance` 联合；
 * 这里只做形状收窄，真正的合法性由 `ThemeRegistry.registerContribution` 校验
 * （非法颜色/缺 token 会拒绝并进入诊断，不会静默放过）。
 */
function readThemeFile(input: unknown, path: string): DemoThemeFile {
  const definition = input as ThemeDefinition
  if (definition.preview === undefined) {
    throw new Error(`demo 主题缺少 preview：${path}`)
  }
  return { definition, path, preview: definition.preview }
}

/** `themes/sepia.json`（light）。 */
export const SEPIA_THEME_FILE: DemoThemeFile = readThemeFile(sepiaJson, 'themes/sepia.json')

/** `themes/midnight.json`（dark）。 */
export const MIDNIGHT_THEME_FILE: DemoThemeFile = readThemeFile(midnightJson, 'themes/midnight.json')

/** 全部 demo 主题文件（顺序即注册顺序）。 */
export const THEME_FILES: readonly DemoThemeFile[] = [SEPIA_THEME_FILE, MIDNIGHT_THEME_FILE]
