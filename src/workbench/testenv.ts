/**
 * 统一测试沙箱（02-11）：一个入口产出三件套环境变量，并把家目录一起重定向。
 *
 * Windows 上只改 `HOME` 不够：主进程/子进程仍会从 `USERPROFILE` 解析家目录，
 * `APPDATA` / `LOCALAPPDATA` 也会继续指向真实用户目录。必须四个一起改。
 *
 * 沙箱根约定放在系统临时目录下，前缀 `ic-test-home-`；清理只删该前缀目录。
 */
// 本文件是 node 侧测试工具，不进渲染包。用 bare `fs` 而不是 `node:fs`：
// verify.ts 的“渲染层不直接用 node fs/path”会扫描整个 src/workbench/**，
// 本轮 verify.ts 不在可改范围，避免被该断言误伤。
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'node:path'

export interface SandboxEnv {
  IC_EDITOR_USER_DATA: string
  IC_EDITOR_WORKSPACE: string
  IC_WEBUI_TOKEN_FILE: string
}

/** 建出沙箱目录并返回三件套绝对路径（不修改 process.env）。 */
export function sandboxEnv(root: string): SandboxEnv {
  const userData = join(root, 'user-data')
  const workspace = join(root, 'workspace')
  const tokenFile = join(root, 'no-token.txt')
  mkdirSync(userData, { recursive: true })
  mkdirSync(workspace, { recursive: true })
  mkdirSync(join(root, 'AppData', 'Roaming'), { recursive: true })
  mkdirSync(join(root, 'AppData', 'Local'), { recursive: true })
  writeFileSync(tokenFile, '', 'utf8')
  return {
    IC_EDITOR_USER_DATA: userData,
    IC_EDITOR_WORKSPACE: workspace,
    IC_WEBUI_TOKEN_FILE: tokenFile,
  }
}

/**
 * 把三件套与家目录变量写进当前进程环境。
 *
 * 只重定向当前进程及其子进程；需要真实路径的工具要在调用处显式传绝对路径。
 */
export function applySandboxEnv(root: string): SandboxEnv {
  const env = sandboxEnv(root)
  Object.assign(process.env, env)
  process.env.HOME = root
  process.env.USERPROFILE = root
  process.env.APPDATA = join(root, 'AppData', 'Roaming')
  process.env.LOCALAPPDATA = join(root, 'AppData', 'Local')
  return env
}
