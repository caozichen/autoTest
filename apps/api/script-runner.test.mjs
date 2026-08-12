import assert from 'node:assert/strict'
import test from 'node:test'

import { sanitizeErrorMessage, validateRunRequest } from './script-runner.mjs'

test('accepts a registered script with a same-origin authorization context', () => {
  const result = validateRunRequest({
    scriptId: 'form-contact-publish',
    context: {
      apiBaseUrl: 'https://example.test/api',
      ignoreHTTPSErrors: true,
      variables: { FORM_ID: 'form-123' },
      authorizationOrigin: 'https://example.test',
      extraHTTPHeaders: { Authorization: 'Bearer test-token' },
    },
  })

  assert.equal(result.apiBaseUrl, 'https://example.test/api')
  assert.equal(result.ignoreHTTPSErrors, true)
  assert.deepEqual(result.variables, { FORM_ID: 'form-123' })
  assert.equal(result.authorizationOrigin, 'https://example.test')
})

test('rejects malformed runtime variables', () => {
  assert.throws(() => validateRunRequest({
    scriptId: 'form-contact-publish',
    context: {
      apiBaseUrl: 'https://example.test/api',
      variables: { FORM_ID: 123 },
      authorizationOrigin: 'https://example.test',
      extraHTTPHeaders: { Authorization: 'Bearer test-token' },
    },
  }), /变量值必须是字符串/)
})

test('rejects unregistered scripts and cross-origin token forwarding', () => {
  assert.throws(() => validateRunRequest({ scriptId: '../../other.mjs', context: {} }), /脚本未登记/)
  assert.throws(() => validateRunRequest({
    scriptId: 'form-contact-publish',
    context: {
      apiBaseUrl: 'https://api.example.test/api',
      authorizationOrigin: 'https://other.example.test',
      extraHTTPHeaders: { Authorization: 'Bearer test-token' },
    },
  }), /不同源/)
})

test('redacts authorization values and ANSI control sequences from errors', () => {
  const authorization = 'Bearer sensitive-runtime-token'
  const rawError = new Error(
    '\u001b[2mCall log:\u001b[22m - Authorization: Bearer sensitive-runtime-token - accept: application/json',
  )
  const message = sanitizeErrorMessage(rawError, [authorization])

  assert.doesNotMatch(message, /sensitive-runtime-token/)
  assert.doesNotMatch(message, /\u001b/)
  assert.match(message, /Authorization: \[REDACTED\]/)
})
