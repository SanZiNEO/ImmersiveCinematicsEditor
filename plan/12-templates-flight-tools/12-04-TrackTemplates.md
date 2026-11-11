# 12-04 轨道级模板（环绕整圈 / 双机位切）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案）。
> 轮次：12-templates-flight-tools。前置：12-01、12-02、12-03（`clip.orbit_arc`）；字段契约：07。

## 1. 职责

实现两个轨道级模板：把片段级模板编排成一条轨道的多个片段，并处理片段间的**时间衔接**与**转场声明**（只写字段，转场语义归 08）。

## 2. 现状（现有文件 + 符号 + 行）

| 位置 | 事实 |
|---|---|
| `EDITOR:src/components/PresetsPanel.vue:18–76` | 「环绕整圈」= 一个函数循环 3 次生成 3 段，段间 `transition:'cut'`（37）、每段 `curve` 独立（42–48） |
| `EDITOR:src/components/PresetsPanel.vue:30–41` | 段时长 `duration/3`，起点 `i*segDur` |
| `EDITOR:src/components/PresetsPanel.vue:77–86` | 整份覆盖 `state.doc.timeline` |
| `MOD:plans/0.3.6/Z-editor/templates.md` §1 | 「环绕整圈不做片段模板（三段 120° 拼圆 = 轨道级）」；「希区柯克不单列模板」 |
| `MOD:plans/0.3.6/Z-editor/templates.md` §6 步骤 3 | E2 = 轨道级（环绕整圈、双机位切） |
| `MOD:docs/SCRIPT_FORMAT.md:94–105` | 片段 `start_time/duration/objects/loop*/exit/id` |

## 3. 拟新建（提案）

| 文件 | 导出 | 说明 |
|---|---|---|
| `EDITOR:src/templates/track/orbitFull.ts` | `orbitFullTemplate` | 环绕整圈（N 段拼圆） |
| `EDITOR:src/templates/track/multiCam.ts` | `multiCamTemplate` | 双机位切 |
| `EDITOR:src/templates/track/layout.ts` | `layoutSequential(segments, gapSec)` | 片段顺序排布（起点/时长计算） |

## 4. 参数表与展开

### 4.1 `track.orbit_full`（CAMERA）

| 参数 | 类型 | 默认 | 范围 | 说明 |
|---|---|---|---|---|
| `center` | position(absolute) | — | — | 环绕中心 |
| `radius` | float | 8 | 0.5–512 | 半径 |
| `height` | float | 2 | -512–512 | 相对高度 |
| `start_angle` | float(degree) | 0 | -3600–3600 | 起始角 |
| `turns` | float | 1 | 0.25–4 | 圈数（1 = 360°） |
| `segments` | int | 3 | 2–8 | 拼圆段数；每段 ≤120°（校验） |
| `duration` | float | 12 | 0.5–600 | 总时长 |
| `transition` | enum | `cut` | `cut`/`morph` | 段间转场类型（写入 `transition*`，语义归 08） |
| `transition_duration` | float | 0.5 | 0–5 | 仅 `morph` 时有效 |
| `look_at_center` | bool | true | — | 每段是否看向中心 |

展开：

- `sweepPerSegment = 360·turns / segments`；`sweepPerSegment > 120` → `E_PARAM_RANGE`（提示增大 `segments`）。
- 对 `i ∈ [0, segments)` 引用 `clip.orbit_arc`，传 `start_angle = start_angle + i·sweepPerSegment`、`sweep = sweepPerSegment`、`duration = duration/segments`。
- 片段起点：`i · (duration/segments)`（`layoutSequential` 计算，留 `gapSec=0`）。
- 每段 `transition`/`transition_duration` 写入片段级 `objects.transition`（VALUE）；**不**自行计算重叠对齐（08 的对齐规则在装配后由 02 的钩子执行）。

