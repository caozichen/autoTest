import { randomUUID } from 'node:crypto'
import * as defaultFileSystem from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

export const SAFE_RUN_RECORD_ID_PATTERN = /^[a-zA-Z0-9_-]{8,100}$/

const RUN_RECORD_STATUSES = new Set(['running', 'passed', 'failed', 'partial', 'interrupted'])
const RUN_SCRIPT_STATUSES = new Set(['queued', 'running', 'passed', 'partial', 'failed', 'skipped'])
const DEFAULT_STALE_AFTER_MS = 4 * 60 * 60 * 1_000
const ARTIFACT_SCOPE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/
const ARTIFACT_TYPE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,99}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/
const LEGACY_ASSERTION_FAILURE_PATTERN = /^脚本已执行完成，共有 \d+ 条断言失败$/

export class RunRecordStoreError extends Error {
  constructor(message, { statusCode = 400, code = 'INVALID_RUN_RECORD' } = {}) {
    super(message)
    this.name = 'RunRecordStoreError'
    this.statusCode = statusCode
    this.code = code
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function assertString(value, label, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    throw new RunRecordStoreError(`${label}必须是${allowEmpty ? '' : '非空'}字符串`)
  }
  return value
}

function assertDateString(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return value
  assertString(value, label)
  if (!Number.isFinite(Date.parse(value))) {
    throw new RunRecordStoreError(`${label}不是有效时间`)
  }
  return value
}

function assertNonNegativeNumberOrNull(value, label) {
  if (value === null) return
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RunRecordStoreError(`${label}必须是非负数或 null`)
  }
}

function assertCount(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new RunRecordStoreError(`${label}必须是非负整数`)
  }
}

function emptyNetworkSummary() {
  return {
    api: { observed: 0, recorded: 0, dropped: 0, passed: 0, failed: 0, warnings: 0 },
    resources: { observed: 0, recorded: 0, dropped: 0, passed: 0, failed: 0, warnings: 0 },
  }
}

function validateNetworkStats(stats, label) {
  if (!isObject(stats)) throw new RunRecordStoreError(`${label}必须是对象`)
  for (const key of ['observed', 'recorded', 'dropped', 'passed', 'failed', 'warnings']) {
    assertCount(stats[key], `${label}.${key}`)
  }
  if (stats.recorded > stats.observed || stats.dropped !== stats.observed - stats.recorded) {
    throw new RunRecordStoreError(`${label}的 observed、recorded、dropped 统计不一致`)
  }
  if (stats.passed + stats.failed + stats.warnings !== stats.observed) {
    throw new RunRecordStoreError(`${label}的健康状态统计与 observed 不一致`)
  }
}

function validateNetworkSummary(summary, label) {
  if (!isObject(summary)) throw new RunRecordStoreError(`${label}必须是对象`)
  validateNetworkStats(summary.api, `${label}.api`)
  validateNetworkStats(summary.resources, `${label}.resources`)
}

export function assertSafeRunRecordId(value) {
  if (typeof value !== 'string' || !SAFE_RUN_RECORD_ID_PATTERN.test(value)) {
    throw new RunRecordStoreError('运行记录 ID 格式无效')
  }
  return value
}

