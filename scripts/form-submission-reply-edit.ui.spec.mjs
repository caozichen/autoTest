import { scaleTimeout } from './support/environment-timeouts.mjs'
import { expect as flowExpect } from './support/environment-timeouts.mjs'
import { clickWhenReady, observeUiReadiness, waitForUiReady } from './support/ui-readiness.mjs'

import { attachNetworkObserver } from './support/api-response-recorder.mjs'
import { launchGoogleChrome } from './support/google-chrome.mjs'
import { expect } from './support/recorded-expect.mjs'
import {
  closePlaywrightHandles,
  closePlaywrightOnAbort,
  throwIfRunAborted,
} from './playwright-run-control.mjs'

const NAVIGATION_TIMEOUT_MS = 45_000
const ACTION_TIMEOUT_MS = 30_000
const DEFAULT_REQUEST_PATH = '/form-activity/submission/preview/reply/lpXAWZ?fid=lg2bkk'

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeRequestPath(value = DEFAULT_REQUEST_PATH) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('提报详情 URL 路径不能为空')
  const requestPath = value.trim()
  if (/^[a-z][a-z\d+.-]*:/i.test(requestPath) || requestPath.startsWith('//')) {
    throw new Error('提报详情 URL 路径必须是相对路径')
  }
  if (/\s/.test(requestPath)) throw new Error('提报详情 URL 路径不能包含空格或换行')
  if (requestPath.includes('\\')) throw new Error('提报详情 URL 路径不能包含反斜杠')
  return requestPath.startsWith('/') ? requestPath : `/${requestPath}`
}

function buildDetailUrl(siteBaseUrl, requestPath = DEFAULT_REQUEST_PATH) {
  const siteOrigin = new URL(siteBaseUrl).origin
  const detailUrl = new URL(normalizeRequestPath(requestPath).replace(/^\/+/, ''), `${siteOrigin}/`)
  if (detailUrl.origin !== siteOrigin) throw new Error('提报详情地址必须与所选环境同源')
  return detailUrl.toString()
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

function normalizeString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 必须是非空字符串`)
  return value.trim()
}

function normalizeFieldReference(value, label) {
  const reference = normalizeString(value, label)
  const occurrenceMatch = reference.match(/^(.*)\[(\d+)]$/)
  if (!occurrenceMatch) return reference
  const fieldLabel = normalizeString(occurrenceMatch[1], label + ' 字段名')
  const occurrence = Number(occurrenceMatch[2])
  if (!Number.isSafeInteger(occurrence) || occurrence < 1) {
    throw new Error(label + ' 的重复字段序号必须是从 1 开始的整数')
  }
  return fieldLabel + '[' + occurrence + ']'
}

function parseFieldReference(reference) {
  const occurrenceMatch = reference.match(/^(.*)\[(\d+)]$/)
  return occurrenceMatch
    ? { label: occurrenceMatch[1], occurrence: Number(occurrenceMatch[2]) }
    : { label: reference, occurrence: null }
}

function normalizeStringList(value, label) {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${label} 必须是字符串数组`)
  return value.map((item, index) => normalizeString(item, `${label}[${index}]`))
}

function normalizeFieldAssertions(value) {
  if (value === undefined) return []
  if (Array.isArray(value)) {
    return value.map((label, index) => ({
      label: normalizeFieldReference(label, `SUBMISSION_ASSERTIONS.fields[${index}]`),
    }))
  }
  if (!value || typeof value !== 'object') {
    throw new Error('SUBMISSION_ASSERTIONS.fields 必须是字符串数组或字段值对象')
  }
  return Object.entries(value).map(([label, expectedValue]) => {
    const normalizedLabel = normalizeFieldReference(label, 'SUBMISSION_ASSERTIONS.fields 字段名')
    if (!['string', 'number', 'boolean'].includes(typeof expectedValue)) {
      throw new Error(`SUBMISSION_ASSERTIONS.fields.${normalizedLabel} 必须是字符串、数字或布尔值`)
    }
    return { label: normalizedLabel, expectedText: String(expectedValue) }
  })
}

