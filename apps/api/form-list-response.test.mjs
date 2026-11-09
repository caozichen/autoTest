import assert from 'node:assert/strict'
import test from 'node:test'
import { getFormListRecords } from '../../scripts/support/form-list-response.mjs'

test('merges pinned rows before ordinary rows without changing ordinary pagination', () => {
  const payload = { data: { pinned_list: [{ id: 'pin' }], list: [{ id: 'normal' }],
    meta: { total: 1, current_page: 1 }, summary: { result_total: 2 } } }
  const baseline = structuredClone(payload)
  assert.deepEqual(getFormListRecords(payload).map(row => row.id), ['pin', 'normal'])
  assert.deepEqual(payload, baseline)
  assert.deepEqual(getFormListRecords({ data: { list: [{ id: 'legacy' }] } }), [{ id: 'legacy' }])
  assert.deepEqual(getFormListRecords({ data: { pinned_list: [{ id: 'onlyPin' }], list: [] } }), [{ id: 'onlyPin' }])
})

test('rejects malformed or duplicate display data rather than converting it to an empty result', () => {
  for (const payload of [null, {}, { data: { list: null } }, { data: { list: [], pinned_list: null } },
    { data: { list: [{}] } }, { data: { list: [{ id: 'duplicate' }], pinned_list: [{ id: 'duplicate' }] } }]) {
    assert.throws(() => getFormListRecords(payload))
  }
})
