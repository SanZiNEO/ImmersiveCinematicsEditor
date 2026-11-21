<script setup lang="ts">
/**
 * 脚本参数（检查器改版，原 `core.meta/meta.properties` 迁移）。
 *
 * 打开脚本 / 点时间轴空白时显示；字段全部来自 02 目录的 `meta` 段，写入走 `meta.set`。
 * 一页内按编辑任务分组，没有页签；基本信息默认展开，其余收起。
 * 触发器不在这里编辑：行为组只给既有行为入口，脚本级轮询间隔仍可写。
 */
import { computed, ref } from 'vue'
import type { JsonValue } from '../../../core/doc/types.ts'
import type { FieldEntry } from '../../../core/schema/types.ts'
import { CATALOG_SERVICE, DOCUMENT_SERVICE } from '../../../workbench/api/tokens.ts'
import { usePanelContext } from '../../../workbench/host/panelContext.ts'
import { usePanelRevision } from '../usePanelRevision.ts'
import {
  SCRIPT_FIELD_GROUPS,
  SCRIPT_GROUPED_KEYS,
} from '../scriptFields.ts'
import ScriptFieldRow from './ScriptFieldRow.vue'

const ctx = usePanelContext()
const revision = usePanelRevision(ctx)
const documentService = ctx.services.get(DOCUMENT_SERVICE)
const catalog = ctx.services.get(CATALOG_SERVICE)

/** meta 段字段（目录顺序；分组只改显示顺序，不重复定义字段）。 */
const fields = computed<FieldEntry[]>(() => {
  if (catalog === undefined) {
    return []
  }
  return catalog.search({ segment: 'meta' })
})

const fieldByKey = computed(() => new Map(fields.value.map((field) => [field.key, field])))

/** 当前文档的 meta 值（只读快照，每次 revision 重新读）。 */
const values = computed<Record<string, JsonValue>>(() => {
  void revision.value
  const raw = documentService?.metaObject() ?? null
  if (raw === null) {
    return {}
  }
  const result: Record<string, JsonValue> = {}
  for (const [key, value] of Object.entries(raw)) {
    result[key] = value
  }
  return result
})

const summary = computed(() => {
  void revision.value
  return documentService?.summary() ?? null
})

const scriptName = computed(() => {
  const name = values.value.name
  return typeof name === 'string' && name.trim() !== '' ? name : '未命名脚本'
})

const openDocument = computed(() => {
  void revision.value
  return documentService?.view() ?? null
})

const hasDocument = computed(() => openDocument.value !== null)

/** 循环开启后才显示次数与方式（目录默认值也参与判断）。 */
const macroLoop = computed(() => {
  const raw = values.value.macro_loop
  if (typeof raw === 'boolean') {
    return raw
  }
  return fieldByKey.value.get('macro_loop')?.default === true
})

function isConditional(field: FieldEntry): boolean {
  return field.key === 'macro_loop_count' || field.key === 'macro_loop_mode'
}

/** 可见分组：目录里缺失的键跳过；目录新增的键进「扩展字段」。 */
const groups = computed(() => {
  const result: Array<{
    id: string
    label: string
    entries: FieldEntry[]
  }> = []
  for (const definition of SCRIPT_FIELD_GROUPS) {
    const entries = definition.keys
      .map((key) => fieldByKey.value.get(key))
      .filter((field): field is FieldEntry => field !== undefined)
      .filter((field) => !isConditional(field) || macroLoop.value)
    if (entries.length > 0) {
      result.push({
        id: definition.id,
        label: definition.label,
        entries,
      })
    }
  }
  const extras = fields.value.filter((field) => !SCRIPT_GROUPED_KEYS.has(field.key))
  if (extras.length > 0) {
    result.push({ id: 'extensions', label: '扩展字段', entries: extras })
  }
  return result
})

const openGroups = ref<Set<string>>(new Set(SCRIPT_FIELD_GROUPS.filter((group) => group.open).map((group) => group.id)))

function isOpen(id: string): boolean {
  return openGroups.value.has(id)
}

