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
const fixtureNow = () => new Date('2026-08-31T08:02:00.000Z')

function createTestStore(directory, options = {}) {
  return new RunRecordFileStore({ directory, now: fixtureNow, ...options })
}

function artifactFixture({
  executionId = 'record-0001',
  stepId = 'script-001',
  attemptId = 'attempt-001',
} = {}) {
  return {
    executionId,
    stepId,
    attemptId,
    absolutePath: join(
      '/tmp',
      'autotest-artifacts',
      executionId,
      stepId,
      attemptId,
      'screenshots',
      'failure.png',
    ),
    relativePath: 'screenshots/failure.png',
    type: 'screenshot',
    mimeType: 'image/png',
    sizeBytes: 1024,
    createdAt: secondTime,
  }
}

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
      partial: status === 'partial' ? 1 : 0,
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
      status: status === 'running' ? 'queued' : status === 'passed' || status === 'partial' ? status : 'failed',
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
      resourceResponses: [{
        sequence: 1,
        timestamp: updatedAt,
        name: '/assets/app.js',
        url: 'https://example.test/assets/app.js',
        resourceType: 'script',
        status: 200,
        ok: true,
        durationMs: 5,
        phase: '页面初始化',
        isFirstParty: true,
      }],
      networkSummary: {
        api: { observed: 1, recorded: 1, dropped: 0, passed: 1, failed: 0, warnings: 0 },
        resources: { observed: 1, recorded: 1, dropped: 0, passed: 1, failed: 0, warnings: 0 },
      },
      artifacts: [artifactFixture({ executionId: id })],
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
  const firstStore = createTestStore(directory)

  await firstStore.create(original)

  assert.deepEqual(await fileSystem.readdir(directory), ['record-0001.json'])
  const restored = await createTestStore(directory).get(original.id)
  assert.deepEqual(restored, original)

  const [summary] = await createTestStore(directory).list()
  assert.deepEqual(summary.logs, [])
  assert.deepEqual(summary.scripts[0].logs, [])
  assert.deepEqual(summary.scripts[0].assertions, [])
  assert.deepEqual(summary.scripts[0].apiResponses, [])
  assert.deepEqual(summary.scripts[0].resourceResponses, [])
  assert.deepEqual(summary.scripts[0].networkSummary, original.scripts[0].networkSummary)
  assert.deepEqual(summary.scripts[0].artifacts, [])
  assert.equal(Object.hasOwn(summary.scripts[0], 'output'), false)
  assert.equal(summary.scripts[0].status, 'queued')
})

test('preserves artifact descriptors in details and omits their payload from summaries', async (t) => {
  const directory = await temporaryRecordDirectory(t)
  const original = recordFixture({
    id: 'record-artifacts-0001',
    status: 'passed',
    updatedAt: secondTime,
  })
  const store = createTestStore(directory)

  await store.create(original)

  const restored = await createTestStore(directory).get(original.id)
  const [summary] = await createTestStore(directory).list()
  assert.deepEqual(restored.scripts[0].artifacts, original.scripts[0].artifacts)
  assert.deepEqual(summary.scripts[0].artifacts, [])
})

test('normalizes legacy script records without artifacts to an empty array', async (t) => {
  const directory = await temporaryRecordDirectory(t)
  const legacy = recordFixture({ id: 'record-legacy-0001' })
  delete legacy.scripts[0].artifacts

  const created = await createTestStore(directory).create(legacy)
  const restored = await createTestStore(directory).get(legacy.id)

  assert.deepEqual(created.scripts[0].artifacts, [])
  assert.deepEqual(restored.scripts[0].artifacts, [])
  assert.equal(Object.hasOwn(legacy.scripts[0], 'artifacts'), false)
})

