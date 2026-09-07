import { randomUUID } from 'node:crypto'

import { runWithAssertionRecorder } from '../../scripts/support/recorded-expect.mjs'
import {
  DEFAULT_ARTIFACT_ROOT_DIRECTORY,
  createArtifactWriter,
} from './artifact-writer.mjs'
import {
  DEFAULT_SCRIPT_CONFIG_DIRECTORY,
  DEFAULT_SCRIPT_TIMEOUT_MS,
  DEFAULT_SCRIPTS_DIRECTORY,
  FileScriptConfigRepository,
  MAX_SCRIPT_TIMEOUT_MS,
  MIN_SCRIPT_TIMEOUT_MS,
  assertSafeScriptConfigId,
  resolveScriptEntryUrl,
} from './script-config-repository.mjs'

const DEFAULT_ABORT_CLEANUP_TIMEOUT_MS = 3_000
const MAX_API_RESPONSES = 500
const MAX_RESOURCE_RESPONSES = 2_000
const MAX_NETWORK_FAILURE_LOGS = 200
const MAX_CAPTURE_TEXT_LENGTH = 1_200
const SENSITIVE_CAPTURE_KEY = /authorization|token|password|passwd|secret|cookie|verify[_-]?code|mobile|signature|credential|session|api[_-]?key|x-amz|expires?/i
const CAPTURE_STRING_KEY_PATTERN = '(?:authorization|token|password|passwd|secret|cookie|verify[_-]?code|mobile|signature|credential|session|api[_-]?key|x-amz[^"\'\\s:=&]*|expires?)'
const HTTP_CAPTURE_PROTOCOLS = new Set(['http:', 'https:'])
const NETWORK_CAPTURE_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:'])
const EXECUTION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/
const RUN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,99}$/
const defaultScriptConfigRepository = new FileScriptConfigRepository({
  directory: DEFAULT_SCRIPT_CONFIG_DIRECTORY,
  scriptsDirectory: DEFAULT_SCRIPTS_DIRECTORY,
})

export {
  DEFAULT_SCRIPT_TIMEOUT_MS,
  MAX_SCRIPT_TIMEOUT_MS,
  MIN_SCRIPT_TIMEOUT_MS,
}

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

function normalizeExecutionId(rawExecutionId) {
  if (rawExecutionId === undefined) return undefined
  if (typeof rawExecutionId !== 'string' || !EXECUTION_ID_PATTERN.test(rawExecutionId)) {
    throw new Error('制品执行 ID 格式无效')
  }
  return rawExecutionId
}

function normalizeRunId(rawRunId) {
  if (rawRunId === undefined) return undefined
  if (typeof rawRunId !== 'string' || !RUN_ID_PATTERN.test(rawRunId)) {
    throw new Error('运行任务 ID 格式无效')
  }
  return rawRunId
}

function normalizeFirstPartyOrigins(rawOrigins) {
  if (rawOrigins === undefined) return []
  if (!Array.isArray(rawOrigins) || rawOrigins.length > 20) {
    throw new Error('一方网络来源必须是不超过 20 项的 URL 数组')
  }
  return [...new Set(rawOrigins.map((rawOrigin, index) => (
    assertHttpUrl(rawOrigin, `一方网络来源[${index}]`).origin
  )))]
}

function inferredPublicOrigin(siteBaseUrl) {
  const url = new URL(siteBaseUrl)
  if (url.hostname.includes('.admin.')) {
    url.hostname = url.hostname.replace('.admin.', '.')
  } else if (url.hostname.includes('.b.lingxi-hk.localtest')) {
    url.hostname = url.hostname.replace('.b.lingxi-hk.localtest', '.f.lingxi-hk.localtest')
  }
  return url.origin
}

function firstPartyOriginsForContext(context) {
  return new Set([
    ...context.firstPartyOrigins,
    new URL(context.siteBaseUrl).origin,
    new URL(context.apiBaseUrl).origin,
    inferredPublicOrigin(context.siteBaseUrl),
  ])
}

export function validateRunRequest(payload, {
  defaultTimeoutMs = DEFAULT_SCRIPT_TIMEOUT_MS,
} = {}) {
  if (!payload || typeof payload !== 'object') throw new Error('运行参数不能为空')
  try {
    assertSafeScriptConfigId(payload.scriptId)
  } catch {
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
  const firstPartyOrigins = normalizeFirstPartyOrigins(context.firstPartyOrigins)
  const executionId = normalizeExecutionId(payload.executionId)
  normalizeRunId(payload.runId)
  const timeoutMs = payload.timeoutMs ?? defaultTimeoutMs
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
    firstPartyOrigins,
    ...(executionId ? { executionId } : {}),
    ...(requestPath ? { requestPath } : {}),
  }
}

