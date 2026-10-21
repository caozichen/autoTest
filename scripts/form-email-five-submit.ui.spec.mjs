import { observeFormEditTokens } from './support/form-edit-token-observer.mjs'
import { resolveAdminLocale } from './support/admin-locale.mjs'
import { publicOriginForSite } from '../shared/form-environment.mjs'
import { attachNetworkObserver } from './support/api-response-recorder.mjs'
import { expect as flowExpect, scaleTimeout } from './support/environment-timeouts.mjs'
import { createFormLinkContract, firstFormCode, isSystemItem } from './support/form-link-contract.mjs'
import { createFormSettingsContent } from './support/form-settings-content.mjs'
import { assertSubmissionPeriod, configureSubmissionPeriod, resolveSubmissionPeriod } from './support/form-submission-period.mjs'
import {
  assertPublishedNotification,
  configureAutomationNotification,
} from './support/form-settings-notifications.mjs'
import { launchGoogleChrome } from './support/google-chrome.mjs'
import { expect } from './support/recorded-expect.mjs'
import { clickWhenReady, observeUiReadiness } from './support/ui-readiness.mjs'
import {
  CONTACT_PRESET_TYPES,
  dismissFormOnboarding,
  ensureFieldRequired,
  ensurePropertySwitchChecked,
  ensureIgnoreStrategyInSettings,
  fetchFormDetail,
  initializeContactFields,
  inspectBusinessResponse,
  waitForDesignerBootstrap,
} from './form-all-fields-publish.ui.spec.mjs'
import {
  configureMainlandContactSettings,
  initializeMainlandContactFields,
} from './form-all-fields-publish-mainland.ui.spec.mjs'
import {
  assertVisibleSubmissionResult,
  indexSubmissionEntries,
  selectOption,
  waitForPublicMutation,
} from './form-lpxavn-submit.ui.spec.mjs'
import {
  closePlaywrightHandles,
  closePlaywrightOnAbort,
  throwIfRunAborted,
} from './playwright-run-control.mjs'

const NAVIGATION_TIMEOUT_MS = 45_000
const ACTION_TIMEOUT_MS = 30_000
export const FORM_SUBTITLE = '邮件测试：分别使用五个指定邮箱填写联系人信息，验证提交成功邮件通知。'
export const TEST_EMAILS = Object.freeze([
  '2637005402@qq.com',
  'cyh_iris_chen@163.com',
  'cici0318532cyh@gmail.com',
  'cyh-chen@outlook.com',
  'caozichen@lingxi360.cn',
])

function pageUrl(base, path) {
  return new URL(path.replace(/^\/+/, ''), `${base.replace(/\/+$/, '')}/`).toString()
}

function waitForResponse(page, method, path) {
  const pending = page.waitForResponse(response => response.request().method() === method
    && new URL(response.url()).pathname.endsWith(path), { timeout: scaleTimeout(ACTION_TIMEOUT_MS) })
  pending.catch(() => undefined)
  return pending
}

function requestBody(request, label) {
  try {
    return request.postDataJSON()
  } catch {
    expect(false, `${label}请求体应为有效 JSON`).toBe(true)
    return {}
  }
}

function contactItems(items) {
  return (Array.isArray(items) ? items : []).filter(item => item && Number(item.hidden) !== 1
    && !isSystemItem(item) && item.type_code !== 'page')
}

export function assertContactItems(items, label) {
  const contact = contactItems(items)
  expect(contact.map(item => item.type_code), `${label}应仅包含姓名、手机号、邮箱三道题`)
    .toEqual(CONTACT_PRESET_TYPES)
  expect(new Set(contact.map(item => item.item_key)).size, `${label}三道题 item_key 应唯一`).toBe(3)
  for (const item of contact) {
    expect(Number(item.rule_config?.required?.enabled), `${label}${item.type_code} 应为必填`).toBe(1)
  }
  expect(Number(contact.find(item => item.type_code === 'username')?.common_config?.name_title?.enabled),
    `${label}姓名题应开启采集称谓`).toBe(1)
  return contact
}

