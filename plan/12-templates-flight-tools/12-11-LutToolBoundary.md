# 12-11 LUT 工具的责任边界（含 WebUI 最小闭环）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案）。
> 轮次：12-templates-flight-tools。前置：10（ADJUST/LUT 字段与调色面板）、03（预览帧）、02（文档事务）。
> 本文件是**边界文件**：先定谁做什么，再定最小工具；不允许把「调色编辑」或「运行时解析」搬进本轮。

## 1. 职责

1. 明确 LUT 的四个角色：**作者制作**（外部工具）→ **编辑器引用**（ADJUST 字段）→ **运行时解析与应用**（主模组）→ **修正工具**（本文件的 WebUI 专属能力）。
2. 定义「修正 `.cube`」工具的最小闭环与禁止项。
3. 写清两宿主的能力差异与入口可见性。

## 2. 现状（现有文件 + 符号 + 行）

| 位置 | 事实 |
|---|---|
| `J:script/CubeLut.java:19–47` | `.cube` 解析器：Adobe/IRIDAS 1.0；`LUT_1D_SIZE/LUT_3D_SIZE`、`DOMAIN_MIN/MAX`、`LUT_*_INPUT_RANGE`、注释；未知指令报错；值不钳制 |
| `J:script/CubeLut.java:31–38` | 合成表 `composed3D()`：1D+3D 烘焙成单张表（上限 64³），1D 在前、3D 在后 |
| `J:script/CubeLutLoader.java` | 按片段引用加载（`Clip.java:266` 注释：只存文件名，解析结果由 loader 提供） |
| `J:client/post/ColorAdjustPass.java:237,474–540` | GPU 上传（16 位浮点）、按实例引用去重、失败跳过 LUT 步骤并记日志 |
| `MOD:docs/SCRIPT_FORMAT.md:601` | `lut_strength`（ANIMATED，默认 1.0） |
| `MOD:docs/SCRIPT_FORMAT.md:633–634` | `lut`（VALUE string）、`lut_input_gamma`（VALUE float，默认 1.0） |
| `MOD:docs/LUT_WORKFLOW.md:1–6` | 已被标注「过期文档，不得作为实施依据」；但 §一 的「输入域不匹配」现象仍是真实问题 |
| `MOD:J:webui/ResourceFileService.java:30–40` | `resource.list` 只列举 `lang/image/audio/all`；**不返回文件内容**，也无写通道 |
| `EDITOR:electron/main.cjs:1–45` | Electron 主进程只有 `webui:token` 与窗口控制 IPC；无文件对话框能力 |
| `EDITOR:src/components/Preview.vue:103–133` | 预览帧已在 canvas 上（可作为捕获源） |
| `MOD:docs/SCRIPT_FORMAT.md:558–648` | ADJUST 全字段（含 `lut`/`lut_input_gamma`/`lut_strength`/`blend_*`） |

## 3. 角色分工（冻结）

| 环节 | 归属 | 依据 |
|---|---|---|
| 制作/调色/导出 `.cube` | 外部工具（DaVinci 等） | 运行时只读只执行 |
| 解析 `.cube`（1D/3D/DOMAIN/INPUT_RANGE） | 主模组 `CubeLut` | 已是唯一权威 |
| 合成与 GPU 应用 | 主模组 `ColorAdjustPass` | 同上 |
| 脚本字段 `lut` / `lut_input_gamma` / `lut_strength` | 10 的调色面板（ADJUST 轨） | `shared/product-and-layout.md` §3.4 |
| 文件放置（拷进 `resource/`） | 作者手动 | 编辑器无写游戏目录通道 |
| **修正工具**（输入域/分区的辅助换算与 `.cube` 导出） | 12（本文件，WebUI 专属） | 创作辅助，不参与播放 |
| 游戏内宿主 | **不提供**修正工具 | 无文件系统访问（`shared/contracts.md` C05） |

## 4. 最小闭环（WebUI）

### 4.1 流程

1. **取帧**：从预览 canvas 抓一帧（`toDataURL`/`getImageData`），或用户导入一张 PNG。帧尺寸 = 1920×1080（宿主固定推流）。
2. **导入 LUT**：文件对话框选 `.cube` → 编辑器解析（仅用于预览与换算）。
3. **对照**：左原图 / 右应用后（近似）；显示 `lut_input_gamma`、DOMAIN、尺寸、1D/3D 段信息。
4. **调输入域**：作者调 `input_gamma`（0.2–5.0）与 DOMAIN 缩放/偏移；实时看近似结果。
5. **导出**：写出**修正后的 `.cube`**（把输入域变换烘焙进数据，或改写 `DOMAIN_*`/`LUT_*_INPUT_RANGE`，二选一并在文件头注释说明）。
6. **回填**：提示作者把文件放进 `<游戏目录>/immersive_cinematics/resource/`，再在 10 的面板里填 `lut` 字段；工具**不自动改脚本**（可由作者点「复制字段值」）。

### 4.2 技术边界

