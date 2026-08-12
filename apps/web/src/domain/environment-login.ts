export interface EnvironmentLoginResult {
  businessSuccess: boolean
  ok: boolean
  status: number | null
  statusText: string
  targetUrl: string
  durationMs: number
  receivedAt: string
  requestBody: Record<string, string>
  responseBody: unknown
  rawResponse: string
  responseHeaders: Record<string, string>
  extractedToken?: unknown
  extractedTokenType?: unknown
  error?: string
}

export interface ResponseVariableBinding {
  variableName: string
  responsePath: string
}
