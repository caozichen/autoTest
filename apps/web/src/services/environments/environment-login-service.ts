import type { EnvironmentLoginResult } from '@/domain/environment-login'
import type { TestEnvironment } from '@/domain/environment'

import type { EnvironmentSession } from './local-environment-session.service'

export interface EnvironmentLoginService {
  login(environment: TestEnvironment, session?: EnvironmentSession | null): Promise<EnvironmentLoginResult>
}
