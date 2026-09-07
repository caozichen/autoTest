import { getValueAtPath, stringifyRuntimeVariableValue } from '@/domain/object-path'
import type {
  AutomationScript,
  ScriptResponseVariableBinding,
  ScriptRunResult,
} from '@/domain/script'
import type { RuntimeVariable } from '@/domain/runtime-variable'
import type { RuntimeVariableService } from '@/services/runtime-variables/runtime-variable-service'

export interface ExtractedScriptVariable {
  binding: ScriptResponseVariableBinding
  value: string
}

export interface ScriptVariableExtractionReport {
  extracted: ExtractedScriptVariable[]
  failed: ScriptResponseVariableBinding[]
}

export interface AppliedScriptVariableReport extends ScriptVariableExtractionReport {
  applied: RuntimeVariable[]
}

export function normalizeScriptResponseVariableBindings(
  bindings: ScriptResponseVariableBinding[] = [],
): ScriptResponseVariableBinding[] {
  const normalized = bindings.map((binding) => ({
    id: binding.id || crypto.randomUUID(),
    variableName: binding.variableName.trim(),
    responsePath: binding.responsePath.trim(),
    secret: binding.secret === true,
  }))
  if (normalized.some((binding) => !binding.variableName || !binding.responsePath)) {
    throw new Error('请完整填写响应路径和全局变量名')
  }

  const names = normalized.map((binding) => binding.variableName.toLowerCase())
  if (new Set(names).size !== names.length) throw new Error('同一脚本不能重复提取同名变量')
  return normalized
}

export function extractScriptResponseVariables(
  script: Pick<AutomationScript, 'responseVariableBindings'>,
  result: ScriptRunResult,
): ScriptVariableExtractionReport {
  const bindings = script.responseVariableBindings ?? []
  const completedWithUsableOutput = result.ok || result.continuePipeline === true
  if (!completedWithUsableOutput || !result.output || bindings.length === 0) {
    return { extracted: [], failed: [] }
  }

  const extracted: ExtractedScriptVariable[] = []
  const failed: ScriptResponseVariableBinding[] = []
  for (const binding of bindings) {
    const value = stringifyRuntimeVariableValue(getValueAtPath(result.output, binding.responsePath))
    if (value === null || !value.trim()) {
      failed.push(binding)
      continue
    }
    extracted.push({ binding, value })
  }
  return { extracted, failed }
}

export function applyScriptResponseVariables(
  script: Pick<AutomationScript, 'id' | 'responseVariableBindings'>,
  result: ScriptRunResult,
  environmentId: string,
  runtimeVariables: RuntimeVariableService,
): AppliedScriptVariableReport {
  const report = extractScriptResponseVariables(script, result)
  const applied = report.extracted.map(({ binding, value }) => runtimeVariables.upsert({
    key: binding.variableName,
    value,
    secret: binding.secret,
    sourceEnvironmentId: environmentId,
    sourceScriptId: script.id,
    sourcePath: binding.responsePath,
  }))
  return { ...report, applied }
}
