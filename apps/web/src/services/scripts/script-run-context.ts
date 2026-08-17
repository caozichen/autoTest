import type { TestEnvironment } from '@/domain/environment'
import type { ScriptRunContext } from '@/domain/script'
import type { RuntimeVariableService } from '@/services/runtime-variables/runtime-variable-service'

export function buildScriptRunContext(
  environment: TestEnvironment,
  runtimeVariables: RuntimeVariableService,
): ScriptRunContext {
  const tokenKey = environment.auth.tokenVariable.trim()
  if (!tokenKey) throw new Error(`环境“${environment.name}”未配置 Token 变量名`)

  const variables = Object.fromEntries([
    ...environment.variables
      .filter((variable) => variable.enabled)
      .map((variable) => [variable.key, variable.value] as const),
    ...runtimeVariables.list()
      .map((variable) => [variable.key, variable.value] as const),
  ])
  const authorization = runtimeVariables.buildAuthorizationHeader(
    tokenKey,
    environment.auth.tokenTypeFallback,
  )
  if (!authorization) {
    throw new Error(`运行脚本前请先登录“${environment.name}”，缺少全局变量 {{${tokenKey}}}`)
  }

  let authorizationOrigin: string
  let apiHostname: string
  try {
    const apiUrl = new URL(environment.apiBaseUrl)
    authorizationOrigin = apiUrl.origin
    apiHostname = apiUrl.hostname
  } catch {
    throw new Error(`环境“${environment.name}”的 API 地址无效`)
  }

  return {
    environmentId: environment.id,
    siteBaseUrl: environment.baseUrl,
    apiBaseUrl: environment.apiBaseUrl,
    ignoreHTTPSErrors: environment.ignoreHTTPSErrors ?? apiHostname === 'lx.admin.lingxi.tech',
    variables,
    authorizationOrigin,
    extraHTTPHeaders: { Authorization: authorization },
  }
}
