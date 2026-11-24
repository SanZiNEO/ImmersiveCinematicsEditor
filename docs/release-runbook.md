# 发布手册（草稿优先，04 轮）

> 适用：`.github/workflows/release.yml`（guard → verify → package → release(draft)）。
> `AUTO_PUBLISH` 默认 `false`：流水线停在草稿，转正由人手动完成。05 轮已落地自动转正开关；启用需显式把 workflow 里的 `AUTO_PUBLISH` 改成 `'true'`，或对单次 run 用 `workflow_dispatch` 的 `publish=true` 逃生口。
> 所有命令在仓库根目录执行；`$GITHUB_REPOSITORY` 在 CI 里有值，本机执行时换成 `SanZiNEO/ImmersiveCinematicsEditor`。

## 1. 谁能发

- 只有人能 push 到 `webui`。AI 只 commit，不 push，也不判断批次边界。
- 人复核 AI 产出的提交后再推送；push 本身决定"这一批发不发"，CI 只决定质量。
- 一次发布 = 一次 push（或带 `force` 的 `workflow_dispatch`）。不要手动 `gh release create` 绕开流水线。

## 2. guard 怎么读

guard 在 `.github/scripts/next-version.mjs`，阈值在 `release.yml` 顶层 `env`：

| 触发 | 条件 | reason |
|---|---|---|
| 提交数 | 剔除 `chore: release` 后的净提交数 ≥ `MIN_COMMITS`（默认 10） | `commits>=10` |
| 天数 | 最近 `v*` tag 的提交日期距今天数 ≥ `MAX_DAYS`（默认 7） | `days>=7` |
| `Release-As` | 批次提交正文有 `Release-As: X.Y.Z`（取最新一条，跳过全部阈值） | `release-as` |
| 手动 force | `workflow_dispatch` 勾选 `force` | `force` |
| 都不成立 | — | `below-threshold`（`publish=false`） |

判定优先级：`force` > `release-as` > `days>=7` > `commits>=10`。输出只有三个键：`version` / `publish` / `reason`。

常用操作：

```bash
# 想立刻发一版：造一条只带 Release-As 的空提交（版本可任选，必须高于最近 tag）
git commit --allow-empty -m "chore: release 0.1.1" -m "Release-As: 0.1.1"

# 或在 Actions 页面 Run workflow，force=true
gh workflow run release.yml -f force=true
```

不发布也正常：`publish=false` 时 verify 仍然跑完，package / release 跳过。不要为了"让 CI 有点反应"去改阈值。

## 3. 手动转正

先确认草稿齐三件，再转正：

```bash
gh release view "v$VERSION" -R "$GITHUB_REPOSITORY" --json isDraft,assets \
  --jq '{isDraft, assets: [.assets[].name]}'      # 期望 isDraft=true，assets 恰好 3 件

# Releases 页：找到草稿 → Edit → 必要时补 notes → Publish
# 命令行等价：
gh release edit "v$VERSION" -R "$GITHUB_REPOSITORY" --draft=false
```

转正前必查的四个判据：

1. 资产数 = 3：`*.exe`、`*.exe.blockmap`、`latest.yml`；
2. `latest.yml` 的 `url` 与 exe 资产名逐字一致（空格 / 连字符 / 大小写都不能差）；
3. 草稿的 `target_commitish` = 本次要发布的 `webui` 提交；
4. `git ls-remote --tags origin` 里 `v$VERSION` 指向同一提交。

## 4. 转正后干什么

- 客户端每 4 小时轮询一次；重启应用后约 5 秒首查。不是转正即秒更。
- 复查（三项都要有输出记录）：

```bash
gh release view "v$VERSION" -R "$GITHUB_REPOSITORY" --json isDraft,assets,tagName \
  --jq '{isDraft, tagName, assets: [.assets[].name]}'   # isDraft=false，assets 3 件
git ls-remote --tags origin | grep "refs/tags/v$VERSION"  # sha 与本次发布提交一致
gh release download "v$VERSION" -R "$GITHUB_REPOSITORY" -p latest.yml --clobber
grep -m1 'url:' latest.yml                                # 与资产里的 exe 名逐字一致
```

