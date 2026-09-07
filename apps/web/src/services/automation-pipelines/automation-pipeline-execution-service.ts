import type { AutomationPipeline, AutomationPipelineStep } from '@/domain/automation-pipeline'
import type { TestEnvironment } from '@/domain/environment'
import { getValueAtPath, stringifyRuntimeVariableValue } from '@/domain/object-path'
import type {
  CompleteRunScriptDraft,
  RunFailureStage,
  RunRecord,
} from '@/domain/run-record'
import type { AutomationScript, ScriptRunContext, ScriptRunResult } from '@/domain/script'
import { applyResponseVariable } from '@/services/environments/apply-response-variable'
import type { EnvironmentLoginService } from '@/services/environments/environment-login-service'
import type { EnvironmentService } from '@/services/environments/environment-service'
import type { RunRecordService } from '@/services/run-records/run-record-service'
import { createRunScriptProgressDraft } from '@/services/run-records/script-run-progress'
import type { RuntimeVariableService } from '@/services/runtime-variables/runtime-variable-service'
import { buildScriptRunContext } from '@/services/scripts/script-run-context'
import { applyScriptResponseVariables } from '@/services/scripts/script-response-variables'
import type { ScriptService } from '@/services/scripts/script-service'

export interface AutomationPipelineStopResult {
  stopped: boolean
  runnerFound: boolean
  cancelledRunIds: string[]
  cleanupTimedOutRunIds?: string[]
}

export interface AutomationPipelineExecutionService {
  run(pipeline: AutomationPipeline): Promise<RunRecord>
  stop(pipelineId: string): Promise<AutomationPipelineStopResult>
  stopByRecordId(recordId: string): Promise<AutomationPipelineStopResult>
  isRunning(pipelineId: string): boolean
}

export interface AutomationPipelineExecutionDependencies {
  environments: EnvironmentService
  environmentLogin: EnvironmentLoginService
  runtimeVariables: RuntimeVariableService
  scripts: ScriptService
  runRecords: RunRecordService
}

function errorMessage(error: unknown, fallback = '流水线执行失败'): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

function environmentSecrets(environment: TestEnvironment): string[] {
  return [
    environment.auth.password,
    environment.auth.verifyCode,
    environment.auth.mobile,
    ...environment.variables
      .filter((variable) => variable.secret)
      .map((variable) => variable.value),
  ].filter(Boolean)
}

function scriptSnapshot(script: AutomationScript) {
  return {
    id: script.id,
    name: script.name,
    directory: script.directory,
    entryFile: script.entryFile,
    tags: [...script.tags],
  }
}

function resultCompletion(scriptId: string, result: ScriptRunResult): CompleteRunScriptDraft {
  return {
    scriptId,
    status: result.ok ? 'passed' : 'failed',
    ok: result.ok,
    durationMs: result.durationMs,
    logs: result.logs,
    ...(result.assertions ? { assertions: result.assertions } : {}),
    ...(result.apiResponses ? { apiResponses: result.apiResponses } : {}),
    ...(result.resourceResponses ? { resourceResponses: result.resourceResponses } : {}),
    ...(result.networkSummary ? { networkSummary: result.networkSummary } : {}),
    ...(result.artifacts ? { artifacts: result.artifacts } : {}),
    ...(result.output ? { output: result.output } : {}),
    ...(result.error ? { error: result.error } : {}),
  }
}

function failedCompletion(scriptId: string, message: string): CompleteRunScriptDraft {
  return {
    scriptId,
    status: 'failed',
    ok: false,
    durationMs: 0,
    logs: [{
      timestamp: new Date().toISOString(),
      level: 'error',
      message,
    }],
    error: message,
  }
}

function skippedCompletion(scriptId: string): CompleteRunScriptDraft {
  return {
    scriptId,
    status: 'skipped',
    durationMs: 0,
    logs: [],
    error: '前序步骤失败，未执行',
  }
}

interface ActivePipelineExecution {
  pipelineId: string
  pipelineName: string
  recordId: string | null
  currentScriptId: string | null
  cancelRequested: boolean
  stopPromise: Promise<AutomationPipelineStopResult> | null
  interruptionPromise: Promise<RunRecord> | null
}

