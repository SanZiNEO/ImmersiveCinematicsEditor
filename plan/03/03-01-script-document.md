# 03-01 脚本文档顶层模型

## 目标

定义编辑器的根文档 `ScriptDoc`：有哪些键、哪些必填、哪些互斥、遇到不认识的键怎么办。文档形状必须和运行时解析器接受的 JSON 完全一致。字段名、类型、枚举从 02 字段目录取；本文件只定义结构。

## 文档形状

```text
ScriptDoc
  meta: { id, name, author, ... }          // 键集 = 02-03 的 23 个 meta 键（21 个 MetaSchemas 字段 + triggers + trigger_poll_interval）
  timeline:
    tracks: [{ type, clips: [...] }]        // 内联片段
    loop_start?, loop_end?
  clips?: [...]                             // 顶层独立片段
  paths?: [...]                             // 路径条目
  rules?: [...]                             // 规则
  rule_bindings?: [...]                     // 规则绑定
  authoring?: ...                           // 仅内存，不写盘
```

## 要做的改动

1. **顶层键集对齐运行时**。四类集合（`clips` / `paths` / `rules` / `rule_bindings`）和 `timeline` 并列，不塞进 `timeline` 或 `clip`（运行时就是从根对象读的，`ScriptParser.parseInternal`）。
2. **时间线不存总时长**。有限末端按需派生（见 03-05）。
3. **内联片段 vs 独立片段**：
   - 内联片段：在 `timeline.tracks[].clips[]`，必填 `start_time`，禁止 `track`。
   - 独立片段：在顶层 `clips[]`，禁止 `start_time`，必填 `track`（解析器据此选 schema）。
   - 两者共用同一 `DocClip` 结构。
4. **未知键策略**（分位置，不能一刀切）：
   - 根对象：保留原文 + 警告（运行时无根白名单，删了会毁掉作者的外部工具数据）。
   - `meta` / `timeline` / `clip`：拒绝（运行时 `rejectUnknownFields` / `CLIP_KEYS` 直接抛错）。
   - 属性对象：只允许 `value` / `keyframes`（`ObjectParser.parseProperty`）。
5. **集合顺序**：数组顺序 = 作者顺序，不排序、不分组。

## 关键字段约束（来自源码）

| 字段 | 约束 |
|---|---|
| `meta.id` | `^[a-zA-Z0-9_]{1,32}$`，必填 |
| `meta.name` | 必填，≤50 字符 |
| `meta.author` | 必填字符串（schema 标 optional 但 parser 要求） |
| `clip.start_time` | 内联必填有限数字；独立片段出现即报错 |
| `clip.duration` | `!= 0`；正数有限，负数无限 |
| `clip.id` | 可缺省；存在则匹配 `^[A-Za-z0-9_]{1,64}$` 且脚本内唯一 |
| `clip.track` | 仅独立片段必填，写盘必须存在 |

完整字段表见 02-03（meta）与 02-04（tracks），本节只列与文档形状直接相关的约束。

## 验收标准

- 打开一个含 `meta` / 内联片段 / 独立片段 / `paths[]` / `rules[]` / `rule_bindings[]` 的真实脚本，保存后逐字段对比通过。
- 保存内容只包含 02 字段目录里的键；目录外键按 03-06 分层处理。
- 根对象多一个 `x_custom` 键：打开不报错、编辑不丢、保存仍在（警告「运行时忽略」）。
- `meta` 里多一个目录外键：打开即报阻断错误，保留原文件，不自动删键。
- 独立片段写了 `start_time`：本地结构检查报错（`parseStandaloneClips` 会抛）。
