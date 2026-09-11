import assert from 'node:assert/strict'
import test from 'node:test'
import { assertNetworkEvidence } from '../../scripts/form-submission-list-check.ui.spec.mjs'
import { runWithAssertionRecorder } from '../../scripts/support/recorded-expect.mjs'

function evidence(extra = {}) {
  return {
    summary: { pendingAtSeal: 1, discardedPending: 0 },
    api: [{ url: 'https://admin.example/api/be/form/list', ok: true, responseBody: { code: 0 } },
      { url: 'https://sentry.example/api/44/envelope/', ok: false, incomplete: true, isFirstParty: false }],
    resources: [{ url: 'https://admin.example/app.js', ok: true, isFirstParty: true }],
    ...extra,
  }
}
function failures(value) {
  const events = []
  runWithAssertionRecorder('form-submission-list-check', event => events.push(event), () =>
    assertNetworkEvidence(value, 'https://admin.example', '/api'))
  return events.filter(event => event.status === 'failed')
}
test('unfinished third-party telemetry does not fail backend business health checks', () => {
  assert.deepEqual(failures(evidence()), [])
})
test('unfinished or failed same-origin APIs remain failures', () => {
  const value = evidence()
  value.api[0] = { ...value.api[0], ok: false, incomplete: true }
  assert.ok(failures(value).some(event => event.name.includes('后台 API')))
})
test('failed first-party resources remain failures', () => {
  const value = evidence()
  value.resources[0].ok = false
  assert.ok(failures(value).some(event => event.name.includes('静态资源')))
})
