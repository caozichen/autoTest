import type { RunRecord } from '@/domain/run-record'

type StopPlanRecord = Pick<RunRecord, 'status'> & {
  scripts: ReadonlyArray<Pick<RunRecord['scripts'][number], 'id'>>
}

export function collectBatchStopScriptIds(
  records: readonly StopPlanRecord[],
  targetScriptId: string,
): string[] {
  const scriptIds: string[] = []
  const seen = new Set<string>()

  for (const record of records) {
    if (record.status !== 'running') continue
    if (!record.scripts.some((script) => script.id === targetScriptId)) continue

    for (const script of record.scripts) {
      if (!script.id || seen.has(script.id)) continue
      seen.add(script.id)
      scriptIds.push(script.id)
    }
  }

  return scriptIds
}
