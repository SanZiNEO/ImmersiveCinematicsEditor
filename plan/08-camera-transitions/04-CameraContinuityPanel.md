# 08.04 — CameraContinuityPanel（提案）：播放关系与循环诊断

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现。前置01 meta、02文档、03宿主、05片段/时间轴、07对象；规则明细在11提供后联动，不阻塞本轮静态诊断。

## 唯一职责

解释脚本级/片段级循环、同脚本再次触发与跨脚本播放关系，展示真实状态或明确未知。只读诊断/跳转，不在前端实现第二套调度器，不改运行时规则。

## 必读的真实源码

- J:camera/PlaybackLifecycle.java — playScript（83–124）、interruptInterruptibles（126–144）、canDequeue（350–352）、startScriptInternal（369–429）。
- J:script/ScriptParser.java — parseMeta（213–256）、timelineKeys（83–89）、parseTimeline（315–320）。
- J:script/Timeline.java — loopStart/loopEnd及getter（18–47）；ScriptPlayer.java — macroLoopStart/End/Allowed（105–125）、isFinished（468–480）、setMacroLoopAllowed（796–800）及computeMacroLoop（实施时读当前符号）。
- J:script/schema/MetaSchemas.java — all（28–45）；TrackSchemas.java — PLAY_CONTROL（实施时读当前定义）；CameraFrameEvaluator.resetTransitionState与CameraTrackPlayer.onLoopRestart。

## 输入输出

输入标准meta、timeline.loop_start/loop_end、片段loop/loop_count/loop_mode/exit、转场参数；运行时实例快照只有03确有公共能力时才输入。输出解释、字段导航、真实状态/未知标签。没有实例端口不显示伪造的实例数量、队列位置或替换结果。

## 逐类工作

1. ContinuityPanel（提案）：按脚本级、片段级、转场交界、行为挂起分组，只输出跳转/诊断；脚本字段归01，片段控制归05，规则归11。
2. PlaybackRelationDescription（提案）：复述源码规则而非自行裁决：同脚本已有实例时看其interruptible，可打断替换，否则入队；跨脚本看**已在播集合**，已有exclusive则新来者入队，否则顶掉play_mode=interruptible的游戏实例后开播；已有parallel可并存。不能写“新脚本exclusive会按priority替换低优先级”。
3. `priority`在parseMeta注释明确仅用于队列内排序，不能把它等同覆盖链modifierPriority或跨脚本抢占强度。`interruptible`布尔控制同脚本再次触发；`play_mode=interruptible`是跨脚本被新来者顶掉的状态，二者不能混淆。
4. MacroLoopView（提案）：宏观开关/次数/方向来自meta.macro_loop*，区间来自**timeline.loop_start与timeline.loop_end**；未声明终点的运行时派生按ScriptPlayer说明。不存在macro_loop_start/end脚本字段，不要求schema凭空补出这些键。
5. 明确编辑器驱动实例在PlaybackLifecycle.startScriptInternal（412–415）调用setMacroLoopAllowed(false)：编辑器播放头不展开游戏宏观循环。工作区A–B浏览与正式游戏宏观循环分别说明；真实循环必须用游戏播放场景验证。
6. clip.loop可有限/无限，hold_at_end属于内容消费后保持，不概括为任意loop=true都永不结束。转场打断/循环复位按实际消费者展示，未知结果标需游戏验证。
7. 规则挂起明细在11完成后由相同实例身份联动；本轮可提示存在规则绑定，但不伪造当前挂起/释放状态，也不把11变成08的硬前置形成倒序依赖。

## 两载体与禁止项

本轮只要求 WebUI→Forge/Fabric 完整实现同语义诊断；游戏内Forge 承载同面板是 14 迁移要求（14 实施时不得只交合同）；仅游戏内Fabric+AUI适配暂缓。若缺公共运行时状态端口则显示未知并按03登记能力，不绕到私有类读取。禁止改队列/打断/宏循环语义，禁止因静态推断阻止合法脚本保存。

## 正反例与真实冒烟

已有A exclusive时触发不同B：B排队，与B自己的priority或play_mode无关；结束A后按真实队列逻辑接播。已有A play_mode=interruptible时到达B：A按退出链退场，B开播；同脚本A再次触发则检查A.interruptible布尔。分别验证有限/无限片段循环、游戏宏观循环和编辑器A–B浏览；输出中无macro_loop_start/end、无伪实例列表。无端口、断连、外部实例变化均显示未知/过期，而不是确定性假结论。

完成定义：关系、时间域、循环层级和编辑器/游戏实例差异准确，全部字段能导航到唯一编辑入口，真实可观察场景与源码一致，错误/未知状态完整，无越界修改或后轮硬依赖。

## 验收归档

将上述关系/循环/未知状态场景逐项记录真实结果；只有实际运行验证才填通过，未执行不能用静态推断替代。