function validateArtifact(artifact, scriptIndex, artifactIndex, recordId, scriptId) {
  const label = `scripts[${scriptIndex}].artifacts[${artifactIndex}]`
  if (!isObject(artifact)) throw new RunRecordStoreError(`${label}必须是对象`)

  for (const key of ['executionId', 'stepId', 'attemptId']) {
    if (typeof artifact[key] !== 'string' || !ARTIFACT_SCOPE_ID_PATTERN.test(artifact[key])) {
      throw new RunRecordStoreError(`${label}.${key}格式无效`)
    }
  }
  if (artifact.executionId !== recordId) {
    throw new RunRecordStoreError(`${label}.executionId与运行记录 ID 不一致`)
  }
  if (artifact.stepId !== scriptId) {
    throw new RunRecordStoreError(`${label}.stepId与脚本 ID 不一致`)
  }

  assertString(artifact.absolutePath, `${label}.absolutePath`)
  const windowsAbsolutePath = /^[a-zA-Z]:[\\/]/.test(artifact.absolutePath)
    || artifact.absolutePath.startsWith('\\\\')
  if (
    CONTROL_CHARACTER_PATTERN.test(artifact.absolutePath)
    || (!isAbsolute(artifact.absolutePath) && !windowsAbsolutePath)
  ) {
    throw new RunRecordStoreError(`${label}.absolutePath必须是绝对路径且不能包含控制字符`)
  }

  assertString(artifact.relativePath, `${label}.relativePath`)
  const relativeSegments = artifact.relativePath.split('/')
  if (
    CONTROL_CHARACTER_PATTERN.test(artifact.relativePath)
    || artifact.relativePath.includes('\\')
    || isAbsolute(artifact.relativePath)
    || artifact.relativePath.startsWith('//')
    || /^[a-zA-Z]:/.test(artifact.relativePath)
    || relativeSegments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new RunRecordStoreError(`${label}.relativePath格式无效`)
  }
  const expectedPathSuffix = `/${artifact.executionId}/${artifact.stepId}/${artifact.attemptId}/${artifact.relativePath}`
  if (!artifact.absolutePath.replaceAll('\\', '/').endsWith(expectedPathSuffix)) {
    throw new RunRecordStoreError(`${label}.absolutePath与制品归属范围不一致`)
  }

  if (typeof artifact.type !== 'string' || !ARTIFACT_TYPE_PATTERN.test(artifact.type)) {
    throw new RunRecordStoreError(`${label}.type格式无效`)
  }
  if (
    typeof artifact.mimeType !== 'string'
    || !artifact.mimeType.trim()
    || artifact.mimeType.length > 200
    || CONTROL_CHARACTER_PATTERN.test(artifact.mimeType)
  ) {
    throw new RunRecordStoreError(`${label}.mimeType格式无效`)
  }
  if (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes < 0) {
    throw new RunRecordStoreError(`${label}.sizeBytes必须是非负整数`)
  }
  assertDateString(artifact.createdAt, `${label}.createdAt`)
}

function validateScript(script, index, recordId) {
  const label = `scripts[${index}]`
  if (!isObject(script)) throw new RunRecordStoreError(`${label}必须是对象`)
  assertString(script.recordId, `${label}.recordId`)
  assertString(script.id, `${label}.id`)
  assertString(script.name, `${label}.name`)
  assertString(script.directory, `${label}.directory`, { allowEmpty: true })
  assertString(script.entryFile, `${label}.entryFile`)
  if (!Array.isArray(script.tags) || script.tags.some((tag) => typeof tag !== 'string')) {
    throw new RunRecordStoreError(`${label}.tags必须是字符串数组`)
  }
  if (!RUN_SCRIPT_STATUSES.has(script.status)) {
    throw new RunRecordStoreError(`${label}.status无效`)
  }
  assertNonNegativeNumberOrNull(script.durationMs, `${label}.durationMs`)
  for (const key of ['logs', 'assertions', 'apiResponses']) {
    if (!Array.isArray(script[key])) throw new RunRecordStoreError(`${label}.${key}必须是数组`)
  }
  if (script.resourceResponses !== undefined && !Array.isArray(script.resourceResponses)) {
    throw new RunRecordStoreError(`${label}.resourceResponses必须是数组`)
  }
  if (script.networkSummary !== undefined) {
    validateNetworkSummary(script.networkSummary, `${label}.networkSummary`)
  }
  if (script.artifacts !== undefined) {
    if (!Array.isArray(script.artifacts)) {
      throw new RunRecordStoreError(`${label}.artifacts必须是数组`)
    }
    script.artifacts.forEach((artifact, artifactIndex) => (
      validateArtifact(artifact, index, artifactIndex, recordId, script.id)
    ))
  }
  if (script.error !== undefined && typeof script.error !== 'string') {
    throw new RunRecordStoreError(`${label}.error必须是字符串`)
  }
}

function validateEnvironment(environment) {
  if (!isObject(environment)) throw new RunRecordStoreError('environment必须是对象')
  assertString(environment.id, 'environment.id')
  assertString(environment.name, 'environment.name')
  assertString(environment.code, 'environment.code')
  assertString(environment.apiBaseUrl, 'environment.apiBaseUrl')
}

function validateCounts(counts) {
  if (!isObject(counts)) throw new RunRecordStoreError('counts必须是对象')
  for (const key of ['total', 'passed', 'failed', 'skipped']) assertCount(counts[key], `counts.${key}`)
  if (counts.partial !== undefined) assertCount(counts.partial, 'counts.partial')
}