function resolveStepVariables(
  step: AutomationPipelineStep,
  outputs: ReadonlyMap<string, Record<string, unknown>>,
): Record<string, string> {
  return Object.fromEntries(step.parameterMappings.map((mapping) => {
    const sourceOutput = outputs.get(mapping.sourceScriptId)
    if (!sourceOutput) {
      throw new Error(`无法读取前序脚本 ${mapping.sourceScriptId} 的输出`)
    }

    const value = stringifyRuntimeVariableValue(getValueAtPath(sourceOutput, mapping.sourcePath))
    if (value === null) {
      throw new Error(`无法从脚本 ${mapping.sourceScriptId} 的输出路径 ${mapping.sourcePath} 提取运行参数`)
    }

    const targetKey = mapping.targetKey.trim()
    if (!targetKey) throw new Error('参数映射的目标变量不能为空')
    return [targetKey, value]
  }))
}

function validatePipelineScripts(
  pipeline: AutomationPipeline,
  availableScripts: AutomationScript[],
): AutomationScript[] {
  if (pipeline.steps.length === 0) throw new Error('流水线至少需要一个脚本步骤')
  const scriptById = new Map(availableScripts.map((script) => [script.id, script]))
  const seen = new Set<string>()

  return pipeline.steps.map((step) => {
    if (seen.has(step.scriptId)) throw new Error(`流水线不能重复执行同一脚本：${step.scriptId}`)
    for (const mapping of step.parameterMappings) {
      if (!seen.has(mapping.sourceScriptId)) {
        throw new Error('参数映射只能引用当前步骤之前的脚本')
      }
    }
    seen.add(step.scriptId)

    const script = scriptById.get(step.scriptId)
    if (!script) throw new Error(`流水线引用的脚本不存在：${step.scriptId}`)
    if (script.status === 'disabled') throw new Error(`脚本“${script.name}”已停用，无法执行流水线`)
    return script
  })
}

export class LocalAutomationPipelineExecutionService implements AutomationPipelineExecutionService {
  private readonly activeExecutions = new Map<string, ActivePipelineExecution>()
  private readonly recordStopRequests = new Map<string, Promise<AutomationPipelineStopResult>>()

  constructor(private readonly dependencies: AutomationPipelineExecutionDependencies) {}

  run(pipeline: AutomationPipeline): Promise<RunRecord> {
    if (this.activeExecutions.has(pipeline.id)) {
      throw new Error(`自动化配置“${pipeline.name}”正在运行，请先等待完成或强制停止`)
    }

    const execution: ActivePipelineExecution = {
      pipelineId: pipeline.id,
      pipelineName: pipeline.name,
      recordId: null,
      currentScriptId: null,
      cancelRequested: false,
      stopPromise: null,
      interruptionPromise: null,
    }
    this.activeExecutions.set(pipeline.id, execution)
    return this.execute(pipeline, execution).finally(() => {
      if (this.activeExecutions.get(pipeline.id) === execution) {
        this.activeExecutions.delete(pipeline.id)
      }
      this.dependencies.runtimeVariables.clear()
    })
  }

  isRunning(pipelineId: string): boolean {
    return this.activeExecutions.has(pipelineId)
  }

  async stop(pipelineId: string): Promise<AutomationPipelineStopResult> {
    const execution = this.activeExecutions.get(pipelineId)
    if (!execution) {
      return { stopped: false, runnerFound: false, cancelledRunIds: [] }
    }

    return this.stopExecution(execution)
  }

  stopByRecordId(recordId: string): Promise<AutomationPipelineStopResult> {
    const pending = this.recordStopRequests.get(recordId)
    if (pending) return pending

    const request = this.stopRecord(recordId).finally(() => {
      if (this.recordStopRequests.get(recordId) === request) {
        this.recordStopRequests.delete(recordId)
      }
    })
    this.recordStopRequests.set(recordId, request)
    return request
  }

  private stopExecution(
    execution: ActivePipelineExecution,
  ): Promise<AutomationPipelineStopResult> {
    if (execution.stopPromise) return execution.stopPromise

    execution.stopPromise = this.performStopExecution(execution).catch((error) => {
      if (this.activeExecutions.get(execution.pipelineId) === execution) {
        execution.cancelRequested = false
        execution.stopPromise = null
        execution.interruptionPromise = null
      }
      throw error
    })
    return execution.stopPromise
  }

