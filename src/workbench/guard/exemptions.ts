/**
 * 守卫共享豁免表（G6 唯一校验对象）。
 *
 * 条目格式：`<规则编号>: <对象> — <理由>`，例如
 *   'G1: demo.tmp — 临时插件，等待 04 轮登记'
 *   'G2: demo.command.foo — 命令面迁移中，暂不注册'
 *   'G4: src/app/main.ts:31 — 主题启动缓存读取点'
 *
 * 值必须是 string 且 trim 非空；新增条目必须过 exemptions-guard.ts 的
 * 类型校验与 probe 反查（“已实现却仍豁免”同样 FAIL）。
 */
export const GUARD_EXEMPTIONS: Record<string, string> = {}
