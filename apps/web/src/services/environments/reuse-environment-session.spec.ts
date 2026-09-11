import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestEnvironment } from '@/domain/environment'
import { LocalEnvironmentService } from './local-environment.service'
import { LocalEnvironmentSessionService } from './local-environment-session.service'
import { authenticateEnvironment } from './authenticate-environment'
import { SessionRuntimeVariableService } from '@/services/runtime-variables/session-runtime-variable.service'
import { buildScriptRunContext } from '@/services/scripts/script-run-context'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

describe('reusable environment authentication', () => {
  let environment: TestEnvironment
  let storage: Storage
  let sessions: LocalEnvironmentSessionService
  let runtimeVariables: SessionRuntimeVariableService
  const login = vi.fn()

  beforeEach(async () => {
    environment = (await new LocalEnvironmentService(new MemoryStorage()).list())[0]!
    environment.auth.strategy = 'reuse-session'
    storage = new MemoryStorage()
    sessions = new LocalEnvironmentSessionService(storage)
    runtimeVariables = new SessionRuntimeVariableService(new MemoryStorage())
    login.mockReset()
  })

  function authenticate(target = environment) {
    return authenticateEnvironment(target, {
      environmentSessions: sessions,
      environmentLogin: { login },
      runtimeVariables,
    })
  }

  it('persists the opt-in strategy without changing existing login configuration', async () => {
    const envs = new LocalEnvironmentService(storage)
    const original = (await envs.list())[0]!
    expect(original.auth.strategy).toBeUndefined()
    await envs.update(original.id, { ...original, auth: { ...original.auth, strategy: 'reuse-session' } })
    const restored = (await new LocalEnvironmentService(storage).list())[0]!
    expect(restored.auth).toEqual({ ...original.auth, strategy: 'reuse-session' })
    await envs.update(original.id, { ...restored, auth: { ...restored.auth, strategy: 'login' } })
    expect((await new LocalEnvironmentService(storage).list())[0]!.auth).toEqual(original.auth)
  })

  it.each(['example-token', 'Bearer example-token'])('restores %s and skips login even with an invalid login payload', async (token) => {
    sessions.save(environment, { token, accountLabel: '测试账号' })
    sessions = new LocalEnvironmentSessionService(storage)
    environment.auth.requestBody = 'not JSON'
    const authenticated = await authenticate()
    expect(login).not.toHaveBeenCalled()
    expect(authenticated).toMatchObject({ value: 'example-token', secret: true, sourceEnvironmentId: environment.id })
    const context = buildScriptRunContext(environment, runtimeVariables, authenticated!)
    expect(context.extraHTTPHeaders).toEqual({ Authorization: 'Bearer example-token' })
    expect(context.variables.AUTH_TOKEN).toBe('example-token')
  })

  it('preserves an explicitly imported authorization scheme', async () => {
    sessions.save(environment, { token: 'Token custom-token', accountLabel: '' })
    const authenticated = await authenticate()
    expect(buildScriptRunContext(environment, runtimeVariables, authenticated!).extraHTTPHeaders.Authorization)
      .toBe('Token custom-token')
  })

  it('isolates saved sessions by environment and full site/API addresses', async () => {
    sessions.save(environment, { token: 'token-one', accountLabel: '账号一' })
    for (const other of [
      { ...environment, id: 'env-other' },
      { ...environment, baseUrl: 'https://other.test/' },
      { ...environment, apiBaseUrl: 'https://other.test/api' },
      { ...environment, apiBaseUrl: environment.apiBaseUrl + '/other-tenant' },
    ]) {
      expect(sessions.get(other)).toBeNull()
      await expect(authenticate(other)).rejects.toThrow('没有匹配的登录态')
    }
    const second = { ...environment, id: 'env-two' }
    sessions.save(second, { token: 'token-two', accountLabel: '账号二' })
    expect((await authenticate(second))?.value).toBe('token-two')
    expect((await authenticate())?.value).toBe('token-one')
    expect(login).not.toHaveBeenCalled()
  })

  it('does not fall back to a stale runtime token when saved state is missing or cleared', async () => {
    sessions.save(environment, { token: 'token-one', accountLabel: '' })
    await authenticate()
    sessions.clear(environment.id)
    expect(runtimeVariables.get('AUTH_TOKEN')).not.toBeNull()
    await expect(authenticate()).rejects.toThrow('没有匹配的登录态')
    expect(login).not.toHaveBeenCalled()
  })

  it('updates accounts explicitly and survives clearing ephemeral runtime variables', async () => {
    sessions.save(environment, { token: 'first-token', accountLabel: '一' })
    await authenticate()
    runtimeVariables.clear()
    sessions.save(environment, { token: 'second-token', accountLabel: '二' })
    expect((await authenticate())?.value).toBe('second-token')
    expect(sessions.get(environment)?.accountLabel).toBe('二')
  })

  it('rejects expired JWTs and uses the earlier expiry', () => {
    const token = (exp: number) => `header.${btoa(JSON.stringify({ exp }))}.signature`
    expect(() => sessions.save(environment, { token: token(1), accountLabel: '' })).toThrow('已过期')
    const future = Math.floor(Date.now() / 1000) + 3600
    const saved = sessions.save(environment, { token: token(future), accountLabel: '', expiresAt: (future + 1000) * 1000 })
    expect(saved.expiresAt).toBe(future * 1000)
    expect(sessions.save(environment, { token: token(future), accountLabel: '', expiresAt: (future - 1000) * 1000 }).expiresAt)
      .toBe((future - 1000) * 1000)
  })

  it('blocks a session that expires between import and run, without calling login', async () => {
    const expiredSessions = new LocalEnvironmentSessionService(storage, () => 1000)
    expiredSessions.save(environment, { token: 'expired-token', accountLabel: '', expiresAt: 2000 })
    await expect(authenticate()).rejects.toThrow('已过期')
    expect(login).not.toHaveBeenCalled()
    expect(runtimeVariables.list()).toEqual([])
  })

  it.each(['', 'Authorization: Bearer secret', 'Bearer secret\nsecond-line', '{"token":"secret"}', '"secret"'])('rejects malformed pasted input without exposing it: %s', (token) => {
    expect(() => sessions.save(environment, { token, accountLabel: '' })).toThrow(/请/)
    expect(sessions.get(environment)).toBeNull()
  })

  it('reports a persistence failure instead of claiming the token was saved', () => {
    vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(() => sessions.save(environment, { token: 'secret', accountLabel: '' })).toThrow('无法保存登录态')
  })

  it('ignores corrupted storage safely', () => {
    storage.setItem('autotest.environment-session.v1.' + environment.id, '{bad json')
    expect(sessions.get(environment)).toBeNull()
  })

  it('keeps the authenticated token stable if another run overwrites the global variable', async () => {
    sessions.save(environment, { token: 'first-token', accountLabel: '' })
    const authenticated = await authenticate()
    const other = { ...environment, id: 'other-env' }
    sessions.save(other, { token: 'second-token', accountLabel: '' })
    await authenticate(other)
    const context = buildScriptRunContext(environment, runtimeVariables, authenticated!)
    expect(context.extraHTTPHeaders.Authorization).toBe('Bearer first-token')
    expect(context.variables.AUTH_TOKEN).toBe('first-token')
    expect(() => buildScriptRunContext(other, runtimeVariables, authenticated!)).toThrow('不匹配')
  })

  it('keeps calling the configured login API in the default mode even if a saved token exists', async () => {
    delete environment.auth.strategy
    sessions.save(environment, { token: 'saved-token', accountLabel: '' })
    login.mockResolvedValue({ businessSuccess: true, responseBody: { data: { token: 'new-token', token_type: 'Bearer' } } })
    expect((await authenticate())?.value).toBe('new-token')
    expect(login).toHaveBeenCalledExactlyOnceWith(environment)
  })
})
