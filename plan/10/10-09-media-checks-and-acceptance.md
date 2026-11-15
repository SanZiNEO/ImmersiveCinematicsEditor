# 10-09 媒体检查、错误状态与验收

## 目标

把 10 的静态检查落到字段、组头和资源抽屉里，并给出验收矩阵。

检查分两类：

1. **文档检查**：当前脚本能判定的字段、引用、重叠、监听、曲线、LUT 问题；
2. **资源抽屉状态**：`resource.list` 的加载、失败、空目录、2000 条上限。

编辑器不伪造游戏运行时状态：ffmpeg 是否存在、音频解码是否成功、LUT 是否烘焙成功，不在编辑器里造状态。

## 检查模型

复用 06-10 的对象诊断：

```ts
interface MediaIssue {
  id: string
  code: string
  severity: 'block' | 'error' | 'warn' | 'info'
  clipKey?: string
  objectPath?: string
  message: string
  source: 'local'
  panel: 'properties' | 'effects'
  fix?: { kind: 'focus' | 'drawer' | 'timeline' | 'script-properties'; target?: string }
}
```

- 文档检查只读当前 `doc` 与资源快照，不修改文档；
- `id` 由 `code + clipKey + objectPath` 生成，重算稳定；
- 同一路径多条问题聚合到行，组头显示最高级别；
- 资源抽屉错误不进 `MediaIssue`，只做抽屉状态；
- 服务端返回的同 code issue 覆盖本地 issue，保留 server 消息。

## 检查清单

### 资源引用

| code | 检查 | 级别 | 处理 |
|---|---|---|---|
| `M01` | `OVERLAY` image `path` 不在资源列表 | warn | 字段行黄点；“未找到文件” |
| `M02` | `OVERLAY` `path` 扩展名不是图片/视频 | error | 字段行红框；阻止推送 |
| `M03` | `AUDIO` `sound` 为空 | block | 音源行红框；阻止保存/推送 |
| `M04` | `AUDIO` `source=file` 文件不在资源列表 | warn | 音源行黄点 |
| `M05` | `AUDIO` `source=file` 扩展名不在白名单 | error | 音源行红框；阻止推送 |
| `M06` | `ADJUST` `lut` 不在资源列表 | warn | LUT 行黄点 |
| `M07` | `ADJUST` `lut` 扩展名不是 `.cube` | error | LUT 行红框；阻止推送 |
| `M08` | `ADJUST` `lut` 路径含绝对路径/盘符/`..` | block | 拒绝提交 |
| `M09` | `source=minecraft` 的 `sound` 未在声音注册表 | warn | 音源行黄点 |
| `M10` | `source` 与 `sound` 取值域不匹配 | warn | 音源行提示“需要重新选择” |

### 音频

| code | 检查 | 级别 | 处理 |
|---|---|---|---|
| `M11` | `fade_in + fade_out > duration` | warn | 包络行黄点；“运行时会整段跳过” |
| `M12` | `AUDIO` 同轨片段重叠 | warn | 片段头“同轨只播第一个活跃片段” |
| `M13` | `meta.listener=camera`，脚本无 `CAMERA` 片段 | warn | 监听卡黄点 |
| `M14` | `meta.listener=camera`，播放头无活跃 `CAMERA` 片段 | info | 监听卡“当前回落玩家” |
| `M15` | `category=music` 且 `x/y/z` 非零 | info | 空间组“music 不读，值保留” |
| `M16` | `volume/x/y/z` 非有限 | block | 拒绝提交 |

### 调色

| code | 检查 | 级别 | 处理 |
|---|---|---|---|
| `M17` | 调色通道越界 | block | 行红框；拒绝提交 |
| `M18` | `lut_input_gamma<=0` | block | LUT 行红框 |
| `M19` | `ADJUST` 同轨片段重叠 | warn | 片段头“后片段不参与调色” |
| `M20` | 同脚本多条 `ADJUST` 轨 | warn | 片段头“后发布轨覆盖前轨” |
| `M21` | 曲线少于 2 点 / `x` 非严格递增 / 越界 | block/error | 编辑时 block；已存在非法数据 error |
| `M22` | 曲线强度有值、曲线为空 | info | 摘要“曲线未定义，强度不生效” |
| `M23` | `lut_strength` 有值、`lut` 为空 | info | LUT 组“未选择 LUT，不生效” |
| `M24` | `blend_mode` 非法 | block | 拒绝提交 |
| `M25` | `CAMERA` 出现 LUT/混合字段 | block | 不允许写入；不显示字段 |

### 资源抽屉

| 状态 | 级别 | 处理 |
|---|---|---|
| `resource.list` 首次加载 | loading | 骨架；“正在读取资源” |
| `resource.list` 请求失败 | error | 抽屉错误条 + 重试；保留上次成功结果 |
| 目录不存在/0 文件 | empty | “此目录没有文件”；不报缺失 |
| `dir` 越界 | error | 回资源根；不继续请求越界路径 |
| `kind` 非法 | error | 不发送请求；显示合法 kind |
| 达到 2000 条 | warn | 黄条“可能未列全”；缺失检查暂停 |
| 语言文件格式错误 | error | 语言页签显示错误文件；不写文件 |
| 当前选中文件消失 | info | 清空选中；不自动改脚本字段 |

## 缺失检查的暂停条件

以下情况不能把“文件不在列表”判成“文件不存在”：

- `resource.list` 请求失败；
- 资源列表达到 2000 条上限；
- 当前 `dir` 不是资源根，且引用路径不在当前目录；
- 资源服务尚未完成首次加载。

处理：

- `M01/M04/M06` 降级为 `unknown` 或暂停；
- 资源抽屉顶部显示“资源列表未完成，缺失检查暂停”；
- 不生成“缺失”行、不把字段标红；
- 请求成功且全量列表可用后，再重算。

