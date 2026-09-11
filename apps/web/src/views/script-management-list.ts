import type { AutomationScript } from '@/domain/script'

type CreatedScript = Pick<AutomationScript, 'id' | 'createdAt'>

function createdAtTimestamp(value: string): number {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY
}

export function sortScriptsByCreatedAtDesc<T extends CreatedScript>(scripts: readonly T[]): T[] {
  return [...scripts].sort((left, right) => {
    const leftTimestamp = createdAtTimestamp(left.createdAt)
    const rightTimestamp = createdAtTimestamp(right.createdAt)
    if (leftTimestamp !== rightTimestamp) return rightTimestamp > leftTimestamp ? 1 : -1
    return left.id.localeCompare(right.id)
  })
}

export function formatScriptCreatedAt(value: string): string {
  const timestamp = createdAtTimestamp(value)
  if (!Number.isFinite(timestamp)) return value
  const date = new Date(timestamp)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-') + ` ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
