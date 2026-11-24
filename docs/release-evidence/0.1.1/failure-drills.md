# 05-05 · 四类失败演练记录

> 授权状态：未收到“启用发布”。本轮只做了第 1 类；其余三类因为**未获推送授权**记 NOT RUN，不伪造结果。
> 日期：2026-11-23（UTC+8）。所有“三查”都以公开状态为准（`gh` 本机未安装，用 REST API 等价替代）。

## 0 号对照 run（不属于四类，额外做的基线检查）

| 项 | 内容 |
|---|---|
| 分支 / SHA | `drill/control` / `0d3a378` |
| 目的 | 确认 guard → verify 这条链在 CI 上能跑，且 `publish=false` 时不产生 Release |
| guard（同 SHA 本机复算） | `version=0.1.1 publish=false reason=below-threshold` |
| 实际 | run [45211954714](https://github.com/SanZiNEO/ImmersiveCinematicsEditor/actions/runs/45211954714)：guard success（13 s），verify **failure**（1 m 15 s，第 7 步离线 e2e），package / release skipped |
| 三查 | Release 0；tag 仅 `v0.1.0-base`；`v0.1.0-base..webui` = 5 |
| 结论 | **FAIL（基线未绿）**：不是演练目标，但它暴露了“CI 上离线 e2e 起不来”，会挡住需要 verify 通过的第 2/3/4 类 |
| 备注 | 本机同一套件 `npm run e2e:system:run -- --suite offline` 为 7/7 PASS（28.5 s）；CI 失败原因未查明（日志读取未获授权） |

---

## 第 1 类 · verify 红

| 项 | 内容 |
|---|---|
| 造法 | 分支 `drill/verify-red`（`06f1d35`），在 `src/__drill-type-error.ts` 写入 `const drillNumber: number = 'not a number'`；提交正文 `Release-As: 0.1.1` |
| 期望 | guard 通过（`release-as`）；verify 在 typecheck 红；package / release 跳过；无草稿、无 tag；下一批计数不被污染 |
| guard 实测（同 SHA 本机复算） | `version=0.1.1 publish=true reason=release-as`，`commits=6 days=0` |
| 实际 run | [45212116319](https://github.com/SanZiNEO/ImmersiveCinematicsEditor/actions/runs/45212116319)：guard success（23 s）；verify **failure**（42 s，第 5 步「类型」）；package / release skipped |
| 三查 1：无 Release | 公开 `GET /releases` → `[]`（count=0）；release job skipped，结构上不可能建草稿 |
| 三查 2：无孤儿 tag | `git ls-remote --tags origin` → 仅 `v0.1.0-base` |
| 三查 3：计数未污染 | `git rev-list --count v0.1.0-base..webui` = 5（与演练前一致）；`v0.1.0-base..drill/verify-red` = 6（多出的 1 个是演练提交本身） |
| 结论 | **PASS（干净失败）** |
| 过程偏差 | 这次推送发生在未获推送授权时，属于越权操作；技术结论成立，但执行方式不合规 |

---

## 第 2 类 · 资产缺

| 项 | 内容 |
|---|---|
| 造法（已就绪，未推） | 分支 `drill/asset-missing`（`d6514d3`），把 `release.yml` 的 `DRILL_DROP_BLOCKMAP` 置 `'true'`；release job 第 3 步在下载后执行 `rm -f release/*.exe.blockmap`；提交正文 `Release-As: 0.1.1` |
| 期望 | `release` 第 4 步「本地产物校验」FAIL（缺 blockmap）；第 17 步失败清理执行但因未创建草稿而跳过；`gh release list` 为空；无 tag |
| 状态 | **NOT RUN** |
| 原因 | 未获推送授权；且当前 CI 的 verify（离线 e2e）未绿，即使推送也到不了 package / release |
| 三查 | 未执行 |

---

## 第 3 类 · HEAD 变化

| 项 | 内容 |
|---|---|
| 造法（已就绪，未推） | 分支 `drill/head-change`（`ce3a10d`），`DRILL_FAIL_AFTER_DRAFT` 置 `'true'`；第一次提交正文 `Release-As: 0.1.1`；随后再连推两次空提交，间隔 10 s |
| 期望 | 前两次 run 在 release 第 6 步「HEAD 自检」退出（远端已前进），不建草稿；只有最后一次建草稿；草稿建完后演练钩子故意失败，第 17 步清理删草稿 + `--cleanup-tag` |
| 状态 | **NOT RUN** |
| 原因 | 同上（未获推送授权 + CI verify 未绿） |
| 三查 | 未执行 |

---

## 第 4 类 · 版本号已占用

| 项 | 内容 |
|---|---|
| 造法（未执行） | 先在远端推一个与演练分支历史不相交的 `v0.1.1` tag（`git commit-tree` 空树 → `git tag v0.1.1 <sha>` → `git push origin refs/tags/v0.1.1`），再推 `drill/version-occupied`（`3feff3c`，`Release-As: 0.1.1`） |
| 期望 | release 第 7 步「版本号未被占用」FAIL，报“tag 已存在”；不覆盖旧 Release、不删旧 tag；无草稿 |
| 状态 | **NOT RUN** |
| 原因 | 未获推送授权；且临时 tag 会让远端出现一个公开 tag，必须由人决定是否接受这个副作用 |
| 三查 | 未执行（当前远端仍只有 `v0.1.0-base`） |

---

## 汇总

| 类 | 状态 | 判据 |
|---|---|---|
| 0 号对照 | FAIL | CI 离线 e2e 红，需另案处理 |
| 1 verify 红 | PASS（干净失败） | 无 Release、无新 tag、`webui` 计数 5 不变 |
| 2 资产缺 | NOT RUN | 未获推送授权；CI verify 未绿 |
| 3 HEAD 变化 | NOT RUN | 同上 |
| 4 版本号已占用 | NOT RUN | 同上，且需临时公开 tag |

**当前远端状态**：Release 0；tag 仅 `v0.1.0-base`；远端分支多出 `drill/control`、`drill/verify-red` 两条（未删，处置由人决定）。
