import { describe, expect, it } from 'vitest'

import type { RunScriptRecord } from '@/domain/run-record'
import { buildRunAssertionAnalysis } from './run-assertion-analysis'

function script(overrides: Partial<RunScriptRecord> = {}): RunScriptRecord {
  return {
    recordId: 'run-1:script-1',
    id: 'form-lpxavn-submit',
    name: '全题型填写',
    directory: 'scripts',
    entryFile: 'form-lpxavn-submit.ui.spec.mjs',
    tags: [],
    status: 'failed',
    durationMs: 100,
    logs: [],
    assertions: [],
    apiResponses: [],
    ...overrides,
  }
}

describe('run assertion analysis', () => {
  it('groups ordered small assertions and fails a module when one child fails', () => {
    const analysis = buildRunAssertionAnalysis([script({
      assertions: [
        { sequence: 1, timestamp: '2026-08-21T00:00:00.000Z', name: '单项选择应显示三个选项', module: '单项选择', matcher: 'toHaveCount', status: 'passed', durationMs: 2 },
        { sequence: 2, timestamp: '2026-08-21T00:00:01.000Z', name: '单项选择最多输入四个字', module: '单项选择', matcher: 'toHaveValue', status: 'failed', durationMs: 3, error: '超出上限' },
        { sequence: 3, timestamp: '2026-08-21T00:00:02.000Z', name: '手机号格式正确', module: '手机号', matcher: 'toBeTruthy', status: 'passed', durationMs: 1 },
      ],
    })])

    expect(analysis).toMatchObject({
      total: 3,
      passed: 2,
      failed: 1,
      moduleTotal: 2,
      passedModules: 1,
      failedModules: 1,
      legacy: false,
    })
    expect(analysis.groups.map((group) => [group.name, group.status, group.passed, group.failed]))
      .toEqual([
        ['单项选择', 'failed', 1, 1],
        ['手机号', 'passed', 1, 0],
      ])
  })

  it('rebuilds compatible assertion groups from legacy success and error logs', () => {
    const analysis = buildRunAssertionAnalysis([script({
      assertions: [],
      logs: [
        { id: 'log-1', timestamp: '2026-08-21T00:00:00.000Z', level: 'success', scope: 'script', message: '单项选择图片断言通过' },
        { id: 'log-2', timestamp: '2026-08-21T00:00:01.000Z', level: 'error', scope: 'script', message: '提交结果页断言失败' },
      ],
    })])

    expect(analysis.legacy).toBe(true)
    expect(analysis.groups.map((group) => [group.name, group.status]))
      .toEqual([['单项选择', 'passed'], ['表单提交', 'failed']])
  })
})
