import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test, { after, before } from 'node:test'
import { withAgreementLocaleCompatibility } from '../../scripts/support/form-agreement-locale.mjs'
import { attachNetworkObserver } from '../../scripts/support/api-response-recorder.mjs'
import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'

const FORM_ID = 'agreement-fixture'
const CONFIG_PATH = `/api/be/form/${FORM_ID}/config`
const DICTIONARY = [
  { enum_key: 'zh_cn', enum_value: 'zh_CN', enum_name: '简体中文' },
  { enum_key: 'zh_hk', enum_value: 'zh_HK', enum_name: '繁體中文' },
  { enum_key: 'en_us', enum_value: 'en_US', enum_name: 'English' },
]
let browser
before(async () => { browser = await launchGoogleChrome() })
after(async () => { await browser?.close() })

function agreementPayload(languages = ['zh_cn']) {
  return {
    common_config: {
      title: '完整表单',
      privacy_policy: {
        enabled: 1, confirm_required: 2, name: '用户协议', source: 'custom',
        agreements: languages.map((language, index) => ({
          language, original: index === 0 ? 2 : 1,
          content: `<h2>完整协议 ${index}</h2><p>包含 zh_cn 与链接 <a href="https://example.test/?language=en_us">正文</a></p>`,
          file: [], custom: { untouched: true, count: 0, empty: null },
        })),
      },
      unrelated: { language: 'zh_cn', nested: ['en_us', { language: 'zh_hk' }] },
    },
    notification_config: { enabled: false, settings: [1, 2, null] },
  }
}