- 关掉本地下载的 `latest.yml`，不要把 release 资产提交进仓库。

## 5. 失败怎么办

先看 run 的 `release` job 停在哪一步：本地产物校验 / HEAD 自检 / 版本号未被占用 / 创建草稿 / 上传后复查；再看末尾 `Clean up on failure` 是否执行。

- 清理已执行：日志末尾有 `已清理：gh release list 无 v$VERSION…`。
- 清理没执行（网络、权限、token）：手动补一刀，**必须带 `--cleanup-tag`**：

```bash
gh release delete "v$VERSION" -R "$GITHUB_REPOSITORY" --cleanup-tag --yes
```

三查（三项都干净才算失败闭环）：

```bash
gh release list -R "$GITHUB_REPOSITORY" | grep "v$VERSION" || echo "no release"
git ls-remote --tags origin | grep "refs/tags/v$VERSION" || echo "no tag"
git rev-list --count "v$VERSION..HEAD" 2>/dev/null || echo "tag 不存在，该提交会滚进下一批"
```

设计说明：清理步骤只在本次 run 打过 `.release-created` 标记后才删，避免 HEAD 自检/版本占用失败时误删同名旧草稿。重跑同一次 run 前，先手动删除残留草稿与 tag 再重试。

演练口径（04-06）：在 release job 的「下载三件套」后临时加一步 `rm -f release/*.exe.blockmap`，提交后对同一 SHA 用 `workflow_dispatch`（`force=true`）跑；本地产物校验会红，因未过创建点，`gh release list` 与 `git ls-remote --tags` 都不应出现该版本。演练完删掉这步临时代码。

## 6. 回滚

```bash
gh release delete "v$VERSION" -R "$GITHUB_REPOSITORY" --cleanup-tag --yes
```

- 删 Release 会连带删 tag，下一批按新 tag 重新计数。
- 已装机用户不会自动回退（`allowDowngrade=false`）；删 Release 也不会把用户拉回旧版。
- 修正只能重新发一个**更高**的版本，让 updater 认为这是升级。

## 7. 已知限制

- 安装包未签名，SmartScreen 可能拦截；本轮不做签名。
- 只支持 Windows x64；不做 macOS / Linux 矩阵。
- 无灰度发布（`stagingPercentage` 要重签 `latest.yml`，本轮不做）。
- 本轮 `AUTO_PUBLISH` 默认 `false`（未授权状态），没有自动转正；转正必须人工执行第 3 节。05 已落地开关、Latest 归属与失败演练，见第 9 节。
- `plan/13/13-07-release-security.md` 的非目标"当前不引入自动更新与遥测 / 不虚构 CI 门禁"**已作废**，以 `example/release-refs/PLAN.md` 与本手册为准。

## 8. 草稿停留超过 3 天的检查清单

1. 是否漏看了 Release 草稿通知（Releases 页 / Actions run 摘要）；
2. 三件资产是否齐全（`gh release view --json assets`）；
3. `latest.yml` 的 `url` 与 exe 资产名是否逐字一致；
4. 是否已有更新批次在排队（同一 `release-webui` 组是否还有 run）；
5. 长期不转正是否应删除草稿与 tag（`--cleanup-tag`），避免版本空洞和计数污染；删除前确认没有客户端已经看到它（草稿对客户端不可见，正常情况可以直接删）。

## 9. 05 · 自动转正开关、Latest 归属与失败演练（默认关闭）

### 9.1 开关

| 取值 | 行为 |
|---|---|
| `AUTO_PUBLISH: 'false'`（默认，未授权状态） | 全部复查通过后停在草稿；转正由人执行第 3 节 |
| `AUTO_PUBLISH: 'true'`（启用发布时） | 全部复查通过后自动转正 |
| `workflow_dispatch` 的 `publish` 输入 | `true` / `false` 只覆盖本次 run；留空跟随 `env.AUTO_PUBLISH` |

判定只在 `.github/scripts/resolve-gate.mjs` 一处发生，输出 `auto_publish`；release job 的转正、复查、停草稿三步都读这一个输出，不存在第二条判定路径。

### 9.2 转正路径与 Latest