| 项 | 约束 |
|---|---|
| 解析实现 | 编辑器读取器仅服务近似预览/显式换算，按运行时支持指令和数据形态读取；人工导入实际cube、观察尺寸/域/提示与游戏应用，不建设自动对拍 |
| 应用近似 | 三线性插值 + 1D 先于 3D；合成表按运行时口径（1D+3D → 单表）**近似**实现，允许与 GPU 结果有微小差异。UI 必须标注「编辑器近似预览，最终以游戏内为准」。 |
| 写出 | 通过 Electron 主进程新增的**编辑器内部 IPC**（`file:saveCube`）走系统保存对话框；不经过主模组协议。 |
| 读取 | 同上（`file:openCube` / `file:openImage`）。 |
| 大小 | 33³（35937 行）解析在 JS 中需 < 200ms；> 64³ 时提示「过大，仅支持预览」并禁止导出。 |
| 内存 | 不把整张合成表常驻超过 1 份；切换 LUT 释放旧的。 |

### 4.3 与运行时对齐的证据

- 用实际可取得的cube样本人工导入，查看尺寸/1D段/DOMAIN及错误反馈，再放入resource并在游戏使用；不要求测试夹具执行器或自动比较脚本。
- 不一致时以运行时为准，修正编辑器解析器；不允许反过来改运行时。

## 5. 修改步骤

1. 新建 `EDITOR:src/lut/parseCube.ts`（解析）、`applyCube.ts`（三线性 + 1D/3D 合成近似）、`writeCube.ts`（序列化）。
2. 新建 `EDITOR:src/lut/LutToolPanel.vue`：取帧/导入/对照/调域/导出五步；挂在 10 的调色面板里作为「修正 LUT」按钮打开的**模态工作区**（不是抽屉 tab，避免与时间轴抢空间；关闭即回）。
3. `electron/main.cjs` 新增 IPC：`file:openCube`、`file:saveCube`、`file:openImage`；`preload.cjs` 暴露 `window.editorFiles`；`src/electron-bridge.d.ts` 补类型。
4. 无 Electron（浏览器 dev）时：工具入口禁用并提示「修正工具需要桌面客户端」。
5. 游戏内宿主：入口不渲染（能力检测 `canFileDialog === false`）。
6. 与 10 的接口：工具只返回「建议字段值」`{lut, lut_input_gamma, lut_strength}`，由 10 的面板写入脚本。

## 6. 禁止修改

- 不改 `CubeLut`/`CubeLutLoader`/`ColorAdjustPass`/`ADJUST` schema。
- 不写游戏目录；不扫描 `<游戏目录>`；不猜路径。
- 不做自动匹配/自动白平衡/风格迁移；只做作者显式参数下的输入域换算。
- 不做 3D LUT 编辑器（调色在外部工具）。
- 不把近似预览结果当作验收依据；验收看游戏内。
- 不把 LUT 工具做成第二个调色面板（字段编辑归 10）。

## 7. 两分支承载

| 宿主 | 承载 |
|---|---|
| WebUI（Electron） | 完整工具：取帧、导入、对照、调域、导出 |
| WebUI（浏览器 dev） | 入口禁用（无文件对话框） |
| 游戏内 Forge/AUI | 入口不渲染；ADJUST 的 `lut`/`lut_input_gamma`/`lut_strength` 字段仍可在 10 的面板里编辑（能力不缩水，只是没有修正工具） |
| Fabric 游戏内 | 暂停，不作为前置 |

## 8. 前置

10 的 ADJUST 面板与字段编辑；03 的预览帧；Electron IPC 扩展（编辑器侧，不涉主模组）。

## 9. 验收

**正例**

1. 人工导入33³ cube，界面显示尺寸/DOMAIN/1D状态，与样本声明核对；游戏应用观察正确，不使用自动对拍作为门槛。
2. 调 `input_gamma=2.2` → 右侧近似预览变亮；导出文件头注释写明「输入域修正：gamma 2.2」。
3. 导出的 `.cube` 放进 `resource/` 后，在 ADJUST 片段填 `lut`，游戏内观感与工具预览方向一致（允许亮度差异，不允许方向相反）。
4. 未知指令的 `.cube` → 报错并指出行号，不生成半份数据。
5. 浏览器 dev 打开：入口禁用并说明原因；游戏内：入口不存在。

**反例**

1. 工具直接改脚本 `lut` 字段 → 不通过（应由 10 的面板写）。
2. 工具尝试写 `resource/` → 不通过。
3. 声称「自动匹配输入域」 → 不通过。
4. 用编辑器近似结果作为「已通过验收」的证据 → 不通过。

**真实冒烟**：用一个真实 `.cube` 走完 1–3；记录运行时与编辑器的四项比对值（本轮出口）；游戏内截图对比属 14 迁移参考，不构成本轮出口。

## 10. 完成定义

- 角色分工表落地为代码边界：工具只产出文件与建议值，不碰脚本、不碰游戏目录。
- WebUI 最小闭环可用；两宿主入口差异实测是 14 迁移要求，本轮不阻塞。
- 有真实人工导入/编辑/导出/游戏应用与异常文件使用记录，不要求自动对拍。
- 明确标注「近似预览」的位置不少于：工具标题、对照区、导出确认。
