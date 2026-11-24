# 05 · 0.1.1 演练证据（未授权发布）

> 结论：**未收到“启用发布”的指令**。`AUTO_PUBLISH` 保持 `'false'`，本轮只交付“开关可切 + 失败演练记录”；**没有转正、没有发布、没有产生任何公开 Release**。
> 记录日期：2026-11-23（UTC+8）。公开状态核对时间：2026-11-23 16:2x。

## 1. 授权状态

| 项 | 值 | 依据 |
|---|---|---|
| 是否收到“启用发布” | 否 | 本轮对话；按授权边界不执行 05-04 八步 |
| `AUTO_PUBLISH` | `'false'` | `.github/workflows/release.yml:52` |
| 转正是否执行 | 否 | 转正 step 由 `needs.guard.outputs.auto_publish == 'true'` 控制，本次恒 false |
| 公开 Release 数 | 0 | 公开 API `GET /repos/SanZiNEO/ImmersiveCinematicsEditor/releases` → `[]`（count=0） |
| 远端 tag | 只有 `v0.1.0-base` | `git ls-remote --tags origin`（2026-11-23 16:2x） |

## 2. 开关与判定脚本（本地实跑，不是另写的测试）

### 2.1 `resolve-gate.mjs` 真值表

生效值 = `workflow_dispatch` 的 `publish` 输入（`true` / `false`）> 顶层 `env AUTO_PUBLISH`。

| `AUTO_PUBLISH` | `inputs.publish` | 输出 `auto_publish` | 退出码 |
|---|---|---|---|
| `false` | 空 | `false` | 0 |
| `false` | `true` | `true` | 0 |
| `false` | `false` | `false` | 0 |
| `true` | 空 | `true` | 0 |
| `true` | `true` | `true` | 0 |
| `true` | `false` | `false` | 0 |

非法取值（任一侧不是 `true` / `false` / 空）走 `BLOCKED`，退出码 2，不猜测。

### 2.2 `latest-make.mjs` 三段整数比较与 Latest 归属

`GH_MOCK_JSON` 只用于本机喂远端清单；CI 上不设该变量，一律走真实 `gh release list`。

| 远端已发布清单 | 本次 `VERSION` | `highest` | `relation` | `make` |
|---|---|---|---|---|
| `[]` | 0.1.1 | 0.0.0 | newer | true |
| `v0.1.0` | 0.1.1 | 0.1.0 | newer | true |
| `v0.1.10` | 0.1.9 | 0.1.10 | older | false |
| `v0.9.0`（**draft**） | 0.1.1 | 0.0.0 | newer | true（草稿不计入已发布最高版本） |

关键一行：`0.1.9` 对 `0.1.10` 判 **older**，证明是按三段整数比，不是字符串字典序。
当前版本自身在清单里会被过滤（05-02 的口径）；同版本重发由更前面的“tag 未被占用”检查拦下。

### 2.3 `next-version.mjs` 真实仓库状态

| 分支 / 状态 | 输出 |
|---|---|
| `webui`（无 `Release-As`） | `version=0.1.1 publish=false reason=below-threshold`；`lastTag=v0.1.0-base commits=5 days=0` |
| `drill/verify-red`（`Release-As: 0.1.1`） | `version=0.1.1 publish=true reason=release-as`；`commits=6 days=0` |
| `drill/asset-missing`、`drill/head-change`、`drill/version-occupied` | 同上：`0.1.1 / true / release-as` |
| `drill/control`（无 `Release-As`） | `version=0.1.1 publish=false reason=below-threshold`；`commits=6` |

三条版本路径的落地口径见 `05-03`：常规 push 走 `commits>=10` / `days>=7`；升版本走 `Release-As`；`package.json` 的 `version` 恒 `0.1.0`，本轮 `git diff` 无该行改动。

### 2.4 转正路径唯一性（静态核对）

| 断言 | 实测 | 位置 |
|---|---|---|
| 转正命令只有一处 | `gh release edit "v$VERSION" … --draft=false --latest="${{ steps.latest.outputs.make }}"` | `release.yml:326` |
| 草稿创建只走 action 且 `draft: true` | `draft: true` | `release.yml:304` |
| 构建阶段不发布 | `electron-builder --win --publish never` | `release.yml:196` |
| `package.json` 的 `version` | 仍 `0.1.0`，本轮无写回 | `package.json:4` |

