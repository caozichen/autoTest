import { scaleTimeout } from './support/environment-timeouts.mjs'
import { expect } from './support/recorded-expect.mjs'
import { attachNetworkObserver } from './support/api-response-recorder.mjs'
import {
  createFormLinkContract,
  firstFormCode,
} from './support/form-link-contract.mjs'
import { launchGoogleChrome } from './support/google-chrome.mjs'

import {
  closePlaywrightHandles,
  closePlaywrightOnAbort,
  throwIfRunAborted,
} from './playwright-run-control.mjs'

const NAVIGATION_TIMEOUT_MS = 45_000
const ACTION_TIMEOUT_MS = 20_000
const API_PATH_PREFIX = '/api/be/'

function timestampTitle(now = Date.now()) {
  return `自动化测试表单-${now}`
}

function pageUrl(siteBaseUrl, path) {
  return new URL(path.replace(/^\/+/, ''), `${siteBaseUrl.replace(/\/+$/, '')}/`).toString()
}

function isApiBusinessRequest(request, apiOrigin) {
  const url = new URL(request.url())
  return url.origin === apiOrigin && url.pathname.startsWith(API_PATH_PREFIX)
}

function redactUrl(rawUrl) {
  const url = new URL(rawUrl)
  return `${url.origin}${url.pathname}`
}

function parseRequestPayload(request, label) {
  try {
    return request.postDataJSON()
  } catch {
    expect(false, `${label}请求体应为有效 JSON`).toBe(true)
    return {}
  }
}

function formatBusinessBody(body) {
  try {
    return JSON.stringify(body).slice(0, 500)
  } catch {
    return String(body)
  }
}

async function inspectBusinessResponse(response, label) {
  const httpSucceeded = response.ok()
  expect(
    httpSucceeded,
    `${label}接口应返回成功 HTTP 状态，实际 ${response.status()}`,
  ).toBe(true)

  const responseOutcome = await response.text().then(
    (text) => ({ text }),
    (error) => ({ error }),
  )
  if ('error' in responseOutcome) {
    const bodyReadError = responseOutcome.error instanceof Error
      ? responseOutcome.error.message
      : String(responseOutcome.error)
    return {
      body: {},
      bodyValid: false,
      bodyReadError,
      warning: true,
      incomplete: true,
      succeeded: httpSucceeded,
    }
  }

  let parsedBody = null
  try {
    parsedBody = responseOutcome.text.trim() ? JSON.parse(responseOutcome.text) : null
  } catch {
    expect(false, `${label}接口应返回有效 JSON，实际 ${responseOutcome.text.slice(0, 500)}`).toBe(true)
  }
  const bodyValid = Boolean(parsedBody && typeof parsedBody === 'object' && !Array.isArray(parsedBody))
  expect(bodyValid, `${label}接口应返回有效 JSON 业务信封`).toBe(true)
  const body = bodyValid ? parsedBody : {}
  const hasBusinessCode = Object.prototype.hasOwnProperty.call(body, 'code')
  expect(
    hasBusinessCode,
    `${label}响应应包含业务码，实际 ${formatBusinessBody(body)}`,
  ).toBe(true)
  const businessSucceeded = hasBusinessCode && Number(body.code) === 0
  if (hasBusinessCode) {
    expect(
      businessSucceeded,
      `${label}业务码应为 0，实际响应 ${formatBusinessBody(body)}`,
    ).toBe(true)
  }
  return {
    body,
    bodyValid,
    succeeded: httpSucceeded && businessSucceeded,
  }
}

async function clickFirstVisible(locators, label) {
  for (const locator of locators) {
    if (await locator.first().isVisible().catch(() => false)) {
      await locator.first().click()
      return
    }
  }
  throw new Error(`页面中未找到可点击的“${label}”控件`)
}

async function waitForApiResponse(page, urlPattern, action, label) {
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname.includes(urlPattern) && response.request().method() !== 'GET'
  }, { timeout: scaleTimeout(ACTION_TIMEOUT_MS) })
  await action()
  const response = await responsePromise
  const outcome = await inspectBusinessResponse(response, label)
  return { response, ...outcome }
}

