# 11.16 — FactQueryPanel / FactQueryClient / EditorFactsQueryBridge（提案）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现。本轮必做，对应Z-editor/README的“触发器连续语义与事实查询UI”；不能因当前缺少跨进程接口就只交语义说明。

## 目标与前置

在行为面板提供受控的只读事实查询：查看当前授权玩家的脚本播放/触发累计信息、最近事实与时间窗查询，帮助解释requires和组合器窗口。前置03统一editor路由/信号/认证、04脚本身份、11触发器身份/连续条件。不是运行时单步调试器，不允许编辑或清空事实。

## 必读来源

- J:api/ServerFactsApi.java（12–37）：仅服务端主线程、只读、累计口径与保留集口径分开。
- 同文件hasPlayed/countPlaybacks/lastPlayback（46–62）、lastPlaybackWithResult（64–74）、hasTriggered/countTriggerHits/lastTriggerHit（78–94）、playedWithin/lastPlaybackWithin/triggeredWithin（96–126）、retainedFacts（128–143）。
- J:trigger/server/prereq/BuiltinPrerequisites.registerAll（17–34）：script_played要求开始和结束，不能与ServerFactsApi.hasPlayed仅开始事实的含义混淆。
- J:webui/WebEditorApi.handle（31–88）：当前没有facts.query；新增受控能力是提案，不是已存在消息。J:trigger/network/NetworkBridge、NetworkHandler及既有请求/回执用于确定加载器适配，实施前按符号读实际接口。

## 输入输出与逐类责任

| 拟新增类 | 输入 | 输出/职责 |
|---|---|---|
| FactQueryPanel | 当前脚本/触发器身份、查询种类、时间窗、能力与回执 | 累计/保留集分组，查询/刷新/取消/错误/未知；不持有第二份事实账本 |
| FactQueryClient | 面板意图、当前editor会话 | 请求关联/取消/断连/过期结果丢弃；不直接访问服务端Java对象 |
| EditorFactsQueryBridge | 授权会话与网络发送者、明确查询参数 | marshal到服务端主线程后调用ServerFactsApi，将有限字段序列化为只读DTO，不暴露内部FactLedger对象 |
| EditorFactsQueryResult | 已完成查询、查询范围/口径、服务器tick与有限结果 | 区分成功空结果、权限不足、无能力、断连、过期；不把未知显示为false/0 |

## 实施步骤

1. 在统一editor共享路由登记候选facts.query及结果消息；两模式同语义。客户端不能自选任意玩家UUID，默认查询实际网络发送者/已授权当前玩家；沿用现有权限边界，不新造角色系统。
2. 接通服务端主线程查询：有/次数/最近开始、按结束结果、触发命中、时间窗和有限保留集。查询结果不含可写账本引用；限制条数和时间窗合法性，非法参数明确拒绝。
3. 显示每项口径：累计索引不因保留集淘汰而归零；保留列表不是全历史；结束原因不是必然自然完成；script_played与hasPlayed说明分开。
4. 只在显式查询/刷新时请求，显示服务器时刻与过期提示；切世界/会话后旧回执丢弃。不靠轮询补出未提供的“当前dwell进度”。
5. 面板从requires/组合器条件旁可达，查询不修改脚本、选择或脏标记。共享runtime事实API由主模组唯一维护，编辑器只展示结果。
6. 若当前运行环境未提供桥能力，显示未提供及精确前置；未来本轮实现必须落实桥和正常目标环境的真实查询，不能用永久“不可得”说明代替功能。

## 禁止与两载体

禁止伪造事实、默认false/0、编辑/清理账本、越权查询其他玩家、复制事实存储或把原始服务端对象传给UI。WebUI→Forge/Fabric正常接通是本轮出口；游戏内Forge使用同一公共端口是14迁移要求；仅游戏内Fabric+AUI适配暂缓，均不阻塞本轮。

## 验收与完成定义

当前玩家实际播放/触发前后查询，次数、最近事实、时间窗结果与ServerFactsApi一致；空结果明确成功且无记录。断连/未授权/无桥显示未知或错误而不是false；快速切脚本/世界不显示旧结果。查询不修改脚本，不发生服务端线程违规；保留集淘汰后累计信息仍按真实API口径。用真实游戏事件和查询回执证明，不用mock回声。面板、桥、协议和权限边界全部闭合才完成。
