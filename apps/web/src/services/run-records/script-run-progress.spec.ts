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
      output: { data: { secret: 'generated-secret' } },
      secretValues: ['runtime-token', 'generated-secret'],
    })
  })

  it('ignores snapshots which cannot update an active run record', () => {
    expect(createRunScriptProgressDraft(script('interrupted'))).toBeNull()
    expect(createRunScriptProgressDraft(script('ready'))).toBeNull()
  })
})
