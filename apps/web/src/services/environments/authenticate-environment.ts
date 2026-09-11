import type { TestEnvironment } from '@/domain/environment'
import type { RuntimeVariable } from '@/domain/runtime-variable'
import type { RuntimeVariableService } from '@/services/runtime-variables/runtime-variable-service'
import { applyResponseVariable } from './apply-response-variable'
import type { EnvironmentLoginService } from './environment-login-service'
import type { EnvironmentSessionService } from './local-environment-session.service'

interface AuthenticationDependencies {
  environmentLogin: EnvironmentLoginService
  environmentSessions?: EnvironmentSessionService
  runtimeVariables: RuntimeVariableService
}

export function authenticationSuccessMessage(environment: TestEnvironment): string {
  return environment.auth.strategy === 'reuse-session'
    ? `${environment.name}已加载保存的登录态，本次未调用登录接口；有效性以业务服务校验为准`
    : `${environment.name}登录成功，运行时 Token 已刷新`
}

export async function authenticateEnvironment(
  environment: TestEnvironment,
  dependencies: AuthenticationDependencies,
  isCancelled: () => boolean = () => false,
): Promise<RuntimeVariable | null> {
  if (environment.auth.strategy === 'reuse-session') {
    const session = dependencies.environmentSessions?.get(environment)
    if (!session) throw new Error(`“${environment.name}”没有匹配的登录态，请到环境管理 → 管理登录态导入；环境地址变更后需要重新导入`)
    if (session.expiresAt !== null && session.expiresAt <= Date.now()) {
      throw new Error(`“${environment.name}”的登录态已过期，请手动登录后到环境管理更新登录态`)
    }
    const key = environment.auth.tokenVariable.trim()
    if (!key) throw new Error(`环境“${environment.name}”未配置 Token 变量名`)
    if (isCancelled()) return null
    return dependencies.runtimeVariables.upsert({
      key,
      value: session.token,
      secret: true,
      authorizationScheme: session.scheme,
      sourceEnvironmentId: environment.id,
      sourcePath: 'saved-session',
    })
  }

  const loginResult = await dependencies.environmentLogin.login(environment)
  if (isCancelled()) return null
  if (!loginResult.businessSuccess) {
    const status = loginResult.status ? `HTTP ${loginResult.status}` : '未收到 HTTP 响应'
    throw new Error(loginResult.error || `环境登录失败（${status}），请检查登录配置和业务成功规则`)
  }
  const runtimeToken = applyResponseVariable({
    variableName: environment.auth.tokenVariable,
    responsePath: environment.auth.tokenPath,
  }, environment, loginResult, dependencies.runtimeVariables)
  if (!runtimeToken) throw new Error(`登录成功，但无法从 ${environment.auth.tokenPath} 提取 Token`)
  return runtimeToken
}
