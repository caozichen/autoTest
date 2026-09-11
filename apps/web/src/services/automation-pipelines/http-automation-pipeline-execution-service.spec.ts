import { describe, expect, it, vi } from 'vitest'
import type { AutomationPipeline } from '@/domain/automation-pipeline'
import type { TestEnvironment } from '@/domain/environment'
import type { RunRecord } from '@/domain/run-record'
import type { AutomationPipelineExecutionDependencies } from './automation-pipeline-execution-service'
import { HttpAutomationPipelineExecutionService } from './http-automation-pipeline-execution-service'

const pipeline: AutomationPipeline = { id: 'pipeline-1', name: 'fixture', description: '', environmentId: 'env-1',
  steps: [{ scriptId: 'first', parameterMappings: [] }], createdAt: '', updatedAt: '' }
const record = (status: RunRecord['status'] = 'running') => ({ id: 'execution-1', status,
  execution: { kind: 'pipeline', pipelineId: pipeline.id, fingerprint: 'fixture' } }) as RunRecord
const env = { id: 'env-1', enabled: true, auth: { strategy: 'api-login' } } as TestEnvironment
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
function fixture() {
  const environments = { list: vi.fn().mockResolvedValue([env]) }
  const runRecords = { get: vi.fn().mockResolvedValue(record('passed')), interrupt: vi.fn() }
  const environmentLogin = { login: vi.fn() }
  const scripts = { run: vi.fn() }
  const runtimeVariables = { list: vi.fn().mockReturnValue([
    { key: 'CURRENT', value: 'current', sourceEnvironmentId: 'env-1', secret: false },
    { key: 'FOREIGN', value: 'foreign', sourceEnvironmentId: 'env-2', secret: true },
  ]) }
  const environmentSessions = { get: vi.fn() }
  const dependencies = { environments, runRecords, environmentLogin, scripts, runtimeVariables, environmentSessions } as unknown as AutomationPipelineExecutionDependencies
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ record: record() }, 202))
  const service = new HttpAutomationPipelineExecutionService(dependencies, { fetcher, pollIntervalMs: 1, idFactory: () => 'execution-1' })
  return { service, dependencies, environments, runRecords, environmentLogin, scripts, environmentSessions, fetcher }
}

