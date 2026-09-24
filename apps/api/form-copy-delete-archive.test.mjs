import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  copyTitleFor,
  identifyNewCopy,
} from '../../scripts/form-copy-delete-archive.ui.spec.mjs'
import { resolveScriptEntryUrl, validateScriptConfig } from './script-config-repository.mjs'

test('registers the universal copy flow with the requested source and standard timeout', async () => {
  const config = validateScriptConfig(JSON.parse(await readFile(
    new URL('../../config/scripts/form-copy-delete-archive.json', import.meta.url), 'utf8',
  )))
  assert.equal(config.name, '表单复制-删除归档')
  assert.equal(config.timeoutMs, 600_000)
  assert.equal(config.inputParameters.find(parameter => parameter.key === 'FORM_ID')?.value, 'lg2wd5')
  await import(await resolveScriptEntryUrl(config))
})

test('identifies only the new same-name copy and rejects unsafe or ambiguous IDs', () => {
  const title = copyTitleFor('原表单')
  assert.equal(title, '原表单 - 复制')
  const previousIds = new Set(['oldcopy'])
  const records = [
    { id: 'oldcopy', title, status: 'published' },
    { id: 'newcopy', title, status: 'draft' },
    { id: 'unrelated', title: '其他表单', status: 'draft' },
  ]
  assert.equal(identifyNewCopy(records, previousIds, title, 'source', 'newcopy').id, 'newcopy')
  assert.throws(() => identifyNewCopy(records, previousIds, title, 'source', 'wrongcopy'))
  assert.throws(() => identifyNewCopy([...records, { id: 'another', title }], previousIds, title, 'source'))
  assert.throws(() => identifyNewCopy([{ id: 'source', title }], previousIds, title, 'source'))
})
