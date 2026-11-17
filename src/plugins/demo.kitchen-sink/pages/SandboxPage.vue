<script setup lang="ts">
/**
 * `demo.sandbox` 页面壳（04-04 / 04-11）。
 *
 * 只显示标题、说明与当前页面 ID；不渲染布局树，也不放业务内容。
 * 页面由「视图 → 页面」进入，是 `page` 贡献的最小验收面。
 *
 * `pageId` 优先取宿主传入的 prop，其次取外壳注入的 `PageRouter.currentPageId`；
 * 两者都缺失时显示本贡献的固定页面 ID（本组件只服务这一页）。
 */
import { computed, inject } from 'vue'
import type { PageRouter } from '../../../workbench/api/registries.ts'
import { PAGE_ROUTER } from '../../../workbench/api/tokens.ts'
import { WORKBENCH_SERVICES_KEY } from '../../../workbench/host/panelContext.ts'

const props = defineProps<{
  pageId?: string
}>()

/** 页面宿主不传 props；从外壳注入的服务注册表读真实路由，缺失时回退到本贡献 ID。 */
const services = inject(WORKBENCH_SERVICES_KEY, null)
const router: PageRouter | undefined = services?.get(PAGE_ROUTER)

const currentPageId = computed(() => props.pageId ?? router?.currentPageId ?? 'demo.sandbox')
</script>

<template>
  <section class="demo-page" aria-label="Demo 沙盒页">
    <header class="demo-page__header">
      <span class="demo-badge">demo</span>
      <h1 class="demo-page__title">沙盒页</h1>
    </header>
    <p class="demo-page__desc">
      这是 demo.kitchen-sink 的页面贡献，用于验证「视图 → 页面」的路由入口。页面只显示标题、
      说明与当前页面 ID，不承载业务内容。
    </p>
    <dl class="demo-page__facts">
      <dt>当前页面 ID</dt>
      <dd data-testid="sandbox-page-id">{{ currentPageId }}</dd>
    </dl>
  </section>
</template>

<style scoped>
.demo-page {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  min-height: 0;
  padding: 16px 20px;
  overflow: auto;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 13px;
  line-height: 1.6;
}

.demo-page__header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.demo-badge {
  padding: 1px 6px;
  border: 1px solid var(--warning);
  border-radius: 3px;
  color: var(--warning);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.demo-page__title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.demo-page__desc {
  max-width: 64ch;
  margin: 0;
  color: var(--text-secondary);
}

.demo-page__facts {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 4px 12px;
  max-width: 48ch;
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-raised);
  color: var(--text-secondary);
}

.demo-page__facts dt {
  color: var(--text-muted);
}

.demo-page__facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
