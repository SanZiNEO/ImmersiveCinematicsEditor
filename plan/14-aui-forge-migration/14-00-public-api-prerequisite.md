# 14.00 — AUI迁移公共接口与GPU帧源落实

> 状态：未实现。本任务只在13 WebUI全部功能打磨验收通过后启动，不是03或其他WebUI轮的实现前置。

## 目标与前置

把03.08中已经约定的ingame公共边界落实为实际可调用能力，再接游戏内Forge+AUI。输入是13冻结的WebUI模型、消息、模板/字幕生成语义与黄金场景，输出是稳定公共端口、GPU租约和真实迁移验证。缺主模组写入授权则准确报告本轮前置，不读私有类、不用空实现充数；不回头阻塞已经完成的WebUI。

## 必读来源

J:webui/WebEditorApi.handle及推送、WebSocketSession访问性、WebPreviewScreen.enterFlightMode/requestFlightExit；J:media/capture/CaptureHub的Consumer/register/unregister、HUD后捕获点与纹理所有权；J:camera/CameraManager的编辑器控制、control/FlightModeManager；实际代码已迁入editor时先按类/符号找新位置。具体已核锚点与接口提案见[03.08](../03-host-transport/03-08-editor-host-contract.md)。

## 输入输出与逐类任务

| 提案职责 | 实施工作 | 不允许 |
|---|---|---|
| api/editor/EditorEndpoint | 独立附属模组可访问的端点身份与消息发送，关键结果可靠或明确失败 | 暴露socket/包私有参数、静默丢save/validate/flight.exit |
| EditorSessionApi/EditorPush | 进程内请求复用已稳定共享路由，定向结果/状态推送，attach/detach幂等 | AUI另一套字段/脚本命令，广播飞控退出导致其他文档写回 |
| EditorFrameSource/FrameLease | HUD后/Screen前真实GPU画面、纹理id/尺寸/generation/frameId/时间戳/flipY/alpha，真实幂等释放 | 私有FBO读取、CPU截图/网络回环假替代、空release |
| CaptureHub帧源适配 | 增加按需GPU消费者，代际失效和渲染线程释放；保留WebUI原路径 | 消费者关闭共享捕获中心或其他消费者纹理 |
| EditorPlaybackControl | 复用既有push/seek/play/pause/stop/直控与状态回执 | 重写播放器或直接依赖PreviewChannel |
| EditorFlightControl | 无外部Screen时也能进入/退出/取消，owner定向写回 | 依赖WebPreviewScreen.activeScreen才能退出，取消他人飞控 |
| EditorHostApi/EditorManager接入 | 将真实ingame模式注册到03已完成的唯一开关/会话管理，按需启动 | 第二个总开关、未实现提前宣告能力或服务端加载AUI |

## 实施步骤与资源合同

1. 对13冻结的实际公共/内部边界复核，明确哪些03已落实、哪些本任务新建；不为遵循旧提案重复造类。
2. 先完成公共端点/共享路由/能力注册，再完成进程内帧租约，最后挂接AUI消费和飞控；共享文件由一个集成所有者维护。
3. FrameLease只借用主模组纹理；generation变化撤销旧绘制资格，真正销毁由拥有者在渲染线程完成。消费者关闭只退自己的订阅/租约，不全局close。
4. 关键回执送达或明确断开失败；帧/可合并状态允许丢旧。飞控退出只回发起端点，失去owner时按实际会话生命周期取消且不误写其他文档。
5. 总开关关闭清理全部已注册editor模式，但不卸载普通脚本解析/触发/播放或非编辑器捕获。无AUI前置时ingame明确不可用，WebUI仍正常。

## 验收与完成定义

从独立附属模组实际编译访问接口，真实完成schema/脚本读写校验/控制往返；GPU画面包含HUD/lane/调色、不含编辑器UI，换世界/generation/重复开关无泄漏。关闭一个端点不影响其他消费者，关键回执不假成功；进程内飞控退出不依赖外部Screen。先Forge迁移，游戏内Fabric+AUI暂缓。所有证据在14记录，不能用03接口文字或WebUI已通过代替本轮真实验证。