async function runnableScriptConfig(scriptId, {
  scriptConfigRepository = defaultScriptConfigRepository,
  scriptsDirectory = DEFAULT_SCRIPTS_DIRECTORY,
} = {}) {
  const config = await scriptConfigRepository.get(scriptId)
  if (!config) throw new Error('脚本未登记，Runner 拒绝执行')
  if (!config.enabled) throw new Error('脚本已禁用，Runner 拒绝执行')
  const scriptUrl = await resolveScriptEntryUrl(config, { scriptsDirectory })
  return { config, scriptUrl }
}

export async function validateRegisteredRunRequest(payload, options = {}) {
  if (!payload || typeof payload !== 'object') throw new Error('运行参数不能为空')
  try {
    assertSafeScriptConfigId(payload.scriptId)
  } catch {
    throw new Error('脚本未登记，Runner 拒绝执行')
  }
  const { config } = await runnableScriptConfig(payload.scriptId, options)
  return validateRunRequest({ ...payload, timeoutMs: config.timeoutMs })
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
  message = message.replace(
    new RegExp(`(["']?${CAPTURE_STRING_KEY_PATTERN}["']?\\s*[:=]\\s*)["']?[^&\\s,}"']+`, 'gi'),
    '$1[REDACTED]',
  )
  message = message.replace(/(?:https?|wss?):\/\/[^\s"'<>]+/gi, (candidate) => {
    const trailingPunctuation = candidate.match(/[),.;!?]+$/)?.[0] ?? ''
    const rawUrl = trailingPunctuation
      ? candidate.slice(0, -trailingPunctuation.length)
      : candidate
    try {
      return `${sanitizeCapturedUrl(rawUrl, [], { sanitizeText: false })}${trailingPunctuation}`
    } catch {
      return candidate
    }
  })
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

function sanitizeCapturedUrl(rawUrl, secrets, { sanitizeText = true } = {}) {
  const url = new URL(rawUrl)
  if (url.username) url.username = '[REDACTED]'
  if (url.password) url.password = '[REDACTED]'
  for (const key of url.searchParams.keys()) {
    if (SENSITIVE_CAPTURE_KEY.test(key)) url.searchParams.set(key, '[REDACTED]')
  }
  if (url.hash && SENSITIVE_CAPTURE_KEY.test(url.hash)) {
    url.hash = url.hash.replace(
      new RegExp(`(${CAPTURE_STRING_KEY_PATTERN}=)[^&]+`, 'gi'),
      '$1[REDACTED]',
    )
  }
  return sanitizeText ? sanitizeErrorMessage(url.toString(), secrets) : url.toString()
}

function sanitizedOptionalString(value, secrets, { maxLength = MAX_CAPTURE_TEXT_LENGTH } = {}) {
  if (typeof value !== 'string' || !value.trim()) return undefined
  return sanitizeErrorMessage(value.trim(), secrets).slice(0, maxLength)
}

function sanitizeOptionalUrl(value, secrets, {
  protocols = HTTP_CAPTURE_PROTOCOLS,
} = {}) {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const url = new URL(value)
    if (!protocols.has(url.protocol)) return undefined
    return sanitizeCapturedUrl(url.toString(), secrets)
  } catch {
    return undefined
  }
}

function isFirstPartyUrl(url, origins) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'ws:') parsed.protocol = 'http:'
    if (parsed.protocol === 'wss:') parsed.protocol = 'https:'
    return origins.has(parsed.origin)
  } catch {
    return false
  }
}