function normalizeEditFieldAssertions(value) {
  if (value === undefined) return []
  if (Array.isArray(value)) {
    return value.map((label, index) => ({
      label: normalizeFieldReference(label, `SUBMISSION_ASSERTIONS.editFields[${index}]`),
    }))
  }
  if (!value || typeof value !== 'object') {
    throw new Error('SUBMISSION_ASSERTIONS.editFields 必须是字符串数组或字段值对象')
  }
  return Object.entries(value).map(([label, expectedValue]) => {
    const normalizedLabel = normalizeFieldReference(label, 'SUBMISSION_ASSERTIONS.editFields 字段名')
    if (!['string', 'number', 'boolean'].includes(typeof expectedValue)) {
      throw new Error(`SUBMISSION_ASSERTIONS.editFields.${normalizedLabel} 必须是字符串、数字或布尔值`)
    }
    return { label: normalizedLabel, expectedValue: String(expectedValue) }
  })
}

function parseSubmissionAssertions(value) {
  const parsed = parseJsonObject(value, 'SUBMISSION_ASSERTIONS')
  const title = parsed.title === undefined
    ? ''
    : normalizeString(parsed.title, 'SUBMISSION_ASSERTIONS.title')
  const status = parsed.status === undefined
    ? ''
    : normalizeString(parsed.status, 'SUBMISSION_ASSERTIONS.status')
  const texts = normalizeStringList(parsed.texts, 'SUBMISSION_ASSERTIONS.texts')
  const fields = normalizeFieldAssertions(parsed.fields)
  const editFields = normalizeEditFieldAssertions(parsed.editFields)
  const unknownKeys = Object.keys(parsed).filter((key) => (
    !['title', 'status', 'texts', 'fields', 'editFields', 'primaryContactName', 'groupContactName'].includes(key)
  ))
  if (unknownKeys.length > 0) {
    throw new Error(`SUBMISSION_ASSERTIONS 包含不支持的配置项：${unknownKeys.join(', ')}`)
  }
  return {
    title,
    status,
    texts,
    fields,
    editFields,
    configuredAssertionCount: Number(Boolean(title))
      + Number(Boolean(status))
      + texts.length
      + fields.length
      + editFields.length,
  }
}

function parseSubmissionEditValues(value) {
  const parsed = parseJsonObject(value, 'SUBMISSION_EDIT_VALUES')
  const entries = Object.entries(parsed).map(([field, fieldValue]) => {
    const normalizedField = normalizeFieldReference(field, 'SUBMISSION_EDIT_VALUES 字段名')
    if (!['string', 'number', 'boolean'].includes(typeof fieldValue)) {
      throw new Error(`SUBMISSION_EDIT_VALUES.${normalizedField} 必须是字符串、数字或布尔值`)
    }
    return [normalizedField, String(fieldValue)]
  })
  const normalizedFields = entries.map(([field]) => field)
  if (new Set(normalizedFields).size !== normalizedFields.length) {
    throw new Error('SUBMISSION_EDIT_VALUES 包含重复的字段定位')
  }
  return Object.fromEntries(entries)
}

function resolveSubmissionContext(detailUrl, variables = {}) {
  const url = new URL(detailUrl)
  const pathMatch = url.pathname.match(/^\/form-activity\/submission\/preview\/reply\/([a-zA-Z0-9_-]+)$/)
  const pathSubmissionId = pathMatch?.[1] ?? ''
  if (!pathSubmissionId || pathSubmissionId === 'create') {
    throw new Error('提报编辑 URL 必须指向已有提报详情，不能使用公开填写页或创建页')
  }
  const queryFormId = String(url.searchParams.get('fid') || '').trim()
  if (!/^[a-zA-Z0-9_-]+$/.test(queryFormId)) {
    throw new Error('提报详情 URL 必须包含已解析的非空 fid')
  }
  const variableSubmissionId = String(variables.SUBMISSION_ID || '').trim()
  const variableFormId = String(variables.FORM_ID || '').trim()
  if (variableSubmissionId && pathSubmissionId && variableSubmissionId !== pathSubmissionId) {
    throw new Error('SUBMISSION_ID 与提报详情 URL 路径不一致')
  }
  if (variableFormId && queryFormId && variableFormId !== queryFormId) {
    throw new Error('FORM_ID 与提报详情 URL 的 fid 参数不一致')
  }
  const submissionId = pathSubmissionId || variableSubmissionId
  const formId = queryFormId || variableFormId
  if (!submissionId) throw new Error('无法从 SUBMISSION_ID 或提报详情路径解析 submissionId')
  if (!formId) throw new Error('无法从 FORM_ID 或提报详情地址 fid 参数解析 formId')
  return { submissionId, formId }
}

