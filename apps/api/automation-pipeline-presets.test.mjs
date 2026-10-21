import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import catalog from '../../config/automation-pipelines.json' with { type: 'json' }
import { importAutomationPipelines } from '../../scripts/import-automation-pipelines.mjs'
import { AppSettingsStore } from './app-settings-store.mjs'
import { createRunnerServer } from './server.mjs'

const KEY = 'autotest.automation-pipelines.v1'
const TABS = 'autotest.run-history-tabs.v1'
const SESSION_KEY = 'autotest.environment-session.v1.preset-fixture'
const SESSION = JSON.stringify({ environmentId: 'preset-fixture', siteUrl: 'https://fixture.test', apiUrl: 'https://fixture.test/api',
  token: 'fixture-session-secret', scheme: 'Bearer', accountLabel: 'fixture', savedAt: '2026-01-01T00:00:00.000Z', expiresAt: null })

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'autotest-pipeline-presets-'))
  const store = new AppSettingsStore({ directory: join(directory, 'settings') })
  const runner = createRunnerServer({ appSettingsStore: store, runRecordDirectory: join(directory, 'records') })
  runner.listen(0, '127.0.0.1')
  await once(runner, 'listening')
  t.after(async () => { runner.closeAllConnections(); await new Promise(resolve => runner.close(resolve)); await rm(directory, { recursive: true, force: true }) })
  return { store, runnerUrl: `http://127.0.0.1:${runner.address().port}` }
}

test('six portable presets reference registered scripts and earlier outputs, with concurrency last in each smoke run', async () => {
  assert.equal(catalog.pipelines.length, 6)
  assert.doesNotMatch(JSON.stringify(catalog), /Bearer|Authorization|password|session|token/i)
  for (const [index, pipeline] of catalog.pipelines.entries()) {
    const previous = new Set()
    assert.equal(pipeline.steps.length, index < 3 ? 7 : 4)
    for (const step of pipeline.steps) {
      const script = JSON.parse(await readFile(new URL(`../../config/scripts/${step.scriptId}.json`, import.meta.url), 'utf8'))
      assert.equal(script.enabled, true)
      assert.equal(previous.has(step.scriptId), false)
      for (const mapping of step.parameterMappings) assert.ok(previous.has(mapping.sourceScriptId))
      previous.add(step.scriptId)
    }
    if (index < 3) assert.deepEqual(pipeline.steps.at(-1), { scriptId: 'form-edit-concurrency', parameterMappings: [
      { sourceScriptId: pipeline.steps[0].scriptId, sourcePath: 'formId', targetKey: 'FORM_ID' },
    ] })
  }
})

test('HTTP import persists all presets without changing sessions or tabs, and repeating it performs no write', async t => {
  const { store, runnerUrl } = await fixture(t)
  await store.migrate({ [TABS]: '["preset-fixture"]', [SESSION_KEY]: SESSION })
  const actions = await importAutomationPipelines({ catalog, runnerUrl })
  assert.equal(actions.filter(item => item.action === 'created').length, 6)
  const saved = await store.read()
  assert.deepEqual(JSON.parse(saved.values[KEY]), catalog.pipelines)
  assert.equal(saved.values[SESSION_KEY], SESSION)
  assert.equal(saved.values[TABS], '["preset-fixture"]')
  assert.ok((await importAutomationPipelines({ catalog, runnerUrl })).every(item => item.action === 'skipped'))
  assert.deepEqual(await store.read(), saved)
})

test('replacing a same-named preset preserves its local identity and unrelated configurations', async t => {
  const { store, runnerUrl } = await fixture(t)
  const preset = catalog.pipelines[0]
  const existing = { ...preset, id: 'local-smoke-id', description: 'local customization', steps: preset.steps.slice(0, 6), createdAt: '2025-01-01T00:00:00.000Z' }
  const unrelated = { ...catalog.pipelines[3], id: 'local-unrelated-id', name: '本机自定义配置' }
  await store.migrate({ [KEY]: JSON.stringify([existing, unrelated]) })
  const single = { schemaVersion: 1, pipelines: [preset] }
  await importAutomationPipelines({ catalog: single, runnerUrl })
  assert.deepEqual(JSON.parse((await store.read()).values[KEY]), [existing, unrelated])
  assert.equal((await importAutomationPipelines({ catalog: single, runnerUrl, replace: true }))[0].action, 'updated')
  const [updated, retained] = JSON.parse((await store.read()).values[KEY])
  assert.equal(updated.id, existing.id)
  assert.equal(updated.createdAt, existing.createdAt)
  assert.deepEqual(updated.steps, preset.steps)
  assert.equal(updated.description, preset.description)
  assert.deepEqual(retained, unrelated)
})

test('a concurrent settings write rejects stale import without overwriting it', async t => {
  const { store, runnerUrl } = await fixture(t)
  await assert.rejects(importAutomationPipelines({ catalog, runnerUrl, fetchImpl: async (url, options) => {
    if (options?.method === 'PATCH') await store.update({ [TABS]: '["concurrent-choice"]' }, (await store.read()).revision)
    return fetch(url, options)
  } }), /其他页面更新/)
  const saved = await store.read()
  assert.equal(saved.values[TABS], '["concurrent-choice"]')
  assert.equal(Object.hasOwn(saved.values, KEY), false)
})

test('duplicate preset identities are rejected before accessing settings', async () => {
  await assert.rejects(importAutomationPipelines({
    catalog: { schemaVersion: 1, pipelines: [catalog.pipelines[0], catalog.pipelines[0]] },
    fetchImpl: () => { throw new Error('must not access settings') },
  }), /唯一 ID/)
})
