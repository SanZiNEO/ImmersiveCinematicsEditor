/**
 * 服务注册表实现（04-01）。
 *
 * 同一 token 只允许一个 provider；重复 provide 抛错（带 token 描述）。
 */
import type { ServiceRegistry, ServiceToken } from '../api/services.ts'

export class ServiceRegistryImpl implements ServiceRegistry {
  private readonly providers = new Map<ServiceToken<unknown>, unknown>()

  provide<T>(token: ServiceToken<T>, impl: T): void {
    const key = token as ServiceToken<unknown>
    if (this.providers.has(key)) {
      throw new Error(`服务重复提供: ${token.description}`)
    }
    this.providers.set(key, impl)
  }

  get<T>(token: ServiceToken<T>): T | undefined {
    return this.providers.get(token as ServiceToken<unknown>) as T | undefined
  }

  require<T>(token: ServiceToken<T>): T {
    const value = this.get(token)
    if (value === undefined) {
      throw new Error(`缺少服务: ${token.description}`)
    }
    return value
  }

  has<T>(token: ServiceToken<T>): boolean {
    return this.providers.has(token as ServiceToken<unknown>)
  }

  remove<T>(token: ServiceToken<T>): boolean {
    return this.providers.delete(token as ServiceToken<unknown>)
  }

  /** 已提供的 token 描述（诊断 / 自检用）。 */
  descriptions(): string[] {
    return [...this.providers.keys()].map((token) => token.description)
  }
}
