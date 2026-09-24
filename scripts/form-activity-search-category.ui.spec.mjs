import { attachNetworkObserver } from './support/api-response-recorder.mjs'
import { expect as flowExpect, scaleTimeout } from './support/environment-timeouts.mjs'
import { launchGoogleChrome } from './support/google-chrome.mjs'
import { expect } from './support/recorded-expect.mjs'
import { clickWhenReady, observeUiReadiness, waitForUiReady } from './support/ui-readiness.mjs'
import { dismissFormOnboarding, inspectBusinessResponse } from './form-all-fields-publish.ui.spec.mjs'
import {
  closePlaywrightHandles, closePlaywrightOnAbort, throwIfRunAborted,
} from './playwright-run-control.mjs'

const ACTION_TIMEOUT_MS = 30_000
const NAVIGATION_TIMEOUT_MS = 45_000
const SEARCH_KEYS = [
  'filter[created_at_between]', 'filter[title]', 'filter[form_type]',
  'filter[creator_name]', 'filter[time_range]', 'filter[end_time_between]',
  'filter[status]', 'filter[updated_at_between]',
]
const DATE_KEYS = new Set([
  'filter[created_at_between]', 'filter[end_time_between]', 'filter[updated_at_between]',
])
const CATEGORY_DESCRIPTION = '自动化搜索分类验证，运行完成后删除。'
const CATEGORY_SORT = 100
const CATEGORY_ID_PATTERN = /^[a-zA-Z0-9]+$/
const TIME_RANGE_OPTION = {
  unlimited: /未限制填[报報]时间|未限制填報時間/,
  not_started: /未开始填报|未開始填報/,
  in_progress: /开放填报中|開放填報中/,
  finished: /已停止填报|已停止填報/,
}

function pageUrl(base, path) {
  return new URL(path.replace(/^\/+/, ''), `${base.replace(/\/+$/, '')}/`).toString()
}

function recordId(record) {
  return String(record?.id ?? record?.form_id ?? '').trim()
}

function dayOf(value) {
  return String(value ?? '').match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? ''
}

export function queryValues(url, key) {
  return [...url.searchParams.entries()]
    .filter(([name, value]) => value && (name === key || name === `${key}[]`
      || (name.startsWith(`${key}[`) && /^\d+\]$/.test(name.slice(key.length + 1)))))
    .map(([, value]) => value)
}

export function activeFilterKeys(url) {
  return [...new Set([...url.searchParams.entries()]
    .filter(([key, value]) => key.startsWith('filter[') && value !== '')
    .map(([key]) => key.replace(/\[\]$|\[\d+\]$/g, '')))]
}

function listResponse(page, predicate = () => true) {
  return page.waitForResponse(response => {
    const url = new URL(response.url())
    return response.request().method() === 'GET'
      && url.pathname.endsWith('/be/form/list') && predicate(url)
  }, { timeout: scaleTimeout(ACTION_TIMEOUT_MS) })
}

function exactResponse(page, method, path) {
  return page.waitForResponse(response => response.request().method() === method
    && new URL(response.url()).pathname.endsWith(path), {
    timeout: scaleTimeout(ACTION_TIMEOUT_MS),
  })
}

async function businessResponse(response, label) {
  const inspected = await inspectBusinessResponse(response, label)
  expect(response.ok(), `${label} HTTP 应成功`).toBe(true)
  flowExpect(response.ok(), `${label} HTTP 必须成功`).toBe(true)
  expect(Number(inspected.body?.code), `${label}业务码应为 0`).toBe(0)
  flowExpect(Number(inspected.body?.code), `${label}业务码必须为 0`).toBe(0)
  return inspected.body
}

function listRecords(body, label) {
  const records = body?.data?.list
  expect(Array.isArray(records), `${label}应包含 data.list 数组`).toBe(true)
  flowExpect(Array.isArray(records), `${label}必须返回列表数组`).toBe(true)
  return records
}

