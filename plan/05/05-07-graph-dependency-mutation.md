# 05-07 图上改前置关系

## 目标

在脚本页上对一条**内置**前置做新增、修改、移除，只改这一条 `requires` 条目，只写**依赖方这一个脚本文件**。目标脚本永远不被打开、不被修改——它只是被 `meta.id` 引用。

编辑器页改同一个 `requires` 时走**同一条命令、同一套校验、同一套撤销**，不出现第二套关系存储。

## 事实基准

`requires` 是触发器自己的字段，不是脚本级字段，也不是独立关系文件：

```text
meta.triggers[i].requires[]
  ├─ 字符串 "chapter1"
  │    等价于 { type: "script_played", data: { script: "chapter1" } }
  └─ 对象 { type: "script_started", data: { script: "chapter2" } }
        type  ∈ script_played | script_started | script_completed | 自定义类型
        data 内置只有 script；自定义由该类型自己解释
```

- 内置三种只读 `data.script`；`data` 里出现别的键时原样保留，不删。
- 自定义类型（`modid:name`）只读：能显示、不能改。
- 目标脚本只被 `script` 字符串引用；目标不存在时条目仍合法存在（只是永远不满足）。

## 命令

```text
script.requires.mutate {
  path: string,                 // 依赖方脚本相对路径（被改的文件）
  triggerIdentity: string,      // 触发器 id；不是数组下标
  triggerIndex: number,         // 仅用于诊断/显示，不作为唯一依据
  requiresFingerprint: string,  // 当前 requires 数组的稳定哈希
  operation: "add" | "update" | "remove",
  index: number,                // add: 0..len；update/remove: 0..len-1
  requirementType?: string,     // 仅 add/update；内置三种之一
  targetScriptId?: string       // 仅 add/update；目标脚本 meta.id
}
→ { ok: true, path, triggerIdentity, requirements: GraphRequirement[], graphVersion }
→ error { code, message, currentRequirements? }
```

### 校验顺序

1. `path` 安全、存在、是常规 `.json`。
2. 读文件、解析 JSON；`meta.triggers` 是数组。
3. 按 `triggerIdentity` 找触发器：先比 `id`，再比 `type#declarationIndex`；不能只按 `triggerIndex`。
4. 该触发器当前 `requires`（缺省为空数组）计算指纹；与 `requiresFingerprint` 不一致 → `stale_requires`，返回当前列表。
5. 按 `operation` 校验 `index`：`add` 允许 `0..len`；`update/remove` 要求 `0..len-1`。
6. `add/update`：
   - `requirementType` 必须是三个内置 `script_*`；
   - `targetScriptId` 非空、匹配脚本 id 规则、全项目存在且唯一；
   - 缺失 → `target_missing`；重复 → `target_duplicate`；
   - 等于当前脚本 `meta.id` → `self_reference`，拒绝。
7. `remove`：只允许移除内置条目；自定义条目 → `custom_readonly`。
8. 当前脚本没有 `meta.id` → `source_without_id`（没有 id 就无法被别人引用，也无法自引用校验）。
9. 全局 `RefactorLock` 被占用 → `lock_busy`；不排队、不等待。

### 写回（最小 diff）

- 只改目标触发器的 `requires` 数组：
  - `add`：在 `index` 插入新条目；`index === len` 追加。
  - `update`：替换 `requires[index]`；数组其他项与顺序不变。
  - `remove`：删除 `requires[index]`；删除后数组为空 → **删除 `requires` 键**（不保留空数组）。
- **保留原条目形状**：原条目是字符串且新类型为 `script_played` → 仍写字符串；其他情况写对象 `{type, data:{script}}`。这样改一条不会把整个数组变成对象形式。
- 其他字段、其他触发器、`meta.id`、`timeline`、`rules/paths/exit` 原样；不重排数组、不改对象键顺序。
- 写入：`path.tmp` → `Files.move(tmp, path, REPLACE_EXISTING)`；写前把原文件复制为 `path.bak`（同目录，覆盖上一次 `.bak`）；失败清理 tmp，原文件不动。
- 成功后刷新 `ScriptIndexService` 缓存，发 `script.graph.invalidated { paths: [path] }`；返回该触发器最新 `requirements` 与 `graphVersion`。
- 若当前文档打开的就是 `path`：
  - 未脏 → 把内存里该触发器的 `requires` 替换为新值，`docRevision+1`，不重载、不弄脏；
  - 已脏 → 拒绝写入并提示「先保存/放弃当前修改」，避免覆盖内存修改。

