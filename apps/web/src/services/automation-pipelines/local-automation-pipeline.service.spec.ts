import { describe, expect, it } from 'vitest'

import type { AutomationPipelineDraft } from '@/domain/automation-pipeline'
import { LocalAutomationPipelineService } from './local-automation-pipeline.service'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

const createdAt = new Date('2026-08-12T09:00:00.000Z')
const updatedAt = new Date('2026-08-12T10:00:00.000Z')

function draft(): AutomationPipelineDraft {
  return {
    name: 'Contact flow',
    description: 'Create and publish a contact form',
    environmentId: 'env-testing',
    steps: [
      { scriptId: 'create-form', parameterMappings: [] },
      {
        scriptId: 'publish-form',
        parameterMappings: [{
          sourceScriptId: 'create-form',
          sourcePath: 'form.id',
          targetKey: 'FORM_ID',
        }],
      },
    ],
  }
}

describe('LocalAutomationPipelineService', () => {
  it('starts empty, persists CRUD changes and restores them', async () => {
    const storage = new MemoryStorage()
    const times = [createdAt, updatedAt]
    const service = new LocalAutomationPipelineService(storage, () => times.shift() ?? updatedAt, () => 'pipeline-1')
    expect(await service.list()).toEqual([])

    const created = await service.create(draft())
    expect(created).toMatchObject({ id: 'pipeline-1', createdAt: createdAt.toISOString() })
    const nextDraft = draft()
    nextDraft.description = 'Updated description'
    const updated = await service.update(created.id, nextDraft)
    expect(updated).toMatchObject({
      description: 'Updated description',
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    })

    const restored = new LocalAutomationPipelineService(storage)
    expect(await restored.get(created.id)).toEqual(updated)
    await restored.remove(created.id)
    expect(await restored.list()).toEqual([])
    expect(JSON.parse(storage.getItem('autotest.automation-pipelines.v1') ?? 'null')).toEqual([])
  })

  it('rejects duplicate scripts and mappings that do not reference earlier steps', async () => {
    const service = new LocalAutomationPipelineService(new MemoryStorage())
    const duplicate = draft()
    duplicate.steps[1]!.scriptId = 'create-form'
    await expect(service.create(duplicate)).rejects.toThrow('重复')

    const forwardReference = draft()
    forwardReference.steps[0]!.parameterMappings = [{
      sourceScriptId: 'publish-form',
      sourcePath: 'result.id',
      targetKey: 'FORM_ID',
    }]
    await expect(service.create(forwardReference)).rejects.toThrow('之前')

    const selfReference = draft()
    selfReference.steps[1]!.parameterMappings[0]!.sourceScriptId = 'publish-form'
    await expect(service.create(selfReference)).rejects.toThrow('之前')
  })

  it('enforces unique names and required pipeline fields', async () => {
    const service = new LocalAutomationPipelineService(new MemoryStorage(), () => createdAt, () => 'pipeline-1')
    await service.create(draft())
    const sameName = draft()
    sameName.name = '  contact FLOW  '
    await expect(service.create(sameName)).rejects.toThrow('名称已存在')

    const noSteps = draft()
    noSteps.name = 'Empty pipeline'
    noSteps.steps = []
    await expect(service.create(noSteps)).rejects.toThrow('至少需要一个')
  })

  it('restores valid entries while ignoring malformed JSON and invalid entries', async () => {
    const storage = new MemoryStorage()
    storage.setItem('autotest.automation-pipelines.v1', '{invalid json')
    expect(await new LocalAutomationPipelineService(storage).list()).toEqual([])

    const fixtureStorage = new MemoryStorage()
    const fixture = new LocalAutomationPipelineService(fixtureStorage, () => createdAt, () => 'valid-pipeline')
    const valid = await fixture.create(draft())
    storage.setItem('autotest.automation-pipelines.v1', JSON.stringify([
      { id: 'broken' },
      valid,
      { ...valid, id: 'duplicate-script', steps: [valid.steps[0], valid.steps[0]] },
      { ...valid, id: 'forward-map', steps: [valid.steps[1], valid.steps[0]] },
    ]))

    expect((await new LocalAutomationPipelineService(storage).list()).map((pipeline) => pipeline.id))
      .toEqual(['valid-pipeline'])
  })

  it('returns deep clones for create, get and list results', async () => {
    const service = new LocalAutomationPipelineService(new MemoryStorage(), () => createdAt, () => 'pipeline-1')
    const created = await service.create(draft())
    created.steps[1]!.parameterMappings[0]!.targetKey = 'MUTATED'

    const fetched = await service.get(created.id)
    expect(fetched?.steps[1]?.parameterMappings[0]?.targetKey).toBe('FORM_ID')
    fetched!.steps[0]!.scriptId = 'MUTATED'
    expect((await service.list())[0]?.steps[0]?.scriptId).toBe('create-form')
  })
})
