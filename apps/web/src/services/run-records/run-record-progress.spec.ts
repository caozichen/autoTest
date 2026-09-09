import { describe, expect, it } from 'vitest'

import type { RunRecordCounts } from '@/domain/run-record'
import { pendingRunScriptCount } from './run-record-progress'

describe('pendingRunScriptCount', () => {
  it.each<[RunRecordCounts, number]>([
    [{ total: 3, passed: 1, partial: 0, failed: 0, skipped: 0 }, 2],
    [{ total: 3, passed: 0, partial: 0, failed: 0, skipped: 0 }, 3],
    [{ total: 4, passed: 1, partial: 1, failed: 1, skipped: 0 }, 1],
    [{ total: 3, passed: 1, partial: 0, failed: 1, skipped: 1 }, 0],
    [{ total: 1, passed: 1, partial: 0, failed: 1, skipped: 0 }, 0],
  ])('returns the unfinished share for %o', (counts, expected) => {
    expect(pendingRunScriptCount(counts)).toBe(expected)
  })
})
