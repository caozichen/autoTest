import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import test from 'node:test'
import { authenticatePipeline, requestLoginJson } from './pipeline-login.mjs'
import { valueAtPath, resolvePipelinePath } from './pipeline-values.mjs'
const environment = () => ({ id: 'local-env', code: 'TEST', baseUrl: 'http://127.0.0.1:1', apiBaseUrl: 'http://127.0.0.1:1/api',
  auth: { strategy: 'api-login', method: 'POST', requestBody: '{"mobile":"fixture"}', timeoutMs: 50, loginPath: '/login',
    successPath: 'code', successValue: '0', tokenPath: 'data.token', tokenTypePath: 'data.type', tokenTypeFallback: 'Bearer' } })
const signal = () => new AbortController().signal

test('login preserves body, business rules, environment isolation and HK timeout scaling', async () => {
  for (const code of ['TEST', 'CN_PROD', 'HK_PROD']) {
    const env = { ...environment(), code }
    let options
    const result = await authenticatePipeline(env, null, signal(), async (url, args) => {
      assert.equal(url.href, 'http://127.0.0.1:1/api/login'); options = args
      return { code: 0, data: { token: 'fixture-token', type: 'Token' } }
    })
    assert.deepEqual(result, { token: 'fixture-token', scheme: 'Token' })
    assert.equal(options.timeoutMs, code === 'HK_PROD' ? 150 : 50)
    assert.deepEqual(JSON.parse(options.body), { mobile: 'fixture' })
  }
})
for (const [name, response, message] of [
  ['business failure', { code: 1, data: { token: 'fixture' } }, /业务校验失败/],
  ['missing token', { code: 0, data: {} }, /有效 Token/],
  ['object token', { code: 0, data: { token: { nested: 'bad' } } }, /有效 Token/],
  ['invalid scheme', { code: 0, data: { token: 'fixture', type: 'Bearer invalid' } }, /类型无效/],
]) test(`login rejects ${name}`, async () => {
  await assert.rejects(authenticatePipeline(environment(), null, signal(), async () => response), message)
})

test('reused session checks exact environment, origins and expiry without logging in', async () => {
  const env = environment(); env.auth.strategy = 'reuse-session'
  const session = { environmentId: env.id, siteUrl: env.baseUrl, apiUrl: env.apiBaseUrl, token: 'fixture', scheme: 'Bearer', expiresAt: null }
  const request = () => { throw new Error('must not authenticate') }
  assert.deepEqual(await authenticatePipeline(env, session, signal(), request), { token: 'fixture', scheme: 'Bearer' })
  for (const changes of [{ environmentId: 'other' }, { siteUrl: 'http://other.test' }, { apiUrl: 'http://other.test/api' }, { expiresAt: 1 }, { token: 'has spaces' }]) {
    await assert.rejects(authenticatePipeline(env, { ...session, ...changes }, signal(), request), /登录态/)
  }
})

test('login transport bounds total response time and abort, rejects HTTP/JSON errors, never follows redirects', async t => {
  let mutations = 0
  const server = createServer((req, res) => {
    if (req.url === '/slow') { res.writeHead(200); res.write('{'); return }
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/mutate' }); res.end(); return }
    if (req.url === '/mutate') mutations++
    res.writeHead(req.url === '/fail' ? 401 : 200)
    res.end(req.url === '/bad' ? 'invalid json' : '{"ok":true}')
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  const url = path => new URL(`http://127.0.0.1:${server.address().port}${path}`)
  const options = { method: 'POST', body: '{}', timeoutMs: 50, signal: signal() }
  assert.deepEqual(await requestLoginJson(url('/ok'), options), { ok: true })
  await assert.rejects(requestLoginJson(url('/slow'), options), /超过/)
  await assert.rejects(requestLoginJson(url('/fail'), options), /HTTP 401/)
  await assert.rejects(requestLoginJson(url('/bad'), options), /JSON/)
  await assert.rejects(requestLoginJson(url('/redirect'), options), /HTTP 302/)
  assert.equal(mutations, 0)
  const controller = new AbortController()
  const pending = requestLoginJson(url('/slow'), { ...options, signal: controller.signal })
  controller.abort(); await assert.rejects(pending, /abort/i)
})

test('mapping supports nested arrays and JSON objects while rejecting unsafe/unresolved URL paths', () => {
  const value = { a: [{ id: 7 }] }
  assert.equal(valueAtPath(value, '$.a[0].id'), 7)
  assert.equal(valueAtPath(value, '__proto__'), undefined)
  assert.equal(valueAtPath(value, 'constructor'), undefined)
  assert.equal(resolvePipelinePath('/form?id={{form_id}}', { FORM_ID: '7' }), '/form?id=7')
  for (const path of ['https://other.test', '//other.test', '/{{missing}}', '/bad path', '/bad\\path']) {
    assert.throws(() => resolvePipelinePath(path, {}))
  }
})