async function fetchFormDetail(page, apiBaseUrl, formId, authorization) {
  const detailUrl = new URL(`be/form/${encodeURIComponent(formId)}`, `${apiBaseUrl.replace(/\/+$/, '')}/`).toString()
  const result = await page.evaluate(async ({ url, token }) => {
    try {
      const response = await fetch(url, { headers: { Authorization: token } })
      return {
        ok: response.ok,
        status: response.status,
        body: await response.json().catch(() => null),
      }
    } catch (error) {
      return {
        ok: false,
        status: 0,
        body: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }, { url: detailUrl, token: authorization })
  expect(
    result.ok,
    `读取已发布表单详情接口应成功，实际 HTTP ${result.status}${result.error ? `：${result.error}` : ''}`,
  ).toBe(true)
  const validBody = Boolean(result.body && typeof result.body === 'object' && !Array.isArray(result.body))
  expect(validBody, '读取已发布表单详情接口应返回有效 JSON').toBe(true)
  const body = validBody ? result.body : {}
  expect(Number(body.code), `读取已发布表单详情接口业务码应为 0，实际 ${String(body.code)}`).toBe(0)
  return body
}

async function screenshotFailure(page, title, artifactWriter) {
  if (!artifactWriter || typeof artifactWriter.captureScreenshot !== 'function') {
    throw new Error('Runner 必须提供 artifactWriter')
  }
  const safeTitle = title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, '_')
  return artifactWriter.captureScreenshot(
    page,
    `screenshots/${safeTitle}-失败-${Date.now()}.png`,
    { fullPage: true },
  )
}

async function chooseContactCollectionInDesigner(page, logger) {
  const prompt = page.getByRole('dialog').filter({ hasText: /此表单目前设置为不收录联系人|此表單目前設定為不收錄聯絡人/ })
  if (await prompt.isVisible().catch(() => false)) {
    logger('info', '联系人题触发全局收录提示，选择开启收录联系人')
    await clickFirstVisible([
      prompt.getByRole('button', { name: /是|確認|确定|Yes/i }),
      prompt.locator('.fb-dialog-btn--primary'),
    ], '开启收录联系人')
  }

  const collectDialog = page.getByRole('dialog').filter({ hasText: /是否收录联系人|是否收錄聯絡人/ })
  const collectDialogVisible = await collectDialog
    .waitFor({ state: 'visible', timeout: scaleTimeout(5_000) })
    .then(() => true)
    .catch(() => false)
  if (collectDialogVisible) {
    await clickFirstVisible([
      collectDialog.getByRole('button', { name: /确认收录到联系人|確認收錄到聯絡人/ }),
    ], '确认收录到联系人')
  }

  const replaceDialog = page.getByRole('dialog').filter({ hasText: /联系人信息替换确认|聯絡人資訊替換確認/ })
  const replaceDialogVisible = await replaceDialog
    .waitFor({ state: 'visible', timeout: scaleTimeout(collectDialogVisible ? 5_000 : 1_000) })
    .then(() => true)
    .catch(() => false)
  if (replaceDialogVisible) {
    await replaceDialog.getByText(/忽略，不替换|忽略，不替換/, { exact: true }).click()
    await waitForApiResponse(
      page,
      '/config',
      () => clickFirstVisible([
        replaceDialog.getByRole('button', { name: /确定|確認|OK/i }),
        replaceDialog.locator('button').last(),
      ], '确认忽略不替换'),
      '保存联系人收录策略',
    )
    await expect(replaceDialog, '联系人收录设置保存后弹窗应关闭').toBeHidden()
  } else if (collectDialogVisible) {
    throw new Error('确认收录联系人后未进入“联系人信息替换确认”步骤')
  }
}

function contactFields(page) {
  return ['username', 'mobile', 'email'].map((type) => ({
    type,
    locator: page.locator(`.form-field[data-component-type="${type}"]`),
  }))
}

async function hasAllContactFields(page) {
  const counts = await Promise.all(contactFields(page).map(({ locator }) => locator.count()))
  return counts.every((count) => count === 1)
}

async function ensureIgnoreStrategyInSettings(page, logger) {
  logger('info', '进入基础设置并打开“收录联系人设置”')
  const basicSettingsStep = page
    .locator('.form-activity-step-nav .form-activity-step')
    .filter({ hasText: /基础设置|基礎設定/ })
  await expect(basicSettingsStep, '顶部步骤导航中应有唯一的“基础设置”入口').toHaveCount(1)
  await expect(basicSettingsStep, '“基础设置”步骤应可点击').toBeVisible()
  await basicSettingsStep.click()
  await page.waitForURL(/\/form-activity\/settings\?[^#]*id=/, { timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS) })
  await page.locator('[data-menu-key="collect-contact"]').click()

  const switchControl = page.getByRole('switch', { name: /是否收录联系人开关|是否收錄聯絡人開關/ })
  await expect(switchControl, '联系人收录开关应显示').toBeVisible()
  const state = await switchControl.getAttribute('data-state')
  if (state !== 'checked' && await switchControl.getAttribute('aria-checked') !== 'true') {
    await switchControl.click()
  } else {
    await page.getByRole('button', { name: /是否收录联系人|是否收錄聯絡人/ }).click()
  }

  const ignoreRadio = page.getByRole('radio', { name: /忽略，不替换|忽略，不替換/ })
  await expect(ignoreRadio, '应显示“忽略，不替换”策略').toBeVisible()
  await ignoreRadio.click()
  await waitForApiResponse(
    page,
    '/config',
    () => page.getByRole('button', { name: /确认|確認/, exact: true }).click(),
    '确认联系人收录设置',
  )

  await expect(switchControl, '联系人收录开关应保持开启').toHaveAttribute('data-state', 'checked')
  await expect(page.getByText(/忽略，不替换|忽略，不替換/, { exact: true }), '设置页应回显忽略策略').toBeVisible()
  logger('success', '联系人收录已开启，冲突策略为“忽略，不替换”')
}

export async function run({
  siteBaseUrl,
  apiBaseUrl,
  ignoreHTTPSErrors = false,
  extraHTTPHeaders,
  artifactWriter,
  signal,
  logger,
  recordApiResponse,
  recordResourceResponse,
}) {
  if (!siteBaseUrl) throw new Error('运行环境必须提供 Web 基址')
  if (!apiBaseUrl) throw new Error('运行环境必须提供 API 基址')
  const authorization = extraHTTPHeaders?.Authorization
  if (!authorization) throw new Error('所有业务请求必须使用环境登录后的 Token')

  const title = timestampTitle()
  const siteOrigin = new URL(siteBaseUrl).origin
  const apiOrigin = new URL(apiBaseUrl).origin
  if (siteOrigin !== apiOrigin) throw new Error('Web 基址与 API 基址必须同源')

  let browser
  let context
  let page
  let stopAbortClose = () => undefined
  let networkObserver = {
    setPhase: () => undefined,
    stop: async () => undefined,
  }
  try {
    throwIfRunAborted(signal)
    logger('info', '启动 Chrome 无头浏览器，界面不会显示', { browser: 'Google Chrome', headless: true })
    browser = await launchGoogleChrome()
    stopAbortClose = closePlaywrightOnAbort(signal, () => ({ browser, context }), { logger })
    throwIfRunAborted(signal)
    context = await browser.newContext({
      ignoreHTTPSErrors,
      viewport: { width: 1600, height: 1000 },
      locale: 'zh-CN',
    })
    throwIfRunAborted(signal)
    networkObserver = attachNetworkObserver(context, {
      initialPhase: '浏览器初始化',
      onApiResponse: recordApiResponse,
      onResourceResponse: recordResourceResponse,
    })
    await networkObserver.ready
    page = await context.newPage()
    page.setDefaultTimeout(scaleTimeout(ACTION_TIMEOUT_MS))
    page.setDefaultNavigationTimeout(scaleTimeout(NAVIGATION_TIMEOUT_MS))

    let businessRequestCount = 0
    let authenticatedRequestCount = 0
    const tokenViolations = []
    page.on('request', (request) => {
      if (!isApiBusinessRequest(request, apiOrigin)) return
      businessRequestCount += 1
      if (request.headers().authorization === authorization) {
        authenticatedRequestCount += 1
        return
      }
      tokenViolations.push(`${request.method()} ${redactUrl(request.url())}`)
    })

    await context.addInitScript(({ token }) => {
      localStorage.setItem('token', token)
      localStorage.setItem('arco-locale', 'zh-CN')
    }, { token: authorization })
    logger('success', '已将环境登录 Token 注入浏览器会话（Token 内容已隐藏）')

    let formId = ''
    networkObserver.setPhase('页面初始化')
    logger('info', '访问表单活动创建页', { path: '/form-activity/index', title })
    await page.goto(pageUrl(siteBaseUrl, '/form-activity/index'), { waitUntil: 'domcontentloaded' })
    await expect(page, 'Token 生效后不应跳转登录页').not.toHaveURL(/\/login(?:[/?#]|$)/)

    networkObserver.setPhase('创建空白表单')
    const createResponse = await waitForApiResponse(
      page,
      '/be/form',
      () => page.getByText(/从空白表单开始|從空白表單開始/, { exact: true }).click(),
      '通过页面创建空白表单',
    )
    await page.waitForURL(/\/form-activity\/designer\?[^#]*id=/, { timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS) })
    formId = new URL(page.url()).searchParams.get('id') || String(createResponse.body?.data?.id ?? '')
    if (!formId) throw new Error('创建表单后 URL 或响应中未返回表单 id')
    logger('success', '已通过页面进入表单设计器', { formId })

    networkObserver.setPhase('设计联系人字段')
    const contactPalette = page.locator('button[data-component-type="contactGroup"]')
    await expect(contactPalette, '设计器题型库应显示联系人快捷项').toBeVisible()

    const initialCollectDialog = page.getByRole('dialog').filter({ hasText: /是否收录联系人|是否收錄聯絡人/ })
    const initialDialogVisible = await initialCollectDialog
      .waitFor({ state: 'visible', timeout: scaleTimeout(3_000) })
      .then(() => true)
      .catch(() => false)
    if (initialDialogVisible) {
      logger('info', '检测到设计器首次联系人收录弹窗，先完成“忽略，不替换”设置')
      await chooseContactCollectionInDesigner(page, logger)
    }

    if (!await hasAllContactFields(page)) {
      await expect(page.locator('.fb-dialog-overlay[data-state="open"]'), '点击联系人前页面不应存在遮罩弹窗').toHaveCount(0)
      await contactPalette.click()
      await chooseContactCollectionInDesigner(page, logger)
    } else {
      logger('info', '首次联系人收录设置已自动生成联系人三题，无需重复点击联系人快捷项')
    }

    for (const { type, locator } of contactFields(page)) {
      await expect(
        locator,
        `点击联系人后应自动生成 ${type} 题`,
      ).toHaveCount(1)
    }
    logger('info', '联系人快捷项断言执行完成：检查姓名、手机号、邮箱三题')

    const titleEditor = page.locator('h1 .editable-div[contenteditable="true"]').first()
    await expect(titleEditor, '表单标题编辑区应可见').toBeVisible()
    await titleEditor.fill(title)
    await titleEditor.blur()
    await expect(titleEditor, '表单标题应更新为当前时间戳名称').toHaveText(title)

    networkObserver.setPhase('保存草稿')
    logger('info', '点击“保存草稿”')
    const itemSavePromise = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return response.request().method() === 'PUT' && url.pathname.endsWith(`/be/form/${formId}/items`)
    }, { timeout: scaleTimeout(ACTION_TIMEOUT_MS) })
    await page.getByRole('button', { name: /保存草稿|儲存草稿/ }).click()
    const itemSaveResponse = await itemSavePromise
    await inspectBusinessResponse(itemSaveResponse, '保存草稿')
    const itemsPayload = parseRequestPayload(itemSaveResponse.request(), '保存草稿')
    await expect(page.getByText(/保存成功|儲存成功/).last(), '页面应提示保存成功').toBeVisible()
    logger('success', '表单名称及联系人三题已保存为草稿')

    networkObserver.setPhase('联系人设置')
    await ensureIgnoreStrategyInSettings(page, logger)

    networkObserver.setPhase('发布表单')
    logger('info', '点击设置页“发布”按钮')
    const publishPromise = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return response.request().method() === 'POST' && url.pathname.endsWith(`/be/form/${formId}/publish`)
    }, { timeout: scaleTimeout(ACTION_TIMEOUT_MS) })
    await page.getByRole('button', { name: /发布|發佈/, exact: true }).click()
    const publishResponse = await publishPromise
    const publishOutcome = await inspectBusinessResponse(publishResponse, '发布表单')
    const publishBody = publishOutcome.body
    await page.waitForURL(/\/form-activity\/list(?:[/?#]|$)/, { timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS) })
    logger('success', '表单发布成功并已回到列表页')

    networkObserver.setPhase('已发布列表验证')
    const auditTabs = page.locator('.form-activity-audit-tabs')
    if (await auditTabs.isVisible().catch(() => false)) {
      await auditTabs.getByText(/已发布|已發佈/, { exact: true }).click()
    }
    const titleInput = page.getByPlaceholder(/请输入标题|請輸入標題/)
    await expect(titleInput, '列表标题筛选框应可见').toBeVisible()
    await titleInput.fill(title)
    await page.getByRole('button', { name: /查询|查詢|搜索|搜尋/ }).click()
    const titleLink = page.locator('.form-activity-list__title-link', { hasText: title })
    await expect(titleLink, '已发布列表中应找到本次创建的表单').toHaveCount(1)
    await expect(titleLink, '列表中的表单标题应完全匹配').toHaveText(title)
    logger('info', '已发布列表断言执行完成', { formId, title })

    networkObserver.setPhase('读取发布契约')
    const formDetailResponse = await fetchFormDetail(page, apiBaseUrl, formId, authorization)
    const formCode = firstFormCode(publishBody, formDetailResponse)
    const formContract = createFormLinkContract({
      formId,
      formCode,
      title,
      revisionNo: publishBody?.data?.revision_no,
      items: formDetailResponse?.data?.items || formDetailResponse?.data?.form?.items || itemsPayload?.items,
    })
    logger('success', '已生成可供后续脚本使用的联系人表单联动参数', {
      formId,
      legacyFormCode: formCode || undefined,
      fieldCount: Object.values(formContract.fieldKeys).filter(Boolean).length,
    })

    networkObserver.setPhase('运行结果汇总')
    expect(tokenViolations, '所有 API 业务请求都必须携带环境 Token').toEqual([])
    expect(authenticatedRequestCount, '至少应观察到一个携带 Token 的业务请求').toBeGreaterThan(0)
    expect(authenticatedRequestCount, '携带 Token 的请求数应等于全部业务请求数').toBe(businessRequestCount)
    logger('info', '浏览器请求 Token 断言执行完成', {
      businessRequestCount,
      authenticatedRequestCount,
      token: '[REDACTED]',
    })
    logger('success', 'Chrome 无头 UI 自动化执行完成，网络健康结果将在 Runner 收口时汇总')

    return {
      formId,
      formCode,
      formContract,
      title,
      status: 'published',
      browser: 'chrome',
      headless: true,
      contactFields: ['username', 'mobile', 'email'],
      authenticatedRequestCount,
      publishResponse: publishBody,
    }
  } catch (error) {
    if (signal?.aborted) {
      logger('info', '已响应强制停止，正在清理 Chrome 无头浏览器')
    } else if (page) {
      try {
        const screenshot = await screenshotFailure(page, title, artifactWriter)
        logger('error', 'UI 自动化执行失败，已保存当前页面截图', {
          screenshotPath: screenshot.absolutePath,
          artifact: screenshot,
        })
      } catch (screenshotError) {
        logger('error', 'UI 自动化执行失败，当前页面截图保存失败', {
          reason: screenshotError instanceof Error ? screenshotError.message : String(screenshotError),
        })
      }
    }
    throw error
  } finally {
    networkObserver.setPhase('结束清理')
    await networkObserver.stop()
    const abortCloseStarted = await stopAbortClose()
    if (!abortCloseStarted) await closePlaywrightHandles({ context, browser }, { logger })
  }
}

export { inspectBusinessResponse, timestampTitle }
