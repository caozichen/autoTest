import { attachNetworkObserver } from './api-response-recorder.mjs'
import { expect } from './recorded-expect.mjs'
import { expect as requireExpect, scaleTimeout } from './environment-timeouts.mjs'

const REQUIRED_RESOURCES = new Set(['document', 'script', 'stylesheet', 'font', 'image'])

export function isRequiredPageRequest({ url, category, resourceType, responseHeaders = {}, superseded = false }, origins) {
  // Reads from an already replaced document cannot affect the current preview.
  if (superseded) return false
  if (resourceType === 'eventsource' || resourceType === 'websocket'
    || /text\/event-stream/i.test(responseHeaders['content-type'] ?? '')) return false
  if (category === 'api') {
    // AI status polling is checked by its own bounded task-completion assertions.
    return origins.has(url.origin) && !/\/translation\/ai\/status\/?$/.test(url.pathname)
      && !/\/(?:telemetry|analytics)(?:\/|$)/.test(url.pathname)
  }
  return REQUIRED_RESOURCES.has(resourceType)
}

export async function waitForPageResponsesBeforeNavigation(page, networkObserver, {
  origins, signal, timeoutMs = scaleTimeout(45_000), logger = () => undefined,
  environmentCode, quietMs = /hk/i.test(environmentCode ?? '') ? 500 : 0,
} = {}) {
  const waitForPendingAi = /hk/i.test(environmentCode ?? '')
  const allowedOrigins = new Set(origins)
  const completed = await networkObserver.waitForIdle({
    timeoutMs,
    signal,
    quietMs,
    shouldWaitFor: candidate => {
      let owner
      try { owner = candidate.request.frame().page() } catch { return false }
      if (owner !== page || candidate.superseded) return false
      if (candidate.resourceType === 'eventsource' || candidate.resourceType === 'websocket'
        || /text\/event-stream/i.test(candidate.responseHeaders?.['content-type'] ?? '')) return false
      if (isRequiredPageRequest(candidate, allowedOrigins)) return true
      // Static fetches need their terminal event, not an API response body.
      if (candidate.category === 'resource' && ['fetch', 'xhr'].includes(candidate.resourceType)) return true
      // Slow Hong Kong polls can receive headers only after the navigation
      // check. Drain existing polls and their follow-up reads before leaving.
      // Other environments retain the existing headers-only prerequisite.
      return candidate.category === 'api' && (waitForPendingAi || Boolean(candidate.response))
        && allowedOrigins.has(candidate.url.origin)
        && /\/translation\/ai\/status\/?$/.test(candidate.url.pathname)
    },
  })
  if (!completed) {
    // Capture must not retry a business operation or change its result. Keep
    // unfinished responses in the observer so normal diagnostics retain them.
    logger('warning', '页面跳转前响应采集等待超时，继续原流程并保留未完成响应诊断', { timeoutMs })
  }
  return completed
}

export function assertCompletedPageEvidence(evidence, label) {
  const failures = [...evidence.api, ...evidence.resources].filter(entry => {
    if (!entry.ok || entry.warning || entry.incomplete || entry.bodyReadError || entry.ignored) return true
    if (!Object.hasOwn(entry, 'responseBody') || entry.status === 204 || (entry.status >= 300 && entry.status < 400)) return false
    const body = entry.responseBody
    return !body || typeof body !== 'object'
      || (Object.hasOwn(body, 'code') && (body.code === null || body.code === '' || Number(body.code) !== 0))
      || (Object.hasOwn(body, 'success') && body.success !== true)
  }).map(entry => ({ url: entry.url, status: entry.status, error: entry.error ?? entry.bodyReadError,
    businessCode: entry.responseBody?.code }))
  expect(failures, `${label}：必要接口正文、业务状态及资源必须完整成功`).toEqual([])
  requireExpect(failures, `${label}存在未完成或失败的必要响应，不能按成功关闭页面`).toEqual([])
}

// Attach when the context is created, before new pages (including popups) can
// start requests. Each page is sealed once, immediately before its final close.
export function createPageCompletionTracker(context, { origins, networkObserver, signal,
  timeoutMs = scaleTimeout(45_000), trackDocumentCommits = false }) {
  const allowedOrigins = new Set(origins)
  const pages = new Map()
  const track = page => {
    if (pages.has(page)) return
    const observer = attachNetworkObserver(page, {
      initialPhase: '关闭前必要响应完整性检查', responseDrainTimeoutMs: timeoutMs,
      fullResponseBodies: true,
      trackDocumentCommits,
      shouldRecord: candidate => isRequiredPageRequest(candidate, allowedOrigins),
    })
    pages.set(page, observer)
  }
  context.on('page', track)
  context.pages().forEach(track)
  const waitForPage = async (page, label = '页面关闭前') => {
    const observer = pages.get(page)
    if (!observer) throw new Error(`${label}缺少从页面创建时开始的响应记录`)
    await observer.ready
    await page.waitForLoadState('load', { timeout: timeoutMs })
    const required = candidate => isRequiredPageRequest(candidate, allowedOrigins)
    requireExpect(await observer.waitForIdle({ timeoutMs, signal, shouldWaitFor: required }), `${label}必要响应正文必须在时限内完成`).toBe(true)
    // Also drain the reporting observer, which can still be parsing the same body.
    if (networkObserver) {
      requireExpect(await networkObserver.waitForIdle({ timeoutMs, signal, shouldWaitFor: candidate => {
        let owner
        try { owner = candidate.request?.frame()?.page() } catch { return false }
        return owner === page && isRequiredPageRequest(candidate, allowedOrigins)
      } }), `${label}网络报告必须完成本页必要响应正文采集`).toBe(true)
    }
    const evidence = await observer.stop({ signal, shouldWaitFor: required })
    assertCompletedPageEvidence(evidence, label)
    pages.delete(page)
    return { apiCount: evidence.api.length, resourceCount: evidence.resources.length }
  }
  return {
    waitForPage,
    waitForOpenPages: async () => {
      for (const page of [...pages.keys()]) {
        if (page.isClosed()) throw new Error('页面未通过必要响应检查便已关闭')
        await waitForPage(page)
      }
    },
    dispose: async () => {
      context.off('page', track)
      const cleanupSignal = signal?.aborted ? signal : AbortSignal.abort(new Error('页面检查结束，立即清理剩余采集器'))
      await Promise.allSettled([...pages.values()].map(observer => observer.stop({ discardPending: true, signal: cleanupSignal })))
      pages.clear()
    },
  }
}
