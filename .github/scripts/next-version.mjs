#!/usr/bin/env node
/**
 * 04-02 · 发布批次判定（零依赖，只用 node 内置模块）。
 *
 * 从 git 历史算下一版本号与发不发，把 version / publish / reason 写进 $GITHUB_OUTPUT：
 *   - version：Release-As 优先，否则最近 v* tag 的 patch + 1（package.json 的 version 恒不读）；
 *   - publish：true / false；
 *   - reason：commits>=10 / days>=7 / release-as / force / below-threshold。
 *
 * 阈值只从 env 读（MIN_COMMITS / MAX_DAYS，由 release.yml 的顶层 env 提供），
 * 脚本里不出现 10 / 7 字面量；env 缺失或非整数按 BLOCKED 退出 2，不给默认值。
 *
 * 退出码：0 判定完成；2 BLOCKED（git 不可用 / tag 不可解析 / 阈值缺失 / Release-As 非法）。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'

const MIN_COMMITS = Number(process.env.MIN_COMMITS)
const MAX_DAYS = Number(process.env.MAX_DAYS)

function blocked(message) {
  console.error(`BLOCKED: ${message}`)
  process.exit(2)
}

if (!Number.isInteger(MIN_COMMITS) || MIN_COMMITS < 1) {
  blocked(`阈值 env MIN_COMMITS 缺失或不是正整数（实际：${process.env.MIN_COMMITS ?? '(未设置)'}）`)
}
if (!Number.isInteger(MAX_DAYS) || MAX_DAYS < 1) {
  blocked(`阈值 env MAX_DAYS 缺失或不是正整数（实际：${process.env.MAX_DAYS ?? '(未设置)'}）`)
}

/** 所有 git 调用都走这里：git 不可用时直接 BLOCKED，不伪造输出。 */
function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' })
  if (result.error !== undefined) blocked(`git 不可用：${result.error.message}`)
  return {
    code: result.status,
    out: (result.stdout ?? '').trim(),
    err: (result.stderr ?? '').trim(),
  }
}

/**
 * 解析 v 前缀 tag 的三段整数。
 * 基线 tag 是 `v0.1.0-base`（01-06），后缀不参与版本计算，按 0.1.0 处理；
 * 发布 tag `v0.1.9` 直接取 0.1.9。解析失败返回 null，由调用方 BLOCKED。
 */
function parseTag(tag) {
  const match = /^v(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(tag ?? '')
  return match === null
    ? null
    : { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

/** Release-As 只接受严格三段 semver，不接受前缀 v 或预发布后缀。 */
function parseReleaseAs(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value ?? '')
  return match === null
    ? null
    : { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

/**
 * 三段整数比较：0.1.9 < 0.1.10。
 * 禁止字符串比——`'0.1.10' < '0.1.9'` 在字典序下成立，会把新版本判成更旧。
 */
function compareVersions(a, b) {
  for (const part of ['major', 'minor', 'patch']) {
    const diff = a[part] - b[part]
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

// 1. 上一 tag（checkout 必须 fetch-depth: 0 + fetch-tags: true，否则这里只会拿到 none）
const described = git(['describe', '--tags', '--abbrev=0', '--match', 'v*'])
const lastTag = described.code === 0 && described.out !== '' ? described.out : null
const lastVersion = lastTag === null ? null : parseTag(lastTag)
if (lastTag !== null && lastVersion === null) {
  blocked(`tag 格式不可解析：${lastTag}（只认 vX.Y.Z 或 vX.Y.Z-<后缀>）`)
}

// 2. 批次净计数：先 rev-list --count，再逐条剔除标题以 `chore: release` 开头的发布提交
const range = lastTag === null ? 'HEAD' : `${lastTag}..HEAD`
const rawCountResult = git(['rev-list', '--count', range])
if (rawCountResult.code !== 0) blocked(`git rev-list 失败：${rawCountResult.err}`)
const rawCount = Number(rawCountResult.out)
if (!Number.isInteger(rawCount) || rawCount < 0) blocked(`rev-list 计数不可解析：${rawCountResult.out}`)
const subjects = git(['log', '--format=%s', range]).out.split(/\r?\n/)
const releaseSubjects = subjects.filter((subject) => /^chore: release/.test(subject)).length
const commitCount = Math.max(0, rawCount - releaseSubjects)

// 3. 距上次发布天数：tag 提交日期（%cs）到今天；没有 tag 记 0
let days = 0
if (lastTag !== null) {
  const tagDate = git(['log', '-1', '--format=%cs', lastTag]).out
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tagDate)) blocked(`lastTag 提交日期不可解析：${tagDate || '(空)'}`)
  const elapsedMs = Date.now() - Date.parse(`${tagDate}T00:00:00Z`)
  days = Math.max(0, Math.floor(elapsedMs / 86400000))
}

// 4. Release-As：扫描批次提交正文，取最新一条（git log 默认逆序，首条命中即最新）
const bodies = git(['log', '--format=%B', range]).out
const releaseAsHits = bodies
  .split(/\r?\n/)
  .map((line) => /^Release-As:\s*(\S+)$/.exec(line))
  .filter((match) => match !== null)
  .map((match) => match[1])
const releaseAsRaw = releaseAsHits[0]
const releaseAs = releaseAsRaw === undefined ? null : parseReleaseAs(releaseAsRaw)
if (releaseAsRaw !== undefined && releaseAs === null) {
  blocked(`Release-As 不是三段 semver：${releaseAsRaw}`)
}

// 5/6. 版本：Release-As 优先；否则 patch + 1（lastTag 缺失从 0.1.0 起算）
let versionParts
if (releaseAs !== null) {
  versionParts = releaseAs
  if (lastVersion !== null && compareVersions(releaseAs, lastVersion) <= 0) {
    blocked(`Release-As 未高于最近 tag：${releaseAsRaw} <= ${lastTag}`)
  }
} else {
  const base = lastVersion ?? { major: 0, minor: 1, patch: 0 }
  versionParts = { major: base.major, minor: base.minor, patch: base.patch + 1 }
}
const version = `${versionParts.major}.${versionParts.minor}.${versionParts.patch}`

// 7. 判定：force > release-as > days>=MAX_DAYS > commits>=MIN_COMMITS > below-threshold
const force = process.env.FORCE === 'true'
let publish
let reason
if (force) {
  publish = 'true'
  reason = 'force'
} else if (releaseAs !== null) {
  publish = 'true'
  reason = 'release-as'
} else if (days >= MAX_DAYS) {
  publish = 'true'
  reason = 'days>=7'
} else if (commitCount >= MIN_COMMITS) {
  publish = 'true'
  reason = 'commits>=10'
} else {
  publish = 'false'
  reason = 'below-threshold'
}

// 8. 写 GITHUB_OUTPUT 三键；本地无该变量时打到 stdout，便于演练。
const outputs = [`version=${version}`, `publish=${publish}`, `reason=${reason}`]
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${outputs.join('\n')}\n`)
} else {
  console.log(outputs.join('\n'))
}
console.log(
  `lastTag=${lastTag ?? 'none'} commits=${commitCount}(raw=${rawCount},release=${releaseSubjects}) ` +
    `days=${days} releaseAs=${releaseAsRaw ?? '-'} -> ${version} ${publish} ${reason}`,
)

process.exit(0)
