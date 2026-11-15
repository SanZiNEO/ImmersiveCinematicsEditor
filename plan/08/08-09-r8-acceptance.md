# 08 验收

## 目标

按“编辑器写固定格式脚本 → 推给游戏 → 游戏播放真实结果”验收 08。验收覆盖字段面、转场面板、叠化、参数过渡、共存、lane 视图、连续性、玩家移动、回放闭环、面板结构和模组零改动。

## 文档完整性

| 检查 | 通过条件 |
|---|---|
| 08 文件数 | 10：`README.md` + 9 份任务文档 |
| README 链接 | 9 个任务链接全部指向存在的文件；无死链 |
| 单 H1 | 每份文档恰好一个一级标题 |
| 任务边界 | 每份文档有目标、数据/消息合同、组件、验收；没有“只写 README”的轮次 |
| 面板归属 | `selection.properties` / `clip.effects` / `transition.panel` / `camera.inspect` 四处职责不重叠 |
| 可写字段 | 只写 CAMERA 既有字段；无 lane/UI/版本/总时长写盘 |

## A. 字段面

| # | 场景 | 通过条件 |
|---|---|---|
| A1 | 选中 CAMERA 片段 | 属性面板按 `camera/composite/color/breath/modifier/selector` 显示；没有 `transition` 组，也没有任何转场组/叠化组；位置/朝向/`motion_*` 仍由 07 显示 |
| A2 | `fov` 静态/打帧 | 静态在属性面板；打帧后进效果面板；属性面板不再重复显示该行 |
| A3 | `dest/source` 归一化矩形 | 写 0–1；百分比切换不改写盘值；越界给 warning 不自动夹 |
| A4 | `mask_shape=full/rect/circle` | full 折叠几何；rect 启用宽高；circle 启用半径；切换不删已有帧 |
| A5 | 57 调色通道 | 按 02 顺序出现；任一通道打帧后进效果面板；调色行不复制到 lane 页 |
| A6 | 10 条调色曲线 | 各自打开 `ColorCurveSheet`；`[[0,0],[1,1]]` 合法；少于 2 点/x 非递增/越界 block |
| A7 | 7 个呼吸字段 | `enabled=false` 折叠保留值；无时钟；无效果面板入口 |
| A8 | `modifier` | `channels` 非空、六通道子集、不重复；position 三轴；未声明通道不写值；错误 block |
| A9 | `selector` | 通用 6 行 + 7 个调用点覆盖；`null` 显示继承；编辑写显式值；清除回 `null` |
| A10 | 效果面板边界 | `transition*`、叠化布局、`mask_shape`、`dimension`、`cam_breath_*`、`modifier`、调色曲线在效果面板 0 命中；B 的 `composite.opacity` 有帧时作为普通 opacity 叶子出现 |
| A11 | 保存重开 | 值/关键帧/曲线点/未知键原样保留；无 UI 字段写盘 |
| A12 | 转场面板入口 | `transition.panel` 存在；选中 A→B 交界后能看到叠化/参数过渡/共存详情；片段属性面板 0 命中 `transition*` |

## B. 叠化与参数过渡

### B-1 叠化

| # | 场景 | 通过条件 |
|---|---|---|
| B1 | 3 秒叠化 | A 0–6 不动；B 3–7，重叠区 3–6；`B.start_time=3`；A/B `duration` 都不变 |
| B2 | 叠化落盘 | 只写 `B.start_time`、B 的两端 opacity 帧；不写 A 的 `transition`（也不写 `cut`）；JSON 无 `crossfade/overlap` 字段 |
| B3 | 重叠区画面 | A 的 opacity 解析为 1；B 本地 0 为 0、本地 D 为 1；视觉为下层不透明、上层淡入 |
| B4 | 两条 lane | A `single` 在下、B `crossfade` 在上；各自 `colorOwner`；不出现 morph lane |
| B5 | 时长边界 | `D<=0` error；`D>min(A.duration,B.duration)` error；非有限 error；应用禁用 |
| B6 | 结构边界 | A/B 非相邻、跨轨、B 不在上层、A/B loop/infinite、非全屏、A opacity 非恒 1：error；应用禁用 |
| B7 | A 已有 `morph` | 应用叠化不自动改 A；面板显示 `both`；morph 窗口内单 lane，窗口外仍可能两条 lane |
| B8 | B 的既有 opacity 帧 | `(0,D)` 内替换为 0/1 两端；区间外保留；一次 commit |
| B9 | 移除叠化 | B.start_time 回 A.end；删除两端叠化帧；区间外保留；A 的 `transition` 不变；一次撤销回退 |

### B-2 参数过渡