async function fetchJson(page, apiBaseUrl, authorization, path, label) {
  const result = await page.evaluate(async ({ url, token }) => {
    const response = await fetch(url, { headers: { Authorization: token } })
    return { status: response.status, ok: response.ok, body: await response.json().catch(() => null) }
  }, { url: pageUrl(apiBaseUrl, path), token: authorization })
  expect(result.ok, `${label} HTTP 应成功，实际 ${result.status}`).toBe(true)
  flowExpect(result.ok, `${label} HTTP 必须成功`).toBe(true)
  expect(Number(result.body?.code), `${label}业务码应为 0`).toBe(0)
  flowExpect(Number(result.body?.code), `${label}业务码必须为 0`).toBe(0)
  return result.body
}

async function sampleRecords(page, apiBaseUrl, authorization) {
  const records = []
  for (let pageNumber = 1; pageNumber <= 10; pageNumber += 1) {
    const body = await fetchJson(page, apiBaseUrl, authorization,
      `/be/form/list?page=${pageNumber}&per_page=100`, `样本列表第 ${pageNumber} 页`)
    const batch = listRecords(body, '样本列表')
    records.push(...batch)
    if (batch.length === 0 || (records.some(record => dayOf(record.end_time))
      && records.some(record => record.time_range === 'not_started'))) break
  }
  flowExpect(records.length, '列表必须有可供正向搜索的表单样本').toBeGreaterThan(0)
  return records
}

async function assertPageRows(page, records, label) {
  const rows = page.locator('.custom-table .arco-table-tr')
    .filter({ has: page.locator('.form-activity-list-operation-bar') })
  await flowExpect(rows, `${label}页面行数必须等待到接口本页结果`).toHaveCount(records.length)
  const rendered = await rows.evaluateAll(elements => elements.map(element => {
    const link = element.querySelector('.form-activity-list-operation-bar a[href*="id="]')
    const id = link ? new URL(link.href).searchParams.get('id') : ''
    const title = element.querySelector('.form-activity-list__title-link')?.textContent?.trim() ?? ''
    return { id, title }
  }))
  expect(rendered.length, `${label}页面行数应与接口本页结果一致`).toBe(records.length)
  flowExpect(rendered.length, `${label}页面行数必须与接口本页结果一致`).toBe(records.length)
  for (const record of records) {
    const id = recordId(record)
    if (!id) continue
    const matches = rendered.filter(row => row.id === id)
    expect(matches.length, `${label}表单 ${id} 应在页面显示一次`).toBe(1)
    flowExpect(matches.length, `${label}表单 ${id} 必须在页面显示一次`).toBe(1)
    expect(matches[0]?.title, `${label}表单 ${id} 标题应一致`)
      .toBe(String(record.title ?? ''))
    flowExpect(matches[0]?.title, `${label}表单 ${id} 标题必须一致`)
      .toBe(String(record.title ?? ''))
  }
}

function assertFilteredRecords(records, key, value, label) {
  for (const record of records) {
    let matched = true
    if (key === 'filter[title]') matched = String(record.title ?? '').includes(value)
    if (key === 'filter[creator_name]') {
      matched = String(record.creator_name ?? '').includes(value)
    }
    if (key === 'filter[status]') matched = String(record.status ?? '') === value
    if (key === 'filter[time_range]') matched = String(record.time_range ?? '') === value
    if (key === 'filter[form_type]') {
      const type = record.form_type ?? record.type
      matched = value === 'activity'
        ? record.is_activity === 1 || record.is_activity === true || record.is_activity === '1'
          || type === 'activity'
        : value === 'form'
          ? record.is_activity === 2 || record.is_activity === '2'
            || record.is_activity === 0 || record.is_activity === false || record.is_activity === '0'
            || type === 'form'
          : String(type ?? '') === value
    }
    if (DATE_KEYS.has(key)) {
      const property = key.slice(7, -9)
      matched = dayOf(record[property]) === value
    }
    expect(matched, `${label}返回的表单 ${recordId(record)} 必须满足 ${key}=${value}`).toBe(true)
    flowExpect(matched, `${label}返回的表单 ${recordId(record)} 必须符合搜索条件`).toBe(true)
  }
}