function fieldHeading(page, reference) {
  const { label, occurrence } = parseFieldReference(reference)
  const pattern = new RegExp(`^\\s*${escapeRegExp(label)}\\s*$`)
  const headings = page.locator('.fb-runtime-field-heading').filter({ hasText: pattern })
  return occurrence === null ? headings : headings.nth(occurrence - 1)
}

function detailFieldRow(page, reference) {
  const { label, occurrence } = parseFieldReference(reference)
  const labelPattern = new RegExp(`^\\s*${escapeRegExp(label)}\\s*$`)
  const rows = page.locator('.reply-kv__row').filter({
    has: page.locator('.reply-kv__label').filter({ hasText: labelPattern }),
  })
  return occurrence === null ? rows : rows.nth(occurrence - 1)
}

async function detailFieldValue(row) {
  const value = row.locator('.reply-kv__value')
  return await value.count() === 1 ? value : row
}

function fieldContainerFromHeading(heading) {
  return heading.locator(
    'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " fb-p-4 ")'
      + ' and contains(concat(" ", normalize-space(@class), " "), " fb-px-6 ")][1]',
  )
}

function simpleTextControls(root) {
  return root.locator([
    'input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([disabled]):visible',
    'textarea:not([disabled]):visible',
    '[contenteditable="true"]:visible',
  ].join(', '))
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

function actionableButton(page, namePattern) {
  return page
    .locator('button:visible:not([disabled]):not([aria-disabled="true"])')
    .filter({ hasText: namePattern })
}

async function assertInitialDetailStructure(page, {
  submissionId,
  assertions,
  verifyConfiguredAssertions = true,
  requireEditButton = true,
}) {
  const title = page.getByRole('heading', { level: 2 }).first()
  await expect(title, '提报详情初始态应显示 h2 标题').toBeVisible()
  expect(new URL(page.url()).pathname, '详情地址必须属于当前提报 ID')
    .toBe(`/form-activity/submission/preview/reply/${encodeURIComponent(submissionId)}`)
  await expect(
    page.getByText(/^\s*(?:已提交|已提交成功)\s*$/).first(),
    '提报详情初始态应显示“已提交”状态',
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { level: 3, name: /^(?:提報資訊|填报信息|提报信息)$/ }).first(),
    '提报详情初始态应显示“提报信息”分区',
  ).toBeVisible()
  const editButton = page.getByRole('button', { name: /^(?:编辑|編輯)$/ })
  if (requireEditButton) {
    await recordAndRequireCount(editButton, 1, '提报详情初始态应唯一显示“编辑”按钮')
    await recordAndRequireVisible(editButton, '提报详情初始态的“编辑”按钮应可见')
    await recordAndRequireEnabled(editButton, '提报详情初始态的“编辑”按钮应可用')
  } else {
    await expect(editButton, '提报详情应唯一显示“编辑”按钮').toHaveCount(1)
    await expect(editButton, '提报详情的“编辑”按钮应可见').toBeVisible()
    await expect(editButton, '提报详情的“编辑”按钮应可用').toBeEnabled()
  }
  await expect(
    actionableButton(page, /^(?:\s*)(?:取消编辑|取消編輯)(?:\s*)$/),
    '提报详情初始态不应存在可操作的“取消编辑”按钮',
  ).toHaveCount(0)
  await expect(
    actionableButton(page, /^\s*提交\s*$/),
    '提报详情初始态不应存在可操作的“提交”按钮',
  ).toHaveCount(0)

  if (verifyConfiguredAssertions && assertions.title) {
    await expect(title, '提报详情标题应匹配 SUBMISSION_ASSERTIONS.title')
      .toContainText(assertions.title)
  }
  if (verifyConfiguredAssertions && assertions.status) {
    await expect(
      page.getByText(assertions.status, { exact: true }).first(),
      '提报详情状态应匹配 SUBMISSION_ASSERTIONS.status',
    ).toBeVisible()
  }
  for (const text of verifyConfiguredAssertions ? assertions.texts : []) {
    await expect(
      page.getByText(text, { exact: true }).first(),
      `提报详情应显示配置文本“${text}”`,
    ).toBeVisible()
  }
  for (const field of verifyConfiguredAssertions ? assertions.fields : []) {
    const replyRows = detailFieldRow(page, field.label)
    const useReplyRow = await replyRows.count() > 0
    const fieldTarget = useReplyRow ? replyRows : fieldHeading(page, field.label)
    await expect(fieldTarget, `提报详情应唯一显示字段“${field.label}”`).toHaveCount(1)
    if (await fieldTarget.count() !== 1) continue
    await expect(fieldTarget, `提报详情字段“${field.label}”应可见`).toBeVisible()
    if (field.expectedText !== undefined) {
      const fieldContainer = useReplyRow
        ? await detailFieldValue(replyRows)
        : fieldContainerFromHeading(fieldTarget)
      await expect(fieldContainer, `提报详情字段“${field.label}”容器应可见`).toBeVisible()
      await expect(
        fieldContainer,
        `提报详情字段“${field.label}”应显示配置值`,
      ).toContainText(field.expectedText)
    }
  }
  return editButton
}

