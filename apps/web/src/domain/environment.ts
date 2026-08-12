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