async function resetSearch(page) {
  const card = page.locator('.custom-filter .comp-filter-card')
  await flowExpect(card, '搜索卡片必须存在').toBeVisible()
  const [response] = await Promise.all([
    listResponse(page, url => activeFilterKeys(url).every(key => key === 'filter[category_id]')),
    clickWhenReady(card.getByRole('button', { name: /^(重设|重置|重設|Reset)$/ })),
  ])
  await businessResponse(response, '重置搜索')
  await waitForUiReady(page)
  const values = await card.locator('.filter-card-field input:not([readonly])')
    .evaluateAll(inputs => inputs.map(input => input.value))
  expect(values.every(value => value === ''), '重置后搜索输入值应清空').toBe(true)
  flowExpect(values.every(value => value === ''), '重置后搜索输入值必须清空').toBe(true)
  return card
}

async function openAllSearchFields(page) {
  const card = page.locator('.custom-filter .comp-filter-card')
  const expand = card.locator('.filter-card-expand')
  if (await expand.count() && /展开|展開|Expand/i.test(await expand.innerText())) {
    await clickWhenReady(expand)
  }
  const fields = card.locator('.filter-card-field')
  await flowExpect(fields, '搜索项必须恰好为 8 个').toHaveCount(SEARCH_KEYS.length)
  for (let index = 0; index < SEARCH_KEYS.length; index += 1) {
    await flowExpect(fields.nth(index), `${SEARCH_KEYS[index]} 必须可见`).toBeVisible()
    await flowExpect(fields.nth(index).locator('.filter-card-control'),
      `${SEARCH_KEYS[index]} 必须有输入控件`).toHaveCount(1)
  }
  return fields
}

async function fillDateRange(field, date) {
  const inputs = field.locator('input')
  await flowExpect(inputs, '日期范围必须有起止两个输入框').toHaveCount(2)
  await inputs.nth(0).fill(date)
  await inputs.nth(1).fill(date)
  const calendar = field.page().locator('.arco-panel-date-inner:visible')
  if (await calendar.count()) {
    const [year, month] = date.split('-')
    const day = Number(date.slice(-2))
    const panel = calendar.filter({ has: field.page().locator('.arco-picker-header-title')
      .filter({ hasText: new RegExp(`^\\s*${year}\\s*-\\s*${month}\\s*$`) }) }).first()
    await flowExpect(panel, '日期日历必须定位到目标年月').toBeVisible()
    const cells = panel.locator('.arco-picker-cell-in-view')
      .filter({ hasText: new RegExp(`^${day}$`) })
    await clickWhenReady(cells.first())
    await clickWhenReady(cells.first())
  } else {
    await inputs.nth(1).press('Escape')
  }
  await expect(inputs.nth(0), '日期开始值应正确回显').toHaveValue(date)
  await expect(inputs.nth(1), '日期结束值应正确回显').toHaveValue(date)
  await flowExpect(inputs.nth(0), '日期开始值必须正确回显').toHaveValue(date)
  await flowExpect(inputs.nth(1), '日期结束值必须正确回显').toHaveValue(date)
}

