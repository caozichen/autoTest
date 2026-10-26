import { describe, it, expect, vi } from 'vitest'
import { formatRunnerMetric, parseRunnerResources } from './runner-resources'
import { LocalRunnerControlService } from './local-runner-control.service'
const snapshot = { schemaVersion: 1, sampledAt: '2026-10-22T12:00:00Z', collectionDurationMs: 1, groups: [] }
describe('resource service contract', () => {
  it('validates snapshots and fetches the health service resource endpoint without HTTP caching', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(snapshot)))
    const service = new LocalRunnerControlService(fetcher as typeof fetch, 'http://127.0.0.1:9999/health')
    expect(await service.getResources()).toEqual(snapshot)
    expect(fetcher.mock.calls[0]).toEqual(['http://127.0.0.1:9999/runner/resources', expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) })])
    expect(() => parseRunnerResources({ ...snapshot, sampledAt: 'bad date' })).toThrow('格式无效')
    expect(() => parseRunnerResources({ ...snapshot, schemaVersion: 2 })).toThrow('格式无效')
  })
  it('surfaces network, HTTP and malformed payload errors', async () => {
    for (const [fetcher, message] of [
      [async () => { throw new TypeError('offline') }, '无法连接 Runner'],
      [async () => new Response('{}', { status: 404 }), 'HTTP 404'],
      [async () => new Response('{}'), '格式无效'],
    ] as const) await expect(new LocalRunnerControlService(fetcher as typeof fetch).getResources()).rejects.toThrow(message)
  })
  it('aborts stalled requests and labels a timeout', async () => {
    const fetcher = vi.fn((_url, options) => new Promise<Response>((_, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch
    await expect(new LocalRunnerControlService(fetcher, undefined, undefined, 5).getResources()).rejects.toThrow('超时')
  })
  it('cancels health and resource requests together and clears their timeout handles', async () => {
    vi.useFakeTimers()
    try {
      const signals: AbortSignal[] = []
      const fetcher = vi.fn((_url, options) => new Promise<Response>((_, reject) => {
        const signal = options!.signal!
        signals.push(signal)
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })) as typeof fetch
      const controller = new AbortController()
      const service = new LocalRunnerControlService(fetcher)
      const status = service.getStatus(controller.signal)
      const resources = service.getResources(controller.signal)
      const outcome = expect(resources).rejects.toMatchObject({ name: 'AbortError' })
      expect(vi.getTimerCount()).toBe(2)
      controller.abort()
      await outcome
      await expect(status).resolves.toMatchObject({ status: 'offline' })
      expect(signals.every(signal => signal.aborted)).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
  it('uses binary memory units and preserves unavailable values', () => {
    expect(formatRunnerMetric({ id: 'rss', label: 'RSS', value: 1073741824, unit: 'bytes' })).toBe('1 GiB')
    expect(formatRunnerMetric({ id: 'rss', label: 'RSS', value: null, unit: 'bytes' })).toBe('不可用')
    expect(formatRunnerMetric({ id: 'rate', label: '%', value: 42.19, unit: 'percent' })).toBe('42.2%')
  })
})
