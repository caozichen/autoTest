import type { UpdateRunScriptProgressDraft } from '@/domain/run-record'
import type { AutomationScript } from '@/domain/script'
import { extractScriptResponseVariables } from '@/services/scripts/script-response-variables'

function progressStatus(script: AutomationScript): UpdateRunScriptProgressDraft['status'] | null {
  if (
    script.status === 'running'
    || script.status === 'passed'
    || script.status === 'partial'
    || script.status === 'failed'
  ) {
    return script.status
  }
  return null
}

export function createRunScriptProgressDraft(
  script: AutomationScript,
  secretValues: string[] = [],
): UpdateRunScriptProgressDraft | null {
  const status = progressStatus(script)
  if (!status) return null

  const result = script.lastRunResult ?? { ok: false, durationMs: 0, logs: [] }
  const extractedSecrets = extractScriptResponseVariables(script, result).extracted
    .filter(({ binding }) => binding.secret)
    .map(({ value }) => value)

  return {
    scriptId: script.id,
    status,
    durationMs: result.durationMs,
    logs: result.logs,
    ...(result.assertions ? { assertions: result.assertions } : {}),
    ...(result.apiResponses ? { apiResponses: result.apiResponses } : {}),
    ...(result.resourceResponses ? { resourceResponses: result.resourceResponses } : {}),
    ...(result.networkSummary ? { networkSummary: result.networkSummary } : {}),
    ...(result.artifacts ? { artifacts: result.artifacts } : {}),
    ...(result.output ? { output: result.output } : {}),
    ...(result.error ? { error: result.error } : {}),
    secretValues: [...secretValues, ...extractedSecrets].filter(Boolean),
  }
}
