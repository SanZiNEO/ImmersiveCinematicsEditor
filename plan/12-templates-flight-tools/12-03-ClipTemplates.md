# 12-03 片段级模板（fade / static_breath / dolly / orbit_arc）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案）。
> 轮次：12-templates-flight-tools。前置：12-01、12-02；字段契约：07（位置/路径）、09（OVERLAY）、08（镜头字段）。
> 规格来源：`MOD:plans/0.3.6/Z-editor/templates.md` §1「第一批片段模板（4 个）」——本文把它翻译成 0.3.6 `objects` 格式。

## 1. 职责

实现四个片段级模板的参数表与展开数学，产物是**单个** `CAMERA`/`OVERLAY` 片段（可附带一条 `paths[]`）。全部纯函数，不读全局状态。

## 2. 现状（现有文件 + 符号 + 行）

| 位置 | 事实 |
|---|---|
| `EDITOR:src/components/PresetsPanel.vue:18–76` | 唯一现存的生成实现（环绕整圈，旧格式），内含 `CTRL = 0.7698`（19）与三段 120° 循环（30–58） |
| `EDITOR:src/components/PresetsPanel.vue:42–48` | 片段级 `curve: {type:'bezier', control_points:[{x,y,z},{x,y,z}]}`（旧字段，新格式无） |
| `EDITOR:src/components/PresetsPanel.vue:49–56` | 片段级 `keyframes: [{time, position:{x,y,z}, yaw, pitch, roll, fov}]`（旧字段） |
| `MOD:docs/SCRIPT_FORMAT.md:151–224` | CAMERA 叶子路径：`position.x/y/z`、`position_mode/space/origin*`、`yaw/pitch/roll`、`fov/zoom`、`look_at*`、`orient`、`cam_breath_*` |
| `MOD:docs/SCRIPT_FORMAT.md:481–540` | OVERLAY 叶子路径：`layer_type`（fade/image/subtitle）、`color`、`opacity`、`z_index` |
| `MOD:docs/SCRIPT_FORMAT.md:700–715` | `paths[]`：`clip/from/to/axes/geometry/timing` |
| `J:script/schema/PathCurveRegistry.java:408–440` | 控制点必须是 `{x,y,z}` 或 `{dx,dy,dz}` 对象；数组形态会抛 `PathCurveException` |
| `MOD:plans/0.3.6/Z-editor/templates.md` §1 | `orbit_arc` 单段 ≤120°；「环绕整圈」不做片段模板（属轨道级） |

## 3. 拟新建（提案）

| 文件 | 导出 | 说明 |
|---|---|---|
| `EDITOR:src/templates/clip/fade.ts` | `fadeTemplate` | OVERLAY fade |
| `EDITOR:src/templates/clip/staticBreath.ts` | `staticBreathTemplate` | 固定机位 + 呼吸 |
| `EDITOR:src/templates/clip/dolly.ts` | `dollyTemplate` | 推近/拉远（含希区柯克） |
| `EDITOR:src/templates/clip/orbitArc.ts` | `orbitArcTemplate` | 环绕弧（≤120°） |
| `EDITOR:src/templates/clip/math.ts` | `arcControlOffset(sweep)`、`orbitPoint()` | 共享数学（不引第三方） |

## 4. 参数表与展开

### 4.1 `clip.fade`（OVERLAY）

| 参数 | 类型 | 默认 | 范围 | 说明 |
|---|---|---|---|---|
| `color` | string | `#000000` | `^#[0-9a-fA-F]{6}$` | 淡入/淡出的颜色 |
| `duration` | float | 1.0 | 0.1–600 | 片段时长（秒） |
| `mode` | enum | `in` | `in`/`out`/`both` | 淡入 / 淡出 / 淡入淡出 |
| `z_index` | int | 100 | 0–255 | 覆盖层层级 |

展开（`objects`）：

```json
{
  "layer_type": { "value": "fade" },
  "color": { "value": "#000000" },
  "z_index": { "value": 100 },
  "opacity": { "keyframes": [ {"time":0,"value":0}, {"time":1,"value":1} ] }
}
```

