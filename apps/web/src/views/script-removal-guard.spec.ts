import { describe, expect, it, vi } from 'vitest'

import type { AutomationPipeline } from '@/domain/automation-pipeline'
import {
  automationPipelinesUsingScript,
  removeScriptFromListIfUnused,
  scriptUsageWarning,
} from './script-removal-guard'

function pipeline(
  id: string,
  name: string,
  steps: AutomationPipeline['steps'],
): AutomationPipeline {
  return {
    id,
    name,
    description: '',
    environmentId: 'env-testing',
    steps,
    createdAt: '2026-09-09T08:00:00.000Z',
    updatedAt: '2026-09-09T08:00:00.000Z',
  }
}

describe('script removal guard', () => {
  it('finds every automation pipeline that executes the script', () => {
    const pipelines = [
      pipeline('direct', '发布回归', [{ scriptId: 'target-script', parameterMappings: [] }]),
      pipeline('other', '其它回归', [{ scriptId: 'other-script', parameterMappings: [] }]),
      pipeline('mapped', '多语言回归', [
        { scriptId: 'source-script', parameterMappings: [] },
        {
          scriptId: 'translation-script',
          parameterMappings: [{
            sourceScriptId: 'target-script',
            sourcePath: 'formId',
            targetKey: 'FORM_ID',
          }],
        },
      ]),
    ]

    expect(automationPipelinesUsingScript(pipelines, 'target-script').map(({ id }) => id)).toEqual([
      'direct',
      'mapped',
    ])
    expect(automationPipelinesUsingScript(pipelines, 'unused-script')).toEqual([])
  })

  it('builds an actionable warning with the automation configuration names', () => {
    const pipelines = [
      pipeline('one', '发布回归', [{ scriptId: 'target-script', parameterMappings: [] }]),
      pipeline('two', '多语言回归', [{ scriptId: 'target-script', parameterMappings: [] }]),
    ]

    expect(scriptUsageWarning(pipelines)).toBe(
      '该脚本已用于自动化配置“发布回归、多语言回归”，请先解除自动化配置后再从列表移除',
    )
  })

  it('does not remove a script while an automation configuration uses it', async () => {
    const removeScript = vi.fn()
    const usage = pipeline('using-target', '发布回归', [
      { scriptId: 'target-script', parameterMappings: [] },
    ])

    await expect(removeScriptFromListIfUnused('target-script', {
      listAutomationPipelines: async () => [usage],
      removeScript,
    })).resolves.toEqual({ removed: false, usages: [usage] })
    expect(removeScript).not.toHaveBeenCalled()
  })

  it('removes an unused script only after checking every automation configuration', async () => {
    const calls: string[] = []

    await expect(removeScriptFromListIfUnused('target-script', {
      listAutomationPipelines: async () => {
        calls.push('list')
        return [pipeline('other', '其它回归', [{ scriptId: 'other-script', parameterMappings: [] }])]
      },
      removeScript: async (scriptId) => {
        calls.push(`remove:${scriptId}`)
      },
    })).resolves.toEqual({ removed: true })
    expect(calls).toEqual(['list', 'remove:target-script'])
  })

  it('fails closed when automation configurations cannot be checked', async () => {
    const removeScript = vi.fn()

    await expect(removeScriptFromListIfUnused('target-script', {
      listAutomationPipelines: async () => {
        throw new Error('自动化配置读取失败')
      },
      removeScript,
    })).rejects.toThrow('自动化配置读取失败')
    expect(removeScript).not.toHaveBeenCalled()
  })
})
