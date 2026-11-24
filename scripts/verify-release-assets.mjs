#!/usr/bin/env node
/**
 * 发布资产一致性校验（01-03）。
 *
 * 对 `release/` 下的安装包、`.blockmap`、`latest.yml` 做五条断言：
 *   1. latest.yml 的 version == 期望版本（--version，默认 0.1.0）
 *   2. files[0].url 在 release/ 下逐字存在（区分空格、连字符、大小写）
 *   3. 重算 sha512（base64）与 size，与 latest.yml 一致
 *   4. files[0].url + '.blockmap' 存在
 *   5. 产物名包含版本号（差分更新的前提）
 *
 * 退出码：0 PASS；1 FAIL；2 BLOCKED（未打包 / 目录为空，记 NOT RUN）。
 * 零依赖：只用 node:fs / node:path / node:crypto，手写读取 latest.yml 的标量。
 * 不调用 `electron-builder verify`：26.15.3 的 CLI 没有该子命令。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const RELEASE_DIR = path.join(process.cwd(), 'release')
const EXIT_PASS = 0
const EXIT_FAIL = 1
const EXIT_BLOCKED = 2

const failures = []

function parseArg(flag) {
  const exact = process.argv.indexOf(flag)
  if (exact >= 0) return process.argv[exact + 1]
  const prefixed = process.argv.find((arg) => arg.startsWith(`${flag}=`))
  return prefixed === undefined ? undefined : prefixed.slice(flag.length + 1)
}

const expectedVersion = parseArg('--version') ?? '0.1.0'

function unquote(value) {
  return value.trim().replace(/^['"]|['"]$/g, '')
}

/** 只解析本脚本需要的标量：顶层 version，files 首项的 url / sha512 / size。 */
function readLatestYaml() {
  const text = fs.readFileSync(path.join(RELEASE_DIR, 'latest.yml'), 'utf8')
  const root = {}
  let file = null
  let inFiles = false
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue
    const top = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (top !== null) {
      root[top[1]] = unquote(top[2])
      inFiles = top[1] === 'files'
      continue
    }
    if (!inFiles) continue
    // 列表项：`  - url: ...`，后续字段与 `-` 对齐（`    sha512: ...`）。
    const item = line.match(/^\s+(?:-\s*)?(url|sha512|size):\s*(.*)$/)
    if (item === null) continue
    if (file === null) file = {}
    if (file[item[1]] === undefined) file[item[1]] = unquote(item[2])
  }
  return { root, file }
}

function sha512Base64(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('base64')))
  })
}

/** 每条断言都打印编号、字段名、期望、实际；失败不中断后续断言。 */
function check(no, label, expected, actual, passed) {
  if (!passed) failures.push(`[${no}] ${label} 期望=${expected} 实际=${actual}`)
}

async function main() {
  if (!fs.existsSync(RELEASE_DIR)) {
    console.error('NOT RUN: release/ 目录不存在，尚未打包')
    return EXIT_BLOCKED
  }

  const exes = fs.readdirSync(RELEASE_DIR).filter((name) => name.toLowerCase().endsWith('.exe'))
  if (exes.length === 0) {
    console.error('NOT RUN: release/ 下没有 exe，尚未打包')
    return EXIT_BLOCKED
  }
  if (exes.length > 1) {
    console.error(`FAIL: release/ 残留 ${exes.length} 份 exe（应只有一份）：${exes.join(' | ')}`)
    return EXIT_FAIL
  }

  const ymlPath = path.join(RELEASE_DIR, 'latest.yml')
  if (!fs.existsSync(ymlPath)) {
    console.error('FAIL: [1] latest.yml 期望=存在 实际=缺失（打包未生成 latest.yml）')
    return EXIT_FAIL
  }

  let root
  let file
  try {
    ;({ root, file } = readLatestYaml())
  } catch (error) {
    console.error(`BLOCKED: 无法读取 latest.yml：${error instanceof Error ? error.message : String(error)}`)
    return EXIT_BLOCKED
  }

  console.log(`release/ 产物: ${exes[0]}（${fs.statSync(path.join(RELEASE_DIR, exes[0])).size} B）`)
  console.log(`期望版本: ${expectedVersion}`)

  check(
    1,
    'latest.yml version',
    expectedVersion,
    root.version ?? '(缺字段)',
    root.version === expectedVersion,
  )

  const url = file?.url
  const exePath = url === undefined || url === '' ? null : path.join(RELEASE_DIR, url)
  const exeExists = exePath !== null && fs.existsSync(exePath)

  check(2, 'files[0].url 磁盘存在', true, exeExists ? true : `false（${url ?? '(缺字段)'}）`, exeExists)

  if (exeExists) {
    const actualSha = await sha512Base64(exePath)
    check(3, 'sha512', file.sha512 ?? '(缺字段)', actualSha, same(file.sha512, actualSha))
    const actualSize = fs.statSync(exePath).size
    check(3, 'size', file.size ?? '(缺字段)', actualSize, same(file.size, actualSize))
  } else {
    failures.push(`[3] sha512 期望=${file?.sha512 ?? '(缺字段)'} 实际=无法计算（文件不存在）`)
    failures.push(`[3] size 期望=${file?.size ?? '(缺字段)'} 实际=无法计算（文件不存在）`)
  }

  const blockmapPath = exePath === null ? null : `${exePath}.blockmap`
  const blockmapExists = blockmapPath !== null && fs.existsSync(blockmapPath)
  check(4, 'blockmap 存在', true, blockmapExists ? true : `false（${url ?? '(缺字段)'}.blockmap）`, blockmapExists)

  const nameHasVersion = url !== undefined && url.includes(expectedVersion)
  check(5, '产物名含版本', true, nameHasVersion ? true : `false（${url ?? '(缺字段)'}）`, nameHasVersion)

  if (failures.length > 0) {
    for (const line of failures) console.error(line)
    console.error(`FAIL: ${failures.length} 条断言不成立`)
    return EXIT_FAIL
  }

  console.log(`PASS: ${url}（${fs.statSync(exePath).size} B），五条断言全过`)
  return EXIT_PASS
}

/** 字符串化比较：size 可能来自 YAML 字符串，数值比较前统一成 String。 */
function same(expected, actual) {
  return String(expected) === String(actual)
}

process.exitCode = await main()