export function validateRunRecord(value) {
  if (!isObject(value)) throw new RunRecordStoreError('运行记录必须是对象')
  if (value.schemaVersion !== 1) throw new RunRecordStoreError('运行记录 schemaVersion 无效')
  assertSafeRunRecordId(value.id)
  if (!Number.isInteger(value.revision) || value.revision < 0) {
    throw new RunRecordStoreError('运行记录 revision 必须是非负整数')
  }
  assertString(value.displayId, 'displayId')
  assertString(value.name, 'name')
  if (!RUN_RECORD_STATUSES.has(value.status)) throw new RunRecordStoreError('运行记录 status 无效')
  assertString(value.trigger, 'trigger')
  assertString(value.browser, 'browser')
  validateEnvironment(value.environment)
  assertDateString(value.startedAt, 'startedAt')
  assertDateString(value.updatedAt, 'updatedAt')
  assertDateString(value.finishedAt, 'finishedAt', { nullable: true })
  assertNonNegativeNumberOrNull(value.durationMs, 'durationMs')
  if (value.error !== undefined && typeof value.error !== 'string') {
    throw new RunRecordStoreError('error必须是字符串')
  }
  if (!Array.isArray(value.scripts) || value.scripts.length === 0) {
    throw new RunRecordStoreError('scripts必须是非空数组')
  }
  value.scripts.forEach((script, index) => validateScript(script, index, value.id))
  if (!Array.isArray(value.logs)) throw new RunRecordStoreError('logs必须是数组')
  validateCounts(value.counts)
  if (!isObject(value.analysis)) throw new RunRecordStoreError('analysis必须是对象')

  try {
    const record = JSON.parse(JSON.stringify(value))
    let migratedLegacyAssertionFailure = false
    for (const script of record.scripts) {
      if (
        script.status === 'failed'
        && typeof script.error === 'string'
        && LEGACY_ASSERTION_FAILURE_PATTERN.test(script.error.trim())
      ) {
        script.status = 'partial'
        migratedLegacyAssertionFailure = true
      }
      script.resourceResponses ??= []
      script.networkSummary ??= emptyNetworkSummary()
      script.artifacts ??= []
    }
    record.counts = recoveredCounts(record.scripts)
    if (record.status !== 'running' && record.status !== 'interrupted') {
      record.status = recoveredTerminalStatus(record.scripts)
    }
    if (migratedLegacyAssertionFailure) {
      record.analysis = recoveredAnalysis(record.scripts, record.logs)
    }
    return record
  } catch {
    throw new RunRecordStoreError('运行记录必须可以序列化为 JSON')
  }
}

function runScriptSummary(script) {
  return {
    recordId: script.recordId,
    id: script.id,
    name: script.name,
    directory: script.directory,
    entryFile: script.entryFile,
    tags: [...script.tags],
    status: script.status,
    durationMs: script.durationMs,
    logs: [],
    assertions: [],
    apiResponses: [],
    resourceResponses: [],
    networkSummary: structuredClone(script.networkSummary),
    artifacts: [],
    ...(script.error ? { error: script.error } : {}),
  }
}

export function runRecordSummary(record) {
  return {
    schemaVersion: record.schemaVersion,
    revision: record.revision,
    id: record.id,
    displayId: record.displayId,
    name: record.name,
    status: record.status,
    trigger: record.trigger,
    browser: record.browser,
    environment: structuredClone(record.environment),
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    finishedAt: record.finishedAt,
    durationMs: record.durationMs,
    ...(record.failureStage ? { failureStage: record.failureStage } : {}),
    ...(record.error ? { error: record.error } : {}),
    ...(record.execution ? { execution: structuredClone(record.execution) } : {}),
    counts: structuredClone(record.counts),
    scripts: record.scripts.map(runScriptSummary),
    logs: [],
    analysis: structuredClone(record.analysis),
  }
}

function newestFirst(left, right) {
  const timeDifference = Date.parse(right.startedAt) - Date.parse(left.startedAt)
  return timeDifference || right.id.localeCompare(left.id)
}

function durationBetween(startedAt, finishedAt) {
  const duration = Date.parse(finishedAt) - Date.parse(startedAt)
  return Number.isFinite(duration) ? Math.max(0, duration) : 0
}

