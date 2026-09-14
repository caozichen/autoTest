import { formatDateTime as formatScriptCreatedAt } from '@/utils/date-time'
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



export { formatScriptCreatedAt }