| # | 场景 | 通过条件 |
|---|---|---|
| B10 | `transition=cut` | 表折叠；显示保留覆盖数；无窗口；不自动删分通道值 |
| B11 | `morph` 全默认 | 六通道 `blend`、`0.5s`、线性、`interrupt=blend`；窗口宽 0.5 |
| B12 | 只覆盖 `yaw.duration=0.8` | yaw 0.8；其他 0.5；`maxDuration=0.8`；窗口以交界为中心 |
| B13 | `position.mode=cut` | position 不占窗口；交界面硬切；其他通道照常 |
| B14 | `fov.mode=hold,duration=0.3` | 窗口 0.3；窗口内保持 A；结束后切 B |
| B15 | 通道曲线覆盖 | 只写该通道 `curve`；其他通道继承片段曲线/线性 |
| B16 | 分通道 `duration=0/负/非数` | 本地 error；应用/保存/推送阻止 |
| B17 | 未知通道/未知键 | 本地 error；路径定位到 channel/key；不静默删除 |
| B18 | 末尾 `morph` 无下一片段 | warning；可保存；回放不产生窗口 |
| B19 | 全通道 `cut` | warning“无窗口”；回放硬切；JSON 仍保留显式 cut |
| B20 | `transition_interrupt` | `blend/snap` 正确写；其他值 block |
| B21 | 表提交 | 一次应用=一个 commit；撤销一次全部回退；不产生六次撤销 |
| B22 | 效果面板/时间轴 | 叠化和参数过渡在效果面板 0 行；主时间轴 0 个叠化/参数过渡节点；编辑只在 `transition.panel` |
| B23 | 归属 | 叠化是 A→B 交界上的操作，落点写 B；参数过渡的字段在出场片段 A 的 `objects` 上，作用于 A→B 交界；下一片段自己的参数过渡作用于再下一个交界 |
| B24 | 共存 | 同一交界同时有叠化与 morph：不自动删除任一方；显示 `morph 优先区间` / `叠化仍可见区间`；`仅保留叠化` 才显式写 A 的 `transition=cut` |
| B25 | 遮蔽 | morph 窗口覆盖整个重叠区：显示“叠化不可见”；可保存；不自动把 A 改 cut；窗口外仍按普通 lane 规则 |

## C. Lane 视图

| # | 场景 | 通过条件 |
|---|---|---|
| C1 | 单片段 | 1 lane；`single/top`；来源/区间正确 |
| C2 | 叠化两片段重叠 | 2 lane；A 在下 `opacity=1`；B 在上 `role=crossfade`、`opacity 0→1`；`top` 最后；A 的 `transition` 不需要是 `cut` |
| C3 | 三片段重叠 | 3 lane；顺序按轨道数组，不按开始时间 |
| C4 | morph 窗口 | 1 lane；`role=morph`；`clipKey=next`；`morphFromKey=prev`；第三个片段不产生额外 lane |
| C5 | morph 窗口外 | 按普通活跃片段列出；无 morph lane；若有叠化，B 仍为 `crossfade` |
| C6 | `cut` 交界 | 不合并；两侧片段按区间出现/消失 |
| C7 | 片段间隙 | `lanes=[]`；显示空态；不保留上一帧 lane |
| C8 | 末尾 morph | 单片段列出；note；不产生空 morph lane |
| C9 | 合成摘要 | 静态值显示数值；有帧显示“动画 N 帧”；不按播放头采样 |
| C10 | 调色归属 | 行显示 `colorOwner`；morph 为 `next`；不复制调色值 |
| C11 | 覆盖链 | 显示 400/300/200/100；Modifier 说明“不作用 lane 快照”；不显示伪 winner |
| C12 | 写盘 | 保存 JSON 无 lane 键；lane 视图不进撤销栈 |
| C13 | 面板交互 | 点击行只选片段；不创建 lane 选区；不提供编辑/保存 lane |
| C14 | 叠化双 lane 摘要 | A 行 opacity 1；B 行 opacity 动画/0→1；显示重叠区起止；不合并成一条 |
| C15 | 叠化与 morph 共存 | morph 窗口内只列 1 行 `morph` 并给 `crossfade_shadowed_by_morph` note；窗口外列 2 行 `single/crossfade`；不把 A 的 `transition=morph` 当成“叠化不成立” |

## D. 连续性

