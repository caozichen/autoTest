import { describe, expect, it, vi } from 'vitest'

import { HttpScriptConfigRepository } from './http-script-config.repository'
import type { ScriptConfig } from './script-config-repository'

const runnerBaseUrl = 'http://127.0.0.1:4310'
const script: ScriptConfig = {
  schemaVersion: 1,
  revision: 3,
  id: 'form-contact-publish',
  name: '表单联系人收录并发布',
  description: '发布表单',
  directory: 'scripts',
  entryFile: 'form-contact-publish.ui.spec.mjs',
  timeoutMs: 300_000,
  enabled: true,
  tags: ['Playwright', 'P0'],
  createdAt: '2026-08-31T08:00:00.000Z',
  updatedAt: '2026-08-31T09:00:00.000Z',
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('HttpScriptConfigRepository', () => {
  it('loads the persistent script config list without exposing response state', async () => {
    const fetcher = vi.fn(async () => json({ scripts: [script] }))
    const repository = new HttpScriptConfigRepository(fetcher as typeof fetch, runnerBaseUrl)

    const scripts = await repository.list()
    scripts[0]!.name = '外部修改'

    expect(scripts[0]).toMatchObject({ id: script.id, revision: 3 })
    expect(script.name).toBe('表单联系人收录并发布')
    expect(fetcher).toHaveBeenCalledWith(`${runnerBaseUrl}/script-configs`, { method: 'GET' })
  })

  it('returns null when a script config no longer exists', async () => {
    const fetcher = vi.fn(async () => json({ error: '脚本不存在或已被删除' }, 404))
    const repository = new HttpScriptConfigRepository(fetcher as typeof fetch, runnerBaseUrl)

    await expect(repository.get('missing-script')).resolves.toBeNull()
    expect(fetcher).toHaveBeenCalledWith(
      `${runnerBaseUrl}/script-configs/missing-script`,
      { method: 'GET' },
    )
  })

  it('creates a complete versioned script config', async () => {
    const persisted = { ...script, revision: 1 }
    const fetcher = vi.fn(async () => json({ script: persisted }, 201))
    const repository = new HttpScriptConfigRepository(fetcher as typeof fetch, runnerBaseUrl)

    await expect(repository.create({ ...script, revision: 0 })).resolves.toEqual(persisted)
    const request = fetcher.mock.calls[0]?.[1]
    expect(request).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(JSON.parse(String(request?.body))).toEqual({ script: { ...script, revision: 0 } })
  })

  it('sends revision and timestamp compare-and-swap values when updating', async () => {
    const next = { ...script, name: '修改后的名称', revision: 4 }
    const fetcher = vi.fn(async () => json({ script: next }))
    const repository = new HttpScriptConfigRepository(fetcher as typeof fetch, runnerBaseUrl)

    await expect(repository.update(next, 3, script.updatedAt)).resolves.toEqual(next)
    const [url, request] = fetcher.mock.calls[0]!
    expect(url).toBe(`${runnerBaseUrl}/script-configs/form-contact-publish`)
    expect(request).toMatchObject({ method: 'PATCH' })
    expect(JSON.parse(String(request?.body))).toEqual({
      script: next,
      expectedRevision: 3,
      expectedUpdatedAt: script.updatedAt,
    })
  })

  it('sends compare-and-swap values when deleting and accepts an empty response', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }))
    const repository = new HttpScriptConfigRepository(fetcher as typeof fetch, runnerBaseUrl)

    await expect(repository.remove(script.id, 3, script.updatedAt)).resolves.toBeUndefined()
    const [url, request] = fetcher.mock.calls[0]!
    expect(url).toBe(`${runnerBaseUrl}/script-configs/form-contact-publish`)
    expect(request).toMatchObject({ method: 'DELETE' })
    expect(JSON.parse(String(request?.body))).toEqual({
      expectedRevision: 3,
      expectedUpdatedAt: script.updatedAt,
    })
  })

  it('surfaces backend conflicts and runner connection failures', async () => {
    const conflictFetcher = vi.fn(async () => json({ error: '脚本配置已被其他页面修改' }, 409))
    const conflictRepository = new HttpScriptConfigRepository(
      conflictFetcher as typeof fetch,
      runnerBaseUrl,
    )
    await expect(conflictRepository.update(script, 2, script.updatedAt))
      .rejects.toThrow('脚本配置已被其他页面修改')

    const offlineFetcher = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const offlineRepository = new HttpScriptConfigRepository(
      offlineFetcher as typeof fetch,
      runnerBaseUrl,
    )
    await expect(offlineRepository.list())
      .rejects.toThrow(`无法连接本地 Playwright Runner（${runnerBaseUrl}），读取脚本配置失败`)
  })
})