function createCaptureBuffer(limit, { isWarning = (record) => !record.isFirstParty } = {}) {
  const records = []
  const stats = {
    observed: 0,
    recorded: 0,
    dropped: 0,
    passed: 0,
    failed: 0,
    warnings: 0,
  }

  return {
    records,
    stats,
    add(record) {
      if (record.ignored) return null
      stats.observed += 1
      record.sequence = stats.observed
      if (record.warning || (!record.ok && isWarning(record))) stats.warnings += 1
      else if (record.ok) stats.passed += 1
      else stats.failed += 1

      if (records.length < limit) {
        records.push(record)
      } else if (!record.ok || record.warning) {
        const replaceIndex = records.findIndex((captured) => captured.ok && !captured.warning)
        if (replaceIndex >= 0) {
          records.splice(replaceIndex, 1)
          records.push(record)
        }
      }
      stats.recorded = records.length
      stats.dropped = stats.observed - stats.recorded
      return record
    },
  }
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

function normalizeNetworkRecord(response, {
  kind,
  origins,
  secrets,
}) {
  if (!response || typeof response !== 'object') return null
  const url = sanitizeOptionalUrl(response.url, secrets, {
    protocols: NETWORK_CAPTURE_PROTOCOLS,
  })
  if (!url) return null

  const status = Number.isInteger(response.status) && response.status >= 0 && response.status <= 599
    ? response.status
    : 0
  const ignored = response.ignored === true
  const ok = ignored || (response.ok === true && status < 400)
  const warning = response.warning === true
  const incomplete = response.incomplete === true
  const phase = sanitizedOptionalString(response.phase, secrets, { maxLength: 200 })
    ?? '未标记阶段'
  const pageUrl = sanitizeOptionalUrl(response.pageUrl, secrets)
  const frameUrl = sanitizeOptionalUrl(response.frameUrl, secrets)
  const mimeType = sanitizedOptionalString(response.mimeType, secrets, { maxLength: 200 })
  const error = sanitizedOptionalString(response.error, secrets)
  const bodyReadError = sanitizedOptionalString(response.bodyReadError, secrets)
  const failureKind = sanitizedOptionalString(response.failureKind, secrets, { maxLength: 80 })
  const diagnostics = Array.isArray(response.diagnostics)
    ? response.diagnostics
      .map((diagnostic) => sanitizedOptionalString(diagnostic, secrets))
      .filter(Boolean)
      .slice(0, 20)
    : []
  const parsedUrl = new URL(url)
  const common = {
    sequence: 0,
    timestamp: typeof response.timestamp === 'string' && Number.isFinite(Date.parse(response.timestamp))
      ? response.timestamp
      : new Date().toISOString(),
    name: sanitizedOptionalString(response.name, secrets, { maxLength: 500 })
      ?? parsedUrl.pathname,
    url,
    status,
    ok,
    durationMs: Number.isFinite(response.durationMs)
      ? Math.max(0, Math.round(response.durationMs))
      : 0,
    phase,
    isFirstParty: isFirstPartyUrl(url, origins),
    ...(pageUrl ? { pageUrl } : {}),
    ...(frameUrl ? { frameUrl } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(error ? { error } : {}),
    ...(bodyReadError ? { bodyReadError } : {}),
    ...(failureKind ? { failureKind } : {}),
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
    ...(typeof response.streaming === 'boolean' ? { streaming: response.streaming } : {}),
    ...(ignored ? { ignored: true } : {}),
    ...(warning ? { warning: true } : {}),
    ...(incomplete ? { incomplete: true } : {}),
  }

  if (kind === 'api') {
    const method = typeof response.method === 'string' ? response.method.trim().toUpperCase() : ''
    if (!method) return null
    return {
      ...common,
      method,
      ...('requestBody' in response
        ? { requestBody: sanitizeCapturedValue(response.requestBody, secrets) }
        : {}),
      ...('responseBody' in response
        ? { responseBody: sanitizeCapturedValue(response.responseBody, secrets) }
        : {}),
    }
  }

  const resourceType = sanitizedOptionalString(response.resourceType, secrets, { maxLength: 80 })
    ?? 'other'
  return {
    ...common,
    method: typeof response.method === 'string' && response.method.trim()
      ? response.method.trim().toUpperCase()
      : 'GET',
    resourceType,
    ...(typeof response.fromCache === 'boolean' ? { fromCache: response.fromCache } : {}),
    ...(typeof response.fromServiceWorker === 'boolean'
      ? { fromServiceWorker: response.fromServiceWorker }
      : {}),
  }
}

function createNetworkHealthAccumulator(groupKey, {
  shouldAssert = (record) => record.isFirstParty,
  maxFailures = Number.POSITIVE_INFINITY,
} = {}) {
  const failures = []
  const passedGroups = new Map()
  let omittedFailures = 0
  return {
    failures,
    passedGroups,
    get omittedFailures() {
      return omittedFailures
    },
    add(record) {
      if (!shouldAssert(record)) return
      if (record.ignored) return
      if (record.warning) return
      if (!record.ok) {
        const failure = {
          phase: record.phase,
          method: record.method,
          url: record.url,
          status: record.status,
          ...(record.resourceType ? { resourceType: record.resourceType } : {}),
          ...(record.error ? { error: record.error } : {}),
          ...(record.failureKind ? { failureKind: record.failureKind } : {}),
          ...(record.diagnostics ? { diagnostics: record.diagnostics } : {}),
        }
        if (failures.length < maxFailures) failures.push(failure)
        else omittedFailures += 1
        return
      }
      const key = groupKey(record)
      passedGroups.set(key, (passedGroups.get(key) ?? 0) + 1)
    },
  }
}

function networkFailureReason(record) {
  return record.error
    ?? record.bodyReadError
    ?? (record.diagnostics?.length ? record.diagnostics.join(' | ') : undefined)
    ?? record.failureKind
    ?? 'unknown'
}

function appendNetworkHealthAssertions(assertions, apiHealth, resourceHealth) {
  const append = ({ module, name, status, error }) => {
    assertions.push({
      sequence: assertions.length + 1,
      timestamp: new Date().toISOString(),
      name,
      module,
      matcher: 'networkHealth',
      status,
      durationMs: 0,
      ...(error ? { error } : {}),
    })
  }

  for (const record of apiHealth.failures) {
    const reason = networkFailureReason(record)
    const evidence = `phase=${record.phase}; method=${record.method}; url=${record.url}; status=${record.status}; error=${reason}`
    append({
      module: '接口健康',
      name: `[${record.phase}] ${record.method} ${record.url} 请求失败（status=${record.status}，error=${reason}）`,
      status: 'failed',
      error: `接口请求失败：${evidence}`.slice(0, 1_200),
    })
  }
  for (const [phase, count] of apiHealth.passedGroups) {
    append({
      module: '接口健康',
      name: `[${phase}] ${count} 个一方接口请求成功`,
      status: 'passed',
    })
  }
  if (apiHealth.omittedFailures > 0) {
    append({
      module: '接口健康',
      name: `另有 ${apiHealth.omittedFailures} 个失败接口因断言明细上限未逐条展开`,
      status: 'failed',
      error: `失败接口数量超过 ${MAX_API_RESPONSES} 条，完整数量请结合网络汇总中的 failed 与 dropped 查看`,
    })
  }

  for (const record of resourceHealth.failures) {
    const reason = networkFailureReason(record)
    const evidence = `phase=${record.phase}; method=${record.method}; type=${record.resourceType}; url=${record.url}; status=${record.status}; error=${reason}`
    append({
      module: '资源加载健康',
      name: `[${record.phase}] ${record.method} ${record.resourceType} ${record.url} 加载失败（status=${record.status}，error=${reason}）`,
      status: 'failed',
      error: `资源加载失败：${evidence}`.slice(0, 1_200),
    })
  }
  for (const [group, count] of resourceHealth.passedGroups) {
    const separatorIndex = group.indexOf('\u0000')
    const phase = group.slice(0, separatorIndex)
    const resourceType = group.slice(separatorIndex + 1)
    append({
      module: '资源加载健康',
      name: `[${phase}] ${count} 个 ${resourceType} 资源加载成功`,
      status: 'passed',
    })
  }
  if (resourceHealth.omittedFailures > 0) {
    append({
      module: '资源加载健康',
      name: `另有 ${resourceHealth.omittedFailures} 个失败资源因断言明细上限未逐条展开`,
      status: 'failed',
      error: `失败资源数量超过 ${MAX_RESOURCE_RESPONSES} 条，完整数量请结合网络汇总中的 failed 与 dropped 查看`,
    })
  }

  return apiHealth.failures.length
    + resourceHealth.failures.length
    + Number(apiHealth.omittedFailures > 0)
    + Number(resourceHealth.omittedFailures > 0)
}

export async function executeRegisteredScript(payload, {
  onLog,
  signal,
  loadScript = (scriptUrl) => import(scriptUrl.href),
  abortCleanupTimeoutMs = DEFAULT_ABORT_CLEANUP_TIMEOUT_MS,
  artifactRootDirectory = DEFAULT_ARTIFACT_ROOT_DIRECTORY,
  artifactWriterFactory = createArtifactWriter,
  scriptConfigRepository = defaultScriptConfigRepository,
  scriptsDirectory = DEFAULT_SCRIPTS_DIRECTORY,
} = {}) {
  if (!payload || typeof payload !== 'object') throw new Error('运行参数不能为空')
  try {
    assertSafeScriptConfigId(payload.scriptId)
  } catch {
    throw new Error('脚本未登记，Runner 拒绝执行')
  }
  const { config, scriptUrl } = await runnableScriptConfig(payload.scriptId, {
    scriptConfigRepository,
    scriptsDirectory,
  })
  const context = validateRunRequest({ ...payload, timeoutMs: config.timeoutMs })
  const attemptId = payload.runId ?? randomUUID()
  const artifactWriter = artifactWriterFactory({
    rootDirectory: artifactRootDirectory,
    executionId: context.executionId ?? attemptId,
    stepId: context.scriptId,
    attemptId,
  })
  const logs = []
  const assertions = []
  const apiCapture = createCaptureBuffer(MAX_API_RESPONSES)
  const resourceCapture = createCaptureBuffer(MAX_RESOURCE_RESPONSES, { isWarning: () => false })
  const firstPartyOrigins = firstPartyOriginsForContext(context)
  const apiHealth = createNetworkHealthAccumulator(
    (record) => record.phase,
    { maxFailures: MAX_API_RESPONSES },
  )
  const resourceHealth = createNetworkHealthAccumulator(
    (record) => `${record.phase}\u0000${record.resourceType}`,
    {
      shouldAssert: () => true,
      maxFailures: MAX_RESOURCE_RESPONSES,
    },
  )
  const startedAt = performance.now()
  const executionDeadline = startedAt + context.timeoutMs
  const executionController = new AbortController()
  let timedOut = false
  let networkHealthSealed = false
  let networkFailedAssertionCount = 0
  let networkFailureLogCount = 0
  let networkFailureLogLimitReported = false
  const timeoutMessage = `脚本执行超过 ${context.timeoutMs} ms，已自动终止`
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
  const sealNetworkHealthAssertions = () => {
    if (networkHealthSealed) return networkFailedAssertionCount
    networkHealthSealed = true
    networkFailedAssertionCount = appendNetworkHealthAssertions(
      assertions,
      apiHealth,
      resourceHealth,
    )
    return networkFailedAssertionCount
  }
  const finalizeResult = async (terminalResult, sealTimeoutMs = abortCleanupTimeoutMs) => {
    sealNetworkHealthAssertions()
    const remainingExecutionMs = Math.max(0, Math.ceil(executionDeadline - performance.now()))
    const boundedSealTimeoutMs = Math.min(
      Math.max(0, sealTimeoutMs),
      remainingExecutionMs,
    )
    const sealed = await artifactWriter.seal({ timeoutMs: boundedSealTimeoutMs })
    if (sealed.timedOut) {
      logger(
        'warning',
        `制品捕获清理超过 ${boundedSealTimeoutMs} ms，已放弃 ${sealed.abandonedCaptureCount} 个未完成制品`,
      )
    }
    if (!timedOut && performance.now() >= executionDeadline) {
      timedOut = true
      executionController.abort(new Error(timeoutMessage))
    }
    const finalTerminalResult = timedOut
      ? {
          ok: false,
          timedOut: true,
          status: 'failed',
          error: timeoutMessage,
        }
      : terminalResult
    return {
      ...finalTerminalResult,
      durationMs: Math.round(performance.now() - startedAt),
      logs,
      assertions,
      apiResponses: apiCapture.records,
      resourceResponses: resourceCapture.records,
      networkSummary: {
        api: { ...apiCapture.stats },
        resources: { ...resourceCapture.stats },
      },
      artifacts: sealed.artifacts,
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
  const recordNetworkResponse = (response, kind) => {
    try {
      const record = normalizeNetworkRecord(response, {
        kind,
        origins: firstPartyOrigins,
        secrets,
      })
      if (!record) return
      const capture = kind === 'api' ? apiCapture : resourceCapture
      const health = kind === 'api' ? apiHealth : resourceHealth
      capture.add(record)
      health.add(record)
      if (record.warning) {
        const category = kind === 'api' ? '接口' : '资源'
        const target = kind === 'api'
          ? `${record.method} ${record.url}`
          : `${record.method} ${record.resourceType} ${record.url}`
        if (networkFailureLogCount < MAX_NETWORK_FAILURE_LOGS) {
          networkFailureLogCount += 1
          logger('warning', `${category}响应采集不完整：[${record.phase}] ${target}`, {
            phase: record.phase,
            method: record.method,
            ...(kind === 'resource' ? { resourceType: record.resourceType } : {}),
            url: record.url,
            status: record.status,
            error: networkFailureReason(record),
          })
        } else if (!networkFailureLogLimitReported) {
          networkFailureLogLimitReported = true
          logger('warning', `网络诊断日志超过 ${MAX_NETWORK_FAILURE_LOGS} 条，后续明细仅保留在网络记录和汇总中`)
        }
      } else if (!record.ok) {
        const category = kind === 'api' ? '接口' : '资源'
        const target = kind === 'api'
          ? `${record.method} ${record.url}`
          : `${record.method} ${record.resourceType} ${record.url}`
        const warningOnly = kind === 'api' && !record.isFirstParty
        if (networkFailureLogCount < MAX_NETWORK_FAILURE_LOGS) {
          networkFailureLogCount += 1
          logger(warningOnly ? 'warning' : 'error', warningOnly
            ? `第三方接口请求失败：[${record.phase}] ${target}`
            : `${category}健康检查失败：[${record.phase}] ${target}`, {
            phase: record.phase,
            method: record.method,
            ...(kind === 'resource' ? { resourceType: record.resourceType } : {}),
            url: record.url,
            status: record.status,
            error: networkFailureReason(record),
          })
        } else if (!networkFailureLogLimitReported) {
          networkFailureLogLimitReported = true
          logger('warning', `网络失败日志超过 ${MAX_NETWORK_FAILURE_LOGS} 条，后续明细仅保留在网络记录和汇总中`)
        }
      }
    } catch {
      // 网络证据格式异常不能打断业务脚本。
    }
  }
  const recordApiResponse = (response) => recordNetworkResponse(response, 'api')
  const recordResourceResponse = (response) => recordNetworkResponse(response, 'resource')
  const relayExternalAbort = () => executionController.abort(signal?.reason)
  if (signal?.aborted) relayExternalAbort()
  else signal?.addEventListener('abort', relayExternalAbort, { once: true })
  const timeoutId = setTimeout(() => {
    timedOut = true
    executionController.abort(new Error(timeoutMessage))
  }, Math.max(0, executionDeadline - performance.now()))
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
        scriptName: config.name,
        artifactWriter,
        logger,
        signal: executionController.signal,
        recordApiResponse,
        recordResourceResponse,
      }),
    ))
    const result = await waitWithAbort(scriptRunPromise, abortGate)
    if (executionController.signal.aborted) throw abortGate?.error()
    const scriptFailedAssertions = assertions.filter((assertion) => assertion.status === 'failed').length
    const networkFailedAssertions = sealNetworkHealthAssertions()
    const failedAssertions = scriptFailedAssertions + networkFailedAssertions
    if (failedAssertions > 0) {
      const message = `脚本已执行完成，共有 ${failedAssertions} 条断言失败`
      logger('warning', message, {
        failedAssertions,
        networkFailedAssertions,
        totalAssertions: assertions.length,
      })
      return await finalizeResult({
        ok: false,
        status: 'failed',
        continuePipeline: true,
        result,
        error: message,
      })
    }
    return await finalizeResult({
      ok: true,
      result,
    })
  } catch (error) {
    if (abortGate?.wasTriggered(error)) {
      const cleanupDeadline = performance.now() + abortCleanupTimeoutMs
      if (scriptRunPromise) {
        const cleanupSettled = await waitForSettlement(scriptRunPromise, abortCleanupTimeoutMs)
        if (!cleanupSettled) {
          logger(
            'warning',
            `脚本取消清理超过 ${abortCleanupTimeoutMs} ms，Runner 已停止等待`,
          )
        }
      }
      const artifactSealTimeoutMs = Math.max(0, Math.ceil(cleanupDeadline - performance.now()))
      if (timedOut) {
        return await finalizeResult({
          ok: false,
          timedOut: true,
          status: 'failed',
          error: timeoutMessage,
        }, artifactSealTimeoutMs)
      }
      return await finalizeResult({
        ok: false,
        cancelled: true,
        status: 'interrupted',
        error: sanitizeErrorMessage(cancellationReason(signal), secrets),
      }, artifactSealTimeoutMs)
    }
    const message = sanitizeErrorMessage(error, secrets)
    logger('error', `执行失败：${message}`)
    return await finalizeResult({
      ok: false,
      error: message,
    })
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', relayExternalAbort)
    abortGate?.dispose()
  }
}