async function resolveEditableControl(page, field, { required = true } = {}) {
  const { label, occurrence } = parseFieldReference(field)
  const keyedRoot = page.locator(`[data-item-key=${JSON.stringify(field)}]`)
  if (await keyedRoot.count() === 1) {
    const controls = simpleTextControls(keyedRoot)
    if (await controls.count() > 0) return controls.first()
  }

  const heading = fieldHeading(page, field)
  if (await heading.count() === 1) {
    const container = fieldContainerFromHeading(heading)
    const controls = simpleTextControls(container)
    if (await controls.count() > 0) return controls.first()
  }

  const labelledMatches = page.getByLabel(label, { exact: true })
  const labelled = occurrence === null ? labelledMatches : labelledMatches.nth(occurrence - 1)
  if (await labelled.count() === 1 && await labelled.isVisible()) return labelled

  const named = page.locator(`[name=${JSON.stringify(field)}]:visible`)
  if (await named.count() === 1) return named

  const placeholderMatches = page.getByPlaceholder(new RegExp(
    `^(?:(?:请|請)输入)?${escapeRegExp(label)}$`,
  ))
  const placeholder = occurrence === null
    ? placeholderMatches
    : placeholderMatches.nth(occurrence - 1)
  if (await placeholder.count() === 1 && await placeholder.isVisible()) {
    return placeholder
  }
  if (!required) return null
  throw new Error(`编辑态未找到字段“${field}”对应的唯一简单文本控件`)
}

async function assertEditStructure(page, editFields) {
  const cancelButton = page.getByRole('button', { name: /^(?:取消编辑|取消編輯)$/ })
  const submitButton = page.getByRole('button', { name: /^提交$/ })
  await expect(cancelButton, '编辑态应唯一显示“取消编辑”按钮').toHaveCount(1)
  await expect(cancelButton, '编辑态“取消编辑”按钮应可见').toBeVisible()
  await recordAndRequireCount(submitButton, 1, '编辑态应唯一显示“提交”按钮')
  await recordAndRequireVisible(submitButton, '编辑态“提交”按钮应可见')
  await recordAndRequireEnabled(submitButton, '编辑态“提交”按钮应可用')

  const editHeadings = page.locator('.fb-runtime-field-heading')
  await expect(editHeadings, '编辑态应至少显示一个字段标题').not.toHaveCount(0)
  await flowExpect(editHeadings, '提交前必须等待编辑题目挂载完成').not.toHaveCount(0)
  const editableControls = simpleTextControls(page.locator('.fb-p-4.fb-px-6'))
  await expect(editableControls, '编辑态应至少显示一个可编辑的简单文本控件').not.toHaveCount(0)
  await flowExpect(editableControls, '提交前必须等待原答案控件加载完成').not.toHaveCount(0)
  await waitForUiReady(page, { timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS) })
  for (const field of editFields) {
    const control = await resolveEditableControl(page, field.label, { required: false })
    await expect(control, `编辑态字段“${field.label}”应显示唯一可编辑控件`).toBeTruthy()
    if (!control) continue
    await expect(control, `编辑态字段“${field.label}”应显示可编辑控件`).toBeVisible()
    await expect(control, `编辑态字段“${field.label}”控件应可用`).toBeEnabled()
    if (field.expectedValue !== undefined) {
      const tagName = await control.evaluate((element) => element.tagName.toLowerCase())
      if (tagName === 'input' || tagName === 'textarea') {
        await expect(control, `编辑态字段“${field.label}”初始值应匹配配置`).toHaveValue(field.expectedValue)
      } else {
        await expect(control, `编辑态字段“${field.label}”初始文本应匹配配置`).toHaveText(field.expectedValue)
      }
    }
  }
  return { cancelButton, submitButton }
}

