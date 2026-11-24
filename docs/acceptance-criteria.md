# 验收标准（02 轮 · 质量闸门）

> 本文件是 04 的 release runbook 唯一引用的验收口径。改动四态含义、A1–A5 或 G1–G3 规则时，同步改本文件。

## 1. 验收四态

| 状态 | 退出码 | 含义 |
|---|---|---|
| PASS | `0` | 断言真的跑过并通过 |
| FAIL | `1` | 断言跑过且不成立 |
| BLOCKED | `2` | 环境不满足（缺依赖、缺仓库、缺游戏），必须写具体缺失项 |
| NOT RUN | — | 本轮未执行，必须出现在报告里并写明原因，不参与判定 |

**禁止用 SKIP 冒充通过。** 报告里出现无原因的 `SKIP`、空状态列或只写“应该能过”，评审直接判 FAIL。

## 2. A1–A5（落到本仓命令）

| 条 | 本仓命令 / 判据 |
|---|---|
| A1 新测试必须在旧代码上失败 | 回滚改动后跑新测试，必须 `FAIL` 且报出对应行为；编译错误与 skip 不算这条通过 |
| A2 跑全量而不是“你改的” | `npm run verify:all` + `npm run e2e:system:run -- --suite offline` |
| A3 合并前在合并结果上再跑一遍 | PR 合并前在 `webui` 最新 HEAD 上重跑 `.github/workflows/ci.yml` 的 `quality` job；review 期间有新 push 则重跑 |
| A4 记录跑了什么、在哪个 head | 每次记录 `git rev-parse HEAD` + 完整命令 + 输出尾部；缺一项不算完整证据 |
| A5 没跑的写 NOT RUN | 未执行的项写明原因，不许省略；不许用 SKIP 顶替 |

一次验收报告的固定字段：`HEAD SHA`、`verify:all` 输出尾部、`e2e` 报告路径与状态、每个守卫的 PASS/FAIL/BLOCKED/NOT RUN、未跑项原因。

## 3. 六条通用口径（AUTOMATION-TESTING §1.4 的本仓映射）

1. 新测试在旧代码上红：同 A1。
2. 测试在沙箱里跑：`src/workbench/testenv.ts` 的 `sandboxEnv()` / `applySandboxEnv()` 是唯一入口；Windows 必须同时改 `HOME`、`USERPROFILE`、`APPDATA`、`LOCALAPPDATA`。
3. 构建加全量套件：同 A2，再加 `npm run build` 与打包产物 `smoke --exe`。
4. 双引擎 / 多语言 GUI 套件：本仓不具备，固定记 **NOT RUN**，不许写 PASS。
5. 真实账号、真游戏核对：属 live 套件，只能本地手跑；没试过的不宣称可用。
6. UI 规则逐条核对：界面改动时按对应面板的「验收要点」逐条核对。

## 4. 本仓约定

- **verify-09 的模组仓库断言是 NOT RUN 语义。** 未设 `IC_MODULE_ROOT`、目录不存在或 `git` 不可用时，输出 `NOT RUN 09 模组仓库零改动：<原因>`，脚本退出码为 `2`，不记 `1`。只有目录存在且 git 可用时才断言 `git status --porcelain` 为空；非空才是代码 FAIL。
- **新增插件 / 命令 / 页面必须先过 G1–G3。** 守卫未绿不得进合并评审；豁免必须走 `src/workbench/guard/exemptions.ts`，每条带非空理由并过 G6 反查。
- **G4 宿主边界：** 新增 `window.workbench` 直连必须进白名单（文件 + 行号 + 理由），不得按整文件放行。
- **G5 core 覆盖：** `src/core/*` 每个模块必须有具体 verify 入口映射；没有就进豁免表并写理由。
- **失败定位：** `verify-kit.ts` 的 `check()` 失败行必须带 `文件:行`；只有 label 的失败输出算不合格。

## 5. 本轮已知的 BLOCKED / 未落地项

| 项 | 状态 | 原因 |
|---|---|---|
| CI 在 PR 上真跑 | BLOCKED | 本轮禁止 push / 开 PR；远端没有该 workflow，无法产生真实 run。本地只能做 YAML 与命令级校验，不当作绿。 |
| 02-11 e2e 侧统一入口 | BLOCKED | `e2e-system/plugins/electron-host/index.ts` 不在本轮文件所有权内，不能改。现有 e2e 已用 `IC_EDITOR_USER_DATA` 把 userData 指到 `e2e-system/artifacts/<run>/user-data`；真实 `%APPDATA%` 隔离靠实测复核。 |
| 02-03 九脚本统一 `verify-kit` | NOT RUN | 文件所有权只允许改 `verify-09.ts` 与 `verify-kit.ts`；`verify.ts`、`verify-05…12`、`verify12/harness.ts` 未改，定位格式只在 verify-09 与守卫生效。 |

