import { expect } from './recorded-expect.mjs'
import { expect as flowExpect } from './environment-timeouts.mjs'

// Pagination metadata belongs to the ordinary list. Only display rows are merged.
export function getFormListRecords(body, label = '表单列表') {
  const data = body?.data
  const ordinary = data?.list
  expect(Array.isArray(ordinary), `${label}应包含 data.list 数组`).toBe(true)
  flowExpect(Array.isArray(ordinary), `${label}必须包含普通列表数组`).toBe(true)
  const pinned = Object.hasOwn(data, 'pinned_list') ? data.pinned_list : []
  expect(Array.isArray(pinned), `${label}置顶列表应为数组`).toBe(true)
  flowExpect(Array.isArray(pinned), `${label}置顶列表必须为数组`).toBe(true)
  const rows = [...pinned, ...ordinary]
  const seen = new Set()
  for (const row of rows) {
    const id = String(row?.id ?? row?.form_id ?? '').trim()
    flowExpect(id, `${label}每条记录必须包含表单 ID`).not.toBe('')
    expect(seen.has(id), `${label}表单 ${id} 不应在置顶和普通列表重复`).toBe(false)
    flowExpect(seen.has(id), `${label}展示记录必须按 ID 唯一`).toBe(false)
    seen.add(id)
  }
  return rows
}