- `mode=in`：`opacity` 0→1；`out`：1→0；`both`：0→1→0（三节点：0、duration/2、duration）。
- 不写 `color.r/g/b`（`color` 是字符串常量；需要渐变时属 09 的合成编辑，不是本模板）。
- `layer_type` 取值以 `MOD:docs/SCRIPT_FORMAT.md:534` 为准（`fade/image/subtitle`），**没有** `pip`。

### 4.2 `clip.static_breath`（CAMERA）

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `position` | position(absolute) | `{x:0,y:64,z:0}` | 机位世界坐标 |
| `yaw` / `pitch` / `roll` | float(degree) | 0 / 0 / 0 | 朝向 |
| `fov` | float | 70 | 视场角（1–179） |
| `zoom` | float | 1 | 缩放（>0） |
| `duration` | float | 8 | 片段时长 |
| `breath` | enum | `perlin` | `none`/`perlin`/`perlin_axis`/`sine`/`trauma` |
| `breath_intensity` | float | 0.05 | 0–1 |
| `breath_speed` | float | 1.0 | 0.01–20 |

展开：`position_mode=absolute`，`position.x/y/z`、`yaw/pitch/roll/fov/zoom` 全部 `{value}`（常量，不造关键帧）；`cam_breath_enabled`（bool）、`cam_breath_type`、`cam_breath_intensity`、`cam_breath_speed` 为 `{value}`；`breath=none` 时写 `cam_breath_enabled:{value:false}` 并省略其余。

> 注意：`cam_breath_*` 在新 schema 里是 **VALUE**（不可打关键帧，`MOD:docs/SCRIPT_FORMAT.md:381–386`），不要生成 `keyframes`。

### 4.3 `clip.dolly`（CAMERA）

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `from` | position(absolute) | — | 起点机位 |
| `to` | position(absolute) | — | 终点机位 |
| `fov_from` / `fov_to` | float | 70 / 70 | 两端视场角；不相等即希区柯克变焦 |
| `duration` | float | 6 | 片段时长 |
| `look_at` | enum | `none` | `none`/`coordinate`；`coordinate` 时另给 `target` |
| `target` | position(absolute) | 可选 | `look_at=coordinate` 时的注视点 |

展开：

- `position_mode=absolute`；`position.x/y/z` 各 2 个关键帧（t=0 与 t=duration）；
- `fov` 2 个关键帧；`yaw/pitch/roll` 若 `look_at=none` 则由参数给出常量（缺省 0）；
- `look_at=coordinate` 时写 `look_at:{value:"coordinate"}` 与 `look_at_target_x/y/z`（常量）。
- **不生成** `paths[]`（直线段不需要路径条目；带弧线时走 `12-09` 的曲线工具显式添加）。

### 4.4 `clip.orbit_arc`（CAMERA）

| 参数 | 类型 | 默认 | 范围 | 说明 |
|---|---|---|---|---|
| `center` | position(absolute) | — | — | 环绕中心 |
| `radius` | float | 8 | 0.5–512 | 半径（世界单位） |
| `height` | float | 2 | -512–512 | 相对中心的高度 |
| `start_angle` | float(degree) | 0 | -3600–3600 | 起始角（绕 +Y） |
| `sweep` | float(degree) | 120 | 1–120 | 扫过角度；>120 拒绝（`E_PARAM_RANGE`） |
| `duration` | float | 6 | 0.1–600 | 片段时长 |
| `look_at_center` | bool | true | — | 是否始终看向中心 |
| `fov` | float | 70 | 1–179 | 视场角 |

展开：

1. `position_mode:{value:"absolute"}`；`position.x/y/z` 各 2 节点：
   - `P0 = (cx + R·cos a0, cy + h, cz + R·sin a0)`
   - `P1 = (cx + R·cos a1, cy + h, cz + R·sin a1)`，`a1 = a0 + sweep`
2. 附一条 `paths[]` 条目：

```json
{ "id": "<ns>_arc", "clip": "<clipId>", "from": 0, "to": 6, "axes": ["x","z"],
  "geometry": { "type": "bezier", "control_points": [
    { "dx": -CTRL*R*sin(a0), "dy": 0, "dz":  CTRL*R*cos(a0) },
    { "dx":  CTRL*R*sin(a1), "dy": 0, "dz": -CTRL*R*cos(a1) }
  ] },
  "timing": { "type": "linear" } }
```

   其中 `CTRL = (4/3)·tan(sweep/4)`（`sweep=120°` 时 ≈ 0.7698，与旧 `PresetsPanel.vue:19` 的常数一致）。控制点是**相对段起点**（`dx/dy/dz`），必须写全三键。
