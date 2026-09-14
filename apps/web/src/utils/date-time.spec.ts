import { describe, expect, it } from 'vitest'
import { formatDateTime } from './date-time'

describe('date time display', () => {
  it('formats ISO timestamps in local time with padded fields and seconds', () => {
    const date = new Date(2026, 0, 2, 0, 4, 5)
    expect(formatDateTime(date.toISOString())).toBe('2026-01-02 00:04:05')
    expect(formatDateTime(date.getTime())).toBe('2026-01-02 00:04:05')
  })
  it('supports legacy minute precision and empty values', () => {
    expect(formatDateTime('2026-09-14 14:49')).toBe('2026-09-14 14:49:00')
    expect(formatDateTime(null)).toBe('-')
    expect(formatDateTime('暂无数据')).toBe('暂无数据')
  })
})
