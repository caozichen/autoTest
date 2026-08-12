import type { AuthSession, LoginCredentials } from '@/domain/auth'

export interface AuthService {
  login(credentials: LoginCredentials): Promise<AuthSession>
  restore(): Promise<AuthSession | null>
  logout(): Promise<void>
}
