import { resolveAdminLocale } from './support/admin-locale.mjs'
import { parseSearchSamples } from './support/submission-search-samples.mjs'
import { clickWhenReady, observeUiReadiness } from './support/ui-readiness.mjs'
import { scaleTimeout } from './support/environment-timeouts.mjs'
import { expect as flowExpect } from './support/environment-timeouts.mjs'

import { attachNetworkObserver } from './support/api-response-recorder.mjs'
import { launchGoogleChrome } from './support/google-chrome.mjs'
import { expect } from './support/recorded-expect.mjs'
import {
  closePlaywrightHandles,
  closePlaywrightOnAbort,
  throwIfRunAborted,
} from './playwright-run-control.mjs'

const SCRIPT_ID = 'form-submission-list-check'
const DEFAULT_REQUEST_PATH = '/form-activity/submission/preview?id=4J02PQ'
const NAVIGATION_TIMEOUT_MS = 45_000
const ACTION_TIMEOUT_MS = 30_000
const SEARCH_RESPONSE_TIMEOUT_MS = 15_000
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const DETAILS_TAB_PATTERN = /(?:提报详情|提報詳情|Submission Details?|填报详情|填報詳情|填报记录|填報記錄|Responses)/i
const CONTACT_TAB_PATTERN = /(?:联系人信息|聯絡人資訊|聯繫人資訊|Contact Information)/i
const CONTACT_TAG_PATTERN = /^(?:已关联联系人|已關聯聯絡人|已關聯聯繫人|Contact linked)$/i
const VIEW_PATTERN = /^(?:查看|檢視|View)$/i
const QUERY_PATTERN = /^(?:查询|查詢|搜索|搜尋|Search|Query)$/i
const RESET_PATTERN = /^(?:重置|重设|重設|Reset)$/i
const CONFIRM_PATTERN = /^(?:确认|確認|確定|保存|儲存|Apply|Save|OK)$/i
const NAME_LABEL_PATTERN = /^\s*(?:姓名|Name)\s*$/i

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeRequestPath(value = DEFAULT_REQUEST_PATH) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('提报列表 URL 路径不能为空')
  const requestPath = value.trim()
  if (/^[a-z][a-z\d+.-]*:/i.test(requestPath) || requestPath.startsWith('//')) {
    throw new Error('提报列表 URL 路径必须是相对路径')
  }
  if (/\s/.test(requestPath)) throw new Error('提报列表 URL 路径不能包含空格或换行')
  if (requestPath.includes('\\')) throw new Error('提报列表 URL 路径不能包含反斜杠')
  return requestPath.startsWith('/') ? requestPath : `/${requestPath}`
}

function buildListUrl(siteBaseUrl, requestPath = DEFAULT_REQUEST_PATH) {
  const siteOrigin = new URL(siteBaseUrl).origin
  const listUrl = new URL(normalizeRequestPath(requestPath).replace(/^\/+/, ''), `${siteOrigin}/`)
  if (listUrl.origin !== siteOrigin) throw new Error('提报列表地址必须与所选环境同源')
  return listUrl.toString()
}

function requiredIdentifier(value, label) {
  const identifier = String(value ?? '').trim()
  if (!identifier || /{{|}}/.test(identifier)) throw new Error(`${label} 必须是非空运行时参数`)
  if (/\s/.test(identifier)) throw new Error(`${label} 不能包含空格或换行`)
  return identifier
}

function resolveListContext(listUrl, variables = {}) {
  const url = new URL(listUrl)
  if (url.pathname !== '/form-activity/submission/preview') {
    throw new Error('提报列表 URL 必须指向 submission/preview 路由')
  }
  const queryFormId = String(url.searchParams.get('id') ?? '').trim()
  const variableFormId = String(variables.FORM_ID ?? '').trim()
  if (queryFormId && variableFormId && queryFormId !== variableFormId) {
    throw new Error('FORM_ID 与提报列表 URL 的 id 参数不一致')
  }
  const formId = requiredIdentifier(queryFormId || variableFormId, 'FORM_ID')
  const submissionId = requiredIdentifier(variables.SUBMISSION_ID, 'SUBMISSION_ID')
  return { formId, submissionId }
}

function parseJsonObject(value, label) {
  if (value === undefined || value === null || value === '') return {}
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch (error) {
      throw new Error(`${label} 不是有效 JSON`, { cause: error })
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} 必须是 JSON 对象`)
  }
  return parsed
}

function optionalString(value, label) {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 必须是非空字符串`)
  return value.trim()
}

function normalizeAssertionFields(value) {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('SUBMISSION_ASSERTIONS.fields 必须是字段值对象')
  }
  return Object.fromEntries(Object.entries(value).map(([label, fieldValue]) => {
    const normalizedLabel = normalizeWhitespace(label)
    if (!normalizedLabel) throw new Error('SUBMISSION_ASSERTIONS.fields 字段名不能为空')
    if (!['string', 'number', 'boolean'].includes(typeof fieldValue)) {
      throw new Error(`SUBMISSION_ASSERTIONS.fields.${normalizedLabel} 必须是字符串、数字或布尔值`)
    }
    return [normalizedLabel, String(fieldValue).trim()]
  }))
}

function fieldContactNames(fields) {
  const indexedPrimary = fields['姓名[1]'] ?? fields['Name[1]']
  const indexedGroup = fields['姓名[2]'] ?? fields['Name[2]']
  const unindexed = Object.entries(fields)
    .filter(([label]) => /^(?:姓名|Name)$/i.test(label))
    .map(([, value]) => value)
  return {
    primaryContactName: indexedPrimary ?? unindexed[0] ?? '',
    groupContactName: indexedGroup ?? unindexed[1] ?? '',
  }
}

function assertConsistentName(explicitName, fieldName, label) {
  if (explicitName && fieldName && explicitName !== fieldName) {
    throw new Error(`SUBMISSION_ASSERTIONS.${label} 与 fields 中对应姓名不一致`)
  }
  return explicitName || fieldName
}

function parseSubmissionAssertions(value) {
  const parsed = parseJsonObject(value, 'SUBMISSION_ASSERTIONS')
  const unknownKeys = Object.keys(parsed).filter((key) => (
    !['title', 'primaryContactName', 'groupContactName', 'fields', 'searchSamples'].includes(key)
  ))
  if (unknownKeys.length > 0) {
    throw new Error(`SUBMISSION_ASSERTIONS 包含不支持的配置项：${unknownKeys.join(', ')}`)
  }
  const title = optionalString(parsed.title, 'SUBMISSION_ASSERTIONS.title')
  const explicitPrimary = optionalString(
    parsed.primaryContactName,
    'SUBMISSION_ASSERTIONS.primaryContactName',
  )
  const explicitGroup = optionalString(
    parsed.groupContactName,
    'SUBMISSION_ASSERTIONS.groupContactName',
  )
  const fields = normalizeAssertionFields(parsed.fields)
  const fieldNames = fieldContactNames(fields)
  const primaryContactName = assertConsistentName(
    explicitPrimary,
    fieldNames.primaryContactName,
    'primaryContactName',
  )
  const groupContactName = assertConsistentName(
    explicitGroup,
    fieldNames.groupContactName,
    'groupContactName',
  )
  return {
    title,
    primaryContactName,
    groupContactName,
    fields,
    ...(parsed.searchSamples === undefined ? {} : { searchSamples: parseSearchSamples(parsed.searchSamples) }),
    configuredAssertionCount: Number(Boolean(title))
      + Number(Boolean(primaryContactName))
      + Number(Boolean(groupContactName))
      + Object.keys(fields).filter((label) => !['姓名[1]', '姓名[2]', 'Name[1]', 'Name[2]'].includes(label)).length,
  }
}

function createFuzzyProbe(value) {
  const normalized = normalizeWhitespace(value)
  if (!normalized) throw new Error('模糊搜索样本不能为空')
  const tokens = [...normalized.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => ({
    text: match[0],
    index: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }))
  let candidates = tokens
  if (normalized.includes('*')) {
    const lastMaskIndex = normalized.lastIndexOf('*')
    const trailing = tokens.filter(({ index }) => index > lastMaskIndex)
    if (trailing.length > 0) candidates = trailing
  } else if (normalized.includes('@')) {
    const atIndex = normalized.indexOf('@')
    const domain = tokens.filter(({ index }) => index > atIndex)
    if (domain.length > 0) candidates = domain
  }
  candidates.sort((left, right) => {
    const lengthDifference = Array.from(right.text).length - Array.from(left.text).length
    if (lengthDifference !== 0) return lengthDifference
    const leftInternal = Number(left.index > 0 && left.end < normalized.length)
    const rightInternal = Number(right.index > 0 && right.end < normalized.length)
    return rightInternal - leftInternal
  })
  const source = candidates[0]?.text ?? normalized
  const characters = Array.from(source)
  if (characters.length <= 2) return source
  const probeLength = Math.min(10, Math.max(1, Math.ceil(characters.length / 2)))
  const maximumStart = Math.max(1, characters.length - probeLength - 1)
  const start = Math.min(maximumStart, Math.max(1, Math.floor((characters.length - probeLength) / 2)))
  return characters.slice(start, Math.min(characters.length - 1, start + probeLength)).join('')
}

function buildAdminApiPath(apiPathPrefix, resourcePath) {
  const normalizedPrefix = String(apiPathPrefix || '').replace(/^\/+|\/+$/g, '')
  const normalizedResourcePath = String(resourcePath || '').replace(/^\/+/, '')
  return `${normalizedPrefix ? `/${normalizedPrefix}` : ''}/${normalizedResourcePath}`
}

