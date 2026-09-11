import assert from 'node:assert/strict'
import test from 'node:test'
import { redactRunRecordResult } from './run-record-result.mjs'

test('Runner history results redact context secrets, nested credentials and bearer strings', () => {
  const result = { status: 'passed', ok: true, result: { formId: 'new-form', password: 'raw-password' },
    logs: [{ message: 'value private-value and Bearer private-token', details: { access_token: 'raw' } }],
    apiResponses: [{ responseBody: { secret: 'raw', count: 3 } }] }
  const redacted = redactRunRecordResult(result, { variables: { API_KEY: 'private-value' } })
  const serialized = JSON.stringify(redacted)
  for (const secret of ['private-value', 'private-token', 'raw-password', '"raw"']) assert.ok(!serialized.includes(secret))
  assert.equal(redacted.result.formId, 'new-form')
  assert.equal(redacted.apiResponses[0].responseBody.count, 3)
  assert.equal(result.result.password, 'raw-password')
})