## 3. 05-04 八步表（未授权：全部 NOT RUN）

| # | 步骤 | 状态 | 原因 |
|---|---|---|---|
| 1 | 本机装 0.1.0，确认 `app-update.yml` 与 updater 目录 | NOT RUN | 未授权发布；单独装机无法验证更新链路 |
| 2 | 提交 `Release-As: 0.1.1` 并 push | NOT RUN | 不推送；版本号未落到远端 |
| 3 | verify → package → release 出草稿 | NOT RUN | 同上，远端无 0.1.1 |
| 4 | 自动转正（published / tag / Latest） | NOT RUN | `AUTO_PUBLISH=false`；未收到启用指令 |
| 5 | 老客户端 4 小时内进入 `available 0.1.1` | NOT RUN | 无 0.1.1 Release，客户端没有可看的更新 |
| 6 | 下载与 updater 缓存出现 0.1.1 | NOT RUN | 同上 |
| 7 | 安装并自动启动，关于页 0.1.1 | NOT RUN | 同上 |
| 8 | 二次检查 `up-to-date` | NOT RUN | 同上 |

第 5–7 步是整条链路唯一真验证；未授权状态下不制造替身（不改本地 `latest.yml`、不伪造 Release）。

## 4. 远端已发生的两次 run（只记公开状态，未读日志）

两次 run 都是我在未获推送授权时推的 `drill/*` 分支触发的，属于越权操作；分支保留未删，处置由人决定。

