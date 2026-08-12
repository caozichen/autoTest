import { expect, request } from '@playwright/test'

const YES = 1
const NO = 2

function endpoint(path) {
  return path.replace(/^\/+/, '')
}

function timestampTitle(now = Date.now()) {
  return `自动化测试表单-${now}`
}

function buildContactItem({ itemKey, label, sort, typeCode, anchor, sourceType, extraCommonConfig = {} }) {
  return {
    group_code: '',
    type_code: typeCode,
    item_key: itemKey,
    label,
    description: '',
    sort,
    hidden: NO,
    private: NO,
    validation_message: '',
    predefined_value: [],
    placeholder: `请输入${label}`,
    option: [],
    rule_config: { required: { enabled: YES } },
    common_config: {
      source_type: sourceType,
      collect_to_contact: { enabled: YES, anchor },
      ...extraCommonConfig,
    },
  }
}

function dataAt(body, path) {
  return path.split('.').reduce((value, key) => (
    value && typeof value === 'object' ? value[key] : undefined
  ), body)
}

async function responseJson(response, label) {
  let body
  try {
    body = await response.json()
  } catch {
    throw new Error(`${label}响应不是合法 JSON（HTTP ${response.status()}）`)
  }
  return body
}

async function apiCall(api, logger, method, path, options, label) {
  const startedAt = performance.now()
  logger('info', `${label}：${method} /${endpoint(path)}`)
  const response = await api.fetch(endpoint(path), { method, ...options })
  const body = await responseJson(response, label)
  const durationMs = Math.round(performance.now() - startedAt)
  logger(response.ok() ? 'info' : 'error', `${label}响应：HTTP ${response.status()}，业务码 ${String(body?.code)}，耗时 ${durationMs} ms`)
  expect(response.ok(), `${label} HTTP 状态应成功，实际 ${response.status()}`).toBeTruthy()
  expect(body?.code, `${label}业务码应为 0`).toBe(0)
  return body
}

function asList(value) {
  return Array.isArray(value) ? value : []
}

