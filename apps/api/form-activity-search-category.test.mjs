import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { activeFilterKeys, queryValues, selectSearchSamples } from '../../scripts/form-activity-search-category.ui.spec.mjs'
import { resolveScriptEntryUrl, validateScriptConfig } from './script-config-repository.mjs'

test('registers form activity search and category with standard timeout', async () => {
  const config = validateScriptConfig(JSON.parse(await readFile(
    new URL('../../config/scripts/form-activity-search-category.json', import.meta.url), 'utf8',
  )))
  assert.equal(config.name, '表单活动搜索项及分类')
  assert.equal(config.timeoutMs, 600_000)
  await import(await resolveScriptEntryUrl(config))
})

test('normalizes active filter keys while ignoring empty and indexed date values', () => {
  const url = new URL('https://example.test/api/be/form/list')
  url.searchParams.set('filter[title]', '')
  url.searchParams.set('filter[created_at_between][0]', '2026-09-01')
  url.searchParams.set('filter[created_at_between][1]', '2026-09-02')
  assert.deepEqual(activeFilterKeys(url), ['filter[created_at_between]'])
  assert.deepEqual(queryValues(url, 'filter[created_at_between]'), ['2026-09-01', '2026-09-02'])
})

test('all target searches use the specified active form and never silently use another sample', () => {
  const form = { id: 'mail-new', title: '本次邮件表单', creator_name: '测试账号', created_at: '2026-10-21 10:00:00',
    updated_at: '2026-10-21 10:01:00', is_activity: 2, end_time: '2026-10-28 23:59:59',
    time_range: 'in_progress', status: 'published' }
  const other = { ...form, id: 'old-form' }
  const selected = selectSearchSamples([other, form], form.id)
  assert.ok(Object.values(selected).every(sample => sample === form))
  assert.throws(() => selectSearchSamples([other], form.id), /未找到本次表单/)
  assert.throws(() => selectSearchSamples([other, { ...form, end_time: null }], form.id))
  assert.throws(() => selectSearchSamples([other, { ...form, time_range: 'not_started' }], form.id))
  assert.throws(() => selectSearchSamples([other, { ...form, status: 'draft' }], form.id))
})