function responseMatchesGet(response, { origin, pathname }) {
  const request = response.request()
  if (request.method().toUpperCase() !== 'GET') return false
  const url = new URL(response.url())
  return url.origin === origin && url.pathname === pathname
}

function isSubmissionListResponse(response, {
  origin,
  formId,
  apiPathPrefix = '/api',
}) {
  return responseMatchesGet(response, {
    origin,
    pathname: buildAdminApiPath(
      apiPathPrefix,
      `/be/form/${encodeURIComponent(formId)}/submission`,
    ),
  })
}

function isContactListResponse(response, {
  origin,
  formId,
  apiPathPrefix = '/api',
}) {
  return responseMatchesGet(response, {
    origin,
    pathname: buildAdminApiPath(
      apiPathPrefix,
      `/be/form/${encodeURIComponent(formId)}/contact`,
    ),
  })
}

function isTabCountsResponse(response, {
  origin,
  formId,
  apiPathPrefix = '/api',
}) {
  return responseMatchesGet(response, {
    origin,
    pathname: buildAdminApiPath(
      apiPathPrefix,
      `/be/form/${encodeURIComponent(formId)}/tab-counts`,
    ),
  })
}

function isSubmissionDetailResponse(response, {
  origin,
  formId,
  submissionId,
  apiPathPrefix = '/api',
}) {
  return responseMatchesGet(response, {
    origin,
    pathname: buildAdminApiPath(
      apiPathPrefix,
      `/be/form/${encodeURIComponent(formId)}/submission/${encodeURIComponent(submissionId)}`,
    ),
  })
}

function isApiBusinessRequest(request, apiOrigin, apiPathPrefix) {
  if (!['fetch', 'xhr'].includes(request.resourceType())) return false
  const url = new URL(request.url())
  if (url.origin !== apiOrigin) return false
  if (apiPathPrefix !== '/' && (
    url.pathname === apiPathPrefix || url.pathname.startsWith(`${apiPathPrefix}/`)
  )) return true
  return /^\/(?:api\/)?(?:be|base)\//.test(url.pathname)
}

function arraysOfObjects(value, path = '', depth = 0, output = []) {
  if (depth > 7 || value === null || typeof value !== 'object') return output
  if (Array.isArray(value)) {
    if (value.length === 0 || value.some((item) => item && typeof item === 'object')) {
      output.push({ path, records: value })
    }
    for (const [index, item] of value.entries()) {
      arraysOfObjects(item, `${path}[${index}]`, depth + 1, output)
    }
    return output
  }
  for (const [key, child] of Object.entries(value)) {
    arraysOfObjects(child, path ? `${path}.${key}` : key, depth + 1, output)
  }
  return output
}

function objectContainsExactValue(value, expected, depth = 0) {
  if (depth > 8) return false
  if (value === expected) return true
  if (value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some((item) => objectContainsExactValue(item, expected, depth + 1))
  return Object.values(value).some((item) => objectContainsExactValue(item, expected, depth + 1))
}

function payloadContainsText(value, expected, depth = 0) {
  if (!expected) return true
  if (depth > 9) return false
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).includes(expected)
  }
  if (value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some((item) => payloadContainsText(item, expected, depth + 1))
  return Object.values(value).some((item) => payloadContainsText(item, expected, depth + 1))
}

function recordCollection(body) {
  const candidates = arraysOfObjects(body)
  const preferred = candidates.find(({ path }) => (
    /(?:^|\.)(?:list|records|rows|items|submissions|contacts)$/.test(path)
  ))
  return preferred?.records ?? candidates[0]?.records ?? []
}

function locateSubmissionRecord(body, submissionId) {
  for (const { records } of arraysOfObjects(body)) {
    const targetIndex = records.findIndex((record) => objectContainsExactValue(record, submissionId))
    if (targetIndex >= 0) {
      return { records, targetRecord: records[targetIndex], targetIndex }
    }
  }
  return { records: recordCollection(body), targetRecord: null, targetIndex: -1 }
}

async function readJsonResponse(response, label) {
  const httpSucceeded = response.ok()
  expect(httpSucceeded, `${label}应返回成功 HTTP 状态，实际 ${response.status()}`).toBe(true)
  let text
  try {
    text = await response.text()
  } catch (error) {
    expect(false, `${label}响应体应可读取`).toBe(true)
    return { body: null, httpSucceeded, businessSucceeded: false, error }
  }
  if (!String(text).trim()) {
    expect(false, `${label}应返回非空 JSON`).toBe(true)
    return { body: null, httpSucceeded, businessSucceeded: false }
  }
  let body
  try {
    body = JSON.parse(text)
  } catch (error) {
    expect(false, `${label}应返回有效 JSON`).toBe(true)
    return { body: null, httpSucceeded, businessSucceeded: false, error }
  }
  const objectBody = Boolean(body && typeof body === 'object' && !Array.isArray(body))
  expect(objectBody, `${label}返回 JSON 应为对象`).toBe(true)
  let businessSucceeded = objectBody
  if (objectBody && Object.prototype.hasOwnProperty.call(body, 'code')) {
    const codeSucceeded = Number(body.code) === 0
    expect(codeSucceeded, `${label}业务码应为 0，实际 ${body.code}`).toBe(true)
    businessSucceeded = businessSucceeded && codeSucceeded
  }
  if (objectBody && Object.prototype.hasOwnProperty.call(body, 'success')) {
    const explicitSuccess = body.success === true
    expect(explicitSuccess, `${label} success 应为 true`).toBe(true)
    businessSucceeded = businessSucceeded && explicitSuccess
  }
  return { body, httpSucceeded, businessSucceeded }
}

async function inspectListResponse(response, {
  submissionId,
  expectedNames = [],
  label = '提报列表接口',
} = {}) {
  const inspected = await readJsonResponse(response, label)
  const located = inspected.body && submissionId
    ? locateSubmissionRecord(inspected.body, submissionId)
    : { records: recordCollection(inspected.body), targetRecord: null, targetIndex: -1 }
  if (submissionId) {
    expect(
      located.targetIndex,
      `${label}响应列表应包含目标提报 ID：${submissionId}`,
    ).toBeGreaterThanOrEqual(0)
  }
  for (const name of expectedNames.filter(Boolean)) {
    expect(
      payloadContainsText(located.targetRecord ?? inspected.body, name),
      `${label}目标记录应包含联系人姓名“${name}”`,
    ).toBe(true)
  }
  return {
    ...inspected,
    ...located,
    succeeded: inspected.httpSucceeded
      && inspected.businessSucceeded
      && (!submissionId || located.targetIndex >= 0),
  }
}

async function recordAndRequireCount(locator, count, message) {
  await expect(locator, message).toHaveCount(count)
  await flowExpect(locator, message).toHaveCount(count)
}

async function recordAndRequireVisible(locator, message) {
  await expect(locator, message).toBeVisible()
  await flowExpect(locator, message).toBeVisible()
}

async function recordAndRequireEnabled(locator, message) {
  await expect(locator, message).toBeEnabled()
  await flowExpect(locator, message).toBeEnabled()
}

function dataRows(page) {
  return page.locator('main table tbody tr').filter({ has: page.locator('td') })
}

function filterCardLocator(page) {
  return page.locator('.comp-filter-card:visible, main .filter-card:visible')
}

async function resolveTab(page, pattern, message) {
  const tabs = page.locator('.arco-tabs-tab')
  await expect.poll(() => tabs.count(), {
    message: '提报列表页应至少显示提报详情和联系人信息两个 Tab',
  }).toBeGreaterThanOrEqual(2)
  const translatedMatches = tabs.filter({ hasText: pattern })
  await expect(translatedMatches, `${message}应使用受支持的简体、繁体或英文文案`).toHaveCount(1)
  // Extra tabs are valid. Only an absent/ambiguous target prevents safe navigation.
  await flowExpect(translatedMatches, `${message}必须能唯一定位，避免切换到付款等其他页面`).toHaveCount(1)
  return translatedMatches
}

async function assertTopInformation(page, assertions) {
  const title = page.locator('.info-card__title')
  await expect(title, '页面顶部应唯一显示表单名称').toHaveCount(1)
  await expect(title.first(), '页面顶部表单名称应可见').toBeVisible()
  const actualTitle = normalizeWhitespace((await title.allTextContents()).join(' '))
  expect(actualTitle, '页面顶部表单名称不能为空').not.toBe('')
  if (assertions.title) {
    expect(actualTitle, '页面顶部名称应与 SUBMISSION_ASSERTIONS.title 完全一致')
      .toBe(assertions.title)
  }

  const contactState = page.locator('.info-card__property--contact')
  await expect(contactState, '页面顶部应唯一显示联系人关联状态').toHaveCount(1)
  await expect(contactState.first(), '页面顶部联系人关联状态应可见').toBeVisible()
  const actualTag = normalizeWhitespace((await contactState.locator('dd').allTextContents()).join(' '))
  expect(actualTag, '本次收录联系人表单应显示已关联联系人状态')
    .toMatch(CONTACT_TAG_PATTERN)
  return { actualTitle, actualTag }
}

async function waitForRequiredResponse(page, predicate, label) {
  try {
    return await page.waitForResponse(predicate, { timeout: scaleTimeout(ACTION_TIMEOUT_MS) })
  } catch (error) {
    throw new Error(`${label}未在 ${scaleTimeout(ACTION_TIMEOUT_MS)} ms 内完成`, { cause: error })
  }
}

function suppressUnhandledRejection(promise) {
  void promise.catch(() => undefined)
  return promise
}

