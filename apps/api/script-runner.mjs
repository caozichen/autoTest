import { runWithAssertionRecorder } from '../../scripts/support/recorded-expect.mjs'

const scriptRegistry = Object.freeze({
  'form-submission-reply-edit': new URL('../../scripts/form-submission-reply-edit.ui.spec.mjs', import.meta.url),
  'form-lpxavn-submit': new URL('../../scripts/form-lpxavn-submit.ui.spec.mjs', import.meta.url),
  'form-all-fields-submit': new URL('../../scripts/form-all-fields-submit.ui.spec.mjs', import.meta.url),
  'form-all-fields-publish': new URL('../../scripts/form-all-fields-publish.ui.spec.mjs', import.meta.url),
  'form-contact-publish': new URL('../../scripts/form-contact-publish.ui.spec.mjs', import.meta.url),
})
const DEFAULT_ABORT_CLEANUP_TIMEOUT_MS = 3_000
const MAX_API_RESPONSES = 500
const SENSITIVE_CAPTURE_KEY = /authorization|token|password|passwd|secret|cookie|verify[_-]?code|mobile/i
export const DEFAULT_SCRIPT_TIMEOUT_MS = 300_000
export const MIN_SCRIPT_TIMEOUT_MS = 1_000
export const MAX_SCRIPT_TIMEOUT_MS = 1_800_000

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

function normalizeRequestPath(rawPath) {
  if (rawPath === undefined) return undefined
  if (typeof rawPath !== 'string') throw new Error('脚本 URL 路径必须是字符串')
  const requestPath = rawPath.trim()
  if (!requestPath) throw new Error('脚本 URL 路径不能为空')
  if (/^[a-z][a-z\d+.-]*:/i.test(requestPath) || requestPath.startsWith('//')) {
    throw new Error('脚本 URL 路径必须是相对路径')
  }
  if (/[{}]/.test(requestPath)) throw new Error('脚本 URL 路径包含未解析变量')
  if (/\s/.test(requestPath)) throw new Error('脚本 URL 路径不能包含空格或换行')
  if (requestPath.includes('\\')) throw new Error('脚本 URL 路径不能包含反斜杠')
  return requestPath.startsWith('/') ? requestPath : `/${requestPath}`
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
  const requestPath = normalizeRequestPath(context.requestPath)
  const timeoutMs = payload.timeoutMs ?? DEFAULT_SCRIPT_TIMEOUT_MS
  if (!Number.isInteger(timeoutMs)
    || timeoutMs < MIN_SCRIPT_TIMEOUT_MS
    || timeoutMs > MAX_SCRIPT_TIMEOUT_MS) {
    throw new Error(
      `脚本执行超时必须是 ${MIN_SCRIPT_TIMEOUT_MS} 到 ${MAX_SCRIPT_TIMEOUT_MS} 之间的整数毫秒值`,
    )
  }

  return {
    scriptId: payload.scriptId,
    timeoutMs,
    siteBaseUrl: siteBaseUrl.toString(),
    apiBaseUrl: apiBaseUrl.toString(),
    ignoreHTTPSErrors: context.ignoreHTTPSErrors === true,
    variables: Object.fromEntries(variableEntries),
    authorizationOrigin: authorizationOrigin.origin,
    extraHTTPHeaders: { Authorization: authorization.trim() },
    ...(requestPath ? { requestPath } : {}),
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

function sanitizeCapturedValue(value, secrets, key = '') {
  if (SENSITIVE_CAPTURE_KEY.test(key)) return '[REDACTED]'
  if (typeof value === 'string') return sanitizeErrorMessage(value, secrets)
  if (Array.isArray(value)) return value.map((item) => sanitizeCapturedValue(item, secrets))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
    entryKey,
    sanitizeCapturedValue(entryValue, secrets, entryKey),
  ]))
}

function sanitizeCapturedUrl(rawUrl, secrets) {
  const url = new URL(rawUrl)
  for (const key of url.searchParams.keys()) {
    if (SENSITIVE_CAPTURE_KEY.test(key)) url.searchParams.set(key, '[REDACTED]')
  }
  return sanitizeErrorMessage(url.toString(), secrets)
}

function cancellationReason(signal) {
  const reason = signal?.reason
  if (reason instanceof Error && reason.message) return reason.message
  if (typeof reason === 'string' && reason.trim()) return reason.trim()
  return '用户强制停止运行'
}