function scalarValues(value, output = [], visited = new WeakSet()) {
  if (value === null || value === undefined) return output
  if (typeof value !== 'object') {
    output.push(String(value))
    return output
  }
  if (visited.has(value)) return output
  visited.add(value)
  for (const child of Object.values(value)) scalarValues(child, output, visited)
  return output
}

export function assertContactSubmissionPayload(payload, fieldKeys, data, label, requestUrl) {
  expect(new URL(requestUrl).pathname, `${label}提交接口应对应本表单`)
    .toBe(`/api/f/form/${encodeURIComponent(data.formId)}/submission`)
  expect(Number(payload?.revision_no), `${label}提交版本应匹配已发布版本`).toBe(data.revisionNo)
  const entries = indexSubmissionEntries(payload, fieldKeys)
  for (const [type, value] of [
    ['username', data.name], ['mobile', data.mobile], ['email', data.email],
  ]) {
    const answer = entries.get(fieldKeys[type]) ?? []
    expect(answer.length, `${label}${type} 请求项应存在`).toBeGreaterThan(0)
    expect(answer.some(entry => scalarValues(entry).includes(value)), `${label}${type} 答案应与填写值一致`)
      .toBe(true)
  }
  for (const otherEmail of TEST_EMAILS.filter(email => email !== data.email)) {
    expect(JSON.stringify(entries.get(fieldKeys.email) ?? []), `${label}邮箱答案不应混入 ${otherEmail}`)
      .not.toContain(otherEmail)
  }
  expect(entries.size, `${label}应仅提交三道联系人题答案`).toBe(CONTACT_PRESET_TYPES.length)
  return entries
}

export function emailTestContent(title, formId, siteBaseUrl) {
  const settings = createFormSettingsContent({ title, formId, siteBaseUrl })
  return {
    ...settings.automationNotification,
    body: `${settings.automationNotification.body}<p><strong>邮件测试说明：</strong>本表单将分别使用五个指定邮箱提交一次，用于核对提交成功通知的邮件触发、标题和正文。</p>`,
  }
}

