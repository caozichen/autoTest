import assert from 'node:assert/strict'
import test from 'node:test'
import { assertAgreementPersistence } from '../../scripts/support/form-post-collection-settings.mjs'
import { runWithAssertionRecorder } from '../../scripts/support/recorded-expect.mjs'

const submitted = () => ({
  enabled: 1, confirm_required: 2, name: '自动化测试用户协议',
  agreements: [{ language: 'zh_CN', original: 2, content: '<h2>本次测试协议</h2><p>完整正文</p>' }],
})

const stored = () => {
  const value = submitted()
  value.source = 'custom'
  value.agreements[0].file = []
  return value
}

test('accepts only the documented server enrichment without changing submitted agreement parameters', () => {
  const request = submitted()
  const before = structuredClone(request)
  assertAgreementPersistence(stored(), request)
  assertAgreementPersistence(request, request)
  assert.deepEqual(request, before)
})

test('rejects changed agreement content, reading requirements and unexpected files even with the soft assertion recorder', () => {
  const changes = [
    value => { value.agreements[0].content = '<p>旧正文</p>' },
    value => { value.agreements[0].language = 'en' },
    value => { value.agreements.push({ ...value.agreements[0] }) },
    value => { value.agreements[0].file = [{ id: 'unexpected-file' }] },
    value => { value.confirm_required = 1 },
    value => { value.source = 'system' },
    value => { value.name = '旧协议' },
    value => { value.unexpected = true },
  ]
  for (const change of changes) {
    const actual = stored()
    change(actual)
    const assertions = []
    assert.throws(() => runWithAssertionRecorder('form-all-fields-publish', value => assertions.push(value),
      () => assertAgreementPersistence(actual, submitted())), /正文及所有配置必须完整一致/)
    assert.equal(assertions.filter(value => value.status === 'failed').length, 1)
  }
})