function createAbortGate(signal, logger, secrets, isTimeout) {
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
    abortError.name = isTimeout() ? 'TimeoutError' : 'AbortError'
    logger(isTimeout() ? 'error' : 'warning', isTimeout()
      ? `执行超时：${reason}`
      : `执行已取消：${reason}`)
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
  const assertions = []
  const apiResponses = []
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
  const recordAssertion = (assertion) => {
    assertions.push({
      sequence: assertions.length + 1,
      timestamp: assertion.timestamp,
      name: assertion.name,
      module: assertion.module,
      matcher: assertion.matcher,
      status: assertion.status,
      durationMs: assertion.durationMs,
      ...(assertion.error
        ? { error: sanitizeErrorMessage(assertion.error, secrets).slice(0, 1_200) }
        : {}),
    })
  }
  const recordApiResponse = (response) => {
    if (!response || typeof response !== 'object' || apiResponses.length >= MAX_API_RESPONSES) return
    const method = typeof response.method === 'string' ? response.method.toUpperCase() : ''
    if (!method || typeof response.url !== 'string') return
    let url
    try {
      url = sanitizeCapturedUrl(response.url, secrets)
    } catch {
      return
    }
    apiResponses.push({
      sequence: apiResponses.length + 1,
      timestamp: typeof response.timestamp === 'string' ? response.timestamp : new Date().toISOString(),
      name: typeof response.name === 'string' && response.name.trim()
        ? response.name.trim()
        : new URL(url).pathname,
      method,
      url,
      status: Number.isInteger(response.status) ? response.status : 0,
      ok: response.ok === true,
      durationMs: Number.isFinite(response.durationMs) ? Math.max(0, Math.round(response.durationMs)) : 0,
      ...('requestBody' in response
        ? { requestBody: sanitizeCapturedValue(response.requestBody, secrets) }
        : {}),
      ...('responseBody' in response
        ? { responseBody: sanitizeCapturedValue(response.responseBody, secrets) }
        : {}),
      ...(typeof response.error === 'string'
        ? { error: sanitizeErrorMessage(response.error, secrets) }
        : {}),
    })
  }
  const executionController = new AbortController()
  let timedOut = false
  const timeoutMessage = `脚本执行超过 ${context.timeoutMs} ms，已自动终止`
  const relayExternalAbort = () => executionController.abort(signal?.reason)
  if (signal?.aborted) relayExternalAbort()
  else signal?.addEventListener('abort', relayExternalAbort, { once: true })
  const timeoutId = setTimeout(() => {
    timedOut = true
    executionController.abort(new Error(timeoutMessage))
  }, context.timeoutMs)
  const abortGate = createAbortGate(
    executionController.signal,
    logger,
    secrets,
    () => timedOut,
  )
  let scriptRunPromise = null

  try {
    const scriptModule = await waitWithAbort(loadScript(scriptUrl), abortGate)
    if (typeof scriptModule.run !== 'function') throw new Error('脚本入口未导出 run 函数')
    scriptRunPromise = Promise.resolve().then(() => runWithAssertionRecorder(
      context.scriptId,
      recordAssertion,
      () => scriptModule.run({
        ...context,
        logger,
        signal: executionController.signal,
        recordApiResponse,
      }),
    ))
    const result = await waitWithAbort(scriptRunPromise, abortGate)
    if (executionController.signal.aborted) throw abortGate?.error()
    const failedAssertions = assertions.filter((assertion) => assertion.status === 'failed')
    if (failedAssertions.length > 0) {
      const message = `脚本已执行完成，共有 ${failedAssertions.length} 条断言失败`
      logger('warning', message, {
        failedAssertions: failedAssertions.length,
        totalAssertions: assertions.length,
      })
      return {
        ok: false,
        status: 'failed',
        durationMs: Math.round(performance.now() - startedAt),
        logs,
        assertions,
        apiResponses,
        result,
        error: message,
      }
    }
    return {
      ok: true,
      durationMs: Math.round(performance.now() - startedAt),
      logs,
      assertions,
      apiResponses,
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
      if (timedOut) {
        return {
          ok: false,
          timedOut: true,
          status: 'failed',
          durationMs: Math.round(performance.now() - startedAt),
          logs,
          assertions,
          apiResponses,
          error: timeoutMessage,
        }
      }
      return {
        ok: false,
        cancelled: true,
        status: 'interrupted',
        durationMs: Math.round(performance.now() - startedAt),
        logs,
        assertions,
        apiResponses,
        error: sanitizeErrorMessage(cancellationReason(signal), secrets),
      }
    }
    const message = sanitizeErrorMessage(error, secrets)
    logger('error', `执行失败：${message}`)
    return {
      ok: false,
      durationMs: Math.round(performance.now() - startedAt),
      logs,
      assertions,
      apiResponses,
      error: message,
    }
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', relayExternalAbort)
    abortGate?.dispose()
  }
}
