# editor 统一包与双模式总开关

> 状态：未实现（用户新增要求；本次仅编写设计文档，不改代码）。
> 独立包与开关合同。03先落实editor统一管理/共享服务/webui；13完整验收WebUI后，14才实现ingame公共接口/GPU/AUI迁移。J:webui是当前事实引用，目标路径均提案；见implementation-order。

## 一、摘要

主模组当前的`com.immersivecinematics.immersive_cinematics.webui`包要迁移为统一的`editor`包。editor不再等同外部WebUI服务，而是整个编辑器能力的管理边界：内部提供webui跨进程模式和ingame进程内模式，由统一入口控制编辑器启用、会话与资源生命周期。

## 二、为什么做

把全部编辑器能力命名为webui，会让游戏内宿主误依赖WebSocket和外部预览屏；把开关分散在不同宿主，又可能出现关闭编辑器后仍注册按键、捕获画面或启动服务。目标是关闭整个编辑器时两种模式均不可见、不可用，开启时按实际宿主和模式使用相同模型/消息/播放能力。

非目标：不改脚本格式，不将编辑器UI重新塞入主模组，不让主模组依赖ApricityUI，不新增远程访问，不修游戏内Fabric AUI，不在本次修改代码。

## 三、方案

- `editor`是统一管理包，不只是机械改名。
- `webui`模式负责外部编辑器连接：认证、WebSocket、原始RGBA或编码视频传输；不要求AUI。WebUI对接Forge/Fabric主模组均正常实施。
- `ingame`模式负责游戏内编辑器：稳定进程内信号与游戏画面公共端口；AUI界面位于独立附属模组，当前先完成Forge，只有该分支的Fabric AUI适配暂缓。
- 总开关属于editor统一入口，不能继续由WebEditorServer是否运行隐式代表“整个编辑器是否启用”。总开关关闭时两个模式都禁止建立新会话，并释放已有编辑器专用资源。
- 模式可用性与总开关分开：总开关开启不代表两种模式全部可用，也不强制启动WebSocket、编码器或AUI宿主。只在实际消费时建立对应资源。

## 四、技术细节

### 4.1 当前来源与目标职责

当前来源是`J:webui/`下WebEditorApi、WebEditorServer、WebSocketSession、WebPreviewScreen、PreviewStreamer、PreviewEncoder、PreviewProtocol、PreviewConfig、H264AuSplitter、OutboundQueue、ScriptFileService、ResourceFileService、WebRegistryService、ScriptGraphService。它们是实际存在的旧包类；目标子包与新类名均为提案。

建议职责划分：

| 目标职责 | 放置原则 | 迁移要求 |
|---|---|---|
| editor统一入口/生命周期 | editor根或其内部管理子包 | 总开关、模式能力、打开关闭、世界退出/禁用清理；只有一个所有者 |
| 共享脚本/schema/资源/图与消息路由 | editor共享服务层 | 不依赖WebSocketSession或AUI类型，两个模式调用同一语义 |
| editor.webui | WebSocket/认证/编码与跨进程传输 | 保留适合该模式的Web命名，不把编码器当进程内前置 |
| editor.ingame | 进程内端点/帧源/输入与飞控公共适配 | 只暴露稳定接口，不访问私有类，不依赖外部WebPreviewScreen存在 |
| api/editor公共契约 | 对外稳定类型 | 与内部editor实现分离；附属模组只依赖公共契约，不直接读内部实现 |

### 4.1a 逐类落点与可派发工作

以下目标包相对于主模组Java包根，类名/位置为待实施提案；迁移时不得留下旧包转发或兼容再导出。每行迁移必须同时更新所有调用方。

| 当前J:webui类 | 目标职责/位置（提案） | 本类任务与完成条件 |
|---|---|---|
| WebEditorApi | editor.service.EditorMessageRouter | 去除WebSocketSession硬绑定，消费公共端点与统一总开关；两模式同一消息路由，既有消息名不因包改名变化 |
| ScriptFileService | editor.service.ScriptFileService | 两模式共用脚本根目录/路径校验/读写/校验流程；受统一启用门禁，不由UI直读文件 |
| ResourceFileService | editor.service.ResourceFileService | 两模式共用资源发现与合法引用；不把Electron字幕外部输入混成模组任意文件读取 |
| WebRegistryService | editor.service.EditorRegistryService | 去掉Web专属命名，仍由游戏回答注册资源；不复制各加载器注册表 |
| ScriptGraphService | editor.service.ScriptGraphService | 两模式共用容错图数据与受控关系事务；组织/依赖写入仍按04合同 |
| WebEditorServer | editor.webui.WebEditorServer | 只管理外部传输服务；启停由EditorManager协调，不反向决定ingame是否可用 |
| WebSocketSession | editor.webui.WebSocketSession | 适配公共端点；保留WebSocket认证/帧解析，断开只释放本端点资源 |
| WebPreviewScreen | editor.webui.WebPreviewScreen | 仅外部模式的游戏预览/输入薄壳，通用飞控退出不再依赖其activeScreen |
| PreviewStreamer | editor.webui.PreviewStreamer | 仅跨进程订阅/编码/发送；无外部消费者不启动，不成为进程内画面前置 |
| PreviewEncoder | editor.webui.PreviewEncoder | 外部H264编码资源的明确所有权/关闭；不参与ingame纹理消费 |
| H264AuSplitter | editor.webui.H264AuSplitter | 编码字节流拆分留在webui，不移植到GPU帧链路 |
| PreviewProtocol | editor.webui.PreviewProtocol | 保持当前跨进程wire格式及两端一致性；不把二进制传输协议当共享脚本模型 |
| PreviewConfig | editor.webui.PreviewConfig | 表达当前外部预览规格；不因双模式新增无依据的分辨率/帧率档位 |
| OutboundQueue | editor.webui.OutboundQueue | 只承担外部发送排队；帧/可合并状态可丢旧，关键命令结果可靠或明确断开失败 |