async function applyEditValues(page, editValues) {
  const appliedEditFields = []
  for (const [field, value] of Object.entries(editValues)) {
    const control = await resolveEditableControl(page, field)
    await recordAndRequireVisible(control, `待修改字段“${field}”应显示简单文本控件`)
    await recordAndRequireEnabled(control, `待修改字段“${field}”控件应可用`)
    await control.fill(value)
    const tagName = await control.evaluate((element) => element.tagName.toLowerCase())
    if (tagName === 'input' || tagName === 'textarea') {
      await expect(control, `字段“${field}”应回显修改值`).toHaveValue(value)
    } else {
      await expect(control, `字段“${field}”应回显修改值`).toHaveText(value)
    }
    appliedEditFields.push(field)
  }
  return appliedEditFields
}

async function assertAppliedDetailValues(page, editValues) {
  for (const [field, value] of Object.entries(editValues)) {
    const row = detailFieldRow(page, field)
    await expect(row, `提交成功后详情态应唯一显示字段“${field}”`).toHaveCount(1)
    if (await row.count() !== 1) continue
    await expect(row, `提交成功后详情态字段“${field}”应可见`).toBeVisible()
    await expect(
      await detailFieldValue(row),
      `提交成功后详情态字段“${field}”应回显修改值`,
    ).toContainText(value)
  }
}

function isSubmissionMutation(response, { origin, formId, submissionId }) {
  const request = response.request()
  const method = request.method().toUpperCase()
  if (method !== 'PUT') return false
  const url = new URL(response.url())
  if (url.origin !== origin) return false
  const exactSuffix = `/be/form/${encodeURIComponent(formId)}/submission/${encodeURIComponent(submissionId)}`
  return url.pathname.endsWith(exactSuffix)
}

