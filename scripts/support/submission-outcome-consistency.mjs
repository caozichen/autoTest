// 本次新增，按要求整体注释保留；当前运行不会加载、查询或注入故障。
// 启用时须同时取消填写脚本中的 import、提交前快照及提交后核对注释。
// 仅适用于本次新建且无人并发填写的隔离表单；从后台主库口径独立回读，不能复用提交响应。
// 覆盖答卷提交一致性；活动报名、支付订单及 Redis 占额需各自的权威数据回读，不能由答卷数量推定。
/*
import { expect } from './recorded-expect.mjs'
import { expect as flowExpect } from './environment-timeouts.mjs'

export async function readCommittedSubmissionIds({ request, apiBaseUrl, formId, authorization }) {
  flowExpect(Boolean(authorization), '提交一致性后台回读需要环境登录 Token').toBe(true)
  const ids = []
  let expectedTotal
  for (let page = 1; page <= 100; page += 1) {
    const url = new URL(`${apiBaseUrl.replace(/\/$/, '')}/be/form/${encodeURIComponent(formId)}/submission`)
    url.searchParams.set('page', String(page))
    url.searchParams.set('per_page', '100')
    const response = await request.get(url.href, { headers: { Authorization: authorization } })
    const body = await response.json()
    flowExpect(response.ok() && Number(body?.code) === 0, '提交一致性后台独立回读必须成功').toBe(true)
    const rows = body?.data?.list
    const total = Number(body?.data?.meta?.total)
    flowExpect(Array.isArray(rows) && Number.isInteger(total) && total >= 0,
      '提交一致性回读必须包含完整分页元数据，不能把未知结果当作空列表').toBe(true)
    expectedTotal ??= total
    flowExpect(total, '隔离表单回读期间答卷总数必须稳定').toBe(expectedTotal)
    for (const row of rows) {
      flowExpect(String(row.id ?? ''), '后台答卷必须有可识别 ID').toMatch(/\S+/)
      ids.push(String(row.id))
    }
    if (ids.length >= total) break
    flowExpect(rows.length, '未读完全部答卷前不得出现空页').toBeGreaterThan(0)
  }
  flowExpect(ids.length, '分页回读条数必须与后台总数完全一致').toBe(expectedTotal)
  flowExpect(new Set(ids).size, '分页回读不得重复或漏读答卷').toBe(expectedTotal)
  return ids
}

export function assertSubmissionOutcomeConsistency({ beforeIds, afterIds, submission }) {
  const added = afterIds.filter(id => !beforeIds.includes(id))
  const succeeded = submission.response.ok() && Number(submission.body?.code) === 0
  if (!succeeded) {
    expect(added, '提交返回失败时不得已经新增答卷，避免用户误以为未保存而重复提交').toEqual([])
    return
  }
  const id = String(submission.body?.data?.submission_id ?? '')
  expect(added, '一次成功提交必须且只能保存响应对应的一份答卷').toEqual([id])
  expect(String(submission.body?.data?.result_token ?? ''),
    '已经保存的答卷必须随成功响应返回可用结果凭证').toMatch(/^[a-f0-9]{64}$/)
  // 结果凭证实际可读性由既有 assertSubmissionResultRead 检查。
}

// 仅用于同一次不确定提交的显式恢复/重试场景，不限制用户主动发起的合法重复填写。
// 此函数不会发起重试；需由隔离专项提供前后权威快照和明确的原始答卷 ID。
export function assertSubmissionRetryConsistency({ beforeIds, afterRetryIds, committedSubmissionId, recoveredSubmission }) {
  const added = afterRetryIds.filter(id => !beforeIds.includes(id))
  expect(added, '同一次失败提示后的恢复不得重复创建第二份答卷').toEqual([String(committedSubmissionId)])
  expect(recoveredSubmission.response.ok() && Number(recoveredSubmission.body?.code) === 0,
    '已保存答卷的恢复应成功，不能只返回重复提交或协议令牌已消费错误').toBe(true)
  expect(String(recoveredSubmission.body?.data?.submission_id ?? ''),
    '恢复必须返回原始答卷').toBe(String(committedSubmissionId))
  expect(String(recoveredSubmission.body?.data?.result_token ?? ''),
    '恢复必须提供原始答卷的结果凭证').toMatch(/^[a-f0-9]{64}$/)
}
*/
