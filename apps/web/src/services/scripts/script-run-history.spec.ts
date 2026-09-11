import { describe, expect, it } from 'vitest'

import type { RunRecordStatus, RunScriptStatus } from '@/domain/run-record'
import type { AutomationScript, ScriptStatus } from '@/domain/script'
import { restoreLatestScriptRuns } from './script-run-history'

function automationScript(
  id: string,
  status: ScriptStatus = 'ready',
): AutomationScript {
  return {
    id,
    name: id,
    description: '',
    directory: 'scripts',
    entryFile: `${id}.mjs`,
    timeoutMs: 30_000,
    tags: [],
    status,
    createdAt: '2026-09-01T02:00:00.000Z',
    updatedAt: '2026-09-01 10:00',
    lastRunAt: null,
    lastDuration: null,
  }
}

function runRecord(
  id: string,
  startedAt: string,
  scripts: Array<{ id: string; status: RunScriptStatus; durationMs: number | null }>,
  status: RunRecordStatus = 'passed',
) {
  return { id, startedAt, status, scripts }
}

describe('restoreLatestScriptRuns', () => {
  it('restores the latest persisted time, duration, and status after the web service restarts', () => {
    const startedAt = new Date(2026, 8, 8, 18, 41).toISOString()
    const scripts = [automationScript('publish')]

    const restored = restoreLatestScriptRuns(scripts, [
      runRecord('newer', startedAt, [{ id: 'publish', status: 'passed', durationMs: 65_200 }]),
      runRecord('older', '2026-09-01T01:00:00.000Z', [
        { id: 'publish', status: 'failed', durationMs: 3_000 },
      ], 'failed'),
    ])

    expect(restored[0]).toMatchObject({
      status: 'passed',
      lastRunAt: '2026-09-08 18:41',
      lastDuration: '01:05',
    })
    expect(scripts[0]).toMatchObject({
      status: 'ready',
      lastRunAt: null,
      lastDuration: null,
    })
  })

  it('selects the latest execution independently for each script and record order', () => {
    const restored = restoreLatestScriptRuns([
      automationScript('first'),
      automationScript('second'),
    ], [
      runRecord('latest-first', '2026-09-08T10:00:00.000Z', [
        { id: 'first', status: 'partial', durationMs: 10_000 },
      ], 'partial'),
      runRecord('latest-second', '2026-09-09T10:00:00.000Z', [
        { id: 'second', status: 'failed', durationMs: 20_000 },
      ], 'failed'),
      runRecord('older-batch', '2026-09-01T10:00:00.000Z', [
        { id: 'first', status: 'passed', durationMs: 1_000 },
        { id: 'second', status: 'passed', durationMs: 2_000 },
      ]),
    ])

    expect(restored.map(({ id, status, lastDuration }) => ({ id, status, lastDuration }))).toEqual([
      { id: 'first', status: 'partial', lastDuration: '00:10' },
      { id: 'second', status: 'failed', lastDuration: '00:20' },
    ])
  })

  it('does not treat queued or untouched skipped steps as completed executions', () => {
    const restored = restoreLatestScriptRuns([automationScript('publish')], [
      runRecord('interrupted', '2026-09-09T10:00:00.000Z', [
        { id: 'publish', status: 'skipped', durationMs: 0 },
      ], 'interrupted'),
      runRecord('completed', '2026-09-08T10:00:00.000Z', [
        { id: 'publish', status: 'passed', durationMs: 5_000 },
      ]),
    ])

    expect(restored[0]).toMatchObject({ status: 'passed', lastDuration: '00:05' })
  })

  it('restores an interrupted step that had already started and keeps disabled scripts disabled', () => {
    const restored = restoreLatestScriptRuns([automationScript('publish', 'disabled')], [
      runRecord('interrupted', '2026-09-09T10:00:00.000Z', [
        { id: 'publish', status: 'skipped', durationMs: 12_000 },
      ], 'interrupted'),
    ])

    expect(restored[0]).toMatchObject({
      status: 'disabled',
      lastDuration: '00:12',
    })
  })

  it('preserves newer in-memory progress while merging cached history during live refresh', () => {
    const running = automationScript('publish', 'running')
    running.lastRunAt = '刚刚'
    running.lastDuration = '00:03'
    running.lastRunResult = {
      ok: false,
      status: 'running',
      durationMs: 3_000,
      logs: [],
    }

    const [restored] = restoreLatestScriptRuns([running], [
      runRecord('older', '2026-09-08T10:00:00.000Z', [
        { id: 'publish', status: 'passed', durationMs: 5_000 },
      ]),
    ], { preserveRuntimeState: true })

    expect(restored).toMatchObject({
      status: 'running',
      lastRunAt: '刚刚',
      lastDuration: '00:03',
      lastRunResult: { status: 'running', durationMs: 3_000 },
    })
  })
})
