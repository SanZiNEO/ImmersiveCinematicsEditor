#!/usr/bin/env node
/**
 * 05-02 · Latest 归属判定（零依赖）
 *
 * 取当前"已发布"（非 draft）Release 里的最高版本，与本次 $VERSION 做三段整数比较：
 *   本次更高  -> make=true，转正时 --latest=true
 *   否则      -> make=false，转正时 --latest=false（后发的旧版本不许抢走 Latest）
 *
 * 为什么不用 action-gh-release 自带的 publish：它发布时不带 make_latest，
 * GitHub 会把"最后发布的"标成 Latest——晚发的旧版本会抢走新版本的标记。
 *
 * 输入：VERSION（env）、GITHUB_REPOSITORY（env）、GH_TOKEN（gh 自己读）
 * 输出：make=true|false、relation=newer|same|older、highest=<已发布最高版本>
 *        release job 用 relation 做"禁止降级发布"前置闸门，make 只决定 --latest。
 * 退出码：0 判定完成；2 BLOCKED（gh 不可用 / 返回不可解析）
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'

function blocked(message) {
  console.error(`BLOCKED: ${message}`)
  process.exit(2)
}

const VERSION = (process.env.VERSION ?? '').trim()
const REPO = (process.env.GITHUB_REPOSITORY ?? '').trim()
if (!/^\d+\.\d+\.\d+$/.test(VERSION)) blocked(`VERSION 不是三段 semver：${VERSION || '(未设置)'}`)
// 本地用例/演练可以用 GH_MOCK_JSON 直接喂清单；CI 不设置该变量，一律走真实 gh。
const MOCK = (process.env.GH_MOCK_JSON ?? '').trim()
if (MOCK === '' && REPO === '') blocked('缺 env GITHUB_REPOSITORY')

function parse(text) {
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec((text ?? '').trim())
  return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])]
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

let rows
if (MOCK !== '') {
  try {
    rows = JSON.parse(MOCK)
  } catch (error) {
    blocked(`GH_MOCK_JSON 不是 JSON：${error instanceof Error ? error.message : String(error)}`)
  }
} else {
  const list = spawnSync('gh', ['release', 'list', '-R', REPO, '--json', 'tagName,isDraft', '--limit', '200'], {
    encoding: 'utf8',
  })
  if (list.error !== undefined) blocked(`gh 不可用：${list.error.message}`)
  if (list.status !== 0) blocked(`gh release list 失败：${(list.stderr ?? '').trim()}`)
  try {
    rows = JSON.parse(list.stdout ?? '[]')
  } catch (error) {
    blocked(`gh release list 输出不是 JSON：${error instanceof Error ? error.message : String(error)}`)
  }
}
if (!Array.isArray(rows)) blocked('release 清单不是数组')

const published = rows
  .filter((row) => row.isDraft !== true && row.tagName !== `v${VERSION}`)
  .map((row) => parse(row.tagName))
  .filter((parts) => parts !== null)

let highest = [0, 0, 0]
for (const parts of published) {
  if (compare(parts, highest) > 0) highest = parts
}

const mine = parse(`v${VERSION}`)
const rel = compare(mine, highest)
const relation = rel > 0 ? 'newer' : rel === 0 ? 'same' : 'older'
const make = relation === 'newer' ? 'true' : 'false'

// 输出三键：make 供 --latest 用；relation/highest 供"禁止降级发布"前置闸门用。
const outputs = [`make=${make}`, `relation=${relation}`, `highest=${highest.join('.')}`]
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${outputs.join('\n')}\n`)
} else {
  console.log(outputs.join('\n'))
}
console.log(
  `version=${VERSION} highestPublished=${highest.join('.')} publishedCount=${published.length} ` +
    `relation=${relation} -> make=${make}`,
)
if (make === 'false') {
  console.log(`${highest.join('.')} is newer: v${VERSION} is published without the Latest mark`)
}
process.exit(0)
