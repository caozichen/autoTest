export const RUN_HISTORY_TABS_KEY = 'autotest.run-history-tabs.v1'

export interface RunHistoryEnvironment {
  id: string
  name: string
  code: string
}

// null means unconfigured; [] intentionally displays only the all-environments tab.
export function readRunHistoryTabs(storage: Pick<Storage, 'getItem'> = localStorage): string[] | null {
  const raw = storage.getItem(RUN_HISTORY_TABS_KEY)
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === 'string')) return null
    return [...new Set(parsed)]
  } catch {
    return null
  }
}

export function resolveRunHistoryTabs<T extends RunHistoryEnvironment>(
  environments: T[],
  selectedIds: string[] | null,
): T[] {
  const byId = new Map(environments.map((environment) => [environment.id, environment]))
  return [...new Set(selectedIds ?? environments.map((environment) => environment.id))]
    .flatMap((id) => {
      const environment = byId.get(id)
      return environment ? [environment] : []
    })
}

export function saveRunHistoryTabs(ids: string[], storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(RUN_HISTORY_TABS_KEY, JSON.stringify([...new Set(ids)]))
}
