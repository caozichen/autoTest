import { AsyncLocalStorage } from 'node:async_hooks'
import { expect as baseExpect } from '@playwright/test'

const timeouts = new AsyncLocalStorage()
export function withEnvironmentTimeouts(environmentCode, action) {
  return timeouts.run(/hk/i.test(environmentCode ?? '') ? 3 : 1, action)
}
export function scaleTimeout(standardMs, { hongKongMs = standardMs * 3 } = {}) {
  return timeouts.getStore() === 3 ? hongKongMs : standardMs
}
// Configure per invocation: concurrent environments must never share mutable defaults.
export const expect = new Proxy(baseExpect, {
  apply(target, thisArg, args) {
    return Reflect.apply(target.configure({ timeout: scaleTimeout(5000) }), thisArg, args)
  },
  get(target, property) {
    const configured = target.configure({ timeout: scaleTimeout(5000) })
    const value = Reflect.get(configured, property)
    return typeof value === 'function' ? value.bind(configured) : value
  },
})