## 6. 报告自检清单

- [ ] 有 `git rev-parse HEAD`
- [ ] 有 `npm run verify:all` 与 offline e2e 两条全量命令
- [ ] 每个未跑项都有 `NOT RUN` + 原因
- [ ] 没有无原因的 `SKIP`
- [ ] BLOCKED 项写了具体缺失项，没有写成 PASS
- [ ] 失败输出含 `文件:行`

## 7. 2026-11-23 执行记录（02 轮）

- 测试时基底 HEAD：`3aa3aff753bb129e2daed2a20600b6b65167f80b`（`webui`），本轮改动在其上未提交工作树中执行；Node `v22.23.2` / npm `10.9.8`，`.nvmrc` 同为 `22.23.2`。本轮改动随后在 `webui` 提交，未 push。
- `npm run typecheck`：PASS（exit 0）。
- `npm run verify:all`：
  - 不设 `IC_MODULE_ROOT`：exit **2**，14 PASS + 1 NOT RUN（`09 模组仓库零改动：未设置 IC_MODULE_ROOT…`），FAIL 0。
  - 设 `IC_MODULE_ROOT=E:\Documents\GitHub\ImmersiveCinematics`：exit **0**，15 PASS，FAIL 0。
  - 逐项：verify 171 / 05 51 / 06 204 / 07 598 / 08 85 / 09 399（未设路径）或 400（设路径）/ 10 96 / 11 389 / 12 568；守卫 G1 52 / G2 252 / G3 60 / G4 8 / G5 22 / G6 1，均 fail=0。
- `npm run build`：PASS（exit 0，15.48s）。
- e2e offline（沙箱 `applySandboxEnv(root)` 下）：7/7 PASS，exit 0；真实 `%APPDATA%\immersive-cinematics-editor` 与 `%USERPROFILE%\.immersivecinematics` 前后各 1861 条，新增 0 / 删除 0 / 修改 0。
- `smoke --exe release/win-unpacked/ImmersiveCinematicsEditor.exe --hold 3000`：PASS，4 项检查全 PASS。
- 六个守卫负例（虚拟违规注入，不改源码）：

| 守卫 | 用例 | 退出码 | 失败行（含文件:行） |
|---|---|---|---|
| G1 `plugin-registry` | `--self-test=unregistered-dir` | 1 | `FAIL src/workbench/guard/plugin-registry.ts:43 G1 插件目录已登记：tmp-x：未在 builtin 登记` |
| G2 `command-handlers` | `--self-test=orphan-handler` | 1 | `FAIL src/workbench/guard/command-handlers.ts:89 G2 handler 非孤儿：demo.orphan.command：plugin=demo.kitchen-sink 未在声明来源登记` |
| G3 `page-registry` | `--self-test=ghost-page` | 1 | `FAIL src/workbench/guard/page-registry.ts:143 G3 字面量已登记：demo.ghost-page：src/plugins/demo.kitchen-sink/pages/SandboxPage.vue:24` |
| G4 `host-boundary` | `--self-test=direct-window` | 1 | `FAIL src/workbench/guard/host-boundary.ts:63 G4 直连已登记：src/plugins/demo.kitchen-sink/settings/DemoSettingsSection.vue:1：window.workbench.files.openScript(...)` |
| G5 `core-coverage` | `--self-test=uncovered-module` | 1 | `FAIL src/workbench/guard/core-coverage.ts:49 G5 模块已覆盖或豁免：phantom：无 verify 映射且未豁免` |
| G6 `exemptions-guard` | `--self-test=empty-reason` | 1 | `FAIL src/workbench/guard/exemptions-guard.ts:44 G6 理由非空：G1: demo.tmp — 自测条目：""` |

- CI：仅做 YAML 解析（11 步、`on: pull_request/workflow_dispatch`、`windows-latest` 合法），**未真跑**；原因见 §5（禁止 push、无 PR、无 `gh`、无 `act`/Docker）。
- 集成备注：`verify.ts` 的“渲染层不直接用 node fs/path”会扫描整个 `src/workbench/**`；守卫与 `testenv.ts` 是 node 侧工具，使用 bare `fs` 并在文件头写明原因，避免被该断言误伤（`verify.ts` 本轮不在可改范围）。

