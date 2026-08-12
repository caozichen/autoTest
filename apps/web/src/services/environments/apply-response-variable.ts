import type { EnvironmentLoginResult, ResponseVariableBinding } from '@/domain/environment-login'
import type { TestEnvironment } from '@/domain/environment'
import { getValueAtPath, stringifyExtractedValue } from '@/domain/object-path'
import type { RuntimeVariable } from '@/domain/runtime-variable'
import type { RuntimeVariableService } from '@/services/runtime-variables/runtime-variable-service'

export function applyResponseVariable(
  binding: ResponseVariableBinding,
  environment: TestEnvironment,
  result: EnvironmentLoginResult,
  runtimeVariables: RuntimeVariableService,
): RuntimeVariable | null {
  if (!result.businessSuccess) return null

  const key = binding.variableName.trim()
  const path = binding.responsePath.trim()
  const value = stringifyExtractedValue(getValueAtPath(result.responseBody, path))
  if (!key || !path || !value?.trim()) return null
  const extractedScheme = stringifyExtractedValue(
    getValueAtPath(result.responseBody, environment.auth.tokenTypePath),
  )

  return runtimeVariables.upsert({
    key,
    value,
    secret: true,
    authorizationScheme: extractedScheme?.trim() || environment.auth.tokenTypeFallback.trim() || 'Bearer',
    sourceEnvironmentId: environment.id,
    sourcePath: path,
  })
}
