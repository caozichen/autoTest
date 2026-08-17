export type RunRecordStatus = 'running' | 'passed' | 'failed' | 'partial' | 'interrupted'
export type RunScriptStatus = 'queued' | 'passed' | 'failed' | 'skipped'
export type RunRecordLogLevel = 'info' | 'success' | 'warning' | 'error'
export type RunRecordLogScope = 'batch' | 'login' | 'runner' | 'script'
export type RunFailureStage = 'login' | 'runner' | 'script'

export interface RunEnvironmentSnapshot {
  id: string
  name: string
  code: string
  apiBaseUrl: string
}

export interface RunScriptSnapshot {
  id: string
  name: string
  directory: string
  entryFile: string
  tags: string[]
}

export interface RunRecordLog {
  id: string
  timestamp: string
  level: RunRecordLogLevel
  scope: RunRecordLogScope
  message: string
  scriptRecordId?: string
  scriptName?: string
  details?: Record<string, unknown>
}

export interface RunScriptRecord extends RunScriptSnapshot {
  recordId: string
  status: RunScriptStatus
  durationMs: number | null
  logs: RunRecordLog[]
  output?: Record<string, unknown>
  error?: string
}

export interface RunRecordCounts {
  total: number
  passed: number
  failed: number
  skipped: number
}

export interface RunFailureGroup {
  reason: string
  count: number
  scriptRecordIds: string[]
}

export interface RunRecordAnalysis {
  passRate: number
  averageDurationMs: number
  slowestScriptRecordId: string | null
  logCounts: Record<RunRecordLogLevel, number>
  failureGroups: RunFailureGroup[]
}

export interface RunRecord {
  schemaVersion: 1
  revision: number
  id: string
  displayId: string
  name: string
  status: RunRecordStatus
  trigger: 'manual'
  browser: 'Chromium'
  environment: RunEnvironmentSnapshot
  startedAt: string
  updatedAt: string
  finishedAt: string | null
  durationMs: number | null
  failureStage?: RunFailureStage
  error?: string
  counts: RunRecordCounts
  scripts: RunScriptRecord[]
  logs: RunRecordLog[]
  analysis: RunRecordAnalysis
}

export interface StartRunRecordDraft {
  name?: string
  environment: RunEnvironmentSnapshot
  scripts: RunScriptSnapshot[]
}

export interface CompleteRunScriptDraft {
  scriptId: string
  status?: Exclude<RunScriptStatus, 'queued'>
  ok?: boolean
  durationMs: number
  logs: Array<{
    timestamp: string
    level: 'info' | 'success' | 'warning' | 'error'
    message: string
    details?: Record<string, unknown>
  }>
  output?: Record<string, unknown>
  error?: string
}

export interface CompleteRunRecordDraft {
  scripts: CompleteRunScriptDraft[]
  secretValues?: string[]
}

export interface FailRunRecordDraft {
  stage: RunFailureStage
  error: string
  secretValues?: string[]
}

export interface AppendRunLogDraft {
  level: RunRecordLogLevel
  scope: RunRecordLogScope
  message: string
  details?: Record<string, unknown>
  secretValues?: string[]
}