| # | 场景 | 通过条件 |
|---|---|---|
| D1 | `play_mode=exclusive` | 显示“在播时后续请求排队” |
| D2 | `play_mode=interruptible` | 显示“后续请求可顶掉当前实例” |
| D3 | `play_mode=parallel` | 显示“可与 parallel 共存；有 exclusive 仍排队” |
| D4 | 同脚本 `interruptible=true/false` | 分别显示“替换/排队” |
| D5 | `priority` | 只影响队列次序（降序，同优先级 FIFO）；不显示运行中优先级 |
| D6 | `hold_at_end=true` + `skippable=false` | warning“只能系统停止/强制退出” |
| D7 | 自然结束/跳过 | 门禁结果与 `hold_at_end`/`skippable` 一致 |
| D8 | 宏循环 | `count=-1` 无限；`repeat/pingpong` 正确；不显示实时圈数 |
| D9 | 片段循环 | `loop`/`loop_count`/`loop_mode` 摘要；不扩展主时间轴区间 |
| D10 | 无限循环 + 参数过渡 | 显示“不参与参数过渡对” |
| D11 | 面板只读 | 无可编辑输入；无 meta 写命令 |
| D12 | 无 CAMERA | 显示“无 CAMERA 轨道”；不伪造片段循环行 |
| D13 | 无限循环 + 叠化 | 显示“叠化要求有限片段”；不显示成参数过渡 |
| D14 | 叠化重叠区 + 循环折返 | 显示“重叠区按片段局部时间执行”；不把上一圈 opacity 中间态带到下一圈 |
| D15 | 叠化 + morph 共存 | 显示“morph 优先区间 / 叠化仍可见 / 完全遮蔽”；不显示“已自动二选一” |

## E. 玩家移动

| # | 场景 | 通过条件 |
|---|---|---|
| E1 | 1 个 Position | 1 行；anchor；`moving=false`；提示至少两个目标 |
| E2 | 2 个绝对目标 | 折线 1 段；目标角色/时间正确 |
| E3 | 2 个相对目标 + 预览原点 0/0 | world = dx/dz；表头标“预览世界坐标” |
| E4 | 预览原点改 10/5 | world 平移；JSON 不变；session 不写盘 |
| E5 | relative 未设原点 | 用 0/0；提示“运行时以脚本启动位置为准” |
| E6 | 超界记录 | 不入表/不入图；显示丢弃 N 条 |
| E7 | 同刻目标 | 轨道/片段/记录顺序稳定；不合并 |
| E8 | 播放头早晚 | 早于 anchor 不高亮；晚于最后目标显示“已到末目标” |
| E9 | 点击目标 | 选中 EVENT 片段 + seek；事件 JSON 不变 |
| E10 | 宏循环 | 显示“折返复位到第一段”；不伪造第二圈 |
| E11 | MOD_EVENT | 不进入目标表；显示忽略提示 |
| E12 | 只读 | 不写 `objects.event`；事件编辑仍归 06-07 |

## F. 回放闭环

| # | 场景 | 通过条件 |
|---|---|---|
| F1 | 校验 | `script.validate` 的 `doc` 是对象；`ok=false` 阻止推送 |
| F2 | 推送 | `editor.pushScript` 的 `script` 是字符串；完整脚本；只发一次 |
| F3 | 跳转 | 推送后发 `editor.seek`，time 为主时间轴播放头 |
| F4 | 播放/暂停/停止 | 只发对应消息；状态以 `playback.state` 为准 |
| F5 | 无回执 | `seek` 后 2 秒无 `playback.state` 显示提示；不重复推送/不轮询 |
| F6 | `error` | 显示错误文本；状态 `error`；可重试 |
| F7 | 文档 revision 变化 | `valid` 回 `ready`；播放保留但提示需重新推送 |
| F8 | 断线 | 按钮禁用；文档/播放头保留；重连可重新校验 |
| F9 | 真实画面 | 叠化/参数过渡/共存/lane/呼吸在编辑器预览可见；玩家移动在游戏正常播放时验证（编辑器预览不驱动） |
| F10 | 消息面 | 只使用既有 6 个 C→S 消息 + 3 个 S→C 消息（校验结果/播放状态/错误）；无新增 type |
| F11 | 模组零改动 | 不调用 `editor.setCamera` / `editor.enter_flight_mode`；不改模组 `.java` |

## G. 结构

| # | 检查 | 通过条件 |
|---|---|---|
| G1 | 面板数量 | 新增 `camera.inspect` 与 `transition.panel` 两个插件面板；不新增镜头页/合成页/连续性页/转场页 |
| G2 | 面板归属 | 属性面板列全部适用字段；效果面板只列有关键帧的叶子；`transition.panel` 只做交界编辑；`camera.inspect` 只列派生视图 |
| G3 | 无第二份值 | `camera.inspect` / `transition.panel` 不复制字段值、不缓存 `ScriptDoc`；面板选中态只存 session |
| G4 | 主时间轴 | 不新增 lane 轨、叠化节点、参数过渡节点、属性节点、值控件、交界手柄 |
| G5 | 播放头 | `camera.inspect` 跟随主时间轴；`transition.panel` 不创建第二个时钟 |
| G6 | 组件边界 | 面板只 import `@workbench/api`、08 模块和共享 UI；不 import 文档 store/另一个面板组件 |
| G7 | 禁用锚点 | 已冻结的禁用组件/字段集合零命中；01–07 的锚点扫描保持通过 |
| G8 | 构建 | `npm run build` 通过；新增面板懒加载，不全部进首屏包 |
| G9 | 主题 | 面板 token 化；无写死 hex；深浅色均可读 |
| G10 | 无障碍 | 表/tab/按钮有标签；键盘可切换 tab/操作按钮；错误不只靠颜色 |

