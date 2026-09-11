import assert from 'node:assert/strict'
import test from 'node:test'
import { readResponseJsonWithin } from '../../scripts/form-multilingual-translation-publish.ui.spec.mjs'

test('bounds a response whose headers arrived but body never finishes', async () => {
  await assert.rejects(readResponseJsonWithin({ json: () => new Promise(() => {}) }, 'en_US 回读', 20), /en_US 回读响应体读取超过 20ms/)
})
test('preserves a delayed successful body and JSON errors', async () => {
  assert.deepEqual(await readResponseJsonWithin({ json: async () => ({ code: 0 }) }, '回读', 100), { code: 0 })
  await assert.rejects(readResponseJsonWithin({ json: async () => { throw new Error('invalid JSON') } }, '回读', 100), /invalid JSON/)
})
