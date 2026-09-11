import { expect, scaleTimeout } from './environment-timeouts.mjs'

const pages = new WeakMap()
const BUSY = '.arco-spin-mask:visible, .arco-btn-loading:visible, [aria-busy="true"]:visible, [data-loading="true"]:visible'

// Observe before navigation, so an already-running bootstrap request is not missed.
export function observeUiReadiness(page) {
  if (pages.has(page)) return pages.get(page)
  const state = { pending: new Set(), changedAt: 0, navigating: false }
  const finish = request => {
    if (state.pending.delete(request)) state.changedAt = Date.now()
  }
  page.on('request', request => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) state.navigating = true
    if (!['xhr', 'fetch'].includes(request.resourceType())) return
    const url = new URL(request.url())
    if (!/\/(?:api\/)?(?:be|base|f)\//.test(url.pathname)) return
    // Background AI polling must not hold unrelated controls hostage.
    if (/\/translation\/ai\/status$/.test(url.pathname)) return
    state.pending.add(request)
    state.changedAt = Date.now()
  })
  page.on('requestfinished', finish)
  page.on('requestfailed', finish)
  page.on('response', response => {
    if (/text\/event-stream/i.test(response.headers()['content-type'] ?? '')) finish(response.request())
  })
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame() && state.navigating) {
      state.navigating = false
      state.pending.clear()
      state.changedAt = Date.now()
    }
  })
  pages.set(page, state)
  return state
}

export async function waitForUiReady(page, { timeout = scaleTimeout(30_000) } = {}) {
  const state = observeUiReadiness(page)
  await expect.poll(async () => {
    const busy = await page.locator(BUSY).count()
    if (busy > 0) state.changedAt = Date.now()
    return {
      // Paths only: diagnostics must not include tokens or submitted values.
      pending: [...state.pending].map(request => new URL(request.url()).pathname),
      busy,
      settled: Date.now() - state.changedAt >= 200,
    }
  }, {
    timeout,
    intervals: [50, 100, 200],
    message: '操作前等待业务请求正文完成、加载状态消失及界面更新稳定',
  }).toEqual({ pending: [], busy: 0, settled: true })
}

// Never retry the click: a slow save/create response must not create duplicate writes.
// Share one action budget between readiness and Playwright's normal actionability checks.
export async function clickWhenReady(locator, options = {}) {
  const timeout = options.timeout ?? scaleTimeout(30_000)
  const started = Date.now()
  await waitForUiReady(locator.page(), { timeout })
  const remaining = () => Math.max(1, timeout - (Date.now() - started))
  // The target may appear after the first readiness check, starting another load.
  await locator.click({ ...options, trial: true, timeout: remaining() })
  await waitForUiReady(locator.page(), { timeout: remaining() })
  await locator.click({ ...options, timeout: remaining() })
  observeUiReadiness(locator.page()).changedAt = Date.now()
}
