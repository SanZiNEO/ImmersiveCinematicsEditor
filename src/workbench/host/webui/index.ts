/**
 * WebUI 宿主实现入口（04-09）。
 *
 * 工作台只需要 `HostPort`（`../createHost.ts`）；脚本/校验/预览走这里的
 * `WebUiClient` + `WebUiTransport`，不 import `legacy/**`。
 */
export * from './protocol.ts'
export * from './WebUiClient.ts'
export * from './WebUiTransport.ts'
