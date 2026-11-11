# 12-05 脚本级模板（meta / 触发器骨架 / 默认转场）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案）。
> 轮次：12-templates-flight-tools。前置：12-01、12-02、12-04；字段契约：01（meta/triggers）、11（触发器语义）、08（默认转场）。

## 1. 职责

生成「一整份脚本的骨架」：`meta` 的常用组合、`triggers` 骨架、轨道与片段的初始编排。它是**新建文档**与「从模板起手」的唯一入口，替代旧 `script.new` 骨架。

## 2. 现状（现有文件 + 符号 + 行）

| 位置 | 事实 |
|---|---|
| `MOD:J:script/ScriptTemplate.java:36–70` | 服务端骨架：meta 取 `SchemaRegistry.getMetaFields()` 默认值，轨道遍历 `TrackRegistry.builtinIds()` 建空轨，`generateTrackId` 生成 `{type小写}_{n}` |
| `MOD:J:webui/ScriptFileService.java:80–82` | `newScriptJson()` 转发 `ScriptTemplate.newScriptJson()` |
| `MOD:J:webui/WebEditorApi.java:216–221` | `script.new` → `ScriptFileService.newScriptJson()` |
| `EDITOR:src/store.ts:422–447` | 编辑器 `newScript()` 调 `script.new`，再 `bootstrapScript(doc)`（766–820 一带）写旧格式 CAMERA+LETTERBOX |
| `EDITOR:src/store.ts:766–800` | `bootstrapScript`：`addTrack`、`addClip`、`fillClipDefaults`、`kf.position={dx,dy,dz}`、`clip.transition='cut'`（旧模型） |
| `MOD:docs/SCRIPT_FORMAT.md:21–88` | meta 全字段（`screen_layers`、`play_mode`、`macro_loop*`、`triggers[]`、`continuity`） |
| `MOD:docs/SCRIPT_FORMAT.md:70–88` | `triggers[]` 字段：`id/type/repeatable/delay/conditions/continuity` |

## 3. 拟新建（提案）

| 文件 | 导出 | 说明 |
|---|---|---|
| `EDITOR:src/templates/script/blank.ts` | `blankScriptTemplate` | 空脚本（meta 默认 + 七轨空轨） |
| `EDITOR:src/templates/script/cameraIntro.ts` | `cameraIntroTemplate` | 「相机 + 遮幅 + 可选黑场」起手式 |
| `EDITOR:src/templates/script/followBlack.ts` | `followBlackTemplate` | 「跟随+看向 N 秒后黑场退出」完整示例 |
| `EDITOR:src/templates/script/metaPresets.ts` | `META_PRESETS` | meta 组合预设（过场/剧情/自由观察） |

## 4. 参数表与展开

### 4.1 `script.blank`

无参数。展开：

- `meta`：只写**非默认**字段（`id`、`name`、`author:""`）。`author` 必须写（parser 实际要求字符串，见 `plan/shared/baseline-and-evidence.md` 的冲突表）。
- `timeline.tracks`：七类内置轨道各一条空轨（`CAMERA/LETTERBOX/AUDIO/EVENT/MOD_EVENT/OVERLAY/ADJUST`），`id` 按 `{type小写}_{n}`。
- 不写 `meta.version`、不写 `timeline.total_duration`、不写 `triggers`（空数组可省略）。

### 4.2 `script.camera_intro`

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `id` / `name` | string | `untitled` / `新脚本` | 脚本身份 |
| `duration` | float | 10 | 相机片段时长 |
| `position` | position(absolute) | `{x:0,y:64,z:0}` | 初始机位 |
| `fov` | float | 70 | — |
| `letterbox` | float | 2.35 | 遮幅比例；0 = 不加遮幅 |
| `black_fade` | float | 0 | 片头黑场时长；0 = 不加 |

展开：CAMERA 片段（`12-03` 的 `static_breath` 以 `breath=none` 调用）+ LETTERBOX 片段（`aspect_ratio` 常量）+ 可选 OVERLAY fade（`12-03` 的 `fade` 以 `mode=in` 调用，起点 0、时长 `black_fade`）。

### 4.3 `script.follow_black`

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `id` / `name` | string | `follow_black` / 跟随黑场 | — |
| `duration` | float | 30 | 总时长 |
| `selector` | selector | `@p` | 跟随/注视目标 |
| `distance` | float | 6 | 跟随距离（沿视线后退） |
| `height` | float | 2 | 高度偏移 |
| `look_height` | float | 1.6 | 注视点高度（实体脚部以上） |
| `trigger` | enum | `none` | `none`/`login`/`biome`（生成触发器骨架） |
| `biome` | string | `*` | `trigger=biome` 时使用 |

