import { AsyncLocalStorage, createHook } from 'node:async_hooks'

const scriptExecutionStorage = new AsyncLocalStorage()
const scriptExecutionScopes = new WeakSet()
const promiseScopes = new WeakMap()
let guardOwnerCount = 0

function rejectionDetail(reason) {
  try {
    if (reason instanceof Error) return reason.message || reason.name
    return String(reason)
  } catch {
    return '未知异步错误'
  }
}

export class ScriptUnhandledRejectionError extends Error {
  constructor(reason) {
    let cause
    try {
      if (reason instanceof Error) cause = reason
    } catch {
      cause = undefined
    }
    super(
      `脚本存在未处理的 Promise rejection：${rejectionDetail(reason)}`,
      cause ? { cause } : undefined,
    )
    this.name = 'ScriptUnhandledRejectionError'
    this.code = 'SCRIPT_UNHANDLED_REJECTION'
  }
}

const promiseTrackingHook = createHook({
  init(_asyncId, type, _triggerAsyncId, resource) {
    try {
      if (type !== 'PROMISE') return
      const scope = scriptExecutionStorage.getStore()
      if (scope && scriptExecutionScopes.has(scope)) promiseScopes.set(resource, scope)
    } catch {
      // Exceptions from async_hooks callbacks are process-fatal, so this hook must be no-throw.
    }
  },
})

function handleUnhandledRejection(reason, promise) {
  try {
    const scope = promiseScopes.get(promise) ?? scriptExecutionStorage.getStore()
    if (scope && scriptExecutionScopes.has(scope)) {
      scope.capture(reason)
      return
    }
  } catch {
    console.error(
      '[runner] UNHANDLED_REJECTION_GUARD_ERROR：异步错误隔离器处理失败；'
      + '为保持服务在线已拦截，详情因可能包含敏感信息未输出',
    )
    return
  }
  console.error(
    '[runner] UNHANDLED_REJECTION_UNSCOPED：捕获到无法归属运行的异步错误；'
    + '为保持服务在线已隔离该错误，详情因可能包含敏感信息未输出',
  )
}

export function retainScriptRejectionGuard() {
  if (guardOwnerCount === 0) {
    promiseTrackingHook.enable()
    process.prependListener('unhandledRejection', handleUnhandledRejection)
  }
  guardOwnerCount += 1

  let released = false
  return () => {
    if (released) return
    released = true
    guardOwnerCount = Math.max(0, guardOwnerCount - 1)
    if (guardOwnerCount > 0) return
    process.off('unhandledRejection', handleUnhandledRejection)
    promiseTrackingHook.disable()
  }
}

function oneEventLoopTurn() {
  return new Promise((resolve) => setImmediate(resolve))
}

export async function runWithScriptRejectionBoundary(task, { onUnhandledRejection } = {}) {
  if (typeof task !== 'function') throw new TypeError('脚本执行任务必须是函数')

  let reportFailure
  const failureOutcome = new Promise((resolve) => { reportFailure = resolve })
  const scope = {
    active: true,
    firstError: null,
    capture(reason) {
      if (this.firstError) return
      const error = new ScriptUnhandledRejectionError(reason)
      this.firstError = error
      if (this.active) reportFailure({ type: 'unhandled-rejection', error })
      try {
        onUnhandledRejection?.(error, { late: !this.active })
      } catch {
        // Error reporting must not replace the original script rejection.
      }
    },
  }
  scriptExecutionScopes.add(scope)

  const taskOutcome = scriptExecutionStorage.run(scope, () => (
    Promise.resolve().then(task).then(
      (value) => ({ type: 'fulfilled', value }),
      (error) => ({ type: 'rejected', error }),
    )
  ))
  let outcome = await Promise.race([taskOutcome, failureOutcome])

  if (outcome.type === 'fulfilled') {
    outcome = await Promise.race([
      oneEventLoopTurn().then(() => outcome),
      failureOutcome,
    ])
  }
  scope.active = false

  if (outcome.type === 'unhandled-rejection') throw outcome.error
  if (outcome.type === 'rejected') throw outcome.error
  return outcome.value
}
