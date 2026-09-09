const MAX_BODY_CHARACTERS = 100_000
const DEFAULT_RESPONSE_DRAIN_TIMEOUT_MS = 2_000
const DEFAULT_NETWORK_PHASE = '未标记'
const DIAGNOSTIC_CORRELATION_WINDOW_MS = 100
const API_RESOURCE_TYPES = new Set(['eventsource', 'fetch', 'xhr'])
const HTTP_PROTOCOLS = new Set(['http:', 'https:'])
const CACHE_STATUS_HEADERS = [
  'cf-cache-status',
  'x-cache',
  'x-cache-status',
  'x-proxy-cache',
  'x-vercel-cache',
]
let observerSequence = 0

function truncateText(value) {
  if (value.length <= MAX_BODY_CHARACTERS) return value
  return `${value.slice(0, MAX_BODY_CHARACTERS)}\n[内容已截断，原始长度 ${value.length} 字符]`
}

function parseBodyText(value, contentType = '') {
  if (!value) return null
  const text = truncateText(value)
  if (value.length > MAX_BODY_CHARACTERS) return text
  if (/json/i.test(contentType) || /^[\s\n]*[\[{]/.test(value)) {
    try {
      return JSON.parse(value)
    } catch {
      return text
    }
  }
  if (/application\/x-www-form-urlencoded/i.test(contentType)) {
    return Object.fromEntries(new URLSearchParams(value))
  }
  return text
}

function safely(read, fallback) {
  try {
    return read()
  } catch {
    return fallback
  }
}

function requestBody(request) {
  const method = safely(() => request.method(), 'GET')
  if (['GET', 'HEAD'].includes(method)) return undefined
  const value = safely(() => request.postData(), null)
  if (value === null) return undefined
  const contentType = safely(() => request.headers()['content-type'], '') ?? ''
  if (/multipart\/form-data/i.test(contentType)) {
    return `[multipart/form-data，${value.length} 字符，二进制内容未展开]`
  }
  return parseBodyText(value, contentType)
}

function parseHttpUrl(request) {
  const value = safely(() => request.url(), '')
  try {
    const url = new URL(value)
    return HTTP_PROTOCOLS.has(url.protocol) ? url : null
  } catch {
    return null
  }
}

function requestLocation(request, resourceType, url) {
  const frame = safely(() => request.frame(), null)
  const frameUrl = frame ? safely(() => frame.url(), '') : ''
  const pageUrl = frame ? safely(() => frame.page().url(), '') : ''
  const navigationTarget = resourceType === 'document'
    && safely(() => request.isNavigationRequest(), false)
    ? url.toString()
    : ''
  return {
    ...(pageUrl || navigationTarget ? { pageUrl: pageUrl === 'about:blank' ? navigationTarget : pageUrl } : {}),
    ...(frameUrl ? { frameUrl } : {}),
  }
}

function responseMetadata(response) {
  if (!response) return {}
  const headers = safely(() => response.headers(), {}) ?? {}
  const fromServiceWorker = safely(() => response.fromServiceWorker(), undefined)
  const cacheStatusHeader = CACHE_STATUS_HEADERS.find((name) => headers[name])
  const cacheStatus = cacheStatusHeader
    ? `${cacheStatusHeader}:${headers[cacheStatusHeader]}`
    : undefined
  const age = Number(headers.age)
  const fromCache = (cacheStatus && /(?:^|\W)(?:hit|cached)(?:\W|$)/i.test(cacheStatus))
    || (Number.isFinite(age) && age > 0)
  const contentType = headers['content-type'] ?? ''
  const mimeType = contentType.split(';', 1)[0].trim()

  return {
    ...(mimeType ? { mimeType } : {}),
    ...(fromCache ? { fromCache: true } : {}),
    ...(cacheStatus ? { cacheStatus } : {}),
    ...(typeof fromServiceWorker === 'boolean' ? { fromServiceWorker } : {}),
  }
}

function redirectMetadata(request) {
  const redirectedFrom = safely(() => request.redirectedFrom(), null)
  const redirectedTo = safely(() => request.redirectedTo(), null)
  const fromUrl = redirectedFrom ? safely(() => redirectedFrom.url(), '') : ''
  const toUrl = redirectedTo ? safely(() => redirectedTo.url(), '') : ''
  return {
    ...(fromUrl ? { redirectedFrom: fromUrl } : {}),
    ...(toUrl ? { redirectedTo: toUrl } : {}),
  }
}

function normalizePhase(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_NETWORK_PHASE
}

function normalizeDiagnosticUrl(value, baseUrl = '') {
  if (typeof value !== 'string' || !value.trim()) return ''
  const cleaned = value.trim().replace(/[)'",.;]+$/g, '')
  try {
    const url = new URL(cleaned, baseUrl || undefined)
    return HTTP_PROTOCOLS.has(url.protocol) ? url.toString() : ''
  } catch {
    return ''
  }
}

function extractDiagnosticUrl(value, baseUrl = '') {
  return extractDiagnosticUrls(value, baseUrl)[0] ?? ''
}

function extractDiagnosticUrls(value, baseUrl = '') {
  if (typeof value !== 'string') return []
  const urls = [...value.matchAll(/https?:\/\/[^\s<>"']+/gi)]
    .map((match) => normalizeDiagnosticUrl(match[0], baseUrl))
    .filter(Boolean)
  return [...new Set(urls)]
}

function classifyNetworkConsoleError(message, location = {}, pageUrl = '') {
  const text = String(message || '')
  const isCors = /blocked by CORS policy|cross-origin request blocked|same origin policy disallows|access to (?:fetch|xmlhttprequest) at/i.test(text)
  const isCsp = /content security policy|content-security-policy|violates the following.*(?:script-src|style-src|img-src|font-src|media-src|connect-src|frame-src)/i.test(text)
  const isCspReportOnly = isCsp
    && /\[\s*report(?:\s+|-)?only\s*\]|content-security-policy-report-only|\breport-only\b|\bCSP report is being sent\b/i.test(text)
  if (isCspReportOnly) return null
  const isResourceLoad = /failed to load resource|net::ERR_[A-Z_]+|mixed content:|failed to find a valid digest|integrity attribute|mime type.*(?:mismatch|not supported|not executable)|blocked due to MIME|refused to (?:execute script|apply style|load|connect|frame)/i.test(text)
  if (!isCors && !isCsp && !isResourceLoad) return null

  const messageUrls = extractDiagnosticUrls(text, pageUrl)
  let url = /mixed content:/i.test(text)
    ? messageUrls.at(-1)
    : messageUrls[0]

  if (!url && isResourceLoad) {
    const lineNumber = Number(location.lineNumber ?? 0)
    const columnNumber = Number(location.columnNumber ?? 0)
    if (lineNumber === 0 && columnNumber === 0) {
      url = normalizeDiagnosticUrl(location.url, pageUrl)
    }
  }
  if (!url) return null
  const directive = text.match(/\b(connect-src|script-src|style-src|img-src|font-src|media-src|frame-src|child-src|worker-src|manifest-src)\b/i)?.[1]?.toLowerCase()
  const apiResourceType = /xmlhttprequest/i.test(text)
    ? 'xhr'
    : /\bfetch\b/i.test(text)
      ? 'fetch'
      : directive === 'connect-src'
        ? 'fetch'
        : ''
  return {
    kind: isCsp ? 'csp' : 'console',
    url,
    category: apiResourceType ? 'api' : 'resource',
    ...(apiResourceType ? { resourceType: apiResourceType } : {}),
    ...(directive ? { directive } : {}),
  }
}

function extractStackSourceUrl(value, baseUrl = '') {
  if (typeof value !== 'string') return ''
  const match = value.match(/(https?:\/\/[^\s<>"')]+?):\d+:\d+(?=$|[\s)])/i)
  return normalizeDiagnosticUrl(match?.[1] ?? '', baseUrl)
}

function pageErrorResourceUrl(error, message, pageUrl = '') {
  const dynamicLoadFailure = /failed to fetch dynamically imported module|failed to load module script|importing a module script failed|chunkloaderror|loading chunk \S+ failed/i.test(message)
  const syntaxLoadFailure = safely(() => error.name, '') === 'SyntaxError'
    && !/JSON\.parse|is not valid JSON|at position \d+/i.test(message)
  if (!dynamicLoadFailure && !syntaxLoadFailure) return ''
  return extractStackSourceUrl(message, pageUrl)
    || (dynamicLoadFailure ? extractDiagnosticUrl(message, pageUrl) : '')
}

function pageAddress(page) {
  return page ? safely(() => page.url(), '') : ''
}

function resourceTypeForTag(tagName) {
  switch (String(tagName).toUpperCase()) {
    case 'SCRIPT': return 'script'
    case 'LINK': return 'stylesheet'
    case 'IMG':
    case 'IMAGE': return 'image'
    case 'AUDIO':
    case 'VIDEO':
    case 'SOURCE':
    case 'TRACK': return 'media'
    case 'IFRAME':
    case 'FRAME': return 'document'
    default: return 'other'
  }
}

function resourceTypeForDirective(directive) {
  switch (String(directive).toLowerCase()) {
    case 'connect-src': return 'fetch'
    case 'script-src': return 'script'
    case 'style-src': return 'stylesheet'
    case 'img-src': return 'image'
    case 'font-src': return 'font'
    case 'media-src': return 'media'
    case 'frame-src':
    case 'child-src': return 'document'
    case 'worker-src': return 'worker'
    case 'manifest-src': return 'manifest'
    default: return 'csp'
  }
}

function diagnosticFailureKind(diagnostics) {
  for (const kind of ['csp', 'resource', 'pageerror', 'console']) {
    if (diagnostics.some((diagnostic) => diagnostic.kind === kind)) return kind
  }
  return 'console'
}

function summarizeEntries(entries) {
  return entries.reduce((summary, entry) => {
    if (entry.ignored) {
      summary.ignored += 1
      return summary
    }
    summary.total += 1
    if (!entry.ok) summary.failed += 1
    else if (entry.warning) summary.warnings += 1
    else summary.succeeded += 1
    if (entry.incomplete) summary.incomplete += 1
    return summary
  }, {
    total: 0,
    succeeded: 0,
    failed: 0,
    warnings: 0,
    ignored: 0,
    incomplete: 0,
  })
}

function isIgnoredRequestAbort(state, error, frameGenerations) {
  if (!/(?:^|:)ERR_ABORTED$/i.test(error)) return false
  if (safely(() => state.request.isNavigationRequest(), false)) return true

  const currentGeneration = state.frame ? frameGenerations.get(state.frame) : undefined
  if (Number.isInteger(currentGeneration)
    && Number.isInteger(state.navigationGeneration)
    && currentGeneration > state.navigationGeneration) return true

  const frame = state.frame ?? safely(() => state.request.frame(), null)
  const currentPageUrl = frame ? safely(() => frame.page().url(), '') : ''
  return Boolean(
    currentPageUrl
    && state.location.pageUrl
    && currentPageUrl !== state.location.pageUrl,
  )
}

export function attachNetworkObserver(target, {
  onApiResponse,
  onResourceResponse,
  onNetworkEntry,
  shouldRecord = () => true,
  responseDrainTimeoutMs = DEFAULT_RESPONSE_DRAIN_TIMEOUT_MS,
  initialPhase = DEFAULT_NETWORK_PHASE,
  includeApi = true,
  includeResources = true,
} = {}) {
  if (!target || typeof target.on !== 'function' || typeof target.off !== 'function') {
    throw new TypeError('网络观察器必须挂载到 Playwright BrowserContext 或 Page')
  }

  const observerStartedAt = new Date()
  const states = new Map()
  const pendingWork = new Set()
  const idleWaiters = new Set()
  const deferredFailures = new Set()
  const diagnosticGroups = new Map()
  const recentDiagnosticKeys = new Map()
  const attachedPages = new Map()
  const attachedWebSockets = new Map()
  const frameGenerations = new WeakMap()
  const api = []
  const resources = []
  let phase = normalizePhase(initialPhase)
  let stopping = false
  let stopped = false
  let stopPromise

  const isIdle = () => states.size === 0
    && pendingWork.size === 0
    && deferredFailures.size === 0
    && diagnosticGroups.size === 0

  const notifyIdle = () => {
    if (!isIdle()) return
    for (const resolve of idleWaiters) resolve()
    idleWaiters.clear()
  }

  const track = (work) => {
    const task = Promise.resolve(work).catch(() => undefined)
    pendingWork.add(task)
    task.finally(() => {
      pendingWork.delete(task)
      notifyIdle()
    })
    return task
  }

  const invokeSubscriber = (subscriber, entry) => {
    if (typeof subscriber !== 'function') return
    try {
      const result = subscriber(entry)
      if (result && typeof result.then === 'function') track(result)
    } catch {
      // 采集订阅失败不能改变脚本本身的执行结果。
    }
  }

  const emit = (category, entry) => {
    if (category === 'api') {
      api.push(entry)
      invokeSubscriber(onApiResponse, entry)
    } else {
      resources.push(entry)
      invokeSubscriber(onResourceResponse, entry)
    }
    invokeSubscriber(onNetworkEntry, { category, ...entry })
  }

  const applyDiagnostics = (entry, diagnostics) => {
    if (!diagnostics?.length) return entry
    const unique = diagnostics.filter((diagnostic, index, values) => (
      values.findIndex((candidate) => (
        candidate.kind === diagnostic.kind
        && candidate.message === diagnostic.message
        && candidate.url === diagnostic.url
      )) === index
    ))
    const messages = unique
      .map((diagnostic) => diagnostic.message)
      .filter((message) => message && !entry.error?.includes(message))
    return {
      ...entry,
      ...(messages.length ? { error: [entry.error, ...messages].filter(Boolean).join('\n') } : {}),
      failureKind: entry.failureKind === 'http' ? 'http' : diagnosticFailureKind(unique),
      diagnostics: unique.map((diagnostic) => diagnostic.message),
    }
  }

  const retireState = (state) => {
    if (state.finalized) return false
    state.finalized = true
    states.delete(state.request)
    return true
  }

  const completeState = (state, entry) => {
    if (!retireState(state)) return
    emit(state.category, entry)
    notifyIdle()
  }

  const flushDeferredFailure = (candidate) => {
    if (!candidate || candidate.emitted) return
    candidate.emitted = true
    clearTimeout(candidate.timer)
    deferredFailures.delete(candidate)
    emit(candidate.category, applyDiagnostics(candidate.entry, candidate.diagnostics))
    notifyIdle()
  }

  const deferFailure = (state, entry) => {
    if (!retireState(state)) return
    const queuedDiagnostics = claimDiagnosticGroup(state.url.toString())
    const candidate = {
      category: state.category,
      url: state.url.toString(),
      entry,
      diagnostics: [...(state.diagnostics ?? []), ...queuedDiagnostics],
      emitted: false,
      timer: null,
    }
    deferredFailures.add(candidate)
    candidate.timer = setTimeout(
      () => flushDeferredFailure(candidate),
      DIAGNOSTIC_CORRELATION_WINDOW_MS,
    )
    notifyIdle()
  }

  const durationMs = (state) => Math.max(0, Math.round(performance.now() - state.startedAt))

  const commonEntry = (state, response) => ({
    timestamp: state.timestamp,
    name: state.url.pathname,
    method: state.method,
    url: state.url.toString(),
    status: response ? safely(() => response.status(), 0) : 0,
    ok: false,
    durationMs: durationMs(state),
    phase: state.phase,
    ...state.location,
    ...responseMetadata(response),
    ...redirectMetadata(state.request),
  })

  const correlationKey = (url, pageUrl = '', kind = '') => (
    normalizeDiagnosticUrl(url, pageUrl)
    || normalizeDiagnosticUrl(pageUrl)
    || `${kind}:unknown`
  )

  const claimDiagnosticGroup = (url) => {
    const key = correlationKey(url)
    const group = diagnosticGroups.get(key)
    if (!group) return []
    clearTimeout(group.timer)
    diagnosticGroups.delete(key)
    notifyIdle()
    return group.diagnostics
  }

  const syntheticDiagnosticEntry = (group) => {
    const primary = group.diagnostics[0]
    const category = group.diagnostics.some((diagnostic) => diagnostic.category === 'api')
      ? 'api'
      : 'resource'
    const url = primary.url || primary.pageUrl || 'about:blank'
    const name = safely(() => new URL(url).pathname, '') || `${primary.kind}.error`
    const entry = applyDiagnostics({
      timestamp: primary.timestamp,
      name,
      url,
      status: 0,
      ok: false,
      durationMs: 0,
      phase: primary.phase,
      ...(primary.pageUrl ? { pageUrl: primary.pageUrl } : {}),
      ...(primary.frameUrl ? { frameUrl: primary.frameUrl } : {}),
      method: category === 'api' ? 'UNKNOWN' : 'GET',
      ...(category === 'resource' ? { resourceType: primary.resourceType } : {}),
      failureKind: diagnosticFailureKind(group.diagnostics),
    }, group.diagnostics)
    return { category, entry }
  }

  const flushDiagnosticGroup = (group) => {
    if (!group || group.emitted) return
    group.emitted = true
    clearTimeout(group.timer)
    diagnosticGroups.delete(group.key)
    const synthetic = syntheticDiagnosticEntry(group)
    emit(synthetic.category, synthetic.entry)
    notifyIdle()
  }

  const queueUnmatchedDiagnostic = (diagnostic) => {
    const key = correlationKey(diagnostic.url, diagnostic.pageUrl, diagnostic.kind)
    const existing = diagnosticGroups.get(key)
    if (existing) {
      existing.diagnostics.push(diagnostic)
      return
    }
    const group = {
      key,
      diagnostics: [diagnostic],
      emitted: false,
      timer: null,
    }
    diagnosticGroups.set(key, group)
    group.timer = setTimeout(
      () => flushDiagnosticGroup(group),
      DIAGNOSTIC_CORRELATION_WINDOW_MS,
    )
  }

  const handleDiagnostic = (value = {}, source = {}) => {
    if (stopped || !includeResources) return
    try {
      const kind = ['console', 'csp', 'pageerror', 'resource'].includes(value.kind)
        ? value.kind
        : 'resource'
      if (kind === 'csp' && String(value.disposition || '').toLowerCase() === 'report') return
      const directive = String(value.directive || '').toLowerCase()
      const category = value.category === 'api' || (kind === 'csp' && directive === 'connect-src')
        ? 'api'
        : 'resource'
      const sourcePageUrl = value.pageUrl || pageAddress(source.page)
      const rawUrl = value.url || value.blockedUrl || ''
      const url = normalizeDiagnosticUrl(rawUrl, sourcePageUrl)
        || extractDiagnosticUrl(value.message, sourcePageUrl)
      const message = String(value.message || `${kind} 错误`).trim()
      const timestamp = value.timestamp || new Date().toISOString()
      const diagnostic = {
        timestamp,
        kind,
        category,
        message,
        url,
        phase,
        ...(sourcePageUrl ? { pageUrl: sourcePageUrl } : {}),
        ...(value.frameUrl ? { frameUrl: value.frameUrl } : {}),
        resourceType: value.resourceType
          || (kind === 'resource'
            ? resourceTypeForTag(value.tagName)
            : kind === 'csp'
              ? resourceTypeForDirective(directive)
              : kind),
      }
      const dedupeKey = `${kind}\u0000${url}\u0000${message}`
      const now = Date.now()
      if (now - (recentDiagnosticKeys.get(dedupeKey) ?? 0) < 1_000) return
      recentDiagnosticKeys.set(dedupeKey, now)
      if (recentDiagnosticKeys.size > 200) {
        for (const [key, seenAt] of recentDiagnosticKeys) {
          if (now - seenAt > 5_000) recentDiagnosticKeys.delete(key)
        }
      }

      const activeState = url
        ? [...states.values()].find((state) => state.url.toString() === url)
        : null
      if (activeState) {
        activeState.diagnostics.push(diagnostic)
        return
      }
      const deferred = url
        ? [...deferredFailures].find((candidate) => candidate.url === url && !candidate.emitted)
        : null
      if (deferred) {
        deferred.diagnostics.push(diagnostic)
        return
      }
      queueUnmatchedDiagnostic(diagnostic)
    } catch {
      // 诊断关联不能干扰测试页面。
    }
  }

  const onConsole = (message, sourcePage = null) => {
    try {
      if (safely(() => message.type(), '') !== 'error') return
      const text = safely(() => message.text(), '') || 'console.error'
      const location = safely(() => message.location(), {}) ?? {}
      const page = safely(() => message.page(), null) || sourcePage
      const currentPageUrl = pageAddress(page)
      const evidence = classifyNetworkConsoleError(text, location, currentPageUrl)
      if (!evidence) return
      handleDiagnostic({
        kind: evidence.kind,
        category: evidence.category,
        message: text,
        url: evidence.url,
        ...(evidence.resourceType ? { resourceType: evidence.resourceType } : {}),
        ...(evidence.directive ? { directive: evidence.directive } : {}),
        pageUrl: currentPageUrl,
      }, { page })
    } catch {
      // ConsoleMessage 的异常数据只忽略当前记录。
    }
  }

  const onPageError = (error, page) => {
    try {
      const message = error instanceof Error
        ? [error.message, error.stack].filter(Boolean).join('\n')
        : String(error || '页面脚本错误')
      const currentPageUrl = pageAddress(page)
      const resourceUrl = pageErrorResourceUrl(error, message, currentPageUrl)
      if (!resourceUrl) return
      handleDiagnostic({
        kind: 'pageerror',
        message,
        url: resourceUrl,
        pageUrl: currentPageUrl,
      }, { page })
    } catch {
      // 页面异常采集不向外抛错。
    }
  }

  const onWebSocket = (socket, page) => {
    try {
      const rawUrl = safely(() => socket.url(), '')
      const url = new URL(rawUrl)
      let accepted = false
      try {
        accepted = shouldRecord({
          request: null,
          url,
          category: 'resource',
          resourceType: 'websocket',
        }) !== false
      } catch {
        return
      }
      if (!accepted) return
      const startedAt = performance.now()
      const socketPhase = phase
      const socketError = (error) => {
        try {
          const message = error instanceof Error ? error.message : String(error || 'WebSocket 连接失败')
          emit('resource', {
            timestamp: new Date().toISOString(),
            name: url.pathname,
            method: 'GET',
            url: url.toString(),
            status: 0,
            ok: false,
            durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
            phase: socketPhase,
            ...(pageAddress(page) ? { pageUrl: pageAddress(page) } : {}),
            resourceType: 'websocket',
            streaming: true,
            error: message,
            failureKind: 'websocket',
          })
        } catch {
          // WebSocket 错误采集不向外抛错。
        }
      }
      socket.on('socketerror', socketError)
      attachedWebSockets.set(socket, socketError)
    } catch {
      // 非标准 WebSocket 事件不影响其他请求。
    }
  }

  const attachPageDiagnostics = (page, { captureConsole = false } = {}) => {
    if (!page || attachedPages.has(page) || !includeResources) return
    try {
      const pageError = (error) => onPageError(error, page)
      const webSocket = (socket) => onWebSocket(socket, page)
      const consoleError = captureConsole ? (message) => onConsole(message, page) : null
      page.on('pageerror', pageError)
      page.on('websocket', webSocket)
      if (consoleError) page.on('console', consoleError)
      attachedPages.set(page, { pageError, webSocket, consoleError })
    } catch {
      // 页面在创建后立即关闭时可能无法安装诊断监听。
    }
  }

  const detachPageDiagnostics = () => {
    for (const [page, handlers] of attachedPages) {
      safely(() => page.off('pageerror', handlers.pageError), undefined)
      safely(() => page.off('websocket', handlers.webSocket), undefined)
      if (handlers.consoleError) safely(() => page.off('console', handlers.consoleError), undefined)
    }
    attachedPages.clear()
    for (const [socket, socketError] of attachedWebSockets) {
      safely(() => socket.off('socketerror', socketError), undefined)
    }
    attachedWebSockets.clear()
  }

  const bodyForResponse = (state, response) => {
    if (state.category !== 'api' || state.resourceType === 'eventsource') {
      return Promise.resolve({ body: undefined })
    }
    if (!state.bodyPromise) {
      state.bodyPromise = Promise.resolve()
        .then(() => response.text())
        .then((value) => ({
          body: parseBodyText(value, safely(() => response.headers()['content-type'], '') ?? ''),
        }))
        .catch((error) => ({ body: null, error: error instanceof Error ? error.message : String(error) }))
    }
    return state.bodyPromise
  }

  const finalizeResponse = (state, response) => {
    if (state.finalized || state.finalizing) return
    state.finalizing = true
    track((async () => {
      const responseBody = await bodyForResponse(state, response)
      if (state.finalized) return
      const status = safely(() => response.status(), 0)
      const statusText = safely(() => response.statusText(), '')
      const diagnosticFailure = state.diagnostics.length > 0
      const bodyReadWarning = state.category === 'api'
        && state.resourceType !== 'eventsource'
        && status >= 200
        && status < 300
        && !diagnosticFailure
        && Boolean(responseBody.error)
      // Chrome can release a successful response body as soon as the page navigates.
      // Keep that capture limitation as diagnostics; it does not mean the request failed.
      const failed = status >= 400 || status === 0 || diagnosticFailure
      let entry = {
        ...commonEntry(state, response),
        status,
        ok: !failed,
        ...(state.category === 'api' ? {
          method: state.method,
          ...(state.requestBody === undefined ? {} : { requestBody: state.requestBody }),
          ...(state.resourceType === 'eventsource'
            ? { streaming: true }
            : { responseBody: responseBody.body }),
          ...(responseBody.error ? { bodyReadError: responseBody.error } : {}),
        } : {
          resourceType: state.resourceType,
        }),
        ...(bodyReadWarning ? { incomplete: true, warning: true } : {}),
        ...(status >= 400 || status === 0 ? {
          error: `HTTP ${status}${statusText ? ` ${statusText}` : ''}`,
          failureKind: 'http',
        } : diagnosticFailure ? {
          failureKind: diagnosticFailureKind(state.diagnostics),
        } : {}),
      }
      entry = applyDiagnostics(entry, state.diagnostics)
      if (failed) deferFailure(state, entry)
      else completeState(state, entry)
    })())
  }

  const onRequest = (request) => {
    if (stopping) return
    try {
      const url = parseHttpUrl(request)
      if (!url) return
      const resourceType = safely(() => request.resourceType(), 'other')
      const method = safely(() => request.method(), 'GET')
      const frame = safely(() => request.frame(), null)
      if (frame && safely(() => request.isNavigationRequest(), false)) {
        frameGenerations.set(frame, (frameGenerations.get(frame) ?? 0) + 1)
      }
      const navigationGeneration = frame ? (frameGenerations.get(frame) ?? 0) : undefined
      const category = API_RESOURCE_TYPES.has(resourceType) || method === 'OPTIONS' ? 'api' : 'resource'
      if ((category === 'api' && !includeApi) || (category === 'resource' && !includeResources)) return
      let accepted = false
      try {
        accepted = shouldRecord({ request, url, category, resourceType }) !== false
      } catch {
        return
      }
      if (!accepted) return

      states.set(request, {
        request,
        url,
        category,
        resourceType,
        method,
        frame,
        navigationGeneration,
        requestBody: category === 'api' ? requestBody(request) : undefined,
        phase,
        location: requestLocation(request, resourceType, url),
        timestamp: new Date().toISOString(),
        startedAt: performance.now(),
        response: null,
        bodyPromise: null,
        finished: false,
        finalizing: false,
        finalized: false,
        diagnostics: [],
      })
    } catch {
      // Playwright 事件处理器不向测试流程抛出采集错误。
    }
  }

  const onResponse = (response) => {
    try {
      const request = response.request()
      const state = states.get(request)
      if (!state || state.finalized) return
      state.response = response
      if (state.category === 'api') bodyForResponse(state, response)
      if (state.resourceType === 'eventsource') {
        state.finished = true
        finalizeResponse(state, response)
        return
      }
      if (state.finished) finalizeResponse(state, response)
    } catch {
      // 响应元数据异常仅影响记录，不中断测试。
    }
  }

  const onRequestFinished = (request) => {
    try {
      const state = states.get(request)
      if (!state || state.finalized) return
      state.finished = true
      if (state.response) {
        finalizeResponse(state, state.response)
        return
      }
      state.finalizing = true
      track((async () => {
        const response = await Promise.resolve(safely(() => request.response(), null)).catch(() => null)
        state.finalizing = false
        if (state.finalized) return
        if (response) {
          state.response = response
          finalizeResponse(state, response)
          return
        }
        deferFailure(state, {
          ...commonEntry(state, null),
          ...(state.category === 'api' ? {
            method: state.method,
            ...(state.requestBody === undefined ? {} : { requestBody: state.requestBody }),
          } : { resourceType: state.resourceType }),
          error: '请求已结束，但 Playwright 未提供响应信息',
          failureKind: 'network',
        })
      })())
    } catch {
      // 终态处理失败由封账阶段兜底。
    }
  }

  const onRequestFailed = (request) => {
    try {
      const state = states.get(request)
      if (!state || state.finalized) return
      const error = safely(() => request.failure()?.errorText, '') || '请求失败且未收到响应'
      const ignored = isIgnoredRequestAbort(state, error, frameGenerations)
      const entry = applyDiagnostics({
        ...commonEntry(state, state.response),
        ok: ignored,
        ...(state.category === 'api' ? {
          method: state.method,
          ...(state.requestBody === undefined ? {} : { requestBody: state.requestBody }),
        } : {
          resourceType: state.resourceType,
        }),
        error,
        failureKind: /ERR_ABORTED/i.test(error) ? 'aborted' : 'network',
        ...(ignored ? { ignored: true } : {}),
      }, state.diagnostics)
      if (ignored) completeState(state, entry)
      else deferFailure(state, entry)
    } catch {
      // 失败记录本身不能变成新的测试失败。
    }
  }

  target.on('request', onRequest)
  target.on('response', onResponse)
  target.on('requestfinished', onRequestFinished)
  target.on('requestfailed', onRequestFailed)

  const isContextTarget = typeof target.pages === 'function'
  const onPageCreated = (page) => {
    try {
      attachPageDiagnostics(page)
    } catch {
      // BrowserContext page 事件不向外抛出诊断错误。
    }
  }
  if (includeResources) {
    if (isContextTarget) {
      target.on('console', onConsole)
      target.on('page', onPageCreated)
      for (const page of safely(() => target.pages(), [])) attachPageDiagnostics(page)
    } else {
      attachPageDiagnostics(target, { captureConsole: true })
    }
  }

  const bindingName = `__autoTestNetworkDiagnostic${++observerSequence}`
  const ready = track((async () => {
    if (!includeResources
      || typeof target.exposeBinding !== 'function'
      || typeof target.addInitScript !== 'function') return
    try {
      await target.exposeBinding(bindingName, (source, payload) => {
        const frameUrl = safely(() => source.frame?.url(), '')
        handleDiagnostic({
          ...(payload && typeof payload === 'object' ? payload : {}),
          ...(frameUrl ? { frameUrl } : {}),
        }, { page: source.page })
      })
      await target.addInitScript(({ diagnosticBindingName }) => {
        const marker = `__autoTestNetworkDiagnosticsInstalled_${diagnosticBindingName}`
        if (globalThis[marker]) return
        globalThis[marker] = true
        const report = (payload) => {
          try {
            const binding = globalThis[diagnosticBindingName]
            if (typeof binding !== 'function') return
            Promise.resolve(binding(payload)).catch(() => undefined)
          } catch {
            // 页面内的诊断链路不影响应用脚本。
          }
        }
        globalThis.addEventListener('error', (event) => {
          try {
            const element = event.target
            if (!element || element === globalThis) return
            const url = element.currentSrc || element.src || element.href
            if (!url) return
            const tagName = element.tagName || 'RESOURCE'
            report({
              kind: 'resource',
              url: String(url),
              tagName: String(tagName),
              pageUrl: globalThis.location?.href || '',
              message: `资源加载失败: ${tagName} ${url}`,
            })
          } catch {
            // 个别 DOM 节点无法读取时忽略该条证据。
          }
        }, true)
        globalThis.addEventListener('securitypolicyviolation', (event) => {
          try {
            if (event.disposition === 'report') return
            const directive = event.effectiveDirective || event.violatedDirective || '未知指令'
            const blockedUrl = event.blockedURI || ''
            const source = event.sourceFile
              ? `${event.sourceFile}:${event.lineNumber || 0}:${event.columnNumber || 0}`
              : ''
            report({
              kind: 'csp',
              disposition: event.disposition || 'enforce',
              directive,
              blockedUrl,
              pageUrl: globalThis.location?.href || '',
              resourceType: 'csp',
              message: `CSP ${directive} 拦截 ${blockedUrl || '未知资源'}${source ? `，来源 ${source}` : ''}`,
            })
          } catch {
            // CSP 诊断仅做附加证据。
          }
        })
      }, { diagnosticBindingName: bindingName })
    } catch {
      // 旧版浏览器不支持绑定时，仍保留 Playwright 原生事件采集。
    }
  })())

  const setPhase = (nextPhase) => {
    phase = normalizePhase(nextPhase)
    return phase
  }

  const waitUntilIdle = (timeoutMs) => {
    if (isIdle()) return Promise.resolve(true)
    return new Promise((resolve) => {
      let settled = false
      let timer
      const finish = (idle) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        idleWaiters.delete(onIdle)
        resolve(idle)
      }
      const onIdle = () => finish(true)
      timer = setTimeout(() => finish(false), timeoutMs)
      idleWaiters.add(onIdle)
    })
  }

  const stop = async ({ discardPending = false } = {}) => {
    if (stopPromise) return stopPromise
    stopPromise = (async () => {
      stopping = true
      const timeoutMs = Math.max(0, Number(responseDrainTimeoutMs) || 0)
      await waitUntilIdle(timeoutMs)

      target.off('request', onRequest)
      target.off('response', onResponse)
      target.off('requestfinished', onRequestFinished)
      target.off('requestfailed', onRequestFailed)
      if (includeResources && isContextTarget) {
        target.off('console', onConsole)
        target.off('page', onPageCreated)
      }
      detachPageDiagnostics()

      const pendingAtSeal = states.size
      const discardedPending = discardPending ? pendingAtSeal : 0
      for (const candidate of [...deferredFailures]) flushDeferredFailure(candidate)
      for (const group of [...diagnosticGroups.values()]) flushDiagnosticGroup(group)
      for (const state of [...states.values()]) {
        if (state.finalized) continue
        if (discardPending) {
          retireState(state)
          continue
        }
        const response = state.response
        completeState(state, applyDiagnostics({
          ...commonEntry(state, response),
          ok: false,
          ...(state.category === 'api' ? {
            method: state.method,
            ...(state.requestBody === undefined ? {} : { requestBody: state.requestBody }),
          } : {
            resourceType: state.resourceType,
          }),
          error: `网络观察器封账时请求仍未完成（已等待 ${timeoutMs}ms）`,
          failureKind: 'timeout',
          incomplete: true,
        }, state.diagnostics))
      }
      stopped = true
      const sealedAt = new Date()
      return {
        api: [...api],
        resources: [...resources],
        summary: {
          startedAt: observerStartedAt.toISOString(),
          sealedAt: sealedAt.toISOString(),
          durationMs: Math.max(0, sealedAt.getTime() - observerStartedAt.getTime()),
          pendingAtSeal,
          discardedPending,
          api: summarizeEntries(api),
          resources: summarizeEntries(resources),
        },
      }
    })()
    return stopPromise
  }

  return {
    ready,
    setPhase,
    stop,
    get phase() {
      return phase
    },
    get stopped() {
      return stopped
    },
  }
}

export function attachApiResponseRecorder(page, {
  onApiResponse,
  shouldRecord = () => true,
  responseDrainTimeoutMs = DEFAULT_RESPONSE_DRAIN_TIMEOUT_MS,
  initialPhase = DEFAULT_NETWORK_PHASE,
} = {}) {
  if (typeof onApiResponse !== 'function') {
    const noop = async () => undefined
    noop.stop = noop
    noop.setPhase = () => DEFAULT_NETWORK_PHASE
    noop.ready = Promise.resolve()
    return noop
  }

  const observer = attachNetworkObserver(page, {
    onApiResponse,
    shouldRecord,
    responseDrainTimeoutMs,
    initialPhase,
    includeResources: false,
  })
  const stop = async () => {
    await observer.stop()
  }
  stop.stop = observer.stop
  stop.setPhase = observer.setPhase
  stop.ready = observer.ready
  return stop
}

export {
  API_RESOURCE_TYPES,
  DEFAULT_NETWORK_PHASE,
  DEFAULT_RESPONSE_DRAIN_TIMEOUT_MS,
  DIAGNOSTIC_CORRELATION_WINDOW_MS,
  MAX_BODY_CHARACTERS,
}
