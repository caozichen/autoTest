import { randomUUID } from 'node:crypto'
import * as defaultFileSystem from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

export const SAFE_RUN_RECORD_ID_PATTERN = /^[a-zA-Z0-9_-]{8,100}$/

const RUN_RECORD_STATUSES = new Set(['running', 'passed', 'failed', 'partial', 'interrupted'])
const RUN_SCRIPT_STATUSES = new Set(['queued', 'running', 'passed', 'failed', 'skipped'])
const DEFAULT_STALE_AFTER_MS = 4 * 60 * 60 * 1_000
const ARTIFACT_SCOPE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/
const ARTIFACT_TYPE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,99}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/

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
    for (const script of record.scripts) {
      script.resourceResponses ??= []
      script.networkSummary ??= emptyNetworkSummary()
      script.artifacts ??= []
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
    failed: scripts.filter((script) => script.status === 'failed').length,
    skipped: scripts.filter((script) => script.status === 'skipped').length,
  }
}

function recoveredAnalysis(scripts, logs) {
  const completed = scripts.filter((script) => script.status === 'passed' || script.status === 'failed')
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
    this.records = new Map()
    this.readyPromise = null
    this.mutationTail = Promise.resolve()
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
      if (current.revision !== expectedRevision || current.updatedAt !== expectedUpdatedAt) {
        throw new RunRecordStoreError('运行记录已在其它页面更新，请刷新后重试', {
          statusCode: 409,
          code: 'RUN_RECORD_CONFLICT',
        })
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
      const lastUpdate = Date.parse(source.updatedAt)
      if (!Number.isFinite(lastUpdate) || checkedAt.getTime() - lastUpdate <= this.staleAfterMs) continue

      const record = structuredClone(source)
      const finishedAt = checkedAt.toISOString()
      record.status = 'interrupted'
      record.failureStage = 'runner'
      record.error = '页面或 Runner 在批次完成前中断'
      record.finishedAt = finishedAt
      record.updatedAt = finishedAt
      record.revision += 1
      record.durationMs = durationBetween(record.startedAt, finishedAt)
      record.scripts = record.scripts.map((script) => script.status === 'queued' || script.status === 'running'
        ? { ...script, status: 'skipped' }
        : script)
      record.logs.push({
        id: this.logIdFactory(),
        timestamp: finishedAt,
        level: 'warning',
        scope: 'runner',
        message: '检测到未正常结束的运行批次，已标记为中断',
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