test('normalizes legacy script records without network evidence fields', async (t) => {
  const directory = await temporaryRecordDirectory(t)
  const legacy = recordFixture({ id: 'record-network-legacy-0001' })
  delete legacy.scripts[0].resourceResponses
  delete legacy.scripts[0].networkSummary

  const created = await createTestStore(directory).create(legacy)
  const restored = await createTestStore(directory).get(legacy.id)
  const emptySummary = {
    api: { observed: 0, recorded: 0, dropped: 0, passed: 0, failed: 0, warnings: 0 },
    resources: { observed: 0, recorded: 0, dropped: 0, passed: 0, failed: 0, warnings: 0 },
  }

  assert.deepEqual(created.scripts[0].resourceResponses, [])
  assert.deepEqual(created.scripts[0].networkSummary, emptySummary)
  assert.deepEqual(restored.scripts[0].resourceResponses, [])
  assert.deepEqual(restored.scripts[0].networkSummary, emptySummary)
  assert.equal(Object.hasOwn(legacy.scripts[0], 'resourceResponses'), false)
  assert.equal(Object.hasOwn(legacy.scripts[0], 'networkSummary'), false)
})

test('persists partial script results and exposes their count in summaries', async (t) => {
  const directory = await temporaryRecordDirectory(t)
  const partial = recordFixture({
    id: 'record-partial-0001',
    status: 'partial',
    updatedAt: secondTime,
  })
  const store = createTestStore(directory)

  const created = await store.create(partial)
  const restored = await createTestStore(directory).get(partial.id)
  const [summary] = await createTestStore(directory).list()

  assert.equal(created.status, 'partial')
  assert.equal(created.scripts[0].status, 'partial')
  assert.deepEqual(created.counts, { total: 1, passed: 0, partial: 1, failed: 0, skipped: 0 })
  assert.deepEqual(restored, created)
  assert.equal(summary.status, 'partial')
  assert.equal(summary.scripts[0].status, 'partial')
  assert.deepEqual(summary.counts, created.counts)
})

test('normalizes legacy counts without partial while leaving the source record unchanged', async (t) => {
  const directory = await temporaryRecordDirectory(t)
  const legacy = recordFixture({ id: 'record-counts-legacy-0001' })
  delete legacy.counts.partial

  const created = await createTestStore(directory).create(legacy)
  const restored = await createTestStore(directory).get(legacy.id)

  assert.equal(Object.hasOwn(legacy.counts, 'partial'), false)
  assert.deepEqual(created.counts, { total: 1, passed: 0, failed: 0, skipped: 0, partial: 0 })
  assert.deepEqual(restored.counts, created.counts)
})

test('migrates recognizable legacy assertion failures to partial and recalculates the record', async (t) => {
  const directory = await temporaryRecordDirectory(t)
  const legacy = recordFixture({
    id: 'record-assertion-legacy-0001',
    status: 'failed',
    updatedAt: secondTime,
  })
  delete legacy.counts.partial
  legacy.scripts[0].error = '脚本已执行完成，共有 1 条断言失败'
  legacy.scripts[0].assertions = [
    { sequence: 1, status: 'passed', name: '页面可以提交' },
    { sequence: 2, status: 'failed', name: '结果页内容正确' },
  ]
  legacy.analysis.failureGroups = [{
    reason: legacy.scripts[0].error,
    count: 1,
    scriptRecordIds: [legacy.scripts[0].recordId],
  }]

  await fileSystem.writeFile(
    join(directory, `${legacy.id}.json`),
    `${JSON.stringify(legacy)}\n`,
    'utf8',
  )
  const store = createTestStore(directory)
  const restored = await store.get(legacy.id)
  const [summary] = await store.list()

  assert.equal(restored.status, 'partial')
  assert.equal(restored.scripts[0].status, 'partial')
  assert.deepEqual(restored.counts, { total: 1, passed: 0, partial: 1, failed: 0, skipped: 0 })
  assert.equal(restored.analysis.passRate, 0)
  assert.equal(restored.analysis.averageDurationMs, 60_000)
  assert.equal(restored.analysis.slowestScriptRecordId, `${legacy.id}:script-001`)
  assert.deepEqual(restored.analysis.failureGroups, [])
  assert.equal(summary.status, 'partial')
  assert.equal(summary.scripts[0].status, 'partial')
  assert.deepEqual(summary.counts, restored.counts)
  assert.equal(legacy.status, 'failed')
  assert.equal(legacy.scripts[0].status, 'failed')
})

