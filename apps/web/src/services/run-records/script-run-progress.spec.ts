import { describe, expect, it } from 'vitest'

import type { AutomationScript } from '@/domain/script'
import { createRunScriptProgressDraft } from './script-run-progress'

function script(status: AutomationScript['status']): AutomationScript {
  return {
    id: 'create-form',
    name: '创建表单',
    description: '',
    directory: 'scripts',
    entryFile: 'create-form.mjs',
    tags: [],
    status,
    createdAt: '2026-08-31T02:00:00.000Z',
    updatedAt: '2026-08-31 10:00',
    lastRunAt: '刚刚',
    lastDuration: '1.2s',
    responseVariableBindings: [{
      id: 'secret-id',
      variableName: 'FORM_SECRET',
      responsePath: 'data.secret',
      secret: true,
    }],
    lastRunResult: {
      ok: status === 'passed',
      durationMs: 1_200,
      logs: [{
        timestamp: '2026-08-31T02:00:01.000Z',
        level: 'info',
        message: '正在创建表单',
      }],
      assertions: [],
      apiResponses: [],
      resourceResponses: [{
        sequence: 1,
        timestamp: '2026-08-31T02:00:00.500Z',
        name: 'app.js',
        method: 'GET',
        url: 'https://example.test/app.js',
        resourceType: 'script',
        status: 200,
        ok: true,
        durationMs: 12,
      }],
      networkSummary: {
        api: { observed: 0, recorded: 0, dropped: 0, passed: 0, failed: 0, warnings: 0 },
        resources: { observed: 1, recorded: 1, dropped: 0, passed: 1, failed: 0, warnings: 0 },
      },
      artifacts: [{
        executionId: 'run-000001',
        stepId: 'create-form',
        attemptId: 'runner-run-0001',
        absolutePath: '/workspace/outputs/artifacts/run-000001/create-form/runner-run-0001/result.png',
        relativePath: 'result.png',
        type: 'screenshot',
        mimeType: 'image/png',
        sizeBytes: 128,
        createdAt: '2026-08-31T02:00:01.000Z',
      }],
      output: { data: { secret: 'generated-secret' } },
    },
  }
}

describe('createRunScriptProgressDraft', () => {
  it('maps a live script snapshot and includes newly extracted secret values', () => {
    expect(createRunScriptProgressDraft(script('passed'), ['runtime-token'])).toEqual({
      scriptId: 'create-form',
      status: 'passed',
      durationMs: 1_200,
      logs: [{
        timestamp: '2026-08-31T02:00:01.000Z',
        level: 'info',
        message: '正在创建表单',
      }],
      assertions: [],
      apiResponses: [],
      resourceResponses: [{
        sequence: 1,
        timestamp: '2026-08-31T02:00:00.500Z',
        name: 'app.js',
        method: 'GET',
        url: 'https://example.test/app.js',
        resourceType: 'script',
        status: 200,
        ok: true,
        durationMs: 12,
      }],
      networkSummary: {
        api: { observed: 0, recorded: 0, dropped: 0, passed: 0, failed: 0, warnings: 0 },
        resources: { observed: 1, recorded: 1, dropped: 0, passed: 1, failed: 0, warnings: 0 },
      },
      artifacts: [{
        executionId: 'run-000001',
        stepId: 'create-form',
        attemptId: 'runner-run-0001',
        absolutePath: '/workspace/outputs/artifacts/run-000001/create-form/runner-run-0001/result.png',
        relativePath: 'result.png',
        type: 'screenshot',
        mimeType: 'image/png',
        sizeBytes: 128,
        createdAt: '2026-08-31T02:00:01.000Z',
      }],
      output: { data: { secret: 'generated-secret' } },
      secretValues: ['runtime-token', 'generated-secret'],
    })
  })

  it('ignores snapshots which cannot update an active run record', () => {
    expect(createRunScriptProgressDraft(script('interrupted'))).toBeNull()
    expect(createRunScriptProgressDraft(script('ready'))).toBeNull()
  })
})