async function targetRowFromIndex(page, targetIndex) {
  const rows = dataRows(page)
  await expect(rows, '提报详情表格应至少显示一条数据').not.toHaveCount(0)
  await flowExpect.poll(() => rows.count(), {
    message: '提报详情表格必须加载数据行后才能定位目标提报',
    timeout: scaleTimeout(ACTION_TIMEOUT_MS),
  }).toBeGreaterThan(0)
  const rowCount = await rows.count()
  expect(targetIndex, '目标提报在接口列表中的序号应映射到界面数据行').toBeLessThan(rowCount)
  if (targetIndex < 0 || targetIndex >= rowCount) {
    throw new Error(`无法安全定位目标提报：序号 ${targetIndex}，界面行数 ${rowCount}`)
  }
  const row = rows.nth(targetIndex)
  await recordAndRequireVisible(row, '目标提报对应的列表行应可见')
  return row
}

async function detailNameValues(page, scope = page) {
  const rows = scope.locator('.reply-kv__row').filter({
    has: page.locator('.reply-kv__label').filter({ hasText: NAME_LABEL_PATTERN }),
  })
  await expect(rows, '提报详情页应显示题组外和题组内两个姓名字段').toHaveCount(2)
  await flowExpect.poll(() => rows.count(), { message: '后续联系人校验至少需要两个姓名字段' }).toBeGreaterThanOrEqual(2)
  const names = []
  for (let index = 0; index < 2; index += 1) {
    const value = normalizeWhitespace(await rows.nth(index).locator('.reply-kv__value').innerText())
    expect(value, `提报详情第 ${index + 1} 个姓名值不能为空`).not.toBe('')
    names.push(value)
  }
  expect(new Set(names).size, '题组外和题组内联系人姓名应为两个可区分的值').toBe(2)
  return names
}

function exactDetailUrl(siteOrigin, formId, submissionId) {
  return new URL(
    `/form-activity/submission/preview/reply/${encodeURIComponent(submissionId)}?fid=${encodeURIComponent(formId)}`,
    siteOrigin,
  ).toString()
}

async function openAndInspectDetail(page, {
  row,
  siteOrigin,
  apiContext,
  formId,
  submissionId,
  assertions,
}) {
  const viewButton = row.getByRole('button', { name: VIEW_PATTERN })
  await recordAndRequireCount(viewButton, 1, '目标提报行操作栏应唯一显示查看按钮')
  await recordAndRequireVisible(viewButton, '目标提报行查看按钮应可见')
  await recordAndRequireEnabled(viewButton, '目标提报行查看按钮应可用')
  const detailResponsePromise = suppressUnhandledRejection(waitForRequiredResponse(
    page,
    (response) => isSubmissionDetailResponse(response, {
      ...apiContext,
      formId,
      submissionId,
    }),
    '目标提报详情接口',
  ))
  const listUrl = page.url()
  const drawer = page.locator('.submission-reply-detail-drawer .arco-drawer:visible')
  await clickWhenReady(viewButton)
  const expectedUrl = exactDetailUrl(siteOrigin, formId, submissionId)
  await flowExpect.poll(async () => (
    await drawer.isVisible() || page.url() === expectedUrl
  ), {
    message: '查看操作应打开提报详情抽屉或目标提报的精确详情页',
    timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS),
  }).toBe(true)
  const presentation = await drawer.isVisible() ? 'drawer' : 'page'
  const detailRoot = presentation === 'drawer' ? drawer : page.locator('main')
  if (presentation === 'drawer') {
    await recordAndRequireCount(drawer, 1, '查看操作应唯一打开提报详情抽屉')
    await recordAndRequireVisible(drawer, '提报详情抽屉应可见')
    await expect(page, '打开详情抽屉应保留原列表地址').toHaveURL(listUrl)
  } else {
    await expect(page, '详情 URL 中的提报 ID 和 fid 应与流水线参数完全一致').toHaveURL(expectedUrl)
  }
  const detailResponse = await detailResponsePromise
  const detailInspection = await readJsonResponse(detailResponse, '目标提报详情接口')
  await flowExpect(detailInspection.httpSucceeded && detailInspection.businessSucceeded,
    '详情接口必须成功后才能校验目标答卷').toBe(true)
  const submission = detailInspection.body?.data?.submission ?? detailInspection.body?.data
  expect(submission?.id, '详情接口答卷 ID 应与目标提报 ID 完全一致').toBe(submissionId)
  await flowExpect(submission?.id, '答卷 ID 不匹配时应停止后续详情检查').toBe(submissionId)
  expect(submission?.form_id, '详情接口答卷所属表单 ID 应与当前表单完全一致').toBe(formId)
  await flowExpect(submission?.form_id, '答卷所属表单不匹配时应停止后续详情检查').toBe(formId)

  const names = await detailNameValues(page, detailRoot)
  const answerNames = []
  const collectNames = (value) => {
    if (!value || typeof value !== 'object') return
    if (value.type_code === 'username' && Array.isArray(value.value)) {
      for (const entry of value.value) {
        const answer = entry.answer
        const name = typeof answer === 'string' ? answer
          : answer?.[answer.collect_mode] || answer?.name_zh || answer?.name_en
        if (name) answerNames.push(normalizeWhitespace(name))
      }
      return
    }
    for (const child of Object.values(value)) collectNames(child)
  }
  collectNames(detailInspection.body)
  const [actualPrimaryName, actualGroupName] = answerNames.length === 2 ? answerNames : names
  expect(names[0], '详情页应显示接口中的题组外姓名，允许附加称谓').toContain(actualPrimaryName)
  expect(names[1], '详情页应显示接口中的题组内姓名，允许附加称谓').toContain(actualGroupName)
  if (assertions.primaryContactName) {
    expect(actualPrimaryName, '详情页题组外姓名应与前序填写脚本输出一致')
      .toBe(assertions.primaryContactName)
  }
  if (assertions.groupContactName) {
    expect(actualGroupName, '详情页题组内姓名应与前序填写脚本输出一致')
      .toBe(assertions.groupContactName)
  }
  await expect.poll(() => detailRoot.locator('img[src]').evaluateAll((images) => (
    images.filter((image) => !image.complete || image.naturalWidth === 0).length
  )), {
    message: '离开详情前图片应完成加载且可解码，避免导航打断图片请求',
    timeout: scaleTimeout(10000),
  }).toBe(0)
  const detailUrl = page.url()
  if (presentation === 'drawer') {
    const closeButton = drawer.locator('.arco-drawer-close-btn')
    await recordAndRequireCount(closeButton, 1, '详情抽屉应唯一显示关闭按钮')
    await recordAndRequireVisible(closeButton, '详情抽屉关闭按钮应可见')
    await clickWhenReady(closeButton)
    await expect(drawer, '关闭后提报详情抽屉应消失').toBeHidden()
    await flowExpect(drawer, '详情抽屉必须关闭后才能继续列表操作').toBeHidden()
    await expect(page, '关闭详情抽屉应保留原列表地址').toHaveURL(listUrl)
    await flowExpect(page, '关闭详情抽屉后必须仍在原列表').toHaveURL(listUrl)
    await recordAndRequireVisible(row, '关闭详情抽屉后目标提报行应仍然可见')
  }
  return {
    presentation,
    detailUrl,
    detailResponse: detailInspection.body,
    actualPrimaryName,
    actualGroupName,
  }
}

function linkedSearchValue(basicValue) {
  if (basicValue === 'source_text') return 'filter[source]'
  if (basicValue === 'created_at') return 'filter[created_at_between]'
  if (basicValue === 'revision_no') return 'filter[revision_no]'
  if (basicValue.startsWith('dyn_')) return `filter[${basicValue.slice(4)}]`
  return ''
}

