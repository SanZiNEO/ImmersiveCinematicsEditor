# 02-03 meta 字段表与 screen_layers 键域

## 目标

登记 `meta` 段的 21 个 `MetaSchemas` 字段 + 2 个仅解析期键，并把 `screen_layers` 这个「对象里再带键域」的特例单独写清。字段来源：`MetaSchemas.all()`（17–48）；`base_resolution` 的解析在 `ScriptParser.parseBaseResolution`（1269–1290，`positiveIntComponent` 1293–1300）；`triggers` / `trigger_poll_interval` 在 `ScriptParser.metaKeys()`（76–81）。

## 21 个 `MetaSchemas` 字段 + 2 个解析期键

| 字段 | type | default | required | enum / 范围 | section |
|---|---|---|---|---|---|
| `id` | string | `"untitled"` | true | `^[a-zA-Z0-9_]{1,32}$` | info |
| `name` | string | `"Untitled"` | true | ≤50 字符 | info |
| `author` | string | `""` | false | ≤30 字符（校验器） | info |
| `description` | string | `""` | false | — | info |
| `dimension` | string | `""` | false | — | info |
| `base_resolution` | object | null（运行时回落 `1920×1080`） | false | `{w,h}` 正整数，`1~Integer.MAX_VALUE` | info |
| `listener` | enum | `"player"` | false | `player` / `camera` | runtime |
| `block_keyboard` | bool | `true` | false | — | runtime |
| `block_mouse` | bool | `true` | false | — | runtime |
| `block_mob_ai` | bool | `false` | false | — | runtime |
| `pause_when_game_paused` | bool | `true` | false | — | runtime |
| `interruptible` | bool | `true` | false | — | runtime |
| `play_mode` | enum | `"parallel"` | false | `parallel` / `exclusive` / `interruptible` | runtime |
| `skippable` | bool | `true` | false | — | runtime |
| `hold_at_end` | bool | `false` | false | — | runtime |
| `macro_loop` | bool | `false` | false | — | runtime |
| `macro_loop_count` | int | `-1` | false | — | runtime |
| `macro_loop_mode` | enum | `"repeat"` | false | `repeat` / `pingpong` | runtime |
| `screen_layers` | object | null | false | 见下节 | runtime |
| `priority` | int | `0` | false | — | runtime |
| `skip_vote_ratio` | int | null | false | 10 ~ 100 | runtime |
| `triggers` | array | `[]` | false | 元素形状见 02-05 | parse-only |
| `trigger_poll_interval` | int | null | false | 1 ~ 600 tick | parse-only |

`skip_vote_ratio` 超出 10~100 或非整数 → parser 报错，不是夹取。

`triggers` / `trigger_poll_interval` 不在 `MetaSchemas.all()` 里，但 `ScriptParser.META_KEYS` 明确允许（`ScriptParser.java:76-81`）。它们只参与解析期声明，不进运行行为字段表。

## `base_resolution`

- 形状必须是 `{w,h}`，两个正整数，范围 `1 ~ Integer.MAX_VALUE`。
- 校验器（`ScriptValidator.checkBaseResolution`，1915–1925；分量 `checkBaseResolutionComponent` 1928–1947）：缺 `w` / `h`、0、负数、非整数、非对象 → 报错，脚本被拒。
- 解析器（`ScriptParser.parseBaseResolution`，1269–1290）：非法 → 告警 + 回落 `1920×1080`，不阻断加载。两者口径不同，编辑器校验按 `block` / `warn` 分层处理。
- 缺省 / `null` → `1920×1080`（`ScriptMeta.DEFAULT_BASE_WIDTH/HEIGHT`）。
- 不是 `Vec3`、不是 `{x,y,z}`、不接受数组。
- 编辑器只按 02 目录的 `object` 类型解释，不引入 MC 向量类。

## `triggers` 与 `trigger_poll_interval`

