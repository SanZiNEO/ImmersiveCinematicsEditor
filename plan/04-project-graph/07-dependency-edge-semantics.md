# 07 — 依赖边语义、身份与可维护性

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现。前置02图数据、06节点交互；图内写操作由[11-GraphDependencyMutationController](11-GraphDependencyMutationController.md)当轮完成。11轮完整触发器页面不是04维护依赖的前置。

## 职责与真实依据

把边绑定到真实触发前置关系，保留来源并给出可维护性；不是把图限定成只读。用户允许关系图调整依赖，但不允许图编辑轨道/片段/关键帧等具体内容。

- J:script/ScriptParser.java — parseTriggerRequires（1010–1051）：触发器requires是AND前置，字符串等价script_played，对象含type与扩展数据。
- J:trigger/server/prereq/BuiltinPrerequisites.java — registerAll（17–34）：script_played为有开始且有结束事实，script_started只要求开始，script_completed只要求结束。
- J:webui/ScriptGraphService.java — SCRIPT_REQUIREMENT_TYPES（37–44）、边构造（89–140）、readTriggers/readRequirement（246–295）：已有边从被依赖脚本指向依赖方，当前扫描按meta.id解析目标、路径标识节点。
- J:script/schema/MetaSchemas.java — play_mode（34–35）：跨脚本播放策略，不是指向某脚本的依赖边；同脚本再次触发替换另看interruptible。
- J:script/rule/RuleCollectionParser.java、script/execution/ClipExitPolicy.java：同脚本片段/绑定引用不冒充项目脚本间边。EVENT命令文本也不能凭字符串猜成脚本关系。

## 类级任务与输入输出

1. EdgeDescriptor（提案，graphLayout.ts或共享图模型内）：输入原始graph数据，输出from/to路径、fromScript/toScript身份、triggerIdentity、triggerIndex、requirement类型、具体条目定位、可维护性/原因。图可能把重复关系聚合显示，但修改必须能定位到真实条目，不按两端节点一次删光。
2. EdgeTooltip（提案组件）：显示两端、触发器、前置类型、解析/校验状态、定位文档按钮；对已支持的标准前置提供维护入口，调用04.11，不自己写文档。
3. DanglingStub（提案组件）：悬空关系可见并可定位原requires，不因目标缺失就悄悄消失；修复走受控维护命令。自引用/环给真实诊断，不一概宣称播放器不允许。

## 修改步骤与边界

1. 读取当前ScriptGraph/graphLayout实际边命中、去重、BFS与绘制结构；保留合法的跨文件夹/回边布局，不混同依赖语义。
2. 图数据补足触发器和条目身份；已存在触发器未显式id时，使用parser身份规则并加文件指纹，不把易漂移数组下标单独当稳定身份。
3. 悬停/选中/键盘聚焦能查看来源；点击维护打开受限对话框。新增/删除/改类型必须选择真实触发器与具体requires，不能拖一条线即替作者决定全部语义。
4. 三内置前置是已知可写子集；自定义未知数据只读保留并说明原因，可导航到文档，不能发明字段或丢数据。组合器中的派生引用若未有精确写合同也只读，不妨碍标准前置本轮可维护。
5. 只读扫描可容错显示坏脚本；写事务却必须真实parse/validate并检查指纹，二者不能互相代替。写协议/权限/回滚见04.11与共享C07，不登记“禁止依赖写入”的相反合同。

## 两宿主

本轮只实现/验收 WebUI 侧；游戏内 Forge+AUI 侧同语义是 14 迁移要求，不阻塞本轮。

WebUI正常对接Forge/Fabric主模组（本轮出口）；游戏内Forge+AUI消费同语义图端口属14迁移要求，只暂缓游戏内Fabric+AUI适配。布局是编辑器状态，不写入运行脚本。

## 正反例与真实冒烟

a的t1 requires=[b]形成b→a的script_played边；同t1新增script_started/b、另一t2再引用b，维护时必须区分三条来源。missing可见为悬空提示；未知my:quest不凭空画脚本边。通过图内维护把指定条目改为script_completed后，保存重开/刷新与实际requires一致，其他条目不变（本轮出口）；游戏触发符合对应事实条件属14迁移参考。并发文件变化、重复ID、断连均失败不半写。

反例：任意拖线自动创造触发器、按from/to删掉全部引用、未知前置强改为script_played、把play_mode或命令文本猜成边、只有只读跳转没有图内维护，均不通过。

## 完成定义

全部边可追溯、标准依赖可通过04.11在图内受控维护，复杂不支持关系明确只读但保留；悬空/重复/自引用可见；无轨道/关键帧编辑侵入项目页。04本轮完成，不等11轮兜底。

## 验收归档

以上正反例与真实冒烟均为本轮验收：记录边来源、修改前后标准requires、真实校验与游戏触发结果。不能只检查页面有线或某字符串0命中就判完成。
