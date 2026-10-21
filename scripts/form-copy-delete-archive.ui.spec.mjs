import { observeFormEditTokens } from './support/form-edit-token-observer.mjs'
import { resolveAdminLocale } from './support/admin-locale.mjs'
import { attachNetworkObserver } from './support/api-response-recorder.mjs'
import { expect as flowExpect, scaleTimeout } from './support/environment-timeouts.mjs'
import { launchGoogleChrome } from './support/google-chrome.mjs'
import { expect } from './support/recorded-expect.mjs'
import { clickWhenReady, observeUiReadiness } from './support/ui-readiness.mjs'
import {
  dismissFormOnboarding,
  fetchFormDetail,
  inspectBusinessResponse,
  waitForDesignerBootstrap,
} from './form-all-fields-publish.ui.spec.mjs'
import {
  closePlaywrightHandles,
  closePlaywrightOnAbort,
  throwIfRunAborted,
} from './playwright-run-control.mjs'

const SOURCE_FORM_ID = 'lg2wd5'
const NAVIGATION_TIMEOUT_MS = 45_000
const ACTION_TIMEOUT_MS = 30_000
const IDENTIFIER_PATTERN = /^[a-zA-Z0-9]+$/

function pageUrl(base, path) {
  return new URL(path.replace(/^\/+/, ''), `${base.replace(/\/+$/, '')}/`).toString()
}

function formId(record) {
  return String(record?.id ?? record?.form_id ?? '').trim()
}

function formData(body) {
  return body?.data?.form ?? body?.data ?? {}
}

function copiedId(body) {
  const data = body?.data ?? {}
  return String(data?.form?.id ?? data?.form?.form_id ?? data?.id ?? data?.form_id
    ?? data?.new_form_id ?? '').trim()
}

export function copyTitleFor(sourceTitle, locale = 'zh-CN') {
  return `${sourceTitle} - ${locale === 'zh-HK' ? '複製' : '复制'}`
}

export function identifyNewCopy(records, previousIds, title, sourceId, responseId = '') {
  const matches = records.filter(record => record?.title === title
    && !previousIds.has(formId(record)))
  if (matches.length !== 1) {
    throw new Error(`复制后应恰好新增一条“${title}”表单，实际 ${matches.length} 条`)
  }
  const id = formId(matches[0])
  if (!IDENTIFIER_PATTERN.test(id) || id === sourceId || previousIds.has(id)) {
    throw new Error('复制结果没有可安全操作的新表单 ID')
  }
  if (responseId && responseId !== id) {
    throw new Error(`复制响应 ID ${responseId} 与列表新增 ID ${id} 不一致`)
  }
  return matches[0]
}

function waitForExactResponse(page, method, path) {
  const pending = page.waitForResponse(response => response.request().method() === method
    && new URL(response.url()).pathname.endsWith(path), {
    timeout: scaleTimeout(ACTION_TIMEOUT_MS),
  })
  pending.catch(() => undefined)
  return pending
}

async function businessResponse(response, label) {
  const outcome = await inspectBusinessResponse(response, label)
  flowExpect(response.ok(), `${label} HTTP 必须成功`).toBe(true)
  flowExpect(Number(outcome.body?.code), `${label}业务码必须为 0`).toBe(0)
  return outcome.body
}

async function searchList(page, title, label) {
  const input = page.getByPlaceholder(/请输入标题|請輸入標題/)
  await flowExpect(input, `${label}标题筛选框必须存在`).toHaveCount(1)
  await input.fill(title)
  const responsePromise = page.waitForResponse(response => {
    const url = new URL(response.url())
    return response.request().method() === 'GET'
      && url.pathname.endsWith('/be/form/list')
      && url.searchParams.get('filter[title]') === title
  }, { timeout: scaleTimeout(ACTION_TIMEOUT_MS) })
  await clickWhenReady(page.getByRole('button', { name: /查询|查詢|搜索|搜尋/ }))
  const response = await responsePromise
  const body = await businessResponse(response, `${label}列表查询`)
  expect(Array.isArray(body?.data?.list), `${label}列表响应应包含 data.list`).toBe(true)
  flowExpect(Array.isArray(body?.data?.list), `${label}列表必须返回数组`).toBe(true)
  return body.data.list
}

function rowFor(page, id) {
  if (!IDENTIFIER_PATTERN.test(id)) throw new Error('表单 ID 格式无效，不能定位操作行')
  return page.locator('.arco-table-tr').filter({
    has: page.locator(`.form-activity-list-operation-bar a[href*="id=${id}"]`),
  })
}