describe('Runner owned pipeline client', () => {
  it('restores multiple environments for the same configuration and stops only the selected batch', async () => {
    const f = fixture()
    const executions = ['env-1', 'env-2', 'env-3'].map(id => ({ id: `execution-${id}`, pipelineId: pipeline.id, environment: { id }, scriptIds: ['first'] }))
    f.fetcher.mockImplementation(async url => String(url).endsWith('/cancel')
      ? response({ pipelineFound: true, cancelledRunIds: ['run-env-2'] }) : response({ executions }))
    f.runRecords.get.mockImplementation(async id => ({ ...record(), id }))
    await f.service.refresh()
    expect(f.service.getActiveExecutions()).toHaveLength(3)
    expect(f.service.isRunning(pipeline.id, 'env-3')).toBe(true)
    expect(f.service.isRunning(pipeline.id, 'env-4')).toBe(false)
    await expect(f.service.stop(pipeline.id)).rejects.toThrow('多个运行批次')
    expect(f.fetcher.mock.calls.some(call => String(call[0]).endsWith('/cancel'))).toBe(false)
    await f.service.stop(pipeline.id, 'env-2')
    expect(f.fetcher.mock.calls.filter(call => String(call[0]).endsWith('/cancel')).map(call => call[0]))
      .toEqual([expect.stringContaining('/executions/execution-env-2/cancel')])
  })
  it('starts the same configuration in two environments and completing one keeps the other locked', async () => {
    const f = fixture()
    f.environments.list.mockResolvedValue([env, { ...env, id: 'env-2' }])
    let sequence = 0
    const completed = new Set<string>()
    f.fetcher.mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      return response({ record: { ...record(), id: body.executionId } }, 202)
    })
    f.runRecords.get.mockImplementation(async id => ({ ...record(completed.has(id) ? 'passed' : 'running'), id }))
    const service = new HttpAutomationPipelineExecutionService(f.dependencies, { fetcher: f.fetcher, pollIntervalMs: 1, idFactory: () => `execution-${++sequence}` })
    const first = service.run(pipeline, 'env-1')
    const second = service.run(pipeline, 'env-2')
    expect(() => service.run(pipeline, 'env-2')).toThrow('正在运行')
    await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(2))
    const bodies = f.fetcher.mock.calls.map(call => JSON.parse(String(call[1]?.body)))
    expect(bodies.map(body => body.environment.id)).toEqual(['env-1', 'env-2'])
    expect(bodies[1].runtimeVariables.map((variable: { key: string }) => variable.key)).toEqual(['FOREIGN'])
    completed.add('execution-1'); await first
    expect(service.isRunning(pipeline.id, 'env-1')).toBe(false)
    expect(service.isRunning(pipeline.id, 'env-2')).toBe(true)
    completed.add('execution-2'); await second
    expect(service.getActiveExecutions()).toEqual([])
  })
  it('submits one complete pipeline with same-environment variables; browser does no login or step execution', async () => {
    const f = fixture()
    expect((await f.service.run(pipeline)).status).toBe('passed')
    expect(f.fetcher).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String(f.fetcher.mock.calls[0]![1]!.body))
    expect(body.executionId).toBe('execution-1'); expect(body.pipeline.steps).toEqual(pipeline.steps)
    expect(body.runtimeVariables).toEqual([{ key: 'CURRENT', value: 'current', secret: false }])
    expect(f.environmentLogin.login).not.toHaveBeenCalled(); expect(f.scripts.run).not.toHaveBeenCalled()
    expect(f.service.isRunning(pipeline.id)).toBe(false)
  })
  it('recovers a lost acceptance response using its original ID without resubmitting', async () => {
    const f = fixture(); f.fetcher.mockRejectedValue(new Error('connection lost'))
    expect((await f.service.run(pipeline)).status).toBe('passed')
    expect(f.fetcher).toHaveBeenCalledTimes(1); expect(f.runRecords.get).toHaveBeenCalledWith('execution-1')
  })
  it('preserves running lock when polling fails and refresh later recovers', async () => {
    const f = fixture(); f.runRecords.get.mockRejectedValue(new Error('offline'))
    await expect(f.service.run(pipeline)).rejects.toThrow('不要重复启动')
    expect(f.service.isRunning(pipeline.id)).toBe(true)
    f.fetcher.mockResolvedValue(response({ executions: [] }))
    await f.service.refresh(); expect(f.service.isRunning(pipeline.id)).toBe(false)
  })
  it('reopening a page discovers and stops the active pipeline without changing its record in the browser', async () => {
    const f = fixture()
    f.fetcher.mockImplementation(async (url, init) => String(url).endsWith('/cancel')
      ? response({ pipelineFound: true, cancelledRunIds: ['run-1'] })
      : response({ executions: [{ id: 'execution-1', pipelineId: pipeline.id }] }))
    f.runRecords.get.mockResolvedValue(record())
    await f.service.refresh(); expect(f.service.isRunning(pipeline.id)).toBe(true)
    const stopped = await f.service.stop(pipeline.id)
    expect(stopped.runnerFound).toBe(true); expect(stopped.cancelledRunIds).toEqual(['run-1'])
    expect(f.runRecords.interrupt).not.toHaveBeenCalled()
  })
  it('reserves cancellation while acceptance is still pending', async () => {
    const f = fixture()
    let accepted: (value: Response) => void = () => {}
    f.fetcher.mockImplementation(async (url) => String(url).endsWith('/cancel')
      ? response({ pipelineFound: false, cancelledRunIds: [], pendingRegistration: true })
      : new Promise<Response>(resolve => { accepted = resolve }))
    f.runRecords.get.mockResolvedValue(null)
    const running = f.service.run(pipeline)
    await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(1))
    expect(() => f.service.run(pipeline)).toThrow('正在运行')
    const stopped = await f.service.stop(pipeline.id)
    expect(stopped.stopped).toBe(true)
    expect(f.fetcher.mock.calls[1]![0]).toContain('/executions/execution-1/cancel')
    expect(f.runRecords.interrupt).not.toHaveBeenCalled()
    accepted(response({ record: record('interrupted') }, 202))
    expect((await running).status).toBe('interrupted')
  })
  it('sends the selected environment session and rejects missing session before admission', async () => {
    const f = fixture(); f.environments.list.mockResolvedValue([{ ...env, auth: { strategy: 'reuse-session' } }])
    await expect(f.service.run(pipeline)).rejects.toThrow('导入')
    expect(f.fetcher).not.toHaveBeenCalled()
    f.environmentSessions.get.mockReturnValue({ token: 'fixture-token', environmentId: 'env-1' })
    await f.service.run(pipeline)
    expect(JSON.parse(String(f.fetcher.mock.calls[0]![1]!.body)).session.token).toBe('fixture-token')
  })
  it('a selected environment overrides the saved environment', async () => {
    const f = fixture(); f.environments.list.mockResolvedValue([{ ...env, id: 'env-2' }])
    await f.service.run(pipeline, 'env-2')
    expect(JSON.parse(String(f.fetcher.mock.calls[0]![1]!.body)).environment.id).toBe('env-2')
  })
  it('deduplicates stop requests and keeps legacy batch interruption compatible', async () => {
    const f = fixture(); f.runRecords.get.mockResolvedValue({ id: 'legacy-1', status: 'running' })
    f.fetcher.mockResolvedValue(response({ cancelledRunIds: ['run-1'], pipelineFound: false }))
    const a = f.service.stopByRecordId('legacy-1'); const b = f.service.stopByRecordId('legacy-1')
    expect(a).toBe(b); await a
    expect(f.fetcher).toHaveBeenCalledTimes(1); expect(f.runRecords.interrupt).toHaveBeenCalledTimes(1)
  })
  it('retains an uncertain submission until Runner can confirm it, without generating a new ID', async () => {
    const f = fixture(); f.runRecords.get.mockResolvedValue(null)
    f.fetcher.mockRejectedValue(new Error('connection lost'))
    await expect(f.service.run(pipeline)).rejects.toThrow('提交结果暂时无法确认')
    expect(f.service.isRunning(pipeline.id)).toBe(true)
    expect(f.fetcher).toHaveBeenCalledTimes(1)
    f.fetcher.mockResolvedValue(response({ executions: [] }))
    await f.service.refresh(); expect(f.service.isRunning(pipeline.id)).toBe(false)
  })
  it('reports rejected admission and clears only the submitting state', async () => {
    const f = fixture(); f.runRecords.get.mockResolvedValue(null)
    f.fetcher.mockResolvedValue(response({ error: '该脚本已有未结束批次' }, 409))
    await expect(f.service.run(pipeline)).rejects.toThrow('未结束批次')
    expect(f.service.isRunning(pipeline.id)).toBe(false)
  })
})
