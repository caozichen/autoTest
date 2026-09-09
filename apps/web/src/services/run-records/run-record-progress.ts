import type { RunRecordCounts } from '@/domain/run-record'

export function pendingRunScriptCount(counts: RunRecordCounts): number {
  const completed = counts.passed + counts.partial + counts.failed + counts.skipped
  return Math.max(0, counts.total - completed)
}
