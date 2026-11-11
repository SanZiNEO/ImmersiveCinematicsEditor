# 01.05 — ScreenLayerPolicyPanel（拟新增）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

## 前置、范围、引用

01.03/04；C01/C02。拟新增 `EDITOR:src/components/ScreenLayerPolicyPanel.vue` 和仅负责显示意图的 `ScreenLayerPolicyModel`。WebUI/Forge 共用键和值语义；真实 HUD 接管、动态层渲染仍属于主模组。

证据：`J:script/schema/MetaSchemas.java — all（41–42）`；`ScriptParser.parseMeta（244–253）`；`ScriptValidator.checkScreenLayers（1878–1903）`；`MOD:docs/SCRIPT_FORMAT.md（54–68）`。实施前还要读 `J:script/ScreenLayer.java` 与 `api/HudLayerRegistry.java` 以确认动态层查询能力，不能假设存在现成 listLayers 协议。

## 输入输出

输入 meta.screen_layers 的缺省或映射、可取得的动态层元数据、编辑命令。输出为增加/删除某键的事务、显式 true/false；不写 null，不发明 hide_hud。缺省/继承通过删键表示，并解释接管白名单规则，不能把继承标成一定显示。

## 逐类实现步骤

1. `ScreenLayerPolicyModel` 列出15个规范键：hud.hotbar、hud.crosshair、hud.health、hud.experience、hud.bossbar、hud.chat、hud.scoreboard、hud.action_bar、hud.title、hud.subtitle、hud.skip_prompt、viewmodel、view_bobbing、screen_effects、player_model。
2. `ScreenLayerPolicyPanel` 提供“未覆盖/显示/隐藏”三态视图，但写入值只有 bool 或删除键；明确 true=显示。
3. 同一面板分组显示动态注册分类与未知 overlay 完整资源 ID；能保留、搜索、移除已有未知键。没有动态查询接口时显示来源未知并由03定义受控前置，不能硬编码假列表。
4. 对任一隐藏将进入接管/白名单的后果给出简短预览说明；批量预设展示实际键差异，单次事务可撤销。
5. 删除旧 hide_*/suppress_* 的控件路由与调用，不更改播放器接管实现。

## 验收、真实冒烟与完成定义

检查无screen_layers、只写false、混合true/false、未知动态键和非法null的保存差异。未覆盖不制造bool；批量取消恢复原映射。本轮出口只要求03后分别在WebUI→Forge、WebUI→Fabric检查白名单、聊天、第三方层与真实预览，编辑器UI不进入捕获。游戏内Forge+AUI同项检查是14迁移要求，游戏内Fabric+AUI暂缓，均不阻塞本轮。全部规范/动态键处理完整、无语义反转或旧字段才完成。
