export type ScriptStatus = 'ready' | 'running' | 'passed' | 'failed' | 'disabled'
export type ScriptLogLevel = 'info' | 'success' | 'error'

export interface ScriptRunLog {
  timestamp: string
  level: ScriptLogLevel
  message: string
  details?: Record<string, unknown>
}

export interface ScriptRunResult {
  ok: boolean
  durationMs: number
  logs: ScriptRunLog[]
  output?: Record<string, unknown>
  error?: string
}

export interface AutomationScript {
  id: string
  name: string
  description: string
  directory: string
  entryFile: string
  tags: string[]
  status: ScriptStatus
  updatedAt: string
  lastRunAt: string | null
  lastDuration: string | null
  lastRunResult?: ScriptRunResult
}

export interface ScriptDraft {
  name: string
  description: string
  directory: string
  entryFile: string
  tags: string[]
  enabled: boolean
}

export interface ScriptRunContext {
  environmentId: string
  apiBaseUrl: string
  ignoreHTTPSErrors: boolean
  variables: Record<string, string>
  authorizationOrigin: string
  extraHTTPHeaders: Record<string, string>
}
