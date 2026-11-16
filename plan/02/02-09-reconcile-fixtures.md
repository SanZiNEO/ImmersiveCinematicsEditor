# 02-09 schema.get 对账、离线快照与夹具

## 目标

解决三件事：连接真实游戏实例时怎么用 `schema.get` 对账、断网时怎么用离线快照、用什么夹具证明目录与 parser/validator 对得上。**对账不改目录、不改文档；快照只读；夹具是验收材料，不是运行时数据。**

## `schema.get` 对账

连接建立后拉一次 `schema.get`，拿到六段数据，与本地目录逐段比对：

| 差异 | 记录 | 处理 |
|---|---|---|
| 本地有、远端无 | `missing` | 标「当前实例不提供」，不删本地字段 |
| 远端有、本地无 | `added` | 标「新字段」，可显示、可编辑；既有文档不自动补值 |
| `type` 不同 | `typeChanged` | 重绑；已有值按新类型重新检查，不自动转换 |
| `enumValues` 不同 | `enumChanged` | 已有值不在新枚举 → issue；不自动改成第一项 |
| `default` 不同 | `defaultChanged` | 只影响新建；既有文档不重写 |
| `min` / `max` 不同 | `rangeChanged` | 已有值越界 → issue；不自动夹取 |
| `requires` / `appliesTo` 不同 | `dependencyChanged` | 重算 availability；不删字段、不删帧 |
| 段缺失 / 整段为空 | `segmentMissing` | 该段标「未对账」，不用空段覆盖本地 |

对账产物是一份 `DriftReport`：

```text
DriftReport
  catalogHashLocal
  catalogHashRemote
  gameVersion / modVersion / capturedAt
  entries: [{segment, scope, key, kind, local?, remote?, sourceRef}]
```

- 报告只读，展示在诊断里；不自动「修复」目录。
- 远端 schema 是**对账数据**，不是目录生成源；本地目录仍以 02-01 的源码登记为准。
- 同一会话内不重复拉；切换游戏实例 / 重连才重新拉。
- 不把上一个实例的 `catalogHash` 当成本实例的权威。

## 离线快照

断网 / 没有游戏实例时，用离线快照让编辑器仍能打开文档：

- 快照必须带来源：`gameVersion` / `modVersion` / `capturedAt` / `catalogHash` / 采集人（可选）。
- 快照只读；不因为「在线 schema 多了字段」就自动覆盖快照。
- 快照里没有的字段 → 标「未对账」，不猜、不补。
- 快照与本地目录冲突 → 以本地目录为准，快照只做参考；冲突写进 `DriftReport`。
- 快照不参与构建期代码生成，不引入 MC 类。

快照的存放：编辑器仓库 `src/core/schema/fixtures/__snapshots__/`（现有默认离线快照仍是 `fixtures/snapshot.json`），一个实例一份，文件名 `snapshot-<gameVersion>-<modVersion>-<YYYYMMDD>.json`；由 `src/core/schema/snapshots.ts` 的 `saveSnapshot` 写入，同名已存在时依次让位 `-2`、`-3`，不覆盖既有快照。

## 夹具

夹具用来证明「目录 + parser/validator 对得上」，分三类，存放在 `src/core/schema/fixtures/scripts/`（`valid/` 6 条、`invalid/` 20 条）与 `src/core/schema/fixtures/reconcile/`（8 类对账）。

### 合法夹具（必须被接受）

- **objects 格式 demo**：一个 CAMERA 片段，`position.x` 在 `{0,3}` 两帧、`position.y` 在 `{0,3}` 两帧、`position.z` 在 `{0,3}` 两帧、`yaw` 在 `{1,2}` 两帧、`fov` 只有 `value`——三轴帧时间可以不同，不要求对齐。
- **VALUE 夹具**：`fov:70`、`position_mode:"relative"`、`position_space:"world"`，全部固定值，无 keyframes。
- **STEP 夹具**：`position_mode` / `position_space` / `look_at` 用 `step`，值切换不插值。
- **独立片段 + 规则 + 绑定 + 路径**：顶层 `clips[]`、`rules[]`、`rule_bindings[]`、`paths[]` 各一条，引用互相对得上。
- **七轨覆盖**：CAMERA / LETTERBOX / AUDIO / EVENT / MOD_EVENT / OVERLAY / ADJUST 各一个最小片段。
- **meta 覆盖**：23 个 meta 键各出现一次；`base_resolution {w:1920,h:1080}`；`screen_layers {"hud.hotbar":false}`；`skip_vote_ratio:50`。

### 非法夹具（必须被拒绝）

- `meta` 目录外键；`timeline` 目录外键。
- `mode:"value"` 带 keyframes；`mode:"event"` 空 keyframes。
- 关键帧时间相等 / 倒序 / 负数；`time` 非有限。
- `"90"` 给 float；`2.5` 给 int；`NaN`；`yaw_lock:null` 以外的 null。
- `position.x` 路径写成 `position[0]` / `Position.X`。
- `base_resolution:{w:0,h:1080}`、`{x:0,y:64,z:-64}`。
- `screen_layers:{"hud.hotbar":1}`、未知键被当成已知。
- `paths[0].from` 与 `to` 不相邻；`rule_bindings.rule` 指向不存在的规则。
- 未知 `geometry.type` / `timing.type` / `action_types`。

### 对账夹具

- 一份本地目录 + 一份人工构造的远端 `schema.get`（`fixtures/reconcile/remote-schema-8kinds.json`，含 `missing` / `added` / `typeChanged` / `enumChanged` / `defaultChanged` / `rangeChanged` / `dependencyChanged` / `segmentMissing` 8 类），由 `verify-reconcile.ts` 断言 `DriftReport` 条目齐全。
- 一份离线快照（带来源元数据，`fixtures/snapshot.json` 或 `fixtures/__snapshots__/` 下的多实例快照），断言断网时能打开文档、缺失字段标「未对账」。

## 验收标准

- 在线对账：`DriftReport` 覆盖上表 8 类差异；本地目录文件未被修改（对比 mtime/hash）。
- 远端多一个字段：文档能显示该字段；既有文档不被自动补值。
- 远端少一个字段：本地字段不删；文档里该路径仍可读，标「当前实例不提供」。
- 断网：用快照打开 CAMERA 文档成功；快照里没有的字段标「未对账」，不猜。
- 合法夹具逐条过真实 `ScriptParser` / `script.validate`，`ok:true`。**本轮未执行**：这两项需要带 `ImmersiveCinematics` 的游戏实例；夹具已按主模组源码构造，运行时验收留待有实例的环境执行。
- 非法夹具逐条 `block`，错误定位到 `clipKey + path + time`。**本轮未执行**：同上；`fixtures/scripts/invalid/` 已列出期望的 issue 关键字。
- 对账与快照断言由 `verify-reconcile.ts` 本地执行（8 类差异 + 同名快照不覆盖），不需要游戏实例。
- 夹具里没有 `Vec3`、没有 `export-schema.mjs` 产物、没有从快照反推的字段。
