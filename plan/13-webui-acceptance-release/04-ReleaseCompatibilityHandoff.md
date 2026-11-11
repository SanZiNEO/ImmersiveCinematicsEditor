# 13.04 — WebUI 发布基线与AUI迁移交接

## 目标、前置、引用

13.01–03全部通过，WebUI功能已完整打磨。依据EDITOR:package.json（9–25）、electron/main.cjs（22–36）、MOD:gradle.properties（1–17），以及shared/editor-package-modes。输入实际WebUI构建/运行证据，输出可发布基线、限制说明和14迁移任务输入；本轮不发布游戏内附属jar，不要求AUI前置可用。

## 实施步骤

1. 发布注明编辑器版本、for主模组版本及WebUI→Forge/Fabric实际验证组合，列编码器/资源能力，不能以“最新版本”代替实证。
2. 核对前端生产构建和Electron包：无凭据、无机器绝对路径泄露、无临时脚手架；类型/行为检查用真实工程入口，Vite构建不代替运行。本次文档编写不执行构建。
3. 认证、外部字幕读取、文件夹/依赖写、偏好/草稿均最小权限，renderer不暴露任意fs/命令；token不进入sidecar/主题/最近项目/导出。
4. editor统一包与总开关覆盖当前WebUI资源/按键/服务，ingame未实现时能力明确不可用；不创建空适配器或启动AUI。关闭只释放编辑器拥有资源，普通脚本播放不受影响。
5. 删除旧字段/旧左栏/整帧路径/别名/兼容垫片，所有调用方迁移，保留无关用户变更。旧主时间轴对象行/属性节点入口、单属性独占页、旧右侧object/keyframe标签同样退役，控制/值组件/命令迁到06-ClipEffectControlsPanel、06-EffectControlsRows、06-PropertyValueForm，并以`clip.effects`/`selection.properties`两个注册身份承载，不得留双轨。WebUI每项必做清零，不能先禁用后补。
6. 冻结交接给14的标准模型、schema消费、文档命令/引用、模板/字幕生成、主题/布局/恢复语义及黄金场景；同时冻结[片段效果控件工作区](../shared/effect-controls-workspace.md)的界面职责：主时间轴只编排片段、`clip.effects`多组多属性与局部标尺、`selection.properties`共用同值命令、轴外帧定位不拉宽主轴。记录现有公共契约和仍未实现的进程内GPU/信号前置，由14落实，不阻塞WebUI收口。
7. 更新文档实际偏离、已验证组合与限制；Fabric AUI暂缓只描述未来游戏内宿主，WebUI Fabric正常。

验收方式仅人工实际使用：正常构建/启动供体验，不新增自动化测试、CI或测试脚本；问题回责任类修复后按相同步骤人工复验。

## 验收与完成定义

WebUI可用、所有黄金/错误/应用/字幕/游戏验证有真实证据；产物、权限和发布说明准确。新界面合同有真实证据且旧对象行/单属性页/旧标签无残留：主时间轴无属性节点/对象展开；效果控件多组多属性同显并有局部标尺映射；快捷属性同值命令且无自有时间轴；轴外帧不拉宽主轴；小窗/停靠/IME/撤销/保存通过。13通过才进入14，不能同步迁移AUI。14必须按既定完整矩阵迁移，而非只搭壳；本次不授权git提交或push。

## 给主代理的最后指导

从plan/README与implementation-order确认阶段，每单一次提供目标/源码/写集合/输入输出/边界/验收；不在同一v4.1 Flash子会话中途补消息改变目标。WebUI未清零先回责任轮，清零后才向14派AUI任务。14-09必须使用06-ClipEffectControlsPanel/06-EffectControlsRows与两个面板身份映射，不得回退为旧单属性面板或主时间轴对象行。
