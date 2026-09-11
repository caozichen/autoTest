// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { readRunHistoryTabs, resolveRunHistoryTabs, saveRunHistoryTabs, RUN_HISTORY_TABS_KEY } from './run-history-tabs'

const environments = [
  { id: 'test', name: '测试环境', code: 'TEST' },
  { id: 'stage', name: '预发环境', code: 'STAGE' },
]
beforeEach(() => localStorage.clear())

describe('run history environment tabs', () => {
  it('defaults to current environments but preserves an explicitly empty selection', () => {
    expect(resolveRunHistoryTabs(environments, readRunHistoryTabs())).toEqual(environments)
    saveRunHistoryTabs([])
    expect(resolveRunHistoryTabs(environments, readRunHistoryTabs())).toEqual([])
  })
  it('persists order, removes duplicates and ignores deleted environments', () => {
    saveRunHistoryTabs(['stage', 'removed', 'test', 'stage'])
    expect(resolveRunHistoryTabs(environments, readRunHistoryTabs())).toEqual([...environments].reverse())
  })
  it('uses current environment names after a rename', () => {
    saveRunHistoryTabs(['test'])
    expect(resolveRunHistoryTabs([{ ...environments[0]!, name: '新名称' }], readRunHistoryTabs())[0]?.name).toBe('新名称')
  })
  it('recovers malformed preferences using the default selection', () => {
    localStorage.setItem(RUN_HISTORY_TABS_KEY, '{broken')
    expect(readRunHistoryTabs()).toBeNull()
    localStorage.setItem(RUN_HISTORY_TABS_KEY, '[5]')
    expect(readRunHistoryTabs()).toBeNull()
  })
})