test('keeps runtime and timeout failures hard and makes them dominate terminal batch status', async (t) => {
  const directory = await temporaryRecordDirectory(t)
  const hardFailure = recordFixture({
    id: 'record-hard-failure-0001',
    status: 'partial',
    updatedAt: secondTime,
  })
  hardFailure.scripts[0].status = 'passed'
  hardFailure.scripts[0].error = undefined
  hardFailure.scripts.push({
    ...structuredClone(hardFailure.scripts[0]),
    recordId: `${hardFailure.id}:script-002`,
    id: 'script-002',
    name: '运行时异常脚本',
    status: 'failed',
    error: '页面控件不存在',
    artifacts: [],
  }, {
    ...structuredClone(hardFailure.scripts[0]),
    recordId: `${hardFailure.id}:script-003`,
    id: 'script-003',
    name: '超时脚本',
    status: 'failed',
    error: '脚本执行超过 300000 ms，已自动终止',
    artifacts: [],
  })
  hardFailure.counts = { total: 3, passed: 1, partial: 0, failed: 2, skipped: 0 }

  const created = await createTestStore(directory).create(hardFailure)

  assert.equal(created.status, 'failed')
  assert.deepEqual(created.scripts.map(({ status }) => status), ['passed', 'failed', 'failed'])
  assert.deepEqual(created.counts, hardFailure.counts)
})

test('treats skipped work as a blocked failed batch even when another script is partial', async (t) => {
  const directory = await temporaryRecordDirectory(t)
  const blocked = recordFixture({
    id: 'record-partial-blocked-0001',
    status: 'partial',
    updatedAt: secondTime,
  })
  blocked.scripts[0].status = 'partial'
  blocked.scripts.push({
    ...structuredClone(blocked.scripts[0]),
    recordId: `${blocked.id}:script-002`,
    id: 'script-002',
    name: '被阻断脚本',
    status: 'skipped',
    durationMs: null,
    error: '前序步骤阻断，未执行',
    artifacts: [],
  })
  blocked.counts = { total: 2, passed: 0, partial: 1, failed: 0, skipped: 1 }

  const created = await createTestStore(directory).create(blocked)

  assert.equal(created.status, 'failed')
  assert.deepEqual(created.counts, blocked.counts)
})

test('rejects invalid partial counts', async (t) => {
  const directory = await temporaryRecordDirectory(t)
  const record = recordFixture({ id: 'record-counts-invalid-0001' })
  record.counts.partial = -1

  await assert.rejects(
    createTestStore(directory).create(record),
    (error) => error instanceof RunRecordStoreError && /counts\.partial/.test(error.message),
  )
})

test('rejects inconsistent network summary counters', async (t) => {
  const directory = await temporaryRecordDirectory(t)
  const record = recordFixture({ id: 'record-network-invalid-0001' })
  record.scripts[0].networkSummary.api.dropped = 1

  await assert.rejects(
    createTestStore(directory).create(record),
    (error) => error instanceof RunRecordStoreError && /统计不一致/.test(error.message),
  )
})

test('atomically merges runner artifacts into running or completed script records', async (t) => {
  const directory = await temporaryRecordDirectory(t)
  const original = recordFixture({ id: 'record-merge-0001' })
  original.scripts[0].artifacts = []
  const store = createTestStore(directory)
  await store.create(original)
  const artifact = artifactFixture({
    executionId: original.id,
    stepId: original.scripts[0].id,
    attemptId: 'attempt-002',
  })

  const merged = await store.mergeScriptArtifacts(original.id, original.scripts[0].id, [artifact])
  const repeated = await store.mergeScriptArtifacts(original.id, original.scripts[0].id, [artifact])

  assert.equal(merged.revision, 1)
  assert.equal(merged.updatedAt, fixtureNow().toISOString())
  assert.deepEqual(merged.scripts[0].artifacts, [artifact])
  assert.equal(repeated.revision, 1)
  assert.deepEqual((await createTestStore(directory).get(original.id)).scripts[0].artifacts, [artifact])
})

