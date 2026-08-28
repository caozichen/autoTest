export type ScriptAssertionStatus = 'passed' | 'failed'

export interface ScriptAssertionResult {
  sequence: number
  timestamp: string
  name: string
  module: string
  matcher: string
  status: ScriptAssertionStatus
  durationMs: number
  error?: string
}
