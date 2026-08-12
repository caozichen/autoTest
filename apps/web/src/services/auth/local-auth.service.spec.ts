import { describe, expect, it } from 'vitest'

import { AuthenticationError } from '@/domain/auth'
import { LocalAuthService } from './local-auth.service'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe('LocalAuthService', () => {
  it('creates and restores a valid local session', async () => {
    const service = new LocalAuthService(new MemoryStorage())
    const session = await service.login({ username: 'admin', password: 'admin123' })

    expect(session.user.username).toBe('admin')
    await expect(service.restore()).resolves.toEqual(session)
  })

  it('rejects invalid credentials', async () => {
    const service = new LocalAuthService(new MemoryStorage())

    await expect(service.login({ username: 'admin', password: 'invalid' })).rejects.toBeInstanceOf(AuthenticationError)
  })

  it('removes the session on logout', async () => {
    const service = new LocalAuthService(new MemoryStorage())
    await service.login({ username: 'admin', password: 'admin123' })
    await service.logout()

    await expect(service.restore()).resolves.toBeNull()
  })
})
