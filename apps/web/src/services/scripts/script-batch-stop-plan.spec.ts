import { describe, expect, it } from 'vitest'

import type { RunRecordStatus, RunScriptStatus } from '@/domain/run-record'
import { collectBatchStopScriptIds } from './script-batch-stop-plan'

function record(
  status: RunRecordStatus,
  scripts: Array<string | { id: string; status: RunScriptStatus }>,
) {
  return {
    status,
    scripts: scripts.map((script) => typeof script === 'string' ? { id: script } : script),
  }
}

describe('collectBatchStopScriptIds', () => {
  it('ignores batches that are no longer running', () => {
    const records = [
      record('passed', ['target', 'finished-peer']),
      record('interrupted', ['target', 'interrupted-peer']),
      record('running', ['other', 'running-peer']),
    ]

    expect(collectBatchStopScriptIds(records, 'target')).toEqual([])
  })

  it('combines all running batches containing the target and preserves unique script order', () => {
    const records = [
      record('running', [
        { id: 'first', status: 'passed' },
        { id: 'target', status: 'queued' },
        { id: 'shared', status: 'queued' },
      ]),
      record('running', [
        { id: 'shared', status: 'queued' },
        { id: 'second', status: 'queued' },
        { id: 'target', status: 'queued' },
      ]),
    ]

    expect(collectBatchStopScriptIds(records, 'target')).toEqual([
      'first',
      'target',
      'shared',
      'second',
    ])
  })

  it('returns an empty plan when no running batch contains the target', () => {
    expect(collectBatchStopScriptIds([
      record('running', ['first', 'second']),
    ], 'target')).toEqual([])
  })

  it('keeps the existing single-script stop behavior', () => {
    expect(collectBatchStopScriptIds([
      record('running', ['target']),
    ], 'target')).toEqual(['target'])
  })
})
