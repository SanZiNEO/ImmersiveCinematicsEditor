# 01.04 — ScriptMetaPanel（PropertyPanel 迁移）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

## 目标与类归属

前置 01.01–03；C01/C02/C04。现有 `EDITOR:src/components/PropertyPanel.vue` 承载脚本属性；拟以 `ScriptMetaPanel` 明确职责，不与片段效果面板混合。`MetaDraftPolicy`（提案）只处理新建草稿和提交约束。02 接标准文档，03 接真实校验，不能保留旧 meta 模型等待以后迁移。

## 必读证据

- `J:script/schema/MetaSchemas.java — all（17–47）`：全部常规 meta 字段。
- `J:script/ScriptParser.java — parseMeta（193–297）`：id/name/author 硬要求、宏观循环、play_mode、skip_vote_ratio、trigger_poll_interval。
- `J:script/ScriptValidator.java — validate（108–124）`；`EDITOR:src/types.ts — ScriptMeta（63–99）` 的旧字段。

## 输入输出与逐组工作

输入：meta 标准文档视图、schema、编辑命令端口；输出：单次字段事务/错误路径，不输出完整旧默认模板。

| 分组 | 必须覆盖的字段与约束 |
|---|---|
| 身份 | id/name/author/description；id 匹配 `^[a-zA-Z0-9_]{1,32}$`，name 最长50、author最长30（以 parser UTF-16 口径）；author 即使为空也保留字符串 |
| 环境 | dimension、base_resolution.w/h（正整数、未写=1920×1080）、listener=player/camera；base_resolution 是编辑标尺基准不是预览输出分辨率 |
| 输入/游戏 | block_keyboard/block_mouse/block_mob_ai/pause_when_game_paused；解释对实际播放的影响，不冒充编辑器 UI 输入设置 |
| 播放关系 | priority、play_mode=parallel/exclusive/interruptible、interruptible；同脚本再次触发与跨脚本关系分开说明 |
| 结束与跳过 | skippable、hold_at_end、skip_vote_ratio；缺省 ratio 回落全局配置，显式为整数10–100，不使用0代表关闭 |
| 宏观循环 | macro_loop/macro_loop_count/macro_loop_mode；-1无限，正数有效，0不在 UI 生成；repeat/pingpong，不混入 clip.loop |
| 触发配置入口 | triggers 与 trigger_poll_interval；后者 tick 1–600，前者跳转11轮专用行为页，不在通用 meta 表单临时编辑任意 JSON |
| 屏幕层入口 | screen_layers → 01.05；旧 hide_* / suppress_* / render_player_model 不能继续输出 |

## 实施步骤与禁止项

先逐字段对照当前 PropertyPanel，再迁移默认/编辑路径；清理 meta.version 与已删除屏幕开关的类型、表单和中英翻译。新建最小文档必须具备 parser 要求的 id/name/author；不要因为元数据 required=false 在精简时删除 author。每次改 meta 不应重新填满所有对象的默认值。

WebUI 与 Forge 使用同一字段组和规则；不同壳可折叠分组，不可遗漏参数。不能自行改 parser 来迁就前端，也不以 meta.id 的格式推断文件夹路径。

## 验收与完成定义

正常：创建作者为空的最小草稿，修改播放关系和循环后保留全部值；02/03接通后保存重载、真实 validate/parse 成功。边界：最长名称/空 author、未指定 ratio、无限循环、base_resolution 未写与自定义。失败：非法 id、ratio=0/10.5、循环0、分辨率0，显示正确字段路径且取消不改文档。缺失 author 的导入脚本须报错或明确修复确认，不悄悄假装已合法。meta 每个字段均归位、旧开关无调用方后才完成。