### 4.2 `track.multi_cam`（CAMERA）

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `shots` | int | 2 | 机位数（2–6） |
| `duration` | float | 8 | 总时长 |
| `shot_duration` | float | 2 | 每个机位时长（≤ 总时长） |
| `positions` | position[] | — | 每个机位的世界坐标（数量 = `shots`） |
| `targets` | position[] | 可选 | 每个机位的注视点（数量 = `shots` 或空） |
| `transition` | enum | `cut` | `cut`/`morph` |
| `transition_duration` | float | 0.5 | — |

展开：

- 生成 `shots` 个 CAMERA 片段，每个含 `position_mode=absolute` + `position.x/y/z` 常量 + `fov` 常量 + 可选 `look_at=coordinate`。
- 起点按 `shot_duration` 顺序排；若 `shots·shot_duration > duration` → `E_PARAM_RANGE`。
- 机位相同（位置与目标都相同）→ 警告（`W_DUPLICATE_SHOT`），不阻止。

## 5. 修改步骤

1. 新建 `layout.ts`：顺序排布 + 重叠（转场）预留；只算数字，不改文档。
2. 新建两个模板，`refs` 指向 `clip.orbit_arc` / 内联片段；注册为 `layer:'track'`，`trackType:'CAMERA'`。
3. 装配时：若目标文档已有同类型 CAMERA 轨道且用户选择「追加」→ 追加片段；否则新建轨道（`12-01` 的轨道归属规则）。
4. 段间 `transition` 写入后，调用 02 的转场对齐钩子；钩子未就绪时在诊断抽屉提示「未对齐，需在 08 面板确认」。
5. 删除 `PresetsPanel.vue` 的三段循环实现（与 12-03 同步删除）。

## 6. 禁止修改

- 不实现 morph/wipe 的插值或遮罩参数（08）。
- 不实现「自动拆镜头」（按画面内容切分）；机位由参数给。
- 不在轨道级模板里再定义曲线数学（复用 `clip.orbit_arc`）。
- 不做「环绕整圈 + 自动环绕相机朝向速度曲线」（缓动属 06/07）。

## 7. 两分支承载

同一份逻辑。游戏内参数表单把 `positions/targets` 数组渲染为可增删的行（每行三轴输入），默认折叠。

## 8. 前置

12-01/12-02/12-03；07 的 `position_*`/`look_at_*`；08 的 `transition*` 字段与对齐钩子。

## 9. 验收

**正例**

1. `orbit_full` 默认（3 段、1 圈、12s）：生成 3 个片段，起点 0/4/8，每段 `sweep=120`，各带一条 `paths[]`；播放为完整一圈且始终看向中心。
2. `segments=2, turns=1` → 每段 180° > 120 → `E_PARAM_RANGE` 并提示 `segments≥3`。
3. `transition=morph, transition_duration=0.5`：片段 `objects.transition` 为 morph；保存后 validator 通过。
4. `multi_cam` `shots=2, shot_duration=2, duration=8`：生成 2 个片段（0–2、2–4），总内容 4s；不补空片段。
5. 追加到已有 CAMERA 轨道：新片段接在末尾，不改动已有片段。

**反例**

1. 生成 360° 单段（超过 120°）→ 不通过。
2. 轨道级模板复制 `CTRL` 数学而不是引用 `clip.orbit_arc` → 不通过（双实现）。
3. 自己计算转场重叠并写 `start_time`，绕过 08 的对齐 → 不通过。
4. `positions` 数量与 `shots` 不符却静默截断 → 不通过。

**真实冒烟**：生成环绕整圈 → 保存 → 游戏内播放一圈；`multi_cam` 生成后逐个机位播放确认。

## 10. 完成定义

- 两个轨道级模板落地，`refs` 复用片段级模板，无数学复制。
- 段数与角度约束、转场字段写入、对齐钩子调用齐备。
- 追加/新建轨道两条路径都可复现，失败零残留。
