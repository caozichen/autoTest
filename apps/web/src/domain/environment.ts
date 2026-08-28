export interface EnvironmentVariable {
  id: string
  key: string
  value: string
  description: string
  secret: boolean
  enabled: boolean
}

export type EnvironmentLoginMode = 'password' | 'mobile-code'
export type EnvironmentLoginMethod = 'POST' | 'PUT' | 'PATCH'

export interface EnvironmentAuthConfig {
  mode: EnvironmentLoginMode
  method: EnvironmentLoginMethod
  timeoutMs: number
  loginPath: string
  requestBody: string
  username: string
  password: string
  mobile: string
  verifyCode: string
  successPath: string
  successValue: string
  tokenPath: string
  tokenVariable: string
  tokenTypePath: string
  tokenTypeFallback: string
}

export interface TestEnvironment {
  id: string
  name: string
  code: string
  description: string
  baseUrl: string
  apiBaseUrl: string
  ignoreHTTPSErrors: boolean
  enabled: boolean
  active: boolean
  auth: EnvironmentAuthConfig
  variables: EnvironmentVariable[]
  updatedAt: string
}

export type EnvironmentDraft = Omit<TestEnvironment, 'id' | 'active' | 'updatedAt'>

export type EnvironmentRequestBody = Record<string, unknown>

export function parseEnvironmentRequestBody(value: string): EnvironmentRequestBody {
  if (!value.trim()) throw new Error('请求体不能为空')

  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    throw new Error('请求体必须是合法的 JSON')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('请求体必须是 JSON 对象')
  }
  return parsed as EnvironmentRequestBody
}

export function formatEnvironmentRequestBody(body: EnvironmentRequestBody): string {
  return JSON.stringify(body, null, 2)
}

export function cloneEnvironmentDraft(environment: EnvironmentDraft): EnvironmentDraft {
  return {
    name: environment.name,
    code: environment.code,
    description: environment.description,
    baseUrl: environment.baseUrl,
    apiBaseUrl: environment.apiBaseUrl,
    ignoreHTTPSErrors: environment.ignoreHTTPSErrors,
    enabled: environment.enabled,
    auth: { ...environment.auth },
    variables: environment.variables.map((variable) => ({ ...variable })),
  }
}
