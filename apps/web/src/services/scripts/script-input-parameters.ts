import type { ScriptInputParameter } from '@/domain/script'

export function cloneScriptInputParameters(
  parameters: readonly ScriptInputParameter[] = [],
): ScriptInputParameter[] {
  return parameters.map((parameter) => ({ ...parameter }))
}

export function normalizeScriptInputParameters(
  parameters: readonly ScriptInputParameter[] = [],
): ScriptInputParameter[] {
  const normalized = parameters.map((parameter) => ({
    id: parameter.id.trim() || crypto.randomUUID(),
    key: parameter.key.trim(),
    value: parameter.value.trim(),
    description: parameter.description.trim(),
  }))

  if (normalized.some((parameter) => !parameter.key)) {
    throw new Error('请输入输入参数名')
  }

  const keys = normalized.map((parameter) => parameter.key.toLowerCase())
  if (new Set(keys).size !== keys.length) throw new Error('同一脚本不能配置重复的输入参数')
  return normalized
}

export function scriptInputParameterDefaults(
  parameters: readonly ScriptInputParameter[] = [],
): Record<string, string> {
  return Object.fromEntries(parameters.flatMap((parameter) => {
    const key = parameter.key.trim()
    return key ? [[key, parameter.value.trim()] as const] : []
  }))
}