test('rejects malformed artifact descriptors', async (t) => {
  const directory = await temporaryRecordDirectory(t)
  const store = createTestStore(directory)
  const invalidArtifacts = [
    { label: 'array', value: {} },
    { label: 'scope', value: [{ ...artifactFixture(), executionId: '../escape' }] },
    { label: 'record identity', value: [{ ...artifactFixture(), executionId: 'record-other' }] },
    { label: 'script identity', value: [{ ...artifactFixture(), stepId: 'script-other' }] },
    { label: 'absolute path', value: [{ ...artifactFixture(), absolutePath: 'relative/failure.png' }] },
    { label: 'absolute scope', value: [{
      ...artifactFixture(),
      absolutePath: '/tmp/autotest-artifacts/record-0001/script-other/attempt-001/screenshots/failure.png',
    }] },
    { label: 'relative path', value: [{ ...artifactFixture(), relativePath: '../failure.png' }] },
    { label: 'type', value: [{ ...artifactFixture(), type: 'screen/shot' }] },
    { label: 'mime type', value: [{ ...artifactFixture(), mimeType: 'image/png\ninvalid' }] },
    { label: 'size', value: [{ ...artifactFixture(), sizeBytes: -1 }] },
    { label: 'unsafe size', value: [{ ...artifactFixture(), sizeBytes: Number.MAX_SAFE_INTEGER + 1 }] },
    { label: 'created time', value: [{ ...artifactFixture(), createdAt: 'not-a-date' }] },
  ]

  for (const invalid of invalidArtifacts) {
    const record = recordFixture()
    record.scripts[0].artifacts = invalid.value
    await assert.rejects(
      store.create(record),
      (error) => error instanceof RunRecordStoreError,
      invalid.label,
    )
  }
})

test('updates with revision and updatedAt CAS and rejects stale writers', async (t) => {
  const directory = await temporaryRecordDirectory(t)
  const store = createTestStore(directory)
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
  const restored = await createTestStore(directory).get(original.id)
  assert.deepEqual(restored, completed)
  assert.equal(restored.scripts[0].status, 'running')
})

test('imports localStorage records idempotently without overwriting existing files', async (t) => {
  const directory = await temporaryRecordDirectory(t)
  const store = createTestStore(directory)
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
  await createTestStore(directory).create(original)
  const failingFileSystem = {
    ...fileSystem,
    async rename() {
      throw new Error('fixture rename failure')
    },
  }
  const failingStore = createTestStore(directory, { fileSystem: failingFileSystem })
  const completed = recordFixture({ revision: 1, updatedAt: secondTime, status: 'passed' })

  await assert.rejects(
    failingStore.update(original.id, completed, {
      expectedRevision: 0,
      expectedUpdatedAt: firstTime,
    }),
    /fixture rename failure/,
  )

  assert.deepEqual(await createTestStore(directory).get(original.id), original)
  assert.equal((await fileSystem.readdir(directory)).some((name) => name.endsWith('.tmp')), false)
})

test('rejects unsafe record ids before constructing file paths', async (t) => {
  const directory = await temporaryRecordDirectory(t)
  const store = createTestStore(directory)

  await assert.rejects(
    store.create(recordFixture({ id: '../../outside' })),
    (error) => error instanceof RunRecordStoreError && error.statusCode === 400,
  )
  assert.deepEqual(await fileSystem.readdir(directory), [])
})

