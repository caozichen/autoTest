import type { AutomationPipeline } from '@/domain/automation-pipeline'

interface ScriptRemovalDependencies {
  listAutomationPipelines(): Promise<AutomationPipeline[]>
  removeScript(scriptId: string): Promise<void>
}

export type ScriptRemovalResult =
  | { removed: true }
  | { removed: false; usages: AutomationPipeline[] }

export function automationPipelinesUsingScript(
  pipelines: readonly AutomationPipeline[],
  scriptId: string,
): AutomationPipeline[] {
  return pipelines.filter((pipeline) => pipeline.steps.some((step) => (
    step.scriptId === scriptId
    || step.parameterMappings.some((mapping) => mapping.sourceScriptId === scriptId)
  )))
}

export function scriptUsageWarning(pipelines: readonly AutomationPipeline[]): string {
  const names = [...new Set(pipelines.map((pipeline) => pipeline.name.trim()).filter(Boolean))]
  const detail = names.length > 0 ? `“${names.join('、')}”` : ''
  return `该脚本已用于自动化配置${detail}，请先解除自动化配置后再从列表移除`
}

export async function removeScriptFromListIfUnused(
  scriptId: string,
  dependencies: ScriptRemovalDependencies,
): Promise<ScriptRemovalResult> {
  const pipelines = await dependencies.listAutomationPipelines()
  const usages = automationPipelinesUsingScript(pipelines, scriptId)
  if (usages.length > 0) return { removed: false, usages }

  await dependencies.removeScript(scriptId)
  return { removed: true }
}
