import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import test from 'node:test'
import { observeFormEditTokens } from '../../scripts/support/form-edit-token-observer.mjs'
import { resolveAdminLocale } from '../../scripts/support/admin-locale.mjs'
import { runWithAssertionRecorder } from '../../scripts/support/recorded-expect.mjs'
import { requireEditConflict, run } from '../../scripts/form-edit-concurrency.ui.spec.mjs'

const token = version => String(version).padStart(64, '0')

function traffic() {
  const context = new EventEmitter()
  const pages = [new EventEmitter(), new EventEmitter()]
  for (const page of pages) page.mainFrame = () => page
  context.pages = () => pages
  const observer = observeFormEditTokens(context, 'https://example.test/api')
  const request = (method, suffix = '?draft=1', expected, page = pages[0]) => {
    const req = { method: () => method, url: () => `https://example.test/api/be/form/one${suffix}`,
      postDataJSON: () => ({ expected_edit_token: expected }), frame: () => ({ page: () => page }) }
    context.emit('request', req)
    return req
  }
  const respond = async (req, data, code = 0) => {
    context.emit('response', { request: () => req, ok: () => true, json: async () => ({ code, data }) })
    await Promise.resolve()
  }
  const failures = async () => {
    const assertions = []
    await runWithAssertionRecorder('edit-token', entry => assertions.push(entry), () => observer.assert())
    observer.stop()
    for (const name of ['request', 'response', 'requestfailed', 'page']) assert.equal(context.listenerCount(name), 0)
    for (const page of pages) assert.equal(page.listenerCount('request'), 0)
    return assertions.filter(entry => entry.status === 'failed')
  }
  return { context, pages, request, respond, failures }
}

test('checks real application request tokens and own-write sequencing', async () => {
  for (const scenario of ['correct', 'missing', 'stale', 'overlap', 'overlap-same-token', 'missing-response']) {
    const { request, respond, failures } = traffic()
    await respond(request('GET'), { form: { edit_token: token(1) } })
    const first = request('PUT', '/items', scenario === 'missing' ? undefined : token(1))
    let second
    if (scenario === 'overlap') second = request('PUT', '/config', token(2))
    if (scenario === 'overlap-same-token') second = request('PUT', '/config', token(1))
    await respond(first, scenario === 'missing-response' ? {} : { edit_token: token(2) })
    second ??= request('PUT', '/config', scenario === 'stale' ? token(1) : token(2))
    await respond(second, { edit_token: token(3) })
    assert.equal((await failures()).length > 0, scenario !== 'correct', scenario)
  }
})

test('incidental GETs cannot silently adopt an unseen external edit', async () => {
  for (const adoptIncidentalRead of [false, true]) {
    const { request, respond, failures } = traffic()
    await respond(request('GET'), { form: { edit_token: token(1) } })
    await respond(request('GET'), { form: { edit_token: token(2) } })
    await respond(request('PUT', '/items', token(adoptIncidentalRead ? 2 : 1)), {}, 30001)
    assert.equal((await failures()).length > 0, adoptIncidentalRead)
  }
})

test('published reads do not seed or advance an editing baseline', async () => {
  for (const hasEditingRead of [true, false]) {
    const { request, respond, failures } = traffic()
    if (hasEditingRead) await respond(request('GET'), { form: { edit_token: token(1) } })
    await respond(request('GET', '?draft=0'), { form: { status: 'published', edit_token: token(2) } })
    await respond(request('GET', ''), { form: { status: 'published', edit_token: token(2) } })
    await respond(request('PUT', '/items', token(1)), { edit_token: token(3) })
    assert.equal((await failures()).length > 0, !hasEditingRead)
  }
})

test('two editors keep independent baselines and may send concurrent requests', async () => {
  const { pages, request, respond, failures } = traffic()
  for (const page of pages) await respond(request('GET', '?draft=1', undefined, page), { form: { edit_token: token(1) } })
  const a = request('PUT', '/items', token(1), pages[0])
  const b = request('PUT', '/items', token(1), pages[1])
  await respond(a, { edit_token: token(2) })
  await respond(b, {}, 30001)
  assert.deepEqual(await failures(), [])
})

