import type { TestEnvironment } from '@/domain/environment'

const STORAGE_PREFIX = 'autotest.environment-session.v1.'

export interface EnvironmentSession {
  environmentId: string
  siteUrl: string
  apiUrl: string
  token: string
  scheme: string
  accountLabel: string
  savedAt: string
  expiresAt: number | null
}

export interface EnvironmentSessionDraft {
  token: string
  accountLabel: string
  expiresAt?: number | null
}

export interface EnvironmentSessionService {
  get(environment: TestEnvironment): EnvironmentSession | null
  save(environment: TestEnvironment, draft: EnvironmentSessionDraft): EnvironmentSession
  clear(environmentId: string): void
}

function normalizedUrl(value: string): string {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('登录态绑定的环境地址必须是有效的 HTTP(S) 地址')
  }
  return url.href.replace(/\/+$/, '')
}

// JWT expiry is a local hint only. The server remains authoritative about validity.
function jwtExpiry(token: string): number | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')))
    return typeof claims?.exp === 'number' && Number.isFinite(claims.exp)
      ? claims.exp * 1000
      : null
  } catch {
    return null
  }
}

export class LocalEnvironmentSessionService implements EnvironmentSessionService {
  constructor(
    private readonly storage: Storage = window.localStorage,
    private readonly now: () => number = Date.now,
  ) {}

  get(environment: TestEnvironment): EnvironmentSession | null {
    try {
      const raw = this.storage.getItem(STORAGE_PREFIX + environment.id)
      if (!raw) return null
      const value = JSON.parse(raw) as EnvironmentSession
      if (!value || value.environmentId !== environment.id
        || value.siteUrl !== normalizedUrl(environment.baseUrl)
        || value.apiUrl !== normalizedUrl(environment.apiBaseUrl)
        || typeof value.token !== 'string' || !value.token || /\s/.test(value.token)
        || typeof value.scheme !== 'string' || !/^[A-Za-z][A-Za-z0-9+.-]*$/.test(value.scheme)
        || typeof value.accountLabel !== 'string' || typeof value.savedAt !== 'string'
        || !(value.expiresAt === null || (typeof value.expiresAt === 'number' && Number.isFinite(value.expiresAt)))) {
        return null
      }
      return value
    } catch {
      return null
    }
  }

  save(environment: TestEnvironment, draft: EnvironmentSessionDraft): EnvironmentSession {
    let token = draft.token.trim()
    let scheme = environment.auth.tokenTypeFallback.trim() || 'Bearer'
    const header = /^([A-Za-z][A-Za-z0-9+.-]*)[ \t]+(\S+)$/.exec(token)
    if (header) {
      scheme = header[1]!
      token = header[2]!
    }
    if (!token || /\s/.test(token) || !/^[A-Za-z][A-Za-z0-9+.-]*$/.test(scheme)) {
      throw new Error('请粘贴 Token 值或完整的 Authorization 值，不要包含字段名、引号或换行')
    }
    if (/^["'{\[]/.test(token) || /^Authorization:/i.test(token)) {
      throw new Error('请仅粘贴 Token 值，不要粘贴 JSON 或 Authorization 字段名')
    }
    const expiries = [jwtExpiry(token), draft.expiresAt].filter((value): value is number => value != null)
    if (expiries.some((value) => !Number.isFinite(value))) throw new Error('失效时间无效')
    const expiresAt = expiries.length ? Math.min(...expiries) : null
    if (expiresAt !== null && expiresAt <= this.now()) throw new Error('登录态已过期，请重新登录后导入')
    const session: EnvironmentSession = {
      environmentId: environment.id,
      siteUrl: normalizedUrl(environment.baseUrl),
      apiUrl: normalizedUrl(environment.apiBaseUrl),
      token,
      scheme,
      accountLabel: draft.accountLabel.trim(),
      savedAt: new Date(this.now()).toISOString(),
      expiresAt,
    }
    try {
      this.storage.setItem(STORAGE_PREFIX + environment.id, JSON.stringify(session))
    } catch {
      throw new Error('当前浏览器无法保存登录态，请检查本地存储权限或空间')
    }
    return session
  }

  clear(environmentId: string): void {
    this.storage.removeItem(STORAGE_PREFIX + environmentId)
  }
}
