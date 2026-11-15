# 05-07 图内依赖维护

## 目标

图内对一条**内置** `requires` 做新增、修改、移除，只改这一条；每次写入带触发器身份和指纹，服务端重新解析、校验、原子写回；失败不改文件。

## 命令

```text
script.requires.mutate {
  path: string,                 // 依赖方脚本相对路径
  triggerIdentity: string,      // 触发器 identity；不是数组下标
  triggerIndex: number,         // 仅用于诊断/显示，不作为唯一依据
  requiresFingerprint: string,  // 当前 requires 数组哈希
  operation: "add" | "update" | "remove",
  index: number,                // add: 0..len；update/remove: 0..len-1
  requirementType?: string,     // 仅 add/update；script_played/script_started/script_completed
  targetScriptId?: string       // 仅 add/update；目标脚本 meta.id
}
→ { ok: true, path, triggerIdentity, requires: GraphRequirement[], graphVersion }
→ error { code, message, currentRequires? }
```

### 校验顺序

1. `path` 安全、存在、是常规 `.json`。
2. 读文件、`JsonParser` 解析；`meta.triggers` 是数组。
3. 按 `triggerIdentity` 找触发器：先比 `id`，再比 `type#declarationIndex`；不能只按 `triggerIndex`。
4. 触发器当前 `requires`（缺省为空数组）计算指纹；与 `requiresFingerprint` 不一致 → `stale_requires`，返回当前 requires。
5. 按 `operation` 校验 `index`：
   - `add`：`0 <= index <= len`；
   - `update/remove`：`0 <= index < len`。
6. `add/update`：
   - `requirementType` ∈ 三个内置 `script_*`；
   - `targetScriptId` 非空、匹配脚本 id 规则（`^[a-zA-Z0-9_]{1,32}$`）；
   - 全项目存在且唯一；缺失 → `target_missing`；重复 → `target_duplicate`；
   - `targetScriptId === 当前脚本 meta.id` → `self_reference`，拒绝新增/改成自引用。
7. `remove`：只允许移除内置 `script_*` 条目；自定义条目 → `custom_readonly`。
8. 全局 `RefactorLock` 被占用 → `lock_busy`；不排队、不等待。
9. 目标脚本 `meta.id` 存在且唯一；当前脚本 `meta.id` 存在；否则 `source_without_id`。

### 写回

- 只改目标触发器的 `requires` 数组：
  - `add`：在 `index` 插入 `{"type":..., "script":...}`；`index===len` 追加。
  - `update`：替换 `requires[index]` 为 `{"type":..., "script":...}`；保留数组其他项与顺序。
  - `remove`：删除 `requires[index]`；若删除后数组为空，删除 `requires` 键（不保留空数组，保持最小 diff）。
- 其他字段、其他触发器、`meta.id`、`timeline`、`rules/paths/exit` 原样；不重排数组，不改对象键顺序。
- 写入：`path.tmp` → `Files.move(tmp, path, REPLACE_EXISTING)`；写前把原文件复制为 `path.bak`（同目录，覆盖上一次 `.bak`）；失败清理 tmp，原文件不动。
- 成功后刷新 `ScriptIndexService` 缓存，发 `script.graph.invalidated {paths:[path]}`；返回该触发器最新 `requires` 和 `graphVersion`。
- 若当前文档打开的是 `path` 且未脏：将内存文档对应触发器 `requires` 替换为新值，`docRevision+1`，不重载、不弄脏；若文档已脏 → 拒绝写入并提示“先保存/放弃当前修改”，避免覆盖内存修改。

## 对话框

`DependencyMaintenanceDialog`：

```text
标题：维护前置依赖
来源：<脚本 name/path> · 触发器 <type>（identity 小字）
当前前置：
  [0] script_played → hero_intro    [只读/可改]
  [1] weather=rain（自定义）        [只读]
操作：新增 / 修改 / 移除
目标脚本：搜索框（名称/id/路径），列出存在的脚本；不含当前脚本
类型：script_played / script_started / script_completed
位置：第 N 条（add 可选末尾）
[预览] [应用] [取消]
```

- 入口：节点浮层触发器行的“维护”、节点右键“维护前置”、命令 `project.editDependencies`。
- 只允许编辑内置 `script_*` 条目；自定义条目显示锁图标 + “自定义前置，只读”，不可选。
- 目标脚本选择器只列 `valid && scriptId` 的节点；缺失/重复 id 的脚本禁用并显示原因。
- 新增默认追加末尾；修改默认当前条目；移除需二次确认。
- 不做单独的“预览”消息：对话框本地校验 + 服务端一次写入；错误返回 `currentRequires`，对话框刷新后让作者重试。
- 成功后关闭对话框、刷新图节点/边、选中保持；失败保留对话框与输入，显示错误，不关闭。
- 不提供“拖动排序”；`index` 由新增位置/选中条目决定。

## 验收标准

- 新增 `script_played → hero_intro`：目标脚本 requires 多一条；其他触发器/字段不变；图新增一条边；`requiresFingerprint` 更新。
- 修改第 2 条 `script_started → a` 为 `script_completed → b`：数组顺序不变；只改该对象；图边类型/目标更新。
- 移除唯一一条：`requires` 键删除；触发器其他字段不变；图边消失；节点无悬空桩。
- 移除自定义条目：`custom_readonly`，文件不变；对话框显示只读。
- 目标不存在/重复 id：`target_missing`/`target_duplicate`；不写盘；对话框保留。
- 自引用：`self_reference`；不写盘；已有自引用可移除/改成别的目标。
- 指纹过期：另一个窗口改了同一触发器 → `stale_requires`；返回当前列表；不覆盖。
- 写第 2 个文件失败：原文件 `.bak` 可恢复；tmp 清理；图不更新。
- 引用事务进行中调用：`lock_busy`；不排队。
- 当前文档已脏且打开同一脚本：拒绝写入并提示先保存/放弃；不覆盖内存。
- 成功后当前文档未脏：内存 requires 同步、`dirty=false`、不重载、不重置撤销栈。
- `grep window.prompt`：依赖对话框 0 命中。
- `grep from.*to`：没有拖线创建依赖的 pointer 逻辑。

## 依赖维护范围

- 没有触发器时提示“先新建触发器”。
- 本命令只改 `requires` 数组；`conditions`、`delay`、`repeatable`、`poll_interval`、`continuity` 由触发器表单负责。
- 自定义前置的类型/数据只读。
- 一次只改一条 `requires`。
- 依赖编辑用对话框；拖线/拖拽排序不进入本命令。
- 重复/悬空由作者移除或改目标；不自动修环。
- 复用 `RefactorLock`；不和改 id 并发写同一项目。
- 成功后重新请求 `script.graph`，或用返回的最新列表局部更新。
