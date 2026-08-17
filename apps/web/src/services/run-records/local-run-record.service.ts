import type {
  AppendRunLogDraft,
  CompleteRunRecordDraft,
  CompleteRunScriptDraft,
  FailRunRecordDraft,
  RunRecord,
  RunRecordAnalysis,
  RunRecordLog,
  RunRecordLogLevel,
  RunRecordStatus,
  RunScriptRecord,
  RunScriptSnapshot,
  StartRunRecordDraft,
} from '@/domain/run-record'
import type { RunRecordService } from './run-record-service'

const STORAGE_KEY = 'autotest.run-records.v1'
const MAX_RECORDS = 200
const RUN_STALE_AFTER_MS = 4 * 60 * 60 * 1_000
const LEGACY_SEED_IDS = new Set(['seed-batch-001', 'seed-batch-002', 'seed-batch-003'])
const REDACTED = '[REDACTED]'
const SENSITIVE_KEY = /authorization|token|password|passwd|secret|cookie|verify[_-]?code|mobile/i
const STATUS_VALUES: RunRecordStatus[] = ['running', 'passed', 'failed', 'partial', 'interrupted']
const SCRIPT_STATUS_VALUES: RunScriptRecord['status'][] = ['queued', 'passed', 'failed', 'skipped']
const LOG_LEVEL_VALUES: RunRecordLogLevel[] = ['info', 'success', 'warning', 'error']
const LOG_SCOPE_VALUES: RunRecordLog['scope'][] = ['batch', 'login', 'runner', 'script']

type IdFactory = () => string

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function normalizeStoredLog(value: unknown): RunRecordLog | null {
  if (!isRecord(value)) return null
  if (
    typeof value.id !== 'string' ||
    typeof value.timestamp !== 'string' ||
    typeof value.message !== 'string' ||
    !Number.isFinite(new Date(value.timestamp).getTime()) ||
    !LOG_LEVEL_VALUES.includes(value.level as RunRecordLogLevel) ||
    !LOG_SCOPE_VALUES.includes(value.scope as RunRecordLog['scope'])
  ) return null

  return {
    id: value.id,
    timestamp: value.timestamp,
    level: value.level as RunRecordLogLevel,
    scope: value.scope as RunRecordLog['scope'],
    message: value.message,
    ...(typeof value.scriptRecordId === 'string' ? { scriptRecordId: value.scriptRecordId } : {}),
    ...(typeof value.scriptName === 'string' ? { scriptName: value.scriptName } : {}),
    ...(isRecord(value.details) ? { details: structuredClone(value.details) } : {}),
  }
}

function normalizeStoredScript(value: unknown): RunScriptRecord | null {
  if (!isRecord(value) || !Array.isArray(value.tags) || !Array.isArray(value.logs)) return null
  if (
    typeof value.recordId !== 'string' ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.directory !== 'string' ||
    typeof value.entryFile !== 'string' ||
    !value.tags.every((tag) => typeof tag === 'string') ||
    !SCRIPT_STATUS_VALUES.includes(value.status as RunScriptRecord['status']) ||
    (value.durationMs !== null && (
      typeof value.durationMs !== 'number' ||
      !Number.isFinite(value.durationMs) ||
      value.durationMs < 0
    ))
  ) return null

  const logs = value.logs.map(normalizeStoredLog).filter((log): log is RunRecordLog => Boolean(log))
  return {
    recordId: value.recordId,
    id: value.id,
    name: value.name,
    directory: value.directory,
    entryFile: value.entryFile,
    tags: [...value.tags] as string[],
    status: value.status as RunScriptRecord['status'],
    durationMs: value.durationMs as number | null,
    logs,
    ...(isRecord(value.output) ? { output: structuredClone(value.output) } : {}),
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
  }
}

