/**
 * G1：`src/plugins/*` 一级目录 ↔ `builtin.ts` 静态登记双向守卫。
 *
 * - 磁盘有、登记无、且不在豁免表 → FAIL
 * - 登记有、磁盘无 → FAIL（孤儿登记不接受豁免）
 * - 已登记却仍挂豁免 → FAIL（防白名单腐化）
 */
import { check, summaryLine, exitCode, notRun } from '../verify-kit.ts'
import { GUARD_EXEMPTIONS } from './exemptions.ts'
import {
  builtinArrayNames,
  builtinImportBindings,
  builtinImportDirs,
  pluginDirsOnDisk,
  selfTestCase,
} from './kernel.ts'

function main(): void {
  const selfTest = selfTestCase()

  let onDisk: Set<string>
  let registered: Set<string>
  let declaredNames: string[]
  try {
    onDisk = new Set(pluginDirsOnDisk())
    registered = new Set(builtinImportDirs())
    declaredNames = builtinArrayNames()
  } catch (error) {
    notRun('G1 插件目录与 builtin 清单可读', error instanceof Error ? error.message : String(error))
    return
  }

  // 自测夹具：不改真实源码，只改内存集合。
  if (selfTest === 'unregistered-dir') onDisk.add('tmp-x')
  if (selfTest === 'orphan-registered') registered.add('demo.ghost')

  const exempt = new Map<string, string>()
  for (const [key, why] of Object.entries(GUARD_EXEMPTIONS)) {
    if (key.startsWith('G1: ')) exempt.set(key.slice(4).trim(), why)
  }

  for (const dir of onDisk) {
    check(`G1 插件目录已登记：${dir}`, registered.has(dir) || exempt.has(dir), '未在 builtin 登记')
  }
  for (const dir of registered) {
    check(`G1 登记目录存在：${dir}`, onDisk.has(dir), '登记了但目录不存在')
  }
  for (const [dir] of exempt) {
    check(`G1 豁免条目已失效：${dir}`, !registered.has(dir), '已登记却仍在豁免表')
  }

  const bindings = builtinImportBindings()
  const arraySet = new Set(declaredNames)
  for (const [variable, dir] of bindings) {
    check(`G1 import 与数组条目一致：${dir}`, arraySet.has(variable), `BUILTIN_PLUGINS 缺 ${variable}`)
  }
  check('G1 数组条目数与 import 数一致', declaredNames.length === bindings.size, {
    array: declaredNames.length,
    imports: bindings.size,
  })
}

main()
console.log(summaryLine())
process.exitCode = exitCode()