这条规则避免把“没列出来”误判成“文件没了”。

## 定位

| 问题 | 定位目标 |
|---|---|
| `M01/M02` | `selection.properties` 的 `path` 行 |
| `M03/M04/M05/M09/M10` | `selection.properties` 的音源组 |
| `M11` | 包络组 |
| `M12/M19` | 片段头重叠条 / 时间轴对应片段 |
| `M13/M14` | 脚本属性监听卡 |
| `M17/M18/M20/M23/M24` | 属性面板对应组 |
| `M21/M22` | `curves` 抽屉对应页签 |
| `M25` | 不显示 LUT 字段；提示“CAMERA 不支持 LUT” |
| 资源列表错误 | `resources` 抽屉顶部 |

- 点击“定位”调用 06-10 的 `revealIssue`；
- 属性问题打开 `selection.properties` 并展开组；
- 动画问题打开 `clip.effects` 并选中节点；
- 曲线问题打开 `curves` 抽屉，选中对应曲线页签；
- 定位不修改文档、不新增选择、不改播放头。

## 检查面板

`resources` 抽屉的“检查”页签：

```text
┌ 检查 ──────────────────────────────┐
│ [当前片段] [全局]    3 errors · 2 warnings │
│ ─ 资源 ─────────────────────────── │
│ M01 image/title.png 未找到      [定位] │
│ M07 lut/teal.png 不是 .cube     [定位] │
│ ─ 音频 ─────────────────────────── │
│ M11 fade 2+2 > duration 3       [定位] │
│ M12 AUDIO 1 同轨重叠 1.2s       [定位] │
│ ─ 调色 ─────────────────────────── │
│ M21 rgb_curve x 非递增          [定位] │
│ M20 同脚本 3 条 ADJUST 轨       [定位] │
└────────────────────────────────────┘
```

- 默认“当前片段”；切“全局”显示整份文档；
- 组按资源/音频/调色分段；
- 每条显示 code、短消息、定位；
- 顶部计数按最高级别；
- 无问题时显示“当前范围无问题”，不显示空白面板。

## 验收矩阵

| # | 场景 | 预期 |
|---|---|---|
| 1 | 新建 `AUDIO` | 13 个字段全部可见；无 `OVERLAY`/`ADJUST` 字段 |
| 2 | `AUDIO` `source=file` 选 `audio/theme.ogg` | 写入相对路径；资源列表命中；字段无缺失 |
| 3 | `AUDIO` `source=minecraft` 选注册表 ID | 写入 ID；未注册 ID 只 warn |
| 4 | `source` 切换 | 原 `sound` 保留；标“需要重新选择”；不自动改写 |
| 5 | `file_loop=true` + 片段 `loop=true` | 两处循环分别显示；不合并 |
| 6 | `fade_in=2`、`fade_out=2`、`duration=3` | `M11` 警告；运行时会整段跳过 |
| 7 | 同轨 `0–5s` / `2–7s` | `M12` 警告；只第一段起播；拆轨后两段可播 |
| 8 | 同轨 `0–5s` / `4–8s`，前段 `fade_out=2` | 后段起播，前段尾音重叠；UI 不标双活跃 |
| 9 | `meta.listener=camera`，无 CAMERA 片段 | `M13` 警告；“始终回落玩家” |
| 10 | `meta.listener=camera`，播放头在 CAMERA 空档 | `M14` info；“当前回落玩家” |
| 11 | `category=music`、`x=5` | `M15` info；值保留；切 ambient 恢复 |
| 12 | 选中 `CAMERA` | 57 通道 + 10 曲线；无 LUT/混合 |
| 13 | 选中 `ADJUST` | 59 通道 + 10 曲线 + LUT/混合 |
| 14 | `exposure=6` | `M17` block；拒绝提交 |
| 15 | `rgb_curve` 只有 1 点 | `M21` block；不写非法曲线 |
| 16 | `rgb_curve` 的 `x` 倒序 | `M21` error/block；保留上次合法形状 |
| 17 | `lut` 选 `.png` | `M07` error；阻止推送 |
| 18 | `lut` 不存在 | `M06` warn；不阻止保存 |
| 19 | `lut_input_gamma=0` | `M18` block |
| 20 | 同脚本两条 `ADJUST` 轨 | `M20` warn；“后发布轨覆盖前轨” |
| 21 | 同轨两个 `ADJUST` 片段重叠 | `M19` warn；后片段不参与调色 |
| 22 | 资源抽屉 `kind=all` | 图片/视频/音频/LUT/语言/其他分类正确 |
| 23 | 当前焦点在 `OVERLAY path`，选 `.cube` | 填入按钮禁用；提示类型不兼容 |
| 24 | 资源请求失败 | 抽屉错误条；旧列表保留；缺失检查暂停 |
| 25 | 资源列表返回 2000 条 | 黄条“可能未列全”；不把未列出文件标缺失 |
| 26 | 语言页签 | 显示语言代码/key；无编辑/删除按钮 |
| 27 | 保存重开 | 所有音频/调色/LUT/曲线字段原样恢复；无新增字段 |
| 28 | 构建 | `npm run build` 通过；无 TypeScript/模板编译错误 |
| 29 | 通道检查 | 没有新增消息类型；没有新增脚本字段；没有改模组 `.java` |
| 30 | 真游戏播放 | 编辑器生成的脚本能被游戏加载；音频/调色/LUT 按游戏实际播放呈现 |

## 交付判定

- 29 项通过、30 项按游戏实际播放确认后，10 才算交付。
- 第 28 项构建失败时，不以文档验收代替构建结果。
- 第 30 项只记录游戏实际播放结果，不用编辑器预览代替。
