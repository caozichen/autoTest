import type { RunRecordStatus, RunScriptStatus } from '@/domain/run-record'
import type { AutomationScript, ScriptRunStatus } from '@/domain/script'

interface RunHistoryScript {
  id: string
  status: RunScriptStatus
  durationMs: number | null
}

interface RunHistoryRecord {
  id: string
  status: RunRecordStatus
  startedAt: string
  scripts: RunHistoryScript[]
}

interface LatestScriptRun {
  recordId: string
  startedAt: string
  timestamp: number
  status: ScriptRunStatus
  durationMs: number | null
}

interface RestoreLatestScriptRunsOptions {
  preserveRuntimeState?: boolean
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  const datePart = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
  const timePart = [
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
  ].join(':')
  return `${datePart} ${timePart}`
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1_000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function restoredStatus(
  record: RunHistoryRecord,
  script: RunHistoryScript,
): ScriptRunStatus | null {
  if (
    script.status === 'running'
    || script.status === 'passed'
    || script.status === 'partial'
    || script.status === 'failed'
  ) return script.status

  // Interrupted records store the active script as skipped. Positive progress distinguishes it
  // from queued steps pre-registered at 0 ms by a manual batch.
  if (record.status === 'interrupted' && script.status === 'skipped' && (script.durationMs ?? 0) > 0) {
    return 'interrupted'
  }
  return null
}

function isNewer(candidate: LatestScriptRun, current: LatestScriptRun | undefined): boolean {
  if (!current) return true
  if (candidate.timestamp !== current.timestamp) return candidate.timestamp > current.timestamp
  return candidate.recordId.localeCompare(current.recordId) > 0
}

export function restoreLatestScriptRuns(
  scripts: AutomationScript[],
  records: RunHistoryRecord[],
  options: RestoreLatestScriptRunsOptions = {},
): AutomationScript[] {
  const latestByScriptId = new Map<string, LatestScriptRun>()

  for (const record of records) {
    const timestamp = Date.parse(record.startedAt)
    if (!Number.isFinite(timestamp)) continue
    for (const script of record.scripts) {
      const status = restoredStatus(record, script)
      if (!status) continue
      const candidate: LatestScriptRun = {
        recordId: record.id,
        startedAt: record.startedAt,
        timestamp,
        status,
        durationMs: script.durationMs,
      }
      if (isNewer(candidate, latestByScriptId.get(script.id))) {
        latestByScriptId.set(script.id, candidate)
      }
    }
  }

  return scripts.map((script) => {
    if (options.preserveRuntimeState && script.lastRunAt !== null) return { ...script }
    const latest = latestByScriptId.get(script.id)
    if (!latest) return { ...script }
    return {
      ...script,
      status: script.status === 'disabled' ? 'disabled' : latest.status,
      lastRunAt: formatDateTime(latest.startedAt),
      lastDuration: latest.durationMs === null ? null : formatDuration(latest.durationMs),
    }
  })
}
