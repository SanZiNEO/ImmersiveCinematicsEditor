# 13-02 黄金脚本与负例

## 目的

黄金脚本是 13 的固定输入，不是演示样例。它要满足三个条件：

1. 覆盖 02～12 的字段面和主要组合，不靠“临时手写一个看起来像”的脚本；
2. 能被真实 `ScriptParser` / `ScriptValidator` 解析、校验，能被真实游戏播放；
3. 每次验收使用同一份输入，结果可重复、可对比、可回退。

13 不建立第二套 schema，不建立“验收专用运行时”。黄金脚本只是普通脚本 + 期望行为说明。

## 夹具目录

建议的目录结构：

```text
plan/13/fixtures/
├ golden/
│  ├ 01-minimal-meta-seven-tracks.json
│  ├ 02-camera-lanes-transitions.json
│  ├ 03-async-objects.json
│  ├ 04-paths-curves.json
│  ├ 05-overlays-subtitles.json
│  ├ 06-audio-color-media.json
│  ├ 07-triggers-rules-events.json
│  ├ 08-templates-flight-subtitles.json
│  ├ 09-full-showcase.json
│  ├ 10-graph-references.json
│  ├ 11-ui-stress.json
│  └ 12-recovery-and-errors.json
├ negative/
│  ├ bad-meta-missing-author.json
│  ├ bad-legacy-version-total-duration.json
│  ├ bad-clip-level-keyframes.json
│  ├ bad-track-type.json
│  ├ bad-path-endpoints.json
│  ├ bad-curve-control-points.json
│  ├ bad-subtitle-overlap-same-track.json
│  ├ bad-transition-as-clip-field.json
│  ├ bad-resource-missing.json
│  └ bad-rule-binding-target.json
└ expected/
   ├ 01-minimal.expected.md
   ├ 02-camera.expected.md
   └ ...
```

夹具文件是 13 的验收资产；13 文档先冻结清单和期望，实际 JSON 在实施/验收阶段补齐。未补齐的夹具在总账里标 `NOT RUN`，不能标 `PASS`。

## 公共约束

所有正例必须满足：

- `meta` 有 `author`；不写 `version` / `total_duration`；
- 顶层只有当前运行时接受的集合：`meta`、`timeline.tracks`、`rules`、`rule_bindings`、`paths`（按实际脚本形状）；
- 轨道类型只用当前七类：`CAMERA`、`OVERLAY`、`AUDIO`、`ADJUST`、`LETTERBOX`、`EVENT`、`MOD_EVENT`；
- 对象字段只用 02 目录里的 path，不写不存在的字段；
- 动画对象用 `keyframes`；值对象用 `value`；事件对象用事件记录；
- 路径端点来自目标片段 `position.x/y/z` 关键帧时间并集，且相邻；
- 控制点必须是 `{x,y,z}` 或 `{dx,dy,dz}`，不能是数组；
- 资源路径是相对 `immersive_cinematics/resource/` 的路径，不使用绝对路径、盘符、`..`；
- 字幕 `text` 是 value；`@lang:` / `@@lang:` 按 12 口径；不写颜色/字体族/描边/背景/对齐；
- 模板产物是普通脚本，不写模板 id/来源/再生成记录；
- 转场是 A→B 交界操作的结果，不写“片段内转场对象”；`transition*` 只是相机六参数 morph；
- 飞控槽是编辑器侧状态，不写进脚本；写回的是普通相机关键帧/模板/路径；
- 不写 AUI 专属字段、进程内端点、GPU 帧源字段。

所有负例必须明确期望：

- 被 `ScriptParser` 拒绝；或
- 被 `ScriptValidator` 报 issue；或
- 被编辑器本地结构检查拦截；
- 三者不能含糊成“应该会报错”。

## 正例清单

### 01 · 最小 meta + 七轨

覆盖：

- `meta.author`、`meta.base_resolution` 缺省、`meta.listener`；
- 七类内置空轨，或每类一条空片段；
- 无 `version`、无 `total_duration`；
- 保存后重开，轨道顺序和空轨保留。

期望：

- 真实解析/校验通过；
- 游戏能加载，时间轴为空/极短时不出错；
- 编辑器不补写 `total_duration`；
- 不出现“空 triggers”被当成错误。

### 02 · CAMERA lane / 转场 / 呼吸

覆盖：

- 两条 CAMERA 片段，A→B 叠化：A 不动，B 前移，`composite.opacity` 在重叠区 0→1；
- 一条 `transition=morph` 的相机六参数过渡；
- 叠化与 morph 共存的区间；
- `cam_breath_*`；
- `modifier` 覆盖链；
- `dest/source` 归一化矩形，不读 `base_resolution`。

期望：

- 转场面板能识别交界，不把转场当片段字段；
- 叠化在游戏里是“叠化/crossfade”，不是“叠画”；A 保持不透明，B 淡入；
- morph 只作用于相机六参数；
- 共存时面板显示 morph 优先区间与叠化可见区间；
- lane 视图显示叠化双 lane / morph 单 lane。

### 03 · 异步对象 / 关键帧 / 事件

覆盖：