function normalizeStoredRunRecord(value: unknown): RunRecord | null {
  if (!isRecord(value) || !isRecord(value.environment) || !Array.isArray(value.scripts) || !Array.isArray(value.logs)) return null
  if (
    value.schemaVersion !== 1 ||
    typeof value.id !== 'string' ||
    typeof value.displayId !== 'string' ||
    typeof value.name !== 'string' ||
    !STATUS_VALUES.includes(value.status as RunRecordStatus) ||
    typeof value.startedAt !== 'string' ||
    (value.finishedAt !== null && typeof value.finishedAt !== 'string') ||
    (value.durationMs !== null && (
      typeof value.durationMs !== 'number' ||
      !Number.isFinite(value.durationMs) ||
      value.durationMs < 0
    )) ||
    typeof value.environment.id !== 'string' ||
    typeof value.environment.name !== 'string' ||
    typeof value.environment.code !== 'string' ||
    typeof value.environment.apiBaseUrl !== 'string'
  ) return null

  const updatedAt = typeof value.updatedAt === 'string'
    ? value.updatedAt
    : typeof value.finishedAt === 'string' ? value.finishedAt : value.startedAt
  if (
    !Number.isFinite(new Date(value.startedAt).getTime()) ||
    !Number.isFinite(new Date(updatedAt).getTime()) ||
    (typeof value.finishedAt === 'string' && !Number.isFinite(new Date(value.finishedAt).getTime()))
  ) return null

  const scripts = value.scripts.map(normalizeStoredScript).filter((script): script is RunScriptRecord => Boolean(script))
  if (scripts.length === 0) return null
  const logs = value.logs.map(normalizeStoredLog).filter((log): log is RunRecordLog => Boolean(log))
  const storedStatus = value.status as RunRecordStatus
  const status = storedStatus === 'running' || storedStatus === 'interrupted'
    ? storedStatus
    : batchStatus(scripts)
  const failureStage = value.failureStage === 'login' || value.failureStage === 'runner' || value.failureStage === 'script'
    ? value.failureStage
    : undefined

  return {
    schemaVersion: 1,
    revision: typeof value.revision === 'number' && Number.isInteger(value.revision) && value.revision >= 0
      ? value.revision
      : 0,
    id: value.id,
    displayId: value.displayId,
    name: value.name,
    status,
    trigger: 'manual',
    browser: 'Chromium',
    environment: {
      id: value.environment.id,
      name: value.environment.name,
      code: value.environment.code,
      apiBaseUrl: value.environment.apiBaseUrl,
    },
    startedAt: value.startedAt,
    updatedAt,
    finishedAt: value.finishedAt as string | null,
    durationMs: value.durationMs as number | null,
    ...(failureStage ? { failureStage } : {}),
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
    counts: createCounts(scripts),
    scripts,
    logs,
    analysis: createAnalysis(scripts, logs),
  }
}

function replaceSecrets(value: string, secretValues: string[]): string {
  let result = value.replace(/\bBearer\s+[^\s"',;}\]]+/gi, `Bearer ${REDACTED}`)
  const secrets = [...new Set(secretValues.filter(Boolean))].sort((left, right) => right.length - left.length)
  for (const secret of secrets) {
    result = result.split(secret).join(REDACTED)
  }
  return result
}

function redactValue(value: unknown, secretValues: string[], key = ''): unknown {
  if (SENSITIVE_KEY.test(key)) return REDACTED
  if (typeof value === 'string') return replaceSecrets(value, secretValues)
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secretValues))
  if (!isRecord(value)) return value

  return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
    entryKey,
    redactValue(entryValue, secretValues, entryKey),
  ]))
}

function redactDetails(value: Record<string, unknown> | undefined, secretValues: string[]): Record<string, unknown> | undefined {
  return value ? redactValue(value, secretValues) as Record<string, unknown> : undefined
}

function emptyLogCounts(): Record<RunRecordLogLevel, number> {
  return { info: 0, success: 0, warning: 0, error: 0 }
}