test('network failures release the write lock without advancing the token or double-decrementing', async () => {
  const { context, request, respond, failures } = traffic()
  await respond(request('GET'), { form: { edit_token: token(1) } })
  const failed = request('PUT', '/items', token(1))
  context.emit('requestfailed', failed)
  await respond(request('PUT', '/items', token(1)), { edit_token: token(2) })
  const bodyFailed = request('PUT', '/config', token(2))
  await respond(bodyFailed, {}, 30001)
  context.emit('requestfailed', bodyFailed)
  await respond(request('PUT', '/config', token(2)), { edit_token: token(3) })
  assert.deepEqual(await failures(), [])
})

test('a document reload establishes a new accepted baseline for that editor', async () => {
  const { pages, request, respond, failures } = traffic()
  await respond(request('GET'), { form: { edit_token: token(1) } })
  pages[0].emit('request', { isNavigationRequest: () => true, frame: () => pages[0] })
  await respond(request('GET'), { form: { edit_token: token(2) } })
  await respond(request('PUT', '/items', token(2)), { edit_token: token(3) })
  assert.deepEqual(await failures(), [])
})

test('only the actual backend business conflict and explicit message count as an edit conflict', () => {
  const message = 'This form changed after it was read. Reload it and review the changes before saving or publishing.'
  requireEditConflict(200, { code: 30001, message }, '保存')
  requireEditConflict(200, { code: 30001, message: '表单在读取后已被修改，请重新读取并核对变化后再保存或发布。' }, '保存')
  requireEditConflict(200, { code: 30001, message: '表單在讀取後已被修改，請重新讀取並核對變更後再儲存或發佈。' }, '保存')
  for (const [status, body] of [
    [401, { code: 401, message: 'Unauthenticated' }],
    [403, { code: 30001, message }],
    [422, { code: 422, message: 'revision_no required' }],
    [200, { code: 30001, message: 'expected_edit_token must be 64 characters' }],
    [200, { code: 30001, errors: { expected_edit_token: ['invalid size'] } }],
    [200, { code: 0, message }],
  ]) assert.throws(() => requireEditConflict(status, body, '保存'))
})

test('admin locale is explicit and independent of the environment', () => {
  assert.equal(resolveAdminLocale(), 'zh-CN')
  assert.equal(resolveAdminLocale({ ADMIN_LOCALE: 'zh_HK' }), 'zh-HK')
  assert.throws(() => resolveAdminLocale({ ADMIN_LOCALE: 'unknown' }), /ADMIN_LOCALE/)
})

test('two isolated Chrome contexts reject stale saves and publishes and restore the draft setting', async t => {
  let version = 1
  let draftRevision = 0
  let show = 1
  const writes = []
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture.local')
    const send = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
    if (req.method === 'GET') {
      const draft = url.searchParams.get('draft') === '1'
      send({ code: 0, data: { form: { status: 'published', current_revision_no: 1,
        draft_revision_no: draftRevision, edit_token: token(version),
        theme_config: { header_image: { show: draft ? show : 1 } } } } })
      return
    }
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    writes.push({ path: url.pathname, body })
    if (body.expected_edit_token !== token(version)) {
      send({ code: 30001, message: 'This form changed after it was read. Reload it and review the changes before saving or publishing.' })
      return
    }
    show = body.theme_config.header_image.show
    version += 1
    draftRevision = 2
    send({ code: 0, data: { edit_token: token(version), revision_no: 2 } })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const assertions = []
  const result = await runWithAssertionRecorder('concurrency', entry => assertions.push(entry), () => run({
    apiBaseUrl: `http://127.0.0.1:${server.address().port}/api`, variables: { FORM_ID: 'owned-test' },
    extraHTTPHeaders: { Authorization: 'Bearer local-fixture' },
  }))
  assert.equal(result.staleSaveStatus, 200)
  assert.equal(result.stalePublishStatus, 200)
  assert.equal(show, 1)
  assert.equal(writes.length, 4)
  assert.equal(assertions.some(entry => entry.status === 'failed'), false)
})
