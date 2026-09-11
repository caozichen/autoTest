import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

import { validateScriptConfig } from './script-config-repository.mjs'

const repositoryRoot = resolve(import.meta.dirname, '../..')

async function registeredConfig(scriptId) {
  const source = await readFile(
    resolve(repositoryRoot, 'config/scripts', `${scriptId}.json`),
    'utf8',
  )
  return validateScriptConfig(JSON.parse(source))
}

test('registers the submission list checker with bounded admin-list inputs', async () => {
  const config = await registeredConfig('form-submission-list-check')

  assert.equal(config.name, '检查提报列表')
  assert.equal(config.entryFile, 'form-submission-list-check.ui.spec.mjs')
  assert.equal(config.requestPath, '/form-activity/submission/preview?id={{FORM_ID}}')
  assert.equal(config.timeoutMs, 600_000)
  assert.equal(config.enabled, true)
  assert.deepEqual(
    config.inputParameters?.map(({ key, value }) => [key, value]),
    [
      ['FORM_ID', '4J02PQ'],
      ['SUBMISSION_ID', 'vyY5Z5'],
      ['SUBMISSION_ASSERTIONS', '{}'],
    ],
  )
})

test('publishes the current form, submission, and contact assertion outputs from filling scripts', async () => {
  for (const scriptId of ['form-lpxavn-submit', 'form-all-fields-submit']) {
    const config = await registeredConfig(scriptId)
    assert.deepEqual(
      config.responseVariableBindings?.map(({ variableName, responsePath, secret }) => ({
        variableName,
        responsePath,
        secret,
      })),
      [
        { variableName: 'FORM_ID', responsePath: 'formId', secret: false },
        { variableName: 'SUBMISSION_ID', responsePath: 'submissionId', secret: false },
        {
          variableName: 'SUBMISSION_ASSERTIONS',
          responsePath: 'submissionAssertions',
          secret: false,
        },
      ],
      `${scriptId} 应登记列表检查所需的三个输出`,
    )
  }
})
