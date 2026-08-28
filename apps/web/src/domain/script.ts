import type { ScriptAssertionResult } from './assertion'

export type ScriptStatus = 'ready' | 'running' | 'passed' | 'failed' | 'interrupted' | 'disabled'
export type ScriptLogLevel = 'info' | 'success' | 'warning' | 'error'

export const DEFAULT_SCRIPT_TIMEOUT_MS = 300_000
export const MIN_SCRIPT_TIMEOUT_MS = 1_000
export const MAX_SCRIPT_TIMEOUT_MS = 1_800_000

export interface ScriptRunLog {
  timestamp: string
  level: ScriptLogLevel
  message: string
  details?: Record<string, unknown>
}

export interface ScriptApiResponse {
  sequence: number
  timestamp: string
  name: string
  method: string
  url: string
  status: number
  ok: boolean
  durationMs: number
  requestBody?: unknown
  responseBody?: unknown
  error?: string
}

export interface ScriptRunResult {
  ok: boolean
  cancelled?: boolean
  timedOut?: boolean
  durationMs: number
  logs: ScriptRunLog[]
  assertions?: ScriptAssertionResult[]
  apiResponses?: ScriptApiResponse[]
  output?: Record<string, unknown>
  error?: string
}

export interface ScriptResponseVariableBinding {
  id: string
  variableName: string
  responsePath: string
  secret: boolean
}

export interface ScriptInputParameter {
  id: string
  key: string
  value: string
  description: string
}

export interface AutomationScript {
  id: string
  name: string
  description: string
  directory: string
  entryFile: string
  timeoutMs: number
  requestPath?: string
  inputParameters?: ScriptInputParameter[]
  responseVariableBindings?: ScriptResponseVariableBinding[]
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
  timeoutMs: number
  requestPath?: string
  inputParameters?: ScriptInputParameter[]
  responseVariableBindings?: ScriptResponseVariableBinding[]
  tags: string[]
  enabled: boolean
}

export interface ScriptRunContext {
  environmentId: string
  siteBaseUrl: string
  apiBaseUrl: string
  ignoreHTTPSErrors: boolean
  variables: Record<string, string>
  authorizationOrigin: string
  extraHTTPHeaders: Record<string, string>
}