async function fieldSettings(page) {
  const settingsButton = page.locator('.form-activity-preview-table-toolbar').getByRole('button', {
    name: /^(?:自定义列表字段|自訂(?:列表|清單)欄位|Custom(?:ize)? (?:List )?Fields)$/i,
  })
  await recordAndRequireCount(settingsButton, 1, '提报表格操作栏应唯一显示字段设置图标')
  await recordAndRequireVisible(settingsButton, '字段设置图标应可见')
  await recordAndRequireEnabled(settingsButton, '字段设置图标应可用')
  await clickWhenReady(settingsButton)

  const modal = page.locator('.arco-modal:visible')
  await recordAndRequireCount(modal, 1, '点击设置图标后应唯一显示字段设置弹窗')
  await recordAndRequireVisible(modal, '字段设置弹窗应可见')
  await expect(modal, '字段设置弹窗标题应兼容简体、繁体和英文')
    .toContainText(/自定义列表字段|自訂(?:列表|清單)欄位|Custom(?:ize)? (?:List )?Fields/i)
  const groupTitles = modal.locator('.field-group-title')
  await expect(groupTitles.filter({ hasText: /^(?:基础字段|基礎欄位|Basic fields)$/i }), '基础字段分区标题应兼容简体、繁体和英文')
    .toHaveText(/^(?:基础字段|基礎欄位|Basic fields)$/i)
  await expect(groupTitles.filter({ hasText: /^(?:检索字段|檢索欄位|Search fields)$/i }), '检索字段分区标题应兼容简体、繁体和英文')
    .toHaveText(/^(?:检索字段|檢索欄位|Search fields)$/i)

  const basicCheckboxes = modal.locator('.basic-setting-list input[type="checkbox"]')
  const searchCheckboxes = modal.locator('.search-setting-list input[type="checkbox"]')
  await flowExpect(basicCheckboxes.first(), '基础字段必须加载后才能开始全选').toBeAttached()
  await flowExpect(searchCheckboxes.first(), '检索字段必须加载后才能开始全选').toBeAttached()
  const basicFieldCount = await basicCheckboxes.count()
  const searchFieldCount = await searchCheckboxes.count()
  expect(basicFieldCount, '字段设置应包含基础字段').toBeGreaterThan(0)
  expect(searchFieldCount, '字段设置应包含检索字段').toBeGreaterThan(0)

  const defaultBasicValues = await basicCheckboxes.evaluateAll(inputs => inputs.filter(input => input.checked).map(input => input.value))
  const defaultSearchValues = await searchCheckboxes.evaluateAll(inputs => inputs.filter(input => input.checked).map(input => input.value))
  expect(defaultBasicValues[0], '默认系统列应优先显示填报时间').toBe('created_at')
  for (const key of ['special_code', 'source_text', 'updated_at', 'revision_no']) {
    expect(defaultBasicValues.includes(key), `默认系统列应隐藏 ${key}`).toBe(false)
  }
  for (const key of ['filter[source]', 'filter[revision_no]']) {
    expect(defaultSearchValues.includes(key), `默认检索项应隐藏 ${key}`).toBe(false)
  }

  const searchDefinitions = []
  const searchValues = new Set()
  for (let index = 0; index < searchFieldCount; index += 1) {
    const checkbox = searchCheckboxes.nth(index)
    const value = String(await checkbox.getAttribute('value') ?? '').trim()
    const label = normalizeWhitespace(await checkbox.locator('xpath=ancestor::label[1]').innerText())
    expect(value, `第 ${index + 1} 个检索字段应提供查询参数键`).toMatch(/^filter\[[^\]]+]$/)
    expect(searchValues.has(value), `检索字段参数键 ${value} 不应重复`).toBe(false)
    searchValues.add(value)
    searchDefinitions.push({ value, label, index })
  }

  let selectedBasicCount = 0
  const basicValues = new Set()
  for (let index = 0; index < basicFieldCount; index += 1) {
    const checkbox = basicCheckboxes.nth(index)
    const value = String(await checkbox.getAttribute('value') ?? '').trim()
    const label = normalizeWhitespace(await checkbox.locator('xpath=ancestor::label[1]').innerText())
    expect(value, `第 ${index + 1} 个基础字段应提供稳定字段键`).not.toBe('')
    expect(basicValues.has(value), `基础字段参数键 ${value} 不应重复`).toBe(false)
    basicValues.add(value)
    await expect(checkbox, `基础字段“${label || value}”应可用`).toBeEnabled()
    if (!await checkbox.isChecked()) {
      // Field toggles stay on this page; checked and linked-field assertions verify the result below.
      await clickWhenReady(checkbox.locator('xpath=ancestor::label[1]'), { timeout: scaleTimeout(5000), noWaitAfter: true })
      selectedBasicCount += 1
    }
    await expect(checkbox, `基础字段“${label || value}”应保持勾选`).toBeChecked()
    const searchValue = linkedSearchValue(value)
    if (searchValue && searchValues.has(searchValue)) {
      const linkedCheckbox = modal.locator(
        `.search-setting-list input[type="checkbox"][value=${JSON.stringify(searchValue)}]`,
      )
      await expect(
        linkedCheckbox,
        `基础字段“${label || value}”应有唯一对应检索字段`,
      ).toHaveCount(1)
      await expect(
        linkedCheckbox,
        `勾选基础字段“${label || value}”后对应检索字段应自动勾选`,
      ).toBeChecked()
    }
  }

  let selectedSearchCount = 0
  for (let index = 0; index < searchFieldCount; index += 1) {
    const checkbox = searchCheckboxes.nth(index)
    const definition = searchDefinitions[index]
    if (!await checkbox.isChecked()) {
      await clickWhenReady(checkbox.locator('xpath=ancestor::label[1]'), { timeout: scaleTimeout(5000), noWaitAfter: true })
      selectedSearchCount += 1
    }
    await expect(
      checkbox,
      `检索字段“${definition.label || definition.value}”应保持勾选且不会因重复点击被取消`,
    ).toBeChecked()
  }
  return {
    modal,
    basicCheckboxes,
    searchCheckboxes,
    searchDefinitions,
    basicFieldCount,
    searchFieldCount,
    selectedBasicCount,
    selectedSearchCount,
  }
}

function isFieldSettingsMutation(request, {
  origin,
  formId,
  apiPathPrefix = '/api',
}) {
  if (!WRITE_METHODS.has(request.method().toUpperCase())) return false
  const url = new URL(request.url())
  if (url.origin !== origin) return false
  const formRoot = buildAdminApiPath(
    apiPathPrefix,
    `/be/form/${encodeURIComponent(formId)}`,
  )
  const allowedSuffix = /\/(?:submission\/)?(?:field-settings|fields-settings|fields\/settings|list-fields|display-fields|visible-fields|columns)$/
  return url.pathname.startsWith(`${formRoot}/`) && allowedSuffix.test(url.pathname.slice(formRoot.length))
}

async function persistFieldSettings(page, state, mutationState) {
  const confirmButton = state.modal.getByRole('button', { name: CONFIRM_PATTERN })
  await recordAndRequireCount(confirmButton, 1, '字段设置弹窗应唯一显示确认按钮')
  await recordAndRequireVisible(confirmButton, '字段设置确认按钮应可见')
  await recordAndRequireEnabled(confirmButton, '字段设置确认按钮应可用')
  try {
    await clickWhenReady(confirmButton)
    await flowExpect(state.modal, '确认字段设置后弹窗应关闭').toBeHidden({ timeout: scaleTimeout(ACTION_TIMEOUT_MS) })
  } finally {
    mutationState.settingsWindowOpen = false
  }
  expect(
    mutationState.settingsMutations.length,
    '字段设置确认最多只能产生一次受控保存请求；仅使用本地缓存时允许为 0 次',
  ).toBeLessThanOrEqual(1)
  for (const response of mutationState.settingsMutationResponses) {
    await readJsonResponse(response, '字段设置保存接口')
  }
}

async function textWithoutButtons(locator) {
  return normalizeWhitespace(await locator.evaluate((element) => {
    const clone = element.cloneNode(true)
    clone.querySelectorAll('button, svg, img').forEach((node) => node.remove())
    return clone.textContent ?? ''
  }))
}

function labelKey(value) {
  return normalizeWhitespace(value).toLocaleLowerCase()
}

async function rowValuesByHeader(page, row) {
  const headerTexts = await page.locator('main table thead th').allTextContents()
  const cells = row.locator('td')
  const cellCount = await cells.count()
  expect(cellCount, '目标提报行单元格数量应与表头数量一致').toBe(headerTexts.length)
  const values = new Map()
  const count = Math.min(cellCount, headerTexts.length)
  for (let index = 0; index < count; index += 1) {
    values.set(labelKey(headerTexts[index]), await textWithoutButtons(cells.nth(index)))
  }
  return values
}

function queryValues(url, key) {
  return [
    ...url.searchParams.getAll(key),
    ...url.searchParams.getAll(`${key}[]`),
  ].filter((value) => value !== '')
}

function assertIsolatedSearch(response, searchKey, label) {
  const url = new URL(response.url())
  const keys = [...new Set([...url.searchParams.entries()]
    .filter(([key, value]) => key.startsWith('filter[') && value !== '')
    .map(([key]) => key.replace(/\[\]$|\[\d+\]$/g, '')))]
  expect(keys, `${label}请求只能携带当前筛选条件，不得残留其它筛选`).toEqual([searchKey])
  expect(url.searchParams.get('page'), `${label}应从第一页展示筛选结果`).toBe('1')
}

function responseHasSearch(response, basePredicate, searchKey, expectedValue, mode) {
  if (!basePredicate(response)) return false
  const url = new URL(response.url())
  const values = queryValues(url, searchKey)
  if (mode === 'source' || mode === 'choice') return values.length > 0
  if (mode === 'date') return values.length >= 1 && values.every((value) => value.includes(expectedValue))
  return values.includes(expectedValue)
}

async function closeFilterDropdowns(filterCard) {
  const page = filterCard.page()
  const dropdowns = page.locator('.arco-select-dropdown:visible')
  if (!await dropdowns.count()) return
  await page.keyboard.press('Escape')
  // Arco multiple selects can remain open after choosing an option. An outside
  // click also works during error recovery, without invoking another query/reset.
  await filterCard.locator('.filter-card-label').first().click({ timeout: scaleTimeout(ACTION_TIMEOUT_MS) })
  await flowExpect(dropdowns, '继续筛选前应关闭所有选择下拉层').toHaveCount(0, { timeout: scaleTimeout(ACTION_TIMEOUT_MS) })
}

async function currentFilterDropdown(page, label) {
  // Arco teleports its popup to body without an aria-controls relationship.
  // Reset/cleanup guarantees none were open before this control was used; require
  // exactly one new popup rather than picking first/last among unrelated popups.
  const dropdown = page.locator('.arco-select-dropdown:visible')
  await flowExpect(dropdown, `${label}应唯一打开当前筛选控件的下拉层`).toHaveCount(1, { timeout: scaleTimeout(ACTION_TIMEOUT_MS) })
  return dropdown
}

async function resetFilterCard(filterCard) {
  await closeFilterDropdowns(filterCard)
  const resetButton = filterCard.getByRole('button', { name: RESET_PATTERN })
  await recordAndRequireCount(resetButton, 1, '每项检索前应有唯一重置按钮')
  await clickWhenReady(resetButton)
  const inputs = filterCard.locator('input:not([type="hidden"]), textarea')
  for (let index = 0; index < await inputs.count(); index += 1) {
    await expect(inputs.nth(index), '重置后每个检索输入框应清空').toHaveValue('')
  }
}