## 编辑器页复用

编辑器页的触发器表单改前置时，发的是**同一条命令**（同一个服务端入口），不是另一套：

- 表单只负责收集 `triggerIdentity + index + type + target`，校验与写回都在这里。
- 撤销：两边都走 03 的文档命令；图上的操作进同一个撤销栈（一次操作一次撤销）。
- 不允许图上一套、编辑器页一套；不允许只有图能加、只有编辑器能删。

## DependencyEditor 对话框

```text
标题：维护前置
来源：<脚本 name/path> · 触发器 <type>（identity 小字）
当前前置：
  [0] script_played → chapter1        [已解析] [换目标] [删除]
  [1] script_started → chapter2       [缺失]   [换目标] [删除]
  [2] weather=rain（自定义）           [只读]
操作：加前置 / 换目标 / 删除
目标脚本：搜索框（名称/id/路径），只列存在且 id 唯一的脚本；不含当前脚本
类型：script_played / script_started / script_completed
位置：第 N 条（add 默认末尾）
[应用] [取消]
```

- 入口：悬停卡片的「+ 加前置」「换目标」「删除」（05-03）。
- 自定义条目显示锁图标 + 「自定义前置，只读」，不可选。
- 目标选择器只列 `valid && scriptId` 且 id 唯一的节点；缺失/重复 id 的脚本禁用并显示原因。
- 删除需二次确认；其余一次应用。
- 不做单独「预览」消息：对话框本地校验 + 服务端一次写入；错误返回 `currentRequirements`，对话框刷新后让作者重试。
- 成功后关闭对话框、按返回的 `requirements` 局部更新图节点/边、保持选中；失败保留对话框与输入，显示错误，不关闭。
- 不提供拖动排序；`index` 由新增位置/选中条目决定。

## 与「改 id」的边界

- 改 `meta.id`（05-06）会同步所有指向它的前置；那是另一条命令（`script.refs.apply`），不和本命令混用。
- 本命令只改「谁依赖谁」，不改任何脚本的 id。
- 两者都占用 `RefactorLock`，不能并发写同一项目。

## 验收标准

- 加 `script_started → chapter2`：依赖方脚本该触发器 `requires` 多一条；其他触发器/字段不变；图新增一条边（chapter2 → 依赖方）；撤销一次全部回退。
- 换目标：只改该条；数组顺序不变；图边目标更新；其他边不受影响。
- 删唯一一条：`requires` 键删除；触发器其他字段不变；图边消失；无悬空桩。
- 删自定义条目：`custom_readonly`，文件不变；对话框显示只读。
- 原条目是字符串 `"chapter1"` 且换目标为 `chapter2`（`script_played`）：写回仍是字符串 `"chapter2"`，不是对象。
- 原条目是字符串，改成 `script_started`：写回对象 `{type, data:{script}}`（类型变了，不能再用简写）。
- 目标不存在 / 重复 id：`target_missing` / `target_duplicate`；不写盘；对话框保留。
- 自引用：`self_reference`；不写盘；已有自引用可删除或改成别的目标。
- 当前脚本无 `meta.id`：`source_without_id`；不写盘；提示先设 id。
- 指纹过期：另一窗口改了同一触发器 → `stale_requires`；返回当前列表；不覆盖。
- 写失败（磁盘/权限）：`.bak` 可恢复；tmp 清理；图不更新。
- 引用事务进行中：`lock_busy`；不排队。
- 当前文档已脏且打开同一脚本：拒绝并提示；不覆盖内存。
- 成功后当前文档未脏：内存同步、`dirty=false`、不重载、不重置撤销栈。
- 编辑器页改同一条：走同一命令；两处看到的结果一致；撤销栈连续。
- `grep window.prompt`：0 命中。
- `grep 拖线`：没有「拖动连线建依赖」的 pointer 逻辑。

## 范围

- 没有触发器时提示「先新建触发器」；本命令不建触发器。
- 本命令只改 `requires`；`conditions`、`delay`、`repeatable`、`poll_interval`、`continuity` 由编辑器页的触发器表单负责。
- 自定义前置只读。
- 一次只改一条。
- 不做拖线建依赖、不做拖动排序。
- 不自动修环、不自动补缺失目标。
- 目标脚本文件永远不被本命令打开或写入。