  private async performStopExecution(
    execution: ActivePipelineExecution,
  ): Promise<AutomationPipelineStopResult> {
    execution.cancelRequested = true
    const result = execution.currentScriptId && execution.recordId
      ? await this.dependencies.scripts.stopExecution(execution.recordId)
      : { runnerFound: false, cancelledRunIds: [] }
    if (execution.recordId) await this.interruptExecution(execution)
    return { stopped: true, ...result }
  }

  private async stopRecord(recordId: string): Promise<AutomationPipelineStopResult> {
    const activeExecution = [...this.activeExecutions.values()]
      .find((execution) => execution.recordId === recordId)
    if (activeExecution) return this.stopExecution(activeExecution)

    const record = await this.dependencies.runRecords.get(recordId)
    if (!record || record.status !== 'running') {
      return { stopped: false, runnerFound: false, cancelledRunIds: [] }
    }

    const runnerStop = await this.dependencies.scripts.stopExecution(recordId)

    try {
      await this.dependencies.runRecords.interrupt(
        recordId,
        `用户已从运行记录强制停止批次 ${record.displayId}`,
      )
      return { stopped: true, ...runnerStop }
    } catch (error) {
      const current = await this.dependencies.runRecords.get(recordId).catch(() => undefined)
      if (current === null) {
        return { stopped: false, ...runnerStop }
      }
      if (current && current.status !== 'running') {
        return {
          stopped: current.status === 'interrupted',
          ...runnerStop,
        }
      }
      throw error
    }
  }

  private async execute(
    pipeline: AutomationPipeline,
    execution: ActivePipelineExecution,
  ): Promise<RunRecord> {
    const environment = (await this.dependencies.environments.list())
      .find((item) => item.id === pipeline.environmentId)
    if (!environment) throw new Error('流水线配置的运行环境不存在或已被删除')
    if (!environment.enabled) throw new Error(`环境“${environment.name}”已停用，无法执行流水线`)

    const orderedScripts = validatePipelineScripts(pipeline, await this.dependencies.scripts.list())
    const record = await this.dependencies.runRecords.start({
      name: `自动化配置 · ${pipeline.name}`,
      environment: {
        id: environment.id,
        name: environment.name,
        code: environment.code,
        apiBaseUrl: environment.apiBaseUrl,
      },
      scripts: orderedScripts.map(scriptSnapshot),
    })
    execution.recordId = record.id

    let failureStage: RunFailureStage = 'login'
    let secretValues = environmentSecrets(environment)
    try {
      if (execution.cancelRequested) return await this.interruptExecution(execution)
      const loginResult = await this.dependencies.environmentLogin.login(environment)
      if (execution.cancelRequested) return await this.interruptExecution(execution)
      if (!loginResult.businessSuccess) {
        const status = loginResult.status ? `HTTP ${loginResult.status}` : '未收到 HTTP 响应'
        throw new Error(loginResult.error || `环境登录失败（${status}），请检查登录配置和业务成功规则`)
      }

      const runtimeToken = applyResponseVariable({
        variableName: environment.auth.tokenVariable,
        responsePath: environment.auth.tokenPath,
      }, environment, loginResult, this.dependencies.runtimeVariables)
      if (!runtimeToken) throw new Error(`登录成功，但无法从 ${environment.auth.tokenPath} 提取 Token`)
      secretValues = [runtimeToken.value, ...secretValues].filter(Boolean)

      await this.dependencies.runRecords.appendLog(record.id, {
        level: 'success',
        scope: 'login',
        message: `${environment.name}登录成功，运行时 Token 已刷新`,
        secretValues,
      })

      failureStage = 'runner'
      const baseContext = {
        ...buildScriptRunContext(environment, this.dependencies.runtimeVariables),
        executionId: record.id,
      }
      return await this.runSteps(record.id, pipeline, baseContext, secretValues, execution)
    } catch (error) {
      if (execution.cancelRequested) return await this.interruptExecution(execution)
      const current = await this.dependencies.runRecords.get(record.id).catch(() => null)
      if (current?.status !== 'running') return current ?? record
      return this.dependencies.runRecords.fail(record.id, {
        stage: failureStage,
        error: errorMessage(error),
        secretValues,
      })
    }
  }