展开：

- CAMERA 片段：`position_mode:{value:"relative"}`、`position_space:{value:"base"}`、`position_origin:{value:"<selector>"}`、`position_origin_freeze:{value:false}`（= 跟随实体）、`position.x/y/z` 常量 = 相对偏移；`look_at:{value:"entity"}` + `look_at_selector` + `look_at_offset.y` = `look_height`。
  > 具体字段组合以 07 的点源契约为准；本模板只负责「选哪组值」，不重新定义语义。
- OVERLAY fade 片段：`duration` 最后 2s，`opacity` 1→0→1（黑场后结束）。
- `trigger=login` → `triggers:[{id:"trg_login", type:"login", repeatable:false, delay:0, conditions:{}}]`；`biome` → `conditions:{biome:"<biome>"}`。
- 不生成 `rules/rule_bindings`（规则编排归 11；模板只在参数 `withRule` 打开时生成一个最小绑定骨架，缺省关闭）。

## 5. 修改步骤

1. 新建 `metaPresets.ts`：三组 meta 组合（`cutscene`/`gameplay`/`freecam`），每组只列与默认不同的字段。
2. 新建 `blank.ts`：轨道列表来自 01 的 schema（`tracks` 键），不写死七类（第三方轨道也能建）。
3. 新建 `cameraIntro.ts` / `followBlack.ts`，通过 `refs` 复用片段级模板。
4. 在 `12-06` 的「新建」流程里接 `script.blank`；`02` 提供「按片段构造空文档」后，`script.new` 的调用链删除（本轮只切到模板路径）。
5. 删除 `store.ts:766–820` 的 `bootstrapScript`（旧格式引导内容），其默认值迁入 `camera_intro` 的参数默认。
6. i18n：每个模板 + 每个参数 + 每个 meta 预设各一组 key。

## 6. 禁止修改

- 不改 `ScriptTemplate.java` / `ScriptFileService` / `WebEditorApi`（主模组本轮不可改）。
- 不写 `meta.version`、`timeline.total_duration`、`hide_*`/`suppress_*`（已由 `screen_layers` 取代）。
- 不生成空 `triggers: []`（可省略就省略）。
- 不实现触发器语义（11）；模板只写骨架字段。
- 不生成规则/绑定的完整内容（除最小骨架且默认关闭）。

## 7. 两分支承载

同一份展开逻辑。游戏内新建脚本走同一模板路径（不依赖 `script.new`）；若 03 的宿主端口尚未提供「保存新文档」，模板面板显示「未连接，无法新建」而不是本地伪造。

## 8. 前置

01 的 meta/triggers schema 与 `screen_layers` 键域；02 的空文档构造与保存；07 的点源字段；11 的触发器字段；08 的遮幅/转场字段。

## 9. 验收

**正例**

1. `script.blank` 生成：七轨空轨、`meta.author=""`、无 `version`/`total_duration`；`script.validate` 通过。
2. `script.camera_intro` 默认：CAMERA 10s + LETTERBOX 2.35；无黑场；播放显示遮幅。
3. `black_fade=2`：多一个 OVERLAY fade 片段（0–2s），`opacity` 0→1。
4. `script.follow_black` `trigger=biome, biome=minecraft:plains`：`triggers[0].conditions.biome` 正确；播放时相机跟随玩家、看向玩家。
5. 第三方轨道注册后（若 01 支持），`blank` 也建该轨道空轨。

**反例**

1. 产物含 `hide_hud`/`screen_layer_mode` → 不通过。
2. 产物含 `triggers: []` 空数组 → 不通过（无意义键）。
3. 生成 `total_duration` → 不通过。
4. 未连接时用本地骨架假装新建成功 → 不通过。

**真实冒烟**：三种脚本级模板各生成一次 → 保存 → 重开 → 游戏内播放；`follow_black` 需在游戏内确认跟随与黑场时序。

## 10. 完成定义

- 三种脚本级模板落地；`blank` 是新建文档的唯一路径。
- `bootstrapScript` 与 `script.new` 依赖在编辑器侧断开。
- 产物零废弃字段，`script.validate` 通过。
- meta 预设与触发器骨架有中英文案与帮助文本。
