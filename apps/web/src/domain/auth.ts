export interface LoginCredentials {
  username: string
  password: string
}

export interface AuthUser {
  id: string
  username: string
  displayName: string
  role: 'administrator'
}

export interface AuthSession {
  token: string
  expiresAt: number
  user: AuthUser
}

export class AuthenticationError extends Error {
  constructor(message = '用户名或密码错误') {
    super(message)
    this.name = 'AuthenticationError'
  }
}