async function chooseSource(page, field, expectedSource) {
  const selectControl = field.locator('.filter-card-control').first()
  await clickWhenReady(selectControl)
  const dropdown = await currentFilterDropdown(page, '来源筛选')
  await recordAndRequireVisible(dropdown, '来源筛选下拉选项应可见')
  const exactOption = dropdown.locator('.arco-select-option').filter({
    hasText: new RegExp(`^\\s*${escapeRegExp(expectedSource)}\\s*$`),
  })
  await recordAndRequireCount(exactOption, 1, `来源筛选应包含目标来源“${expectedSource}”`)
  await clickWhenReady(exactOption)
}

async function fillDateRange(field, date) {
  const inputs = field.locator('input')
  await recordAndRequireCount(inputs, 2, '填报时间筛选应显示开始和结束日期两个输入框')
  await inputs.nth(0).fill(date)
  const page = field.page()
  const panels = page.locator('.arco-panel-date-inner:visible')
  if (await panels.count()) {
    const [year, month, day] = date.split('-')
    const panel = panels.filter({
      has: page.locator('.arco-picker-header-title').filter({
        hasText: new RegExp(`^\\s*${year}\\s*-\\s*${month}\\s*$`),
      }),
    }).first()
    await recordAndRequireVisible(panel, '日期日历应展示目标年月')
    const cell = panel.locator('.arco-picker-cell-in-view').filter({
      hasText: new RegExp(`^${Number(day)}$`),
    })
    await clickWhenReady(cell, { timeout: scaleTimeout(5000) })
    await clickWhenReady(cell, { timeout: scaleTimeout(5000) })
    await expect(inputs.nth(0), '日期范围开始值应为目标日期').toHaveValue(date)
    await expect(inputs.nth(1), '日期范围结束值应为目标日期').toHaveValue(date)
    return
  }
  await inputs.nth(1).fill(date)
  await inputs.nth(1).press('Escape').catch(() => undefined)
}

async function runSubmissionSearchCase(page, {
  apiContext,
  definition,
  filterCard,
  rowValues,
  submissionId,
  primaryContactName,
  logger,
  queryOverride,
  expectMatch = true,
  sampleValue,
  channelTitle,
}) {
  const field = filterCard.locator('.filter-card-field').filter({
    has: page.locator('.filter-card-label').filter({
      hasText: new RegExp(`^\\s*${escapeRegExp(definition.label)}\\s*$`),
    }),
  })
  const fieldCount = await field.count()
  expect(fieldCount, `检索字段“${definition.label}”应在筛选区唯一显示`).toBe(1)
  if (fieldCount !== 1) return false

  await resetFilterCard(filterCard)
  const value = sampleValue ?? rowValues.get(labelKey(definition.label)) ?? ''
  let expectedQueryValue = ''
  let mode = 'text'
  let emptySample = false
  if (definition.value === 'filter[source]') {
    mode = 'source'
    expect(value, '目标提报行应显示非空来源，供来源筛选使用').not.toBe('')
    if (!value) return false
    await chooseSource(page, field, value)
  } else if (definition.value === 'filter[created_at_between]') {
    mode = 'date'
    expectedQueryValue = value.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? ''
    expect(expectedQueryValue, '目标提报行填报时间应包含 YYYY-MM-DD 日期').not.toBe('')
    if (!expectedQueryValue) return false
    await fillDateRange(field, expectedQueryValue)
  } else {
    emptySample = !value || value === '-' || value === '—'
    const choiceControl = field.locator('.arco-select')
    const isChoice = await choiceControl.count() > 0
    const isChannelChoice = isChoice && definition.value === 'filter[channel]'
    const selectedLabel = isChannelChoice ? channelTitle || value
      : isChoice ? value.split(/[,，]/)[0].trim() : value
    expectedQueryValue = emptySample ? `autotest_absent_${submissionId}`
      : definition.value === 'filter[channel]' ? value : createFuzzyProbe(selectedLabel)
    if (queryOverride !== undefined) expectedQueryValue = queryOverride
    if (isChannelChoice && !expectMatch) {
      // A select cannot submit arbitrary codes. Keep these exact-match negative
      // checks as read-only API probes, without claiming the UI was filtered.
      const endpoint = new URL(buildAdminApiPath(apiContext.apiPathPrefix,
        `/be/form/${encodeURIComponent(apiContext.formId)}/submission`), apiContext.origin)
      endpoint.search = new URLSearchParams({ page: '1', per_page: '20', [definition.value]: expectedQueryValue }).toString()
      logger('info', '渠道下拉不接受任意 code，使用只读接口验证反向筛选', { value: expectedQueryValue })
      const responsePromise = suppressUnhandledRejection(page.waitForResponse(response => responseHasSearch(
        response, candidate => isSubmissionListResponse(candidate, apiContext), definition.value, expectedQueryValue, 'text',
      ), { timeout: scaleTimeout(SEARCH_RESPONSE_TIMEOUT_MS) }))
      await page.evaluate(async ({ url, timeout }) => {
        const response = await fetch(url, { headers: { Authorization: localStorage.getItem('token') ?? '' },
          signal: AbortSignal.timeout(timeout) })
        await response.text()
      }, { url: endpoint.toString(), timeout: scaleTimeout(SEARCH_RESPONSE_TIMEOUT_MS) })
      const response = await responsePromise
      assertIsolatedSearch(response, definition.value, '渠道反向筛选接口')
      const inspection = await readJsonResponse(response, '渠道反向筛选接口')
      const located = locateSubmissionRecord(inspection.body, submissionId)
      expect(located.targetIndex, '不匹配的渠道 code 应在接口结果中排除目标提报').toBe(-1)
      return inspection.httpSucceeded && inspection.businessSucceeded && located.targetIndex === -1
    }
    if (emptySample) {
      logger('warning', '目标记录该字段为空：验证非空条件应排除目标记录，无法验证正向模糊命中', {
        field: definition.label,
        key: definition.value,
      })
    }
    const controls = field.locator('input:not([readonly]), textarea')
    const controlCount = await controls.count()
    expect(controlCount, `检索字段“${definition.label}”应提供唯一文本输入控件`).toBe(1)
    if (controlCount !== 1) return false
    const inputValue = isChannelChoice ? selectedLabel : expectedQueryValue
    await controls.fill(inputValue)
    await expect(
      controls,
      `检索字段“${definition.label}”应回显查询值`,
    ).toHaveValue(inputValue)
    if (isChoice) {
      mode = 'choice'
      const dropdown = await currentFilterDropdown(page, `“${definition.label}”`)
      await recordAndRequireVisible(dropdown, `“${definition.label}”应显示模糊搜索匹配选项`)
      const option = dropdown.locator('.arco-select-option').filter({
        hasText: new RegExp(`^\\s*${escapeRegExp(selectedLabel)}\\s*$`),
      })
      await recordAndRequireCount(option, 1, isChannelChoice
        ? `“${definition.label}”应按完整渠道名称匹配唯一选项`
        : `“${definition.label}”中间片段应匹配目标选项`)
      await clickWhenReady(option, { timeout: scaleTimeout(ACTION_TIMEOUT_MS) })
      await clickWhenReady(field.locator('.filter-card-label'))
      await expect(choiceControl, `“${definition.label}”应回显已确认的目标选项`).toContainText(selectedLabel)
    }
  }

  const queryButton = filterCard.getByRole('button', { name: QUERY_PATTERN })
  const responsePromise = suppressUnhandledRejection(page.waitForResponse((response) => responseHasSearch(
    response,
    (candidate) => isSubmissionListResponse(candidate, apiContext),
    definition.value,
    expectedQueryValue,
    mode,
  ), { timeout: scaleTimeout(SEARCH_RESPONSE_TIMEOUT_MS) }))
  await clickWhenReady(queryButton)
  let response
  try {
    response = await responsePromise
  } catch (error) {
    expect(false, `检索字段“${definition.label}”查询应发出正确参数并返回列表接口`).toBe(true)
    logger('warning', '单个提报筛选项未返回匹配接口，继续检查后续筛选项', {
      field: definition.label,
      key: definition.value,
      reason: error instanceof Error ? error.message : String(error),
    })
    return false
  }
  const requestUrl = new URL(response.url())
  assertIsolatedSearch(response, definition.value, `提报筛选“${definition.label}”`)
  const actualValues = queryValues(requestUrl, definition.value)
  expect(actualValues.length, `检索字段“${definition.label}”请求应携带非空查询参数`).toBeGreaterThan(0)
  if (mode === 'choice' && definition.value === 'filter[channel]') {
    expect(actualValues, '渠道选择后请求必须且只能携带目标渠道 code').toEqual([expectedQueryValue])
    if (actualValues.length !== 1 || actualValues[0] !== expectedQueryValue) return false
  } else if (mode === 'text') {
    expect(actualValues, `检索字段“${definition.label}”请求值应与输入值一致`).toContain(expectedQueryValue)
  }
  if (emptySample || !expectMatch) {
    const inspection = await readJsonResponse(response, `提报字段“${definition.label}”反向筛选接口`)
    const located = locateSubmissionRecord(inspection.body, submissionId)
    expect(located.targetIndex, `不匹配的非空搜索“${definition.label}”应排除目标提报`).toBe(-1)
    await expect(dataRows(page).filter({ hasText: primaryContactName }),
      `字段“${definition.label}”反向筛选后不应残留目标姓名`).toHaveCount(0)
    return inspection.httpSucceeded && inspection.businessSucceeded && located.targetIndex === -1
  }
  const inspection = await inspectListResponse(response, {
    submissionId,
    expectedNames: [primaryContactName],
    label: `提报筛选“${definition.label}”接口`,
  })
  const matchingRows = dataRows(page).filter({ hasText: primaryContactName })
  await expect(
    matchingRows,
    `检索字段“${definition.label}”查询结果应显示目标姓名`,
  ).not.toHaveCount(0)
  return inspection.succeeded
}

