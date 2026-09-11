import { createHash, randomUUID } from 'node:crypto'
import { authenticatePipeline, httpUrl } from './pipeline-login.mjs'
import { redactRunRecordResult } from './run-record-result.mjs'
import { runtimeValue, safeVariableName, valueAtPath, resolvePipelinePath } from './pipeline-values.mjs'

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,99}$/
export const MAX_CONCURRENT_PIPELINES = 3
// Missing scope in older/manual runs stays exclusive. Aliases of the same API
// origin share a lock even if they were saved under different environment IDs.
export function sameExecutionEnvironment(left, right) {
  if (!left || !right) return true
  if (left.id && right.id && left.id === right.id) return true
  if (left.apiBaseUrl && right.apiBaseUrl) {
    try { return new URL(left.apiBaseUrl).origin === new URL(right.apiBaseUrl).origin }
    catch { return true }
  }
  return !left.id || !right.id || left.id === right.id
}
function error(message, statusCode = 400) { return Object.assign(new Error(message), { statusCode }) }
function required(value, label) { if (typeof value !== 'string' || !value.trim()) throw error(`${label}不能为空`); return value.trim() }
function emptyNetwork() { return { observed: 0, recorded: 0, dropped: 0, passed: 0, failed: 0, warnings: 0 } }
function buildRecord(id, pipeline, environment, configs, fingerprint) {
  const timestamp = new Date().toISOString()
  return {
    schemaVersion: 1, revision: 0, id, displayId: `RUN-${timestamp.slice(0, 10).replaceAll('-', '')}-${id.replaceAll('-', '').slice(-6).toUpperCase()}`,
    name: `自动化配置 · ${pipeline.name}`, status: 'running', trigger: 'manual', browser: 'Chromium',
    environment: { id: environment.id, name: environment.name, code: environment.code, apiBaseUrl: environment.apiBaseUrl },
    startedAt: timestamp, updatedAt: timestamp, finishedAt: null, durationMs: null,
    execution: { kind: 'pipeline', pipelineId: pipeline.id, fingerprint },
    counts: { total: configs.length, passed: 0, partial: 0, failed: 0, skipped: 0 },
    scripts: configs.map(config => ({ recordId: `${id}:${config.id}`, id: config.id, name: config.name,
      directory: config.directory, entryFile: config.entryFile, tags: config.tags ?? [], status: 'queued', durationMs: null,
      logs: [], assertions: [], apiResponses: [], resourceResponses: [], artifacts: [],
      networkSummary: { api: emptyNetwork(), resources: emptyNetwork() } })),
    logs: [{ id: randomUUID(), timestamp, level: 'info', scope: 'runner', message: 'Runner 已接管流水线，页面关闭后仍会按顺序执行' }],
    analysis: { passRate: 0, averageDurationMs: 0, slowestScriptRecordId: null,
      logCounts: { info: 1, success: 0, warning: 0, error: 0 }, failureGroups: [] },
  }
}