async function assertRow(page, record, title, status, label) {
  const row = rowFor(page, formId(record))
  await flowExpect(row, `${label}必须有唯一操作行`).toHaveCount(1)
  await expect(row.locator('.form-activity-list__title-link'), `${label}标题应完全匹配`)
    .toHaveText(title)
  await expect(row, `${label}列表应显示${status === 'draft' ? '草稿' : '已发布'}状态`)
    .toContainText(status === 'draft' ? '草稿' : /已发布|已發[佈布]/)
  return row
}

async function assertMoreMenu(page, row, { archive, remove }, label) {
  await clickWhenReady(row.getByRole('button', { name: /^(更多|更多操作|More)$/ }))
  const menu = page.locator('.form-activity-operation-dropdown:visible')
  await flowExpect(menu, `${label}更多菜单必须唯一展开`).toHaveCount(1)
  const archiveAction = menu.getByText(/归档|歸檔/).last()
  const deleteAction = menu.getByText(/删除|刪除/).last()
  if (archive) await expect(menu, `${label}应有归档操作`).toContainText(/归档|歸檔/)
  else await expect(menu, `${label}不应有归档操作`).not.toContainText(/归档|歸檔/)
  if (remove) await expect(menu, `${label}应有删除操作`).toContainText(/删除|刪除/)
  else await expect(menu, `${label}不应有删除操作`).not.toContainText(/删除|刪除/)
  return { menu, archiveAction, deleteAction }
}

async function copySource(page, sourceRow, sourceId, sourceTitle, previousIds, label, locale) {
  const promise = waitForExactResponse(page, 'POST', `/be/form/${sourceId}/duplicate`)
  await clickWhenReady(sourceRow.getByRole('button', { name: /^(复制|複製)$/ }))
  const body = await businessResponse(await promise, `${label}复制接口`)
  const responseId = copiedId(body)
  const title = copyTitleFor(sourceTitle, locale)
  const records = await searchList(page, title, label)
  const copy = identifyNewCopy(records, previousIds, title, sourceId, responseId)
  const id = formId(copy)
  expect(id, `${label}复制结果 ID 应与源表单不同`).not.toBe(sourceId)
  expect(copy.title, `${label}复制表单名称应追加当前语言的复制后缀`).toBe(title)
  expect(copy.status, `${label}复制后应为草稿`).toBe('draft')
  flowExpect(copy.status, `${label}必须是草稿才能继续`).toBe('draft')
  return { id, record: copy, records }
}

