#!/usr/bin/env node
/**
 * 05-01 · 转正开关解析（零依赖）
 *
 * 只在一处决定"这次要不要自动转正"，下游步骤一律读这个输出，避免同一判断出现两条路径。
 *
 *   生效值 = workflow_dispatch 的 publish 输入（'true' / 'false'）> 顶层 env AUTO_PUBLISH
 *   AUTO_PUBLISH 是仓库级开关：'false' = 停在草稿（04 阶段 3 行为），'true' = 复查通过后自动转正。
 *   手动逃生口只能在本次 run 覆盖，不改仓库里的开关。
 *
 * 输出：auto_publish=true|false（写 $GITHUB_OUTPUT；本地无该变量时打印到 stdout）
 * 退出码：0 判定完成；2 BLOCKED（任一侧不是 true / false，不做猜测）
 */
import fs from 'node:fs'

function blocked(message) {
  console.error(`BLOCKED: ${message}`)
  process.exit(2)
}

const AUTO = (process.env.AUTO_PUBLISH ?? '').trim()
const INPUT = (process.env.INPUT_PUBLISH ?? '').trim()

if (AUTO !== 'true' && AUTO !== 'false') {
  blocked(`env AUTO_PUBLISH 必须是 'true' / 'false'（实际：${AUTO === '' ? '(未设置)' : AUTO}）`)
}
if (INPUT !== '' && INPUT !== 'true' && INPUT !== 'false') {
  blocked(`workflow_dispatch 的 publish 输入只能是 true / false 或留空（实际：${INPUT}）`)
}

const effective = INPUT === '' ? AUTO : INPUT

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `auto_publish=${effective}\n`)
} else {
  console.log(`auto_publish=${effective}`)
}
console.log(`AUTO_PUBLISH=${AUTO} inputs.publish=${INPUT === '' ? '(空)' : INPUT} -> 本次生效=${effective}`)
process.exit(0)