function recoveredCounts(scripts) {
  return {
    total: scripts.length,
    passed: scripts.filter((script) => script.status === 'passed').length,
    partial: scripts.filter((script) => script.status === 'partial').length,
    failed: scripts.filter((script) => script.status === 'failed').length,
    skipped: scripts.filter((script) => script.status === 'skipped').length,
  }
}

function recoveredTerminalStatus(scripts) {
  if (scripts.some((script) => (
    script.status === 'queued'
    || script.status === 'running'
    || script.status === 'failed'
    || script.status === 'skipped'
  ))) return 'failed'
  if (scripts.some((script) => script.status === 'partial')) return 'partial'
  return scripts.every((script) => script.status === 'passed') ? 'passed' : 'failed'
}

function recoveredAnalysis(scripts, logs) {
  const completed = scripts.filter((script) => (
    script.status === 'passed' || script.status === 'partial' || script.status === 'failed'
  ))
  const durations = completed.map((script) => script.durationMs ?? 0)
  const slowest = [...completed].sort((left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0))[0]
  const failureMap = new Map()
  for (const script of scripts.filter((item) => item.status === 'failed')) {
    const reason = script.error?.trim() || '脚本断言未通过'
    failureMap.set(reason, [...(failureMap.get(reason) ?? []), script.recordId])
  }
  const logCounts = { info: 0, success: 0, warning: 0, error: 0 }
  for (const log of logs) {
    if (Object.hasOwn(logCounts, log.level)) logCounts[log.level] += 1
  }
  return {
    passRate: completed.length === 0
      ? 0
      : Math.round((scripts.filter((script) => script.status === 'passed').length / completed.length) * 1000) / 10,
    averageDurationMs: durations.length === 0
      ? 0
      : Math.round(durations.reduce((total, duration) => total + duration, 0) / durations.length),
    slowestScriptRecordId: slowest?.recordId ?? null,
    logCounts,
    failureGroups: [...failureMap.entries()].map(([reason, scriptRecordIds]) => ({
      reason,
      count: scriptRecordIds.length,
      scriptRecordIds,
    })),
  }
}

export class RunRecordFileStore {
  constructor({
    directory,
    fileSystem = defaultFileSystem,
    temporaryIdFactory = randomUUID,
    logIdFactory = randomUUID,
    now = () => new Date(),
    staleAfterMs = DEFAULT_STALE_AFTER_MS,
    warningLogger = (message) => console.warn(message),
  }) {
    if (typeof directory !== 'string' || !directory) {
      throw new Error('RunRecordFileStore 需要存储目录')
    }
    this.directory = directory
    this.fileSystem = fileSystem
    this.temporaryIdFactory = temporaryIdFactory
    this.logIdFactory = logIdFactory
    this.now = now
    this.staleAfterMs = staleAfterMs
    this.warningLogger = warningLogger
    this.runnerActivityProvider = null
    this.runnerRecoveryGraceMs = 120_000
    this.runnerStartedAt = this.now().getTime()
    this.records = new Map()
    this.readyPromise = null
    this.mutationTail = Promise.resolve()
  }

  async listActiveRunnerPipelines() {
    // Read committed in-memory state without queuing behind a slow result write.
    // The coordinator's live reservation covers admissions and pending writes.
    await this.ensureReady()
    return [...this.records.values()].filter(record => record.status === 'running' && record.execution?.kind === 'pipeline')
      .map(runRecordSummary)
  }

  async list() {
    return this.mutate(async () => {
      await this.recoverStaleRecords()
      return [...this.records.values()]
        .sort(newestFirst)
        .map((record) => runRecordSummary(record))
    })
  }

  async get(id) {
    assertSafeRunRecordId(id)
    return this.mutate(async () => {
      await this.recoverStaleRecords()
      const record = this.records.get(id)
      return record ? structuredClone(record) : null
    })
  }

  async create(value) {
    const record = validateRunRecord(value)
    return this.mutate(async () => {
      if (this.records.has(record.id)) {
        throw new RunRecordStoreError('运行记录 ID 已存在', {
          statusCode: 409,
          code: 'RUN_RECORD_EXISTS',
        })
      }
      await this.writeRecord(record)
      return structuredClone(record)
    })
  }

  async update(id, value, { expectedRevision, expectedUpdatedAt }) {
    assertSafeRunRecordId(id)
    const record = validateRunRecord(value)
    if (record.id !== id) throw new RunRecordStoreError('URL 与记录中的 ID 不一致')
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new RunRecordStoreError('expectedRevision 必须是非负整数')
    }
    assertDateString(expectedUpdatedAt, 'expectedUpdatedAt')
    if (record.revision !== expectedRevision + 1) {
      throw new RunRecordStoreError('新记录 revision 必须在期望版本基础上递增 1')
    }

