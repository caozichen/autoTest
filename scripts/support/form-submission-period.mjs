import { expect } from './recorded-expect.mjs'
import { expect as flowExpect, scaleTimeout } from './environment-timeouts.mjs'
import { clickWhenReady } from './ui-readiness.mjs'
import { openFormSettingsMenu } from './form-navigation.mjs'

const DAY_MS = 86_400_000
const DATE_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
const shanghaiDay = value => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(value))

function timestamp(value) {
  const result = DATE_TIME.test(value) ? Date.parse(`${value.replace(' ', 'T')}+08:00`) : NaN
  if (!Number.isFinite(result) || new Date(result + 8 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ') !== value) {
    throw new Error('填报时间必须是有效的北京时间 YYYY-MM-DD HH:mm:ss')
  }
  return result
}

export function resolveSubmissionPeriod(variables = {}, now = Date.now()) {
  const startTime = String(variables.SUBMISSION_START_TIME ?? '').trim() || `${shanghaiDay(now - DAY_MS)} 00:00:00`
  const endTime = String(variables.SUBMISSION_END_TIME ?? '').trim() || `${shanghaiDay(now + 7 * DAY_MS)} 23:59:59`
  const start = timestamp(startTime)
  const end = timestamp(endTime)
  if (start >= end || start > now || end <= now) {
    throw new Error('五邮箱填写需要开始时间早于结束时间，且当前时间位于填报时间段内')
  }
  return { startTime, endTime, timeRange: 'in_progress' }
}

export function assertSubmissionPeriod(form, period, label) {
  const rule = form?.submit_config?.time_range_close_rule
  const actual = { enabled: Number(rule?.enabled), startTime: rule?.start_time, endTime: rule?.end_time }
  const expected = { enabled: 1, startTime: period.startTime, endTime: period.endTime }
  expect(actual, `${label}填报时间配置应完整保存`).toEqual(expected)
  flowExpect(actual, `${label}填报时间配置必须与本次设置一致`).toEqual(expected)
  flowExpect(form.start_time, `${label}列表筛选使用的开始时间必须同步`).toBe(period.startTime)
  flowExpect(form.end_time, `${label}列表筛选使用的结束时间必须同步`).toBe(period.endTime)
}

async function chooseDateTime(page, trigger, value) {
  await clickWhenReady(trigger)
  const overlay = page.locator('[data-fb-date-overlay]:visible')
  await flowExpect(overlay, '填报时间日历必须唯一显示').toHaveCount(1)
  const [year, month, day, hour, minute, second] = value.match(/\d+/g)
  const monthText = await overlay.locator('.fb-text-sm.fb-font-medium.fb-text-slate-900').innerText()
  const displayed = monthText.match(/(\d{4})\D+(\d{1,2})/)
  flowExpect(Boolean(displayed), '日历必须回显当前年月').toBe(true)
  const offset = (Number(year) - Number(displayed[1])) * 12 + Number(month) - Number(displayed[2])
  flowExpect(Math.abs(offset), '填报时间应在日历可操作的十年范围内').toBeLessThanOrEqual(120)
  for (let i = 0; i < Math.abs(offset); i += 1) {
    await clickWhenReady(overlay.locator(`button:has(svg.lucide-chevron-${offset < 0 ? 'left' : 'right'})`))
  }
  await clickWhenReady(overlay.locator('.fb-grid-cols-7 button:not(.fb-text-slate-300)')
    .filter({ hasText: new RegExp(`^\\s*${Number(day)}\\s*$`) }))
  for (const [column, selected] of [['hour', hour], ['minute', minute], ['second', second]]) {
    await clickWhenReady(overlay.locator(`[data-column="${column}"]`).getByRole('button', { name: selected, exact: true }))
  }
  await clickWhenReady(overlay.getByRole('button', { name: /^(确定|確定|确认|確認|OK)$/i }))
  await flowExpect(overlay, '确认填报日期时间后日历应关闭').toHaveCount(0)
  await flowExpect(trigger, '填报日期时间应完整回显到秒').toHaveText(value)
}

export async function configureSubmissionPeriod({ page, formId, period, readForm, inspectBusinessResponse, logger = () => undefined }) {
  const toggle = page.getByRole('switch', { name: /^(填报开始结束时间开关|填報開始結束時間開關)$/ })
  await openFormSettingsMenu(page, 'form', { ready: toggle, formId, logger, label: '打开填报时间设定' })
  await flowExpect(toggle, '填报时间开关必须可见').toBeVisible()
  const section = toggle.locator('xpath=ancestor::div[contains(@class,"fb-rounded-lg")][1]')
  if (await toggle.getAttribute('aria-checked') !== 'true') await clickWhenReady(toggle)
  else {
    const edit = section.getByRole('button', { name: /编辑填报开始\/结束时间|編輯填報開始\/結束時間/ })
    if (await edit.isVisible()) await clickWhenReady(edit)
  }
  const dates = section.locator('.fb-grid-cols-2 > div')
  await flowExpect(dates, '开始与结束时间应各有一个日期控件').toHaveCount(2)
  await chooseDateTime(page, dates.nth(0).locator('button').first(), period.startTime)
  await chooseDateTime(page, dates.nth(1).locator('button').first(), period.endTime)
  const [response] = await Promise.all([
    page.waitForResponse(response => response.request().method() === 'PUT'
      && new URL(response.url()).pathname.endsWith(`/be/form/${formId}/config`), { timeout: scaleTimeout(30_000) }),
    clickWhenReady(section.getByRole('button', { name: /^(确认|確認|确定|確定)$/ })),
  ])
  const outcome = await inspectBusinessResponse(response, '保存填报开始和结束时间')
  flowExpect(outcome.succeeded, '填报时间保存必须成功').toBe(true)
  const submitted = response.request().postDataJSON()?.submit_config?.time_range_close_rule
  flowExpect({ enabled: Number(submitted?.enabled), start_time: submitted?.start_time, end_time: submitted?.end_time },
    '时间保存请求必须携带本次完整时间段').toEqual({ enabled: 1, start_time: period.startTime, end_time: period.endTime })
  assertSubmissionPeriod(await readForm(), period, '草稿回读')
  logger('success', '填报开始和结束时间已通过页面设置并独立回读', period)
  return period
}
