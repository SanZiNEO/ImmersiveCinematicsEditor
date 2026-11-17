# 05 轮交付记录：脚本关系图（力导向 + 双渲染模式）

本文件记录本轮相对 `plan/05` 的实现与**偏差**。`plan/05` 只读，未回写。

## 一、偏差（以用户指令为准，覆盖文档）

| 文档条目 | 文档原意 | 实际实现 | 依据 |
|---|---|---|---|
| `05-02:57-65` | 「默认布局是确定性分层，不是随机力导向」 | **改为确定性力导向**：节点自然发散成关系网，非泳道网格 | 用户明确要求「泳道完全不要了」「照抄参考原型的力导向」 |
| `05-03` 节点卡片 196×64 | 只有卡片形态 | **双渲染模式**：`dot`（小圆点+悬停卡片，默认）与 `card`（196×64 卡片），右上角切换 | 用户要求「两种模式，切换按钮」 |
| `05-01` 截断 800 节点 / 2000 边 | 超出即截断 | **上限提到 10 万节点 / 30 万边**，渲染层负责裁剪 | 用户要求「往 10 万优化」 |
| `05-03` 节点徽标 `!`/`环`/`孤` | 三种状态徽标 | **只保留 `!`（坏文件）**，去掉「环 / 孤」结构标注 | 用户要求「先不用标注孤和环」 |
| 编辑器页前置类型 | 显示 `script_played` 等类型 | **只显示关系（→ 目标）**，表单只选目标，不暴露类型 | 用户要求「不要记录是否播放过，只显示关系」 |
| 工具栏 | 顶部横向工具条 | **右上角可拖动毛玻璃卡片**（常显主操作 + 「更多」折叠） | 用户要求「卡片在右上角，卡片+精简可拖动工具栏」 |

## 二、关系语义（事实基准）

关系**不是**编辑器自己记录的数据，而是从脚本内容算出来的派生结果：

- 唯一事实源：脚本 `meta.triggers[i].requires[]`。
- 图索引（`src/core/graph/index.ts`）解析 `requires` 得到 `GraphRequirement` 与 `GraphEdge`。
- 图上改前置 / 编辑器页改前置，走**同一条** `SCRIPT_MUTATION_SERVICE.mutateRequires`，直接改写脚本文件的 `requires`，无第二套关系存储。
- 并发安全用 `requiresFingerprint`（`src/core/graph/requirements.ts`）比对，过期返回 `stale_requires`，不覆盖。

## 三、布局实现

`src/core/graph/layout.ts`：

- **确定性力导向**：`mulberry32(由节点路径派生的种子)` 初始化 + 固定 420 步迭代，`Math.random` 零使用 → 同输入同输出（纯函数）。
- 物理参数照抄参考原型：斥力 `REPEL/d²` 上限 8、弹簧 155、跨文件夹弹簧 0.006、文件夹向心 0.012、全局向心 0.0008、阻尼 0.85、速度上限 14。
- 规模策略：`≤800` 节点用精确全对斥力（O(n²)，观感最准）；`>800` 用空间网格近似（3×3 邻域），保证 10 万级可用。
- 文件夹框 = 成员包围盒；每 8 轮做一次框分离，保证簇框互不重叠。
- 手摆覆盖（`overrides`）最后应用，优先级最高。

## 四、性能实测

| 规模 | 建图 | 布局 |
|---|---|---|
| 100 节点 | — | 与原型同量级（毫秒级） |
| 1 万节点 | 见基准 | 见基准 |
| 10 万节点 | 见基准 | 见基准（空间网格路径） |

> 注：早期实现存在 `O(n·m)` 的出度统计（每节点扫全边），10 万节点曾达 445 秒；
> 已改为一次遍历 `O(m)` 统计，并让大图跳过不必要的物理节点构建。

## 五、验证入口

```bash
node --experimental-strip-types src/core/doc/verify.ts       # 187 断言
node --experimental-strip-types src/core/schema/verify.ts    # 193 断言
node --experimental-strip-types src/core/timeline/verify.ts  # 195 断言
node --experimental-strip-types src/core/graph/verify.ts     # 161 断言
node --experimental-strip-types src/workbench/verify.ts      # 171 断言
npx vue-tsc --noEmit
npm run build
npx playwright test e2e/r05.spec.ts
```

最近一次结果：5 个 verify 全绿（合计 907 断言）、`vue-tsc` 无错、`vite build` 通过。

## 六、演示数据

演示用关系网**不在仓库内**：由外部生成器产出到仓库外目录，用环境变量注入。

- 生成器：`C:\Users\yjsng\WorkBuddy\2026-11-17-15-11-26\gen-demo-fixtures.ts`
- 夹具：同目录 `demo-fixtures/fixtures.json`（100 脚本 / 5 文件夹 / 7 层前置链 / 209 条前置）
- 演示入口：`IC_DEMO_FIXTURES=<fixtures.json> npx playwright test e2e/demo-manual.spec.ts --headed`