    return this.mutate(async () => {
      const current = this.records.get(id)
      if (!current) {
        throw new RunRecordStoreError('运行记录不存在', {
          statusCode: 404,
          code: 'RUN_RECORD_NOT_FOUND',
        })
      }
      if (current.execution?.kind === 'pipeline') {
        throw new RunRecordStoreError('该批次由 Runner 管理，请通过执行控制接口操作', { statusCode: 409, code: 'RUNNER_OWNED_RECORD' })
      }
      if (current.revision !== expectedRevision || current.updatedAt !== expectedUpdatedAt) {
        throw new RunRecordStoreError('运行记录已在其它页面更新，请刷新后重试', {
          statusCode: 409,
          code: 'RUN_RECORD_CONFLICT',
        })
      }
      // Runner metadata is authoritative and is not part of the frontend schema.
      if (current.runnerTracking) record.runnerTracking = structuredClone(current.runnerTracking)
      else delete record.runnerTracking
      let restoredRunnerResult = false
      record.scripts = record.scripts.map((script) => {
        const previous = current.scripts.find((item) => item.id === script.id)
        if (previous && current.runnerTracking?.completedScriptIds?.includes(script.id)
          && ['queued', 'running'].includes(script.status)) {
          restoredRunnerResult = true
          return structuredClone(previous)
        }
        return script
      })
      if (restoredRunnerResult) {
        record.logs = [...record.logs.filter((log) => log.scope !== 'script'), ...record.scripts.flatMap((script) => script.logs)]
        record.counts = recoveredCounts(record.scripts)
        record.analysis = recoveredAnalysis(record.scripts, record.logs)
      }
      await this.writeRecord(record)
      return structuredClone(record)
    })
  }

  async migrate(values) {
    if (!Array.isArray(values)) throw new RunRecordStoreError('records必须是数组')
    const records = values.map(validateRunRecord)
    return this.mutate(async () => {
      const importedIds = []
      const skippedIds = []
      for (const record of records) {
        if (this.records.has(record.id)) {
          skippedIds.push(record.id)
          continue
        }
        await this.writeRecord(record)
        importedIds.push(record.id)
      }
      return {
        importedCount: importedIds.length,
        skippedCount: skippedIds.length,
        importedIds,
        skippedIds,
      }
    })
  }

  setRunnerActivityProvider(provider, { graceMs = 120_000 } = {}) {
    this.runnerActivityProvider = provider
    this.runnerRecoveryGraceMs = graceMs
    this.runnerStartedAt = this.now().getTime()
  }

  async maintainRunnerRecords() {
    return this.mutate(() => this.recoverStaleRecords())
  }

  async startRunnerStep(recordId, scriptId) {
    return this.mutate(async () => {
      const source = this.records.get(recordId)
      if (!source || source.status !== 'running') return null
      const record = structuredClone(source)
      const script = record.scripts.find((item) => item.id === scriptId)
      if (!script) return null
      const timestamp = this.now().toISOString()
      script.status = 'running'
      record.runnerTracking = { ...record.runnerTracking, lastSeenAt: timestamp }
      record.updatedAt = timestamp
      record.revision += 1
      record.counts = recoveredCounts(record.scripts)
      await this.writeRecord(record)
      return structuredClone(record)
    })
  }

  // Results are already redacted by the server. Keep the batch open for frontend
  // variable extraction/validation; reconciliation finalizes it only after a grace period.
  async saveRunnerStepResult(recordId, scriptId, result, { replace = false } = {}) {
    return this.mutate(async () => {
      const source = this.records.get(recordId)
      if (!source || source.status !== 'running') return null
      if (!replace && source.runnerTracking?.completedScriptIds?.includes(scriptId)) return structuredClone(source)
      const record = structuredClone(source)
      const script = record.scripts.find((item) => item.id === scriptId)
      if (!script) return null
      const timestamp = this.now().toISOString()
      const interrupted = result.status === 'interrupted' || result.cancelled === true
      script.status = interrupted ? 'skipped' : result.timedOut ? 'failed'
        : ['passed', 'partial', 'failed'].includes(result.status) ? result.status
          : result.ok ? 'passed' : 'failed'
      script.durationMs = result.durationMs ?? 0
      script.logs = (result.logs ?? []).map((log) => ({ ...log, id: this.logIdFactory(),
        scope: 'script', scriptRecordId: script.recordId, scriptName: script.name }))
      for (const field of ['assertions', 'apiResponses', 'resourceResponses', 'networkSummary']) {
        if (result[field] !== undefined) script[field] = structuredClone(result[field])
      }
      const artifacts = new Map((script.artifacts ?? []).map((artifact) => [`${artifact.attemptId}:${artifact.relativePath}`, artifact]))
      for (const artifact of result.artifacts ?? []) artifacts.set(`${artifact.attemptId}:${artifact.relativePath}`, artifact)
      script.artifacts = [...artifacts.values()]
      if (result.result && typeof result.result === 'object') script.output = structuredClone(result.result)
      if (result.error) script.error = result.error
      else delete script.error
      record.logs = [...record.logs.filter((log) => log.scope !== 'script'), ...record.scripts.flatMap((item) => item.logs)]
      record.runnerTracking = { ...record.runnerTracking, lastSeenAt: timestamp, lastResultAt: timestamp,
        completedScriptIds: [...new Set([...(record.runnerTracking?.completedScriptIds ?? []), scriptId])],
        ...(interrupted ? { interrupted: true } : {}) }
      record.updatedAt = timestamp
      record.revision += 1
      record.durationMs = durationBetween(record.startedAt, timestamp)
      record.counts = recoveredCounts(record.scripts)
      record.analysis = recoveredAnalysis(record.scripts, record.logs)
      await this.writeRecord(validateRunRecord(record))
      return structuredClone(record)
    })
  }

  async appendRunnerLog(id, { level = 'info', scope = 'runner', message }) {
    return this.mutate(async () => {
      const source = this.records.get(id)
      if (!source || source.status !== 'running') return
      const record = structuredClone(source)
      record.logs.push({ id: this.logIdFactory(), timestamp: this.now().toISOString(), level, scope, message })
      record.updatedAt = this.now().toISOString()
      record.revision += 1
      record.analysis = recoveredAnalysis(record.scripts, record.logs)
      await this.writeRecord(record)
    })
  }

  async updateRunnerProgress(id, scriptId, result) {
    return this.mutate(async () => {
      const source = this.records.get(id)
      if (!source || source.status !== 'running') return
      const record = structuredClone(source)
      const script = record.scripts.find(item => item.id === scriptId)
      if (!script || !['queued', 'running'].includes(script.status)) return
      if (script.logs.length === result.logs.length && result.durationMs - (script.durationMs ?? 0) < 5000) return
      script.status = 'running'
      script.durationMs = result.durationMs
      script.logs = result.logs.map(log => ({ ...log, id: this.logIdFactory(), scope: 'script',
        scriptRecordId: script.recordId, scriptName: script.name }))
      record.logs = [...record.logs.filter(log => log.scope !== 'script'), ...record.scripts.flatMap(item => item.logs)]
      record.updatedAt = this.now().toISOString()
      record.revision += 1
      record.durationMs = durationBetween(record.startedAt, record.updatedAt)
      record.counts = recoveredCounts(record.scripts)
      record.analysis = recoveredAnalysis(record.scripts, record.logs)
      await this.writeRecord(record)
    })
  }

  async finishRunnerPipeline(id, { status, error, stage = 'runner' } = {}) {
    return this.mutate(async () => {
      const source = this.records.get(id)
      if (!source || source.status !== 'running') return source ? structuredClone(source) : null
      const record = structuredClone(source)
      record.status = status ?? recoveredTerminalStatus(record.scripts)
      if (error) { record.error = error; record.failureStage = stage }
      record.scripts = record.scripts.map(script => ['queued', 'running'].includes(script.status)
        ? { ...script, status: 'skipped', error: error || '前序步骤失败，未执行' } : script)
      record.finishedAt = this.now().toISOString()
      record.updatedAt = record.finishedAt
      record.durationMs = durationBetween(record.startedAt, record.finishedAt)
      record.revision += 1
      record.counts = recoveredCounts(record.scripts)
      record.logs.push({ id: this.logIdFactory(), timestamp: record.finishedAt, level: record.status === 'passed' ? 'success' : 'warning',
        scope: 'runner', message: error || 'Runner 已完成全部流水线步骤并保存结果' })
      record.analysis = recoveredAnalysis(record.scripts, record.logs)
      await this.writeRecord(record)
      return structuredClone(record)
    })
  }

  async failPipelineStep(recordId, scriptId, result) {
    assertSafeRunRecordId(recordId)
    return this.mutate(async () => {
      const current = this.records.get(recordId)
      if (!current || current.status !== 'running') return current ? structuredClone(current) : null
      if (!current.scripts.some((script) => script.id === scriptId)) return null
      const record = structuredClone(current)
      const finishedAt = this.now().toISOString()
      record.scripts = record.scripts.map((script) => {
        if (script.id !== scriptId) return script.status === 'queued'
          ? { ...script, status: 'skipped', error: '前序步骤失败，未执行' } : script
        const logs = (result.logs ?? []).map((log) => ({ ...log, id: this.logIdFactory(),
          scope: 'script', scriptRecordId: script.recordId, scriptName: script.name }))
        return { ...script, status: 'failed', durationMs: result.durationMs, logs,
          error: result.error || '脚本执行失败', assertions: result.assertions ?? [],
          apiResponses: result.apiResponses ?? [], resourceResponses: result.resourceResponses ?? [],
          ...(result.networkSummary ? { networkSummary: result.networkSummary } : {}),
          artifacts: result.artifacts ?? script.artifacts ?? [] }
      })
      record.status = 'failed'
      record.failureStage = 'runner'
      record.error = result.error || '脚本执行失败'
      record.finishedAt = finishedAt
      record.updatedAt = finishedAt
      record.revision += 1
      record.durationMs = durationBetween(record.startedAt, finishedAt)
      record.logs = [...record.logs.filter((log) => log.scope !== 'script'),
        ...record.scripts.flatMap((script) => script.logs),
        { id: this.logIdFactory(), timestamp: finishedAt, level: 'error', scope: 'runner',
          message: 'Runner 已保存自动化批次失败终态，后续步骤不再执行' }]
      record.counts = recoveredCounts(record.scripts)
      record.analysis = recoveredAnalysis(record.scripts, record.logs)
      validateRunRecord(record)
      await this.writeRecord(record)
      return structuredClone(record)
    })
  }

  async mergeScriptArtifacts(recordId, scriptId, artifacts) {
    assertSafeRunRecordId(recordId)
    assertString(scriptId, 'scriptId')
    if (!Array.isArray(artifacts)) throw new RunRecordStoreError('artifacts必须是数组')

    return this.mutate(async () => {
      const current = this.records.get(recordId)
      if (!current) return null
      const scriptIndex = current.scripts.findIndex((script) => script.id === scriptId)
      if (scriptIndex < 0) return null
      artifacts.forEach((artifact, artifactIndex) => (
        validateArtifact(artifact, scriptIndex, artifactIndex, recordId, scriptId)
      ))
      if (artifacts.length === 0) return structuredClone(current)

      const record = structuredClone(current)
      const script = record.scripts[scriptIndex]
      const merged = new Map(script.artifacts.map((artifact) => [
        `${artifact.attemptId}:${artifact.relativePath}`,
        artifact,
      ]))
      for (const artifact of artifacts) {
        merged.set(`${artifact.attemptId}:${artifact.relativePath}`, structuredClone(artifact))
      }
      const nextArtifacts = [...merged.values()]
      if (JSON.stringify(nextArtifacts) === JSON.stringify(script.artifacts)) return structuredClone(current)

      script.artifacts = nextArtifacts
      record.revision += 1
      record.updatedAt = this.now().toISOString()
      await this.writeRecord(record)
      return structuredClone(record)
    })
  }

  async ensureReady() {
    if (!this.readyPromise) this.readyPromise = this.loadFromDisk()
    return this.readyPromise
  }

  async loadFromDisk() {
    await this.fileSystem.mkdir(this.directory, { recursive: true, mode: 0o700 })
    const entries = await this.fileSystem.readdir(this.directory, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const id = entry.name.slice(0, -'.json'.length)
      if (!SAFE_RUN_RECORD_ID_PATTERN.test(id)) continue
      try {
        const raw = await this.fileSystem.readFile(join(this.directory, entry.name), 'utf8')
        const record = validateRunRecord(JSON.parse(raw))
        if (record.id !== id) throw new Error('文件名与记录 ID 不一致')
        this.records.set(id, record)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.warningLogger(`[runner] 跳过无效运行记录 ${entry.name}: ${message}`)
      }
    }
  }

  async recoverStaleRecords() {
    const checkedAt = this.now()
    if (!(checkedAt instanceof Date) || !Number.isFinite(checkedAt.getTime())) return
    for (const source of this.records.values()) {
      if (source.status !== 'running') continue
      // Presence is stronger evidence than elapsed time or missing log output.
      if (this.runnerActivityProvider?.().some((run) => run.executionId === source.id && !run.settled)) {
        const heartbeatAt = Date.parse(source.runnerTracking?.lastSeenAt ?? '')
        if (!Number.isFinite(heartbeatAt) || checkedAt.getTime() - heartbeatAt >= 10_000) {
          const active = structuredClone(source)
          active.runnerTracking = { ...active.runnerTracking, lastSeenAt: checkedAt.toISOString() }
          active.updatedAt = checkedAt.toISOString()
          active.durationMs = durationBetween(active.startedAt, active.updatedAt)
          active.revision += 1
          await this.writeRecord(active)
        }
        continue
      }
      const lastUpdate = Math.max(Date.parse(source.updatedAt), Date.parse(source.runnerTracking?.lastSeenAt ?? source.updatedAt))
      const runnerManaged = this.runnerActivityProvider && (source.execution?.kind === 'pipeline' || source.runnerTracking
        || source.scripts.some((script) => script.status === 'running'))
      const deadline = runnerManaged
        ? Math.max(lastUpdate, this.runnerStartedAt) + this.runnerRecoveryGraceMs
        : lastUpdate + this.staleAfterMs
      if (!Number.isFinite(deadline) || checkedAt.getTime() <= deadline) continue

      const record = structuredClone(source)
      const finishedAt = checkedAt.toISOString()
      const allResultsKnown = runnerManaged && record.scripts.every((script) => ['passed', 'partial', 'failed'].includes(script.status))
      record.status = allResultsKnown && !record.runnerTracking?.interrupted
        ? recoveredTerminalStatus(record.scripts) : 'interrupted'
      if (record.status === 'interrupted') {
        record.failureStage = 'runner'
        record.error = runnerManaged
          ? 'Runner 已无活动任务，批次未正常结束；未确认步骤的业务结果请人工核对后再重试'
          : '页面或 Runner 在批次完成前中断'
      }
      record.finishedAt = allResultsKnown ? record.runnerTracking?.lastResultAt ?? source.updatedAt : finishedAt
      record.updatedAt = finishedAt
      record.revision += 1
      record.durationMs = durationBetween(record.startedAt, record.finishedAt)
      record.scripts = record.scripts.map((script) => script.status === 'queued' || script.status === 'running'
        ? { ...script, status: 'skipped', ...(runnerManaged ? { error: script.status === 'running'
          ? '执行结果未确认，请核对业务结果后再重试' : '批次中断，后续步骤未执行' } : {}) }
        : script)
      record.logs.push({
        id: this.logIdFactory(),
        timestamp: finishedAt,
        level: 'warning',
        scope: 'runner',
        message: record.status === 'interrupted'
          ? runnerManaged ? '检测到未正常结束的运行批次，已标记为中断；不会自动重跑' : '检测到未正常结束的运行批次，已标记为中断'
          : 'Runner 已根据保存的全部脚本结果补写批次终态',
      })
      record.counts = recoveredCounts(record.scripts)
      record.analysis = recoveredAnalysis(record.scripts, record.logs)
      await this.writeRecord(record)
    }
  }

  async mutate(operation) {
    const pending = this.mutationTail.then(async () => {
      await this.ensureReady()
      return operation()
    })
    this.mutationTail = pending.then(() => undefined, () => undefined)
    return pending
  }

  async writeRecord(record) {
    const serialized = `${JSON.stringify(record)}\n`
    const targetPath = join(this.directory, `${record.id}.json`)
    const temporaryPath = join(
      this.directory,
      `.${record.id}.${process.pid}.${this.temporaryIdFactory()}.tmp`,
    )
    try {
      await this.fileSystem.writeFile(temporaryPath, serialized, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      })
      await this.fileSystem.rename(temporaryPath, targetPath)
    } catch (error) {
      await this.fileSystem.unlink(temporaryPath).catch(() => undefined)
      throw error
    }
    this.records.set(record.id, record)
  }
}
