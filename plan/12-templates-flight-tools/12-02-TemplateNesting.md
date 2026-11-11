# 12-02 模板嵌套（逐层传参 / id 命名空间 / 环检测）

> **本轮范围**：只实现/验收 WebUI（主模组 Forge/Fabric 正常）；文中游戏内/Forge+AUI 承载与 Java 实现段仅 14 迁移参考，不阻塞本轮；13 验收通过后才进入 14。

> 状态：未实现（提案）。
> 轮次：12-templates-flight-tools。前置：12-01；下游：12-04、12-05。

## 1. 职责

让脚本级模板引用轨道级、轨道级引用片段级，并规定：参数如何逐层传递、id 如何命名、引用如何解析、环与深度如何检测、失败如何报告。

## 2. 现状（现有文件 + 符号 + 行）

| 位置 | 事实 |
|---|---|
| `EDITOR:src/components/PresetsPanel.vue:18–76` | 「环绕整圈」直接在一个函数里循环 3 次生成 3 段，**没有**片段级模板可复用 |
| `MOD:plans/0.3.6/Z-editor/templates.md` §2 | 三层模型；嵌套引用「脚本级引用轨道级、轨道级引用片段级」，引用时逐层传参 |
| `MOD:plans/0.3.6/Z-editor/templates.md` §4.2 | 「嵌套引用只向下，不向上、不横向，引用链上出现重复 id 即判环」 |
| `MOD:plans/0.3.6/Z-editor/templates.md` §6 步骤 2 | E1 = 嵌套引用 + 环检测 |
| `MOD:docs/SCRIPT_FORMAT.md:649–715` | 脚本级集合的 id 唯一性与引用可解析要求 |

## 3. 拟新建（提案）

| 文件 | 导出 | 职责 |
|---|---|---|
| `EDITOR:src/templates/refs.ts` | `TemplateRef`、`resolveRef` | 引用声明与解析 |
| `EDITOR:src/templates/expandTree.ts` | `expandTree(rootId, params, ctx)` | 递归展开 + 深度/环检测 |
| `EDITOR:src/templates/namespace.ts` | `nsId(namespace, localId)` | 生成层级 id |

## 4. 输入 / 输出 / 字段约束

### 4.1 引用声明

```ts
interface TemplateRef {
  /** 被引用的模板 id（必须在同层之下；脚本→轨道→片段） */
  template: string
  /** 传给下层的参数：字面量或对上层参数的引用 */
  params: Record<string, ParamBinding>
  /** 生成本层多个实例时的数量来源（缺省 1） */
  repeat?: { count: number | ParamBinding; /** 每个实例的索引可用 ${i} */ indexVar?: string }
}

type ParamBinding =
  | { const: JsonValue }
  | { from: string }                      // 取上层同名参数
  | { expr: 'arc-split'; count: number }  // 受控派生（仅注册的表达式）
```

约束：

- `from` 只能引用**当前层**已声明的参数；不允许跨两层跳取（要跨层就在每层都声明同名参数）。
- expr只允许已登记的封闭派生式（如arc-split、mirror）和12-12明确的数值算子；不执行字符串代码，不访问外层未声明变量。内置/纯数据共用同一引用展开合同。
- `repeat.count` 上限 64；总展开实例数上限 512（超出报 `E_NEST_LIMIT`）。

### 4.2 命名空间

- 展开时每个实例生成一个命名空间：`<templateShortId>_<index>`（例：`orbit_arc_0`、`orbit_arc_1`）。
- 片段/路径/规则 id = `nsId(namespace, localId)`，字符集 `^[A-Za-z0-9_]{1,64}$`，长度超限时截断 + 哈希后缀（稳定）。
- 同一文档内已存在的 id → 追加 `_2`、`_3`（`12-01` 的 `allocateClipId`）。
- **不得**用数组下标作为跨层引用（与 05 的选区契约一致）。

### 4.3 环与深度

| 规则 | 判定 |
|---|---|
| 只向下 | 引用目标层必须严格低于当前层（script>track>clip）；否则 `E_NEST_DIRECTION` |
| 深度上限 | 3 层（script→track→clip）；超过 `E_NEST_DEPTH` |
| 环 | 展开栈中出现重复 `template id` → `E_NEST_CYCLE`，错误信息给出 `a → b → a` |
| 实例数 | 单次展开总实例 > 512 → `E_NEST_LIMIT` |

## 5. 修改步骤

1. 新建 `refs.ts` / `namespace.ts` / `expandTree.ts`。
2. `expandTree` 返回扁平化的 `TemplateFragment`（已分配 id、已解析引用），调用方只做装配（`12-01`）。
3. 在 `12-01` 的 `TemplateDef` 上加可选 `refs?: TemplateRef[]`；`expand` 与 `refs` 二选一或共存（共存时 `expand` 先产出本层自有片段，`refs` 追加下层实例）。
4. 把 `12-04` 的「环绕整圈」改为引用 `clip.orbit_arc` 三次（每次传不同 `start_angle`），不再复制数学。
5. 在模板面板（`12-06`）显示展开预览树（脚本 → 轨道 → 片段），便于作者确认传参。

## 6. 禁止修改

- 不允许横向或向上引用；这是Z既定方向合同，不是以后补的功能。indexVar只在当前repeat实例有效，不泄漏到同级/父层；参数跨层必须逐层显式传递。
- 不实现任意表达式/脚本求值（安全与可预测性）。
- 不把命名空间写进脚本（id 是最终结果，命名空间只是生成期中间量）。
- 不做「引用用户已有片段模板实例」的再展开（来源信息只读）。

## 7. 两分支承载

同一份逻辑。游戏内宿主额外限制：展开预览树默认折叠（屏幕小），只显示实例数与前 5 个 id。

## 8. 前置

12-01 的注册表、参数归一、id 分配、事务。

## 9. 验收

**正例**

1. 脚本级模板引用 1 个轨道级模板，轨道级引用 3 个片段级：展开后得到 1 份脚本骨架 + 1 条轨道 + 3 个片段，id 分别为 `orbit_arc_0/1/2`。
2. 传参 `from: 'radius'`：上层 `radius=8` → 三个片段都收到 8；上层改 12 → 三个都变 12。
3. 引用方向错误（片段级引用轨道级）→ `E_NEST_DIRECTION`，指出两处模板 id。
4. 构造 `a → b → a` → `E_NEST_CYCLE`，消息含环路径。
5. `repeat.count = 100` → `E_NEST_LIMIT`（超过 64/512 阈值），不生成半份。
6. id 与文档已有片段冲突 → 自动追加 `_2`，且引用同步指向新 id。

**反例**

1. 用数组下标做跨层引用 → 不通过。
2. 环检测只靠深度上限（不报环） → 不通过。
3. 展开一半失败留下部分片段 → 不通过。
4. 命名空间字符串出现在保存后的 JSON 里 → 不通过。

**真实冒烟**：生成「环绕整圈」（12-04）→ 保存 → 重开 → 播放；确认 3 个片段 id 稳定、`paths` 引用可解析。

## 10. 完成定义

- 嵌套、传参、命名空间、环/深度/数量检测全部落地。
- 轨道级/脚本级模板不再复制片段级数学。
- 展开预览树可见，错误可定位到具体引用。
- 展开失败零残留（事务回滚）。
