# 协议与公共能力变更登记（设计，不是已有接口）

## 一、摘要

把现有消息与必须新增的受控操作分开登记，避免图、资源、状态和宿主各自发明协议。全部提案在实施前确认唯一名称/信封，当前不能声称可调用。

## 二、为什么做

J:webui/WebEditorApi.java — handle（31–88）真实支持hello、script CRUD/validate/graph、registry、schema、resource.list和编辑器播放/飞控；并没有文件夹移动、图布局写、依赖事务、GPU公共帧源等。已有public方法也可能绑定包私有会话或具体Screen，详见03.08。

## 三、登记表

| 能力/候选名称 | 当前状态 | 责任轮次与任务 | 必须冻结的合同 |
|---|---|---|---|
| 既有script.list/load/save/delete/new/validate、schema.get、script.graph、resource.list、registry.query/get | 已有消息，形状按实际实现读取 | 03.05/06；02消费 | 复用现有type/data/id，不伪造结果字段；保存前真实校验 |
| 既有editor.seek/play/pause/stop/setCamera/pushScript、飞控命令 | 已有消息，部分缺独立ack | 03.05/08、08.06、12.07 | WebUI当轮落实真实控制/错误与定向写回；帧抵达不等于请求发送 |
| 公共进程内Endpoint/Session/Push/FrameSource/Playback/Flight | 未来迁移提案，不是现有API | [14.00](../14-aui-forge-migration/14-00-public-api-prerequisite.md)；14适配 | 13验收WebUI通过后才落实；GPU租约/线程/释放与附属模组可访问性不能提前作为WebUI门槛 |
| hello能力摘要、schema来源/哈希、控制失败回执 | WebUI所需扩展按实际能力 | 03.05/08 | 不提前宣告未实现ingame/GPU；不强加脚本meta.version |
| folder维护、script.move、身份重命名预览/提交（候选script.refs.preview/apply） | 新增受控写能力 | 04.01/04/08 | 根目录约束、路径与meta.id分离、影响范围/文件指纹、真实校验、原子失败恢复 |
| 图布局读写 | 新增编辑器元数据端口 | 04.05 | 不写运行时脚本；按项目/宿主隔离、未知版本不破坏、坏布局可恢复 |
| 依赖维护预览/提交（候选script.dependencies.preview/apply） | 新增受控写能力；不是当前只读script.graph | [04.11](../04-project-graph/11-GraphDependencyMutationController.md) | 来源触发器/具体条目、目标身份和类型；保留其他条件，真实parse/validate、指纹与失败回滚；11复用 |
| resource.list视频/外部音频发现及媒体状态能力 | 列表当前白名单有限；扩展/状态端口为提案 | 03.06、09.04、10.03/04/07 | 与运行时支持格式交叉对账；无状态显示未知；不把文件存在当解码成功 |
| 外部字幕文件选择/读取、应用偏好/布局、桌面LUT导出 | 编辑器宿主内部受控端口，不是主模组脚本协议 | 05.20–23、12.11、12.20–23 | 用户选择文件、有限权限；不暴露任意fs/命令；不把cue/主题/模板元信息写入脚本 |
| webui包→editor统一入口/共享服务/两模式命名与总开关 | 当前未迁移 | [独立设计](editor-package-modes.md)；03先webui，13全验，14接ingame | 共享需求不等于同步开发；ingame不可用时明确未实现，不放空适配器 |
| 事实只读查询（候选facts.query） | 当前WebUI无消息，已有ServerFactsApi服务端门面 | [11.16](../11-triggers-rules-events/16-fact-query-panel.md) | 本轮WebUI落实受控查询桥，限制实际授权玩家、服务端主线程、累计/保留集/时间窗和未知状态，不写账本 |

## 四、实施规则

同一消息不得由两个轮次定义不同data/result。接口实现归该行责任任务，其他任务消费冻结结果；新API未落地即标缺前置，不用直接访问主模组私有类代替。WebUI→Forge/Fabric都使用正常协议，只有游戏内Fabric AUI适配暂缓。没有必要新增的遥测、重试框架、远程访问或权限系统不在本登记扩展范围。

## 五、为什么不选别的

不把提案写成已有工具，不为图/字幕复制文件服务。WebUI需要的受控能力当轮完成；进程内公共帧源与AUI实现明确后置14，不因先写接口设计就要求同步开发。

## 六、实现结果

未实现（本次只写文档）。实施时在本节记录最终采用的消息名/方法、对应实现文件与行为验证证据；不得把本表状态直接改成全部通过。