```bash
# 唯一转正命令（release.yml 第 13 步）
gh release edit "v$VERSION" -R "$GITHUB_REPOSITORY" --draft=false --latest="$MAKE"
```

- `MAKE` 来自 `.github/scripts/latest-make.mjs`：取**已发布（非 draft）** Release 的最高版本，按三段整数比较；`MAKE=true` 仅当本次版本更高。
- **禁止降级**：`relation != newer` 时在创建草稿之前失败（`release.yml` 第 9 步），不建草稿、不建 tag。发错版本只能再发一个更高版本修正。
- 不用 `action-gh-release` 自带的 publish：它发布时不带 `make_latest`，GitHub 会把“最后发布的”标成 Latest，晚发的旧版本会抢走标记。

### 9.3 演练分支与钩子

演练只在 `drill/*` 分支跑；三个钩子默认 `'false'`，且条件里同时要求 `startsWith(github.ref_name, 'drill/')`，生产 `webui` 不可能触发。

| 钩子 | 位置 | 作用 |
|---|---|---|
| `DRILL_DROP_BLOCKMAP` | release job 第 3 步 | 下载后删 `.blockmap`，让本地产物校验 FAIL |
| `DRILL_CLEAN_STALE` | release job 第 5 步 | 先清同名残留草稿（带 `--cleanup-tag`） |
| `DRILL_FAIL_AFTER_DRAFT` | release job 第 16 步 | 草稿建完后故意失败，验证第 17 步清理会删草稿 + tag |

版本号一律走 `Release-As:` 提交正文，不手改 `package.json`。

### 9.4 三查

```bash
# gh 不可用时用公开 REST API 等价替代
curl -s https://api.github.com/repos/SanZiNEO/ImmersiveCinematicsEditor/releases
git ls-remote --tags origin
git rev-list --count v0.1.0-base..webui   # 未授权状态没有 v0.1.1，用基线 tag 作基准
```

三项都干净才算“干净失败”。只查 Release 不查 tag 不算。

### 9.5 未授权状态（05 轮实际执行）

- `AUTO_PUBLISH` 保持 `false`；不转正。
- 0 个公开 Release；远端 tag 只有 `v0.1.0-base`。
- `0.1.1` 八步演练全部 NOT RUN（未收到启用发布指令）。
- 四类失败演练只执行了第 1 类（verify 红，PASS）；第 2/3/4 类因未获推送授权记 NOT RUN。
- 证据：`docs/release-evidence/0.1.1/README.md`、`docs/release-evidence/0.1.1/failure-drills.md`。

### 9.6 两个必须记住的事实

- **删 Release 不会让已装机用户回滚**：`allowDowngrade=false`，删 Release + tag 只影响后续批次计数，不会把用户拉回旧版；修正只能发更高版本。
- **客户端 4 小时轮询**：不是转正即秒更；演练可重启应用触发首查（约 5 秒），不要为演练改生产周期。

---

## 附：三连推的期望行为

| run | 行为 | 判据 |
|---|---|---|
| 第 1 次 | 排队 → 执行 → HEAD 自检发现远端已变 → 放弃 | 无草稿、无新 tag |
| 第 2 次 | 同上 | 同上 |
| 第 3 次 | HEAD 未变 → 建草稿 | 草稿资产 3 件，tag 指向本次 SHA |

注意：同一 `concurrency` 组只保留一个在途 run 和一个 pending run。三连推间隔 10 秒时，第 2 次 run 可能显示为 `cancelled`（pending 被第 3 次替换）；此时判据同样是"无草稿、无 tag"，仍以"只有最后一次产出草稿"为准。要以 `gh run list` 的实际记录写演练表，不按预期填。

操作口径：第一次 push 的提交正文写 `Release-As: 0.1.1`（后两次 push 不必重复，区间里仍能扫到这条）；否则按当前基线（tag 当天、净提交 2 个），guard 会判 `below-threshold`，三次都只跑 verify、不会产生草稿。

## 附：证据落盘

每次发布在 `docs/release-evidence/<version>/README.md` 记：run 编号与 URL、guard 三键输出、verify 四步退出码、package 校验 PASS 行、草稿 URL 与资产名集合、转正/回滚记录、失败清理的三查输出。只放文本，不放 exe / blockmap / 日志二进制。
