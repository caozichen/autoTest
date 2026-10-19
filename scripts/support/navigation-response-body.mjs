// Chrome may discard an XHR/fetch body when its document navigates. Keep only
// the original response in memory; the browser still sends the request once.
const preservedBodies = new WeakMap()

export async function readResponseText(response) {
  const saved = preservedBodies.get(response.request())
  if (!saved) return response.text()
  if (saved.error) throw saved.error
  return saved.text
}

export async function preserveMutationResponseBeforeNavigation(page, { origin, path }) {
  const session = await page.context().newCDPSession(page)
  const pending = new Set()
  let request
  let saved
  const matches = candidate => {
    const url = new URL(typeof candidate.url === 'function' ? candidate.url() : candidate.url)
    const method = typeof candidate.method === 'function' ? candidate.method() : candidate.method
    return method === 'POST' && url.origin === origin && url.pathname.replace(/^\/api(?=\/)/, '') === path
  }
  const observeRequest = candidate => {
    if (!matches(candidate)) return
    request = candidate
    if (saved) preservedBodies.set(request, saved)
  }
  const paused = event => {
    const work = (async () => {
      try {
        if (!matches(event.request)) return
        const response = await session.send('Fetch.getResponseBody', { requestId: event.requestId })
        saved = { text: response.base64Encoded ? Buffer.from(response.body, 'base64').toString('utf8') : response.body }
      } catch (cause) {
        saved = { error: new Error('页面跳转前未能读取真实提交响应，已停止验证且不会重复提交', { cause }) }
      } finally {
        if (saved && request) preservedBodies.set(request, saved)
        // Release the original status, headers and body without modifying them.
        await session.send('Fetch.continueResponse', { requestId: event.requestId }).catch(() => undefined)
      }
    })()
    pending.add(work)
    work.finally(() => pending.delete(work))
  }
  page.on('request', observeRequest)
  session.on('Fetch.requestPaused', paused)
  try {
    await session.send('Fetch.enable', { patterns: [{ urlPattern: `${origin}*${path}*`, requestStage: 'Response' }] })
  } catch (error) {
    page.off('request', observeRequest)
    await session.detach().catch(() => undefined)
    throw error
  }
  return async () => {
    page.off('request', observeRequest)
    await session.send('Fetch.disable').catch(() => undefined)
    await Promise.allSettled([...pending])
    session.off('Fetch.requestPaused', paused)
    await session.detach().catch(() => undefined)
  }
}
