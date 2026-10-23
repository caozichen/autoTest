import assert from 'node:assert/strict'
import test from 'node:test'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRunnerServer } from './server.mjs'
import { RunRecordFileStore } from './run-record-store.mjs'
import { createRunnerResourceSampler } from './runner-resources.mjs'

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'runner-resource-test-'))
  t.after(() => rm(directory, { force: true, recursive: true }))
  const records = new RunRecordFileStore({ directory })
  await records.ensureReady()
  return { directory, records }
}

test('resource endpoint is observation-only, no-store, origin-protected and never loads details', async t => {
  const { directory, records } = await fixture(t)
  records.readDetail = () => { throw new Error('must not read history') }
  const before = records.diagnostics()
  const server = createRunnerServer({ runRecordDirectory: directory, runRecordStore: records, recordMaintenanceIntervalMs: 60_000 })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => server.close())
  const url = `http://127.0.0.1:${server.address().port}/runner/resources`
  const response = await fetch(url)
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store')
  const result = await response.json()
  assert.equal(result.schemaVersion, 1)
  assert.ok(Number.isFinite(Date.parse(result.sampledAt)))
  assert.equal(result.groups.length, 7)
  const metrics = id => new Map(result.groups.find(group => group.id === id).metrics.map(metric => [metric.id, metric.value]))
  assert.equal(metrics('process').get('pid'), process.pid)
  assert.ok(metrics('process').get('rss') > 0)
  assert.ok(metrics('v8').get('heapLimit') > metrics('v8').get('heapUsed'))
  assert.equal(metrics('capacity').get('maxPipelines'), 3)
  assert.equal(metrics('storage').get('cacheEntries'), 0)
  assert.deepEqual(records.diagnostics().cache, before.cache)
  assert.equal((await fetch(url, { headers: { Origin: 'https://untrusted.example' } })).status, 403)
  assert.equal(/password|authorization|argv|token|secret/i.test(JSON.stringify(result)), false)
})

test('unsupported collectors expose unavailable reasons while other groups stay usable', async t => {
  const { directory, records } = await fixture(t)
  const sample = createRunnerResourceSampler({ directory, records, capacity: () => ({}), limits: {},
    v8Source: { getHeapStatistics() { throw new Error('secret failure payload') } },
    diskStat: async () => { throw new Error('secret disk path') } })
  const result = await sample()
  assert.equal(result.groups.find(group => group.id === 'v8').metrics.length, 0)
  assert.ok(result.groups.find(group => group.id === 'v8').unavailableReason)
  assert.ok(result.groups.find(group => group.id === 'disk').unavailableReason)
  assert.equal(result.groups.find(group => group.id === 'process').unavailableReason, null)
  assert.equal(JSON.stringify(result).includes('secret'), false)
})

test('sampling a cold store does not initialize or read history and does not report unindexed counts as zero', async t => {
  const { directory } = await fixture(t)
  const records = new RunRecordFileStore({ directory })
  const result = await createRunnerResourceSampler({ records, directory, capacity: () => ({}), limits: {} })()
  assert.equal(records.readyPromise, null)
  const storage = result.groups.find(group => group.id === 'storage')
  assert.equal(storage.metrics.find(metric => metric.id === 'records').value, null)
  assert.equal(storage.metrics.find(metric => metric.id === 'initialization').value, 'not-started')
})


test('disk sampling stops waiting at its deadline and explains unavailability', async t => {
  const { directory, records } = await fixture(t)
  // A live request keeps Node running while the unref'ed observation deadline expires.
  const keepAlive = setTimeout(() => {}, 1000)
  t.after(() => clearTimeout(keepAlive))
  const started = performance.now()
  const result = await createRunnerResourceSampler({ records, directory, capacity: () => ({}), limits: {}, diskStat: () => new Promise(() => {}) })()
  assert.ok(performance.now() - started < 1000)
  assert.match(result.groups.find(group => group.id === 'disk').unavailableReason, /250 ms/)
})