- 各轨道 `animated` 字段的关键帧；
- `value` 字段；
- `step` / `null` / `enum` / `ref` / `struct`；
- `position.xyz` 同刻三轴帧；
- `EVENT` / `MOD_EVENT` 记录；
- 轴外关键帧（时间超出片段显示范围）；
- 关键帧删空后回属性面板。

期望：

- 效果面板只列有关键帧的叶子；
- 属性面板列全部适用叶子；
- 主时间轴不出现对象行/关键帧菱形/属性节点；
- 轴外帧可定位、编辑、撤销、保存；
- 事件记录非空约束和字段白名单正确。

### 04 · 路径 / 曲线

覆盖：

- `paths[]` 的 A/B 相邻端点；
- 11 种几何中的代表集：`linear`、`bezier`、`rational_bezier`、`arc`、`ellipse`、`bspline`、`nurbs`、`catmull_rom`、`hermite`、`clothoid`、`fourier`；
- 12 的线/抛物/S 形状；
- 控制点 `{x,y,z}` / `{dx,dy,dz}`；
- `axes` 单轴/双轴；
- `timing=linear/keyframes`；
- 弧长重采样后的节点。

期望：

- 路径集合面板能打开、编辑、定位；
- 端点不合法时被拦截；
- 控制点数组写法被拒绝；
- 生成器只写 `objects` / `paths`，不改运行时；
- 预览形状与游戏结果不冲突；最终以游戏为准。

### 05 · 覆盖层 / 字幕 / 画幅

覆盖：

- `fade` 颜色/遮罩/渐变/混合；
- `image` 的 png/gif 与 mp4/webm/mkv 路径；
- `subtitle` 的 `text/font_scale/x/y/anchor_x/anchor_y/scale_x/scale_y/opacity/z_index`；
- `LETTERBOX` 画幅比/透明度；
- 多轨 `z_index` 冲突；
- 字幕 `@lang:` 查表、`@@lang:` 转义、`\n`、alpha<4 不绘制。

期望：

- `fade` 不被当成 crossfade；
- `image` 视频路径能走视频层，不要求 ffmpeg 才允许保存；
- 字幕固定白色，不出现颜色/字体族/描边/背景/对齐字段；
- `z_index` 只做层级排序提示，不建全局 z 表；
- LETTERBOX 在最底层，OVERLAY 按 z 升序。

### 06 · 音频 / 调色 / 媒体

覆盖：

- `AUDIO` 的 file/minecraft 音源、循环、fade_in/out、空间参数；
- `meta.listener`；
- `CAMERA` 的 57 个调色通道 + 10 曲线；
- `ADJUST` 的 59 个通道 + 10 曲线 + LUT + 层混合；
- `.cube` LUT 路径与强度；
- 资源抽屉的图片/视频/音频/文本列举；
- 截断标记；
- 无 ffmpeg 时的外部音频错误提示。

期望：

- 音频在游戏里能播放/循环/淡入淡出；
- 同轨重叠有提示；
- CAMERA 调色只作用该 lane，ADJUST 作用合成输出；
- LUT 错误不静默；
- 资源列举与实际运行时能力一致；
- 没有 ffmpeg 时，外部格式不假装能播。

### 07 · 触发器 / 规则 / 事件

覆盖：

- `meta.triggers` 的声明、id、requires、条件树、delay/repeatable/on_enter/exit_buffer/poll/continuity；
- 跨脚本前置；
- `rules` / `rule_bindings`；
- 九种规则动作；
- `gate.at`、control、schedule、exit；
- `EVENT` / `MOD_EVENT` 的时间轴标记和 seek；
- 脚本图节点悬停显示全部触发器与前置。

期望：

- 触发器是脚本的触发器，不是片段属性；
- 触发器没有动作/目标选择器；触发后固定播放给触发者；
- `requires` 是 AND，自定义前置只读但可定位；
- 规则/绑定是父子关系；
- 事件记录与规则动作不混成一套表单；
- 悬停摘要包含跨脚本前置。

### 08 · 模板 / 飞控 / 字幕工作流

覆盖：

- `clip.fade`、`clip.static_breath`、`clip.dolly`、`clip.orbit_arc`；
- `track.orbit_full`、`track.multi_cam`；
- `script.blank`、`script.camera_intro`、`script.follow_black`；
- 模板嵌套/参数/diff/插入目标；
- 飞控九槽：`flight.inputs` 3×3，世界姿态，应用到关键帧/模板/路径；
- 字幕导入→批次→编译→游戏播放。

期望：

- 模板产物是普通脚本，去掉模板来源后仍能播放；
- 片段/轨道模板不写片段级 `transition*`，不自动 crossfade；
- `orbit_arc` 的 `sweep≤120`；`orbit_full` 的分段参数错误可诊断；
- `multi_cam` 是硬切，不写转场；
- 飞控不改现有 10Hz 回推/退出写回/HUD 钳制；
- 字幕批次就是字幕轨道，不建 sidecar。

### 09 · 全量展示脚本

把 01～08 的代表内容合成一条完整短片：