export class PipelineRunner {
  constructor({ records, configs, executeStep, scriptBusy = () => false, pendingCancellation = () => null, login = authenticatePipeline }) {
    Object.assign(this, { records, configs, executeStep, scriptBusy, pendingCancellation, login })
    this.active = new Map()
    this.admission = Promise.resolve()
  }
  list() {
    return [...this.active.values()].map(execution => ({ id: execution.id, pipelineId: execution.pipelineId,
      environment: execution.environment, pipelineName: execution.pipelineName,
      phase: execution.phase, currentScriptId: execution.currentScriptId, scriptIds: execution.scriptIds }))
  }
  ownsScript(scriptId, environment) {
    return [...this.active.values()].some(execution => sameExecutionEnvironment(execution.environment, environment) && execution.scriptIds.includes(scriptId))
  }
  cancel(id, reason) {
    const execution = this.active.get(id)
    if (!execution) return false
    execution.reason = reason
    execution.controller.abort(reason)
    if (execution.phase === 'saving') execution.pendingFinish = { status: 'interrupted', error: '用户已停止流水线' }
    return true
  }
  start(input) {
    return this.withAdmission(() => this.admit(input))
  }
  withAdmission(operation) {
    const pending = this.admission.then(operation)
    this.admission = pending.catch(() => undefined)
    return pending
  }
  async admit(input) {
    if (!input || !idPattern.test(input.executionId ?? '')) throw error('批次执行 ID 无效')
    const { pipeline, environment, session, runtimeVariables = [] } = structuredClone(input)
    if (!pipeline || !environment) throw error('缺少流水线或运行环境')
    required(pipeline.id, '流水线 ID'); pipeline.name = required(pipeline.name, '流水线名称')
    if (!Array.isArray(pipeline.steps) || !pipeline.steps.length || pipeline.steps.length > 100) throw error('流水线需要 1 至 100 个步骤')
    for (const field of ['id', 'name', 'code', 'baseUrl', 'apiBaseUrl']) required(environment[field], `环境 ${field}`)
    if (environment.enabled !== true) throw error('运行环境已停用')
    httpUrl(environment.baseUrl, 'Web 地址'); httpUrl(environment.apiBaseUrl, 'API 地址')
    const auth = environment.auth
    if (!auth || !safeVariableName(auth.tokenVariable)) throw error('环境 Token 变量配置无效')
    if (auth.strategy !== 'reuse-session') {
      if (!['POST', 'PUT', 'PATCH'].includes(auth.method)) throw error('登录请求方法无效')
      required(auth.loginPath, '登录路径'); required(auth.tokenPath, 'Token 路径')
      if (!Number.isFinite(auth.timeoutMs) || auth.timeoutMs <= 0 || auth.timeoutMs > 900000) throw error('登录超时配置无效')
      let body
      try { body = JSON.parse(auth.requestBody) } catch { throw error('登录请求体不是有效 JSON') }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw error('登录请求体必须是对象')
      if (typeof auth.successPath !== 'string' || typeof auth.successValue !== 'string' || typeof auth.tokenTypePath !== 'string') throw error('登录提取规则无效')
    }
    if (!Array.isArray(environment.variables)) throw error('环境变量配置无效')
    for (const variable of environment.variables) if (!safeVariableName(variable.key) || typeof variable.value !== 'string') throw error('环境变量无效')
    if (!Array.isArray(runtimeVariables) || runtimeVariables.some(variable => !safeVariableName(variable.key) || typeof variable.value !== 'string')) throw error('运行变量无效')
    const seen = new Set()
    const configs = []
    for (const step of pipeline.steps) {
      if (!step || typeof step.scriptId !== 'string' || seen.has(step.scriptId) || !Array.isArray(step.parameterMappings)) throw error('流水线步骤无效或重复')
      for (const mapping of step.parameterMappings) {
        if (!mapping || !seen.has(mapping.sourceScriptId) || !safeVariableName(mapping.targetKey)
          || typeof mapping.sourcePath !== 'string' || !mapping.sourcePath.trim()) throw error('参数映射只能引用之前的步骤，路径及目标变量不能为空')
      }
      const config = await this.configs.get(step.scriptId)
      if (!config || !config.enabled) throw error(`脚本不存在或已停用：${step.scriptId}`)
      configs.push(config); seen.add(step.scriptId)
    }
    const fingerprint = createHash('sha256').update(JSON.stringify({ pipeline, environmentId: environment.id, site: environment.baseUrl, api: environment.apiBaseUrl })).digest('hex')
    const existing = await this.records.get(input.executionId)
    if (existing) {
      if (existing.execution?.fingerprint !== fingerprint) throw error('批次 ID 已被其他执行占用', 409)
      return { record: existing, accepted: false }
    }
    const existingRuns = await this.records.list()
    const runningRecords = existingRuns.filter(record => record.status === 'running' && record.execution?.kind === 'pipeline')
    const sameEnvironmentRecords = runningRecords.filter(record => sameExecutionEnvironment(record.environment, environment))
    if (sameEnvironmentRecords.some(record => record.execution.pipelineId === pipeline.id)) throw error('该自动化配置在当前环境已有未结束批次，请先查看运行记录', 409)
    if ([...this.active.values()].some(item => item.pipelineId === pipeline.id && sameExecutionEnvironment(item.environment, environment))) throw error('该自动化配置在当前环境正在运行', 409)
    for (const scriptId of seen) if (this.ownsScript(scriptId, environment) || this.scriptBusy(scriptId, environment)
      || sameEnvironmentRecords.some(record => record.scripts.some(script => script.id === scriptId))) throw error(`脚本正在当前环境的其他批次中执行：${scriptId}`, 409)
    const occupied = new Set([...this.active.keys(), ...runningRecords.map(record => record.id)])
    if (occupied.size >= MAX_CONCURRENT_PIPELINES) throw error(`最多同时运行 ${MAX_CONCURRENT_PIPELINES} 个流水线批次，请等待一个批次结束后再启动`, 429)
    const execution = { id: input.executionId, pipelineId: pipeline.id, scriptIds: [...seen],
      pipelineName: pipeline.name, environment: { id: environment.id, name: environment.name, code: environment.code, apiBaseUrl: environment.apiBaseUrl },
      currentScriptId: null, phase: 'login', controller: new AbortController(), reason: null, pendingFinish: null }
    this.active.set(execution.id, execution)
    let record
    try { record = await this.records.create(buildRecord(execution.id, pipeline, environment, configs, fingerprint)) }
    catch (failure) { this.active.delete(execution.id); throw failure }
    const cancelled = this.pendingCancellation(execution.id)
    if (cancelled) this.cancel(execution.id, cancelled.reason)
    execution.completion = this.execute(execution, { pipeline, environment, session, configs, runtimeVariables }).catch(failure => {
      // Keep the lease and retry only terminal persistence on the maintenance tick.
      console.warn(`[runner] 流水线结果写入失败：${failure.message}`)
    })
    return { record, accepted: true }
  }
  async execute(execution, { pipeline, environment, session, configs, runtimeVariables }) {
    const secrets = [environment.auth.password, environment.auth.verifyCode, environment.auth.mobile, session?.token,
      ...environment.variables.filter(variable => variable.secret).map(variable => variable.value),
      ...runtimeVariables.filter(variable => variable.secret).map(variable => variable.value)].filter(Boolean)
    const sanitize = value => redactRunRecordResult(value, {}, secrets)
    let terminal = {}
    try {
      if (execution.controller.signal.aborted) throw error('执行已取消')
      const { token, scheme } = await this.login(environment, session, execution.controller.signal)
      secrets.push(token, `${scheme} ${token}`)
      if (execution.controller.signal.aborted) throw error('执行已取消')
      await this.records.appendRunnerLog(execution.id, { level: 'success', scope: 'login',
        message: environment.auth.strategy === 'reuse-session' ? 'Runner 已加载当前环境的登录态' : 'Runner 环境登录成功，已提取 Token' })
      const variables = Object.fromEntries(environment.variables.filter(variable => variable.enabled).map(variable => [variable.key, variable.value]))
      Object.assign(variables, Object.fromEntries(runtimeVariables.map(variable => [variable.key, variable.value])))
      variables[environment.auth.tokenVariable.trim()] = token
      const outputs = new Map()
      execution.phase = 'running'
      for (const [index, step] of pipeline.steps.entries()) {
        if (execution.controller.signal.aborted) break
        execution.currentScriptId = step.scriptId
        const config = configs[index]
        let result
        try {
          const mappedVariables = {}
          const currentVariables = { ...Object.fromEntries((config.inputParameters ?? []).map(parameter => [parameter.key, parameter.value])), ...variables }
          for (const mapping of step.parameterMappings) {
            const value = runtimeValue(valueAtPath(outputs.get(mapping.sourceScriptId), mapping.sourcePath))
            if (value === null) throw error(`无法从 ${mapping.sourceScriptId} 的 ${mapping.sourcePath} 提取参数`)
            currentVariables[mapping.targetKey.trim()] = value
            mappedVariables[mapping.targetKey.trim()] = value
          }
          Object.assign(variables, mappedVariables)
          const context = { environmentId: environment.id, environmentCode: environment.code, siteBaseUrl: environment.baseUrl,
            apiBaseUrl: environment.apiBaseUrl, ignoreHTTPSErrors: environment.ignoreHTTPSErrors ?? new URL(environment.apiBaseUrl).hostname === 'lx.admin.lingxi.tech',
            variables: currentVariables, authorizationOrigin: new URL(environment.apiBaseUrl).origin,
            extraHTTPHeaders: { Authorization: `${scheme} ${token}` },
            ...(config.requestPath ? { requestPath: resolvePipelinePath(config.requestPath, currentVariables) } : {}) }
          result = await this.executeStep({ runId: randomUUID(), executionId: execution.id, scriptId: step.scriptId, context }, execution.controller.signal, secrets)
          const status = result.timedOut ? 'failed' : result.cancelled ? 'interrupted' : ['passed', 'partial', 'failed'].includes(result.status) ? result.status : (result.ok ? 'passed' : result.continuePipeline ? 'partial' : 'failed')
          result = { ...result, status }
          if (status === 'passed' || status === 'partial') {
            // Extract before persistence so secret bindings are redacted in all evidence.
            const extracted = []
            const missing = []
            for (const binding of config.responseVariableBindings ?? []) {
              const value = runtimeValue(valueAtPath(result.result, binding.responsePath))
              if (value === null || !value.trim()) { missing.push(`${binding.variableName} (${binding.responsePath})`); continue }
              extracted.push([binding.variableName, value])
              if (binding.secret) secrets.push(value)
            }
            if (missing.length) throw Object.assign(error(`脚本 ${step.scriptId} 未能提取必需响应变量：${missing.join('、')}`), { result })
            Object.assign(variables, Object.fromEntries(extracted))
            outputs.set(step.scriptId, result.result)
          }
        } catch (failure) {
          result = { ...(failure.result ?? result), ok: false, status: 'failed', error: failure.message,
            durationMs: (failure.result ?? result)?.durationMs ?? 0, logs: (failure.result ?? result)?.logs ?? [] }
        }
        if (execution.controller.signal.aborted) result = { ...result, status: 'interrupted', cancelled: true, ok: false, error: execution.reason || '用户已停止流水线' }
        execution.pendingStep = { scriptId: step.scriptId, result: sanitize(result) }
        await this.records.saveRunnerStepResult(execution.id, step.scriptId, execution.pendingStep.result, { replace: true })
        execution.pendingStep = null
        if (result.status === 'failed' || result.status === 'interrupted') {
          terminal = { status: result.status, error: sanitize(result.error || '脚本执行失败'), stage: 'script' }
          break
        }
      }
    } catch (failure) {
      terminal = { status: execution.controller.signal.aborted ? 'interrupted' : 'failed',
        stage: execution.phase === 'login' ? 'login' : 'runner', error: sanitize(failure.message) }
    }
    if (execution.controller.signal.aborted) terminal = { status: 'interrupted', error: sanitize(execution.reason || '用户已停止流水线') }
    execution.currentScriptId = null
    execution.phase = 'saving'
    execution.pendingFinish = terminal
    await this.finalize(execution)
  }
  finalize(execution) {
    if (execution.finalizing) return execution.finalizing
    execution.finalizing = this.saveFinal(execution).finally(() => { execution.finalizing = null })
    return execution.finalizing
  }
  async saveFinal(execution) {
    if (execution.pendingStep) {
      await this.records.saveRunnerStepResult(execution.id, execution.pendingStep.scriptId, execution.pendingStep.result, { replace: true })
      execution.pendingStep = null
    }
    await this.records.finishRunnerPipeline(execution.id, execution.pendingFinish)
    this.active.delete(execution.id)
  }
  async maintain() {
    for (const execution of this.active.values()) if (execution.phase === 'saving') {
      try { await this.finalize(execution) }
      catch (failure) { console.warn(`[runner] 批次 ${execution.id} 保存重试失败：${failure.message}`) }
    }
  }
}