- `triggers`：array，默认 `[]`；每个元素是一个触发器定义，字段表见 02-05（`type` / `id` / `conditions` / `repeatable` / `delay` / `on_enter` / `exit_buffer` / `requires` / `poll_interval` / `continuity`）。
- `trigger_poll_interval`：int，默认 null（未写）；范围 1~600 tick（`TriggerType.POLL_INTERVAL_MIN/MAX`）。
- 回退链：触发器级 `poll_interval` → 脚本级 `meta.trigger_poll_interval` → 类型级默认；事件驱动类型不参与轮询（恒 0）。
- 解析器对非法值：告警 + null（回落到下一级）；校验器：报 issue。不夹取。

## `screen_layers` 键域

`screen_layers` 在 schema 里是 `object`，`FieldDef` 不描述内层键。内层键域由 `ScreenLayer` + `HudLayerRegistry` 定义，目录必须单独登记。

### 15 个规范层名

| 常量 | wire 键 | 空间 |
|---|---|---|
| `HUD_HOTBAR` | `hud.hotbar` | HUD |
| `HUD_CROSSHAIR` | `hud.crosshair` | HUD |
| `HUD_HEALTH` | `hud.health` | HUD |
| `HUD_EXPERIENCE` | `hud.experience` | HUD |
| `HUD_BOSSBAR` | `hud.bossbar` | HUD |
| `HUD_CHAT` | `hud.chat` | HUD |
| `HUD_SCOREBOARD` | `hud.scoreboard` | HUD |
| `HUD_ACTION_BAR` | `hud.action_bar` | HUD |
| `HUD_TITLE` | `hud.title` | HUD |
| `HUD_SUBTITLE` | `hud.subtitle` | HUD |
| `HUD_SKIP_PROMPT` | `hud.skip_prompt` | HUD |
| `VIEWMODEL` | `viewmodel` | WORLD |
| `VIEW_BOBBING` | `view_bobbing` | VIEW |
| `SCREEN_EFFECTS` | `screen_effects` | POST |
| `PLAYER_MODEL` | `player_model` | WORLD |

### 动态键

- 键 = 已注册的 HUD 分类名，或未注册 overlay 的资源 ID。
- 注册发生在客户端初始化期；目录只登记「这是一个动态键域」，不把运行时注册表抄成静态 15 条。
- 未声明的键一律隐藏；没有别名、没有回退链、没有 `hud.*` 前缀猜测。
- 值只接受 bool：`true` = 显示，`false` = 隐藏。字符串、数字、对象一律拒绝。
- 缺 `screen_layers` 或缺某个键 → 该层按隐藏处理，不补默认 `true`。

## 显示状态

02 只登记**键域、空间与极性**（true/false）：`screenLayers.fixed` 是 15 个规范层名，`screenLayers.spaces` 是每层的 `HUD` / `WORLD` / `VIEW` / `POST`，`screenLayers.valueType` 固定 `bool`，`screenLayers.dynamic` 固定 `true`；显示状态不在字段目录里，由面板控件按字段值决定。

## 验收标准

- `meta` 段 21 条 `MetaSchemas` 字段 + 2 条解析期键，共 23 个合法键；`meta('skip_vote_ratio')` 返回 `{type:'int', min:10, max:100}`。
- `meta('base_resolution')` 返回 `object`；`{w:1920,h:1080}` 通过；`{x:0,y:64,z:-64}`、`{w:0,h:1080}`、`{w:'1920',h:1080}` 校验器拒绝，解析器告警并回落 `1920×1080`。
- `meta('triggers')` 返回 `array`，元素字段指向 02-05；`meta('trigger_poll_interval')` 返回 `{type:'int', min:1, max:600}`。
- `trigger_poll_interval:0` / `601` / `2.5`：解析器告警 + null，校验器报 issue。
- `meta` 里出现 `triggers` / `trigger_poll_interval` 以外的未知键：拒绝（`META_KEYS` 是封闭集）。
- `screen_layers` 的 15 个规范键逐条命中；动态键 `modid:custom_overlay` 作为键域可接受。
- `screen_layers:{"hud.hotbar":false}` 隐藏；`{"hud.hotbar":1}` 拒绝；未知键不显示、不报「未知字段」。
- `play_mode` 只接受 `parallel` / `exclusive` / `interruptible`；`listener` 只接受 `player` / `camera`。
- 目录只登记键域与极性；没有三态枚举值。
