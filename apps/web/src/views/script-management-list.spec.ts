import { describe, expect, it } from 'vitest'

import { formatScriptCreatedAt, sortScriptsByCreatedAtDesc } from './script-management-list'

describe('script management list', () => {
  it('orders scripts by exact creation time from newest to oldest without mutating the source', () => {
    const scripts = [
      { id: 'invalid', createdAt: 'not-a-date' },
      { id: 'older', createdAt: '2026-09-08T10:00:00.000Z' },
      { id: 'same-b', createdAt: '2026-09-09T10:00:00.000Z' },
      { id: 'same-a', createdAt: '2026-09-09T10:00:00.000Z' },
    ]

    expect(sortScriptsByCreatedAtDesc(scripts).map((script) => script.id)).toEqual([
      'same-a',
      'same-b',
      'older',
      'invalid',
    ])
    expect(scripts.map((script) => script.id)).toEqual(['invalid', 'older', 'same-b', 'same-a'])
  })

  it('formats creation time consistently and preserves an invalid source value', () => {
    const localTime = new Date(2026, 8, 9, 10, 8, 30)

    expect(formatScriptCreatedAt(localTime.toISOString())).toBe('2026-09-09 10:08')
    expect(formatScriptCreatedAt('not-a-date')).toBe('not-a-date')
  })
})
