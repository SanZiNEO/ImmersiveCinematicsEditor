/**
 * `.vue` 模块的 TypeScript 声明（只服务 `tsc --noEmit`）。
 *
 * `vue-tsc` 会用自己的 SFC 分析覆盖这里的宽声明，模板与 `<script setup>` 仍然严格检查；
 * 这里只让纯 `tsc` 能解析 `import X from './X.vue'`。
 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

/** 静态图片资源：Vite 会把导入解析成构建后的 URL 字符串。 */
declare module '*.png' {
  const url: string
  export default url
}
