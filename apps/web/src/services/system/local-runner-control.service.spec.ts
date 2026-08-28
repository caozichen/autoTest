import { describe, expect, it, vi } from 'vitest'

import { LocalRunnerControlService } from './local-runner-control.service'

describe('LocalRunnerControlService', () => {
  it('reports the runner online only when its health payload is successful', async () => {
    const service = new LocalRunnerControlService(
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch,
    )

    await expect(service.getStatus()).resolves.toMatchObject({
      status: 'online',
      endpoint: 'http://127.0.0.1:4310/health',
    })
  })

  it('reports the runner offline when the health endpoint cannot be reached', async () => {
    const service = new LocalRunnerControlService(
      vi.fn(async () => { throw new TypeError('connection refused') }) as typeof fetch,
    )

    await expect(service.getStatus()).resolves.toMatchObject({ status: 'offline' })
  })

  it('calls the fixed supervisor endpoint with the control header', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      status: 'started',
      pid: 4310,
    }), { status: 200 }))
    const service = new LocalRunnerControlService(fetcher as typeof fetch)

    await expect(service.start()).resolves.toEqual({ status: 'started', pid: 4310 })
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:4311/runner/start', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'X-Autotest-Control': 'start-runner',
      },
    })
  })

  it('surfaces the local controller error', async () => {
    const service = new LocalRunnerControlService(
      vi.fn(async () => new Response(JSON.stringify({ ok: false, error: '启动超时' }), { status: 503 })) as typeof fetch,
    )

    await expect(service.start()).rejects.toThrow('启动超时')
  })

  it('replaces a network error with an actionable supervisor message', async () => {
    const service = new LocalRunnerControlService(
      vi.fn(async () => { throw new TypeError('Failed to fetch') }) as typeof fetch,
    )

    await expect(service.start()).rejects.toThrow('无法连接本地服务管理器（127.0.0.1:4311）')
  })
})