## H. 数据与序列化

| # | 检查 | 通过条件 |
|---|---|---|
| H1 | `transition_params` | 单个 `objects` 路径；内部对象；不拆成六个 `AnimObject` |
| H2 | `authoring` | 不写 lane/视图/选中/tab/窗口示意/播放状态/交界选中 |
| H3 | 缺省 | 不把默认值补进 JSON；清除覆盖删除空对象 |
| H4 | 未知字段 | 未知键/未知通道保留供诊断；不静默删除 |
| H5 | round-trip | 保存→重开→再保存，字段值/嵌套/曲线/事件记录一致 |
| H6 | 无新增顶层字段 | 不写版本号、总时长、片段级曲线、lane 数组、交界数组 |

## I. 模组零改动

在 `E:\Documents\GitHub\ImmersiveCinematics`：

```text
git status --porcelain
```

通过条件：

- 没有任何 `.java` 修改；`TransitionSpec` / `TransitionParams` / `CameraChannels` / `CameraTrackPlayer` / `PlayerMoveController` / `WebEditorApi` 保持原样。
- 没有新增消息类型；没有新增脚本字段；没有新增 `path.sample`/`camera.push`/`camera.frame`。
- 编辑器仓库的 `.ts/.vue/.json` 只新增 08 模块与配置；05-13 只追加 `core.transition-panel` 登记，01–07 其余合同不改。

## J. 真游戏冒烟

准备一份脚本：

```text
CAMERA 1 A：0–6s，全屏，transition=morph，transition_duration=0.5
CAMERA 2 B：3–7s，全屏，start_time 已前移到 3；composite.opacity 本地 0=0、本地 3=1
CAMERA 3 C：10–12s，全屏
EVENT：Position 两个相对目标
```

A 的 morph 窗口在 6s 附近（5.75–6.25），与叠化重叠区 3–6 部分相交；这是“共存 + 部分遮蔽”用例。B 结束后到 C 之前保留 3 秒间隙，用来验证 crossfade 只移动 B、不移动后续片段。

步骤：

1. 编辑器打开脚本，`transition.panel` 出现 `A→B` 交界，状态“共存”；叠化详情显示 3.000s，参数过渡详情显示 0.500s；lane 表、连续性、玩家移动、回放 tab 都有真实内容。
2. 校验通过；推送并 seek 到 2.9s：只有 A 一条 lane，B 未开始；画面是 A。
3. seek 到 3.0s：lane 表 2 行，A `single` 在下 opacity 1，B `crossfade` 在上 opacity 0；游戏画面仍以 A 为主。
4. seek 到 4.5s：B 的 opacity 约 0.5；游戏画面同时可见 A/B，A 保持不透明，B 半透明叠在上层。
5. seek 到 5.9s：进入 A→B 的 morph 窗口；lane 表 1 行 `morph`（A→B）；游戏画面按六参数混合，不是两张画面叠化；面板显示“叠化部分被遮蔽”。
6. seek 到 6.4s：A 已结束且 A→B 的 morph 窗口已结束；lane 表只剩 B 一条（`single`）；游戏画面是 B。
7. seek 到 7.0s：B 已结束；A/B 都不活跃，`lanes=[]`，面板显示间隙；游戏画面无 CAMERA lane。
8. seek 到 10.1s：只有 C 一条 lane（`single`）；游戏画面是 C。
9. play 到结尾：呼吸按脚本执行；保存脚本后在游戏正常播放该脚本验证玩家移动（编辑器预览不驱动）；停止后状态回 `stopped`。
10. 打开 `transition.panel`，点“仅保留叠化”：A 的 `transition` 写 `cut`；一次撤销回退。再点“仅保留参数过渡”：B 回 A.end、删除两端 opacity 帧；A 的 `transition` 不变；一次撤销回退。
11. 保存重开：A/B 的 `start_time`、B 的两端 opacity 帧、`transition_params`、事件目标、播放头不丢；JSON 无 lane/UI 字段。

通过条件：以上 11 步全通过；任何一步失败按对应 A–H 项定位，不以面板伪造结果替代游戏结果。

## 签收

- 10 份文档齐全，README 链接有效。
- A–H 全通过；I 零改动；J 真游戏冒烟通过。
- 验收记录只写真实结果；没有“理论通过”代替实测。
