import { expect } from './recorded-expect.mjs'

// Observe application traffic without injecting or replacing editing credentials.
export function observeFormEditTokens(context, apiBaseUrl) {
  const api = new URL(apiBaseUrl)
  const root = `${api.pathname.replace(/\/$/, '')}/be/form/`
  const events = []
  const pending = new Set()
  const tracked = new WeakMap()
  const editors = new WeakMap()
  const pages = new Map()
  let editorSequence = 0
  const editorFor = request => {
    let page
    try { page = request.frame().page() } catch { /* APIRequestContext has no page. */ }
    const owner = page ?? context
    if (!editors.has(owner)) editors.set(owner, ++editorSequence)
    return editors.get(owner)
  }
  const watchPage = page => {
    if (pages.has(page)) return
    // A document reload accepts a new baseline. Hash-only settings navigation does not.
    const onNavigation = request => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        editors.set(page, ++editorSequence)
      }
    }
    page.on('request', onNavigation)
    pages.set(page, onNavigation)
  }
  for (const page of context.pages?.() ?? []) watchPage(page)
  const onRequest = request => {
    const url = new URL(request.url())
    if (url.origin !== api.origin || !url.pathname.startsWith(root)) return
    const [formId, ...parts] = url.pathname.slice(root.length).split('/')
    const suffix = parts.join('/')
    const read = request.method() === 'GET' && !suffix && url.searchParams.get('draft') !== '0'
    const write = ['PUT', 'POST'].includes(request.method())
      && ['items', 'config', 'activity', 'activity/update-props', 'audit/submit', 'publish'].includes(suffix)
    if (!formId || (!read && !write)) return
    let payload
    try { payload = write ? request.postDataJSON() : undefined } catch { payload = {} }
    const event = { key: `${editorFor(request)}:${formId}`, suffix, write, editingRequested: url.searchParams.get('draft') === '1', expected: payload?.expected_edit_token }
    events.push(event)
    tracked.set(request, event)
  }
  const onResponse = response => {
    const event = tracked.get(response.request())
    if (!event || event.completed) return
    event.completed = true
    // Preserve network order even when JSON bodies finish parsing in a different order.
    const completion = { key: event.key, responseFor: event }
    events.push(completion)
    const task = response.json().then(body => {
      completion.succeeded = response.ok() && Number(body?.code) === 0
      completion.token = body?.data?.edit_token ?? body?.data?.form?.edit_token
      completion.editingRead = event.editingRequested || body?.data?.form?.status === 'draft'
    }).catch(() => { completion.succeeded = false })
    pending.add(task)
    task.finally(() => pending.delete(task))
  }
  const onFailed = request => {
    const event = tracked.get(request)
    if (!event || event.completed) return
    event.completed = true
    events.push({ key: event.key, responseFor: event, succeeded: false })
  }
  context.on('page', watchPage)
  context.on('request', onRequest)
  context.on('response', onResponse)
  context.on('requestfailed', onFailed)
  return {
    async assert() {
      await Promise.all([...pending])
      const current = new Map()
      const inFlight = new Map()
      let writes = 0
      for (const event of events) {
        if (event.responseFor) {
          const request = event.responseFor
          if (request.write) inFlight.set(event.key, (inFlight.get(event.key) ?? 1) - 1)
          if (request.write && ['items', 'config', 'activity', 'activity/update-props'].includes(request.suffix)
            && event.succeeded) {
            expect(String(event.token ?? ''), `${request.suffix} 保存响应应返回有效 edit_token`).toMatch(/^[a-f0-9]{64}$/)
          }
          // Audit/background GETs deliberately preserve the editor's original baseline.
          if (event.succeeded && event.token && (request.write || (event.editingRead && !current.has(event.key)))) {
            current.set(event.key, event.token)
          }
        } else if (event.write) {
          writes += 1
          expect(inFlight.get(event.key) ?? 0, `${event.suffix} 应等待同一编辑页面前一次写入响应后再保存`).toBe(0)
          inFlight.set(event.key, (inFlight.get(event.key) ?? 0) + 1)
          expect(String(event.expected ?? ''), `${event.suffix} 请求应携带有效 expected_edit_token`).toMatch(/^[a-f0-9]{64}$/)
          expect(current.has(event.key), `${event.suffix} 写入前应已读取编辑令牌`).toBe(true)
          expect(event.expected, `${event.suffix} 应使用本编辑页面接受的读取或自身保存返回的编辑令牌`).toBe(current.get(event.key))
        }
      }
      expect(writes, '创建或发布流程应实际检查至少一次编辑令牌').toBeGreaterThan(0)
      return { checkedWrites: writes }
    },
    stop() {
      context.off('page', watchPage)
      context.off('request', onRequest)
      context.off('response', onResponse)
      context.off('requestfailed', onFailed)
      for (const [page, listener] of pages) page.off('request', listener)
      pages.clear()
    },
  }
}
