import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppSettingsStore } from '../../../../api/app-settings-store.mjs'
import { cloneEnvironmentDraft } from '@/domain/environment'
import { LocalEnvironmentService } from '../environments/local-environment.service'
import { LocalEnvironmentSessionService } from '../environments/local-environment-session.service'
import { HttpAppSettings, SettingsStorage, ENVIRONMENTS_KEY, PIPELINES_KEY, SESSION_PREFIX } from './http-app-settings'
import { createSettingsServices } from './settings-services'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'autotest-web-settings-'))
  directories.push(directory)
  const store = new AppSettingsStore({ directory })
  const fetcher = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : null
    try {
      const snapshot = String(url).endsWith('/local-storage-v1') ? await store.migrate(body.entries)
        : init.method === 'PATCH' ? await store.update(body.changes, body.expectedRevision) : await store.read()
      return new Response(JSON.stringify(snapshot), { status: 200 })
    } catch (error) {
      return new Response(JSON.stringify({ error: (error as Error).message }), { status: (error as { statusCode?: number }).statusCode ?? 500 })
    }
  }) as typeof fetch & ReturnType<typeof vi.fn>
  const legacy = new SettingsStorage()
  const environment = (await new LocalEnvironmentService(legacy).list())[0]!
  legacy.setItem(ENVIRONMENTS_KEY, JSON.stringify([environment]))
  legacy.setItem(PIPELINES_KEY, JSON.stringify([{ id: 'fixture-pipeline', name: '持久流程', description: '',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', steps: [{ scriptId: 'first', parameterMappings: [] }] }]))
  legacy.setItem('autotest.run-history-tabs.v1', '[]')
  new LocalEnvironmentSessionService(legacy).save(environment, { token: 'fixture-token', accountLabel: '原账号' })
  const services = (storage: Storage | null) => createSettingsServices(new HttpAppSettings({ fetcher, legacyStorage: storage }))
  return { store, fetcher, legacy, environment, services }
}

it('migrates all durable data, reads it with empty browser storage, and never resurrects removed data from an old port', async () => {
  const { store, legacy, environment, services } = await fixture()
  const original = legacy.entries()
  const first = services(legacy)
  expect((await first.environments.list()).map(item => item.id)).toEqual([environment.id])
  expect((await first.automationPipelines.list())[0]?.name).toBe('持久流程')
  expect(await first.runHistoryTabs.read()).toEqual([])
  expect(await first.environmentSessions.get(environment)).toMatchObject({ token: 'fixture-token', accountLabel: '原账号' })
  expect(legacy.entries()).toEqual(original, 'the browser copy remains as a recovery backup')
  const fresh = services(new SettingsStorage())
  const draft = cloneEnvironmentDraft(environment)
  draft.name = '新端口修改的环境'
  await fresh.environments.update(environment.id, draft)
  await fresh.environmentSessions.clear(environment.id)
  await fresh.automationPipelines.remove('fixture-pipeline')
  const stale = services(legacy)
  expect((await stale.environments.list())[0]?.name).toBe(draft.name)
  expect(await stale.environmentSessions.get(environment)).toBeNull()
  expect(await stale.automationPipelines.list()).toEqual([])
  expect(await stale.runHistoryTabs.read()).toEqual([])
  expect((await store.read()).values[SESSION_PREFIX + environment.id]).toBeNull()
})

it('retries a concurrent write against the latest snapshot while preserving other clients changes', async () => {
  const { store, fetcher, services, legacy, environment } = await fixture()
  const client = services(legacy)
  await client.environments.list()
  const original = fetcher.getMockImplementation()!
  let conflict = true
  fetcher.mockImplementation(async (url, init) => {
    if (init?.method === 'PATCH' && conflict) {
      conflict = false
      const snapshot = await store.read()
      await store.update({ 'autotest.run-history-tabs.v1': '["other-client"]' }, snapshot.revision)
    }
    return original(url, init)
  })
  await client.environmentSessions.clear(environment.id)
  expect(await client.runHistoryTabs.read()).toEqual(['other-client'])
  expect(await client.environmentSessions.get(environment)).toBeNull()
})

it('rejects unconfirmed writes and preserves legacy data after migration or network failure', async () => {
  const { fetcher, legacy, services } = await fixture()
  fetcher.mockRejectedValueOnce(new TypeError('fixture offline'))
  const client = services(legacy)
  await expect(client.environments.list()).rejects.toThrow(/无法连接/)
  expect(legacy.getItem(ENVIRONMENTS_KEY)).not.toBeNull()
  await expect(client.environments.list()).resolves.toHaveLength(1)
  fetcher.mockImplementation(async () => new Response(JSON.stringify({ error: '磁盘写入失败' }), { status: 500 }))
  await expect(client.runHistoryTabs.save(['new-tab'])).rejects.toThrow('磁盘写入失败')
  expect(legacy.getItem('autotest.run-history-tabs.v1')).toBe('[]')
})

it('records a tombstone even when clearing a session that has not been imported yet', async () => {
  const { services, legacy, environment } = await fixture()
  const client = services(null)
  await client.environmentSessions.clear(environment.id)
  expect(await services(legacy).environmentSessions.get(environment)).toBeNull()
})

it('upgrades the newest legacy environment version without being blocked by obsolete versions', async () => {
  const { services, legacy } = await fixture()
  const raw = legacy.getItem(ENVIRONMENTS_KEY)!
  legacy.removeItem(ENVIRONMENTS_KEY)
  legacy.setItem('autotest.environments.v6', raw)
  legacy.setItem('autotest.environments.v1', '{ obsolete corrupt copy')
  expect(await services(legacy).environments.list()).toHaveLength(1)
  expect(legacy.getItem('autotest.environments.v6')).toBe(raw)
})