async function runAllSubmissionSearches(page, {
  apiContext,
  definitions,
  enabledDefinitions = definitions,
  rowValues,
  submissionId,
  primaryContactName,
  logger,
  signal,
  searchSamples,
}) {
  const filterCard = filterCardLocator(page)
  await recordAndRequireCount(filterCard, 1, '提报详情 Tab 应唯一显示筛选区域')
  const visibleFields = filterCard.locator('.filter-card-field')
  await recordAndRequireCount(
    visibleFields,
    definitions.length,
    `保存字段设置后应显示全部 ${definitions.length} 个检索项`,
  )
  const queryButton = filterCard.getByRole('button', { name: QUERY_PATTERN })
  await recordAndRequireVisible(queryButton, '提报筛选查询按钮应可见')
  await recordAndRequireEnabled(queryButton, '提报筛选查询按钮应可用')

  let succeededCount = 0
  for (const [key, expected] of [['filter[channel]', searchSamples?.channel?.code], ['filter[remark]', searchSamples?.remark]]) {
    if (expected === undefined) continue
    const definition = enabledDefinitions.find(item => item.value === key)
    flowExpect(definition, `本次已准备样本 ${key} 必须包含在检索字段中`).toBeTruthy()
    if (key === 'filter[channel]') {
      // 已确认产品缺陷：渠道已保存且可检索，但列表响应缺少渠道值、显示为“-”。
      // 按用户要求暂时注释，后续版本修复后恢复；渠道保存、检索及编辑后回读检查继续执行。
      // expect(rowValues.get(labelKey(definition.label)), `本次已准备样本 ${definition.label} 必须完整显示，不能退化为空值反查`).toBe(expected)
    } else {
      expect(rowValues.get(labelKey(definition.label)), `本次已准备样本 ${definition.label} 必须完整显示，不能退化为空值反查`).toBe(expected)
    }
  }
  for (const definition of enabledDefinitions) {
    throwIfRunAborted(signal)
    try {
      const args = {
        apiContext,
        definition,
        filterCard,
        rowValues,
        submissionId,
        primaryContactName,
        logger,
        channelTitle: searchSamples?.channel?.title,
      }
      const sample = definition.value === 'filter[channel]' ? searchSamples?.channel?.code
        : definition.value === 'filter[remark]' ? searchSamples?.remark : undefined
      let succeeded
      if (sample === undefined) succeeded = await runSubmissionSearchCase(page, args)
      else {
        const outcomes = []
        const exactMatch = definition.value === 'filter[channel]'
        for (const [scenario, queryOverride, expectMatch] of [
          ['完整值命中', sample, true],
          [exactMatch ? '部分 code 排除' : '中间片段命中', createFuzzyProbe(sample), !exactMatch],
          ['无关值排除', `autotest_absent_${submissionId}`, false],
        ]) {
          logger('info', `验证${definition.label}：${scenario}`, { field: definition.value })
          outcomes.push(await runSubmissionSearchCase(page, { ...args, sampleValue: sample, queryOverride, expectMatch }))
        }
        await resetFilterCard(filterCard)
        const restored = suppressUnhandledRejection(page.waitForResponse(response => isSubmissionListResponse(response, apiContext)
          && ![...new URL(response.url()).searchParams.keys()].some(key => key.startsWith('filter[')),
        { timeout: scaleTimeout(SEARCH_RESPONSE_TIMEOUT_MS) }))
        await clickWhenReady(queryButton)
        const inspection = await inspectListResponse(await restored, { submissionId, expectedNames: [primaryContactName], label: `${definition.label}清空筛选恢复列表` })
        await expect(dataRows(page).filter({ hasText: primaryContactName }), `${definition.label}清空筛选后应恢复目标行`).not.toHaveCount(0)
        succeeded = outcomes.every(Boolean) && inspection.succeeded
      }
      if (succeeded) succeededCount += 1
    } catch (error) {
      expect(false, `检索字段“${definition.label}”执行期间不应发生交互异常`).toBe(true)
      logger('warning', '单个提报筛选项交互失败，继续检查后续筛选项', {
        field: definition.label,
        key: definition.value,
        reason: error instanceof Error ? error.message : String(error),
      })
    } finally {
      // Preserve a failed field's evidence, but never let its popup contaminate
      // the next field. If dismissal fails, stop instead of cascading failures.
      if (!signal?.aborted && !page.isClosed()) await closeFilterDropdowns(filterCard)
    }
  }
  await resetFilterCard(filterCard)
  return { attemptedCount: enabledDefinitions.length, succeededCount }
}

async function inspectContactResponse(response, names, label) {
  const inspected = await readJsonResponse(response, label)
  const records = recordCollection(inspected.body)
  expect(records.length, `${label}应返回联系人数据列表`).toBeGreaterThan(0)
  for (const name of names) {
    expect(payloadContainsText(inspected.body, name), `${label}应包含联系人“${name}”`).toBe(true)
  }
  return {
    ...inspected,
    records,
    succeeded: inspected.httpSucceeded
      && inspected.businessSucceeded
      && names.every((name) => payloadContainsText(inspected.body, name)),
  }
}

