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
const FORM_TYPE_TEXT = '表格'
const TEMPLATE_REMARK = '自动化测试：源表单保存的系统模板，验证备注、排序与编辑。'
const NAME_MARKER = ' - 已修改'

function pageUrl(base, path) {
  return new URL(path.replace(/^\/+/, ''), `${base.replace(/\/+$/, '')}/`).toString()
}

function recordId(record) {
  return String(record?.id ?? record?.form_id ?? '').trim()
}

function formData(body) {
  return body?.data?.form ?? body?.data ?? {}
}

function templateId(body) {
  const data = body?.data ?? {}
  return String(data?.template?.id ?? data?.template_id ?? data?.id ?? '').trim()
}

function isSystemTemplate(record) {
  return record?.is_system === true || record?.is_system === 1 || record?.is_system === '1'
}

export function identifyCreatedTemplate(records, previousIds, name, sourceId, responseId = '') {
  const matches = records.filter(record => record?.name === name
    && !previousIds.has(recordId(record)))
  if (matches.length !== 1) {
    throw new Error(`存为模板后应恰好新增一条“${name}”模板，实际 ${matches.length} 条`)
  }
  const template = matches[0]
  const id = recordId(template)
  if (!IDENTIFIER_PATTERN.test(id) || isSystemTemplate(template)) {
    throw new Error('新增模板没有可安全操作的机构模板 ID')
  }
  if (String(template.form_id ?? '').trim() === sourceId) {
    throw new Error('模板编辑草稿不应直接指向源表单')
  }
  if (responseId && responseId !== id) {
    throw new Error(`创建响应 ID ${responseId} 与列表新增 ID ${id} 不一致`)
  }
  return template
}