  private async runSteps(
    recordId: string,
    pipeline: AutomationPipeline,
    baseContext: ScriptRunContext,
    secretValues: string[],
    execution: ActivePipelineExecution,
  ): Promise<RunRecord> {
    const completions: CompleteRunScriptDraft[] = []
    const outputs = new Map<string, Record<string, unknown>>()
    const pipelineVariables: Record<string, string> = {}

    for (const [index, step] of pipeline.steps.entries()) {
      if (execution.cancelRequested) return this.interruptExecution(execution)
      let completion: CompleteRunScriptDraft
      let continueAfterStepFailure = false
      try {
        Object.assign(pipelineVariables, resolveStepVariables(step, outputs))
        const context: ScriptRunContext = {
          ...baseContext,
          variables: { ...baseContext.variables, ...pipelineVariables },
          extraHTTPHeaders: { ...baseContext.extraHTTPHeaders },
        }
        execution.currentScriptId = step.scriptId
        const completedScript = (await this.dependencies.scripts.run(
          [step.scriptId],
          context,
          async (script) => {
            const currentSecrets = [
              ...secretValues,
              ...this.dependencies.runtimeVariables.list()
                .filter((variable) => variable.secret)
                .map((variable) => variable.value),
            ].filter(Boolean)
            const progress = createRunScriptProgressDraft(script, currentSecrets)
            if (progress) await this.dependencies.runRecords.updateScriptProgress(recordId, progress)
          },
        ))[0]
        if (execution.cancelRequested || completedScript?.lastRunResult?.cancelled) {
          return this.interruptExecution(execution)
        }
        if (!completedScript?.lastRunResult) {
          throw new Error(`Runner 未返回脚本 ${step.scriptId} 的执行结果`)
        }
        completion = resultCompletion(step.scriptId, completedScript.lastRunResult)
        continueAfterStepFailure = completedScript.lastRunResult.continuePipeline === true
          && completedScript.lastRunResult.timedOut !== true
        if (completedScript.lastRunResult.output) {
          outputs.set(step.scriptId, completedScript.lastRunResult.output)
        }
        const variableReport = applyScriptResponseVariables(
          completedScript,
          completedScript.lastRunResult,
          baseContext.environmentId,
          this.dependencies.runtimeVariables,
        )
        if (variableReport.failed.length > 0) {
          const missingVariables = variableReport.failed
            .map(({ variableName, responsePath }) => `${variableName} (${responsePath})`)
            .join('、')
          throw new Error(`脚本 ${step.scriptId} 未能提取必需响应变量：${missingVariables}`)
        }
        Object.assign(pipelineVariables, Object.fromEntries(
          variableReport.applied.map((variable) => [variable.key, variable.value]),
        ))
      } catch (error) {
        if (execution.cancelRequested) return this.interruptExecution(execution)
        continueAfterStepFailure = false
        completion = failedCompletion(step.scriptId, errorMessage(error, '脚本执行失败'))
      } finally {
        if (execution.currentScriptId === step.scriptId) execution.currentScriptId = null
      }

      completions.push(completion)
      if (completion.status !== 'failed' || continueAfterStepFailure) continue
      for (const remaining of pipeline.steps.slice(index + 1)) {
        completions.push(skippedCompletion(remaining.scriptId))
      }
      break
    }

    const allSecretValues = [
      ...secretValues,
      ...this.dependencies.runtimeVariables.list()
        .filter((variable) => variable.secret)
        .map((variable) => variable.value),
    ].filter(Boolean)
    if (execution.cancelRequested) return this.interruptExecution(execution)
    return this.dependencies.runRecords.complete(recordId, {
      scripts: completions,
      secretValues: allSecretValues,
    })
  }

  private async interruptExecution(execution: ActivePipelineExecution): Promise<RunRecord> {
    const recordId = execution.recordId
    if (!recordId) {
      throw new Error(`自动化配置“${execution.pipelineName}”正在停止，请稍后查看运行记录`)
    }
    if (!execution.interruptionPromise) {
      execution.interruptionPromise = this.dependencies.runRecords.interrupt(
        recordId,
        `用户已强制停止自动化配置“${execution.pipelineName}”`,
      ).catch(async (error) => {
        const current = await this.dependencies.runRecords.get(recordId)
        if (current && current.status !== 'running') return current
        throw error
      })
    }
    return execution.interruptionPromise
  }
}
