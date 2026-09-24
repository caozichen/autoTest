import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { identifyCreatedTemplate } from '../../scripts/form-save-template-management.ui.spec.mjs'
import { resolveScriptEntryUrl, validateScriptConfig } from './script-config-repository.mjs'

test('registers the template flow with the source form and standard timeout', async () => {
  const config = validateScriptConfig(JSON.parse(await readFile(
    new URL('../../config/scripts/form-save-template-management.json', import.meta.url), 'utf8',
  )))
  assert.equal(config.name, '表单存为模板-系统模板管理')
  assert.equal(config.timeoutMs, 600_000)
  assert.equal(config.inputParameters.find(parameter => parameter.key === 'FORM_ID')?.value, 'lg2wd5')
  assert.equal(config.responseVariableBindings.find(binding => binding.variableName === 'TEMPLATE_CREATED_FORM_ID')?.responsePath,
    'createdFormId')
  assert.equal(config.responseVariableBindings.find(binding => binding.variableName === 'DELETED_TEMPLATE_ID')?.responsePath,
    'deletedTemplateId')
  await import(await resolveScriptEntryUrl(config))
})

test('identifies only the newly created organization template', () => {
  const name = '源表单'
  const previousIds = new Set(['oldtemplate', 'systemtemplate'])
  const records = [
    { id: 'systemtemplate', name, is_system: 1, form_id: 'systemdraft' },
    { id: 'newtemplate', name, is_system: 0, form_id: 'newdraft' },
    { id: 'oldtemplate', name, is_system: 0, form_id: 'olddraft' },
  ]
  assert.equal(identifyCreatedTemplate(records, previousIds, name, 'source', 'newtemplate').id,
    'newtemplate')
  assert.throws(() => identifyCreatedTemplate(records, previousIds, name, 'source', 'wrong'))
  assert.throws(() => identifyCreatedTemplate([
    ...records, { id: 'another', name, is_system: 0, form_id: 'anotherdraft' },
  ], previousIds, name, 'source'))
  assert.throws(() => identifyCreatedTemplate([
    { id: 'newtemplate', name, is_system: 1, form_id: 'newdraft' },
  ], previousIds, name, 'source'))
  assert.throws(() => identifyCreatedTemplate([
    { id: 'newtemplate', name, is_system: 0, form_id: 'source' },
  ], previousIds, name, 'source'))
})