function movableTemplates(records) {
  return records.filter(record => !isSystemTemplate(record))
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

async function clickForBusinessResponse(page, locator, method, path, label) {
  const [response] = await Promise.all([
    waitForExactResponse(page, method, path),
    clickWhenReady(locator),
  ])
  return businessResponse(response, label)
}

function requestJson(response, label) {
  try {
    return response.request().postDataJSON()
  } catch {
    expect(false, `${label}请求体应为有效 JSON`).toBe(true)
    return {}
  }
}

async function fetchTemplates(page, apiBaseUrl, authorization, label) {
  const url = pageUrl(apiBaseUrl, '/be/form/template')
  const result = await page.evaluate(async ({ url: endpoint, token }) => {
    try {
      const response = await fetch(endpoint, { headers: { Authorization: token } })
      return { ok: response.ok, status: response.status, body: await response.json().catch(() => null) }
    } catch (error) {
      return { ok: false, status: 0, body: null, error: String(error) }
    }
  }, { url, token: authorization })
  expect(result.ok, `${label}列表 HTTP 应成功，实际 ${result.status}`).toBe(true)
  flowExpect(result.ok, `${label}列表接口必须可用`).toBe(true)
  expect(Number(result.body?.code), `${label}列表业务码应为 0`).toBe(0)
  flowExpect(Number(result.body?.code), `${label}列表业务码必须为 0`).toBe(0)
  expect(Array.isArray(result.body?.data?.list), `${label}应包含 data.list`).toBe(true)
  flowExpect(Array.isArray(result.body?.data?.list), `${label}列表必须返回数组`).toBe(true)
  return result.body.data.list
}

async function assertTemplateRow(page, records, template, name, remark, label) {
  const index = records.findIndex(record => recordId(record) === recordId(template))
  flowExpect(index, `${label}模板必须在接口列表中`).toBeGreaterThanOrEqual(0)
  await page.locator('.system-template__table').evaluate((root, fraction) => {
    const scrollable = [...root.querySelectorAll('*')]
      .find(element => element.scrollHeight > element.clientHeight + 5
        && ['auto', 'scroll'].includes(getComputedStyle(element).overflowY))
    if (scrollable) scrollable.scrollTop = fraction * (scrollable.scrollHeight - scrollable.clientHeight)
  }, records.length < 2 ? 0 : index / (records.length - 1))
  const matchingRows = page.locator('.system-template__table .arco-table-tr')
    .filter({ has: page.getByText(name, { exact: true }) })
  const row = index < records.length / 2 ? matchingRows.first() : matchingRows.last()
  await flowExpect(row, `${label}页面操作行必须存在`).toBeVisible()
  await expect(row.locator('.system-template__name-text'), `${label}页面名称应与接口一致`).toHaveText(name)
  await expect(row, `${label}页面类型描述应为${FORM_TYPE_TEXT}`).toContainText(FORM_TYPE_TEXT)
  if (remark) await expect(row.locator('.system-template__remark-text'), `${label}备注应可见`).toHaveText(remark)
  return row
}

async function openTemplateTab(page, apiBaseUrl, authorization) {
  await clickWhenReady(page.getByRole('button', { name: /基础设置|基礎設定|基本設定/ }))
  const modal = page.locator('.form-activity-base-settings-modal:visible')
  await flowExpect(modal, '基础设置弹窗必须打开').toHaveCount(1)
  const templateTab = modal.locator('.arco-tabs-tab').filter({ hasText: /系统模板管理|系統範本管理/ })
  await flowExpect(templateTab, '系统模板管理页签必须唯一').toHaveCount(1)
  await clickWhenReady(templateTab)
  await flowExpect(modal.locator('.system-template__table'), '系统模板表格必须出现').toBeVisible()
  return fetchTemplates(page, apiBaseUrl, authorization, '系统模板管理列表')
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
  if (!authorization) throw new Error('存为模板脚本必须使用环境登录后的 Token')
  if (new URL(siteBaseUrl).origin !== new URL(apiBaseUrl).origin) {
    throw new Error('Web 与 API 基址必须同源')
  }
  const sourceId = String(variables.FORM_ID ?? SOURCE_FORM_ID).trim()
  if (!IDENTIFIER_PATTERN.test(sourceId)) throw new Error('FORM_ID 必须是有效表单 ID')
  const apiOrigin = new URL(apiBaseUrl).origin
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

    await page.goto(pageUrl(siteBaseUrl, '/form-activity/list'), { waitUntil: 'domcontentloaded' })
    await expect(page, 'Token 生效后不应跳转登录页').not.toHaveURL(/\/login(?:[/?#]|$)/)
    await dismissFormOnboarding(page)
    const sourceDetail = await fetchFormDetail(page, apiBaseUrl, sourceId, authorization)
    const source = formData(sourceDetail)
    const sourceTitle = String(source.title ?? '').trim()
    flowExpect(recordId(source), '源表单详情 ID 必须匹配').toBe(sourceId)
    flowExpect(sourceTitle, '源表单标题不能为空').not.toBe('')
    expect(source.status, '源表单应保持已发布').toBe('published')
    flowExpect(source.status, '只能从已发布源表单创建模板').toBe('published')
    const initialTemplates = await fetchTemplates(page, apiBaseUrl, authorization, '创建前基线')
    const previousIds = new Set(initialTemplates.map(recordId))

    observer.setPhase('定位源表单并存为模板')
    const searchInput = page.getByPlaceholder(/请输入标题|請輸入標題/)
    await flowExpect(searchInput, '标题筛选框必须存在').toHaveCount(1)
    await searchInput.fill(sourceTitle)
    const sourceListPromise = page.waitForResponse(response => {
      const url = new URL(response.url())
      return response.request().method() === 'GET'
        && url.pathname.endsWith('/be/form/list')
        && url.searchParams.get('filter[title]') === sourceTitle
    }, { timeout: scaleTimeout(ACTION_TIMEOUT_MS) })
    await clickWhenReady(page.getByRole('button', { name: /查询|查詢|搜索|搜尋/ }))
    const sourceListBody = await businessResponse(await sourceListPromise, '源表单列表查询')
    expect(Array.isArray(sourceListBody?.data?.list), '源表单列表应包含 data.list').toBe(true)
    flowExpect(Array.isArray(sourceListBody?.data?.list), '源表单列表必须返回数组').toBe(true)
    const sourceRecord = sourceListBody.data.list.find(record => recordId(record) === sourceId)
    flowExpect(sourceRecord, '列表必须包含指定源表单').toBeTruthy()
    expect(sourceRecord.title, '列表源表单名称应与详情一致').toBe(sourceTitle)
    const sourceRow = page.locator('.arco-table-tr').filter({
      has: page.locator(`.form-activity-list-operation-bar a[href*="id=${sourceId}"]`),
    })
    await flowExpect(sourceRow, '源表单操作行必须唯一').toHaveCount(1)
    await expect(sourceRow.locator('.form-activity-list__title-link'), '源表单页面标题应正确')
      .toHaveText(sourceTitle)
    await clickWhenReady(sourceRow.getByRole('button', { name: /^(更多|更多操作|More)$/ }))
    const menu = page.locator('.form-activity-operation-dropdown:visible')
    await flowExpect(menu, '更多操作菜单必须展开').toHaveCount(1)
    await expect(menu, '更多菜单应有存为模板').toContainText(/存为模板|存為範本|儲存為範本/)
    await clickWhenReady(menu.getByText(/存为模板|存為範本|儲存為範本/).last())
    const saveModal = page.locator('.form-save-as-template-modal:visible')
    await flowExpect(saveModal, '存为模板弹窗必须打开').toHaveCount(1)
    const nameInput = saveModal.locator('#form-save-as-template-name')
    await expect(nameInput, '模板名称应默认继承源表单名称').toHaveValue(sourceTitle)
    await expect(saveModal.locator('#form-save-as-template-remark'), '创建时备注应为空').toHaveValue('')
    const createPromise = waitForExactResponse(page, 'POST', `/be/form/${sourceId}/template`)
    await clickWhenReady(saveModal.getByRole('button', { name: /^(确认保存|確認儲存|确认储存)$/ }))
    const createResponse = await createPromise
    const createBody = await businessResponse(createResponse, '源表单存为模板')
    expect(requestJson(createResponse, '创建模板'), '创建请求名称和备注应与弹窗一致')
      .toEqual({ name: sourceTitle, remark: '' })
    await flowExpect(saveModal, '创建成功后弹窗应关闭').toHaveCount(0)

    observer.setPhase('核对系统模板类型、名称和初始位置')
    const listedTemplates = await openTemplateTab(page, apiBaseUrl, authorization)
    const template = identifyCreatedTemplate(listedTemplates, previousIds,
      sourceTitle, sourceId, templateId(createBody))
    const id = recordId(template)
    const designerId = String(template.form_id ?? '').trim()
    flowExpect(IDENTIFIER_PATTERN.test(designerId), '模板必须有独立的可编辑草稿 ID').toBe(true)
    expect(template.type, '源表单保存的模板类型应为表单').toBe('form')
    expect(template.type_text, '模板类型文案应为表格').toBe(FORM_TYPE_TEXT)
    expect(template.name, '新模板名称应与源表单一致').toBe(sourceTitle)
    expect(template.remark ?? '', '新模板备注初始应为空').toBe('')
    expect(movableTemplates(listedTemplates).some(record => recordId(record) === id),
      '新模板应进入机构自建模板列表').toBe(true)
    let row = await assertTemplateRow(page, listedTemplates, template, sourceTitle, '', '新模板')
    logger('success', '源表单已存为系统模板', { sourceId, templateId: id, designerId })

    observer.setPhase('修改模板备注')
    await clickWhenReady(row.locator('.system-template__remark-readonly')
      .getByRole('button', { name: /编辑|編輯/ }))
    const remarkInput = row.locator('input[name="template_remark"]')
    await flowExpect(remarkInput, '备注输入框必须打开').toBeVisible()
    await remarkInput.fill(TEMPLATE_REMARK)
    const remarkPromise = waitForExactResponse(page, 'PUT', `/be/form/template/${id}/remark`)
    await clickWhenReady(row.locator('.system-template__remark-input')
      .getByRole('button', { name: /保存|儲存/ }))
    const remarkResponse = await remarkPromise
    const remarkBody = await businessResponse(remarkResponse, '保存模板备注')
    expect(requestJson(remarkResponse, '保存备注'), '备注请求应仅提交指定文案')
      .toEqual({ remark: TEMPLATE_REMARK })
    if (remarkBody?.data?.remark !== undefined) {
      expect(remarkBody.data.remark, '备注响应应回写指定文案').toBe(TEMPLATE_REMARK)
    }
    await expect(row.locator('.system-template__remark-text'), '页面备注应更新').toHaveText(TEMPLATE_REMARK)
    let records = await fetchTemplates(page, apiBaseUrl, authorization, '保存备注后')
    expect(records.find(record => recordId(record) === id)?.remark, '列表备注应持久化')
      .toBe(TEMPLATE_REMARK)

    observer.setPhase('模板置底及置顶')
    flowExpect(movableTemplates(records).length, '置顶置底需要至少两条机构自建模板')
      .toBeGreaterThan(1)
    row = await assertTemplateRow(page, records, template, sourceTitle, TEMPLATE_REMARK, '排序前')
    expect(movableTemplates(records).at(-1)?.id, '新建模板初始应位于机构自建模板末尾').toBe(id)
    await expect(row.locator('.system-template__actions').getByRole('button', { name: /置底/ }),
      '处于末尾时置底操作应禁用').toBeDisabled()
    for (const [operation, expectedPosition] of [
      ['top', 'first'],
      ['bottom', 'last'],
      ['top', 'first'],
    ]) {
      const label = operation === 'top' ? '置顶' : '置底'
      const labelPattern = operation === 'top' ? /置顶|置頂/ : /置底/
      await clickForBusinessResponse(page,
        row.locator('.system-template__actions').getByRole('button', { name: labelPattern }),
        'PUT', `/be/form/template/${id}/${operation}`, `模板${label}`)
      records = await fetchTemplates(page, apiBaseUrl, authorization, `${label}后`)
      const movable = movableTemplates(records)
      const actualId = expectedPosition === 'first' ? movable[0]?.id : movable.at(-1)?.id
      expect(actualId, `模板${label}后应位于机构自建模板${expectedPosition === 'first' ? '首位' : '末位'}`)
        .toBe(id)
      row = await assertTemplateRow(page, records, template, sourceTitle, TEMPLATE_REMARK,
        `${label}后`)
    }

    observer.setPhase('编辑模板名称并保存')
    await clickWhenReady(row.locator('.system-template__actions').getByRole('link', { name: /编辑|編輯/ }))
    await page.waitForURL(url => url.pathname === '/form-activity/designer'
      && url.searchParams.get('id') === designerId, {
      timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS),
    })
    await waitForDesignerBootstrap(page, logger)
    await expect(page, '编辑应打开新模板独立草稿')
      .toHaveURL(new RegExp(`/form-activity/designer\\?id=${designerId}(?:[&#]|$)`))
    // 后续增加模板题目和设置的内容校验时，在此处扩展。
    const modifiedName = `${sourceTitle}${NAME_MARKER}`
    const titleEditor = page.locator('h1 .editable-div[contenteditable="true"]').first()
    await flowExpect(titleEditor, '模板标题编辑区必须可见').toBeVisible()
    await expect(titleEditor, '模板原始标题应与列表名称一致').toHaveText(sourceTitle)
    await titleEditor.fill(modifiedName)
    await titleEditor.blur()
    await expect(titleEditor, '模板标题应增加修改标识').toHaveText(modifiedName)
    const itemsPromise = waitForExactResponse(page, 'PUT', `/be/form/${designerId}/items`)
    const configPromise = waitForExactResponse(page, 'PUT', `/be/form/${designerId}/config`)
    await clickWhenReady(page.getByRole('button', { name: /^(保存|儲存)$/ }))
    const [itemsResponse, configResponse] = await Promise.all([itemsPromise, configPromise])
    await businessResponse(itemsResponse, '保存模板题目及名称')
    await businessResponse(configResponse, '保存模板配置')
    expect(requestJson(itemsResponse, '保存模板题目').title, '题目保存请求应包含新名称')
      .toBe(modifiedName)
    await expect(page.getByText(/保存成功|儲存成功/).last(), '设计器应提示保存成功').toBeVisible()
    const editedDetail = formData(await fetchFormDetail(page, apiBaseUrl, designerId, authorization))
    expect(editedDetail.title, '模板草稿详情应保存新名称').toBe(modifiedName)

    observer.setPhase('返回系统模板管理并核对名称')
    await clickWhenReady(page.locator('.designer-back-btn'))
    await page.waitForURL(/\/form-activity\/list(?:[/?#]|$)/, {
      timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS),
    })
    await dismissFormOnboarding(page)
    records = await openTemplateTab(page, apiBaseUrl, authorization)
    const renamed = records.find(record => recordId(record) === id)
    flowExpect(renamed, '返回后必须找到同一模板 ID').toBeTruthy()
    expect(renamed.name, '系统模板列表名称应完成修改').toBe(modifiedName)
    expect(renamed.form_id, '修改后模板草稿 ID 不应变化').toBe(designerId)
    expect(renamed.type, '修改后模板类型应保持表单').toBe('form')
    expect(renamed.remark, '修改后模板备注应保留').toBe(TEMPLATE_REMARK)
    await assertTemplateRow(page, records, renamed, modifiedName, TEMPLATE_REMARK, '返回后')
    await clickWhenReady(page.locator('.form-activity-base-settings-modal:visible .arco-modal-close-btn'))
    await flowExpect(page.locator('.form-activity-base-settings-modal:visible'),
      '返回后应关闭基础设置弹窗').toHaveCount(0)

    observer.setPhase('创建表单问卷并核对模板选择区')
    await clickWhenReady(page.locator('.form-activity-create-trigger'))
    const createMenu = page.locator('.form-activity-create-dropdown:visible')
    await flowExpect(createMenu, '创建菜单必须展开').toHaveCount(1)
    await clickWhenReady(createMenu.getByText(/表单问卷|表格問卷|表單問卷/))
    await page.waitForURL(url => url.pathname === '/form-activity/index'
      && url.searchParams.get('type') === 'form', {
      timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS),
    })
    const templateSection = page.locator('.form-template-create-section')
    await flowExpect(templateSection, '选择模板创建区域必须可见').toBeVisible()
    const templateSearch = templateSection.locator('input[name="form-template-search"]')
    await flowExpect(templateSearch, '模板名称搜索框必须可见').toBeVisible()
    const templateSearchPromise = page.waitForResponse(response => {
      const url = new URL(response.url())
      return response.request().method() === 'GET'
        && url.pathname.endsWith('/be/form/template')
        && url.searchParams.get('keyword') === modifiedName
    }, { timeout: scaleTimeout(ACTION_TIMEOUT_MS) })
    await templateSearch.fill(modifiedName)
    const templateSearchBody = await businessResponse(await templateSearchPromise, '选择模板创建区搜索')
    expect(Array.isArray(templateSearchBody?.data?.list), '模板搜索响应应包含 data.list').toBe(true)
    flowExpect(Array.isArray(templateSearchBody?.data?.list), '模板搜索必须返回数组').toBe(true)
    const matchingTemplates = templateSearchBody.data.list
    const selected = matchingTemplates.find(record => recordId(record) === id)
    flowExpect(selected, '选择区接口必须返回刚才修改的模板 ID').toBeTruthy()
    expect(selected.name, '选择区模板名称应为修改后名称').toBe(modifiedName)
    expect(selected.type, '选择区模板类型应为表单').toBe('form')
    expect(selected.type_text, '选择区模板类型描述应为表格').toBe(FORM_TYPE_TEXT)
    expect(selected.remark, '选择区模板备注应正确').toBe(TEMPLATE_REMARK)
    const sortedMatches = [
      ...matchingTemplates.filter(isSystemTemplate),
      ...matchingTemplates.filter(record => !isSystemTemplate(record)),
    ]
    const cardIndex = sortedMatches.findIndex(record => recordId(record) === id)
    flowExpect(cardIndex, '选择区模板必须有确定的位置').toBeGreaterThanOrEqual(0)
    const card = templateSection.locator('.form-template-card').nth(cardIndex)
    await flowExpect(card, '刚才修改的模板卡片必须出现').toBeVisible()
    await expect(card.locator('.form-template-card__title'), '模板卡片名称应正确')
      .toHaveText(modifiedName)
    await expect(card.locator('.form-template-card__remark'), '模板卡片备注应正确')
      .toHaveText(TEMPLATE_REMARK)
    await expect(card.locator('.form-template-card__type-tag'), '模板卡片类型描述应正确')
      .toHaveText(FORM_TYPE_TEXT)

    observer.setPhase('根据指定模板创建表单问卷')
    const createFormPromise = waitForExactResponse(page, 'POST', `/be/form/template/${id}/create-form`)
    await clickWhenReady(card)
    const createFormResponse = await createFormPromise
    const createFormBody = await businessResponse(createFormResponse, '根据模板创建表单')
    const createdFormId = String(createFormBody?.data?.id ?? '').trim()
    flowExpect(IDENTIFIER_PATTERN.test(createdFormId), '创建响应必须包含有效的新表单 ID')
      .toBe(true)
    flowExpect(createdFormId !== sourceId && createdFormId !== designerId,
      '根据模板创建的表单必须独立于源表单和模板草稿').toBe(true)
    await page.waitForURL(url => url.pathname === '/form-activity/designer'
      && url.searchParams.get('id') === createdFormId, {
      timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS),
    })
    await waitForDesignerBootstrap(page, logger)
    await expect(page.locator('h1 .editable-div[contenteditable="true"]').first(),
      '新表单标题应继承修改后的模板名称').toHaveText(modifiedName)
    // 后续增加模板生成表单的题目和配置内容校验时，在此处扩展。
    const createdDetail = formData(await fetchFormDetail(page, apiBaseUrl,
      createdFormId, authorization))
    expect(recordId(createdDetail), '新表单详情 ID 应与创建响应一致').toBe(createdFormId)
    expect(createdDetail.title, '新表单详情名称应继承模板').toBe(modifiedName)
    expect(createdDetail.status, '模板新建表单应先处于草稿状态').toBe('draft')

    observer.setPhase('发布模板生成的表单')
    const publishButton = page.getByRole('button', { name: /^(发布|發[佈布])$/ })
    await flowExpect(publishButton, '模板新建表单必须允许直接发布').toBeVisible()
    const publishPromise = waitForExactResponse(page, 'POST', `/be/form/${createdFormId}/publish`)
    await clickWhenReady(publishButton)
    const unsavedDialog = page.locator('.arco-modal:visible')
      .filter({ hasText: /表单未保存|表[單格]未儲存|保存后发布|儲存後發[佈布]/ })
    if (await unsavedDialog.isVisible().catch(() => false)) {
      await expect(unsavedDialog, '未保存时应提示先保存再发布').toBeVisible()
      const itemsPromise = waitForExactResponse(page, 'PUT', `/be/form/${createdFormId}/items`)
      const configPromise = waitForExactResponse(page, 'PUT', `/be/form/${createdFormId}/config`)
      await clickWhenReady(unsavedDialog.getByRole('button', { name: /保存后发布|儲存後發[佈布]/ }))
      const itemsResponse = await itemsPromise
      await businessResponse(itemsResponse, '发布前保存模板表单题目')
      await businessResponse(await configPromise, '发布前保存模板表单配置')
      expect(requestJson(itemsResponse, '发布前保存题目').title,
        '发布前保存的标题应继承模板').toBe(modifiedName)
    }
    const publishBody = await businessResponse(await publishPromise, '发布模板生成的表单')
    expect(String(publishBody?.data?.form_id ?? ''), '发布响应应指向模板新建表单')
      .toBe(createdFormId)
    expect(publishBody?.data?.status, '发布响应状态应为已发布').toBe('published')
    await page.waitForURL(/\/form-activity\/list(?:[/?#]|$)/, {
      timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS),
    })
    await dismissFormOnboarding(page)
    const publishedDetail = formData(await fetchFormDetail(page, apiBaseUrl,
      createdFormId, authorization))
    expect(publishedDetail.title, '发布后表单详情名称应正确').toBe(modifiedName)
    expect(publishedDetail.status, '发布后表单详情应为已发布').toBe('published')
    const publishedSearch = page.getByPlaceholder(/请输入标题|請輸入標題/)
    await flowExpect(publishedSearch, '已发布列表标题筛选框必须存在').toHaveCount(1)
    await publishedSearch.fill(modifiedName)
    const publishedListPromise = page.waitForResponse(response => {
      const url = new URL(response.url())
      return response.request().method() === 'GET'
        && url.pathname.endsWith('/be/form/list')
        && url.searchParams.get('filter[title]') === modifiedName
    }, { timeout: scaleTimeout(ACTION_TIMEOUT_MS) })
    await clickWhenReady(page.getByRole('button', { name: /查询|查詢|搜索|搜尋/ }))
    const publishedListBody = await businessResponse(await publishedListPromise, '模板生成表单发布后列表')
    expect(Array.isArray(publishedListBody?.data?.list), '发布后列表应包含 data.list').toBe(true)
    flowExpect(Array.isArray(publishedListBody?.data?.list), '发布后列表必须返回数组').toBe(true)
    const publishedRecord = publishedListBody.data.list.find(record => recordId(record) === createdFormId)
    flowExpect(publishedRecord, '发布后列表必须包含模板生成的表单').toBeTruthy()
    expect(publishedRecord.title, '发布后列表名称应继承修改后的模板').toBe(modifiedName)
    expect(publishedRecord.status, '发布后列表状态应为已发布').toBe('published')
    const publishedRow = page.locator('.arco-table-tr').filter({
      has: page.locator(`.form-activity-list-operation-bar a[href*="id=${createdFormId}"]`),
    })
    await flowExpect(publishedRow, '模板生成的已发布表单操作行必须唯一').toHaveCount(1)
    await expect(publishedRow.locator('.form-activity-list__title-link'),
      '页面列表应显示模板生成的表单').toHaveText(modifiedName)
    await expect(publishedRow, '页面列表应显示已发布状态').toContainText(/已发布|已發[佈布]/)

    observer.setPhase('删除本次创建的模板')
    const beforeDelete = await openTemplateTab(page, apiBaseUrl, authorization)
    const deleteTarget = beforeDelete.find(record => recordId(record) === id)
    flowExpect(deleteTarget, '删除前必须找到本次创建的模板 ID').toBeTruthy()
    flowExpect(!isSystemTemplate(deleteTarget), '只允许删除本次创建的机构模板').toBe(true)
    flowExpect(String(deleteTarget.form_id ?? '').trim(), '删除目标必须是本次模板草稿')
      .toBe(designerId)
    expect(deleteTarget.name, '删除目标名称应为本次修改后的名称').toBe(modifiedName)
    expect(deleteTarget.remark, '删除目标备注应保持不变').toBe(TEMPLATE_REMARK)
    const deleteRow = await assertTemplateRow(page, beforeDelete, deleteTarget,
      modifiedName, TEMPLATE_REMARK, '待删除模板')
    const deleteAction = deleteRow.locator('.system-template__actions')
      .getByRole('button', { name: /删除|刪除/ })
    await flowExpect(deleteAction, '本次创建的模板必须可删除').toBeEnabled()
    await clickWhenReady(deleteAction)
    const deleteDialog = page.locator('.arco-modal:visible')
      .filter({ hasText: /确定移除模板|確定移除(?:模板|範本)/ })
    await flowExpect(deleteDialog, '模板删除确认弹窗必须唯一').toHaveCount(1)
    await expect(deleteDialog, '删除确认应明确指向本次模板名称').toContainText(modifiedName)
    const [deleteResponse] = await Promise.all([
      waitForExactResponse(page, 'DELETE', `/be/form/template/${id}`),
      clickWhenReady(deleteDialog.getByRole('button', { name: /^(确认|确定|確認)$/ })),
    ])
    await businessResponse(deleteResponse, '删除本次创建的模板')
    records = await fetchTemplates(page, apiBaseUrl, authorization, '删除模板后')
    expect(records.length, '删除后模板总数应减少一条').toBe(beforeDelete.length - 1)
    expect(records.some(record => recordId(record) === id), '删除后列表不应再有本次模板 ID')
      .toBe(false)
    await expect(page.locator('.form-activity-base-settings-modal:visible .system-template__total'),
      '系统模板管理总数应减少一条').toContainText(new RegExp(`共 ${records.length} (?:个模板|個範本)`))
    const formAfterTemplateDeletion = formData(await fetchFormDetail(page, apiBaseUrl,
      createdFormId, authorization))
    expect(formAfterTemplateDeletion.title, '删除模板后已发布表单名称应保留').toBe(modifiedName)
    expect(formAfterTemplateDeletion.status, '删除模板后已发布表单应保留').toBe('published')

    for (const [method, path] of [
      ['POST', `/api/be/form/${sourceId}/template`],
      ['PUT', `/api/be/form/template/${id}/remark`],
      ['PUT', `/api/be/form/template/${id}/bottom`],
      ['PUT', `/api/be/form/template/${id}/top`],
      ['PUT', `/api/be/form/${designerId}/items`],
      ['PUT', `/api/be/form/${designerId}/config`],
      ['POST', `/api/be/form/template/${id}/create-form`],
      ['POST', `/api/be/form/${createdFormId}/publish`],
      ['DELETE', `/api/be/form/template/${id}`],
    ]) {
      const expectedCount = path === `/api/be/form/template/${id}/top` ? 2 : 1
      expect(mutations.get(`${method} ${path}`), `${method} ${path} 应恰好请求 ${expectedCount} 次`)
        .toBe(expectedCount)
    }
    expect(tokenViolations, '所有后台业务请求都应携带环境 Token').toEqual([])
    await observer.waitForIdle({ timeoutMs: scaleTimeout(5_000), signal })
    expect(network.api.length, '应采集到后台接口证据').toBeGreaterThan(0)
    expect(network.resources.length, '应采集到静态资源证据').toBeGreaterThan(0)
    await editTokens.assert()
    logger('success', '模板创建、备注、排序、改名、新表单发布及模板删除校验完成', {
      sourceId, templateId: id, designerId, modifiedName, createdFormId,
    })
    return {
      sourceId,
      sourceTitle,
      templateId: id,
      deletedTemplateId: id,
      templateStatus: 'deleted',
      designerId,
      templateName: modifiedName,
      templateRemark: TEMPLATE_REMARK,
      createdFormId,
      createdFormStatus: 'published',
      browser: 'chrome',
      headless: true,
      apiResponseCount: network.api.length,
      resourceResponseCount: network.resources.length,
    }
  } catch (error) {
    if (!signal?.aborted && page && artifactWriter?.captureScreenshot) {
      try {
        const screenshot = await artifactWriter.captureScreenshot(page,
          `screenshots/表单存为模板-失败-${Date.now()}.png`, { fullPage: true })
        logger('error', '模板流程失败，已保存截图', { artifact: screenshot })
      } catch (screenshotError) {
        logger('error', '模板流程失败，截图保存失败', {
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
