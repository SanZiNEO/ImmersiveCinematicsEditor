/**
 * G4：`window.workbench` 直连白名单。
 *
 * 白名单是「文件 + 行号 + 理由」的表，不按整文件放行；白名单条目必须仍命中，
 * 行号漂移或语句被删要报“白名单过期”。注释先剥离，注释里提一嘴不算违规。
 */
import { join } from 'node:path'
import { check, summaryLine, exitCode, notRun } from '../verify-kit.ts'
import { GUARD_EXEMPTIONS } from './exemptions.ts'
import {
  DIRECT_RE,
  REPO_ROOT,
  readText,
  scanDirectHits,
  selfTestCase,
  stripComments,
  type DirectHit,
} from './kernel.ts'

interface Allowed {
  file: string
  line: number
  why: string
}

const ALLOWED: Allowed[] = [
  { file: 'src/app/main.ts', line: 31, why: 'Reflect.get 读主题启动缓存，随后做形状窄化校验' },
  { file: 'src/workbench/host/createHost.ts', line: 19, why: '宿主分流唯一入口，读桥选择 Electron / 浏览器宿主' },
  { file: 'src/workbench/host/createHost.ts', line: 24, why: 'console.info 提示文本里的字样，不是读取' },
  { file: 'src/workbench/app/WorkbenchApp.ts', line: 618, why: '读 webuiToken，失败回落 URL 查询串' },
]

function main(): void {
  const selfTest = selfTestCase()
  let hits: DirectHit[]
  try {
    hits = scanDirectHits()
  } catch (error) {
    notRun('G4 源码可扫描', error instanceof Error ? error.message : String(error))
    return
  }

  const allowed = [...ALLOWED]
  const exempt = new Map<string, string>()
  for (const [key, why] of Object.entries(GUARD_EXEMPTIONS)) {
    if (key.startsWith('G4: ')) exempt.set(key.slice(4).trim(), why)
  }

  if (selfTest === 'direct-window') {
    hits.push({
      file: 'src/plugins/demo.kitchen-sink/settings/DemoSettingsSection.vue',
      line: 1,
      text: 'window.workbench.files.openScript(...)',
    })
  }
  if (selfTest === 'stale-whitelist') {
    allowed.push({ file: 'src/app/main.ts', line: 999, why: '自测：过期白名单' })
  }

  for (const hit of hits) {
    const key = `${hit.file}:${hit.line}`
    const inTable = allowed.some((entry) => entry.file === hit.file && entry.line === hit.line)
    check(`G4 直连已登记：${key}`, inTable || exempt.has(key), hit.text)
  }

  for (const entry of allowed) {
    const key = `${entry.file}:${entry.line}`
    let text = ''
    try {
      text = stripComments(readText(join(REPO_ROOT, entry.file))).split('\n')[entry.line - 1] ?? ''
    } catch {
      text = ''
    }
    check(`G4 白名单仍命中：${key}`, DIRECT_RE.test(text), entry.why)
  }

  for (const [key] of exempt) {
    const hit = hits.some((entry) => `${entry.file}:${entry.line}` === key)
    check(`G4 豁免仍有效：${key}`, hit, '该行已不存在直连，豁免过期')
  }
}

main()
console.log(summaryLine())
process.exitCode = exitCode()
