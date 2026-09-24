import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { activeFilterKeys, queryValues } from '../../scripts/form-activity-search-category.ui.spec.mjs'
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
