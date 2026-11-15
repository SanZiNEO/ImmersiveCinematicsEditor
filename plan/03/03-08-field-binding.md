# 03-08 字段目录接入与绑定

## 目标

把 02 的字段目录接进 03 的文档模型：打开文档时怎么绑定、编辑时怎么查字段、目录变了怎么办。**本轮只定义接线，不重列字段表、不做声明自检。**

## 输入

02 提供只读的 `FieldCatalog`：

- `meta(key)` — 21 个 meta 字段。
- `track(trackType)` — `playControl` 5 字段 + `objects` 表。
- `objectDef(trackType, path)` — 一个叶子的完整声明（16 项）。
- `trigger(type)` / `triggerField(key)` — 27 种触发器与 `id` / `continuity`。
- `model(type)` / `curveType(type)` — 模型与曲线参数。
- `scriptSection(section)` — clips / rules / rule_bindings / paths。
- `catalogHash` — 目录版本指纹。

02 已给出查询实现（02-02）与 objects 表（02-04）。03 不建第二份表。

## 绑定规则

### 轨道类型

- `timeline.tracks[].type` 必须是 02 `track()` 认识的类型（7 个内置 + 第三方 `modid:xxx`）。
- 认识 → 绑定该轨的 `playControl` 与 `objects`。
- 不认识 → 文档仍打开，该轨标「只读 / 未知轨道」，字段不解释、不猜、不删；保存时原样写回。

### 对象路径

- 每个 `objects` 键必须是 `objectDef(trackType, path)` 命中的路径。
- 命中 → 按 `mode` / `type` / `interp` / `min` / `max` / `enumValues` / `nullable` / `default` 绑定。
- 未命中 → 本地 `block`，定位到 `clipKey + path`，保留原值不删。
- 路径语法统一由 02-02 给出；03 不另写正则。

### 值

- 读取：按 `type` 走 03-02 的严格转换；`min` / `max` / `enumValues` / `nullable` 从绑定的 `objectDef` 取。
- 写入：只写 `value` 或 `keyframes`，不写字段声明、不写默认值副本。
- `requires` / `appliesTo`：由 02-04 的 `availability()` 求值；03 只消费结果（置灰/提示），不重写求值逻辑。

### 非对象段

- `meta` 走 02-03；`triggers` 走 02-05；`rules` / `rule_bindings` / `paths` 走 02-07。
- 03 只负责把这些字段装进文档、序列化、校验结构；字段含义与取值范围不在这里解释。

## 目录变化

| 场景 | 处理 |
|---|---|
| 打开时 `schema.get` 与本地目录一致 | 正常绑定，记录 `catalogHash` |
| 打开时发现新增字段 | 新字段可显示、可编辑；既有文档不自动补值 |
| 打开时发现字段缺失 | 文档里该路径标「当前 schema 不认识」，保留原值，不静默删 |
| 字段 `type` / `enum` / `min/max` 变了 | 重绑；已有值重新按新约束检查，越界/非法标 issue，不自动夹取、不自动转换 |
| 切换游戏实例 | 重新 `schema.get`，重建 `catalogHash`；不把上一个实例的目录缓存当权威 |
| 离线 | 用带来源的离线快照；快照只读，缺失字段标「未对账」 |

**绝不因为目录变化改写作者的值。** 目录是解释器，不是迁移器。

## 版本钉住

- 文档打开时记录 `catalogHash`。
- 保存时若 `catalogHash` 与当前绑定不一致 → 先重绑、再校验、再保存；不一致且无法重绑 → 阻止保存并给清单。
- 不把 `catalogHash` 写进脚本 JSON；它是编辑器会话状态，不是运行时字段。

## 验收标准

- 打开一份 CAMERA 文档，`position.x/y/z` 分别绑定到 02-04 的三条独立 `ObjectDef`，不是嵌套对象。
- 文档里出现 `objects` 未登记路径：`block`，定位到片段 + 路径，原值保留。
- 第三方轨道 `modid:foo`：能打开、能原样保存；字段不解释，不报「未知字段」。
- 同一文档在两次 `schema.get` 之间字段 `enum` 变化：已有值若不在新枚举内 → issue；保存不被静默改成新枚举第一项。
- `grep` 编辑器源码：字段声明只出现在 02 目录模块，文档模型里 0 处硬编码 `enumValues` / `min` / `max`。
- 切换游戏实例后打开既有文档：`catalogHash` 不同，重绑成功则正常；失败则阻止保存并列出对不上的字段。