async function runContactNameSearch(page, {
  apiContext,
  filterCard,
  name,
  logger,
}) {
  await resetFilterCard(filterCard)
  const nameField = filterCard.locator('.filter-card-field').filter({
    has: page.locator('.filter-card-label').filter({ hasText: NAME_LABEL_PATTERN }),
  })
  const input = nameField.locator('input:not([readonly])')
  const probe = createFuzzyProbe(name)
  await input.fill(probe)
  await expect(input, `联系人姓名筛选应回显“${name}”的中间片段`).toHaveValue(probe)
  const responsePromise = suppressUnhandledRejection(page.waitForResponse((response) => responseHasSearch(
    response,
    (candidate) => isContactListResponse(candidate, apiContext),
    'filter[keyword]',
    probe,
    'text',
  ), { timeout: scaleTimeout(SEARCH_RESPONSE_TIMEOUT_MS) }))
  await clickWhenReady(filterCard.getByRole('button', { name: QUERY_PATTERN }))
  try {
    const response = await responsePromise
    assertIsolatedSearch(response, 'filter[keyword]', '联系人姓名筛选')
    const inspected = await inspectContactResponse(response, [name], `联系人“${name}”模糊搜索接口`)
    await expect(
      dataRows(page).filter({ hasText: name }),
      `联系人姓名中间片段搜索结果应显示“${name}”`,
    ).not.toHaveCount(0)
    return inspected.succeeded
  } catch (error) {
    expect(false, `联系人“${name}”中间片段搜索应返回联系人列表接口`).toBe(true)
    logger('warning', '联系人姓名模糊搜索失败，继续检查后续项', {
      name,
      reason: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

async function runContactDateSearch(page, {
  apiContext,
  filterCard,
  names,
  date,
  logger,
}) {
  await resetFilterCard(filterCard)
  const dateField = filterCard.locator('.filter-card-field').filter({
    has: page.locator('.filter-card-label').filter({
      hasText: /^\s*(?:填报时间|填報時間|提交时间|提交時間|Submission Time|Submitted at)\s*$/i,
    }),
  })
  await fillDateRange(dateField, date)
  const responsePromise = suppressUnhandledRejection(page.waitForResponse((response) => responseHasSearch(
    response,
    (candidate) => isContactListResponse(candidate, apiContext),
    'filter[created_at_between]',
    date,
    'date',
  ), { timeout: scaleTimeout(SEARCH_RESPONSE_TIMEOUT_MS) }))
  await clickWhenReady(filterCard.getByRole('button', { name: QUERY_PATTERN }))
  try {
    const response = await responsePromise
    assertIsolatedSearch(response, 'filter[created_at_between]', '联系人日期筛选')
    const inspected = await inspectContactResponse(response, names, '联系人填报时间筛选接口')
    for (const name of names) {
      await expect(
        dataRows(page).filter({ hasText: name }),
        `联系人填报时间筛选结果应包含“${name}”`,
      ).not.toHaveCount(0)
    }
    return inspected.succeeded
  } catch (error) {
    expect(false, '联系人填报时间筛选应返回携带日期范围的联系人列表接口').toBe(true)
    logger('warning', '联系人填报时间筛选失败，已完成其余联系人检查', {
      date,
      reason: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

async function runContactChecks(page, {
  apiContext,
  names,
  logger,
  signal,
}) {
  const contactTab = await resolveTab(page, CONTACT_TAB_PATTERN, '联系人信息 Tab')
  const contactResponsePromise = suppressUnhandledRejection(waitForRequiredResponse(
    page,
    (response) => isContactListResponse(response, apiContext),
    '联系人列表接口',
  ))
  await clickWhenReady(contactTab)
  await expect(contactTab, '点击后联系人信息 Tab 应成为当前 Tab')
    .toHaveClass(/arco-tabs-tab-active/)
  const contactResponse = await contactResponsePromise
  await inspectContactResponse(contactResponse, names, '联系人列表接口')

  const filterCard = filterCardLocator(page)
  await recordAndRequireCount(filterCard, 1, '联系人信息 Tab 应唯一显示筛选区域')
  await recordAndRequireCount(
    filterCard.locator('.filter-card-field'),
    2,
    '联系人信息 Tab 应显示姓名和填报时间两个筛选项',
  )
  for (const name of names) {
    await expect(
      dataRows(page).filter({ hasText: name }),
      `联系人列表应包含本次提报联系人“${name}”`,
    ).not.toHaveCount(0)
  }

  const initialTargetContactRow = dataRows(page).filter({ hasText: names[0] }).first()
  const initialTargetContactText = await initialTargetContactRow.innerText().catch(() => '')
  const contactDate = initialTargetContactText.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? ''
  expect(contactDate, '联系人初始列表目标行应包含 YYYY-MM-DD 日期，供填报时间筛选使用')
    .not.toBe('')

  let attemptedCount = 0
  let succeededCount = 0
  for (const name of names) {
    throwIfRunAborted(signal)
    attemptedCount += 1
    if (await runContactNameSearch(page, { apiContext, filterCard, name, logger })) {
      succeededCount += 1
    }
  }

  if (contactDate) {
    attemptedCount += 1
    if (await runContactDateSearch(page, {
      apiContext,
      filterCard,
      names,
      date: contactDate,
      logger,
    })) {
      succeededCount += 1
    }
  } else {
    logger('info', '联系人初始列表没有可用提交日期，跳过时间筛选；姓名筛选结果及已有失败断言保留')
  }
  const resetResponsePromise = suppressUnhandledRejection(waitForRequiredResponse(page, response => {
    if (!isContactListResponse(response, apiContext)) return false
    return ![...new URL(response.url()).searchParams].some(([key, value]) => key.startsWith('filter[') && value !== '')
  }, '联系人筛选重置后列表接口'))
  await resetFilterCard(filterCard)
  await inspectContactResponse(await resetResponsePromise, names, '联系人筛选重置后列表接口')
  return { attemptedCount, succeededCount }
}

async function screenshotFailure(page, formId, artifactWriter) {
  if (!artifactWriter || typeof artifactWriter.captureScreenshot !== 'function') {
    throw new Error('Runner 必须提供 artifactWriter')
  }
  const safeId = formId.replace(/[^a-zA-Z0-9_-]+/g, '_')
  return artifactWriter.captureScreenshot(
    page,
    `screenshots/${safeId || 'unknown'}-提报列表检查失败-${Date.now()}.png`,
    { fullPage: true },
  )
}

function assertNetworkEvidence(networkEvidence, apiOrigin, apiPathPrefix) {
  const summary = networkEvidence?.summary
  expect(summary, '网络观察器结束时应返回完整汇总').toBeTruthy()
  if (!summary) return
  const isBusinessEntry = entry => {
    if (entry.ignored) return false
    try {
      const url = new URL(entry.url)
      const underApiPrefix = apiPathPrefix === '/'
        ? /^\/(?:be|base)\//.test(url.pathname)
        : url.pathname === apiPathPrefix || url.pathname.startsWith(`${apiPathPrefix}/`)
      return url.origin === apiOrigin && underApiPrefix
    } catch { return false }
  }
  const businessApi = (networkEvidence.api ?? []).filter(isBusinessEntry)
  const siteResources = (networkEvidence.resources ?? []).filter(entry => !entry.ignored && entry.isFirstParty !== false)
  // Third-party telemetry remains in the report as a warning. It is not a
  // backend business API and must not turn successful business checks red.
  expect([...businessApi, ...siteResources].filter(entry => entry.incomplete).length,
    '业务接口和站内资源封账时不应仍有未完成请求').toBe(0)
  expect(summary.discardedPending, '网络观察器不应丢弃未完成请求').toBe(0)
  expect(businessApi.length, '整个流程应记录后台 API 请求').toBeGreaterThan(0)
  expect(businessApi.filter(entry => !entry.ok).length, '所有后台 API 请求均应通过 HTTP 与网络健康检查').toBe(0)
  expect(businessApi.filter(entry => entry.warning).length, '后台 API 响应不应存在读取警告').toBe(0)
  expect(businessApi.filter(entry => entry.incomplete).length, '后台 API 响应不应存在未完成记录').toBe(0)
  expect(siteResources.length, '整个流程应记录页面静态资源').toBeGreaterThan(0)
  expect(siteResources.filter(entry => !entry.ok).length, '所有页面静态资源均应加载成功').toBe(0)
  expect(siteResources.filter(entry => entry.warning).length, '页面静态资源不应存在加载警告').toBe(0)
  expect(siteResources.filter(entry => entry.incomplete).length, '页面静态资源不应存在未完成记录').toBe(0)

  let firstPartyBusinessResponseCount = 0
  for (const entry of networkEvidence.api ?? []) {
    let url
    try {
      url = new URL(entry.url)
    } catch {
      continue
    }
    const underApiPrefix = apiPathPrefix === '/'
      ? /^\/(?:be|base)\//.test(url.pathname)
      : url.pathname === apiPathPrefix || url.pathname.startsWith(`${apiPathPrefix}/`)
    if (url.origin !== apiOrigin || !underApiPrefix) continue
    firstPartyBusinessResponseCount += 1
    const body = entry.responseBody
    if (!body || typeof body !== 'object' || Array.isArray(body)) continue
    if (Object.prototype.hasOwnProperty.call(body, 'code')) {
      expect(
        Number(body.code),
        `[${entry.phase}] ${entry.method} ${url.pathname} 业务码应为 0`,
      ).toBe(0)
    }
    if (Object.prototype.hasOwnProperty.call(body, 'success')) {
      expect(
        body.success,
        `[${entry.phase}] ${entry.method} ${url.pathname} success 应为 true`,
      ).toBe(true)
    }
  }
  expect(
    firstPartyBusinessResponseCount,
    '网络证据中应包含同源后台业务 API 响应',
  ).toBeGreaterThan(0)
}

export async function run({
  scriptId = SCRIPT_ID,
  siteBaseUrl,
  apiBaseUrl,
  requestPath = DEFAULT_REQUEST_PATH,
  variables = {},
  extraHTTPHeaders,
  ignoreHTTPSErrors = false,
  artifactWriter,
  signal,
  logger = () => undefined,
  recordApiResponse,
  recordResourceResponse,
  captureFailureScreenshot = true,
}) {
  if (!siteBaseUrl) throw new Error('运行环境必须提供 Web 基址')
  if (!apiBaseUrl) throw new Error('运行环境必须提供 API 基址')
  const authorization = extraHTTPHeaders?.Authorization
  if (!authorization) throw new Error('检查提报列表必须使用环境登录后的 Token')

  const listUrl = buildListUrl(siteBaseUrl, requestPath)
  const siteOrigin = new URL(siteBaseUrl).origin
  const apiUrl = new URL(apiBaseUrl)
  if (apiUrl.origin !== siteOrigin) throw new Error('Web 基址与 API 基址必须同源')
  const apiPathPrefix = apiUrl.pathname.replace(/\/+$/, '') || '/'
  const { formId, submissionId } = resolveListContext(listUrl, variables)
  const assertions = parseSubmissionAssertions(variables.SUBMISSION_ASSERTIONS)
  const apiContext = {
    origin: apiUrl.origin,
    apiPathPrefix,
    formId,
  }

  let browser
  let context
  let page
  let stopAbortClose = () => undefined
  let networkObserver = {
    setPhase: () => undefined,
    stop: async () => undefined,
  }
  const mutationState = {
    settingsWindowOpen: false,
    settingsMutations: [],
    settingsMutationResponses: [],
    unexpectedMutations: [],
  }
  try {
    throwIfRunAborted(signal)
    logger('info', '启动 Google Chrome 无头浏览器，检查指定表单的提报与联系人列表', {
      browser: 'Google Chrome',
      headless: true,
      formId,
      submissionId,
      listUrl,
    })
    browser = await launchGoogleChrome()
    stopAbortClose = closePlaywrightOnAbort(signal, () => ({ browser, context }), { logger })
    throwIfRunAborted(signal)
    context = await browser.newContext({
      ignoreHTTPSErrors,
      viewport: { width: 1600, height: 1000 },
      locale: resolveAdminLocale(variables),
    })
    await context.addInitScript(({ token, adminLocale }) => {
      localStorage.setItem('token', token)
      localStorage.setItem('arco-locale', adminLocale)
    }, { token: authorization, adminLocale: resolveAdminLocale(variables) })
    networkObserver = attachNetworkObserver(context, {
      initialPhase: '浏览器初始化',
      onApiResponse: recordApiResponse,
      onResourceResponse: recordResourceResponse,
    })
    await networkObserver.ready
    page = await context.newPage()
    observeUiReadiness(page)
    page.setDefaultTimeout(scaleTimeout(ACTION_TIMEOUT_MS))
    page.setDefaultNavigationTimeout(scaleTimeout(NAVIGATION_TIMEOUT_MS))

    let businessRequestCount = 0
    let authenticatedRequestCount = 0
    const tokenViolations = []
    const endpointCounts = {
      submission: 0,
      contact: 0,
      tabCounts: 0,
      detail: 0,
    }
    page.on('request', (request) => {
      if (isApiBusinessRequest(request, apiUrl.origin, apiPathPrefix)) {
        businessRequestCount += 1
        if (request.headers().authorization === authorization) {
          authenticatedRequestCount += 1
        } else {
          const url = new URL(request.url())
          tokenViolations.push(`${request.method()} ${url.origin}${url.pathname}`)
        }
      }
      if (!WRITE_METHODS.has(request.method().toUpperCase())
        || new URL(request.url()).origin !== apiUrl.origin) return
      if (mutationState.settingsWindowOpen && isFieldSettingsMutation(request, apiContext)) {
        mutationState.settingsMutations.push(request)
      } else {
        mutationState.unexpectedMutations.push(`${request.method()} ${request.url()}`)
      }
    })
    page.on('response', (response) => {
      if (isSubmissionListResponse(response, apiContext)) endpointCounts.submission += 1
      if (isContactListResponse(response, apiContext)) endpointCounts.contact += 1
      if (isTabCountsResponse(response, apiContext)) endpointCounts.tabCounts += 1
      if (isSubmissionDetailResponse(response, { ...apiContext, submissionId })) endpointCounts.detail += 1
      if (mutationState.settingsWindowOpen && isFieldSettingsMutation(response.request(), apiContext)) {
        mutationState.settingsMutationResponses.push(response)
      }
    })

    networkObserver.setPhase('提报列表加载')
    const initialListPromise = suppressUnhandledRejection(waitForRequiredResponse(
      page,
      (response) => isSubmissionListResponse(response, apiContext),
      '初始提报列表接口',
    ))
    const initialCountsPromise = suppressUnhandledRejection(waitForRequiredResponse(
      page,
      (response) => isTabCountsResponse(response, apiContext),
      '初始 Tab 计数接口',
    ))
    await page.goto(listUrl, { waitUntil: 'domcontentloaded' })
    await flowExpect(page, 'Token 生效后不应跳转登录页').not.toHaveURL(/\/login(?:[/?#]|$)/)
    await flowExpect(page, '提报列表应停留在精确 FORM_ID 地址').toHaveURL(listUrl)
    const [initialListResponse, initialCountsResponse] = await Promise.all([
      initialListPromise,
      initialCountsPromise,
    ])
    expect(new URL(initialListResponse.url()).searchParams.get('per_page'), '填报列表默认应每页显示 20 条').toBe('20')
    const initialInspection = await inspectListResponse(initialListResponse, {
      submissionId,
      expectedNames: [assertions.primaryContactName],
      label: '初始提报列表接口',
    })
    await readJsonResponse(initialCountsResponse, 'Tab 计数接口')
    if (initialInspection.targetIndex < 0) {
      throw new Error(`列表中无法定位目标提报，停止后续点击：${submissionId}`)
    }

    const topInformation = await assertTopInformation(page, assertions)
    const detailsTab = await resolveTab(page, DETAILS_TAB_PATTERN, '提报详情 Tab')
    await expect(detailsTab, '页面初始应激活提报详情 Tab').toHaveClass(/arco-tabs-tab-active/)
    const initialTargetRow = await targetRowFromIndex(page, initialInspection.targetIndex)
    const initialTargetRowText = normalizeWhitespace(await initialTargetRow.innerText())

    networkObserver.setPhase('目标提报详情验证')
    const detail = await openAndInspectDetail(page, {
      row: initialTargetRow,
      siteOrigin,
      apiContext,
      formId,
      submissionId,
      assertions,
    })
    const primaryContactName = assertions.primaryContactName || detail.actualPrimaryName
    const groupContactName = assertions.groupContactName || detail.actualGroupName
    expect(initialTargetRowText, '接口序号映射的目标提报行应包含题组外姓名')
      .toContain(primaryContactName)
    expect(
      payloadContainsText(initialInspection.targetRecord, primaryContactName),
      '目标提报列表接口记录应包含题组外姓名',
    ).toBe(true)

    throwIfRunAborted(signal)
    networkObserver.setPhase('返回提报列表')
    let returnedInspection = initialInspection
    if (detail.presentation === 'page') {
      const returnedListPromise = suppressUnhandledRejection(waitForRequiredResponse(
        page,
        (response) => isSubmissionListResponse(response, apiContext),
        '返回后的提报列表接口',
      ))
      const returnedCountsPromise = suppressUnhandledRejection(waitForRequiredResponse(
        page,
        (response) => isTabCountsResponse(response, apiContext),
        '返回后的 Tab 计数接口',
      ))
      await page.goto(listUrl, { waitUntil: 'domcontentloaded' })
      const [returnedListResponse, returnedCountsResponse] = await Promise.all([
        returnedListPromise,
        returnedCountsPromise,
      ])
      returnedInspection = await inspectListResponse(returnedListResponse, {
        submissionId,
        expectedNames: [primaryContactName],
        label: '返回后的提报列表接口',
      })
      await readJsonResponse(returnedCountsResponse, '返回后的 Tab 计数接口')
    }
    const returnedTargetRow = await targetRowFromIndex(page, returnedInspection.targetIndex)
    await expect(returnedTargetRow, '返回列表后目标行应包含题组外姓名').toContainText(primaryContactName)

    networkObserver.setPhase('全选列表与检索字段')
    const settings = await fieldSettings(page)
    await persistFieldSettings(page, settings, mutationState)
    logger('info', '字段设置完成：仅点击未选项，并验证基础字段对检索字段的自动联动', {
      basicFieldCount: settings.basicFieldCount,
      searchFieldCount: settings.searchFieldCount,
      selectedBasicCount: settings.selectedBasicCount,
      selectedSearchCount: settings.selectedSearchCount,
      settingsMutationCount: mutationState.settingsMutations.length,
    })

    const targetRowAfterSettings = await targetRowFromIndex(page, returnedInspection.targetIndex)
    await recordAndRequireVisible(targetRowAfterSettings, '保存字段设置后目标提报行应仍然可见')
    const rowValues = await rowValuesByHeader(page, targetRowAfterSettings)

    networkObserver.setPhase('逐项验证提报检索')
    const enabledSearchDefinitions = settings.searchDefinitions
    const submissionSearches = await runAllSubmissionSearches(page, {
      apiContext,
      definitions: settings.searchDefinitions,
      enabledDefinitions: enabledSearchDefinitions,
      rowValues,
      submissionId,
      primaryContactName,
      logger,
      signal,
      searchSamples: assertions.searchSamples,
    })
    expect(
      submissionSearches.attemptedCount,
      '提报详情应逐项执行所有启用的检索字段，不能并发或自动重试',
    ).toBe(enabledSearchDefinitions.length)

    networkObserver.setPhase('联系人列表与检索验证')
    const contactSearches = await runContactChecks(page, {
      apiContext,
      names: [primaryContactName, groupContactName],
      logger,
      signal,
    })
    await assertTopInformation(page, {
      ...assertions,
      title: assertions.title || topInformation.actualTitle,
    })

    networkObserver.setPhase('网络健康封账')
    const networkEvidence = await networkObserver.stop({ signal })
    assertNetworkEvidence(networkEvidence, apiUrl.origin, apiPathPrefix)

    networkObserver.setPhase('运行结果汇总')
    expect(tokenViolations, '所有后台 API 业务请求都必须携带环境 Token').toEqual([])
    expect(authenticatedRequestCount, '至少应观察到一个携带 Token 的后台 API 请求').toBeGreaterThan(0)
    expect(authenticatedRequestCount, '携带 Token 的请求数应等于后台 API 业务请求总数')
      .toBe(businessRequestCount)
    expect(mutationState.unexpectedMutations, '除受控字段设置保存外不应出现任何写请求')
      .toEqual([])
    expect(endpointCounts.submission, '应加载提报列表接口并逐项执行筛选').toBeGreaterThanOrEqual(2)
    expect(endpointCounts.contact, '应加载联系人列表接口并执行姓名与时间筛选').toBeGreaterThanOrEqual(1)
    expect(endpointCounts.tabCounts, '应加载提报与联系人 Tab 计数接口').toBeGreaterThanOrEqual(1)
    expect(endpointCounts.detail, '应精确加载一次目标提报详情接口').toBeGreaterThanOrEqual(1)
    logger('success', '提报列表、详情、全部检索项、联系人和网络鉴权检查执行完成', {
      formId,
      submissionId,
      primaryContactName,
      groupContactName,
      submissionSearches,
      contactSearches,
      endpointCounts,
      unexpectedMutationCount: mutationState.unexpectedMutations.length,
      token: '[REDACTED]',
    })

    return {
      formId,
      submissionId,
      listUrl,
      detailUrl: detail.detailUrl,
      detailPresentation: detail.presentation,
      title: topInformation.actualTitle,
      primaryContactName,
      groupContactName,
      actualContactNames: {
        primaryContactName: detail.actualPrimaryName,
        groupContactName: detail.actualGroupName,
      },
      expectedContactNames: {
        primaryContactName,
        groupContactName,
      },
      basicFieldCount: settings.basicFieldCount,
      searchFieldCount: settings.searchFieldCount,
      submissionSearchCount: submissionSearches.attemptedCount,
      successfulSubmissionSearchCount: submissionSearches.succeededCount,
      contactSearchCount: contactSearches.attemptedCount,
      successfulContactSearchCount: contactSearches.succeededCount,
      businessRequestCount,
      authenticatedRequestCount,
      settingsMutationCount: mutationState.settingsMutations.length,
      unexpectedMutationCount: mutationState.unexpectedMutations.length,
      endpointCounts,
      networkSummary: networkEvidence.summary,
      configuredAssertionCount: assertions.configuredAssertionCount,
      status: 'checked',
    }
  } catch (error) {
    if (signal?.aborted) {
      logger('info', '已响应强制停止，正在清理 Google Chrome 无头浏览器')
    } else if (captureFailureScreenshot && page) {
      try {
        const screenshot = await screenshotFailure(page, formId, artifactWriter)
        logger('error', '提报列表检查失败，已保存当前页面全页截图', {
          screenshotPath: screenshot.absolutePath,
          artifact: screenshot,
        })
      } catch (screenshotError) {
        logger('error', '提报列表检查失败，当前页面截图保存失败', {
          reason: screenshotError instanceof Error ? screenshotError.message : String(screenshotError),
        })
      }
    }
    throw error
  } finally {
    networkObserver.setPhase('结束清理')
    await networkObserver.stop({ signal })
    const abortCloseStarted = await stopAbortClose()
    if (!abortCloseStarted) await closePlaywrightHandles({ context, browser }, { logger })
  }
}

export {
  DEFAULT_REQUEST_PATH,
  buildListUrl,
  createFuzzyProbe,
  inspectListResponse,
  isContactListResponse,
  isSubmissionListResponse,
  normalizeRequestPath,
  parseSubmissionAssertions,
  resolveListContext,
  resolveTab,
  assertTopInformation,
  detailNameValues,
  assertNetworkEvidence,
}