export async function run({
  siteBaseUrl,
  apiBaseUrl,
  variables = {},
  extraHTTPHeaders,
  ignoreHTTPSErrors = false,
  artifactWriter,
  signal,
  logger = () => undefined,
  recordApiResponse,
  recordResourceResponse,
}) {
  if (!siteBaseUrl || !apiBaseUrl) throw new Error('运行环境必须提供 Web 与 API 基址')
  const authorization = extraHTTPHeaders?.Authorization
  if (!authorization) throw new Error('表单复制脚本必须使用环境登录后的 Token')
  if (new URL(siteBaseUrl).origin !== new URL(apiBaseUrl).origin) {
    throw new Error('Web 与 API 基址必须同源')
  }
  const sourceId = String(variables.FORM_ID ?? SOURCE_FORM_ID).trim()
  if (!IDENTIFIER_PATTERN.test(sourceId)) throw new Error('FORM_ID 必须是有效表单 ID')
  const apiOrigin = new URL(apiBaseUrl).origin
  const listUrl = pageUrl(siteBaseUrl, '/form-activity/list')
  const network = { api: [], resources: [] }
  const mutations = new Map()
  const tokenViolations = []
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
      ignoreHTTPSErrors,
      viewport: { width: 1600, height: 1000 },
      locale: resolveAdminLocale(variables),
      timezoneId: 'Asia/Shanghai',
    })
    observer = attachNetworkObserver(context, {
      initialPhase: '打开表单列表',
      onApiResponse: entry => { network.api.push(entry); recordApiResponse?.(entry) },
      onResourceResponse: entry => { network.resources.push(entry); recordResourceResponse?.(entry) },
    })
    await observer.ready
    editTokens = observeFormEditTokens(context, apiBaseUrl)
    page = await context.newPage()
    observeUiReadiness(page)
    page.setDefaultTimeout(scaleTimeout(ACTION_TIMEOUT_MS))
    page.setDefaultNavigationTimeout(scaleTimeout(NAVIGATION_TIMEOUT_MS))
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
    await context.addInitScript(({ token, adminLocale }) => {
      localStorage.setItem('token', token)
      localStorage.setItem('arco-locale', adminLocale)
    }, { token: authorization, adminLocale: resolveAdminLocale(variables) })

    await page.goto(listUrl, { waitUntil: 'domcontentloaded' })
    await expect(page, 'Token 生效后不应跳转登录页').not.toHaveURL(/\/login(?:[/?#]|$)/)
    await dismissFormOnboarding(page)
    const sourceDetail = await fetchFormDetail(page, apiBaseUrl, sourceId, authorization)
    const source = formData(sourceDetail)
    const sourceTitle = String(source.title ?? '').trim()
    flowExpect(formId(source), '源表单详情 ID 必须匹配').toBe(sourceId)
    flowExpect(sourceTitle, '源表单标题不能为空').not.toBe('')
    flowExpect(source.status, '源表单必须已发布').toBe('published')
    expect(source.status, '源表单详情应保持已发布').toBe('published')
    logger('info', '已定位用户指定的源表单', { sourceId, sourceTitle })

    observer.setPhase('检查源表单归档菜单')
    const sourceRecords = await searchList(page, sourceTitle, '源表单')
    const sourceRecord = sourceRecords.find(record => formId(record) === sourceId)
    flowExpect(sourceRecord, '列表接口必须返回源表单').toBeTruthy()
    expect(sourceRecord?.title, '列表源表单标题应与详情一致').toBe(sourceTitle)
    expect(sourceRecord?.status, '列表源表单应为已发布').toBe('published')
    const originalRow = await assertRow(page, sourceRecord, sourceTitle, 'published', '源表单')
    await assertMoreMenu(page, originalRow, { archive: true, remove: false }, '源表单')
    await page.keyboard.press('Escape')

    const copyTitle = copyTitleFor(sourceTitle, resolveAdminLocale(variables))
    const initialCopies = await searchList(page, copyTitle, '复制前同名基线')
    observer.setPhase('首次复制源表单')
    await searchList(page, sourceTitle, '首次复制源表单定位')
    const firstSourceRow = await assertRow(page, sourceRecord, sourceTitle, 'published', '首次复制源表单')
    const first = await copySource(page, firstSourceRow, sourceId, sourceTitle,
      new Set(initialCopies.map(formId)), '第一次', resolveAdminLocale(variables))
    logger('success', '第一次复制已在列表中出现', { firstCopyId: first.id, title: copyTitle })
    const firstRow = await assertRow(page, first.record, copyTitle, 'draft', '第一次复制')

    observer.setPhase('编辑并发布第一次复制')
    await clickWhenReady(firstRow.getByRole('link', { name: /编辑|編輯/ }))
    const editDialog = page.locator('.arco-modal:visible')
    await flowExpect(editDialog, '编辑草稿应打开确认弹窗').toHaveCount(1)
    await expect(editDialog, '编辑草稿确认弹窗应可见').toBeVisible()
    await clickWhenReady(editDialog.getByRole('button', { name: /^(确认|确定|確認)$/ }))
    await page.waitForURL(url => url.pathname === '/form-activity/designer'
      && url.searchParams.get('id') === first.id, { timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS) })
    await waitForDesignerBootstrap(page, logger)
    await expect(page, '设计器必须打开第一次复制的表单')
      .toHaveURL(new RegExp(`/form-activity/designer\\?id=${first.id}(?:[&#]|$)`))
    // 后续对话增加复制表单内部题目与设置校验时，在此处扩展。
    const publishPromise = waitForExactResponse(page, 'POST', `/be/form/${first.id}/publish`)
    await clickWhenReady(page.getByRole('button', { name: /^(发布|發[佈布])$/ }))
    const unsavedDialog = page.locator('.arco-modal:visible')
      .filter({ hasText: /表单未保存|表[單格]未儲存|保存后发布|儲存後發[佈布]/ })
    if (await unsavedDialog.isVisible().catch(() => false)) {
      await expect(unsavedDialog, '设计器未保存时应提示保存后发布').toBeVisible()
      const itemsPromise = waitForExactResponse(page, 'PUT', `/be/form/${first.id}/items`)
      const configPromise = waitForExactResponse(page, 'PUT', `/be/form/${first.id}/config`)
      await clickWhenReady(unsavedDialog.getByRole('button', { name: /保存后发布|儲存後發[佈布]/ }))
      await businessResponse(await itemsPromise, '第一次复制发布前保存题目')
      await businessResponse(await configPromise, '第一次复制发布前保存配置')
    }
    const publishBody = await businessResponse(await publishPromise, '第一次复制发布')
    expect(String(publishBody?.data?.form_id ?? ''), '发布响应表单 ID 应为第一次复制 ID').toBe(first.id)
    expect(publishBody?.data?.status, '发布响应应为已发布').toBe('published')
    await page.waitForURL(/\/form-activity\/list(?:[/?#]|$)/, {
      timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS),
    })
    await dismissFormOnboarding(page)
    const firstPublishedDetail = await fetchFormDetail(page, apiBaseUrl, first.id, authorization)
    expect(formData(firstPublishedDetail).status, '第一次复制详情应已发布').toBe('published')
    const publishedCopies = await searchList(page, copyTitle, '第一次复制发布后')
    const publishedFirst = publishedCopies.find(record => formId(record) === first.id)
    flowExpect(publishedFirst, '发布后的第一次复制必须仍在列表中').toBeTruthy()
    expect(publishedFirst?.status, '列表中的第一次复制应已发布').toBe('published')
    logger('success', '第一次复制已发布', { firstCopyId: first.id })

    observer.setPhase('再次复制源表单')
    await searchList(page, sourceTitle, '第二次复制源表单定位')
    const secondSourceRow = await assertRow(page, sourceRecord, sourceTitle, 'published', '第二次复制源表单')
    const second = await copySource(page, secondSourceRow, sourceId, sourceTitle,
      new Set(publishedCopies.map(formId)), '第二次', resolveAdminLocale(variables))
    flowExpect(second.id, '第二次复制 ID 必须不同于第一次').not.toBe(first.id)
    expect(second.record.title, '两次复制的名称应完全相同').toBe(first.record.title)
    const secondRow = await assertRow(page, second.record, copyTitle, 'draft', '第二次复制')
    const secondMenu = await assertMoreMenu(page, secondRow,
      { archive: false, remove: true }, '第二次复制草稿')
    flowExpect(second.id !== sourceId && second.id !== first.id && second.record.status === 'draft',
      '仅允许删除第二次新建的草稿').toBe(true)

    observer.setPhase('删除第二次复制草稿')
    await clickWhenReady(secondMenu.deleteAction)
    const deleteDialog = page.locator('.arco-modal:visible')
    await flowExpect(deleteDialog, '删除草稿应打开确认弹窗').toHaveCount(1)
    await expect(deleteDialog, '删除草稿确认弹窗应可见').toBeVisible()
    const deletePromise = waitForExactResponse(page, 'DELETE', `/be/form/${second.id}`)
    await clickWhenReady(deleteDialog.getByRole('button', { name: /^(确认|确定|確認)$/ }))
    await businessResponse(await deletePromise, '第二次复制删除')
    const afterDelete = await searchList(page, copyTitle, '删除后同名表单')
    expect(afterDelete.some(record => formId(record) === second.id), '已删除副本不应再出现在列表').toBe(false)
    expect(afterDelete.some(record => formId(record) === first.id && record.status === 'published'),
      '第一次已发布副本应保留').toBe(true)
    const sourceAfter = await searchList(page, sourceTitle, '删除后源表单')
    expect(sourceAfter.some(record => formId(record) === sourceId && record.status === 'published'),
      '源表单应保留且继续已发布').toBe(true)
    for (const [method, path] of [
      ['POST', `/api/be/form/${sourceId}/duplicate`],
      ['POST', `/api/be/form/${first.id}/publish`],
      ['DELETE', `/api/be/form/${second.id}`],
    ]) {
      const expectedCount = method === 'POST' && path.endsWith('/duplicate') ? 2 : 1
      expect(mutations.get(`${method} ${path}`), `${method} ${path} 应恰好请求 ${expectedCount} 次`)
        .toBe(expectedCount)
    }
    expect(tokenViolations, '所有后台业务请求都应携带环境 Token').toEqual([])
    await observer.waitForIdle({ timeoutMs: scaleTimeout(5_000), signal })
    expect(network.api.length, '应采集到后台接口证据').toBeGreaterThan(0)
    expect(network.resources.length, '应采集到静态资源证据').toBeGreaterThan(0)
    await editTokens.assert()
    logger('success', '表单复制、发布、再次复制及删除流程完成', {
      sourceId, firstCopyId: first.id, deletedCopyId: second.id,
    })
    return {
      sourceId,
      sourceTitle,
      firstCopyId: first.id,
      deletedCopyId: second.id,
      copyTitle,
      firstCopyStatus: 'published',
      secondCopyStatus: 'deleted',
      browser: 'chrome',
      headless: true,
      apiResponseCount: network.api.length,
      resourceResponseCount: network.resources.length,
    }
  } catch (error) {
    if (!signal?.aborted && page && artifactWriter?.captureScreenshot) {
      try {
        const screenshot = await artifactWriter.captureScreenshot(page,
          `screenshots/表单复制-删除归档-失败-${Date.now()}.png`, { fullPage: true })
        logger('error', '表单复制流程失败，已保存截图', { artifact: screenshot })
      } catch (screenshotError) {
        logger('error', '表单复制流程失败，截图保存失败', {
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