function createAnalysis(scripts: RunScriptRecord[], logs: RunRecordLog[]): RunRecordAnalysis {
  const completed = scripts.filter((script) => script.status === 'passed' || script.status === 'failed')
  const durations = completed.map((script) => script.durationMs ?? 0)
  const slowest = [...completed].sort((left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0))[0]
  const failureMap = new Map<string, string[]>()

  for (const script of scripts.filter((item) => item.status === 'failed')) {
    const reason = script.error?.trim() || '脚本断言未通过'
    failureMap.set(reason, [...(failureMap.get(reason) ?? []), script.recordId])
  }

  const logCounts = emptyLogCounts()
  for (const log of logs) logCounts[log.level] += 1

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

function createCounts(scripts: RunScriptRecord[]) {
  return {
    total: scripts.length,
    passed: scripts.filter((script) => script.status === 'passed').length,
    failed: scripts.filter((script) => script.status === 'failed').length,
    skipped: scripts.filter((script) => script.status === 'skipped').length,
  }
}

function batchStatus(scripts: RunScriptRecord[]): RunRecordStatus {
  const passed = scripts.filter((script) => script.status === 'passed').length
  const failed = scripts.filter((script) => script.status === 'failed').length
  if (failed === 0 && passed === scripts.length) return 'passed'
  if (passed > 0 && failed > 0) return 'partial'
  return 'failed'
}

function durationBetween(startedAt: string, finishedAt: string): number {
  const duration = new Date(finishedAt).getTime() - new Date(startedAt).getTime()
  return Number.isFinite(duration) ? Math.max(0, duration) : 0
}

function formatDisplayId(date: Date, id: string): string {
  const datePart = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0'))
    .join('')
  const suffix = id.replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase().padStart(6, '0')
  return `RUN-${datePart}-${suffix}`
}

function runName(scripts: RunScriptSnapshot[]): string {
  if (scripts.length === 1) return scripts[0]?.name ?? '手动运行'
  return `批量运行 · ${scripts.length} 个脚本`
}

function scriptRecordId(batchId: string, scriptId: string): string {
  return `${batchId}:${scriptId}`
}

export class LocalRunRecordService implements RunRecordService {
  private records: RunRecord[]

  constructor(
    private readonly storage: Storage = window.localStorage,
    private readonly now: () => Date = () => new Date(),
    private readonly idFactory: IdFactory = () => crypto.randomUUID(),
  ) {
    this.records = []
    this.refreshFromStorage()
  }

  async list(): Promise<RunRecord[]> {
    this.refreshFromStorage()
    return structuredClone(this.records)
  }

  async get(id: string): Promise<RunRecord | null> {
    this.refreshFromStorage()
    const record = this.records.find((item) => item.id === id)
    return record ? structuredClone(record) : null
  }

  async start(draft: StartRunRecordDraft): Promise<RunRecord> {
    if (draft.scripts.length === 0) throw new Error('运行批次至少需要一个脚本')
    this.refreshFromStorage()
    const scriptIds = new Set(draft.scripts.map((script) => script.id))
    const conflict = this.records.find((record) => (
      record.status === 'running' && record.scripts.some((script) => scriptIds.has(script.id))
    ))
    if (conflict) throw new Error(`脚本正在批次 ${conflict.displayId} 中执行，请等待当前运行结束`)

    const id = this.idFactory()
    const startedDate = this.now()
    const startedAt = startedDate.toISOString()
    const scripts: RunScriptRecord[] = draft.scripts.map((script) => ({
      ...structuredClone(script),
      recordId: scriptRecordId(id, script.id),
      status: 'queued',
      durationMs: null,
      logs: [],
    }))
    const logs: RunRecordLog[] = [{
      id: this.idFactory(),
      timestamp: startedAt,
      level: 'info',
      scope: 'batch',
      message: '手动运行批次已创建，等待环境登录',
    }]
    const record: RunRecord = {
      schemaVersion: 1,
      revision: 0,
      id,
      displayId: formatDisplayId(startedDate, id),
      name: draft.name?.trim() || runName(draft.scripts),
      status: 'running',
      trigger: 'manual',
      browser: 'Chromium',
      environment: structuredClone(draft.environment),
      startedAt,
      updatedAt: startedAt,
      finishedAt: null,
      durationMs: null,
      counts: createCounts(scripts),
      scripts,
      logs,
      analysis: createAnalysis(scripts, logs),
    }
    this.insertRecord(record)
    return structuredClone(record)
  }

  async appendLog(id: string, draft: AppendRunLogDraft): Promise<RunRecord> {
    const { record, expectedRevision, expectedUpdatedAt } = this.runningDraft(id)
    const updatedAt = this.now().toISOString()
    const details = redactDetails(draft.details, draft.secretValues ?? [])
    record.logs.push({
      id: this.idFactory(),
      timestamp: updatedAt,
      level: draft.level,
      scope: draft.scope,
      message: replaceSecrets(draft.message, draft.secretValues ?? []),
      ...(details ? { details } : {}),
    })
    record.updatedAt = updatedAt
    record.revision += 1
    record.analysis = createAnalysis(record.scripts, record.logs)
    this.replaceRecord(record, expectedRevision, expectedUpdatedAt)
    return structuredClone(record)
  }

  async complete(id: string, draft: CompleteRunRecordDraft): Promise<RunRecord> {
    const { record, expectedRevision, expectedUpdatedAt } = this.runningDraft(id)
    const secretValues = draft.secretValues ?? []
    record.scripts = record.scripts.map((script) => this.completeScript(record.id, script, draft.scripts, secretValues))
    const finishedAt = this.now().toISOString()
    const scriptLogs = record.scripts.flatMap((script) => script.logs)
    record.logs = [
      ...record.logs,
      ...scriptLogs,
      {
        id: this.idFactory(),
        timestamp: finishedAt,
        level: record.scripts.some((script) => script.status === 'failed' || script.status === 'skipped')
          ? 'warning'
          : 'success',
        scope: 'batch',
        message: '运行批次执行完成',
      },
    ]
    record.status = batchStatus(record.scripts)
    record.finishedAt = finishedAt
    record.updatedAt = finishedAt
    record.revision += 1
    record.durationMs = durationBetween(record.startedAt, finishedAt)
    record.counts = createCounts(record.scripts)
    record.analysis = createAnalysis(record.scripts, record.logs)
    this.replaceRecord(record, expectedRevision, expectedUpdatedAt)
    return structuredClone(record)
  }

  async fail(id: string, draft: FailRunRecordDraft): Promise<RunRecord> {
    const { record, expectedRevision, expectedUpdatedAt } = this.runningDraft(id)
    const finishedAt = this.now().toISOString()
    const error = replaceSecrets(draft.error, draft.secretValues ?? [])
    record.status = 'failed'
    record.failureStage = draft.stage
    record.error = error
    record.finishedAt = finishedAt
    record.updatedAt = finishedAt
    record.revision += 1
    record.durationMs = durationBetween(record.startedAt, finishedAt)
    record.scripts = record.scripts.map((script) => ({ ...script, status: 'skipped' }))
    record.logs.push({
      id: this.idFactory(),
      timestamp: finishedAt,
      level: 'error',
      scope: draft.stage,
      message: error,
    })
    record.counts = createCounts(record.scripts)
    record.analysis = createAnalysis(record.scripts, record.logs)
    this.replaceRecord(record, expectedRevision, expectedUpdatedAt)
    return structuredClone(record)
  }

  async interruptByScriptId(scriptId: string): Promise<RunRecord[]> {
    this.refreshFromStorage()
    const base = this.readPersistedRecords() ?? this.records
    const matchingIds = new Set(base
      .filter((record) => record.status === 'running' && record.scripts.some((script) => script.id === scriptId))
      .map((record) => record.id))
    if (matchingIds.size === 0) return []

    const finishedAt = this.now().toISOString()
    const interrupted = base.map((source) => {
      if (!matchingIds.has(source.id)) return source
      const record = structuredClone(source)
      const scriptName = record.scripts.find((script) => script.id === scriptId)?.name ?? scriptId
      record.status = 'interrupted'
      record.failureStage = 'runner'
      record.error = `用户已强制停止脚本“${scriptName}”`
      record.finishedAt = finishedAt
      record.updatedAt = finishedAt
      record.revision += 1
      record.durationMs = durationBetween(record.startedAt, finishedAt)
      record.scripts = record.scripts.map((script) => script.status === 'queued'
        ? { ...script, status: 'skipped' }
        : script)
      record.logs.push({
        id: this.idFactory(),
        timestamp: finishedAt,
        level: 'warning',
        scope: 'runner',
        message: `运行批次已由用户强制停止（脚本：${scriptName}）`,
      })
      record.counts = createCounts(record.scripts)
      record.analysis = createAnalysis(record.scripts, record.logs)
      return record
    })

    this.commit(interrupted)
    return structuredClone(interrupted.filter((record) => matchingIds.has(record.id)))
  }

  private completeScript(
    batchId: string,
    script: RunScriptRecord,
    completions: CompleteRunScriptDraft[],
    secretValues: string[],
  ): RunScriptRecord {
    const completion = completions.find((item) => item.scriptId === script.id)
    if (!completion) {
      return {
        ...script,
        status: 'failed',
        durationMs: 0,
        error: 'Runner 未返回该脚本的执行结果',
      }
    }

    const logs: RunRecordLog[] = completion.logs.map((log) => {
      const details = redactDetails(log.details, secretValues)
      return {
        id: this.idFactory(),
        timestamp: log.timestamp,
        level: log.level,
        scope: 'script',
        scriptRecordId: scriptRecordId(batchId, script.id),
        scriptName: script.name,
        message: replaceSecrets(log.message, secretValues),
        ...(details ? { details } : {}),
      }
    })
    const output = redactDetails(completion.output, secretValues)
    const error = completion.error ? replaceSecrets(completion.error, secretValues) : undefined
    const status = completion.status ?? (completion.ok === true ? 'passed' : 'failed')

    return {
      ...script,
      status,
      durationMs: status === 'skipped' ? null : Math.max(0, completion.durationMs),
      logs,
      ...(output ? { output } : {}),
      ...(error ? { error } : {}),
    }
  }

  private runningDraft(id: string): {
    record: RunRecord
    expectedRevision: number
    expectedUpdatedAt: string
  } {
    this.refreshFromStorage()
    const record = this.records.find((item) => item.id === id)
    if (!record) throw new Error('运行记录不存在或已被删除')
    if (record.status !== 'running') throw new Error('运行记录已经结束，不能重复更新')
    return {
      record: structuredClone(record),
      expectedRevision: record.revision,
      expectedUpdatedAt: record.updatedAt,
    }
  }

  private replaceRecord(record: RunRecord, expectedRevision: number, expectedUpdatedAt: string): void {
    const base = this.readPersistedRecords() ?? this.records
    const current = base.find((item) => item.id === record.id)
    if (!current) throw new Error('运行记录不存在或已被删除')
    if (
      current.status !== 'running' ||
      current.revision !== expectedRevision ||
      current.updatedAt !== expectedUpdatedAt
    ) {
      throw new Error('运行记录已在其它页面更新，请刷新后重试')
    }
    this.commit(base.map((item) => item.id === record.id ? record : item))
  }

  private insertRecord(record: RunRecord): void {
    const base = this.readPersistedRecords() ?? this.records
    const scriptIds = new Set(record.scripts.map((script) => script.id))
    const conflict = base.find((item) => (
      item.status === 'running' && item.scripts.some((script) => scriptIds.has(script.id))
    ))
    if (conflict) throw new Error(`脚本正在批次 ${conflict.displayId} 中执行，请等待当前运行结束`)
    this.commit([record, ...base.filter((item) => item.id !== record.id)])
  }

  private readPersistedRecords(): RunRecord[] | null {
    const raw = this.storage.getItem(STORAGE_KEY)
    if (!raw) return null
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return null
      const containsLegacySeeds = parsed.some((item) => (
        isRecord(item) && typeof item.id === 'string' && LEGACY_SEED_IDS.has(item.id)
      ))
      const records = parsed
        .map(normalizeStoredRunRecord)
        .filter((record): record is RunRecord => record !== null)
        .filter((record) => !LEGACY_SEED_IDS.has(record.id))
      if (containsLegacySeeds) {
        try {
          this.persist(records)
        } catch {
          // The cleaned in-memory view is still safe; retry migration on the next read.
        }
      }
      return records
    } catch {
      return null
    }
  }

  private refreshFromStorage(): void {
    let persisted: RunRecord[] | null
    try {
      persisted = this.readPersistedRecords()
    } catch {
      return
    }
    if (persisted) this.records = persisted

    if (!this.records.some((record) => record.status === 'running')) return
    const checkedAt = this.now()
    let changed = false
    const recovered = this.records.map((source) => {
      if (source.status !== 'running') return source
      const lastUpdate = new Date(source.updatedAt).getTime()
      if (checkedAt.getTime() - lastUpdate <= RUN_STALE_AFTER_MS) return source

      changed = true
      const record = structuredClone(source)
      const finishedAt = checkedAt.toISOString()
        record.status = 'interrupted'
        record.failureStage = 'runner'
        record.error = '页面或 Runner 在批次完成前中断'
        record.finishedAt = finishedAt
        record.updatedAt = finishedAt
        record.revision += 1
        record.durationMs = durationBetween(record.startedAt, finishedAt)
        record.scripts = record.scripts.map((script) => script.status === 'queued'
          ? { ...script, status: 'skipped' }
          : script)
        record.logs.push({
          id: this.idFactory(),
          timestamp: finishedAt,
          level: 'warning',
          scope: 'runner',
          message: '检测到未正常结束的运行批次，已标记为中断',
        })
        record.counts = createCounts(record.scripts)
        record.analysis = createAnalysis(record.scripts, record.logs)
      return record
    })

    if (!changed) return
    try {
      this.persist(recovered)
      this.records = recovered
    } catch {
      // Keep the last consistent state when browser storage is temporarily unavailable.
    }
  }

  private commit(records: RunRecord[]): void {
    const next = structuredClone(records.slice(0, MAX_RECORDS))
    this.persist(next)
    this.records = next
  }

  private persist(records: RunRecord[]): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(records))
  }
}
