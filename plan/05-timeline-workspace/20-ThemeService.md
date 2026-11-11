# 05.20 — ThemeService / ThemeSettingsPanel（拟新增）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

## 唯一目标与前置

01 schema/02会话合同、05工作区容器。正式必做：深色、浅色、跟随系统，重启保留；不修改脚本、调色或游戏预览内容。建议新增 src/core/application/ThemeService.ts 与 ThemeSettingsPanel.vue，具体物理承载服从03宿主能力结论。

## 必读引用

EDITOR:src/App.vue — 布局模板（319–392）、components/DynamicForm.vue — 硬编码色样例（99–142）；electron/main.cjs — backgroundColor（22–36）。另读 shared/art-direction、application-and-integration 与05 README。先搜索所有现有主题/样式入口，不能猜已有 ThemeService。

参考[工作台/偏好/宿主适配](../references/03-workspace-preferences-host.md)的主题证据与反例：只借鉴palette/token、首屏应用与明确模式分离。参考入口的手动深浅色不能充当本任务system模式的实现；系统通知要由本宿主真实提供，换主题不重建文档或画面流。

## 输入输出与类级步骤

- ThemeService：输入 mode=dark/light/system 和系统主题通知；输出已解析 token 集、当前主题来源、持久化偏好。token 仅包含受控的界面色/字体密度值，不允许执行脚本或加载任意外部CSS。
- ThemeSettingsPanel：展示三种模式、即时预览与重置；输出偏好命令，不写state.doc。
- 迁移现有硬编码界面颜色到统一tokens；保留轨道类别/错误/选中等语义差异，避免把全部图表变成同色。弹层、工具提示、图/主时间轴/效果控件/表单/标题栏均覆盖。
- system模式订阅/卸载通知幂等；用户明确选light/dark时不被系统变化覆盖。启动先应用偏好再显示界面，避免白屏闪烁。
- 如果AUI不能读取系统主题，明确宿主能力并以用户手选为准，不伪造系统事件；两平台仍用相同token语义。

## 验收与完成定义

实际桌面依次切换三模式、系统主题变化、重启、重置；所有面板/图/弹层均无残留旧色，中文标签/禁用/焦点有足够辨识。确认游戏预览像素、脚本文档和脏标记不因换主题改变。坏偏好恢复默认并给非阻塞提示；主题切换不重建文档/连接。dark/light均做真实视觉验收，不能只检查class名。
