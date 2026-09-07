import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createFormLinkContract,
  firstFormCode,
  parseFormLinkContract,
  resolveFormFieldKeys,
} from '../../scripts/support/form-link-contract.mjs'
import {
  FIELD_KEYS,
  assertPublishedFormContract,
} from '../../scripts/form-lpxavn-submit.ui.spec.mjs'
import { createPublishedFormFixture } from './support/form-lpxavn-fixtures.mjs'

test('ignores server system items when resolving fields by type', () => {
  const fieldKeys = resolveFormFieldKeys([
    { item_key: 'channel', type_code: 'textarea', item_kind: 'system' },
    { item_key: 'future_system_input', type_code: 'input', item_kind: 'system' },
    {
      item_key: 'future_system_group_username',
      type_code: 'username',
      item_kind: 'system',
      group_code: 'group_business',
    },
    { item_key: 'input_business', type_code: 'input', item_kind: 'common' },
    { item_key: 'textarea_business', type_code: 'textarea', item_kind: 'common' },
    { item_key: 'group_business', type_code: 'field_group', item_kind: 'common' },
    {
      item_key: 'group_username_business',
      type_code: 'username',
      item_kind: 'common',
      group_code: 'group_business',
    },
  ])

  assert.equal(fieldKeys.input, 'input_business')
  assert.equal(fieldKeys.textarea, 'textarea_business')
  assert.equal(fieldKeys.groupUsername, 'group_username_business')

  const legacyFieldKeys = resolveFormFieldKeys([
    { item_key: 'channel', type_code: 'textarea' },
    { item_key: 'textarea_legacy_business', type_code: 'textarea' },
  ])
  assert.equal(legacyFieldKeys.textarea, 'textarea_legacy_business')
})

test('filters current and legacy system items from a linked form contract', () => {
  const contract = createFormLinkContract({
    formId: '202',
    formCode: 'linked-form',
    title: 'Linked form',
    revisionNo: 1,
    items: [
      { item_key: 'channel', type_code: 'textarea' },
      { item_key: 'params', type_code: 'textarea' },
      { item_key: 'device', type_code: 'input' },
      { item_key: 'future_system_number', type_code: 'number', item_kind: 'system' },
      { item_key: 'input_business', type_code: 'input', hidden: 2 },
      { item_key: 'textarea_business', type_code: 'textarea', hidden: 2 },
      { item_key: 'number_business', type_code: 'number', hidden: 2 },
    ],
  })

  assert.equal(contract.fieldKeys.input, 'input_business')
  assert.equal(contract.fieldKeys.textarea, 'textarea_business')
  assert.equal(contract.fieldKeys.number, 'number_business')
  assert.deepEqual(
    contract.items.map((item) => item.item_key),
    ['input_business', 'textarea_business', 'number_business'],
  )
  assert.deepEqual(contract.pageFieldKeys[1], [
    'input_business',
    'textarea_business',
    'number_business',
  ])
})

test('keeps formId as the only route identity when formId differs from legacy formCode', () => {
  const contract = createFormLinkContract({
    formId: 'route-form-id',
    formCode: 'legacy-form-code',
    title: 'Linked form',
    revisionNo: 1,
    items: [],
  })

  assert.equal(contract.formId, 'route-form-id')
  assert.equal(contract.formCode, 'legacy-form-code')
  assert.notEqual(contract.formId, contract.formCode)
  assert.throws(
    () => createFormLinkContract({ formCode: 'legacy-form-code', items: [] }),
    /必须包含 formId/,
  )

  const historical = parseFormLinkContract('{"formCode":"legacy-only"}')
  assert.equal(historical.formCode, 'legacy-only')
  assert.equal(historical.formId, undefined)
})

test('does not expose numeric form_code placeholders as legacy route codes', () => {
  assert.equal(firstFormCode(
    { data: { form_id: 'route-form-id', form_code: '9007199254740993' } },
    { data: { form: { form_id: 'route-form-id', form_code: 9007199254740992 } } },
  ), '')
  assert.equal(firstFormCode(
    { data: { form_id: 'route-form-id', form_code: 'legacy-short-code' } },
  ), 'legacy-short-code')
})

test('validates the current server channel shape through the published-form caller', () => {
  const fixture = createPublishedFormFixture()
  const businessTextareaIndex = fixture.data.items.findIndex((item) => (
    item.item_key === FIELD_KEYS.textarea
  ))
  fixture.data.items.splice(businessTextareaIndex, 0, {
    item_key: 'channel',
    type_code: 'textarea',
    item_kind: 'system',
  })

  const contract = assertPublishedFormContract(fixture)

  assert.equal(contract.fieldKeys.textarea, FIELD_KEYS.textarea)
  assert.equal(contract.pageFieldKeys[1].includes('channel'), false)
})
