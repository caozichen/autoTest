import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium, expect } from '@playwright/test'

import {
  closePlaywrightHandles,
  closePlaywrightOnAbort,
  throwIfRunAborted,
} from './playwright-run-control.mjs'

const NAVIGATION_TIMEOUT_MS = 45_000
const ACTION_TIMEOUT_MS = 20_000
const API_PATH_PREFIX = '/api/be/'
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const SCREENSHOT_DIR = resolve(SCRIPT_DIR, '..', 'outputs', 'form-contact-publish')

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
  }, { timeout: ACTION_TIMEOUT_MS })
  await action()
  const response = await responsePromise
  expect(response.ok(), `${label} HTTP 状态应成功，实际 ${response.status()}`).toBeTruthy()
  const body = await response.json().catch(() => null)
  if (body && Object.prototype.hasOwnProperty.call(body, 'code')) {
    expect(body.code, `${label}业务码应为 0`).toBe(0)
  }
  return { response, body }
}

async function screenshotFailure(page, title) {
  await mkdir(SCREENSHOT_DIR, { recursive: true })
  const safeTitle = title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, '_')
  const path = resolve(SCREENSHOT_DIR, `${safeTitle}-失败-${Date.now()}.png`)
  await page.screenshot({ path, fullPage: true }).catch(() => undefined)
  return path
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
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false)
  if (collectDialogVisible) {
    await clickFirstVisible([
      collectDialog.getByRole('button', { name: /确认收录到联系人|確認收錄到聯絡人/ }),
    ], '确认收录到联系人')
  }

  const replaceDialog = page.getByRole('dialog').filter({ hasText: /联系人信息替换确认|聯絡人資訊替換確認/ })
  const replaceDialogVisible = await replaceDialog
    .waitFor({ state: 'visible', timeout: collectDialogVisible ? 5_000 : 1_000 })
    .then(() => true)
    .catch(() => false)
  if (replaceDialogVisible) {
    await replaceDialog.getByText(/忽略，不替换|忽略，不替換/, { exact: true }).click()
    const saveResult = await waitForApiResponse(
      page,
      '/config',
      () => clickFirstVisible([
        replaceDialog.getByRole('button', { name: /确定|確認|OK/i }),
        replaceDialog.locator('button').last(),
      ], '确认忽略不替换'),
      '保存联系人收录策略',
    )
    expect(saveResult.body?.code ?? 0, '联系人收录策略应保存成功').toBe(0)
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
  await page.waitForURL(/\/form-activity\/settings\?[^#]*id=/, { timeout: NAVIGATION_TIMEOUT_MS })
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
  signal,
  logger,
}) {
  expect(siteBaseUrl, '运行环境必须提供 Web 基址').toBeTruthy()
  expect(apiBaseUrl, '运行环境必须提供 API 基址').toBeTruthy()
  const authorization = extraHTTPHeaders?.Authorization
  expect(authorization, '所有业务请求必须使用环境登录后的 Token').toBeTruthy()

  const title = timestampTitle()
  const siteOrigin = new URL(siteBaseUrl).origin
  const apiOrigin = new URL(apiBaseUrl).origin
  expect(siteOrigin, 'Web 基址与 API 基址必须同源').toBe(apiOrigin)

  let browser
  let context
  let page
  let stopAbortClose = () => undefined
  try {
    throwIfRunAborted(signal)
    logger('info', '启动 Chrome 无头浏览器，界面不会显示', { browser: 'Google Chrome', headless: true })
    browser = await chromium.launch({ channel: 'chrome', headless: true })
    stopAbortClose = closePlaywrightOnAbort(signal, () => ({ browser, context }), { logger })
    throwIfRunAborted(signal)
    context = await browser.newContext({
      ignoreHTTPSErrors,
      viewport: { width: 1600, height: 1000 },
      locale: 'zh-CN',
    })
    throwIfRunAborted(signal)
    page = await context.newPage()
    page.setDefaultTimeout(ACTION_TIMEOUT_MS)
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS)

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
    logger('info', '访问表单活动创建页', { path: '/form-activity/index', title })
    await page.goto(pageUrl(siteBaseUrl, '/form-activity/index'), { waitUntil: 'domcontentloaded' })
    await expect(page, 'Token 生效后不应跳转登录页').not.toHaveURL(/\/login(?:[/?#]|$)/)

    const createResponse = await waitForApiResponse(
      page,
      '/be/form',
      () => page.getByText(/从空白表单开始|從空白表單開始/, { exact: true }).click(),
      '通过页面创建空白表单',
    )
    await page.waitForURL(/\/form-activity\/designer\?[^#]*id=/, { timeout: NAVIGATION_TIMEOUT_MS })
    formId = new URL(page.url()).searchParams.get('id') || String(createResponse.body?.data?.id ?? '')
    expect(formId, '创建表单后 URL 或响应中必须包含表单 id').toBeTruthy()
    logger('success', '已通过页面进入表单设计器', { formId })

    const contactPalette = page.locator('button[data-component-type="contactGroup"]')
    await expect(contactPalette, '设计器题型库应显示联系人快捷项').toBeVisible()

    const initialCollectDialog = page.getByRole('dialog').filter({ hasText: /是否收录联系人|是否收錄聯絡人/ })
    const initialDialogVisible = await initialCollectDialog
      .waitFor({ state: 'visible', timeout: 3_000 })
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
    logger('success', '联系人快捷项断言通过：姓名、手机号、邮箱三题均已生成')

    const titleEditor = page.locator('h1 .editable-div[contenteditable="true"]').first()
    await expect(titleEditor, '表单标题编辑区应可见').toBeVisible()
    await titleEditor.fill(title)
    await titleEditor.blur()
    await expect(titleEditor, '表单标题应更新为当前时间戳名称').toHaveText(title)

    logger('info', '点击“保存草稿”')
    const itemSavePromise = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return response.request().method() === 'PUT' && url.pathname.endsWith(`/be/form/${formId}/items`)
    }, { timeout: ACTION_TIMEOUT_MS })
    await page.getByRole('button', { name: /保存草稿|儲存草稿/ }).click()
    const itemSaveResponse = await itemSavePromise
    expect(itemSaveResponse.ok(), `保存草稿 HTTP 状态应成功，实际 ${itemSaveResponse.status()}`).toBeTruthy()
    await expect(page.getByText(/保存成功|儲存成功/).last(), '页面应提示保存成功').toBeVisible()
    logger('success', '表单名称及联系人三题已保存为草稿')

    await ensureIgnoreStrategyInSettings(page, logger)

    logger('info', '点击设置页“发布”按钮')
    const publishPromise = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return response.request().method() === 'POST' && url.pathname.endsWith(`/be/form/${formId}/publish`)
    }, { timeout: ACTION_TIMEOUT_MS })
    await page.getByRole('button', { name: /发布|發佈/, exact: true }).click()
    const publishResponse = await publishPromise
    expect(publishResponse.ok(), `发布 HTTP 状态应成功，实际 ${publishResponse.status()}`).toBeTruthy()
    const publishBody = await publishResponse.json().catch(() => null)
    expect(publishBody?.code ?? 0, '发布业务码应为 0').toBe(0)
    await page.waitForURL(/\/form-activity\/list(?:[/?#]|$)/, { timeout: NAVIGATION_TIMEOUT_MS })
    logger('success', '表单发布成功并已回到列表页')

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
    logger('success', '已发布列表断言通过，目标表单可见', { formId, title })

    expect(tokenViolations, '所有 API 业务请求都必须携带环境 Token').toEqual([])
    expect(authenticatedRequestCount, '至少应观察到一个携带 Token 的业务请求').toBeGreaterThan(0)
    expect(authenticatedRequestCount, '携带 Token 的请求数应等于全部业务请求数').toBe(businessRequestCount)
    logger('success', '浏览器请求 Token 断言通过', {
      businessRequestCount,
      authenticatedRequestCount,
      token: '[REDACTED]',
    })
    logger('success', 'Chrome 无头 UI 自动化执行完成，所有断言通过')

    return {
      formId,
      title,
      status: 'published',
      browser: 'chrome',
      headless: true,
      contactFields: ['username', 'mobile', 'email'],
      authenticatedRequestCount,
    }
  } catch (error) {
    if (signal?.aborted) {
      logger('info', '已响应强制停止，正在清理 Chrome 无头浏览器')
    } else if (page) {
      const screenshotPath = await screenshotFailure(page, title)
      logger('error', 'UI 自动化执行失败，已保存当前页面截图', { screenshotPath })
    }
    throw error
  } finally {
    const abortCloseStarted = await stopAbortClose()
    if (!abortCloseStarted) await closePlaywrightHandles({ context, browser }, { logger })
  }
}

export { timestampTitle }