async function fixture(t, { dictionary = DICTIONARY, dictionaryStatus = 200, dictionaryBody, saveCode = 0 } = {}) {
  const requests = []
  const logs = []
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString()
    requests.push({ url: request.url, method: request.method, headers: request.headers, raw,
      body: raw ? JSON.parse(raw) : undefined })
    if (request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end('<!doctype html><html><head><link rel="icon" href="data:,"></head><body>协议保存验证</body></html>')
      return
    }
    const isDictionary = request.url === '/api/base/dict/tree'
    response.writeHead(isDictionary ? dictionaryStatus : 200, {
      'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'PUT, POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type',
    })
    response.end(JSON.stringify(isDictionary
      ? dictionaryBody ?? { code: 0, message: 'success', data: { supported_locales: { children: dictionary } } }
      : { code: saveCode, message: saveCode ? '真实服务端拒绝' : 'success', data: { saved: raw ? JSON.parse(raw) : null } }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  const origin = `http://127.0.0.1:${server.address().port}`
  const page = await browser.newPage()
  t.after(() => page.close())
  await page.goto(origin)
  await page.evaluate(() => localStorage.setItem('token', 'Bearer local-fixture-token'))
  return {
    page, origin, requests, logs,
    args: { page, formId: FORM_ID, logger: (level, message, details) => logs.push({ level, message, details }) },
    send: (body, { url = CONFIG_PATH, method = 'PUT', raw } = {}) => page.evaluate(async value => {
      const response = await fetch(value.url, {
        method: value.method, headers: { 'Content-Type': 'application/json' },
        ...(value.method === 'GET' ? {} : { body: value.raw ?? JSON.stringify(value.body) }),
      })
      return { status: response.status, body: await response.json() }
    }, { body, url, method, raw }),
  }
}

test('forwards the complete real payload with only dictionary-confirmed language changes and records the final body', async t => {
  const f = await fixture(t)
  const payload = agreementPayload(['zh_cn', 'zh_hk', 'en_us', 'zh_CN', 'de_de'])
  const expected = structuredClone(payload)
  for (const [index, language] of ['zh_CN', 'zh_HK', 'en_US'].entries()) expected.common_config.privacy_policy.agreements[index].language = language
  const originalSnapshot = structuredClone(payload)
  const observer = attachNetworkObserver(f.page, { includeResources: false })
  await observer.ready
  t.after(() => observer.stop())
  const responsePromise = f.page.waitForResponse(response => response.url() === `${f.origin}${CONFIG_PATH}`)
  const result = await withAgreementLocaleCompatibility(f.args, () => f.send(payload))
  const response = await responsePromise
  const network = await observer.stop()
  const sent = f.requests.find(request => request.url === CONFIG_PATH)
  assert.deepEqual(sent.body, expected)
  assert.deepEqual(payload, originalSnapshot)
  assert.deepEqual(response.request().postDataJSON(), expected)
  assert.deepEqual(network.api.find(entry => entry.url === `${f.origin}${CONFIG_PATH}`).requestBody, expected)
  assert.deepEqual(result.result, { status: 200, body: { code: 0, message: 'success', data: { saved: expected } } })
  assert.deepEqual(result.compatibility, {
    applied: true, reason: 'dictionary-confirmed-known-aliases', dictionaryParameters: DICTIONARY,
    originalLanguages: ['zh_cn', 'zh_hk', 'en_us', 'zh_CN', 'de_de'],
    forwardedLanguages: ['zh_CN', 'zh_HK', 'en_US', 'zh_CN', 'de_de'],
  })
  const dictionaryRequests = f.requests.filter(request => request.url === '/api/base/dict/tree')
  assert.equal(dictionaryRequests.length, 1)
  assert.equal(dictionaryRequests[0].headers.authorization, 'Bearer local-fixture-token')
  assert.equal(dictionaryRequests[0].headers['sec-fetch-site'], 'same-origin')
  assert.equal(f.logs.length, 1)
  assert.equal(f.logs[0].level, 'warning')
  assert.match(f.logs[0].message, /UI.*缺陷.*兼容/)
  assert.equal(JSON.stringify(f.logs).includes('local-fixture-token'), false)
})

for (const languages of [['zh_CN', 'zh_HK', 'en_US'], ['zh', 'en', 'zh-cn', 'ZH_CN', 'de_de']]) {
  test(`forwards canonical or unknown languages byte-for-byte: ${languages.join(', ')}`, async t => {
    const f = await fixture(t, { dictionary: [...DICTIONARY, { enum_key: 'de_de', enum_value: 'de_DE' }] })
    const payload = agreementPayload(languages)
    const raw = JSON.stringify(payload, null, 2)
    const { compatibility } = await withAgreementLocaleCompatibility(f.args, () => f.send(payload, { raw }))
    assert.equal(f.requests.find(request => request.url === CONFIG_PATH).raw, raw)
    assert.equal(compatibility.applied, false)
    assert.deepEqual(compatibility.originalLanguages, languages)
    assert.deepEqual(compatibility.forwardedLanguages, languages)
    assert.deepEqual(f.logs, [])
  })
}

test('requires a unique exact enum_key and enum_value pair for each known alias', async t => {
  const f = await fixture(t, { dictionary: [
    { enum_key: 'zh_cn', enum_value: 'zh-CN' },
    { enum_key: 'zh_hk', value: 'zh_HK' },
    { enum_key: 'en_us', enum_value: 'en_US' },
    { enum_key: 'en_us', enum_value: 'en_GB' },
    { enum_key: 'zh_CN', enum_value: 'zh_CN' },
  ] })
  const payload = agreementPayload(['zh_cn', 'zh_hk', 'en_us'])
  const { compatibility } = await withAgreementLocaleCompatibility(f.args, () => f.send(payload))
  assert.deepEqual(f.requests.find(request => request.url === CONFIG_PATH).body, payload)
  assert.equal(compatibility.applied, false)
})

test('limits compatibility to one exact same-origin form config PUT with privacy policy agreements', async t => {
  const f = await fixture(t)
  const foreign = await fixture(t)
  const payload = agreementPayload()
  const unrelated = { common_config: { terms_of_service: payload.common_config.privacy_policy }, notification_config: { language: 'zh_cn' } }
  const { compatibility } = await withAgreementLocaleCompatibility(f.args, async () => {
    await f.send(payload, { url: `${foreign.origin}${CONFIG_PATH}` })
    await f.send(payload, { url: '/api/be/form/another-form/config' })
    await f.send(payload, { url: `${CONFIG_PATH}?other=1` })
    await f.send(payload, { url: `${CONFIG_PATH}/extra` })
    await f.send(payload, { method: 'POST' })
    await f.send(unrelated)
    await f.send(payload)
    await f.send(payload)
  })
  const sent = f.requests.filter(request => request.body)
  assert.deepEqual(sent.slice(0, 4).map(request => request.body), Array(4).fill(payload))
  assert.deepEqual(sent[4].body, unrelated)
  assert.equal(sent[5].body.common_config.privacy_policy.agreements[0].language, 'zh_CN')
  assert.deepEqual(sent[6].body, payload)
  assert.deepEqual(foreign.requests.find(request => request.method === 'PUT').body, payload)
  assert.equal(compatibility.applied, true)
  await f.send(payload)
  assert.deepEqual(f.requests.at(-1).body, payload)
})

test('preserves the actual service business failure and removes routing when the action rejects', async t => {
  const f = await fixture(t, { saveCode: 40901 })
  const observer = attachNetworkObserver(f.page, { includeResources: false })
  await observer.ready
  t.after(() => observer.stop())
  let actual
  const failure = new Error('保存用户协议必须成功：40901')
  await assert.rejects(withAgreementLocaleCompatibility(f.args, async () => {
    actual = await f.send(agreementPayload())
    if (actual.body.code !== 0) throw failure
  }), error => error === failure)
  assert.equal(actual.status, 200)
  assert.equal(actual.body.code, 40901)
  assert.equal(actual.body.message, '真实服务端拒绝')
  await f.send(agreementPayload())
  assert.equal(f.requests.at(-1).body.common_config.privacy_policy.agreements[0].language, 'zh_cn')
  const network = await observer.stop()
  const entry = network.api.find(value => value.url === `${f.origin}${CONFIG_PATH}`)
  assert.equal(entry.responseBody.code, 40901)
  assert.equal(entry.requestBody.common_config.privacy_policy.agreements[0].language, 'zh_CN')
})

test('removes its route when the action throws before any matching request', async t => {
  const f = await fixture(t)
  const failure = new Error('UI action failed')
  await assert.rejects(withAgreementLocaleCompatibility(f.args, async () => { throw failure }), error => error === failure)
  await f.send(agreementPayload())
  assert.equal(f.requests.at(-1).body.common_config.privacy_policy.agreements[0].language, 'zh_cn')
})

for (const options of [
  { dictionaryStatus: 503 },
  { dictionaryBody: { code: 401, data: { supported_locales: { children: DICTIONARY } } } },
  { dictionaryBody: { code: 0, success: false, data: { supported_locales: { children: DICTIONARY } } } },
  { dictionaryBody: { data: { supported_locales: { children: DICTIONARY } } } },
  { dictionaryBody: { code: 0, data: {} } },
]) {
  test(`rejects an unsuccessful or malformed fresh dictionary: ${JSON.stringify(options)}`, async t => {
    const f = await fixture(t, options)
    let actionRan = false
    await assert.rejects(withAgreementLocaleCompatibility(f.args, async () => { actionRan = true }), /用户协议语言字典/)
    assert.equal(actionRan, false)
    await f.send(agreementPayload())
    assert.equal(f.requests.at(-1).body.common_config.privacy_policy.agreements[0].language, 'zh_cn')
  })
}