统一管理职责建议为editor.EditorManager、editor.EditorMode、editor.EditorSessionRegistry（均提案；已有等价职责时合并，不新增平行管理器）。EditorManager读取唯一总开关、注册模式能力、协调打开/关闭/世界退出；EditorMode只区分webui与ingame；会话注册表记录模式、端点身份和拥有的订阅/控制租约。两模式不各自生成一份编辑器播放时钟或绕过统一门禁。

editor.ingame.IngameEditorEndpoint/IngameEditorAdapter（提案）只把附属模组进程内请求接入共享路由与公共帧/飞控端口；AUI的Screen/Document/Element留在独立编辑器仓库，不能进入主模组公共类型。公共api/editor接口与内部editor实现区分，不改成附属模组可直接操作全部内部类。

### 4.1b 注册与调用方核对

已核对的切入点：J:control/CinematicKeyBindings.java的WebEditorServer import（9）、编辑器键位（34–43）、F9直接构造旧WebPreviewScreen（66–70）、服务端运行/客户端提示判断（74–82）；迁移后必须统一经EditorManager门禁和选定模式派发。J:handler、mixin、Forge/Fabric客户端入口以及构建/Mixin资源中的引用，实施前按旧包引用完整查找，再逐点迁移，不能只改14个文件的package声明。

执行单分阶段：A共享包/路由与调用方迁移、BEditorManager/总开关、Cwebui按需生命周期均在03；Dingame公共端口/附属挂接只在13验收WebUI通过后的14执行。A/B冻结后再落实C，不安排C/D同步开发；每单自包含。

### 4.2 总开关合同

配置键最终名称由后续实施结合现有Config确定，不能假称已经存在。默认开启沿Z轮既定设计。关闭时不注册编辑器专用按键/入口、不启动通信服务、不建立编辑器画面捕获/编码/进程内订阅，不加载编辑器专用资源；从开启切到关闭时停止会话、飞控、编辑器预览并释放其资源。重复关闭幂等，不能影响普通脚本的解析、触发、播放与游戏渲染。

总开关仅管理客户端编辑器薄壳；专用服务端不加载AUI/客户端编辑器类。附属模组缺失、AUI不可用或某模式不可用时有明确能力状态，不自动用假预览或网络回环替代。

捕获中心可能还服务非编辑器消费者；关闭总开关只撤销编辑器拥有的订阅/租约，不得无条件销毁整个CaptureHub影响其他功能。AUI由附属模组自己持有，主模组只撤销其编辑器会话/能力，不以反射或强制关闭AUI全局服务代替清理。

开关读取先于编辑器专用按键和资源注册；仅拦截F9处理不算“关闭时入口/按键列表不可见”。实现必须核对Forge/Fabric的注册阶段和停用路径，并分别证明启动关闭与开启后再关闭的行为。普通播放所需的共享工具不能随editor开关被卸载。

### 4.3 干净迁移与责任

未来实施必须先核对全部旧包引用，再迁移类/调用方/构建与Mixin引用、日志说明、正式文档与协议集成入口；删除旧包及过时再导出，不保留仅为旧命名存在的兼容垫片。正在使用的消息名不因Java包改名随意改变，脚本JSON字段更不能跟着改。

03完成统一包/总入口/共享服务和WebUI，ingame只有明确未实现的能力边界，不用空适配器充数。01–12打磨WebUI、13全量收口后，14才落实进程内接口/GPU/AUI与完整迁移，先Forge；Fabric+AUI故障不影响WebUI→Fabric。

### 4.4 验收

1. 旧webui包与所有调用方干净切换，新editor根能分别识别webui/ingame模式。
2. 总开关关闭时两模式入口/按键/服务/捕获均不生效；已有会话全部退出，普通脚本播放不受影响。
3. 开启后WebUI→Forge、WebUI→Fabric正常连接/编辑/真实预览；游戏内Forge+AUI通过同一共享语义工作。
4. 各模式资源按需启动，关闭一种消费方不释放另一消费方拥有的资源；总关闭完整清理且幂等。
5. 换世界、断连、异常退出与重复开关无残留监听器/纹理/编码进程/输入捕获，无编辑器UI套娃。
以上游戏内验收项仅14迁移执行，不是03或01–13完成条件；13 WebUI收口只要求当前WebUI与总开关真实可用，未实现ingame不可宣告支持。

## 五、为什么不选别的

不只把webui目录改名却保留WebSocket为全编辑器中心；不让两个模式各管一个互不一致的开关；不让主模组依赖AUI来判断所有编辑器是否可用。统一管理增加一处明确生命周期所有权，但避免两套模型、两套状态与残留资源。

## 六、实现结果

未实现。本页已独立给出逐类迁移、两模式职责、统一总开关、调用方和验收合同，相关轮次按此执行；本次没有包迁移代码或游戏运行结果。