test('persists stale running records as interrupted without deleting them', async (t) => {
  const directory = await temporaryRecordDirectory(t)
  await createTestStore(directory).create(recordFixture())
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
    counts: { total: 1, passed: 0, partial: 0, failed: 0, skipped: 1 },
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

test('preserves partial results when recovering stale records and includes them in analysis', async (t) => {
  const directory = await temporaryRecordDirectory(t)
  const running = recordFixture({ id: 'record-stale-partial-0001' })
  running.scripts[0].status = 'partial'
  running.scripts[0].durationMs = 2_500
  running.scripts.push({
    ...structuredClone(running.scripts[0]),
    recordId: `${running.id}:script-002`,
    id: 'script-002',
    name: '排队脚本',
    status: 'queued',
    durationMs: null,
    logs: [],
    assertions: [],
    apiResponses: [],
    resourceResponses: [],
    networkSummary: {
      api: { observed: 0, recorded: 0, dropped: 0, passed: 0, failed: 0, warnings: 0 },
      resources: { observed: 0, recorded: 0, dropped: 0, passed: 0, failed: 0, warnings: 0 },
    },
    artifacts: [],
  })
  running.counts = { total: 2, passed: 0, partial: 1, failed: 0, skipped: 0 }
  await createTestStore(directory).create(running)
  const recoveredAt = new Date('2026-08-31T13:00:00.000Z')

  const recovered = await new RunRecordFileStore({
    directory,
    now: () => recoveredAt,
    logIdFactory: () => 'recovery-log-partial-001',
  }).get(running.id)

  assert.equal(recovered.status, 'interrupted')
  assert.deepEqual(recovered.scripts.map(({ status }) => status), ['partial', 'skipped'])
  assert.deepEqual(recovered.counts, { total: 2, passed: 0, partial: 1, failed: 0, skipped: 1 })
  assert.deepEqual(recovered.analysis, {
    passRate: 0,
    averageDurationMs: 2_500,
    slowestScriptRecordId: `${running.id}:script-001`,
    logCounts: { info: 1, success: 0, warning: 1, error: 0 },
    failureGroups: [],
  })
})

test('persists a fatal pipeline result without a frontend and does not overwrite a terminal record', async t => {
  const directory = await temporaryRecordDirectory(t)
  const store = createTestStore(directory)
  const record = recordFixture({ status: 'running' })
  record.scripts[0].status = 'running'
  record.scripts.push({ ...structuredClone(record.scripts[0]), id: 'script-next', recordId: 'record-0001:script-next', status: 'queued', artifacts: [] })
  await store.create(record)
  const result = { status: 'failed', timedOut: true, durationMs: 600000, error: '读取响应体超时', logs: [], assertions: [{ sequence: 1, name: '失败证据', status: 'failed' }] }
  const finished = await store.failPipelineStep(record.id, 'script-001', result)
  assert.equal(finished.status, 'failed')
  assert.deepEqual(finished.scripts.map(s => s.status), ['failed', 'skipped'])
  assert.equal(finished.scripts[0].assertions.length, 1)
  assert.ok(finished.finishedAt)
  assert.deepEqual(await createTestStore(directory).get(record.id), finished)
  assert.deepEqual(await store.failPipelineStep(record.id, 'script-001', result), finished)
})

test('Runner presence protects a silent long-running script and persists its heartbeat', async t => {
  const directory = await temporaryRecordDirectory(t)
  let now = new Date(firstTime)
  const store = createTestStore(directory, { now: () => now })
  const record = recordFixture()
  await store.create(record)
  store.setRunnerActivityProvider(() => [{ executionId: record.id, settled: false }])
  await store.startRunnerStep(record.id, 'script-001')
  now = new Date(now.getTime() + 5 * 60 * 60 * 1000)
  const active = await store.get(record.id)
  assert.equal(active.status, 'running')
  assert.equal(active.scripts[0].status, 'running')
  assert.equal(active.runnerTracking.lastSeenAt, now.toISOString())
  assert.equal((await createTestStore(directory, { now: () => now }).get(record.id)).status, 'running')
})

test('saved results survive refresh/restart and the grace period allows frontend finalization', async t => {
  const directory = await temporaryRecordDirectory(t)
  let now = new Date(firstTime)
  const store = createTestStore(directory, { now: () => now })
  const record = recordFixture()
  await store.create(record)
  store.setRunnerActivityProvider(() => [])
  await store.startRunnerStep(record.id, 'script-001')
  const saved = await store.saveRunnerStepResult(record.id, 'script-001', {
    status: 'partial', ok: false, durationMs: 1200, logs: [],
    assertions: [{ sequence: 1, name: '未通过断言', status: 'failed' }],
    result: { formId: 'created-form' },
  })
  assert.equal(saved.status, 'running')
  assert.equal(saved.counts.partial, 1)
  assert.equal(saved.scripts[0].output.formId, 'created-form')
  assert.deepEqual(await store.saveRunnerStepResult(record.id, 'script-001', { status: 'passed' }), saved)
  const restarted = createTestStore(directory, { now: () => now })
  restarted.setRunnerActivityProvider(() => [])
  now = new Date(now.getTime() + 119_000)
  assert.equal((await restarted.get(record.id)).status, 'running')
  now = new Date(now.getTime() + 2_000)
  const recovered = await restarted.get(record.id)
  assert.equal(recovered.status, 'partial')
  assert.equal(recovered.counts.partial, 1)
  assert.equal(recovered.scripts[0].assertions[0].status, 'failed')
  assert.ok(recovered.finishedAt)
})

test('lost executions are interrupted without changing completed steps or rerunning pending work', async t => {
  const directory = await temporaryRecordDirectory(t)
  let now = new Date(firstTime)
  const store = createTestStore(directory, { now: () => now })
  const record = recordFixture()
  record.scripts.push({ ...structuredClone(record.scripts[0]), id: 'script-002', recordId: `${record.id}:script-002`, artifacts: [] })
  await store.create(record)
  store.setRunnerActivityProvider(() => [])
  await store.startRunnerStep(record.id, 'script-001')
  await store.saveRunnerStepResult(record.id, 'script-001', { status: 'passed', ok: true, durationMs: 12, logs: [] })
  await store.startRunnerStep(record.id, 'script-002')
  now = new Date(now.getTime() + 121_000)
  const stopped = await store.get(record.id)
  assert.equal(stopped.status, 'interrupted')
  assert.deepEqual(stopped.scripts.map(s => s.status), ['passed', 'skipped'])
  assert.match(stopped.scripts[1].error, /结果未确认/)
  assert.match(stopped.error, /人工核对/)
  assert.deepEqual(await store.saveRunnerStepResult(record.id, 'script-002', { status: 'passed' }), null)
  assert.equal((await store.get(record.id)).status, 'interrupted')
})

test('frontend progress cannot regress Runner results but can report variable-validation failure', async t => {
  const store = createTestStore(await temporaryRecordDirectory(t))
  const record = recordFixture()
  await store.create(record)
  const saved = await store.saveRunnerStepResult(record.id, 'script-001', { status: 'passed', ok: true, logs: [], durationMs: 50 })
  const progress = structuredClone(saved)
  delete progress.runnerTracking
  progress.revision += 1
  progress.scripts[0].status = 'running'
  const updated = await store.update(record.id, progress, { expectedRevision: saved.revision, expectedUpdatedAt: saved.updatedAt })
  assert.equal(updated.scripts[0].status, 'passed')
  assert.deepEqual(updated.runnerTracking.completedScriptIds, ['script-001'])
  const failure = structuredClone(updated)
  failure.revision += 1
  failure.status = 'failed'
  failure.scripts[0].status = 'failed'
  failure.scripts[0].error = '必需变量未提取'
  const failed = await store.update(record.id, failure, { expectedRevision: updated.revision, expectedUpdatedAt: updated.updatedAt })
  assert.equal(failed.status, 'failed')
  assert.equal(failed.scripts[0].error, '必需变量未提取')
})