async function chooseOption(page, field, desiredText) {
  await clickWhenReady(field.locator('.arco-select'))
  const dropdown = page.locator('.arco-select-dropdown:visible')
  await flowExpect(dropdown, '选项下拉框必须出现').toBeVisible()
  const options = dropdown.locator('.arco-select-option:not(.arco-select-option-disabled)')
  await flowExpect(options.first(), '选项下拉框必须有可选项').toBeVisible()
  const target = desiredText
    ? options.filter({ hasText: desiredText instanceof RegExp ? desiredText
      : new RegExp(`^\\s*${desiredText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) })
    : options.first()
  await flowExpect(target, `目标选项 ${desiredText || '第一项'} 必须存在`).toHaveCount(1)
  await clickWhenReady(target)
}

async function runSearchCase(page, fields, key, sample, label, { reset = true } = {}) {
  if (reset) await resetSearch(page)
  const index = SEARCH_KEYS.indexOf(key)
  const field = fields.nth(index)
  const sampleValue = key === 'filter[title]' ? String(sample.title ?? '').trim()
    : key === 'filter[creator_name]' ? String(sample.creator_name ?? '').trim()
      : DATE_KEYS.has(key) ? dayOf(sample[key.slice(7, -9)]) : ''
  if (DATE_KEYS.has(key)) await fillDateRange(field, sampleValue)
  else if (key === 'filter[title]' || key === 'filter[creator_name]') {
    const input = field.locator('input:not([readonly])')
    await flowExpect(input, `${label}文本输入框必须唯一`).toHaveCount(1)
    await input.fill(sampleValue)
    if (key === 'filter[creator_name]') {
      const dropdown = page.locator('.arco-select-dropdown:visible')
      if (await dropdown.count()) {
        const option = dropdown.locator('.arco-select-option').filter({ hasText: sampleValue })
        if (await option.count()) await clickWhenReady(option.first())
      }
    }
    if (key === 'filter[creator_name]') {
      await expect(field.locator('.arco-select'), `${label}应显示已选择的创建人`)
        .toContainText(sampleValue)
      await flowExpect(field.locator('.arco-select'), `${label}必须显示已选择的创建人`)
        .toContainText(sampleValue)
    } else {
      await expect(input, `${label}输入值应正确回显`).toHaveValue(sampleValue)
    }
  } else {
    const optionText = key === 'filter[time_range]' ? TIME_RANGE_OPTION[sample.time_range]
      : key === 'filter[status]' ? /已发布|已發佈/ : /表单|表單/
    await chooseOption(page, field, optionText)
  }
  const promise = listResponse(page, url => queryValues(url, key).length > 0)
  await clickWhenReady(page.locator('.custom-filter').getByRole('button', {
    name: /^(查询|查詢|搜索|搜尋)$/,
  }))
  const response = await promise
  const body = await businessResponse(response, `${label}列表查询`)
  const url = new URL(response.url())
  const expectedKeys = key === 'filter[creator_name]'
    ? ['filter[creator_name]', 'filter[creator]'] : [key]
  expect(activeFilterKeys(url), `${label}请求只能有当前搜索项`).toEqual(expectedKeys)
  flowExpect(activeFilterKeys(url), `${label}请求必须只含当前搜索项`).toEqual(expectedKeys)
  expect(url.searchParams.get('page'), `${label}应从第一页查询`).toBe('1')
  const values = queryValues(url, key)
  const actualValue = DATE_KEYS.has(key) ? sampleValue : values[0]
  if (DATE_KEYS.has(key)) {
    expect(values.every(value => value.includes(sampleValue)), `${label}起止日期都应包含样本日期`)
      .toBe(true)
  } else if (key === 'filter[title]' || key === 'filter[creator_name]') {
    expect(values, `${label}请求值应与输入一致`).toContain(sampleValue)
    if (key === 'filter[creator_name]') {
      expect(queryValues(url, 'filter[creator]'), '创建人 ID 应与选中的样本一致')
        .toContain(String(sample.creator))
      flowExpect(queryValues(url, 'filter[creator]'), '创建人 ID 必须与选中的样本一致')
        .toContain(String(sample.creator))
    }
  }
  const records = listRecords(body, label)
  expect(records.length, `${label}应至少正向命中一条记录`).toBeGreaterThan(0)
  flowExpect(records.length, `${label}必须至少正向命中一条记录`).toBeGreaterThan(0)
  assertFilteredRecords(records, key, actualValue, label)
  await assertPageRows(page, records, label)
  return { key, value: values, count: records.length }
}

async function fetchCategories(page, apiBaseUrl, authorization, label) {
  const body = await fetchJson(page, apiBaseUrl, authorization, '/be/form/category', label)
  expect(Array.isArray(body?.data), `${label}应返回分类数组`).toBe(true)
  flowExpect(Array.isArray(body?.data), `${label}必须返回分类数组`).toBe(true)
  return body.data
}

export async function run({
  siteBaseUrl, apiBaseUrl, extraHTTPHeaders, ignoreHTTPSErrors = false,
  artifactWriter, signal, logger = () => undefined, recordApiResponse, recordResourceResponse,
}) {
  if (!siteBaseUrl || !apiBaseUrl) throw new Error('运行环境必须提供 Web 与 API 基址')
  const authorization = extraHTTPHeaders?.Authorization
  if (!authorization) throw new Error('搜索分类脚本必须使用环境登录后的 Token')
  if (new URL(siteBaseUrl).origin !== new URL(apiBaseUrl).origin) {
    throw new Error('Web 与 API 基址必须同源')
  }
  const network = { api: [], resources: [] }
  const mutations = new Map()
  const tokenViolations = []
  const categoryName = `自动化搜索分类-${Date.now()}`
  let browser
  let context
  let page
  let stopAbortClose = () => undefined
  let observer = { setPhase: () => undefined, stop: async () => undefined }
  let createdCategoryId = ''
  let categoryDeleted = false
  try {
    throwIfRunAborted(signal)
    browser = await launchGoogleChrome()
    stopAbortClose = closePlaywrightOnAbort(signal, () => ({ browser, context }), { logger })
    context = await browser.newContext({
      ignoreHTTPSErrors, viewport: { width: 1600, height: 1000 },
      locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
    })
    observer = attachNetworkObserver(context, {
      initialPhase: '打开表单列表',
      onApiResponse: entry => { network.api.push(entry); recordApiResponse?.(entry) },
      onResourceResponse: entry => { network.resources.push(entry); recordResourceResponse?.(entry) },
    })
    await observer.ready
    page = await context.newPage()
    observeUiReadiness(page)
    page.setDefaultTimeout(scaleTimeout(ACTION_TIMEOUT_MS))
    page.setDefaultNavigationTimeout(scaleTimeout(NAVIGATION_TIMEOUT_MS))
    const apiOrigin = new URL(apiBaseUrl).origin
    page.on('request', request => {
      const url = new URL(request.url())
      if (url.origin !== apiOrigin || !url.pathname.startsWith('/api/be/')) return
      if (request.headers().authorization !== authorization) {
        tokenViolations.push(`${request.method()} ${url.pathname}`)
      }
      if (['POST', 'PUT', 'DELETE'].includes(request.method())) {
        const key = `${request.method()} ${url.pathname}`
        mutations.set(key, (mutations.get(key) ?? 0) + 1)
      }
    })
    await context.addInitScript(({ token }) => {
      localStorage.setItem('token', token)
      localStorage.setItem('arco-locale', 'zh-CN')
    }, { token: authorization })

    await page.goto(pageUrl(siteBaseUrl, '/form-activity/list'), { waitUntil: 'domcontentloaded' })
    await expect(page, '登录后不应跳转登录页').not.toHaveURL(/\/login(?:[/?#]|$)/)
    await dismissFormOnboarding(page)
    const fields = await openAllSearchFields(page)
    const samples = await sampleRecords(page, apiBaseUrl, authorization)
    const ordinary = samples.find(record => record.title && record.creator_name && record.created_at
      && record.updated_at && (record.is_activity === 2 || record.is_activity === '2'
        || record.is_activity === 0 || record.is_activity === false || record.is_activity === '0'))
    const endTime = samples.find(record => dayOf(record.end_time))
    const timeRange = samples.find(record => record.time_range === 'not_started')
    flowExpect(ordinary, '正向搜索样本必须包含标题、创建人、时间及表格类型').toBeTruthy()
    flowExpect(endTime, '结束时间筛选必须找到非空样本').toBeTruthy()
    flowExpect(timeRange, '提交时间状态筛选必须找到非空样本').toBeTruthy()
    const cases = [
      [SEARCH_KEYS[1], ordinary, '标题'], [SEARCH_KEYS[2], ordinary, '类型'],
      [SEARCH_KEYS[3], ordinary, '创建人'], [SEARCH_KEYS[4], timeRange, '提交时间状态'],
      [SEARCH_KEYS[6], samples.find(record => record.status === 'published'), '发布状态'],
      [SEARCH_KEYS[0], ordinary, '创建时间'], [SEARCH_KEYS[5], endTime, '提交截止时间'],
      [SEARCH_KEYS[7], ordinary, '更新时间'],
    ]
    const searchResults = []
    for (const [index, [key, sample, label]] of cases.entries()) {
      flowExpect(sample, `${label}必须有正向样本`).toBeTruthy()
      observer.setPhase(`搜索项：${label}`)
      searchResults.push(await runSearchCase(page, fields, key, sample, label,
        { reset: index !== 0 }))
      logger('success', `${label}搜索接口与页面一致`, { key, count: searchResults.at(-1).count })
    }

    observer.setPhase('验证仅看我的')
    await resetSearch(page)
    const onlyMine = page.locator('.table-tabs-add-category')
    await flowExpect(onlyMine, '仅看我的按钮必须唯一').toHaveCount(1)
    await flowExpect(onlyMine, '仅看我的按钮必须可用').toBeEnabled()
    await expect(onlyMine, '仅看我的默认应关闭').toHaveAttribute('aria-pressed', 'false')
    const minePromise = listResponse(page, url => queryValues(url, 'filter[creator]').length > 0)
    await clickWhenReady(onlyMine)
    const mineResponse = await minePromise
    const mineBody = await businessResponse(mineResponse, '仅看我的查询')
    const mineUrl = new URL(mineResponse.url())
    expect(activeFilterKeys(mineUrl), '仅看我的必须同时提交创建人 ID 和名称')
      .toEqual(['filter[creator_name]', 'filter[creator]'])
    const creatorId = queryValues(mineUrl, 'filter[creator]')[0]
    const creatorName = queryValues(mineUrl, 'filter[creator_name]')[0]
    expect(creatorId, '仅看我的必须提交非空账号 ID').not.toBe('')
    expect(creatorName, '仅看我的必须提交非空账号名称').not.toBe('')
    const mineRecords = listRecords(mineBody, '仅看我的')
    expect(mineRecords.length, '仅看我的应命中账号自己的表单').toBeGreaterThan(0)
    for (const record of mineRecords) {
      expect(record.creator_name, `仅看我的表单 ${recordId(record)} 创建人应匹配账号`)
        .toBe(creatorName)
    }
    await assertPageRows(page, mineRecords, '仅看我的')
    await expect(onlyMine, '仅看我的点击后应开启').toHaveAttribute('aria-pressed', 'true')
    const allMinePromise = listResponse(page, url => !queryValues(url, 'filter[creator]').length)
    await clickWhenReady(onlyMine)
    const allMineBody = await businessResponse(await allMinePromise, '关闭仅看我的')
    await expect(onlyMine, '仅看我的再次点击应关闭').toHaveAttribute('aria-pressed', 'false')
    await assertPageRows(page, listRecords(allMineBody, '关闭仅看我的'), '关闭仅看我的')

    observer.setPhase('新增分类并在列表中选择')
    const before = await fetchCategories(page, apiBaseUrl, authorization, '新增前分类列表')
    await clickWhenReady(page.getByRole('button', { name: /基础设置/ }))
    const settings = page.locator('.form-activity-base-settings-modal:visible')
    await flowExpect(settings, '基础设置弹窗必须唯一').toHaveCount(1)
    await flowExpect(settings.locator('.manage-category'), '分类管理必须显示').toBeVisible()
    await clickWhenReady(settings.locator('.manage-category').getByRole('button', { name: /新增|添加|增加/ }))
    const addModal = page.locator('.arco-modal:visible').last()
    await flowExpect(addModal, '新增分类弹窗必须显示').toBeVisible()
    await page.waitForTimeout(600)
    await addModal.locator('.arco-form-item').filter({ hasText: '标题' }).locator('input').fill(categoryName)
    await addModal.locator('.arco-form-item').filter({ hasText: '排序' }).locator('input')
      .fill(String(CATEGORY_SORT))
    await addModal.locator('.arco-form-item').filter({ hasText: /描述/ }).locator('textarea')
      .fill(CATEGORY_DESCRIPTION)
    const createPromise = exactResponse(page, 'POST', '/be/form/category')
    await clickWhenReady(addModal.getByRole('button', { name: /^(提交|确认|确定)$/ }))
    const createResponse = await createPromise
    const createBody = await businessResponse(createResponse, '新增分类')
    if (CATEGORY_ID_PATTERN.test(String(createBody?.data?.id ?? ''))) {
      createdCategoryId = String(createBody.data.id)
    }
    expect(createResponse.request().postDataJSON().title, '创建请求标题应正确').toBe(categoryName)
    expect(createResponse.request().postDataJSON().description, '创建请求描述应正确')
      .toBe(CATEGORY_DESCRIPTION)
    expect(createResponse.request().postDataJSON().sort, '创建请求排序应正确')
      .toBe(CATEGORY_SORT)
    const after = await fetchCategories(page, apiBaseUrl, authorization, '新增后分类列表')
    const created = after.filter(record => record.title === categoryName
      && !before.some(old => String(old.id) === String(record.id)))
    flowExpect(created, '本次分类必须恰好新增一条').toHaveLength(1)
    expect(Number(created[0]?.sort), '新增分类排序应持久化').toBe(CATEGORY_SORT)
    flowExpect(String(created[0].id), '分类 ID 必须是字母数字串').toMatch(CATEGORY_ID_PATTERN)
    if (createdCategoryId) {
      expect(String(created[0].id), '新增响应 ID 应与分类列表一致').toBe(createdCategoryId)
    }
    createdCategoryId = String(created[0].id)
    await expect(settings.locator('.manage-category__tag').filter({ hasText: categoryName }),
      '分类管理应显示新增分类').toHaveCount(1)
    await clickWhenReady(settings.locator('.arco-modal-close-btn'))
    await flowExpect(settings, '关闭基础设置后应返回列表').toHaveCount(0)
    const tabs = page.locator('.table-tabs-row')
    const directTab = tabs.locator('.arco-tabs-tab').filter({ hasText: categoryName })
    if (await directTab.count()) {
      const categoryPromise = listResponse(page, url => queryValues(url, 'filter[category_id]')
        .includes(createdCategoryId))
      await clickWhenReady(directTab)
      const body = await businessResponse(await categoryPromise, '选择新增分类')
      const rows = listRecords(body, '新增分类')
      expect(rows.every(record => String(record.category_id) === createdCategoryId),
        '分类筛选结果必须全部属于新分类').toBe(true)
      await assertPageRows(page, rows, '新增分类')
    } else {
      await clickWhenReady(tabs.locator('.table-more-category-trigger'))
      const option = page.locator('.category-option').filter({ hasText: categoryName })
      await flowExpect(option, '更多分类中必须有新增分类').toHaveCount(1)
      const categoryPromise = listResponse(page, url => queryValues(url, 'filter[category_id]')
        .includes(createdCategoryId))
      await clickWhenReady(option)
      const body = await businessResponse(await categoryPromise, '更多分类选择新增分类')
      const rows = listRecords(body, '新增分类')
      expect(rows.every(record => String(record.category_id) === createdCategoryId),
        '分类筛选结果必须全部属于新分类').toBe(true)
      await assertPageRows(page, rows, '新增分类')
    }

    observer.setPhase('删除本次新增分类并恢复全部分类')
    await clickWhenReady(page.getByRole('button', { name: /基础设置/ }))
    await flowExpect(settings, '基础设置弹窗应再次打开').toHaveCount(1)
    const createdTag = settings.locator('.manage-category__tag').filter({ hasText: categoryName })
    await flowExpect(createdTag, '只能定位本次新增的分类').toHaveCount(1)
    await clickWhenReady(createdTag.locator('.manage-category__remove'))
    const deleteDialog = page.locator('.arco-modal:visible').last()
    await flowExpect(deleteDialog, '分类删除确认弹窗必须显示').toBeVisible()
    const deletePromise = exactResponse(page, 'DELETE', `/be/form/category/${createdCategoryId}`)
    await clickWhenReady(deleteDialog.getByRole('button', { name: /^(确认|确定)$/ }))
    await businessResponse(await deletePromise, '删除本次新增分类')
    categoryDeleted = true
    const finalCategories = await fetchCategories(page, apiBaseUrl, authorization, '删除后分类列表')
    expect(finalCategories.some(record => String(record.id) === createdCategoryId),
      '删除后分类列表不得包含本次 ID').toBe(false)
    expect(finalCategories.length, '删除后分类总数应恢复').toBe(before.length)
    await expect(createdTag, '分类管理中不应再显示已删除分类').toHaveCount(0)
    await clickWhenReady(settings.locator('.arco-modal-close-btn'))
    const allTab = tabs.locator('.arco-tabs-tab').filter({ has: page.locator('.form-activity-category-tab-name')
      .filter({ hasText: /^(全部|全部分类)$/ }) })
    await flowExpect(allTab, '全部分类页签必须唯一').toHaveCount(1)
    const allPromise = listResponse(page, url => !queryValues(url, 'filter[category_id]').length)
    await clickWhenReady(allTab)
    const allResponse = await allPromise
    const allBody = await businessResponse(allResponse, '恢复全部分类')
    expect(activeFilterKeys(new URL(allResponse.url())), '全部分类不得残留任何筛选条件').toEqual([])
    const allRecords = listRecords(allBody, '全部分类')
    expect(allRecords.length, '全部分类列表应正常返回数据').toBeGreaterThan(0)
    await assertPageRows(page, allRecords, '全部分类')

    expect(mutations.get('POST /api/be/form/category'), '新增分类只能提交一次').toBe(1)
    expect(mutations.get(`DELETE /api/be/form/category/${createdCategoryId}`),
      '删除本次分类只能提交一次').toBe(1)
    expect(tokenViolations, '后台请求都必须携带环境 Token').toEqual([])
    await observer.waitForIdle({ timeoutMs: scaleTimeout(5_000), signal })
    expect(network.api.length, '必须采集到接口证据').toBeGreaterThan(0)
    expect(network.resources.length, '必须采集到资源证据').toBeGreaterThan(0)
    const relevantFailures = network.api.filter(entry => /\/api\/be\/form\/(?:list|category)/
      .test(new URL(entry.url).pathname) && !entry.ok)
    expect(relevantFailures, '列表和分类接口不得出现网络或 HTTP 错误').toEqual([])
    const siteOrigin = new URL(siteBaseUrl).origin
    expect(network.resources.filter(entry => new URL(entry.url).origin === siteOrigin && !entry.ok),
      '站内资源不得加载失败').toEqual([])
    logger('success', '八项搜索、仅看我的及分类新增删除验证完成', {
      searchCount: searchResults.length, createdCategoryId,
    })
    return {
      searchCount: searchResults.length, searchResults, createdCategoryId,
      deletedCategoryId: createdCategoryId, onlyMineCreatorId: creatorId,
      browser: 'chrome', headless: true,
      apiResponseCount: network.api.length, resourceResponseCount: network.resources.length,
    }
  } catch (error) {
    if (!signal?.aborted && page && artifactWriter?.captureScreenshot) {
      try {
        const screenshot = await artifactWriter.captureScreenshot(page,
          `screenshots/表单活动搜索项及分类-失败-${Date.now()}.png`, { fullPage: true })
        logger('error', '搜索分类流程失败，已保存截图', { artifact: screenshot })
      } catch (screenshotError) {
        logger('error', '搜索分类流程失败，截图保存失败', {
          reason: screenshotError instanceof Error ? screenshotError.message : String(screenshotError),
        })
      }
    }
    if (createdCategoryId && !categoryDeleted && page && !signal?.aborted) {
      try {
        const cleanup = await page.evaluate(async ({ url, token }) => {
          const response = await fetch(url, { method: 'DELETE', headers: { Authorization: token } })
          return { ok: response.ok, body: await response.json().catch(() => null) }
        }, {
          url: pageUrl(apiBaseUrl, `/be/form/category/${createdCategoryId}`),
          token: authorization,
        })
        logger(cleanup.ok && Number(cleanup.body?.code) === 0 ? 'info' : 'warning',
          '失败后定向清理本次新增分类', { createdCategoryId, success: cleanup.ok
            && Number(cleanup.body?.code) === 0 })
      } catch (cleanupError) {
        logger('warning', '失败后未能清理本次新增分类', { createdCategoryId,
          reason: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) })
      }
    }
    throw error
  } finally {
    observer.setPhase('结束清理')
    await observer.stop({ signal })
    const abortCloseStarted = await stopAbortClose()
    if (!abortCloseStarted) await closePlaywrightHandles({ context, browser }, { logger })
  }
}
