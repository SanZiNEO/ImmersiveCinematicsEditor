/**
 * 跨插件服务注入（04-01）。
 *
 * 内核不 import 业务实现；插件之间共享能力走 token。同一 token 只允许一个 provider，
 * 重复 provide 抛错；缺失时调用方自己决定降级。
 */

/** 服务 token。`__type` 只用于类型推导，运行时不存在。 */
export interface ServiceToken<T> {
  readonly description: string
  readonly __type?: T
}

/** 创建一个服务 token。 */
export function createServiceToken<T>(description: string): ServiceToken<T> {
  return { description }
}

/** 服务注册表。 */
export interface ServiceRegistry {
  provide<T>(token: ServiceToken<T>, impl: T): void
  get<T>(token: ServiceToken<T>): T | undefined
  /** 缺失抛错；调用方自己决定是否用 `get` 降级。 */
  require<T>(token: ServiceToken<T>): T
  /** 该 token 是否已提供。 */
  has<T>(token: ServiceToken<T>): boolean
  /** 撤销一个 provider（插件卸载用）；返回是否真的删除。 */
  remove<T>(token: ServiceToken<T>): boolean
}