export async function run({ apiBaseUrl, ignoreHTTPSErrors = false, extraHTTPHeaders, logger }) {
  expect(apiBaseUrl, '运行环境必须提供 API 基址').toBeTruthy()
  expect(extraHTTPHeaders?.Authorization, '所有业务请求必须注入登录后的 Token').toBeTruthy()

  const title = timestampTitle()
  const api = await request.newContext({
    baseURL: `${apiBaseUrl.replace(/\/+$/, '')}/`,
    ignoreHTTPSErrors,
    extraHTTPHeaders: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: extraHTTPHeaders.Authorization,
    },
    timeout: 30_000,
  })

  logger('info', `开始执行 API-only Playwright 脚本；未启动浏览器`, { title })
  logger('success', '已注入环境登录 Token（Token 内容已隐藏）')
  if (ignoreHTTPSErrors) logger('info', '当前环境已启用测试证书兼容模式')

  try {
    const categoryBody = await apiCall(api, logger, 'GET', 'be/form/category', undefined, '查询表单分类')
    const categories = asList(categoryBody?.data)
    expect(categories.length, '当前环境至少应存在一个可用表单分类').toBeGreaterThan(0)
    const category = categories[0]
    expect(category?.id, '表单分类必须包含 id').toBeTruthy()
    logger('success', '已选择表单分类', { categoryId: String(category.id), title: String(category.title || '') })

    const createBody = await apiCall(api, logger, 'POST', 'be/form', {
      data: {
        title,
        description: 'Playwright API 自动化创建，用于验证联系人收录和发布流程。',
        category_id: category.id,
      },
    }, '创建表单草稿')
    const formId = createBody?.data?.id
    const formCode = createBody?.data?.form_code
    const revisionNo = Number(createBody?.data?.current_revision_no)
    expect(formId, '创建响应必须返回表单 id').toBeTruthy()
    expect(formCode, '创建响应必须返回 form_code').toBeTruthy()
    expect(revisionNo, '创建响应必须返回有效版本号').toBeGreaterThan(0)
    logger('success', '表单草稿创建成功', { formId: String(formId), formCode: String(formCode), revisionNo })

    const items = [
      buildContactItem({
        itemKey: 'automation_username',
        label: '姓名',
        sort: 1,
        typeCode: 'username',
        anchor: 'username',
        sourceType: 'Input',
        extraCommonConfig: { collect_mode: { default: 'name_zh' } },
      }),
      buildContactItem({
        itemKey: 'automation_mobile',
        label: '手机号',
        sort: 2,
        typeCode: 'mobile',
        anchor: 'mobile',
        sourceType: 'MobileField',
      }),
    ]
    await apiCall(api, logger, 'PUT', `be/form/${formId}/items`, {
      data: { revision_no: revisionNo, title, description: '', items },
    }, '保存表单题目草稿')
    logger('success', '姓名和手机号题目已保存，并开启字段级联系人收录')

    await apiCall(api, logger, 'PUT', `be/form/${formId}/config`, {
      data: {
        revision_no: revisionNo,
        submitted_config: {
          contact_collect_mode: {
            enabled: YES,
            selected: 'ignore',
            default: 'ignore',
          },
        },
      },
    }, '保存联系人收录配置')

    const draftBody = await apiCall(api, logger, 'GET', `be/form/${formId}?draft=1`, undefined, '校验草稿详情')
    const draftForm = draftBody?.data?.form
    const draftItems = asList(draftBody?.data?.items)
    expect(draftForm?.title, '草稿名称应与本次时间戳名称一致').toBe(title)
    expect(draftForm?.status, '发布前表单应保持草稿状态').toBe('draft')
    expect(dataAt(draftForm, 'submitted_config.contact_collect_mode.enabled'), '应开启收录联系人').toBe(YES)
    expect(dataAt(draftForm, 'submitted_config.contact_collect_mode.selected'), '联系人冲突策略应为忽略、不替换').toBe('ignore')
    const expectedItemKeys = new Set(items.map((item) => item.item_key))
    const createdItems = draftItems.filter((item) => expectedItemKeys.has(item?.item_key))
    expect(createdItems, '草稿应保存本次创建的两个联系人题').toHaveLength(2)
    for (const anchor of ['username', 'mobile']) {
      const item = createdItems.find((candidate) => dataAt(candidate, 'common_config.collect_to_contact.anchor') === anchor)
      expect(item, `草稿应包含 ${anchor} 联系人字段`).toBeTruthy()
      expect(dataAt(item, 'common_config.collect_to_contact.enabled'), `${anchor} 字段应开启收录`).toBe(YES)
    }
    logger('success', '草稿断言通过：名称、草稿状态、联系人题和忽略策略均正确', {
      createdItemCount: createdItems.length,
      systemItemCount: draftItems.length - createdItems.length,
    })

    await apiCall(api, logger, 'POST', `be/form/${formId}/publish`, {
      data: { revision_no: revisionNo },
    }, '发布表单')

    const publishedBody = await apiCall(api, logger, 'GET', `be/form/${formId}`, undefined, '校验发布详情')
    expect(publishedBody?.data?.form?.title, '发布后的表单名称应保持一致').toBe(title)
    expect(publishedBody?.data?.form?.status, '发布后的表单状态应为 published').toBe('published')
    expect(dataAt(publishedBody, 'data.form.submitted_config.contact_collect_mode.selected'), '发布版应保留忽略、不替换策略').toBe('ignore')
    logger('success', '发布详情断言通过')

    const query = new URLSearchParams({
      page: '1',
      per_page: '20',
      'filter[status]': 'published',
      'filter[title]': title,
    })
    const listBody = await apiCall(api, logger, 'GET', `be/form/list?${query.toString()}`, undefined, '查询已发布表单列表')
    const records = asList(listBody?.data?.list)
    const record = records.find((candidate) => String(candidate?.id) === String(formId) && candidate?.title === title)
    expect(record, '已发布列表中应按 id 和名称找到本次创建的表单').toBeTruthy()
    expect(record?.status, '列表记录状态应为 published').toBe('published')
    logger('success', '已发布列表断言通过，目标表单可见', { formId: String(formId), title })
    logger('success', '脚本执行完成，所有断言通过')

    return { formId: String(formId), formCode: String(formCode), title, status: 'published' }
  } finally {
    await api.dispose()
  }
}

export { buildContactItem, timestampTitle }
