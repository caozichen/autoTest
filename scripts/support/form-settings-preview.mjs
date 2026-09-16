import { attachNetworkObserver } from './api-response-recorder.mjs'
import { expect as flowExpect, scaleTimeout } from './environment-timeouts.mjs'
import { expect } from './recorded-expect.mjs'
import { clickWhenReady, waitForUiReady } from './ui-readiness.mjs'

const RESOURCE_TYPES = new Set(['document', 'script', 'stylesheet', 'font', 'image'])
const BUSY = '.arco-spin-mask:visible, .arco-spin-loading:visible, [aria-busy="true"]:visible, [data-loading="true"]:visible'
const isStream = headers => /text\/event-stream/i.test(headers?.['content-type'] ?? '')
const isBackgroundPoll = url => /\/translation\/ai\/status\/?$/.test(url.pathname)

function previewRequest({ url, category, resourceType }, origin) {
  if (category === 'api') {
    return resourceType !== 'eventsource' && url.origin === origin && !isBackgroundPoll(url)
  }
  return RESOURCE_TYPES.has(resourceType)
}

async function requireGate(name, action) {
  try {
    await action()
  } catch (error) {
    expect(false, name).toBe(true)
    throw error
  }
  expect(true, name).toBe(true)
}

function inspectEntry(entry) {
  const url = new URL(entry.url)
  const body = entry.responseBody
  const codePresent = body && typeof body === 'object' && Object.hasOwn(body, 'code')
  const successPresent = body && typeof body === 'object' && Object.hasOwn(body, 'success')
  const businessOk = (!codePresent || (body.code !== null && body.code !== '' && Number(body.code) === 0))
    && (!successPresent || body.success === true)
  return {
    method: entry.method,
    path: url.pathname,
    resourceType: entry.resourceType ?? 'api',
    status: entry.status,
    ok: Boolean(entry.ok) && !entry.ignored && !entry.warning && !entry.incomplete && !entry.bodyReadError && businessOk,
    ...(codePresent ? { businessCode: body.code } : {}),
    ...(successPresent ? { businessSuccess: body.success } : {}),
    ...(entry.failureKind ? { failureKind: entry.failureKind } : {}),
    ...(entry.warning || entry.incomplete || entry.bodyReadError ? { incomplete: true } : {}),
  }
}