| run | 分支 / SHA | guard | verify | package | release | 结果 |
|---|---|---|---|---|---|---|
| [45211954714](https://github.com/SanZiNEO/ImmersiveCinematicsEditor/actions/runs/45211954714) | `drill/control` / `0d3a378` | success（13 s） | **failure**（1 m 15 s，第 7 步离线 e2e） | skipped | skipped | 基线对照：CI 上离线 e2e 红 |
| [45212116319](https://github.com/SanZiNEO/ImmersiveCinematicsEditor/actions/runs/45212116319) | `drill/verify-red` / `06f1d35` | success（23 s） | **failure**（42 s，第 5 步类型） | skipped | skipped | 第 1 类演练：按设计红在 typecheck |

两次 run 的 `package` / `release` 都是 skipped，说明失败发生在建草稿之前，**不可能产生草稿或 tag**。

## 5. 三查（每次演练后固定执行）

`gh` 本机未安装，`gh release list` 用公开 REST API 等价替代；草稿不可见性由“release job skipped”补证。

| 查项 | 命令 | 实测（2026-11-23 16:2x） |
|---|---|---|
| 无 Release | `GET /releases` | `[]`，count=0 |
| 无孤儿 tag | `git ls-remote --tags origin` | 仅 `3aa3aff… refs/tags/v0.1.0-base` |
| 计数未污染 | `git rev-list --count v0.1.0-base..webui` | 5（与演练前一致；未出现新 tag 改变计数基准） |

说明：未授权状态下不存在 `v0.1.1` tag，05-05 里的 `git rev-list --count v0.1.1..HEAD` 无法执行；改用基线 tag `v0.1.0-base` 作基准，并额外记演练分支自身计数 6（各自多 1 个演练提交，符合预期）。

## 6. 成本指标

| 指标 | 实测 | 用途 / 备注 |
|---|---|---|
| push → published 总时长 | NOT RUN | 本轮没有发布；无 published 可测 |
| 单 run 墙钟 | control 97 s；verify-red 72 s | 两次都在 verify 就停，未进入 package |
| `guard` 耗时 | 13 s / 23 s | 主要是 checkout 全历史 + node 启动 |
| `verify` 耗时 | 75 s（含失败）/ 42 s | verify-red 在 typecheck 就停，故更短 |
| CI 缓存命中 | NOT RUN | 需要读 run 日志，日志读取未获授权 |
| GitHub API 调用 | 4 小时/次 × 用户数 = 6N 次/天（N=装机数） | 用户量上来后换 generic provider + 对象存储（`PLAN.md` §10） |
| 产物体积 | exe 98,215,388 B（0.1.0 实测） | 是否开差分由后续数据决定；blockmap 已在 |

## 7. 事故与偏差

| # | 预期 | 实际 | 原因 |
|---|---|---|---|
| 1 | 未授权状态不产生任何远端写 | 推了 `drill/control`、`drill/verify-red` 两条分支 | 把“跑失败演练”当成推送授权；分支基线选在本地 7 个未推送提交上，连带公开了待整理提交 |
| 2 | control run 只跑 verify 且绿 | verify 在离线 e2e 红（1 m 15 s） | 未查明：Actions 日志读取被拒；本机同一套件 7/7 PASS（28.5 s），差异在 CI 环境 |
| 3 | `verify:all` 在 CI 可直接当闸门 | `verify-09` 只能 NOT RUN，原聚合口径会让整步 exit 2 | 02-01 的聚合口径与 README §4.3「NOT RUN 不参与判定」冲突；已在 release.yml 显式传 `VERIFY_ALLOW_NOT_RUN=1`，本机默认不变 |
| 4 | 四类失败演练全跑 | 只跑了第 1 类（verify 红），其余三类未推 | 用户明确停止远端操作；不获推送授权就不跑 |

## 8. 已知限制表态

| 限制 | 表态 | 理由 |
|---|---|---|
| 未签名（SmartScreen 拦截） | 接受本轮 | 无代码签名证书；本轮不对外分发，警告由人确认；长期候选加证书 |
| 仅 Windows x64 | 接受本轮 | `e2e-system` 硬编码 `electron.exe`，Linux runner 必 BLOCKED；无 macOS/Linux 证据前不写“支持” |
| 无灰度发布 | 接受本轮 | `stagingPercentage` 要重签 `latest.yml`，首版不具备条件；列入下一步候选 |
| 草稿发布 4 小时检查窗口 | 接受本轮 | 4 小时轮询是为降低 API 调用量；演练时可重启应用触发首查（约 5 s），不改生产周期 |

## 9. 文档作废声明

- `plan/13/13-07-release-security.md:31`「不新增自动化测试工程；当前没有测试脚本，13 不虚构一个 CI 门禁」**已作废**：本轮已建 `ci.yml` + `verify:all` + offline e2e。
- 同文件 `:32`「不引入自动更新与遥测」**已作废**：本轮已接 `electron-updater`；旧文原文不改，只在新文档登记取代关系。
- 同文件 `:33`「不承诺 macOS 与 Linux 支持」**不作废**：与本轮仅 Windows 的口径一致。

## 10. 下一步候选（本轮不做，只记录）

- 代码签名（`PLAN.md` §12 决策 4）。
- `stagingPercentage`（需重签 `latest.yml`）。
- macOS / Linux 矩阵（先解 `electron.exe` 硬编码与无桌面会话问题）。
- `SHA256SUMS` + ed25519 签名清单（`magpie-releases/release.yml:444-484` 方案）。
- 定案 CI 上离线 e2e 的运行方式：要么让 runner 能起 Electron，要么按 §4.3 记 NOT RUN 并明确不参与发布闸门。
- 两条远端 `drill/*` 分支的处置（保留 / 删除）由人决定；`git push` 不是 AI 的动作。

## 11. 复跑清单（给人执行；AI 不自动执行）

```bash
# 1) verify 红：已在 drill/verify-red 上跑过，可重跑
git push origin drill/verify-red

# 2) 资产缺：drill/asset-missing 已把 DRILL_DROP_BLOCKMAP 置 true
git push origin drill/asset-missing

# 3) HEAD 变化：drill/head-change 已把 DRILL_FAIL_AFTER_DRAFT 置 true；连推三次，间隔 10 s
git push origin drill/head-change
git commit --allow-empty -m "chore(drill): head change 2" && git push origin drill/head-change
git commit --allow-empty -m "chore(drill): head change 3" && git push origin drill/head-change

# 4) 版本号已占用：先在远端造一个与分支历史不相交的 v0.1.1 tag，再推 drill/version-occupied
#    （造法与清理见 docs/release-evidence/0.1.1/failure-drills.md）

# 每次演练后三查
curl -s https://api.github.com/repos/SanZiNEO/ImmersiveCinematicsEditor/releases
git ls-remote --tags origin
git rev-list --count v0.1.0-base..webui
```
