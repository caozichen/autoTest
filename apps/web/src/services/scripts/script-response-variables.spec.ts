import { describe, expect, it } from 'vitest'

import type { AutomationScript, ScriptRunResult } from '@/domain/script'
import { SessionRuntimeVariableService } from '@/services/runtime-variables/session-runtime-variable.service'
import {
  applyScriptResponseVariables,
  extractScriptResponseVariables,
  normalizeScriptResponseVariableBindings,
} from './script-response-variables'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

const bindings = [
  { id: 'form-id', variableName: 'FORM_ID', responsePath: 'data.form.id', secret: false },
  { id: 'enabled', variableName: 'FORM_ENABLED', responsePath: 'data.form.enabled', secret: false },
  { id: 'contract', variableName: 'FORM_CONTRACT', responsePath: 'data.form.contract', secret: false },
  { id: 'missing', variableName: 'MISSING', responsePath: 'data.missing', secret: true },
]
const script = {
  id: 'create-form',
  responseVariableBindings: bindings,
} as Pick<AutomationScript, 'id' | 'responseVariableBindings'>
const result: ScriptRunResult = {
  ok: true,
  durationMs: 10,
  logs: [],
  output: { data: { form: { id: 123, enabled: false, contract: { fieldKeys: { username: 'username_dynamic' } } } } },
}

describe('script response variables', () => {
  it('normalizes rules and rejects incomplete or duplicate variable names', () => {
    expect(normalizeScriptResponseVariableBindings([{
      id: 'id',
      variableName: ' FORM_ID ',
      responsePath: ' data.id ',
      secret: false,
    }])).toEqual([{
      id: 'id',
      variableName: 'FORM_ID',
      responsePath: 'data.id',
      secret: false,
    }])
    expect(() => normalizeScriptResponseVariableBindings([{
      id: 'bad', variableName: '', responsePath: 'data.id', secret: false,
    }])).toThrow('完整填写')
    expect(() => normalizeScriptResponseVariableBindings([
      { id: '1', variableName: 'FORM_ID', responsePath: 'data.id', secret: false },
      { id: '2', variableName: 'form_id', responsePath: 'data.other', secret: false },
    ])).toThrow('重复提取')
  })

  it('extracts scalar values including false and reports unmatched paths', () => {
    const report = extractScriptResponseVariables(script, result)

    expect(report.extracted.map(({ binding, value }) => [binding.variableName, value])).toEqual([
      ['FORM_ID', '123'],
      ['FORM_ENABLED', 'false'],
      ['FORM_CONTRACT', '{"fieldKeys":{"username":"username_dynamic"}}'],
    ])
    expect(report.failed.map((binding) => binding.variableName)).toEqual(['MISSING'])
  })

  it('uses output from a completed network-only failure but rejects ordinary failed output', () => {
    const networkFailure = extractScriptResponseVariables(script, {
      ...result,
      ok: false,
      continuePipeline: true,
    })
    const ordinaryFailure = extractScriptResponseVariables(script, {
      ...result,
      ok: false,
    })

    expect(networkFailure.extracted.map(({ binding }) => binding.variableName)).toEqual([
      'FORM_ID',
      'FORM_ENABLED',
      'FORM_CONTRACT',
    ])
    expect(ordinaryFailure).toEqual({ extracted: [], failed: [] })
  })

  it('stores extracted values globally and keeps old values when a path is missing', () => {
    const runtimeVariables = new SessionRuntimeVariableService(new MemoryStorage())
    runtimeVariables.upsert({
      key: 'MISSING',
      value: 'last-success-value',
      secret: true,
      sourceEnvironmentId: 'env-testing',
      sourcePath: 'old.path',
    })

    const report = applyScriptResponseVariables(
      script,
      result,
      'env-testing',
      runtimeVariables,
    )

    expect(report.applied.map((variable) => variable.key)).toEqual(['FORM_ID', 'FORM_ENABLED', 'FORM_CONTRACT'])
    expect(runtimeVariables.get('FORM_ID')).toMatchObject({
      value: '123',
      sourceEnvironmentId: 'env-testing',
      sourceScriptId: 'create-form',
      sourcePath: 'data.form.id',
    })
    expect(runtimeVariables.get('MISSING')?.value).toBe('last-success-value')
  })
})
