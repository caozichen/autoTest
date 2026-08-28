import { reactive } from 'vue'
import { describe, expect, it } from 'vitest'

import {
  cloneEnvironmentDraft,
  formatEnvironmentRequestBody,
  parseEnvironmentRequestBody,
  type TestEnvironment,
} from './environment'

describe('environment request body', () => {
  it('accepts and formats a JSON object', () => {
    const body = parseEnvironmentRequestBody('{"mobile":"13671153204","nested":{"enabled":true}}')

    expect(body).toEqual({ mobile: '13671153204', nested: { enabled: true } })
    expect(formatEnvironmentRequestBody(body)).toContain('\n  "mobile"')
  })

  it.each(['', '[]', 'null', '{invalid'])('rejects an invalid request body: %s', (value) => {
    expect(() => parseEnvironmentRequestBody(value)).toThrow()
  })
})

describe('cloneEnvironmentDraft', () => {
  it('copies Vue reactive environments into an editable plain draft', () => {
    const environment = reactive<TestEnvironment>({
      id: 'env-testing',
      name: '测试环境',
      code: 'TEST',
      description: '响应式环境',
      baseUrl: 'https://example.com/',
      apiBaseUrl: 'https://example.com/api',
      ignoreHTTPSErrors: true,
      enabled: true,
      active: true,
      auth: {
        mode: 'mobile-code',
        method: 'POST',
        timeoutMs: 45_000,
        loginPath: '/login/mobile',
        requestBody: '{"mobile":"13671153204","verify_code":"666666"}',
        username: '',
        password: '',
        mobile: '13671153204',
        verifyCode: '666666',
        successPath: 'code',
        successValue: '0',
        tokenPath: 'data.token',
        tokenVariable: 'AUTH_TOKEN',
        tokenTypePath: 'data.token_type',
        tokenTypeFallback: 'Bearer',
      },
      variables: [{
        id: 'variable-1',
        key: 'REGION',
        value: 'cn',
        description: '区域',
        secret: false,
        enabled: true,
      }],
      updatedAt: '暂无数据',
    })

    const draft = cloneEnvironmentDraft(environment)
    draft.auth.requestBody = '{"mobile":"13900000000"}'
    const firstVariable = draft.variables[0]
    expect(firstVariable).toBeDefined()
    if (firstVariable) firstVariable.value = 'hk'

    expect(draft).not.toHaveProperty('id')
    expect(environment.auth.requestBody).toContain('13671153204')
    expect(environment.variables[0]?.value).toBe('cn')
  })
})
