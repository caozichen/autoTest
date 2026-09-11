import type { ScriptAssertionResult } from './assertion'

export type ScriptRunStatus = 'running' | 'passed' | 'partial' | 'failed' | 'interrupted'
export type ScriptStatus = 'ready' | ScriptRunStatus | 'disabled'
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
  bodyReadError?: string
  warning?: boolean
  incomplete?: boolean
  phase?: string
  pageUrl?: string
  frameUrl?: string
  mimeType?: string
  failureKind?: ScriptNetworkFailureKind
  isFirstParty?: boolean
  ignored?: boolean
  diagnostics?: string[]
  streaming?: boolean
}

export type ScriptNetworkFailureKind = string

export interface ScriptResourceResponse {
  sequence: number
  timestamp: string
  name: string
  method: string
  url: string
  resourceType: string
  status: number
  ok: boolean
  durationMs: number
  phase?: string
  pageUrl?: string
  frameUrl?: string
  mimeType?: string
  error?: string
  failureKind?: ScriptNetworkFailureKind
  fromCache?: boolean
  fromServiceWorker?: boolean
  isFirstParty?: boolean
  ignored?: boolean
  diagnostics?: string[]
  streaming?: boolean
  warning?: boolean
  incomplete?: boolean
}

export interface ScriptNetworkCategorySummary {
  observed: number
  recorded: number
  dropped: number
  passed: number
  failed: number
  warnings: number
}

export interface ScriptNetworkSummary {
  api: ScriptNetworkCategorySummary
  resources: ScriptNetworkCategorySummary
}

export interface ScriptArtifact {
  executionId: string
  stepId: string
  attemptId: string
  absolutePath: string
  relativePath: string
  type: string
  mimeType: string
  sizeBytes: number
  createdAt: string
}

export interface ScriptRunResult {
  ok: boolean
  status?: ScriptRunStatus
  continuePipeline?: boolean
  cancelled?: boolean
  timedOut?: boolean
  durationMs: number
  logs: ScriptRunLog[]
  assertions?: ScriptAssertionResult[]
  apiResponses?: ScriptApiResponse[]
  resourceResponses?: ScriptResourceResponse[]
  networkSummary?: ScriptNetworkSummary
  artifacts?: ScriptArtifact[]
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
  createdAt: string
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
  environmentCode?: string
  executionId?: string
  failBatchOnError?: boolean
  siteBaseUrl: string
  apiBaseUrl: string
  ignoreHTTPSErrors: boolean
  variables: Record<string, string>
  authorizationOrigin: string
  extraHTTPHeaders: Record<string, string>
}
