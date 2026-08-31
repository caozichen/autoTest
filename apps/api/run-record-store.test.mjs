import assert from 'node:assert/strict'
import * as fileSystem from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  RunRecordFileStore,
  RunRecordStoreError,
} from './run-record-store.mjs'

const firstTime = '2026-08-31T08:00:00.000Z'
const secondTime = '2026-08-31T08:01:00.000Z'

function recordFixture({
  id = 'record-0001',
  revision = 0,
  updatedAt = firstTime,
  status = 'running',
  responseBody = { ok: true },
} = {}) {
  const finished = status !== 'running'
  return {
    schemaVersion: 1,
    revision,
    id,
    displayId: `RUN-${id}`,
    name: '文件持久化测试',
    status,
    trigger: 'manual',
    browser: 'Chromium',
    environment: {
      id: 'env-testing',
      name: '测试环境',
      code: 'TEST',
      apiBaseUrl: 'https://example.test/api',
    },
    startedAt: firstTime,
    updatedAt,
    finishedAt: finished ? updatedAt : null,
    durationMs: finished ? 60_000 : null,
    counts: {
      total: 1,
      passed: status === 'passed' ? 1 : 0,
      failed: status === 'failed' ? 1 : 0,
      skipped: 0,
    },
    scripts: [{
      recordId: `${id}:script-001`,
      id: 'script-001',
      name: '示例脚本',
      directory: 'scripts',
      entryFile: 'example.spec.mjs',
      tags: ['P0'],
      status: status === 'running' ? 'queued' : status === 'passed' ? 'passed' : 'failed',
      durationMs: finished ? 60_000 : null,
      logs: [{ timestamp: updatedAt, level: 'success', message: '脚本日志' }],
      assertions: [{ sequence: 1, status: 'passed', name: '断言' }],
      apiResponses: [{
        sequence: 1,
        timestamp: updatedAt,
        name: '/api/example',
        method: 'GET',
        url: 'https://example.test/api/example',
        status: 200,
        ok: true,
        durationMs: 10,
        responseBody,
      }],
      output: { formCode: 'fixture-code' },
    }],
    logs: [{
      id: `${id}:log-001`,
      timestamp: updatedAt,
      level: 'info',
      scope: 'batch',
      message: '批次日志',
    }],
    analysis: {
      passRate: status === 'passed' ? 100 : 0,
      averageDurationMs: finished ? 60_000 : 0,
      slowestScriptRecordId: finished ? `${id}:script-001` : null,
      logCounts: { info: 1, success: 1, warning: 0, error: 0 },
      failureGroups: [],
    },
  }
}

async function temporaryRecordDirectory(t) {
  const directory = await fileSystem.mkdtemp(join(tmpdir(), 'autotest-run-records-'))
  t.after(() => fileSystem.rm(directory, { recursive: true, force: true }))
  return directory
}

test('persists one JSON file per run and restores full records after restart', async (t) => {
  const directory = await temporaryRecordDirectory(t)
  const original = recordFixture({ responseBody: { data: 'large-response-body' } })
  const firstStore = new RunRecordFileStore({ directory })

  await firstStore.create(original)

  assert.deepEqual(await fileSystem.readdir(directory), ['record-0001.json'])
  const restored = await new RunRecordFileStore({ directory }).get(original.id)
  assert.deepEqual(restored, original)

  const [summary] = await new RunRecordFileStore({ directory }).list()
  assert.deepEqual(summary.logs, [])
  assert.deepEqual(summary.scripts[0].logs, [])
  assert.deepEqual(summary.scripts[0].assertions, [])
  assert.deepEqual(summary.scripts[0].apiResponses, [])
  assert.equal(Object.hasOwn(summary.scripts[0], 'output'), false)
  assert.equal(summary.scripts[0].status, 'queued')
})

test('updates with revision and updatedAt CAS and rejects stale writers', async (t) => {
  const directory = await temporaryRecordDirectory(t)
  const store = new RunRecordFileStore({ directory })
  const original = recordFixture()
  await store.create(original)
  const completed = recordFixture({
    revision: 1,
    updatedAt: secondTime,
    status: 'running',
  })
  completed.scripts[0].status = 'running'

  await store.update(original.id, completed, {
    expectedRevision: 0,
    expectedUpdatedAt: firstTime,
  })

  await assert.rejects(
    store.update(original.id, completed, {
      expectedRevision: 0,
      expectedUpdatedAt: firstTime,
    }),
    (error) => error instanceof RunRecordStoreError && error.statusCode === 409,
  )
  const restored = await new RunRecordFileStore({ directory }).get(original.id)
  assert.deepEqual(restored, completed)
  assert.equal(restored.scripts[0].status, 'running')
})