async function submitOneEmail({ browser, siteBaseUrl, formId, title, revisionNo, fieldKeys,
  email, index, ignoreHTTPSErrors, artifactWriter, logger, signal,
  recordApiResponse, recordResourceResponse }) {
  const publicOrigin = publicOriginForSite(siteBaseUrl)
  const formUrl = pageUrl(publicOrigin, `/form/?id=${encodeURIComponent(formId)}`)
  const context = await browser.newContext({
    ignoreHTTPSErrors,
    viewport: { width: 1440, height: 1000 },
    locale: 'zh-CN',
  })
  const observer = attachNetworkObserver(context, {
    initialPhase: `邮箱 ${index}：公开表单加载`,
    onApiResponse: recordApiResponse,
    onResourceResponse: recordResourceResponse,
  })
  await observer.ready
  const page = await context.newPage()
  observeUiReadiness(page)
  page.setDefaultTimeout(scaleTimeout(ACTION_TIMEOUT_MS))
  page.setDefaultNavigationTimeout(scaleTimeout(NAVIGATION_TIMEOUT_MS))
  let submissionRequestCount = 0
  const authorizationLeaks = []
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.origin !== publicOrigin) return
    if (request.headers().authorization) authorizationLeaks.push(`${request.method()} ${url.pathname}`)
    if (request.method() === 'POST' && url.pathname.endsWith(`/f/form/${formId}/submission`)) {
      submissionRequestCount += 1
    }
  })
  try {
    throwIfRunAborted(signal)
    const configPromise = page.waitForResponse(response => response.request().method() === 'GET'
      && new URL(response.url()).pathname.endsWith(`/f/form/${formId}`), {
      timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS),
    })
    await page.goto(formUrl, { waitUntil: 'domcontentloaded' })
    const configResponse = await configPromise
    expect(configResponse.ok(), `第 ${index} 次公开配置 HTTP 应成功`).toBe(true)
    const config = await configResponse.json().catch(() => null)
    expect(Number(config?.code), `第 ${index} 次公开配置业务码应为 0`).toBe(0)
    const form = config?.data?.form ?? {}
    expect(String(form.form_id ?? form.id ?? ''), `第 ${index} 次公开配置表单 ID 应匹配`).toBe(formId)
    expect(form.title, `第 ${index} 次公开配置标题应匹配`).toBe(title)
    expect(form.status, `第 ${index} 次公开配置应为已发布状态`).toBe('published')
    expect(form.subtitle, `第 ${index} 次公开配置应包含邮件测试描述`).toBe(FORM_SUBTITLE)
    expect(Number(config?.data?.revision_no), `第 ${index} 次公开配置版本应匹配`).toBe(revisionNo)
    assertContactItems(config?.data?.items, `第 ${index} 次公开配置`)
    await expect(page, `第 ${index} 次公开页标题应匹配`).toHaveTitle(title)
    await expect(page.getByText(title, { exact: true }), `第 ${index} 次公开页应显示表单标题`).toBeVisible()
    await expect(page.getByText(FORM_SUBTITLE, { exact: true }),
      `第 ${index} 次公开页应显示邮件测试描述`).toBeVisible()

    const name = `邮件测试用户${String(Date.now()).slice(-6)}${index}`
    const mobile = `139${String(Date.now() + index).slice(-8)}`
    for (const type of CONTACT_PRESET_TYPES) {
      await expect(page.locator(`.fb-runtime-field-card[data-item-key="${fieldKeys[type]}"]`),
        `第 ${index} 次公开页应唯一显示 ${type} 题`).toHaveCount(1)
    }
    const usernameCard = page.locator(`.fb-runtime-field-card[data-item-key="${fieldKeys.username}"]`)
    const nameTitle = usernameCard.locator('[role="combobox"]')
    await selectOption(page, nameTitle, 'Mr.（先生）', '姓名-称谓', logger)
    await usernameCard.locator('input').first().fill(name)
    await expect(usernameCard.locator('input').first(), `第 ${index} 次姓名应回显`).toHaveValue(name)
    const mobileCard = page.locator(`.fb-runtime-field-card[data-item-key="${fieldKeys.mobile}"]`)
    await expect(mobileCard.getByRole('combobox'), `第 ${index} 次手机号区号应为 +86`).toContainText('+86')
    await mobileCard.locator('input').first().fill(mobile)
    await expect(mobileCard.locator('input').first(), `第 ${index} 次手机号应回显`).toHaveValue(mobile)
    const emailInput = page.locator(`.fb-runtime-field-card[data-item-key="${fieldKeys.email}"] input`).first()
    await expect(emailInput, `第 ${index} 次邮箱应使用 email 类型`).toHaveAttribute('type', 'email')
    await emailInput.fill(email)
    await expect(emailInput, `第 ${index} 次邮箱应回显`).toHaveValue(email)

    observer.setPhase(`邮箱 ${index}：提交及结果`)
    const submission = await waitForPublicMutation(page, publicOrigin,
      `/f/form/${formId}/submission`,
      () => clickWhenReady(page.locator('.fb-runtime-submit-button-wrap button.fb-runtime-submit-button')),
      `第 ${index} 次提交表单`, { expectBusinessSuccess: false })
    const body = requestBody(submission.response.request(), `第 ${index} 次提交`)
    assertContactSubmissionPayload(body, fieldKeys, { formId, revisionNo, name, mobile, email },
      `第 ${index} 次`, submission.response.request().url())
    if (Object.hasOwn(submission.body, 'code')) {
      expect(Number(submission.body.code), `第 ${index} 次提交业务码应为 0`).toBe(0)
    }
    await expect(page, `第 ${index} 次提交后应进入结果页`)
      .toHaveURL(/\/form\/submission-result\/?(?:[?#]|$)/, { timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS) })
    const resultId = await assertVisibleSubmissionResult(page, formId)
    const responseId = String(submission.body?.data?.submission_id ?? submission.body?.data?.id ?? '')
    if (responseId) expect(resultId, `第 ${index} 次结果页 ID 应与接口一致`).toBe(responseId)
    expect(submissionRequestCount, `第 ${index} 次应且只应提交一次`).toBe(1)
    expect(authorizationLeaks, `第 ${index} 次公开请求不应携带后台 Token`).toEqual([])
    logger('success', `第 ${index} 次邮件测试表单提交完成`, { email, submissionId: resultId || responseId })
    return { email, name, mobile, submissionId: resultId || responseId || '' }
  } catch (error) {
    if (!signal?.aborted && artifactWriter?.captureScreenshot) {
      try {
        const screenshot = await artifactWriter.captureScreenshot(page,
          `screenshots/邮件测试表单-第${index}次公开填写-失败-${Date.now()}.png`, { fullPage: true })
        logger('error', `第 ${index} 次公开填写失败，已保存页面截图`, { artifact: screenshot })
      } catch (screenshotError) {
        logger('error', `第 ${index} 次公开填写失败，页面截图保存失败`, {
          reason: screenshotError instanceof Error ? screenshotError.message : String(screenshotError),
        })
      }
    }
    throw error
  } finally {
    observer.setPhase(`邮箱 ${index}：结束清理`)
    await observer.stop({ signal })
    await context.close()
  }
}

export async function run(options, { mainland = false } = {}) {
  const { siteBaseUrl, apiBaseUrl, ignoreHTTPSErrors = false, extraHTTPHeaders, variables = {},
    artifactWriter, signal, logger, recordApiResponse, recordResourceResponse } = options
  if (!siteBaseUrl || !apiBaseUrl) throw new Error('运行环境必须提供 Web 和 API 基址')
  const authorization = extraHTTPHeaders?.Authorization
  if (!authorization) throw new Error('所有后台业务请求必须使用环境登录后的 Token')
  if (new URL(siteBaseUrl).origin !== new URL(apiBaseUrl).origin) {
    throw new Error('Web 基址与 API 基址必须同源')
  }
  const submissionPeriod = resolveSubmissionPeriod(variables)
  const title = `自动化邮件测试表单-${Date.now()}`
  let editTokens
  let browser
  let context
  let page
  let stopAbortClose = () => undefined
  let observer = { setPhase: () => undefined, stop: async () => undefined }
  try {
    throwIfRunAborted(signal)
    browser = await launchGoogleChrome()
    stopAbortClose = closePlaywrightOnAbort(signal, () => ({ browser, context }), { logger })
    context = await browser.newContext({
      ignoreHTTPSErrors, viewport: { width: 1600, height: 1000 }, locale: resolveAdminLocale(variables),
      timezoneId: 'Asia/Shanghai',
    })
    observer = attachNetworkObserver(context, {
      initialPhase: '浏览器初始化',
      onApiResponse: recordApiResponse,
      onResourceResponse: recordResourceResponse,
    })
    await observer.ready
    editTokens = observeFormEditTokens(context, apiBaseUrl)
    page = await context.newPage()
    observeUiReadiness(page)
    page.setDefaultTimeout(scaleTimeout(ACTION_TIMEOUT_MS))
    page.setDefaultNavigationTimeout(scaleTimeout(NAVIGATION_TIMEOUT_MS))
    const tokenViolations = []
    let businessRequestCount = 0
    page.on('request', request => {
      const url = new URL(request.url())
      if (url.origin !== new URL(apiBaseUrl).origin || !url.pathname.startsWith('/api/be/')) return
      businessRequestCount += 1
      if (request.headers().authorization !== authorization) {
        tokenViolations.push(`${request.method()} ${url.pathname}`)
      }
    })
    await context.addInitScript(({ token, adminLocale }) => {
      localStorage.setItem('token', token)
      localStorage.setItem('arco-locale', adminLocale)
    }, { token: authorization, adminLocale: resolveAdminLocale(variables) })

    observer.setPhase('创建空白表单')
    const createPath = mainland ? '/form-activity/index?type=form' : '/form-activity/index'
    await page.goto(pageUrl(siteBaseUrl, createPath), { waitUntil: 'domcontentloaded' })
    await expect(page, '后台 Token 生效后不应跳转登录页').not.toHaveURL(/\/login(?:[/?#]|$)/)
    const createPromise = waitForResponse(page, 'POST', '/be/form')
    await clickWhenReady(page.getByText(/从空白表单开始|從空白表[單格]開始/, { exact: true }))
    const create = await inspectBusinessResponse(await createPromise, '创建空白表单')
    await page.waitForURL(/\/form-activity\/designer\?[^#]*id=/, { timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS) })
    const formId = new URL(page.url()).searchParams.get('id') || String(create.body?.data?.id ?? '')
    flowExpect(formId, '创建后必须取得表单 ID').toMatch(/\S+/)

    observer.setPhase('设计联系人题')
    await waitForDesignerBootstrap(page, logger)
    if (mainland) await initializeMainlandContactFields(page, logger)
    else await initializeContactFields(page, logger)
    for (const type of CONTACT_PRESET_TYPES) await ensureFieldRequired(page, type, logger)
    await clickWhenReady(page.locator('.form-field[data-container-path=""][data-component-type="username"]'))
    await ensurePropertySwitchChecked(page, /采集称谓|採集稱謂/, '姓名题“采集称谓”')
    const rootFields = page.locator('.form-field[data-container-path=""]')
    await expect(rootFields, '设计器应仅有三道联系人题').toHaveCount(3)
    expect(await rootFields.evaluateAll(nodes => nodes.map(node => node.dataset.componentType)),
      '设计器联系人题顺序应为姓名、手机号、邮箱').toEqual(CONTACT_PRESET_TYPES)
    const titleEditor = page.locator('h1 .editable-div[contenteditable="true"]').first()
    await titleEditor.fill(title)
    await titleEditor.blur()
    await expect(titleEditor, '邮件测试表单标题应回显').toHaveText(title)
    const subtitleEditor = page.locator('.fb-runtime-form-subtitle .editable-div[contenteditable="true"]')
    await flowExpect(subtitleEditor, '表单描述编辑区必须唯一存在').toHaveCount(1)
    await subtitleEditor.fill(FORM_SUBTITLE)
    await subtitleEditor.blur()
    await expect(subtitleEditor, '邮件测试表单描述应回显').toHaveText(FORM_SUBTITLE)

    observer.setPhase('保存草稿')
    const itemsPromise = waitForResponse(page, 'PUT', `/be/form/${formId}/items`)
    const configPromise = waitForResponse(page, 'PUT', `/be/form/${formId}/config`)
    configPromise.catch(() => undefined)
    await clickWhenReady(page.getByRole('button', { name: /^(保存草稿|儲存草稿|保存|儲存)$/ }))
    const itemsResponse = await itemsPromise
    const saved = await inspectBusinessResponse(itemsResponse, '保存联系人题')
    if (!saved.succeeded) {
      await editTokens.assert()
      throw new Error(`保存联系人题失败：${saved.body?.message ?? '响应无法确认业务成功'}`)
    }
    const configResponse = await configPromise
    const configured = await inspectBusinessResponse(configResponse, '保存表单配置')
    flowExpect(configured.succeeded, '保存表单配置必须成功，才能继续邮件测试').toBe(true)
    const savedItems = requestBody(itemsResponse.request(), '保存联系人题')
    const savedConfig = requestBody(configResponse.request(), '保存表单配置')
    const revisionNo = Number(savedItems.revision_no)
    expect(revisionNo, '保存版本应至少为 1').toBeGreaterThanOrEqual(1)
    expect(Number(savedConfig.revision_no), '题目和配置保存应使用同一版本').toBe(revisionNo)
    expect(savedItems.title, '保存标题应与设计器一致').toBe(title)
    expect(savedItems.subtitle, '保存描述应包含邮件测试说明').toBe(FORM_SUBTITLE)
    assertContactItems(savedItems.items, '草稿')
    await expect(page.getByText(/保存成功|儲存成功/).last(), '保存后应显示成功提示').toBeVisible()

    observer.setPhase('联系人设置')
    if (mainland) await configureMainlandContactSettings(page, logger)
    else await ensureIgnoreStrategyInSettings(page, logger)
    observer.setPhase('设置填报开始和结束时间')
    await configureSubmissionPeriod({ page, formId, period: submissionPeriod, logger, inspectBusinessResponse,
      readForm: async () => (await fetchFormDetail(page, apiBaseUrl, formId, authorization))?.data?.form,
    })
    observer.setPhase('消息及触达邮件配置')
    const messageStep = page.locator('.form-activity-step-nav .form-activity-step')
      .filter({ hasText: /消息及触达|訊息及觸達/ })
    await clickWhenReady(messageStep)
    const emailContent = emailTestContent(title, formId, siteBaseUrl)
    const notification = await configureAutomationNotification({
      page, formId, content: emailContent, logger,
      readForm: async () => {
        const detail = await fetchFormDetail(page, apiBaseUrl, formId, authorization)
        return detail?.data?.form ?? detail?.data
      },
    })

    observer.setPhase('发布表单')
    const publishButton = page.getByRole('button', { name: /^(发布|發[佈布])$/ })
    if (!await publishButton.isVisible().catch(() => false)
      && await page.getByRole('button', { name: /提交审核|提交審核/ }).isVisible().catch(() => false)) {
      throw new Error('当前机构要求发布审批，无法直接发布本次邮件测试表单')
    }
    await flowExpect(publishButton, '设置页必须提供直接发布入口').toBeVisible()
    const publishPromise = waitForResponse(page, 'POST', `/be/form/${formId}/publish`)
    await clickWhenReady(publishButton)
    const published = await inspectBusinessResponse(await publishPromise, '发布表单')
    expect(String(published.body?.data?.form_id ?? ''), '发布响应表单 ID 应匹配').toBe(String(formId))
    expect(published.body?.data?.status, '发布响应状态应为 published').toBe('published')
    expect(Number(published.body?.data?.revision_no), '发布响应版本应匹配').toBe(revisionNo)
    await page.waitForURL(/\/form-activity\/list(?:[/?#]|$)/, { timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS) })

    observer.setPhase('已发布列表验证')
    await dismissFormOnboarding(page)
    const auditTabs = page.locator('.form-activity-audit-tabs')
    if (await auditTabs.isVisible().catch(() => false)) {
      await clickWhenReady(auditTabs.getByText(/已发布|已發[佈布]/, { exact: true }))
    }
    await page.getByPlaceholder(/请输入标题|請輸入標題/).fill(title)
    const listPromise = page.waitForResponse(response => response.request().method() === 'GET'
      && new URL(response.url()).pathname.endsWith('/be/form/list')
      && new URL(response.url()).searchParams.get('filter[title]') === title, {
      timeout: scaleTimeout(ACTION_TIMEOUT_MS),
    })
    await clickWhenReady(page.getByRole('button', { name: /查询|查詢|搜索|搜尋/ }))
    const list = await inspectBusinessResponse(await listPromise, '查询已发布表单')
    const publishedRecord = (list.body?.data?.list ?? []).find(record => String(record.id) === String(formId))
    expect(publishedRecord?.title, '已发布列表标题应匹配').toBe(title)
    expect(publishedRecord?.status, '已发布列表状态应为 published').toBe('published')
    expect(Number(publishedRecord?.current_revision_no), '已发布列表版本应匹配').toBe(revisionNo)
    flowExpect(publishedRecord?.time_range, '本次邮件表单发布后必须处于填报中').toBe('in_progress')
    flowExpect(publishedRecord?.start_time, '列表应返回本次填报开始时间').toBe(submissionPeriod.startTime)
    flowExpect(publishedRecord?.end_time, '列表应返回本次填报截止时间').toBe(submissionPeriod.endTime)
    await expect(page.locator('.form-activity-list__title-link', { hasText: title }),
      '已发布列表中应唯一存在本次表单').toHaveCount(1)

    observer.setPhase('读取发布契约')
    const detail = await fetchFormDetail(page, apiBaseUrl, formId, authorization)
    const form = detail?.data?.form ?? detail?.data ?? {}
    const items = detail?.data?.items ?? form.items ?? []
    assertContactItems(items, '发布后详情')
    expect(form.title, '发布后详情标题应匹配').toBe(title)
    expect(form.status, '发布后详情状态应为 published').toBe('published')
    assertSubmissionPeriod(form, submissionPeriod, '发布后回读')
    const templates = await fetchFormDetail(page, apiBaseUrl, formId, authorization, 'notification/template')
    const publishedNotification = assertPublishedNotification(form.notification_config?.user_notification,
      notification.savedParameters, templates.data, { variant: 'automation' })
    const formCode = firstFormCode(published.body, publishedRecord, detail)
    const formContract = createFormLinkContract({ formId, formCode, title, revisionNo, items })
    formContract.settings = { automationNotification: notification, publishedNotification, submissionPeriod }
    if (artifactWriter?.writeFile) {
      await artifactWriter.writeFile('form-settings.json', JSON.stringify({
        schemaVersion: 1,
        formId,
        title,
        subtitle: FORM_SUBTITLE,
        automationNotification: notification,
        publishedNotification,
        submissionPeriod,
        testEmails: TEST_EMAILS,
      }, null, 2), { encoding: 'utf8', type: 'attachment', mimeType: 'application/json' })
    }
    for (const type of CONTACT_PRESET_TYPES) {
      flowExpect(formContract.fieldKeys[type], `发布契约必须包含 ${type} 题 key`).toMatch(/\S+/)
    }
    expect(businessRequestCount, '后台应发出携带 Token 的业务请求').toBeGreaterThan(0)
    expect(tokenViolations, '后台业务请求都应携带环境 Token').toEqual([])

    const submissions = []
    for (const [emailIndex, email] of TEST_EMAILS.entries()) {
      throwIfRunAborted(signal)
      const result = await submitOneEmail({
        browser, siteBaseUrl, formId, title, revisionNo, fieldKeys: formContract.fieldKeys,
        email, index: emailIndex + 1, ignoreHTTPSErrors, artifactWriter, logger, signal,
        recordApiResponse, recordResourceResponse,
      })
      submissions.push(result)
    }
    expect(submissions.map(item => item.email), '五次提交邮箱应与指定顺序完全一致').toEqual(TEST_EMAILS)
    expect(submissions.map(item => item.submissionId).filter(Boolean).length,
      '五次提交都应取得提报 ID').toBe(TEST_EMAILS.length)
    expect(new Set(submissions.map(item => item.submissionId)).size,
      '五次提交应生成不同提报 ID').toBe(TEST_EMAILS.length)
    await editTokens.assert()
    logger('success', '五个邮箱已分别完成一次表单提交，邮件配置及发布契约验证完成', { formId })
    return {
      formId, formCode, formContract, title, revisionNo, status: 'submitted', submissionPeriod,
      browser: 'chrome', headless: true, contactFields: CONTACT_PRESET_TYPES,
      emails: TEST_EMAILS, submissions, submissionCount: submissions.length,
      notification: publishedNotification,
    }
  } catch (error) {
    if (!signal?.aborted && page && artifactWriter?.captureScreenshot) {
      try {
        const screenshot = await artifactWriter.captureScreenshot(page,
          `screenshots/邮件测试表单-失败-${Date.now()}.png`, { fullPage: true })
        logger('error', '邮件测试表单执行失败，已保存后台页面截图', { artifact: screenshot })
      } catch (screenshotError) {
        logger('error', '邮件测试表单执行失败，页面截图保存失败', {
          reason: screenshotError instanceof Error ? screenshotError.message : String(screenshotError),
        })
      }
    }
    throw error
  } finally {
    editTokens?.stop()
    observer.setPhase('结束清理')
    await observer.stop({ signal })
    const abortCloseStarted = await stopAbortClose()
    if (!abortCloseStarted) await closePlaywrightHandles({ context, browser }, { logger })
  }
}
