import { runtimeConfig } from '@/config/runtime'
import { AuthenticationError, type AuthSession, type LoginCredentials } from '@/domain/auth'
import type { AuthService } from './auth-service'

const SESSION_TTL = 8 * 60 * 60 * 1000

function isAuthSession(value: unknown): value is AuthSession {
  if (!value || typeof value !== 'object') return false

  const session = value as Partial<AuthSession>
  return (
    typeof session.token === 'string' &&
    typeof session.expiresAt === 'number' &&
    typeof session.user?.id === 'string' &&
    typeof session.user.username === 'string'
  )
}

export class LocalAuthService implements AuthService {
  constructor(private readonly storage: Storage = window.sessionStorage) {}

  async login(credentials: LoginCredentials): Promise<AuthSession> {
    const username = credentials.username.trim()
    const expected = runtimeConfig.localCredentials

    if (username !== expected.username || credentials.password !== expected.password) {
      throw new AuthenticationError()
    }

    const session: AuthSession = {
      token: crypto.randomUUID(),
      expiresAt: Date.now() + SESSION_TTL,
      user: {
        id: 'local-admin',
        username,
        displayName: '自动化管理员',
        role: 'administrator',
      },
    }

    this.storage.setItem(runtimeConfig.sessionStorageKey, JSON.stringify(session))
    return session
  }

  async restore(): Promise<AuthSession | null> {
    const raw = this.storage.getItem(runtimeConfig.sessionStorageKey)
    if (!raw) return null

    try {
      const session: unknown = JSON.parse(raw)
      if (!isAuthSession(session) || session.expiresAt <= Date.now()) {
        this.storage.removeItem(runtimeConfig.sessionStorageKey)
        return null
      }
      return session
    } catch {
      this.storage.removeItem(runtimeConfig.sessionStorageKey)
      return null
    }
  }

  async logout(): Promise<void> {
    this.storage.removeItem(runtimeConfig.sessionStorageKey)
  }
}
