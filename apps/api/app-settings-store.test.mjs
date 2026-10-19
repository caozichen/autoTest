import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AppSettingsStore } from './app-settings-store.mjs'
import { createRunnerServer } from './server.mjs'
import { WEB_ORIGIN } from '../../shared/local-services.mjs'

const TABS = 'autotest.run-history-tabs.v1'
const PIPELINES = 'autotest.automation-pipelines.v1'
const SESSION = 'autotest.environment-session.v1.env-fixture'
const session = JSON.stringify({ environmentId: 'env-fixture', siteUrl: 'https://fixture.test', apiUrl: 'https://fixture.test/api',
  token: 'fixture-secret', scheme: 'Bearer', accountLabel: 'local fixture', savedAt: '2026-01-01T00:00:00.000Z', expiresAt: null })

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'autotest-settings-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return new AppSettingsStore({ directory: join(directory, 'settings') })
}

test('settings survive store restart, preserve empty choices and keep a restricted previous-state backup', async t => {
  const store = await fixture(t)
  const migrated = await store.migrate({ [TABS]: '["env-fixture"]', [PIPELINES]: '[]', [SESSION]: session })
  const saved = await store.update({ [TABS]: '[]', [SESSION]: null }, migrated.revision)
  const restarted = new AppSettingsStore({ directory: store.directory })
  assert.deepEqual(await restarted.read(), saved)
  const retriedMigration = await restarted.migrate({ [TABS]: '["old-port"]', [SESSION]: session })
  assert.deepEqual(retriedMigration, saved, 'old ports cannot resurrect a cleared login or overwrite an empty selection')
  assert.deepEqual(JSON.parse(await readFile(store.path + '.bak', 'utf8')), migrated)
  if (process.platform !== 'win32') {
    assert.equal((await stat(store.path)).mode & 0o777, 0o600)
    assert.equal((await stat(store.path + '.bak')).mode & 0o777, 0o600)
    assert.equal((await stat(store.directory)).mode & 0o777, 0o700)
  }
})

test('concurrent clients reject stale revisions and invalid/corrupt data never replaces the saved settings', async t => {
  const store = await fixture(t)
  const second = new AppSettingsStore({ directory: store.directory })
  const results = await Promise.allSettled([store.update({ [TABS]: '[]' }, 0), second.update({ [PIPELINES]: '[]' }, 0)])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.find(result => result.status === 'rejected').reason.statusCode, 409)
  const before = await readFile(store.path, 'utf8')
  assert.throws(() => store.update({ [PIPELINES]: '[{"id":"broken"}]' }, 1), /格式无效/)
  assert.throws(() => store.migrate({ 'autotest.session.v1': '"platform-login"' }), /不支持/)
  assert.equal(await readFile(store.path, 'utf8'), before)
  const corrupt = '{ interrupted file'
  await writeFile(store.path, corrupt)
  await assert.rejects(store.update({ [TABS]: '[]' }, 1), /文件损坏/)
  assert.equal(await readFile(store.path, 'utf8'), corrupt)
})

test('HTTP settings migration and writes use the configured frontend origin and report storage failures', async t => {
  const store = await fixture(t)
  const runner = createRunnerServer({ appSettingsStore: store, runRecordDirectory: join(store.directory, 'records') })
  runner.listen(0, '127.0.0.1'); await once(runner, 'listening')
  t.after(() => { runner.closeAllConnections(); runner.close() })
  const url = `http://127.0.0.1:${runner.address().port}/app-settings`
  const request = (path = '', method = 'GET', body, origin = WEB_ORIGIN) => fetch(url + path, { method,
    headers: { Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const migrated = await request('/migrations/local-storage-v1', 'POST', { entries: { [TABS]: '[]' } })
  assert.equal(migrated.status, 200)
  assert.equal(migrated.headers.get('access-control-allow-origin'), WEB_ORIGIN)
  assert.equal((await migrated.json()).values[TABS], '[]')
  assert.equal((await request('', 'PATCH', { changes: { [TABS]: '["updated"]' }, expectedRevision: 0 })).status, 409)
  const deniedPort = new URL(WEB_ORIGIN).port === '65534' ? 65533 : 65534
  const denied = await request('', 'GET', undefined, `http://127.0.0.1:${deniedPort}`)
  assert.equal(denied.status, 403)
  assert.equal(denied.headers.get('access-control-allow-origin'), null)
  assert.equal((await request('', 'POST', {})).status, 405)
  store.update = async () => { throw new Error('fixture disk full with private path') }
  const failed = await request('', 'PATCH', { changes: { [TABS]: '[]' }, expectedRevision: 1 })
  assert.equal(failed.status, 500)
  assert.match((await failed.json()).error, /磁盘空间和文件权限/)
})