3. 朝向：`look_at_center=true` → `look_at:{value:"coordinate"}` + `look_at_target_x/y/z` = center；否则 `orient:{value:"tangent"}` + `yaw_offset/pitch_offset:{value:0}`。
4. `fov:{value:70}`。
5. 路径端点约束：`from/to` 必须命中该片段 `position.x/y/z` 的节点时间并集且相邻（`MOD:docs/SCRIPT_FORMAT.md:700–715`）——本模板只有 0 与 duration 两个节点，天然满足。

## 5. 修改步骤

1. math.ts集中arcControlOffset/orbitPoint；人工生成0°附近、90°、120°对应合法场景并看参数与游戏路径，不建设单测。
2. 新建四个模板文件，按 §4 组装 `TemplateFragment`（只写非默认字段）。
3. 在 `registry.ts` 注册（`layer:'clip'`，`trackType` 分别为 `OVERLAY`/`CAMERA`）。
4. 删除 `PresetsPanel.vue:18–76`；`CTRL=0.7698` 的注释迁移到 `math.ts`。
5. 每个模板提供 `validate()`：`dolly` 要求 `from≠to`；`orbit_arc` 要求 `sweep≤120`；`fade` 要求 `duration>0`。
6. i18n：每个模板 1 个 `titleKey` + 每个参数 1 个 `labelKey` + 1 个 `docKey`，中英各一份。

## 6. 禁止修改

- 不写 `meta.version`、`timeline.total_duration`、片段级 `keyframes/curve/rules`。
- 不生成 `cam_breath_*` 的 `keyframes`（VALUE 字段）。
- 不生成 `layer_type:"pip"`（不存在）。
- 不在模板里做转场（`transition*` 由脚本级模板或 08 决定）。
- 不复制 09 的遮罩/渐变逻辑（需要时由 09 的字段编辑加）。

## 7. 两分支承载

同一份展开函数。差异只在面板呈现（`12-06`）：游戏内参数分组默认折叠，`position` 参数用 06 的三轴输入控件。

## 8. 前置

12-01/12-02；07 的 `position_*`/`look_at_*` 字段契约；09 的 OVERLAY 字段契约；`J:script/schema/PathCurveRegistry.java` 的控制点形态（见 §2）。

## 9. 验收

**正例**

1. `clip.orbit_arc` 默认参数生成：1 个片段 + 2 个位置节点 + 1 条 `paths[]`；保存后 `script.validate` 无 issue；游戏内播放为 120° 圆弧且始终看向中心。
2. `sweep=130` → `E_PARAM_RANGE`，不生成。
3. `clip.dolly` 且 `fov_from=70, fov_to=35` → 播放时推近同时压缩视场（希区柯克），位置与 fov 各有 2 节点。
4. `clip.static_breath` 生成后 `cam_breath_*` 全部是 `{value}`；在检查器里这些字段不出现「加关键帧」按钮。
5. `clip.fade` `mode=both` → `opacity` 三节点 0→1→0；`color` 为字符串。
6. 生成后撤销一次 → 片段与路径条目一起消失（同一事务）。

**反例**

1. 生成片段级 `curve` → 不通过。
2. 控制点写成 `[[0,0],[1,1]]` → parser 抛错，不通过（见 §2 冲突）。
3. `cam_breath_enabled` 写成 `keyframes` → 不通过。
4. `orbit_arc` 生成 360°（整圈） → 不通过（属 `12-04`）。

**真实冒烟**：四个模板各生成一次 → 保存 → 重开 → 在游戏中播放；记录 `script.validate` 输出与播放观感。

## 10. 完成定义

- 四个模板全部注册、可生成、可通过校验、可播放。
- 数学参数与合法生成规则一致，人工实际生成/编辑/保存/播放确认，不以自动化测试为门槛。
- `PresetsPanel.vue` 的旧生成逻辑删除。
- 每个模板的参数表与本文一致（实现与文档同源）。