async function inspectMutationResponse(response) {
  const httpSucceeded = response.ok()
  expect(httpSucceeded, `保存提报修改接口应返回成功 HTTP 状态，实际 ${response.status()}`).toBe(true)
  const responseOutcome = await response.text().then(
    (text) => ({ text }),
    (error) => ({ error }),
  )
  if ('error' in responseOutcome) {
    expect(false, '保存提报修改接口响应正文必须可读取，才能确认业务成功').toBe(true)
    return { body: null, succeeded: false }
  }
  const responseText = 'text' in responseOutcome ? responseOutcome.text : ''
  if (!responseText.trim()) {
    expect(false, '保存提报修改接口应返回非空 JSON 响应').toBe(true)
    return { body: null, succeeded: false }
  }
  let body
  try {
    body = JSON.parse(responseText)
  } catch {
    expect(false, '保存提报修改接口应返回有效 JSON').toBe(true)
    return { body: null, succeeded: false }
  }
  const objectBody = Boolean(body && typeof body === 'object' && !Array.isArray(body))
  expect(objectBody, '保存提报修改接口返回的 JSON 应为对象').toBe(true)
  if (!objectBody) return { body: null, succeeded: false }
  const hasBusinessStatus = Object.hasOwn(body, 'code') || Object.hasOwn(body, 'success')
  expect(hasBusinessStatus, '保存提报修改接口应返回明确的业务成功状态').toBe(true)
  let businessSucceeded = hasBusinessStatus
  if (Object.prototype.hasOwnProperty.call(body, 'code')) {
    businessSucceeded = Number(body.code) === 0
    expect(businessSucceeded, `保存提报修改接口业务码应为 0，实际 ${body.code}`).toBe(true)
  }
  if (Object.prototype.hasOwnProperty.call(body, 'success')) {
    const explicitSuccess = body.success === true
    expect(explicitSuccess, '保存提报修改接口 success 应为 true').toBe(true)
    businessSucceeded = businessSucceeded && explicitSuccess
  }
  return { body, succeeded: httpSucceeded && businessSucceeded }
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

async function screenshotFailure(page, submissionId, artifactWriter) {
  if (!artifactWriter || typeof artifactWriter.captureScreenshot !== 'function') {
    throw new Error('Runner 必须提供 artifactWriter')
  }
  const safeId = submissionId.replace(/[^a-zA-Z0-9_-]+/g, '_')
  return artifactWriter.captureScreenshot(
    page,
    `screenshots/${safeId || 'unknown'}-编辑失败-${Date.now()}.png`,
    { fullPage: true },
  )
}

async function detailAnswersSnapshot(page) {
  await flowExpect(page.locator('.reply-kv__row'), '详情答案必须加载完成').not.toHaveCount(0)
  return page.locator('.reply-kv__row').evaluateAll((rows) => rows.map((row) => ({
    label: row.querySelector('.reply-kv__label')?.textContent?.trim() ?? '',
    value: row.querySelector('.reply-kv__value')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    images: [...row.querySelectorAll('img[src]')].map((image) => {
      const url = new URL(image.src)
      return `${url.origin}${url.pathname}`
    }),
  })))
}

export async function run({
  siteBaseUrl,
  apiBaseUrl,
  requestPath = DEFAULT_REQUEST_PATH,
  variables = {},
  extraHTTPHeaders,
  ignoreHTTPSErrors = false,
  artifactWriter,
  signal,
  logger,
  recordApiResponse,
  recordResourceResponse,
  captureFailureScreenshot = true,
  captureSuccessScreenshots = false,
  verifyPersistence = false,
  prerequisiteTimeoutMs = scaleTimeout(NAVIGATION_TIMEOUT_MS),
}) {
  if (!siteBaseUrl) throw new Error('运行环境必须提供 Web 基址')
  if (!apiBaseUrl) throw new Error('运行环境必须提供 API 基址')
  const authorization = extraHTTPHeaders?.Authorization
  if (!authorization) throw new Error('提报编辑必须使用环境登录后的 Token')

  const detailUrl = buildDetailUrl(siteBaseUrl, requestPath)
  const siteOrigin = new URL(siteBaseUrl).origin
  const apiUrl = new URL(apiBaseUrl)
  if (apiUrl.origin !== siteOrigin) throw new Error('Web 基址与 API 基址必须同源')
  const apiPathPrefix = apiUrl.pathname.replace(/\/+$/, '') || '/'
  const { submissionId, formId } = resolveSubmissionContext(detailUrl, variables)
  const assertions = parseSubmissionAssertions(variables.SUBMISSION_ASSERTIONS)
  const editValues = parseSubmissionEditValues(variables.SUBMISSION_EDIT_VALUES)
  const submissionAssertions = parseJsonObject(variables.SUBMISSION_ASSERTIONS, 'SUBMISSION_ASSERTIONS')
  if (!Number.isFinite(prerequisiteTimeoutMs) || prerequisiteTimeoutMs <= 0) {
    throw new Error('前置请求等待时间必须是大于 0 的有限毫秒数')
  }

  let browser
  let context
  let page
  let stopAbortClose = () => undefined
  let networkObserver = {
    setPhase: () => undefined,
    stop: async () => undefined,
  }
  const shouldWaitForPrerequisite = ({ url, category, resourceType, responseHeaders }) => {
    if (resourceType === 'eventsource' || /text\/event-stream/i.test(responseHeaders['content-type'] ?? '')) return false
    if (category === 'api') {
      return url.origin === apiUrl.origin
        && !/\/translation\/ai\/status\/?$/.test(url.pathname)
    }
    return ['document', 'script', 'stylesheet', 'image', 'font'].includes(resourceType)
  }
  const waitForPrerequisites = async (stage) => {
    throwIfRunAborted(signal)
    logger('info', `${stage}：等待前置接口正文和资源加载完成`, { timeoutMs: prerequisiteTimeoutMs })
    const completed = await networkObserver.waitForIdle({
      timeoutMs: prerequisiteTimeoutMs, signal, shouldWaitFor: shouldWaitForPrerequisite,
    })
    throwIfRunAborted(signal)
    if (!completed) {
      throw new Error(`${stage}：前置接口或资源在 ${prerequisiteTimeoutMs} ms 内未完成，已停止后续操作`)
    }
    logger('info', `${stage}：前置接口和资源已完成`)
  }
  try {
    throwIfRunAborted(signal)
    logger('info', '启动 Google Chrome 无头浏览器，打开提报详情页', {
      browser: 'Google Chrome',
      headless: true,
      submissionId,
      formId,
      detailUrl,
    })
    browser = await launchGoogleChrome()
    stopAbortClose = closePlaywrightOnAbort(signal, () => ({ browser, context }), { logger })
    throwIfRunAborted(signal)
    context = await browser.newContext({
      ignoreHTTPSErrors,
      viewport: { width: 1440, height: 1000 },
      locale: 'zh-CN',
    })
    await context.addInitScript(({ token }) => {
      localStorage.setItem('token', token)
      localStorage.setItem('arco-locale', 'zh-CN')
    }, { token: authorization })
    throwIfRunAborted(signal)
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
    let updateRequestCount = 0
    let createRequestCount = 0
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.origin === apiUrl.origin && isSubmissionMutation({ request: () => request, url: () => request.url() }, {
        origin: apiUrl.origin, formId, submissionId,
      })) updateRequestCount += 1
      if (request.method() === 'POST' && /\/(?:be|f)\/form\/[^/]+\/submission\/?$/.test(url.pathname)) {
        createRequestCount += 1
      }
      if (!isApiBusinessRequest(request, apiUrl.origin, apiPathPrefix)) return
      businessRequestCount += 1
      if (request.headers().authorization === authorization) {
        authenticatedRequestCount += 1
      } else {
        const url = new URL(request.url())
        tokenViolations.push(`${request.method()} ${url.origin}${url.pathname}`)
      }
    })

    networkObserver.setPhase('提报详情加载')
    await page.goto(detailUrl, { waitUntil: 'domcontentloaded' })
    await flowExpect(page, 'Token 生效后不应跳转登录页').not.toHaveURL(/\/login(?:[/?#]|$)/)
    await flowExpect(page, '编辑前必须定位本次提报的精确详情地址').toHaveURL(detailUrl)
    await waitForUiReady(page, { timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS) })
    const editButton = await assertInitialDetailStructure(page, { submissionId, assertions })
    const originalAnswers = verifyPersistence ? await detailAnswersSnapshot(page) : null
    await waitForPrerequisites('进入编辑前')

    networkObserver.setPhase('进入编辑态')
    logger('info', '提报详情初始态断言执行完成，进入编辑态')
    await clickWhenReady(editButton)
    await waitForPrerequisites('编辑态加载后')
    const { submitButton } = await assertEditStructure(page, assertions.editFields)
    await flowExpect(page, '进入编辑态后必须保持原提报地址').toHaveURL(detailUrl)
    networkObserver.setPhase('编辑字段')
    const appliedEditFields = await applyEditValues(page, editValues)
    if (captureSuccessScreenshots && artifactWriter?.captureScreenshot) {
      await artifactWriter.captureScreenshot(page, 'screenshots/submission-edit-ready.png', { fullPage: true })
    }
    await waitForPrerequisites('提交提报前')

    throwIfRunAborted(signal)
    flowExpect(updateRequestCount, '点击提交前不得提前发送提报更新请求').toBe(0)
    flowExpect(createRequestCount, '已有提报编辑流程不得发送新增提报请求').toBe(0)
    networkObserver.setPhase('保存提报修改')
    logger('info', '编辑态结构和字段值断言执行完成，提交提报修改', { appliedEditFields })
    const updateResponsePromise = page.waitForResponse((response) => isSubmissionMutation(response, {
      origin: apiUrl.origin,
      formId,
      submissionId,
    }), { timeout: scaleTimeout(ACTION_TIMEOUT_MS) })
      .then(async (response) => ({ response, outcome: await inspectMutationResponse(response) }))
      .then(value => ({ value }), error => ({ error }))
    await clickWhenReady(submitButton)
    const capturedUpdate = await updateResponsePromise
    if (capturedUpdate.error) throw capturedUpdate.error
    const { response: updateResponseObject, outcome: updateOutcome } = capturedUpdate.value
    const updateResponse = updateOutcome.body
    expect(
      updateResponseObject.request().headers().authorization,
      '保存提报修改请求必须携带环境 Token',
    ).toBe(authorization)
    expect(updateRequestCount, '整个编辑流程应恰好发送一次原提报 PUT 更新请求').toBe(1)
    expect(createRequestCount, '编辑保存不得新增提报记录').toBe(0)
    const returnedId = updateResponse?.data?.submission_id ?? updateResponse?.data?.id
    if (returnedId !== undefined) {
      expect(String(returnedId), '保存响应中的提报 ID 必须保持不变').toBe(submissionId)
    }

    networkObserver.setPhase('保存后验证')
    await flowExpect(page.getByRole('button', { name: /^(?:编辑|編輯)$/ }), '保存后必须恢复详情态').toBeVisible()
    await flowExpect(page, '保存后必须仍在原提报详情地址').toHaveURL(detailUrl)
    await waitForUiReady(page, { timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS) })
    await assertInitialDetailStructure(page, {
      submissionId,
      assertions,
      verifyConfiguredAssertions: false,
      requireEditButton: false,
    })
    await assertAppliedDetailValues(page, editValues)
    if (verifyPersistence) {
      // A reload can strand the previous document's pending Chrome response bodies.
      // Keep collecting until they finish, or stop without repeating the saved update.
      await waitForPrerequisites('刷新核对前')
      networkObserver.setPhase('刷新核对原提报')
      await page.reload({ waitUntil: 'domcontentloaded' })
      await flowExpect(page, '刷新后应仍然打开原提报').toHaveURL(detailUrl)
      await waitForUiReady(page, { timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS) })
      await assertInitialDetailStructure(page, { submissionId, assertions, verifyConfiguredAssertions: false })
      await assertAppliedDetailValues(page, editValues)
      if (appliedEditFields.length === 0) {
        expect(await detailAnswersSnapshot(page), '原答案直接提交并刷新后，全部详情值和图片应保持一致').toEqual(originalAnswers)
      }
    }
    if (captureSuccessScreenshots && artifactWriter?.captureScreenshot) {
      await artifactWriter.captureScreenshot(page, 'screenshots/submission-edit-saved.png', { fullPage: true })
    }
    expect(tokenViolations, '所有 API 业务请求都必须携带环境 Token').toEqual([])
    expect(authenticatedRequestCount, '至少应观察到一个携带 Token 的 API 业务请求').toBeGreaterThan(0)
    expect(authenticatedRequestCount, '携带 Token 的请求数应等于全部 API 业务请求数').toBe(businessRequestCount)
    logger(updateOutcome.succeeded ? 'success' : 'warning', updateOutcome.succeeded
      ? '提报修改已提交，页面恢复详情态'
      : '提报修改请求未通过断言，已继续完成后续验证', {
      submissionId,
      formId,
      appliedEditFields,
      businessRequestCount,
      updateRequestCount,
      createRequestCount,
      reloaded: verifyPersistence,
    })

    networkObserver.setPhase('运行结果汇总')
    return {
      submissionId,
      formId,
      detailUrl,
      submitted: updateOutcome.succeeded,
      appliedEditFields,
      configuredAssertionCount: assertions.configuredAssertionCount,
      updateResponse,
      submissionAssertions,
      updateRequestCount,
      createRequestCount,
      reloaded: verifyPersistence,
    }
  } catch (error) {
    if (signal?.aborted) {
      logger('info', '已响应强制停止，正在清理 Chrome 无头浏览器')
    } else if (captureFailureScreenshot && page) {
      try {
        const screenshot = await screenshotFailure(page, submissionId, artifactWriter)
        logger('error', '提报详情编辑自动化执行失败，已保存当前页面截图', {
          screenshotPath: screenshot.absolutePath,
          artifact: screenshot,
        })
      } catch (screenshotError) {
        logger('error', '提报详情编辑自动化执行失败，当前页面截图保存失败', {
          reason: screenshotError instanceof Error ? screenshotError.message : String(screenshotError),
        })
      }
    } else {
      logger('error', '提报详情编辑自动化执行失败（测试模式未输出失败截图）')
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
  buildDetailUrl,
  inspectMutationResponse,
  isSubmissionMutation,
  normalizeRequestPath,
  parseSubmissionAssertions,
  parseSubmissionEditValues,
  resolveSubmissionContext,
}
