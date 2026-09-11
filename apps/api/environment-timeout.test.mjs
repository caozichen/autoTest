import assert from 'node:assert/strict'
import test from 'node:test'
import { registeredRunContext, MAX_SCRIPT_TIMEOUT_MS } from './script-runner.mjs'

function payload(environmentCode) {
  return { scriptId: 'form-all-fields-publish', timeoutMs: 999999,
    context: { environmentCode, siteBaseUrl: 'https://example.test/', apiBaseUrl: 'https://example.test/api',
      authorizationOrigin: 'https://example.test', extraHTTPHeaders: { Authorization: 'Bearer test-token' } } }
}
for (const code of ['HK_PROD', 'prod_hk', 'Prod_Hk_1']) {
  test(`${code} uses three times the saved standard without modifying it`, () => {
    const config = { timeoutMs: 600000 }
    assert.equal(registeredRunContext(payload(code), config).timeoutMs, 1800000)
    assert.equal(config.timeoutMs, 600000)
  })
}
test('other and legacy environments retain the standard', () => {
  for (const code of ['TEST', 'CN_PROD', undefined]) assert.equal(registeredRunContext(payload(code), { timeoutMs: 600000 }).timeoutMs, 600000)
})
test('maximum valid standard can be tripled, invalid standards still fail validation', () => {
  assert.equal(registeredRunContext(payload('HK'), { timeoutMs: MAX_SCRIPT_TIMEOUT_MS }).timeoutMs, MAX_SCRIPT_TIMEOUT_MS * 3)
  assert.throws(() => registeredRunContext(payload('HK'), { timeoutMs: MAX_SCRIPT_TIMEOUT_MS + 1 }), /超时/)
})