- 片头黑场 → 镜头引入 → 跟拍 → 多机位/环绕 → 覆盖层/字幕 → 调色/LUT → 音频 → 触发器/规则 → 结束；
- 覆盖层与字幕有重叠区；
- 至少一条叠化、一条 morph；
- 至少一条路径、一条曲线；
- 至少一条事件记录；
- 至少一条跨脚本前置。

期望：

- 真实游戏能连续播放；
- 播放/暂停/seek 不崩；
- 保存/重开/推送不丢字段；
- 不出现主时间轴对象行或第二套时间轴。

### 10 · 图引用脚本集

覆盖：

- 3～5 个脚本，A requires B/C，D 自定义前置；
- 文件夹泳道；
- 悬空/重复/自引用各一条；
- 移动/重命名后引用仍可定位；
- `meta.id` 改写只影响真实引用。

期望：

- 图节点=脚本、边=requires、泳道=文件夹；
- 悬停显示全部触发器/前置；
- 依赖诊断分级正确；
- 移动只改路径，不改 `meta.id` / requires 文本；
- 坏引用不被静默修掉。

### 11 · UI 压力脚本

覆盖：

- 单片段 100+ 属性叶子；
- 多组多属性同时有关键帧；
- 长属性名、长片段名、长脚本名；
- 200+ 片段/轨道；
- 轴外帧、深层条件树、长字幕文本；
- 小窗口 + 停靠/换位。

期望：

- 主时间轴选中 100+ 属性片段时轨道高度不变；
- `clip.effects` 多组展开左右行对齐，切换选中不隐藏其他组；
- 局部标尺与全局缩放互不重置；
- 轴外帧编辑不动主轴片段宽度/时长/全局视口；
- 虚拟化/滚动可用，不卡死；
- 小窗下不抢 IME/输入焦点。

### 12 · 恢复与错误脚本

覆盖：

- 脏文档关闭三选一；
- 保存失败不关窗；
- 坏布局恢复；
- 坏偏好恢复；
- 草稿恢复；
- 断连/重连；
- token 缺失/错误；
- 脚本保存为 `.txt` 被拒；
- 资源缺失。

期望：

- 坏一个文件只恢复一个；
- 关闭失败不丢文档；
- 断连不把未保存内容清空；
- 错误在状态栏/面板可见，不静默；
- 重连后能重新取 token / 重新握手；
- 保存路径扩展名错误有明确 error。

## 负例清单

| 负例 | 期望拒绝点 | 期望信息 |
|---|---|---|
| `bad-meta-missing-author.json` | `ScriptValidator` / parser | 缺 author，指出 meta |
| `bad-legacy-version-total-duration.json` | 当前合同 | `version/total_duration` 不属于目标文档形状，拒绝或剥离策略按 03；不能静默当有效 |
| `bad-clip-level-keyframes.json` | 结构检查 | 关键帧只能在 `objects[path].keyframes`，不能在片段顶层 |
| `bad-track-type.json` | parser/validator | 未知轨道类型，列出合法七类 |
| `bad-path-endpoints.json` | 路径集合检查 | 端点不在目标片段位置帧并集，或不相邻 |
| `bad-curve-control-points.json` | 几何表单/validator | 控制点必须是 `{x,y,z}` / `{dx,dy,dz}`，数组拒绝 |
| `bad-subtitle-overlap-same-track.json` | 字幕批次检查 | 同轨 `[start,end)` 重叠，必须分轨 |
| `bad-transition-as-clip-field.json` | 结构/转场检查 | 转场不是片段字段；`fade` 不是 crossfade |
| `bad-resource-missing.json` | 资源/校验 | 路径不存在，明确指出资源根和相对路径 |
| `bad-rule-binding-target.json` | 规则绑定检查 | 目标片段不存在 / `gate.at` 超出片段 |

负例不是“越乱越好”。每个负例只引入一个错误，避免多个错误互相掩盖。

## 期望文件

每个夹具配一份 `expected/*.md`，至少写：

- 输入目的；
- 必须通过的解析/校验点；
- 必须出现的 UI 行为；
- 必须出现的游戏行为；
- 明确不要求的行为（例如不要求纯数据模板、不要求字幕样式批处理）；
- 失败时回退轮次。

期望文件不写“未来执行者填”。当前能定的就写，不能定的标 `待定` 并说明缺什么。

## 夹具维护

- 夹具一旦用于发布验收，不随手改；需要改时先改期望，再改夹具，并在总账记录变更。
- 夹具不使用绝对路径、机器名、用户目录、token、截图缓存。
- 夹具资源文件必须随仓库提供，或明确标“外部素材待补”；不能用一个不存在的路径假装通过。
- 夹具的脚本哈希记录在 13-01 执行表；同一 ID 复验必须使用同一哈希。
- 黄金脚本不是“最终画面”的替代；最终画面仍以真实游戏播放为准。

## 完成标准

- 正例 12 份、负例 10 份清单冻结；
- 每份正例有期望文件；
- 每份负例有唯一错误点和期望拒绝点；
- 至少 01、02、03、05、09 已真实解析/校验，并在 Forge/Fabric 各跑一次；
- 未执行的夹具在总账标 `NOT RUN`，不进入发布证据。