export async function inspectSettingsPreview({
  page,
  artifactWriter,
  logger = () => undefined,
  signal,
  timeoutMs = scaleTimeout(45_000),
}) {
  if (!artifactWriter?.captureScreenshot || !artifactWriter?.writeFile) {
    throw new Error('预览检查必须提供截图及 JSON 制品写入器')
  }
  const origin = new URL(page.url()).origin
  const initialFontErrors = await page.evaluate(() => [...(document.fonts ?? [])]
    .filter(font => font.status === 'error')
    .map(font => `${font.family}|${font.style}|${font.weight}`))
  const drawer = page.locator('.settings-preview-drawer:visible')
  // Vue forwards the host class to its root div; match the custom element itself.
  const renderer = drawer.locator('form-renderer.settings-preview-renderer')
  const streams = new Set()
  const activeStreams = new Set()
  const trackedRequests = new Set()
  const pendingRequests = new Set()
  const pendingBodyChecks = new Set()
  const apiBodyFailures = []
  const observedApi = []
  const observedResources = []
  let lastActivity = Date.now()
  let started = false
  let evidence
  let savedEvidence = false
  const touch = () => { lastActivity = Date.now() }
  const shouldRecord = candidate => started && previewRequest(candidate, origin)
  const onRequest = request => {
    if (!started) return
    const resourceType = request.resourceType()
    const category = ['xhr', 'fetch', 'eventsource'].includes(resourceType) ? 'api' : 'resource'
    if (previewRequest({ url: new URL(request.url()), resourceType, category }, origin)) {
      trackedRequests.add(request)
      pendingRequests.add(request)
      touch()
    }
  }
  const onResponse = response => {
    const request = response.request()
    if (!trackedRequests.has(request)) return
    if (isStream(response.headers())) {
      streams.add(request)
      activeStreams.add(request)
      return
    }
    const url = new URL(response.url())
    const needsJson = /json/i.test(response.headers()['content-type'] ?? '')
      || /\/(?:api\/)?(?:be|base|f)\//.test(url.pathname)
    if (!needsJson || !['fetch', 'xhr'].includes(request.resourceType())
      || ['HEAD', 'OPTIONS'].includes(request.method()) || response.status() === 204) return
    // The shared recorder intentionally truncates large bodies. Validate the
    // complete JSON separately so truncation cannot hide a business error.
    const checking = response.json().then(body => {
      const codeOk = !body || typeof body !== 'object' || !Object.hasOwn(body, 'code')
        || (body.code !== null && body.code !== '' && Number(body.code) === 0)
      const successOk = !body || typeof body !== 'object' || !Object.hasOwn(body, 'success')
        || body.success === true
      if (!body || typeof body !== 'object' || !codeOk || !successOk) {
        apiBodyFailures.push({ method: request.method(), path: url.pathname, reason: 'JSON 响应结构或业务状态无效' })
      }
    }).catch(() => {
      apiBodyFailures.push({ method: request.method(), path: url.pathname, reason: '接口响应正文不是完整有效 JSON' })
    }).finally(() => {
      pendingBodyChecks.delete(checking)
      touch()
    })
    pendingBodyChecks.add(checking)
  }
  const onFinished = request => {
    if (!trackedRequests.has(request)) return
    pendingRequests.delete(request)
    activeStreams.delete(request)
    touch()
  }
  const observer = attachNetworkObserver(page, {
    initialPhase: '发布前设置页预览',
    shouldRecord,
    onNetworkEntry: touch,
    onApiResponse: entry => observedApi.push(entry),
    onResourceResponse: entry => observedResources.push(entry),
    // All relevant work is drained below; only explicitly excluded streams may
    // remain when sealing. Do not introduce another long wait during cleanup.
    responseDrainTimeoutMs: 0,
  })
  page.on('request', onRequest)
  page.on('response', onResponse)
  page.on('requestfinished', onFinished)
  page.on('requestfailed', onFinished)
  const drain = async ({ mounted = true } = {}) => {
    const deadline = Date.now() + timeoutMs
    await requireGate('发布前预览接口正文及页面资源应全部完成加载', async () => {
      await flowExpect.poll(async () => {
        signal?.throwIfAborted()
        const idle = await observer.waitForIdle({
          timeoutMs: Math.max(1, deadline - Date.now()),
          signal,
          shouldWaitFor: ({ request, responseHeaders }) => !streams.has(request) && !isStream(responseHeaders),
        })
        const display = await page.evaluate(({ mounted, initialFontErrors }) => {
          const root = mounted ? document.querySelector('.settings-preview-drawer') : null
          return {
            incompleteImages: [...(root?.querySelectorAll('img') ?? [])].filter(image => (
              Boolean(image.currentSrc || image.getAttribute('src'))
              && (!image.complete || image.naturalWidth === 0)
            )).length,
            fontsLoading: document.fonts?.status === 'loading',
            failedFonts: [...(document.fonts ?? [])].filter(font => (
              font.status === 'error' && !initialFontErrors.includes(`${font.family}|${font.style}|${font.weight}`)
            )).length,
          }
        }, { mounted, initialFontErrors })
        const busy = mounted ? await drawer.locator(BUSY).count() : 0
        return { idle, ...display, busy, pendingBodyChecks: pendingBodyChecks.size, settled: Date.now() - lastActivity >= 250 }
      }, {
        timeout: timeoutMs,
        intervals: [50, 100, 150],
        message: '预览关闭前等待完整响应正文、图片解码、字体和动态渲染稳定',
      }).toEqual({ idle: true, incompleteImages: 0, fontsLoading: false, failedFonts: 0, busy: 0, pendingBodyChecks: 0, settled: true })
    })
  }
  const summarizeEvidence = source => {
    const api = source.api.filter(entry => (
      new URL(entry.url).origin === origin && !isBackgroundPoll(new URL(entry.url))
      && !entry.streaming && !/text\/event-stream/i.test(entry.mimeType ?? '')
    )).map(inspectEntry)
    const resources = source.resources.filter(entry => (
      RESOURCE_TYPES.has(entry.resourceType)
      || ['console', 'csp', 'pageerror', 'resource'].includes(entry.resourceType)
    )).map(inspectEntry)
    return {
      apiCount: api.length,
      resourceCount: resources.length,
      failedApiCount: api.filter(entry => !entry.ok).length,
      failedResourceCount: resources.filter(entry => !entry.ok).length,
      excludedStreamCount: streams.size,
      pendingAtSeal: source.summary.pendingAtSeal,
      failedApiBodyCount: apiBodyFailures.length,
      apiBodyFailures: [...apiBodyFailures],
      api,
      resources,
    }
  }
  const saveEvidence = async () => {
    const result = summarizeEvidence(evidence)
    await artifactWriter.writeFile('form-settings-preview-network.json', JSON.stringify(result, null, 2), {
      encoding: 'utf8', type: 'attachment', mimeType: 'application/json',
    })
    savedEvidence = true
    return result
  }
  const requireNetworkHealth = network => requireGate('发布前预览全部接口及资源应通过 HTTP、业务码和完整性检查', async () => {
    flowExpect(network.failedApiCount).toBe(0)
    flowExpect(network.failedResourceCount).toBe(0)
    flowExpect(network.failedApiBodyCount).toBe(0)
    flowExpect(network.apiCount).toBeGreaterThan(0)
    flowExpect(network.pendingAtSeal).toBe(activeStreams.size)
  })
  try {
    await observer.ready
    await waitForUiReady(page, { timeout: timeoutMs })
    started = true
    touch()
    await clickWhenReady(page.getByRole('button', { name: /^(预览|預覽|Preview)$/i }), { timeout: timeoutMs })
    await requireGate('发布前预览抽屉和表单渲染器应挂载并显示', async () => {
      await flowExpect(drawer).toHaveCount(1, { timeout: timeoutMs })
      await flowExpect(renderer).toHaveCount(1, { timeout: timeoutMs })
      // The custom-element host alone can exist before its renderer is ready.
      await flowExpect(renderer.locator('.runtime-renderer')).toBeVisible({ timeout: timeoutMs })
    })
    await drain()
    const screenshot = await artifactWriter.captureScreenshot(page, 'form-settings-preview.png', {
      clip: await drawer.boundingBox(),
    })
    // Screenshotting may trigger lazy resources. Keep observing until they finish.
    await drain()
    await requireNetworkHealth(summarizeEvidence({
      api: observedApi, resources: observedResources, summary: { pendingAtSeal: pendingRequests.size },
    }))
    // Keep observing through unmount: a late request or an abort caused by close
    // must still prevent publication. Readiness has just been established above.
    await drawer.locator('.arco-drawer-close-btn').click({ timeout: timeoutMs })
    await requireGate('发布前预览抽屉关闭后应完成卸载', async () => {
      await flowExpect(page.locator('.settings-preview-drawer:visible')).toHaveCount(0, { timeout: timeoutMs })
      await flowExpect(page.locator('.settings-preview-renderer')).toHaveCount(0, { timeout: timeoutMs })
    })
    await drain({ mounted: false })
    evidence = await observer.stop({ discardPending: true, signal })
    const network = await saveEvidence()
    await requireNetworkHealth(network)
    logger('success', '发布前预览加载和网络检查通过，已截图并关闭预览', {
      apiCount: network.apiCount, resourceCount: network.resourceCount,
      screenshotPath: screenshot?.absolutePath,
    })
    return { loaded: true, closed: true, ...network }
  } catch (error) {
    if (!evidence) evidence = await observer.stop({ signal })
    if (!savedEvidence) await saveEvidence()
    logger('error', '发布前预览检查失败，已停止发布并保留预览网络证据')
    throw error
  } finally {
    page.off('request', onRequest)
    page.off('response', onResponse)
    page.off('requestfinished', onFinished)
    page.off('requestfailed', onFinished)
    if (!observer.stopped) await observer.stop({ signal })
  }
}
