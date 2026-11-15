# 03-06 校验分层

## 目标

校验分两层，各管各的：本地只查「文档结构对不对」，语义以服务端 `script.validate` 为权威。字段声明本身是否合法（`min<=max`、`enum` 默认值、`requires` 环）由 02-08 自检；本文件只管文档结构。

## 两层

| 层 | 做什么 | 不做什么 |
|---|---|---|
| 本地结构检查（同步） | 路径存在、成员白名单、形态、时间递增、端点相邻、`requires` 告警、切换点三轴对齐 | 不判语义、不判世界状态、不复刻 parser |
| 服务端 `script.validate`（异步） | 权威 issue 列表 | — |

## 四级 severity

| 级别 | 含义 | 保存 |
|---|---|---|
| `block` | **parser 会拒绝**（`ScriptParser` / `ObjectParser` 抛错），文件无法加载 | 阻止保存 |
| `error` | `script.validate` 报错级但 parser 接受（脚本能播，`ok:false`） | 只提示，诊断面板置顶 |
| `warn` | `[警告] ` 级 | 只提示 |
| `info` | 编辑器自己提示（轴外帧、近似值） | 只提示 |

## 本地结构检查清单（封闭集合 L01–L34）

必须逐条对齐运行时，这里列关键的几类：

- **L02/L04 键白名单**：`meta` 键 ∈ `META_KEYS`（21 个 schema 字段 + `triggers` + `trigger_poll_interval`），`timeline` 键 ∈ `{tracks, loop_start, loop_end}`。目录外键一律 `block`。
- **L06/L07 片段键**：内联片段必须有 `start_time`、`duration≠0`；独立片段无 `start_time`、有 `track`。
- **L10/L11 属性形态**：只允许 `value`/`keyframes`；`mode=value` 无 keyframes；`mode=event` 非空 keyframes。
- **L12 值类型**：9 种严格转换，非有限数拒绝。
- **L14 关键帧**：`{time,value}` 外无其他键；`time` 有限、≥0、严格递增。
- **L24 切换对齐**：`position_space` 在 `t` 切换，则 `t` 必须有 `position.x/y/z` **三轴**关键帧。
- **L28 路径端点**：`paths[].from/to` 命中目标片段 position 节点时间且相邻。
- **L34 根未知键**：`info`（运行时忽略，服务端不报）。

**校验边界**：片段重叠检查、CAMERA 至少一帧检查都不进入 L01–L34。

## 服务端桥

- 消息形状 `{ok, issues}`。注意 `ok` 只表示「没有非警告 issue」，编辑器必须同时看 `issues`，不能只看 `ok`。
- 防抖：编辑停止 400ms 发一次；每次 commit 取消上次未发请求。
- 失败（断连）：保留上次 issue，标注「已过期」。
- 服务端 issue 定位到 `clipKey + objectPath + keyframeTime` 是**尽力而为**：能解析就定位，解析失败只显示原文 + 复制按钮，不猜、不跳错位置。

## 验收标准

- 合法 CAMERA 片段 → 本地检查空 + `script.validate` `ok:true`。
- `meta.version:3` → `block`，定位 `jsonPath='meta.version'`。
- `position_space` 在 `t=2` 切换但只补 `position.x` 帧 → 报错并指出「还缺 position.y、position.z」。
- `paths[0].to` 不与 `from` 相邻 → `block`。
- `position_mode=absolute` + `position_space=base` → `error`（parser 接受，validator 报错），不阻断保存。
- 片段重叠 → 无 issue（本地不查，服务端也不查）。
- 本地检查与 `script.validate` 在「是否报错」上一致（文案可不同）。
- 字段声明类错误（`min>max`、`enum` 空）不出现本轮 issue 列表——它们在 02-08 的目录自检里，不混进文档检查。
