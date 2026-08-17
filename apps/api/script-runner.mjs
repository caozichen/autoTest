const scriptRegistry = Object.freeze({
  'form-all-fields-submit': new URL('../../scripts/form-all-fields-submit.ui.spec.mjs', import.meta.url),
  'form-all-fields-publish': new URL('../../scripts/form-all-fields-publish.ui.spec.mjs', import.meta.url),
  'form-contact-publish': new URL('../../scripts/form-contact-publish.ui.spec.mjs', import.meta.url),
})
const DEFAULT_ABORT_CLEANUP_TIMEOUT_MS = 3_000

function assertHttpUrl(rawUrl, label) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error(`${label}不是有效 URL`)
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${label}只允许 http 或 https`)
  }
  return url
}

export function validateRunRequest(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('运行参数不能为空')
  if (typeof payload.scriptId !== 'string' || !scriptRegistry[payload.scriptId]) {
    throw new Error('脚本未登记，Runner 拒绝执行')
  }
  const context = payload.context
  if (!context || typeof context !== 'object') throw new Error('缺少脚本运行上下文')

  const siteBaseUrl = assertHttpUrl(context.siteBaseUrl, 'Web 基址')
  const apiBaseUrl = assertHttpUrl(context.apiBaseUrl, 'API 基址')
  const authorizationOrigin = assertHttpUrl(context.authorizationOrigin, '授权来源')
  if (siteBaseUrl.origin !== authorizationOrigin.origin) {
    throw new Error('Web 基址与 Token 授权来源不同源')
  }
  if (apiBaseUrl.origin !== authorizationOrigin.origin) {
    throw new Error('API 基址与 Token 授权来源不同源')
  }

  const authorization = context.extraHTTPHeaders?.Authorization
  if (typeof authorization !== 'string' || !authorization.trim()) {
    throw new Error('缺少 Authorization 请求头')
  }

  const variables = context.variables ?? {}
  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
    throw new Error('运行时变量必须是键值对象')
  }
  const variableEntries = Object.entries(variables)
  if (variableEntries.some(([key, value]) => !key.trim() || typeof value !== 'string')) {
    throw new Error('运行时变量名称不能为空，且变量值必须是字符串')
  }

  return {
    scriptId: payload.scriptId,
    siteBaseUrl: siteBaseUrl.toString(),
    apiBaseUrl: apiBaseUrl.toString(),
    ignoreHTTPSErrors: context.ignoreHTTPSErrors === true,
    variables: Object.fromEntries(variableEntries),
    authorizationOrigin: authorizationOrigin.origin,
    extraHTTPHeaders: { Authorization: authorization.trim() },
  }
}

export function sanitizeErrorMessage(error, secrets = []) {
  let message = error instanceof Error ? error.message : String(error)
  message = message.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
  message = message.replace(
    /(authorization\s*:)\s*[^\r\n]*?(?=\s+-\s+[a-z][a-z-]*\s*:|$)/gi,
    '$1 [REDACTED]',
  )
  for (const secret of secrets) {
    if (typeof secret !== 'string' || !secret) continue
    message = message.split(secret).join('[REDACTED]')
  }
  return message
}

function cancellationReason(signal) {
  const reason = signal?.reason
  if (reason instanceof Error && reason.message) return reason.message
  if (typeof reason === 'string' && reason.trim()) return reason.trim()
  return '用户强制停止运行'
}

function createAbortGate(signal, logger, secrets) {
  if (!signal) return null

  let rejectGate
  let abortError = null
  const promise = new Promise((_, reject) => {
    rejectGate = reject
  })
  const abort = () => {
    if (abortError) return
    const reason = sanitizeErrorMessage(cancellationReason(signal), secrets)
    abortError = new Error(reason)
    abortError.name = 'AbortError'
    logger('warning', `执行已取消：${reason}`)
    rejectGate(abortError)
  }

  if (signal.aborted) abort()
  else signal.addEventListener('abort', abort, { once: true })

  return {
    promise,
    wasTriggered: (error) => error === abortError || signal.aborted,
    error: () => abortError,
    dispose: () => signal.removeEventListener('abort', abort),
  }
}

async function waitWithAbort(promise, abortGate) {
  return abortGate ? Promise.race([promise, abortGate.promise]) : promise
}

async function waitForSettlement(promise, timeoutMs) {
  let timer
  const outcome = await Promise.race([
    Promise.resolve(promise).then(
      () => ({ settled: true }),
      () => ({ settled: true }),
    ),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ settled: false }), timeoutMs)
    }),
  ])
  clearTimeout(timer)
  return outcome.settled
}

export async function executeRegisteredScript(payload, {
  onLog,
  signal,
  loadScript = (scriptUrl) => import(scriptUrl.href),
  abortCleanupTimeoutMs = DEFAULT_ABORT_CLEANUP_TIMEOUT_MS,
} = {}) {
  const context = validateRunRequest(payload)
  const scriptUrl = scriptRegistry[context.scriptId]
  const logs = []
  const startedAt = performance.now()
  const logger = (level, message, details) => {
    const log = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(details === undefined ? {} : { details }),
    }
    logs.push(log)
    try {
      onLog?.(structuredClone(log))
    } catch {
      // 实时日志订阅失败不能中断业务脚本。
    }
  }

  const secrets = [context.extraHTTPHeaders.Authorization]
  const abortGate = createAbortGate(signal, logger, secrets)
  let scriptRunPromise = null

  try {
    const scriptModule = await waitWithAbort(loadScript(scriptUrl), abortGate)
    if (typeof scriptModule.run !== 'function') throw new Error('脚本入口未导出 run 函数')
    scriptRunPromise = Promise.resolve().then(() => scriptModule.run({ ...context, logger, signal }))
    const result = await waitWithAbort(scriptRunPromise, abortGate)
    if (signal?.aborted) throw abortGate?.error()
    return {
      ok: true,
      durationMs: Math.round(performance.now() - startedAt),
      logs,
      result,
    }
  } catch (error) {
    if (abortGate?.wasTriggered(error)) {
      if (scriptRunPromise) {
        const cleanupSettled = await waitForSettlement(scriptRunPromise, abortCleanupTimeoutMs)
        if (!cleanupSettled) {
          logger(
            'warning',
            `脚本取消清理超过 ${abortCleanupTimeoutMs} ms，Runner 已停止等待`,
          )
        }
      }
      return {
        ok: false,
        cancelled: true,
        status: 'interrupted',
        durationMs: Math.round(performance.now() - startedAt),
        logs,
        error: sanitizeErrorMessage(cancellationReason(signal), secrets),
      }
    }
    const message = sanitizeErrorMessage(error, secrets)
    logger('error', `执行失败：${message}`)
    return {
      ok: false,
      durationMs: Math.round(performance.now() - startedAt),
      logs,
      error: message,
    }
  } finally {
    abortGate?.dispose()
  }
}
