import type { EnvironmentLoginResult } from '@/domain/environment-login'
import type { TestEnvironment } from '@/domain/environment'

export interface EnvironmentLoginService {
  login(environment: TestEnvironment): Promise<EnvironmentLoginResult>
}
