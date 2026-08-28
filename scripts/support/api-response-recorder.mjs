const MAX_BODY_CHARACTERS = 100_000
const DEFAULT_RESPONSE_DRAIN_TIMEOUT_MS = 2_000
const API_RESOURCE_TYPES = new Set(['fetch', 'xhr'])

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

function requestBody(request) {
  if (['GET', 'HEAD'].includes(request.method())) return undefined
  const value = request.postData()
  if (value === null) return undefined
  const contentType = request.headers()['content-type'] ?? ''
  if (/multipart\/form-data/i.test(contentType)) {
    return `[multipart/form-data，${value.length} 字符，二进制内容未展开]`
  }
  return parseBodyText(value, contentType)
}

export function attachApiResponseRecorder(page, {
  onApiResponse,
  shouldRecord = () => true,
  responseDrainTimeoutMs = DEFAULT_RESPONSE_DRAIN_TIMEOUT_MS,
} = {}) {
  if (typeof onApiResponse !== 'function') return async () => undefined

  const startedAt = new WeakMap()
  const pending = new Set()
  let stopped = false

  const isRecordable = (request) => {
    if (!API_RESOURCE_TYPES.has(request.resourceType())) return false
    try {
      return shouldRecord({ request, url: new URL(request.url()) }) !== false
    } catch {
      return false
    }
  }

  const onRequest = (request) => {
    if (isRecordable(request)) startedAt.set(request, performance.now())
  }

  const emit = (entry) => {
    try {
      onApiResponse(entry)
    } catch {
      // 采集订阅失败不能改变脚本本身的执行结果。
    }
  }

  const onResponse = (response) => {
    const request = response.request()
    if (!isRecordable(request)) return
    const task = (async () => {
      const url = new URL(request.url())
      const responseText = await response.text().catch(() => '')
      emit({
        timestamp: new Date().toISOString(),
        name: url.pathname,
        method: request.method(),
        url: url.toString(),
        status: response.status(),
        ok: response.ok(),
        durationMs: Math.max(0, Math.round(performance.now() - (startedAt.get(request) ?? performance.now()))),
        ...(requestBody(request) === undefined ? {} : { requestBody: requestBody(request) }),
        responseBody: parseBodyText(responseText, response.headers()['content-type'] ?? ''),
      })
    })()
    pending.add(task)
    task.finally(() => pending.delete(task))
  }

  const onRequestFailed = (request) => {
    if (!isRecordable(request)) return
    const url = new URL(request.url())
    emit({
      timestamp: new Date().toISOString(),
      name: url.pathname,
      method: request.method(),
      url: url.toString(),
      status: 0,
      ok: false,
      durationMs: Math.max(0, Math.round(performance.now() - (startedAt.get(request) ?? performance.now()))),
      ...(requestBody(request) === undefined ? {} : { requestBody: requestBody(request) }),
      error: request.failure()?.errorText || '请求失败且未收到接口响应',
    })
  }

  page.on('request', onRequest)
  page.on('response', onResponse)
  page.on('requestfailed', onRequestFailed)

  return async () => {
    if (stopped) return
    stopped = true
    page.off('request', onRequest)
    page.off('response', onResponse)
    page.off('requestfailed', onRequestFailed)
    if (pending.size === 0) return

    let timer
    await Promise.race([
      Promise.allSettled([...pending]),
      new Promise((resolve) => {
        timer = setTimeout(resolve, Math.max(0, responseDrainTimeoutMs))
      }),
    ])
    clearTimeout(timer)
  }
}

export { DEFAULT_RESPONSE_DRAIN_TIMEOUT_MS, MAX_BODY_CHARACTERS }