test('imports localStorage records idempotently without overwriting existing files', async (t) => {
  const directory = await temporaryRecordDirectory(t)
  const store = new RunRecordFileStore({ directory })
  const records = [
    recordFixture({ id: 'record-1001' }),
    recordFixture({ id: 'record-1002' }),
  ]

  const first = await store.migrate(records)
  const second = await store.migrate(records)

  assert.deepEqual(first, {
    importedCount: 2,
    skippedCount: 0,
    importedIds: ['record-1001', 'record-1002'],
    skippedIds: [],
  })
  assert.deepEqual(second, {
    importedCount: 0,
    skippedCount: 2,
    importedIds: [],
    skippedIds: ['record-1001', 'record-1002'],
  })
  assert.equal((await fileSystem.readdir(directory)).filter((name) => name.endsWith('.json')).length, 2)
})

test('keeps the previous record intact when atomic rename fails', async (t) => {
  const directory = await temporaryRecordDirectory(t)
  const original = recordFixture()
  await new RunRecordFileStore({ directory }).create(original)
  const failingFileSystem = {
    ...fileSystem,
    async rename() {
      throw new Error('fixture rename failure')
    },
  }
  const failingStore = new RunRecordFileStore({ directory, fileSystem: failingFileSystem })
  const completed = recordFixture({ revision: 1, updatedAt: secondTime, status: 'passed' })

  await assert.rejects(
    failingStore.update(original.id, completed, {
      expectedRevision: 0,
      expectedUpdatedAt: firstTime,
    }),
    /fixture rename failure/,
  )

  assert.deepEqual(await new RunRecordFileStore({ directory }).get(original.id), original)
  assert.equal((await fileSystem.readdir(directory)).some((name) => name.endsWith('.tmp')), false)
})

test('rejects unsafe record ids before constructing file paths', async (t) => {
  const directory = await temporaryRecordDirectory(t)
  const store = new RunRecordFileStore({ directory })

  await assert.rejects(
    store.create(recordFixture({ id: '../../outside' })),
    (error) => error instanceof RunRecordStoreError && error.statusCode === 400,
  )
  assert.deepEqual(await fileSystem.readdir(directory), [])
})

test('persists stale running records as interrupted without deleting them', async (t) => {
  const directory = await temporaryRecordDirectory(t)
  await new RunRecordFileStore({ directory }).create(recordFixture())
  const recoveredAt = new Date('2026-08-31T13:00:00.000Z')
  const restoredStore = new RunRecordFileStore({
    directory,
    now: () => recoveredAt,
    logIdFactory: () => 'recovery-log-001',
  })

  const [summary] = await restoredStore.list()
  const recovered = await restoredStore.get('record-0001')

  assert.equal(summary.status, 'interrupted')
  assert.deepEqual(recovered, {
    ...recordFixture(),
    revision: 1,
    status: 'interrupted',
    failureStage: 'runner',
    error: '页面或 Runner 在批次完成前中断',
    finishedAt: recoveredAt.toISOString(),
    updatedAt: recoveredAt.toISOString(),
    durationMs: 18_000_000,
    counts: { total: 1, passed: 0, failed: 0, skipped: 1 },
    scripts: [{ ...recordFixture().scripts[0], status: 'skipped' }],
    logs: [
      ...recordFixture().logs,
      {
        id: 'recovery-log-001',
        timestamp: recoveredAt.toISOString(),
        level: 'warning',
        scope: 'runner',
        message: '检测到未正常结束的运行批次，已标记为中断',
      },
    ],
    analysis: {
      passRate: 0,
      averageDurationMs: 0,
      slowestScriptRecordId: null,
      logCounts: { info: 1, success: 0, warning: 1, error: 0 },
      failureGroups: [],
    },
  })
  assert.deepEqual(await fileSystem.readdir(directory), ['record-0001.json'])
})