function toggleGroup(id: string): void {
  const next = new Set(openGroups.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  openGroups.value = next
}

const triggerCount = computed(() => {
  const raw = values.value.triggers
  return Array.isArray(raw) ? raw.length : 0
})

/** 提交 `meta.set`；返回本行错误（命令层拒绝原因）或 `null`。 */
function commitValue(key: string, value: JsonValue): string | null {
  const outcome = ctx.commands.commit({ kind: 'meta.set', key, value })
  return outcome.ok ? null : (outcome.error ?? '写入被拒绝。')
}

function openTriggers(): void {
  ctx.requestOpenDrawer('behavior')
}
</script>

<template>
  <section class="script-panel" aria-label="脚本参数">
    <header class="script-panel__header">
      <h2 class="script-panel__title">脚本参数</h2>
      <span v-if="hasDocument" class="script-panel__name" :title="scriptName">{{ scriptName }}</span>
      <span v-if="summary?.dirty" class="script-panel__dirty">未保存</span>
    </header>

    <p v-if="documentService === undefined" class="script-panel__notice" role="alert">
      文档服务不可用：面板无法读取当前脚本。
    </p>

    <p v-else-if="!hasDocument" class="script-panel__empty">
      没有打开的脚本。从脚本页打开一个脚本后，这里显示脚本参数。
    </p>

    <p v-else-if="fields.length === 0" class="script-panel__notice" role="alert">
      字段目录不可用：无法列出脚本级字段。
    </p>

    <div v-else class="script-panel__scroll">
      <section v-for="group in groups" :key="group.id" class="script-group" :data-group="group.id">
        <button
          type="button"
          class="script-group__head"
          :aria-expanded="isOpen(group.id)"
          @click="toggleGroup(group.id)"
        >
          <span class="script-group__chevron" aria-hidden="true">{{ isOpen(group.id) ? '▾' : '▸' }}</span>
          <span class="script-group__title">{{ group.label }}</span>
        </button>

        <div v-show="isOpen(group.id)" class="script-group__body">
          <template v-for="field in group.entries" :key="field.key">
            <!-- 触发器：沿用既有行为入口，不在脚本参数里重写记录编辑。 -->
            <div
              v-if="field.key === 'triggers'"
              class="script-row script-row--action"
              :data-field="field.key"
              :title="field.key"
            >
              <span class="script-row__label">触发器</span>
              <div class="script-row__control">
                <span class="script-row__count">{{ triggerCount }} 条</span>
                <button type="button" class="script-row__button" @click="openTriggers">
                  打开触发器编辑
                </button>
              </div>
            </div>

            <ScriptFieldRow
              v-else
              :field="field"
              :value="values[field.key]"
              :commit-value="commitValue"
            />
          </template>
        </div>
      </section>
    </div>

    <p v-if="hasDocument" class="script-panel__foot">
      所有写入都进同一条撤销栈；目录约束由命令层继续校验。
    </p>
  </section>
</template>

<style scoped>
.script-panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
  line-height: 1.4;
}

.script-panel__header {
  display: flex;
  flex: 0 0 auto;
  align-items: baseline;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
}

.script-panel__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.script-panel__name {
  overflow: hidden;
  min-width: 0;
  color: var(--text-secondary);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.script-panel__dirty {
  margin-left: auto;
  padding: 0 4px;
  border: 1px solid var(--warning);
  border-radius: 3px;
  color: var(--warning);
  font-size: 10px;
}

.script-panel__scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding-bottom: 8px;
}

.script-group + .script-group {
  margin-top: 10px;
}

.script-group__head {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  box-sizing: border-box;
  padding: 4px 10px;
  border: none;
  border-block: 1px solid var(--border);
  background: var(--bg-raised);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.script-group__head:hover {
  background: var(--bg-hover);
}

.script-group__head:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

.script-group__chevron {
  color: var(--text-muted);
  font-size: 10px;
}

.script-group__title {
  font-size: 12px;
  font-weight: 600;
}

.script-group__body {
  display: flex;
  flex-direction: column;
}

.script-row {
  display: grid;
  grid-template-columns: minmax(92px, 116px) minmax(0, 1fr);
  align-items: center;
  gap: 3px 8px;
  min-height: 34px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  line-height: 1.4;
}

.script-row__label {
  min-width: 0;
  color: var(--text-secondary);
  font-weight: 500;
}

.script-row__control {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  min-width: 0;
}

.script-row__count {
  color: var(--text-muted);
  font-size: 11px;
}

.script-row__button {
  padding: 2px 7px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-raised);
  color: var(--text);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.script-row__button:hover {
  background: var(--bg-hover);
}

.script-panel__empty,
.script-panel__notice {
  margin: 10px 12px;
  padding: 10px 12px;
  border: 1px dashed var(--border-strong);
  border-radius: 4px;
  color: var(--text-secondary);
}

.script-panel__notice {
  border-color: var(--error);
  background: var(--bg-raised);
}

.script-panel__foot {
  flex: 0 0 auto;
  margin: 0;
  padding: 4px 10px;
  border-top: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 10px;
}
</style>
