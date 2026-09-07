import { expect as flowExpect } from '@playwright/test'

import { expect } from './support/recorded-expect.mjs'
import { attachNetworkObserver } from './support/api-response-recorder.mjs'
import { launchGoogleChrome } from './support/google-chrome.mjs'
import {
  FIELD_TYPE_CODES,
  pageFieldKeysFor,
  parseFormLinkContract,
  resolveFormFieldKeys,
} from './support/form-link-contract.mjs'

import {
  closePlaywrightHandles,
  closePlaywrightOnAbort,
  throwIfRunAborted,
} from './playwright-run-control.mjs'
import {
  CASCADER_LEVEL_VALUES,
  DESCRIPTION_FIELD_CONTENT,
  DESCRIPTION_FIELD_TITLE,
  DIVIDER_TEXT,
  FORM_CONTENT_HEADING,
  FORM_CONTENT_ITEMS,
  FORM_SUBTITLE,
} from './form-all-fields-publish.ui.spec.mjs'

const FORM_ID = 'lpXAVN'
const FORM_PATH = `/form/?id=${FORM_ID}`
const EXPECTED_FORM_TITLE = '自动化测试全题型表单-1787048650389'
const NAVIGATION_TIMEOUT_MS = 45_000
const ACTION_TIMEOUT_MS = 30_000
const SELECT_MAX_ATTEMPTS = 3
const SELECT_VISIBILITY_TIMEOUT_MS = 3_000
const SELECT_COMMIT_TIMEOUT_MS = 1_500
const ADDRESS_OPTION_ALIASES = Object.freeze({
  province: Object.freeze(['广东省', '廣東省']),
  city: Object.freeze(['深圳市']),
  district: Object.freeze(['南山区', '南山區']),
})
const PAGE_VALIDATION_MAX_ATTEMPTS = 3
const PAGE_VALIDATION_RETRY_DELAY_MS = 800
const CLIENT_VALIDATION_SETTLE_TIMEOUT_MS = 4_000
const RETRYABLE_PAGE_VALIDATION_STATUSES = new Set([405, 408, 425, 429, 500, 502, 503, 504])
const SUBMISSION_RESULT_SELECTOR = 'form-submission-result'
const SUBMISSION_RESULT_URL_PATTERN = /\/form\/submission-result\/?(?:[?#]|$)/
const SCRIPT_ID = 'form-lpxavn-submit'

const FIELD_KEYS = Object.freeze({
  username: 'username_eluhbv',
  mobile: 'mobile_gyccjb',
  email: 'email_rcgvml',
  idCard: 'idCard_zumhky',
  landlinePhone: 'landlinePhone_hpoyxu',
  address: 'address_cmjvkg',
  birthday: 'birthday_hjwtdp',
  input: 'input_puqsfe',
  textarea: 'textarea_aqrcpy',
  radio: 'radio_jqlsea',
  checkbox: 'checkbox_zliyho',
  select: 'select_dicnnl',
  number: 'number_vdgnyu',
  date: 'date_hmknfk',
  time: 'time_lhlmew',
  imageUpload: 'imageUpload_dayjcy',
  fileUpload: 'fileUpload_mhzuvb',
  cascader: 'cascader_zymbyk',
  signature: 'signature_inzarf',
  fieldGroup: 'fieldGroup_swwiqa',
  groupUsername: 'username_ptmghb',
  groupMobile: 'mobile_enwbxg',
  groupEmail: 'email_nienav',
  description: 'description_mwzava',
  divider: 'divider_dsdpbn',
  matrix: 'matrix_doudqs',
  matrixChoice: 'matrixChoice_gcolof',
  ranking: 'ranking_fdqwsf',
  rating: 'rating_idrnxs',
  nps: 'nps_mgwwju',
})

const PUBLISHED_FIELD_TYPES = Object.freeze({
  [FIELD_KEYS.username]: 'username',
  [FIELD_KEYS.mobile]: 'mobile',
  [FIELD_KEYS.email]: 'email',
  [FIELD_KEYS.idCard]: 'id_card',
  [FIELD_KEYS.landlinePhone]: 'landline_phone',
  [FIELD_KEYS.address]: 'address',
  [FIELD_KEYS.birthday]: 'birthday',
  [FIELD_KEYS.input]: 'input',
  [FIELD_KEYS.textarea]: 'textarea',
  [FIELD_KEYS.radio]: 'radio',
  [FIELD_KEYS.checkbox]: 'checkbox',
  [FIELD_KEYS.select]: 'select',
  [FIELD_KEYS.number]: 'number',
  [FIELD_KEYS.date]: 'date',
  [FIELD_KEYS.time]: 'time',
  [FIELD_KEYS.imageUpload]: 'image_upload',
  [FIELD_KEYS.fileUpload]: 'file_upload',
  [FIELD_KEYS.cascader]: 'cascader',
  [FIELD_KEYS.signature]: 'signature',
  [FIELD_KEYS.fieldGroup]: 'field_group',
  [FIELD_KEYS.groupUsername]: 'username',
  [FIELD_KEYS.groupMobile]: 'mobile',
  [FIELD_KEYS.groupEmail]: 'email',
  [FIELD_KEYS.description]: 'description',
  [FIELD_KEYS.divider]: 'divider',
  [FIELD_KEYS.matrix]: 'matrix',
  [FIELD_KEYS.matrixChoice]: 'matrix_choice',
  [FIELD_KEYS.ranking]: 'sort',
  [FIELD_KEYS.rating]: 'rating',
  [FIELD_KEYS.nps]: 'nps',
})

const REQUIRED_ROOT_FIELD_KEYS = Object.freeze([
  ...Object.values(FIELD_KEYS).filter((key) => ![
    FIELD_KEYS.fieldGroup,
    FIELD_KEYS.groupUsername,
    FIELD_KEYS.groupMobile,
    FIELD_KEYS.groupEmail,
    FIELD_KEYS.description,
    FIELD_KEYS.divider,
  ].includes(key)),
])
const STRUCTURAL_FIELD_KEYS = new Set([
  FIELD_KEYS.fieldGroup,
  FIELD_KEYS.description,
  FIELD_KEYS.divider,
])
const EXPECTED_NAME_TITLES = Object.freeze([
  'Mr.（先生）',
  'Ms.（女士）',
  'Mrs.（太太）',
  'Dr.（医生/博士）',
])
const IMAGE_EXTENSIONS = Object.freeze(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'psd', 'tif', 'heic', 'heif'])

const PAGE_FIELD_LABELS = Object.freeze([
  ['姓名', '手机号', '邮箱', '身份证件', '固定电话', '地址', '生日'],
  ['单行文本', '多行文本', '单项选择', '多项选择', '下拉选择', '数字', '日期', '时间', '图片上传', '文件上传'],
  ['级联选择', '手写签名', '题组', '描述说明', '分割线', '矩阵题', '矩阵选择', '排序题', '评分题', 'NPS'],
])
const PAGE_FIELD_KEYS = Object.freeze([
  [FIELD_KEYS.username, FIELD_KEYS.mobile, FIELD_KEYS.email, FIELD_KEYS.idCard, FIELD_KEYS.landlinePhone, FIELD_KEYS.address, FIELD_KEYS.birthday],
  [FIELD_KEYS.input, FIELD_KEYS.textarea, FIELD_KEYS.radio, FIELD_KEYS.checkbox, FIELD_KEYS.select, FIELD_KEYS.number, FIELD_KEYS.date, FIELD_KEYS.time, FIELD_KEYS.imageUpload, FIELD_KEYS.fileUpload],
  [FIELD_KEYS.cascader, FIELD_KEYS.signature, FIELD_KEYS.fieldGroup, FIELD_KEYS.description, FIELD_KEYS.divider, FIELD_KEYS.matrix, FIELD_KEYS.matrixChoice, FIELD_KEYS.ranking, FIELD_KEYS.rating, FIELD_KEYS.nps],
])
const PAGE_CARD_COUNTS = Object.freeze([7, 10, 10])

function findPublishedItem(items, key, label = key) {
  const matches = items.filter((item) => item?.item_key === key)
  expect(matches, `公开配置中“${label}”的 item_key 应唯一`).toHaveLength(1)
  return matches[0]
}

function expectEnabled(value, label) {
  expect(Number(value), `${label}应开启`).toBe(1)
}

function expectHexColor(value, label) {
  expect(String(value ?? ''), `${label}应为十六进制颜色`).toMatch(/^#[0-9a-f]{6}$/i)
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizedObjectArray(value, label) {
  const isArray = Array.isArray(value)
  if (!isArray) expect(isArray, `${label}应为数组`).toBe(true)
  const source = isArray ? value : []
  const invalidIndexes = source
    .flatMap((entry, index) => (isRecord(entry) ? [] : [index + 1]))
  if (invalidIndexes.length > 0) {
    expect(
      invalidIndexes,
      `${label}的每一项都应为对象；异常位置：${invalidIndexes.join('、')}`,
    ).toEqual([])
  }
  return source.map((entry) => (isRecord(entry) ? entry : {}))
}

function optionValueMap(choices, label, keyName = 'name', valueName = 'value') {
  const invalidIndexes = choices.flatMap((choice, index) => (
    String(choice?.[keyName] ?? '').trim() && String(choice?.[valueName] ?? '').trim()
      ? []
      : [index + 1]
  ))
  if (invalidIndexes.length > 0) {
    expect(
      invalidIndexes,
      `${label}的每个选项都应包含名称和选项值；异常位置：${invalidIndexes.join('、')}`,
    ).toEqual([])
  }
  return Object.fromEntries(choices.flatMap((choice) => {
    const key = String(choice?.[keyName] ?? '').trim()
    return key ? [[key, choice?.[valueName] ?? '']] : []
  }))
}

function assertUploadContract(item, { label, mediaType, extensions }) {
  expect(Number(item?.common_config?.max_size), `${label}最大文件大小应为 20 MB`).toBe(20)
  expect(Number(item?.common_config?.max_file_quantity), `${label}最多应上传 1 个文件`).toBe(1)
  const media = item?.common_config?.media_type
  expect(Array.isArray(media), `${label}应包含文件类型限制`).toBeTruthy()
  expect(media?.[0]?.type, `${label}文件类型应匹配`).toBe(mediaType)
  if (extensions) {
    expect(media?.[0]?.extensions, `${label}应限制为发布脚本创建时的图片扩展名`).toEqual(extensions)
  }
}

function assertPublishedFormContract(payload, expectedFormId = FORM_ID, linkedContract = null) {
  const validPayload = isRecord(payload)
  expect(validPayload, '公开表单配置接口应返回有效 JSON 对象').toBe(true)
  const safePayload = validPayload ? payload : {}
  expect(
    Number(safePayload.code),
    `公开表单配置接口业务码应为 0，实际 ${String(safePayload.code)}`,
  ).toBe(0)
  const formValid = isRecord(safePayload?.data?.form)
  const itemsValid = Array.isArray(safePayload?.data?.items)
  expect(formValid, '公开表单配置接口响应应包含 form 对象').toBe(true)
  expect(itemsValid, '公开表单配置接口响应应包含 items 数组').toBe(true)
  const form = formValid ? safePayload.data.form : {}
  const items = itemsValid ? safePayload.data.items : []
  const publishedFormId = String(form?.form_id ?? '').trim() || String(form?.id ?? '').trim()
  const linkedFieldKeys = linkedContract?.fieldKeys
  const hasLinkedFieldKeys = isRecord(linkedFieldKeys)
  if (linkedContract) {
    expect(hasLinkedFieldKeys, '前序发布脚本字段映射应为对象').toBe(true)
  }
  const fieldKeys = resolveFormFieldKeys(items, hasLinkedFieldKeys ? linkedFieldKeys : {})
  const pageFieldKeys = pageFieldKeysFor(fieldKeys)
  const requiredFieldNames = [
    'username', 'mobile', 'email', 'idCard', 'landlinePhone', 'address', 'birthday',
    'input', 'textarea', 'radio', 'checkbox', 'select', 'number', 'date', 'time',
    'imageUpload', 'fileUpload', 'cascader', 'signature', 'matrix', 'matrixChoice',
    'ranking', 'rating', 'nps',
  ]
  const structuralFieldNames = ['fieldGroup', 'description', 'divider']
  const itemFor = (name, label = name) => findPublishedItem(items, fieldKeys[name], label)

  expect(Number(safePayload?.data?.revision_no), '公开表单 revision_no 应至少为 1').toBeGreaterThanOrEqual(1)
  expect(publishedFormId, '公开配置应属于目标表单 ID').toBe(expectedFormId)
  expect(form?.status, '目标表单应保持已发布状态').toBe('published')
  expect(String(form?.title ?? ''), '公开配置标题应为全题型发布脚本生成的标题')
    .toMatch(/^自动化测试全题型表单-\d+$/)
  if (linkedContract) {
    expect(publishedFormId, '公开表单 ID 应与前序发布脚本输出一致').toBe(linkedContract.formId)
    expect(form?.title, '公开表单标题应与前序发布脚本输出一致').toBe(linkedContract.title)
    expect(Number(safePayload?.data?.revision_no), '公开表单版本应与前序发布脚本输出一致')
      .toBe(Number(linkedContract.revisionNo))
  }
  expect(form?.subtitle, '公开配置描述应与发布脚本一致').toBe(FORM_SUBTITLE)
  for (const text of [FORM_CONTENT_HEADING, ...FORM_CONTENT_ITEMS]) {
    expect(form?.description, `公开配置填写须知应包含“${text}”`).toContain(text)
  }

  const pageItems = items.filter((item) => item?.type_code === 'page' && !item?.group_code)
  expect(pageItems, '发布产物应保留三个分页组件').toHaveLength(3)
  expect(items.filter((item) => item?.type_code === 'payment'), '普通全题型表单不应混入付款题').toHaveLength(0)
  for (const [name, type] of Object.entries(FIELD_TYPE_CODES)) {
    const key = fieldKeys[name]
    const item = findPublishedItem(items, key, name)
    expect(item?.type_code, `${name} 的题型应与发布脚本一致`).toBe(type)
    expect(Number(item?.hidden), `${name} 应在公开表单中启用`).toBe(2)
    if (linkedContract?.fieldKeys?.[name]) {
      expect(key, `${name} 的题目键应与前序发布脚本输出一致`).toBe(linkedContract.fieldKeys[name])
    }
  }
  const requiredRootKeys = requiredFieldNames.map((name) => fieldKeys[name]).filter(Boolean)
  for (const name of requiredFieldNames) {
    const key = fieldKeys[name]
    const item = findPublishedItem(items, key, name)
    expectEnabled(item?.rule_config?.required?.enabled, `${item?.label || key}必填规则`)
    expect(item?.group_code || '', `${item?.label || key}应为根级题目`).toBe('')
  }
  expect(requiredRootKeys, '发布产物应有 24 个根级必答题').toHaveLength(24)
  for (const name of structuralFieldNames) {
    const key = fieldKeys[name]
    expect(Number(findPublishedItem(items, key, name)?.rule_config?.required?.enabled), `${name} 不应被当成根级答案题`).toBe(2)
  }

  const username = itemFor('username', '姓名')
  expectEnabled(username?.common_config?.name_title?.enabled, '姓名称谓采集')
  const nameTitleChoices = normalizedObjectArray(
    username?.common_config?.name_title?.choices,
    '姓名称谓选项',
  )
  expect(
    nameTitleChoices.map((choice) => (
      String(choice?.title ?? '').replace('醫生', '医生')
    )),
    '姓名应提供四个称谓边界选项',
  )
    .toEqual(EXPECTED_NAME_TITLES)

  const email = itemFor('email', '邮箱')
  expectEnabled(email?.rule_config?.regex_format?.enabled, '邮箱格式校验')

  const idCard = itemFor('idCard', '身份证件')
  expectEnabled(idCard?.common_config?.collect_mode?.custom_enabled, '自定义证件类型')
  const idCardChoices = normalizedObjectArray(
    idCard?.common_config?.collect_mode?.choices,
    '身份证件类型选项',
  )
  expect(idCardChoices.length, '身份证件应包含完整证件类型集合').toBeGreaterThanOrEqual(10)
  expect(idCard?.common_config?.collect_mode?.selected, '身份证件已选证件类型应与可用选项一致')
    .toEqual(idCardChoices.map((choice) => choice?.code ?? ''))

  const input = itemFor('input', '单行文本')
  expectEnabled(input?.rule_config?.length?.enabled, '单行文本字数限制')
  expect(Number(input?.rule_config?.length?.max), '单行文本最大长度应为 20').toBe(20)

  const radio = itemFor('radio', '单项选择')
  expectEnabled(radio?.common_config?.allow_image, '单项选择图片模式')
  expectEnabled(radio?.common_config?.allow_customized_text?.enabled, '单项选择用户自定义输入')
  const radioChoices = normalizedObjectArray(radio?.option?.choices, '单项选择选项')
  expect(radioChoices, '单项选择应包含两个图片选项和一个“其他”选项').toHaveLength(3)
  for (const [index, choice] of radioChoices.slice(0, 2).entries()) {
    expect(String(choice?.image_id ?? ''), `单项选择第 ${index + 1} 项应包含图片 ID`).toMatch(/\S+/)
    expect(String(choice?.image_url ?? ''), `单项选择第 ${index + 1} 项应包含图片地址`).toMatch(/^https?:\/\//)
  }
  expect(radioChoices[2]?.name, '单项选择最后一项应允许用户输入').toBe('其他')

  const checkbox = itemFor('checkbox', '多项选择')
  expectEnabled(checkbox?.rule_config?.length?.enabled, '多项选择数量限制')
  expect(Number(checkbox?.rule_config?.length?.min), '多项选择最少应选 2 项').toBe(2)
  expect(Number(checkbox?.rule_config?.length?.max), '多项选择最多应选 3 项').toBe(3)
  const checkboxChoices = normalizedObjectArray(checkbox?.option?.choices, '多项选择选项')
  expect(checkboxChoices.map((choice) => choice?.name), '多项选择应保留三个选项')
    .toEqual(['选项1', '选项2', '选项3'])

  const select = itemFor('select', '下拉选择')
  const selectChoices = normalizedObjectArray(select?.option?.choices, '下拉选择选项')
  expect(selectChoices.map((choice) => choice?.name), '下拉选择应保留两个选项')
    .toEqual(['选项1', '选项2'])

  const number = itemFor('number', '数字')
  expectEnabled(number?.rule_config?.length?.enabled, '数字范围限制')
  expect(Number(number?.rule_config?.length?.min), '数字下边界应为 0').toBe(0)
  expect(Number(number?.rule_config?.length?.max), '数字上边界应为 100').toBe(100)
  expect(Number(number?.common_config?.decimals), '数字应保留两位小数').toBe(2)

  const date = itemFor('date', '日期')
  expectEnabled(date?.rule_config?.date_range?.enabled, '日期范围限制')
  const dateRange = {
    start: String(date?.rule_config?.date_range?.start ?? ''),
    end: String(date?.rule_config?.date_range?.end ?? ''),
  }
  expect(dateRange.start, '日期开始边界应为 ISO 日期').toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(dateRange.end, '日期结束边界应为 ISO 日期').toMatch(/^\d{4}-\d{2}-\d{2}$/)
  const rangeDays = (Date.parse(`${dateRange.end}T00:00:00Z`) - Date.parse(`${dateRange.start}T00:00:00Z`)) / 86_400_000
  expect(rangeDays, '日期结束边界应为开始边界后 30 天').toBe(30)

  assertUploadContract(itemFor('imageUpload', '图片上传'), {
    label: '图片上传',
    mediaType: 'image',
    extensions: IMAGE_EXTENSIONS,
  })
  assertUploadContract(itemFor('fileUpload', '文件上传'), {
    label: '文件上传',
    mediaType: 'unlimited',
  })

  const cascader = itemFor('cascader', '级联选择')
  expect(cascader?.common_config?.type_mode, '级联选择应为多选模式').toBe('multiple')
  expect(Number(cascader?.common_config?.levels), '级联选择应为三级').toBe(3)
  const cascaderLevelOne = normalizedObjectArray(cascader?.option?.choices, '级联选择第一级选项')
  const cascaderLevelTwo = normalizedObjectArray(cascaderLevelOne[0]?.sub_choices, '级联选择第二级选项')
  const cascaderLevelThree = normalizedObjectArray(cascaderLevelTwo[0]?.sub_choices, '级联选择第三级选项')
  const cascaderChoices = [cascaderLevelOne[0] || {}, cascaderLevelTwo[0] || {}, cascaderLevelThree[0] || {}]
  expect(cascaderChoices.map((choice) => choice?.name), '级联选择应与发布脚本的固定三级路径一致')
    .toEqual(CASCADER_LEVEL_VALUES)

  const fieldGroup = itemFor('fieldGroup', '题组')
  expectEnabled(fieldGroup?.common_config?.allow_add_item?.enabled, '题组增减实例')
  expect(Number(fieldGroup?.common_config?.allow_add_item?.min), '题组最少应有 1 组').toBe(1)
  expect(Number(fieldGroup?.common_config?.allow_add_item?.max), '题组最多应有 5 组').toBe(5)
  const groupChildren = items.filter((item) => item?.group_code === fieldKeys.fieldGroup)
  expect(groupChildren.map((item) => item?.item_key), '题组应按姓名、手机号、邮箱顺序保存子题').toEqual([
    fieldKeys.groupUsername,
    fieldKeys.groupMobile,
    fieldKeys.groupEmail,
  ])
  expect(groupChildren.map((item) => Number(item?.rule_config?.required?.enabled)), '题组姓名和手机号必填，邮箱保持可选')
    .toEqual([1, 1, 2])
  expect(groupChildren.map((item) => Number(item?.common_config?.collect_to_contact?.enabled)), '题组三项均应收录联系人')
    .toEqual([1, 1, 1])
  expect(groupChildren.map((item) => item?.common_config?.collect_to_contact?.anchor), '题组联系人锚点应匹配题型')
    .toEqual(['username', 'mobile', 'email'])

  const description = itemFor('description', '描述说明')
  expect(description?.label, '描述说明标题应与发布脚本一致').toBe(DESCRIPTION_FIELD_TITLE)
  expect(description?.description, '描述说明正文应与发布脚本一致').toContain(DESCRIPTION_FIELD_CONTENT)
  expect(itemFor('divider', '分割线')?.label, '分割线文案应与发布脚本一致').toBe(DIVIDER_TEXT)

  const matrix = itemFor('matrix', '矩阵题')
  const matrixStatements = normalizedObjectArray(matrix?.option?.statements, '矩阵题行配置')
  const matrixDimensions = normalizedObjectArray(matrix?.option?.dimensions, '矩阵题列配置')
  expect(matrixStatements.map((row) => row?.label), '矩阵题应有三行').toEqual(['题目1', '题目2', '题目3'])
  expect(matrixDimensions.map((column) => column?.name), '矩阵题应有三列').toEqual(['项目1', '项目2', '项目3'])
  const matrixChoice = itemFor('matrixChoice', '矩阵选择')
  expect(matrixChoice?.option?.choice_style, '矩阵选择应为每行单选').toBe('single')
  const matrixChoiceStatements = normalizedObjectArray(matrixChoice?.option?.statements, '矩阵选择行配置')
  const matrixChoiceChoices = normalizedObjectArray(matrixChoice?.option?.choices, '矩阵选择列选项')
  expect(matrixChoiceStatements, '矩阵选择应有三行').toHaveLength(3)
  expect(matrixChoiceChoices, '矩阵选择应有三列').toHaveLength(3)
  const ranking = itemFor('ranking', '排序题')
  const rankingChoices = normalizedObjectArray(ranking?.option?.choices, '排序题选项')
  expect(rankingChoices.map((choice) => choice?.name), '排序题应包含三个选项').toEqual(['选项1', '选项2', '选项3'])
  expect(Number(itemFor('rating', '评分题')?.common_config?.rating_max), '评分题上边界应为 5').toBe(5)
  expect(Number(itemFor('nps', 'NPS')?.common_config?.rating_max), 'NPS 上边界应为 10').toBe(10)

  expect(form?.submitted_config?.contact_collect_mode?.selected, '联系人冲突策略应为忽略、不替换').toBe('ignore')
  expectEnabled(form?.submitted_config?.contact_collect_mode?.enabled, '联系人收录')
  const headerImage = form?.theme_config?.header_image?.image
  expect(String(headerImage?.id ?? headerImage?.upload_id ?? ''), '主题应包含发布脚本上传的头图').toMatch(/\S+/)
  expect(String(headerImage?.url ?? headerImage?.path ?? ''), '头图应包含可访问地址').toMatch(/^https?:\/\//)
  expectHexColor(form?.theme_config?.submit_button?.background_color, '系统推荐提交按钮配色')
  expectHexColor(form?.theme_config?.form_container?.background_color, '系统推荐表单底色')
  expectHexColor(form?.theme_config?.wallpaper?.background_color?.color, '系统推荐页面底色')

  return {
    revisionNo: Number(safePayload?.data?.revision_no) || 0,
    pageKeys: pageItems.map((item) => item.item_key),
    requiredRootKeys,
    fieldKeys,
    pageFieldKeys,
    title: String(form.title ?? ''),
    formId: publishedFormId,
    formCode: String(form.form_code ?? ''),
    dateRange,
    optionValues: {
      nameTitle: optionValueMap(nameTitleChoices, '姓名称谓选项', 'title', 'code'),
      radio: optionValueMap(radioChoices, '单项选择选项'),
      checkbox: optionValueMap(checkboxChoices, '多项选择选项'),
      select: optionValueMap(selectChoices, '下拉选择选项'),
      cascader: cascaderChoices.map((choice) => choice?.value ?? ''),
      matrixChoice: matrixChoiceChoices.map((choice) => choice?.value ?? ''),
      ranking: optionValueMap(rankingChoices, '排序题选项'),
    },
  }
}

function publicOriginForSite(siteBaseUrl) {
  const url = new URL(siteBaseUrl)
  if (url.hostname.includes('.admin.')) {
    url.hostname = url.hostname.replace('.admin.', '.')
  } else if (url.hostname.includes('.b.lingxi-hk.localtest')) {
    url.hostname = url.hostname.replace('.b.lingxi-hk.localtest', '.f.lingxi-hk.localtest')
  }
  return url.origin
}

function normalizeFormPath(requestPath = FORM_PATH) {
  if (typeof requestPath !== 'string' || !requestPath.trim()) throw new Error('公开表单 URL 路径不能为空')
  const normalizedPath = requestPath.trim()
  if (/^[a-z][a-z\d+.-]*:/i.test(normalizedPath) || normalizedPath.startsWith('//')) {
    throw new Error('公开表单 URL 路径必须是相对路径')
  }
  if (/\s/.test(normalizedPath)) throw new Error('公开表单 URL 路径不能包含空格或换行')
  if (normalizedPath.includes('\\')) throw new Error('公开表单 URL 路径不能包含反斜杠')
  return normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`
}

function buildFormUrl(siteBaseUrl, requestPath = FORM_PATH) {
  const publicOrigin = publicOriginForSite(siteBaseUrl)
  const formPath = normalizeFormPath(requestPath)
  const formUrl = new URL(formPath.replace(/^\/+/, ''), `${publicOrigin}/`)
  if (formUrl.origin !== publicOrigin) throw new Error('公开表单地址必须与所选环境的公开域名同源')
  return formUrl.toString()
}

function createTestData(now = Date.now()) {
  const suffix = String(now).slice(-8).padStart(8, '0')
  const groupSuffix = String(Number(suffix) + 1).padStart(8, '0').slice(-8)
  return {
    runId: String(now),
    nameTitle: 'Mr.（先生）',
    username: `自动化测试用户${String(now).slice(-4)}`,
    mobile: `139${suffix}`,
    invalidMobile: '123',
    email: `autotest_${now}@example.com`,
    invalidEmail: 'invalid-email',
    idCard: '11010519491231002X',
    landlinePhone: '0755-12345678',
    province: '广东省',
    city: '深圳市',
    district: '南山区',
    street: `自动化测试地址${String(now).slice(-6)}号`,
    birthday: { year: '1990', month: '8', day: '18' },
    singleLine: '边界测试1234567890123456',
    singleLineTooLong: '边界测试1234567890123456X',
    multiLine: `多行文本自动化答案\n运行时间戳：${now}`,
    radio: '选项1',
    radioIndex: 0,
    checkbox: ['选项1', '选项2', '选项3'],
    checkboxIndexes: [0, 1, 2],
    select: '选项2',
    number: '100.00',
    numberTooLarge: '100.01',
    cascader: [...CASCADER_LEVEL_VALUES],
    groupUsername: `题组联系人${String(now).slice(-4)}`,
    groupMobile: `138${groupSuffix}`,
    groupEmail: `group_${now}@example.com`,
    matrix: Array.from({ length: 3 }, (_, row) =>
      Array.from({ length: 3 }, (_, column) => `题目${row + 1}-项目${column + 1}答案`),
    ),
    matrixChoiceIndexes: [0, 4, 8],
    ranking: ['选项2', '选项1', '选项3'],
    rating: 5,
    nps: 10,
    selectedDate: '',
    selectedTime: '',
  }
}

const DEFAULT_SUBMISSION_CONTRACT = Object.freeze({
  revisionNo: 1,
  pageKeys: [],
  optionValues: {
    nameTitle: { 'Mr.（先生）': 'categvvrwpdm9' },
    radio: { 选项1: 'option_1', 选项2: 'option_2', 其他: 'option_other' },
    checkbox: { 选项1: 'option_1', 选项2: 'option_2', 选项3: 'option_3' },
    select: { 选项1: 'option_1', 选项2: 'option_2' },
    cascader: ['A731', 'u6oP', 'u6oPXf'],
    matrixChoice: ['col_1', 'col_2', 'col_3'],
    ranking: { 选项1: 'option_1', 选项2: 'option_2', 选项3: 'option_3' },
  },
})

function indexSubmissionEntries(payload, fieldKeys = FIELD_KEYS) {
  const entries = new Map()
  const knownKeys = new Set(Object.values(fieldKeys).filter(Boolean))
  const visited = new WeakSet()

  function add(key, entry) {
    if (!entries.has(key)) entries.set(key, [])
    const bucket = entries.get(key)
    if (!bucket.includes(entry)) bucket.push(entry)
  }

  function visit(value) {
    if (!value || typeof value !== 'object' || visited.has(value)) return
    visited.add(value)
    if (typeof value.item_key === 'string') add(value.item_key, value)

    for (const [key, child] of Object.entries(value)) {
      if (knownKeys.has(key)) add(key, { item_key: key, answer: child })
      visit(child)
    }
  }

  visit(payload)
  return entries
}

function scalarValues(value, output = [], visited = new WeakSet()) {
  if (value === null || value === undefined) return output
  if (typeof value !== 'object') {
    output.push(value)
    return output
  }
  if (visited.has(value)) return output
  visited.add(value)
  for (const child of Object.values(value)) scalarValues(child, output, visited)
  return output
}

function entryContains(entry, expected) {
  return scalarValues(entry).some((actual) => {
    if (typeof expected === 'number') return Number(actual) === expected
    return String(actual).trim() === String(expected).trim()
  })
}

function expectEntryValues(index, key, expectedValues, label) {
  const entries = index.get(key) || []
  expect(entries.length, `提交 JSON 应包含“${label}”对应的 item_key`).toBeGreaterThan(0)
  for (const expected of expectedValues) {
    const alternatives = Array.isArray(expected) ? expected : [expected]
    const actualPreview = JSON.stringify(entries).slice(0, 800)
    expect(
      entries.some((entry) => alternatives.some((candidate) => entryContains(entry, candidate))),
      `“${label}”提交答案应包含 ${alternatives.map((value) => JSON.stringify(value)).join(' 或 ')}；实际条目：${actualPreview}`,
    ).toBeTruthy()
  }
}

function expectBirthdayEntry(index, data, fieldKeys = FIELD_KEYS) {
  const entries = index.get(fieldKeys.birthday) || []
  expect(entries.length, '提交 JSON 应包含“生日”对应的 item_key').toBeGreaterThan(0)
  const expectedParts = [data.birthday.year, data.birthday.month, data.birthday.day]
  const hasSeparatedParts = expectedParts.every((part) => entries.some((entry) => entryContains(entry, part)))
  const expectedDigits = [
    data.birthday.year,
    String(data.birthday.month).padStart(2, '0'),
    String(data.birthday.day).padStart(2, '0'),
  ].join('')
  const hasCombinedDate = entries.some((entry) => scalarValues(entry).some((value) => (
    String(value).replace(/\D/g, '') === expectedDigits
  )))
  expect(
    hasSeparatedParts || hasCombinedDate,
    `“生日”应按分段值或完整日期提交；实际条目：${JSON.stringify(entries).slice(0, 800)}`,
  ).toBeTruthy()
}

function expectMeaningfulEntry(index, key, label) {
  const entries = index.get(key) || []
  expect(entries.length, `提交 JSON 应包含“${label}”对应的 item_key`).toBeGreaterThan(0)
  const ignored = new Set([key, PUBLISHED_FIELD_TYPES[key], label, ''])
  expect(
    entries.some((entry) => scalarValues(entry).some((value) => !ignored.has(String(value).trim()))),
    `“${label}”提交答案不应为空`,
  ).toBeTruthy()
}

function isEmptySubmissionValue(value, visited = new WeakSet()) {
  if (value === null || value === undefined || value === '') return true
  if (typeof value !== 'object') return false
  if (visited.has(value)) return true
  visited.add(value)
  if (Array.isArray(value)) return value.every((child) => isEmptySubmissionValue(child, visited))
  return Object.values(value).every((child) => isEmptySubmissionValue(child, visited))
}

function structuralEntryAnswer(entry) {
  if (Object.prototype.hasOwnProperty.call(entry, 'answer')) return entry.answer
  return Object.fromEntries(Object.entries(entry).filter(([key]) => ![
    'item_key',
    'type_code',
    'label',
    'group_code',
  ].includes(key)))
}

function expectStructuralEntryEmpty(index, key) {
  const entries = index.get(key) || []
  expect(
    entries.every((entry) => isEmptySubmissionValue(structuralEntryAnswer(entry))),
    `结构组件 ${key} 即使出现在请求中也不应携带答案`,
  ).toBeTruthy()
}

function expectOrderedEntryValues(index, key, expectedAlternatives, label) {
  const entries = index.get(key) || []
  expect(entries.length, `提交 JSON 应包含“${label}”对应的 item_key`).toBeGreaterThan(0)
  const hasExpectedOrder = entries.some((entry) => {
    const serialized = JSON.stringify(entry)
    let cursor = -1
    for (const alternatives of expectedAlternatives) {
      const indexes = alternatives
        .map((candidate) => serialized.indexOf(JSON.stringify(candidate), cursor + 1))
        .filter((index) => index > cursor)
      if (indexes.length === 0) return false
      cursor = Math.min(...indexes)
    }
    return true
  })
  expect(hasExpectedOrder, `“${label}”提交答案顺序应与 UI 最终顺序一致`).toBeTruthy()
}

function assertSubmissionPayload(payload, data, contract = DEFAULT_SUBMISSION_CONTRACT) {
  expect(payload && typeof payload === 'object', '提交请求体应为 JSON 对象').toBeTruthy()
  const fieldKeys = contract?.fieldKeys || FIELD_KEYS
  const index = indexSubmissionEntries(payload, fieldKeys)
  const values = contract?.optionValues || DEFAULT_SUBMISSION_CONTRACT.optionValues

  expectEntryValues(index, fieldKeys.username, [
    [data.nameTitle, values.nameTitle?.[data.nameTitle]],
    data.username,
  ], '姓名')
  expectEntryValues(index, fieldKeys.mobile, [['+86', '86'], data.mobile], '手机号')
  expectEntryValues(index, fieldKeys.email, [data.email], '邮箱')
  expectEntryValues(index, fieldKeys.idCard, [['身份证', 'id_card'], data.idCard], '身份证件')
  expectEntryValues(index, fieldKeys.landlinePhone, [data.landlinePhone], '固定电话')
  expectEntryValues(index, fieldKeys.address, [data.province, data.city, data.district, data.street], '地址')
  expectBirthdayEntry(index, data, fieldKeys)
  expectEntryValues(index, fieldKeys.input, [data.singleLine], '单行文本')
  expectEntryValues(index, fieldKeys.textarea, [data.multiLine], '多行文本')
  expectEntryValues(index, fieldKeys.radio, [[data.radio, values.radio?.[data.radio]]], '单项选择')
  for (const choice of data.checkbox) {
    expectEntryValues(index, fieldKeys.checkbox, [[choice, values.checkbox?.[choice]]], '多项选择')
  }
  expectEntryValues(index, fieldKeys.select, [[data.select, values.select?.[data.select]]], '下拉选择')
  expectEntryValues(index, fieldKeys.number, [[data.number, Number(data.number)]], '数字')
  expectMeaningfulEntry(index, fieldKeys.date, '日期')
  expectMeaningfulEntry(index, fieldKeys.time, '时间')
  expectMeaningfulEntry(index, fieldKeys.imageUpload, '图片上传')
  expectMeaningfulEntry(index, fieldKeys.fileUpload, '文件上传')
  const cascaderLeafIndex = data.cascader.length - 1
  expectEntryValues(index, fieldKeys.cascader, [[
    data.cascader[cascaderLeafIndex],
    values.cascader?.[cascaderLeafIndex],
  ]], '级联选择叶子节点')
  expectMeaningfulEntry(index, fieldKeys.signature, '手写签名')
  expectEntryValues(index, fieldKeys.groupUsername, [data.groupUsername], '题组-姓名')
  expectEntryValues(index, fieldKeys.groupMobile, [['+86', '86'], data.groupMobile], '题组-手机号')
  expectEntryValues(index, fieldKeys.groupEmail, [data.groupEmail], '题组-邮箱')
  for (const answer of data.matrix.flat()) {
    expectEntryValues(index, fieldKeys.matrix, [answer], '矩阵题')
  }
  const matrixChoiceValues = data.matrixChoiceIndexes.map((index) => values.matrixChoice?.[index % 3])
  for (const [choiceIndex, value] of matrixChoiceValues.entries()) {
    expectEntryValues(index, fieldKeys.matrixChoice, [
      [value, `选项${(data.matrixChoiceIndexes[choiceIndex] % 3) + 1}`],
    ], '矩阵选择')
  }
  expectOrderedEntryValues(index, fieldKeys.ranking, data.ranking.map((choice) => [
    choice,
    values.ranking?.[choice],
  ]), '排序题')
  expectEntryValues(index, fieldKeys.rating, [data.rating], '评分题')
  expectEntryValues(index, fieldKeys.nps, [data.nps], 'NPS')

  const answeredKeys = [
    ...(contract?.requiredRootKeys || REQUIRED_ROOT_FIELD_KEYS),
    fieldKeys.groupUsername,
    fieldKeys.groupMobile,
    fieldKeys.groupEmail,
  ]
  for (const key of answeredKeys) {
    expect(index.has(key), `提交 JSON 不应遗漏 ${key}`).toBeTruthy()
  }
  for (const key of [fieldKeys.description, fieldKeys.divider, ...(contract?.pageKeys || [])].filter(Boolean)) {
    expectStructuralEntryEmpty(index, key)
  }
  return { answerFieldCount: answeredKeys.length, indexedFieldCount: index.size }
}

function fieldCard(page, key) {
  return page.locator([
    `.fb-runtime-field-card[data-item-key="${key}"]`,
    `.fb-runtime-structural-field-card[data-item-key="${key}"]`,
    `[data-item-key="${key}"]`,
  ].join(', '))
}

async function assertField(page, key, label) {
  const card = fieldCard(page, key)
  await expect(card, `当前页应唯一显示“${label}”题目`).toHaveCount(1)
  await expect(card, `“${label}”题目应可见`).toBeVisible()
  return card
}

async function assertCurrentPage(page, pageNumber, expectedKeys, expectedLabels, expectedCardCount, logger) {
  const visibleCards = page.locator([
    '.fb-runtime-field-card:visible',
    '.fb-runtime-structural-field-card[data-item-key]:visible',
  ].join(', '))
  await expect(visibleCards, `第 ${pageNumber} 页顶层题块数应正确`).toHaveCount(expectedCardCount)
  for (const [index, key] of expectedKeys.entries()) {
    const label = expectedLabels[index] ?? key
    await expect(fieldCard(page, key), `第 ${pageNumber} 页应包含“${label}”`).toHaveCount(1)
    await expect(fieldCard(page, key), `第 ${pageNumber} 页的“${label}”应可见`).toBeVisible()
  }
  logger('info', `第 ${pageNumber} 页结构断言执行完成`, {
    questionCount: expectedLabels.length,
    labels: expectedLabels,
  })
}

async function fillAndAssert(input, value, label) {
  await input.fill(value)
  await expect(input, `“${label}”填写值应回显`).toHaveValue(value)
}

async function replaceWithUserInputAndBlur(input, value, label) {
  await input.click()
  await input.fill('')
  await input.pressSequentially(value)
  await input.press('Tab')
  await expect(input, `“${label}”修正值应回显`).toHaveValue(value)
}

async function assertEmailFormatBoundary(input, invalidValue, validValue) {
  await expect(input, '邮箱控件应使用原生 email 类型').toHaveAttribute('type', 'email')
  await replaceWithUserInputAndBlur(input, invalidValue, '邮箱非法格式值')
  await expect.poll(
    () => input.evaluate((element) => element.validity.valid),
    { message: '邮箱非法格式值应触发浏览器原生格式校验' },
  ).toBe(false)
  await replaceWithUserInputAndBlur(input, validValue, '邮箱合法恢复值')
  await expect.poll(
    () => input.evaluate((element) => element.validity.valid),
    { message: '邮箱合法恢复值应通过浏览器原生格式校验' },
  ).toBe(true)
}

async function selectOption(page, trigger, optionName, label, logger = () => undefined) {
  const optionNames = (Array.isArray(optionName) ? optionName : [optionName])
    .map((name) => String(name).trim())
    .filter(Boolean)
  if (optionNames.length === 0) throw new Error(`“${label}”未提供可选择的目标选项`)
  const optionPattern = new RegExp(`^(?:${optionNames
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})$`)
  const expectedOptionLabel = optionNames.join(' / ')
  let lastError
  for (let attempt = 1; attempt <= SELECT_MAX_ATTEMPTS; attempt += 1) {
    let listbox
    try {
      await trigger.scrollIntoViewIfNeeded({ timeout: SELECT_VISIBILITY_TIMEOUT_MS })
      await trigger.click({ timeout: SELECT_VISIBILITY_TIMEOUT_MS })
      await flowExpect(trigger, `“${label}”下拉框点击后应展开`).toHaveAttribute('aria-expanded', 'true', {
        timeout: SELECT_VISIBILITY_TIMEOUT_MS,
      })

      const listboxId = await trigger.getAttribute('aria-controls')
      flowExpect(listboxId, `“${label}”下拉框应关联当前选项列表`).toBeTruthy()
      listbox = page.locator(`[role="listbox"][id=${JSON.stringify(listboxId)}]:visible`)
      await flowExpect(listbox, `“${label}”当前选项列表应打开`).toBeVisible({
        timeout: SELECT_VISIBILITY_TIMEOUT_MS,
      })
      const option = listbox.getByRole('option', { name: optionPattern })
      await flowExpect(option, `“${label}”应唯一提供“${expectedOptionLabel}”中的一个选项`).toHaveCount(1, {
        timeout: SELECT_VISIBILITY_TIMEOUT_MS,
      })
      const selectedOptionName = (await option.innerText()).trim()
      await option.scrollIntoViewIfNeeded({ timeout: SELECT_VISIBILITY_TIMEOUT_MS })
      await flowExpect(option, `“${label}”选项“${selectedOptionName}”应可见`).toBeVisible({
        timeout: SELECT_VISIBILITY_TIMEOUT_MS,
      })
      await option.click({ timeout: SELECT_VISIBILITY_TIMEOUT_MS })
      await flowExpect(listbox, `选择“${selectedOptionName}”后选项列表应关闭`).toBeHidden({
        timeout: SELECT_COMMIT_TIMEOUT_MS,
      })
      await expect(trigger, `“${label}”成功选择“${selectedOptionName}”`).toHaveText(selectedOptionName, {
        timeout: SELECT_COMMIT_TIMEOUT_MS,
      })
      return selectedOptionName
    } catch (error) {
      lastError = error
      await page.keyboard.press('Escape').catch(() => undefined)
      if (listbox) await flowExpect(listbox).toBeHidden({ timeout: 500 }).catch(() => undefined)
      await flowExpect(trigger).toHaveAttribute('aria-expanded', 'false', { timeout: 500 }).catch(() => undefined)
      const actualText = await trigger.innerText({ timeout: 500 }).catch(() => '')
      if (attempt < SELECT_MAX_ATTEMPTS) {
        logger('warning', `“${label}”第 ${attempt} 次选择未生效，准备重新选择“${expectedOptionLabel}”`, {
          attempt,
          expected: expectedOptionLabel,
          actual: actualText.trim(),
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError)
  throw new Error(`“${label}”连续 ${SELECT_MAX_ATTEMPTS} 次未能选择“${expectedOptionLabel}”：${detail}`, {
    cause: lastError,
  })
}

async function expandCascaderOption(page, optionName, logger = () => undefined) {
  let lastError
  for (let attempt = 1; attempt <= SELECT_MAX_ATTEMPTS; attempt += 1) {
    try {
      const option = page.getByRole('button', { name: optionName, exact: true })
      await expect(option, `级联选择应唯一显示“${optionName}”`).toHaveCount(1, {
        timeout: SELECT_VISIBILITY_TIMEOUT_MS,
      })
      await expect(option, `级联选择项“${optionName}”应可见`).toBeVisible({
        timeout: SELECT_VISIBILITY_TIMEOUT_MS,
      })
      await option.hover({ timeout: SELECT_VISIBILITY_TIMEOUT_MS })
      return
    } catch (error) {
      lastError = error
      if (attempt < SELECT_MAX_ATTEMPTS) {
        logger('warning', `级联选择项“${optionName}”第 ${attempt} 次展开遇到节点更新，准备重试`, {
          attempt,
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError)
  throw new Error(`级联选择项“${optionName}”连续 ${SELECT_MAX_ATTEMPTS} 次展开失败：${detail}`, {
    cause: lastError,
  })
}

async function selectCascaderPath(page, trigger, path, logger = () => undefined) {
  let lastError
  for (let attempt = 1; attempt <= SELECT_MAX_ATTEMPTS; attempt += 1) {
    try {
      await page.keyboard.press('Escape').catch(() => undefined)
      await trigger.click({ timeout: SELECT_VISIBILITY_TIMEOUT_MS })
      for (const optionName of path.slice(0, -1)) {
        await expandCascaderOption(page, optionName, logger)
      }

      const leafName = path.at(-1)
      const leafOption = page.getByRole('button', { name: leafName, exact: true })
      await expect(leafOption, `级联选择应唯一显示叶子项“${leafName}”`).toHaveCount(1, {
        timeout: SELECT_VISIBILITY_TIMEOUT_MS,
      })
      const leafCheckbox = leafOption.locator('.fb-runtime-cascader-checkbox')
      await expect(leafCheckbox, `叶子项“${leafName}”应包含多选框`).toHaveCount(1)
      await leafOption.click({ timeout: SELECT_VISIBILITY_TIMEOUT_MS })
      await expect(leafCheckbox, `叶子项“${leafName}”应进入选中状态`).toHaveClass(/fb-text-white/, {
        timeout: SELECT_COMMIT_TIMEOUT_MS,
      })
      await expect(trigger, '级联选择应在关闭面板前回显完整三级结果').toContainText(/华东区.*江苏省.*南京市/, {
        timeout: SELECT_COMMIT_TIMEOUT_MS,
      })
      await page.keyboard.press('Escape')
      await expect(trigger, '多选级联确认后应关闭选项面板').toHaveAttribute('data-state', 'closed', {
        timeout: SELECT_COMMIT_TIMEOUT_MS,
      })
      await expect(trigger, '级联选择应回显完整三级结果').toContainText(/华东区.*江苏省.*南京市/, {
        timeout: SELECT_COMMIT_TIMEOUT_MS,
      })
      return
    } catch (error) {
      lastError = error
      await page.keyboard.press('Escape').catch(() => undefined)
      if (attempt < SELECT_MAX_ATTEMPTS) {
        logger('warning', `三级级联第 ${attempt} 次选择未提交，准备重新选择`, {
          attempt,
          path,
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError)
  throw new Error(`三级级联连续 ${SELECT_MAX_ATTEMPTS} 次选择失败：${detail}`, { cause: lastError })
}

async function waitForPublicMutation(
  page,
  publicOrigin,
  pathSuffix,
  action,
  label,
  { expectBusinessSuccess = true } = {},
) {
  const matchesMutation = (request) => {
    const url = new URL(request.url())
    return url.origin === publicOrigin
      && url.pathname.endsWith(pathSuffix)
      && request.method() === 'POST'
  }
  const requestPromise = page.waitForRequest(matchesMutation, {
    timeout: CLIENT_VALIDATION_SETTLE_TIMEOUT_MS,
  })
  const responsePromise = page.waitForResponse((response) => matchesMutation(response.request()), {
    timeout: ACTION_TIMEOUT_MS,
  }).then((response) => ({ response }), (error) => ({ error }))
  await action()
  try {
    await requestPromise
  } catch (error) {
    const visibleErrors = (await page.locator('.fb-runtime-field-error:visible').allTextContents())
      .map((text) => text.trim())
      .filter(Boolean)
    throw new Error([
      `${label}未发送请求，页面仍被本地校验拦截`,
      visibleErrors.length > 0 ? `可见错误：${visibleErrors.join('；')}` : '',
    ].filter(Boolean).join('；'), { cause: error })
  }
  const responseOutcome = await responsePromise
  if (responseOutcome.error) throw responseOutcome.error
  const { response } = responseOutcome
  const responseRead = await response.text().then(
    (text) => ({ text }),
    (error) => ({
      text: '',
      error: error instanceof Error ? error.message : String(error),
    }),
  )
  const responseText = responseRead.text
  let body = null
  let bodyValid = false
  try {
    body = responseText ? JSON.parse(responseText) : null
    bodyValid = isRecord(body)
  } catch {
    body = null
  }
  const httpSucceeded = response.ok()
  expect(
    httpSucceeded,
    `${label}接口应返回成功 HTTP 状态，实际 ${response.status()}`,
  ).toBe(true)
  let businessSucceeded = true
  if (expectBusinessSuccess) {
    if (!responseRead.error) {
      expect(bodyValid, `${label}接口应返回有效 JSON 对象`).toBe(true)
    }
    const hasBusinessCode = bodyValid && Object.prototype.hasOwnProperty.call(body, 'code')
    if (bodyValid) {
      expect(hasBusinessCode, `${label}接口响应应包含业务码`).toBe(true)
    }
    businessSucceeded = hasBusinessCode && Number(body.code) === 0
    if (hasBusinessCode) {
      expect(
        businessSucceeded,
        `${label}接口业务码应为 0，实际 ${String(body.code)}`,
      ).toBe(true)
    }
  }
  return {
    response,
    body: bodyValid ? body : {},
    httpSucceeded,
    businessSucceeded,
    ...(responseRead.error ? { bodyReadError: responseRead.error } : {}),
  }
}

function paginationActionButton(page) {
  return page.locator('.fb-runtime-pagination-buttons > button.fb-runtime-submit-button').last()
}

async function assertFieldError(card, label) {
  const error = card.locator('.fb-runtime-field-error').first()
  await expect(error, `“${label}”应显示字段校验错误`).toBeVisible({
    timeout: CLIENT_VALIDATION_SETTLE_TIMEOUT_MS,
  })
  await expect(error, `“${label}”字段校验错误不应为空`).toContainText(/\S+/)
}

async function assertClientValidationBlocked(page, {
  currentPage,
  expectedFields,
  getMutationCount,
  logger,
  mutationLabel = '分页',
  action = () => paginationActionButton(page).click(),
  pageFieldKeys = PAGE_FIELD_KEYS,
}) {
  const requestCountBefore = getMutationCount()
  await action()
  for (const { key, label } of expectedFields) {
    await assertFieldError(fieldCard(page, key), label)
  }
  await expect(fieldCard(page, pageFieldKeys[currentPage - 1][0]), `校验失败后应停留在第 ${currentPage} 页`).toBeVisible()
  const nextPageFirstKey = pageFieldKeys[currentPage]?.[0]
  if (nextPageFirstKey) {
    await expect(fieldCard(page, nextPageFirstKey), `校验失败后不应进入第 ${currentPage + 1} 页`).toBeHidden()
  } else {
    await expect(page, '最终提交校验失败后不应进入结果页').not.toHaveURL(SUBMISSION_RESULT_URL_PATTERN)
  }
  await page.waitForTimeout(100)
  expect(getMutationCount(), `客户端拦截时不应发送${mutationLabel}请求`).toBe(requestCountBefore)
  logger('info', `第 ${currentPage} 页客户端校验断言执行完成`, {
    fields: expectedFields.map((field) => field.label),
    requestCountBefore,
    requestCountAfter: getMutationCount(),
  })
}

function findNestedProperty(value, propertyName, visited = new WeakSet()) {
  if (!value || typeof value !== 'object' || visited.has(value)) return undefined
  visited.add(value)
  if (Object.prototype.hasOwnProperty.call(value, propertyName)) return value[propertyName]
  for (const child of Object.values(value)) {
    const found = findNestedProperty(child, propertyName, visited)
    if (found !== undefined) return found
  }
  return undefined
}

function assertRuleValidationRejected(body, key, label) {
  const validBody = Boolean(body && typeof body === 'object' && !Array.isArray(body))
  expect(validBody, `“${label}”规则校验接口应返回有效 JSON 对象`).toBe(true)
  const responseBody = validBody ? body : {}

  const hasBusinessCode = Object.prototype.hasOwnProperty.call(responseBody, 'code')
    && Number.isFinite(Number(responseBody.code))
  const businessCodeMessage = `“${label}”规则校验响应应包含有效业务码`
  expect(hasBusinessCode, businessCodeMessage).toBe(true)

  const businessCode = Number(responseBody.code)
  const rejectedMessage = `“${label}”越界值不应通过业务校验；validate-page 实际返回 businessCode: ${businessCode}`
  if (hasBusinessCode) expect(businessCode, rejectedMessage).not.toBe(0)

  const firstErrorItemKey = findNestedProperty(responseBody, 'first_error_item_key')
  const firstErrorMessage = `“${label}”应成为首个服务端错误字段`
  expect(firstErrorItemKey, firstErrorMessage).toBe(key)
  return businessCode
}

async function assertRuleValidationBlocked(page, publicOrigin, {
  currentPage,
  key,
  label,
  formId = FORM_ID,
  pathSuffix = `/f/form/${formId}/submission/validate-page`,
  logger,
  pageFieldKeys = PAGE_FIELD_KEYS,
}) {
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.origin === publicOrigin
      && url.pathname.endsWith(pathSuffix)
      && response.request().method() === 'POST'
  }, { timeout: CLIENT_VALIDATION_SETTLE_TIMEOUT_MS }).catch(() => null)

  await paginationActionButton(page).click()
  const card = fieldCard(page, key)
  const hasClientError = await card.locator('.fb-runtime-field-error').first()
    .waitFor({ state: 'visible', timeout: 400 })
    .then(() => true, () => false)
  const response = hasClientError ? null : await responsePromise
  if (hasClientError) {
    await assertFieldError(card, label)
    logger('success', `“${label}”越界值已被客户端规则拦截`)
  } else {
    if (!response) {
      const message = `“${label}”越界值应被客户端或服务端规则拦截`
      expect(response, message).toBeTruthy()
    } else {
      expect(
        response.ok(),
        `“${label}”规则校验接口应返回成功 HTTP 状态，实际 ${response.status()}`,
      ).toBe(true)
      const body = await response.json().catch(() => null)
      const businessCode = assertRuleValidationRejected(body, key, label)
      logger('success', `“${label}”越界值已被服务端规则拦截`, { businessCode })
    }
  }
  await dismissPublicErrorDialog(page)
  const currentPageCard = fieldCard(page, pageFieldKeys[currentPage - 1][0])
  const currentPageMessage = `“${label}”校验失败后应停留在第 ${currentPage} 页`
  await expect(currentPageCard, currentPageMessage).toBeVisible({ timeout: CLIENT_VALIDATION_SETTLE_TIMEOUT_MS })
  const nextPageFirstKey = pageFieldKeys[currentPage]?.[0]
  if (nextPageFirstKey) {
    const nextPageCard = fieldCard(page, nextPageFirstKey)
    const nextPageMessage = `“${label}”校验失败后不应翻页`
    await expect(nextPageCard, nextPageMessage).toBeHidden({ timeout: CLIENT_VALIDATION_SETTLE_TIMEOUT_MS })
  }
}

function isRetryablePageValidationError(error) {
  return error instanceof Error
    && error.name === 'PublicMutationError'
    && isRetryablePageValidationStatus(error.status)
}

function isRetryablePageValidationStatus(status) {
  return RETRYABLE_PAGE_VALIDATION_STATUSES.has(status)
}

async function dismissPublicErrorDialog(page) {
  const acknowledgement = page.getByRole('button', {
    name: /^(?:我已知晓|我已知曉|我知道了|知道了|Got it|OK)$/i,
  })
  if (await acknowledgement.isVisible().catch(() => false)) {
    await acknowledgement.click({ timeout: SELECT_VISIBILITY_TIMEOUT_MS })
    await flowExpect(page.locator('[role="dialog"]:visible')).toHaveCount(0, {
      timeout: SELECT_COMMIT_TIMEOUT_MS,
    })
  }
}

async function assertVisibleSubmissionResult(
  page,
  expectedFormIdOrOptions = FORM_ID,
  options = {},
) {
  const expectedFormId = typeof expectedFormIdOrOptions === 'string'
    ? expectedFormIdOrOptions
    : FORM_ID
  const { timeout = NAVIGATION_TIMEOUT_MS } = typeof expectedFormIdOrOptions === 'string'
    ? options
    : expectedFormIdOrOptions
  const result = page.locator(SUBMISSION_RESULT_SELECTOR)
  await expect(result, '提交后应挂载唯一的普通表单结果页组件').toHaveCount(1, { timeout })
  const resultCount = await result.count()
  if (resultCount !== 1) {
    expect(null, '结果页组件应属于当前表单').toBe(expectedFormId)
    expect(null, '结果页组件应包含有效提交 ID').toMatch(/\S+/)
    await expect(page.getByRole('heading', { level: 1 }).first(), '提交后应显示结果页主标题').toBeVisible({
      timeout,
    })
    return null
  }
  await expect(result, '结果页组件应属于当前表单').toHaveAttribute('form-id', expectedFormId, { timeout })
  await expect(result, '结果页组件应包含有效提交 ID').toHaveAttribute('submission-id', /\S+/, { timeout })
  await expect(page.getByRole('heading', { level: 1 }).first(), '提交后应显示结果页主标题').toBeVisible({
    timeout,
  })
  return result.getAttribute('submission-id')
}

async function goToNextPage(page, publicOrigin, currentPage, logger, formId = FORM_ID, pageFieldKeys = PAGE_FIELD_KEYS) {
  logger('info', `第 ${currentPage} 页填写完成，点击“下一页”并等待服务端分页校验`)
  const paginationButtons = page.locator('.fb-runtime-pagination-buttons > button.fb-runtime-submit-button')
  await expect(paginationButtons, `第 ${currentPage} 页应显示分页操作按钮`).not.toHaveCount(0)
  let validation
  for (let attempt = 1; attempt <= PAGE_VALIDATION_MAX_ATTEMPTS; attempt += 1) {
    try {
      validation = await waitForPublicMutation(
        page,
        publicOrigin,
        `/f/form/${formId}/submission/validate-page`,
        () => paginationButtons.last().click(),
        `第 ${currentPage} 页校验`,
      )
      if (
        !validation.httpSucceeded
        && isRetryablePageValidationStatus(validation.response.status())
        && attempt < PAGE_VALIDATION_MAX_ATTEMPTS
      ) {
        logger('warning', `第 ${currentPage} 页校验遇到临时服务错误，准备第 ${attempt + 1} 次尝试`, {
          attempt,
          status: validation.response.status(),
          method: validation.response.request().method(),
          url: validation.response.url(),
          response: validation.body,
        })
        await dismissPublicErrorDialog(page)
        await page.waitForTimeout(PAGE_VALIDATION_RETRY_DELAY_MS * attempt)
        continue
      }
      break
    } catch (error) {
      if (!isRetryablePageValidationError(error) || attempt === PAGE_VALIDATION_MAX_ATTEMPTS) throw error
      logger('warning', `第 ${currentPage} 页校验遇到临时服务错误，准备第 ${attempt + 1} 次尝试`, {
        attempt,
        status: error.status,
        method: error.method,
        url: error.url,
        response: error.responseSummary || '无响应正文',
      })
      await dismissPublicErrorDialog(page)
      await page.waitForTimeout(PAGE_VALIDATION_RETRY_DELAY_MS * attempt)
    }
  }
  if (!validation) throw new Error(`第 ${currentPage} 页校验未返回成功响应`)
  const nextPageFirstKey = pageFieldKeys[currentPage]?.[0]
  if (!nextPageFirstKey) throw new Error(`脚本未配置第 ${currentPage + 1} 页首个题目`)
  const nextPageFirstField = fieldCard(page, nextPageFirstKey)
  const pageTransitionMessage = `应进入第 ${currentPage + 1} 页`
  await expect(nextPageFirstField, pageTransitionMessage).toBeVisible({
    timeout: CLIENT_VALIDATION_SETTLE_TIMEOUT_MS,
  })
  await flowExpect(nextPageFirstField, pageTransitionMessage).toBeVisible({
    timeout: ACTION_TIMEOUT_MS,
  })
  logger('success', `第 ${currentPage} 页服务端校验通过，已进入第 ${currentPage + 1} 页`, {
    status: validation.response.status(),
    method: validation.response.request().method(),
    url: validation.response.url(),
  })
}

async function goToPreviousPage(page, currentPage, logger, pageFieldKeys = PAGE_FIELD_KEYS) {
  expect(currentPage, '只有第 2 页或第 3 页可以返回上一页').toBeGreaterThan(1)
  const paginationButtons = page.locator('.fb-runtime-pagination-buttons > button.fb-runtime-submit-button')
  await expect(paginationButtons, `第 ${currentPage} 页应显示上一页按钮`).not.toHaveCount(0)
  await paginationButtons.first().click()
  const previousPageFirstKey = pageFieldKeys[currentPage - 2]?.[0]
  await expect(fieldCard(page, previousPageFirstKey), `应返回第 ${currentPage - 1} 页`).toBeVisible()
  logger('success', `已从第 ${currentPage} 页返回第 ${currentPage - 1} 页`)
}

function parseSubmissionRequestPayload(request) {
  try {
    return request.postDataJSON()
  } catch {
    let raw
    try {
      raw = request.postData()
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      expect(false, `提交请求体读取失败：${reason}`).toBe(true)
      return {}
    }
    expect(Boolean(raw), '提交请求应包含 JSON 请求体').toBe(true)
    if (!raw) return {}
    try {
      return JSON.parse(raw)
    } catch {
      expect(false, '提交请求体应为有效 JSON').toBe(true)
      return {}
    }
  }
}

async function rankOptions(ranking, expectedOrder) {
  const rankedLabels = ranking.locator('.fb-runtime-ranking-ranked-list .fb-runtime-ranking-label')
  await ranking.scrollIntoViewIfNeeded()
  for (const [index, option] of expectedOrder.entries()) {
    const item = ranking.locator('.fb-runtime-ranking-item').filter({ hasText: option })
    await expect(item, `排序题应唯一显示“${option}”`).toHaveCount(1)
    await item.click({ force: true, timeout: SELECT_VISIBILITY_TIMEOUT_MS })
    await expect.poll(async () => (
      await rankedLabels.allTextContents()
    ).map((value) => value.trim()), {
      message: `排序题选择“${option}”后排名应稳定`,
      timeout: SELECT_VISIBILITY_TIMEOUT_MS,
    }).toEqual(expectedOrder.slice(0, index + 1))
  }
}

async function createUploadFixtures(runId, artifactWriter) {
  const onePixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  )
  const imageArtifact = await artifactWriter.writeFile(
    `fixtures/form-answer-${runId}.png`,
    onePixelPng,
    { type: 'fixture', mimeType: 'image/png' },
  )
  const fileArtifact = await artifactWriter.writeFile(
    `fixtures/form-answer-${runId}.txt`,
    `自动化测试表单附件\n运行时间戳：${runId}\n`,
    { type: 'fixture', mimeType: 'text/plain' },
  )
  return {
    imagePath: imageArtifact.absolutePath,
    filePath: fileArtifact.absolutePath,
  }
}

async function uploadAndAssert(card, filePath, label) {
  const input = card.locator('input[type="file"]')
  await expect(input, `“${label}”应包含文件选择控件`).toHaveCount(1)
  await input.setInputFiles(filePath)
  const fileName = filePath.split(/[\\/]/).pop()
  const uploadStatus = card.locator('.fb-runtime-upload-status')
  await expect(uploadStatus, `“${label}”应显示上传状态`).toBeVisible()
  if (label === '图片上传') {
    const previewImage = card.locator('.fb-runtime-upload-image-preview img')
    await expect(previewImage, '图片上传完成后应显示一个缩略图').toHaveCount(1)
    await expect(previewImage, '图片上传缩略图应可见').toBeVisible()
    await expect(previewImage, '图片上传结果应保留原文件名').toHaveAttribute('alt', fileName)
    await expect(previewImage, '图片上传结果应包含可访问地址').toHaveAttribute('src', /\S+/)
    return
  }
  await expect(card, `“${label}”上传完成后应回显文件名`).toContainText(fileName, {
    timeout: ACTION_TIMEOUT_MS,
  })
}

async function drawSignature(page, card, logger) {
  await card.locator('.fb-signature-empty-trigger').click()
  const dialog = page.locator('[role="dialog"]:visible').filter({ has: page.locator('canvas') })
  await expect(dialog, '点击签名题后应打开手写签名弹窗').toBeVisible()
  const canvas = dialog.locator('canvas')
  await expect(canvas, '签名弹窗应包含画布').toBeVisible()
  let box = await canvas.boundingBox()
  expect(box, '签名画布应有可绘制尺寸').toBeTruthy()
  if (!box) {
    await flowExpect.poll(async () => {
      box = await canvas.boundingBox()
      return box
    }, {
      message: '签名画布应在等待后获得可绘制尺寸',
      timeout: ACTION_TIMEOUT_MS,
    }).toBeTruthy()
  }
  const points = [
    [0.18, 0.62], [0.28, 0.35], [0.38, 0.68], [0.50, 0.28], [0.62, 0.64], [0.76, 0.42], [0.84, 0.58],
  ]
  await page.mouse.move(box.x + box.width * points[0][0], box.y + box.height * points[0][1])
  await page.mouse.down()
  for (const [x, y] of points.slice(1)) {
    await page.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 4 })
  }
  await page.mouse.up()
  const confirmButton = dialog.locator('button.fb-text-white')
  await expect(confirmButton, '签名弹窗应唯一显示主确认按钮').toHaveCount(1)
  await confirmButton.click()
  await expect(dialog, '确认并上传签名后弹窗应关闭').toBeHidden({ timeout: ACTION_TIMEOUT_MS })
  await expect(card.locator('.fb-signature-filled-surface'), '签名题应回显签名结果').toBeVisible()
  logger('success', '手写签名已通过画布完成并上传')
}

async function screenshotFailure(page, runId, artifactWriter) {
  return artifactWriter.captureScreenshot(
    page,
    `填写失败-${runId}.png`,
    { fullPage: true },
  )
}

export async function run({
  scriptId = SCRIPT_ID,
  scriptName = scriptId,
  artifactWriter,
  siteBaseUrl,
  requestPath = FORM_PATH,
  variables = {},
  extraHTTPHeaders,
  ignoreHTTPSErrors = false,
  signal,
  logger,
  recordApiResponse,
  recordResourceResponse,
}) {
  if (!siteBaseUrl) throw new Error('运行环境必须提供 Web 基址')
  if (!artifactWriter
    || typeof artifactWriter.writeFile !== 'function'
    || typeof artifactWriter.captureScreenshot !== 'function') {
    throw new Error('Runner 必须提供 artifactWriter')
  }
  const authorization = extraHTTPHeaders?.Authorization
  if (!authorization) throw new Error('平台运行上下文必须包含环境登录 Token')
  const formPath = normalizeFormPath(requestPath)
  const formUrl = buildFormUrl(siteBaseUrl, formPath)
  const publicOrigin = new URL(formUrl).origin
  const configuredFormId = new URL(formUrl).searchParams.get('id')?.trim()
  if (!configuredFormId) throw new Error('公开表单路径必须包含非空 form ID')
  const linkedFormContract = parseFormLinkContract(variables.FORM_CONTRACT)
  const data = createTestData()
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
    const fixtures = await createUploadFixtures(data.runId, artifactWriter)
    throwIfRunAborted(signal)
    logger('info', '已根据所选环境域名拼接公开表单地址', {
      scriptId,
      scriptName,
      selectedSiteBaseUrl: siteBaseUrl,
      publicOrigin,
      formPath,
      formUrl,
    })
    logger('info', '启动 Google Chrome 无头浏览器，后台模拟用户填写公开表单', {
      browser: 'Google Chrome',
      headless: true,
      formId: configuredFormId,
      formUrl,
    })
    logger('info', '公开填写页无需登录；环境 Token 仅用于平台鉴权，不会注入或发送到公开表单域名')

    browser = await launchGoogleChrome()
    stopAbortClose = closePlaywrightOnAbort(signal, () => ({ browser, context }), { logger })
    throwIfRunAborted(signal)
    context = await browser.newContext({
      ignoreHTTPSErrors,
      viewport: { width: 1440, height: 1000 },
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
    page.setDefaultTimeout(ACTION_TIMEOUT_MS)
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS)

    let publicRequestCount = 0
    let pageValidationRequestCount = 0
    let submissionRequestCount = 0
    const authorizationLeaks = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.origin !== publicOrigin) return
      publicRequestCount += 1
      if (request.method() === 'POST' && url.pathname.endsWith(`/f/form/${configuredFormId}/submission/validate-page`)) {
        pageValidationRequestCount += 1
      }
      if (request.method() === 'POST' && url.pathname.endsWith(`/f/form/${configuredFormId}/submission`)) {
        submissionRequestCount += 1
      }
      if (request.headers().authorization) {
        authorizationLeaks.push(`${request.method()} ${url.origin}${url.pathname}`)
      }
    })

    networkObserver.setPhase('公开表单加载')
    const publishedConfigResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return url.origin === publicOrigin
        && url.pathname.endsWith(`/f/form/${configuredFormId}`)
        && response.request().method() === 'GET'
    }, { timeout: NAVIGATION_TIMEOUT_MS })
    await page.goto(formUrl, { waitUntil: 'domcontentloaded' })
    const publishedConfigResponse = await publishedConfigResponsePromise
    expect(
      publishedConfigResponse.ok(),
      `公开表单配置接口应返回成功 HTTP 状态，实际 ${publishedConfigResponse.status()}`,
    ).toBe(true)
    const publishedConfigBody = await publishedConfigResponse.json().catch(() => null)
    const publishedContract = assertPublishedFormContract(
      publishedConfigBody,
      configuredFormId,
      linkedFormContract,
    )
    const FIELD_KEYS = publishedContract.fieldKeys
    const PAGE_FIELD_KEYS = publishedContract.pageFieldKeys
    const EXPECTED_FORM_TITLE = publishedContract.title
    await expect(page, '公开表单应保持在所选环境对应域名').toHaveURL(new RegExp(`^${publicOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`))
    expect(new URL(page.url()).searchParams.get('id'), '公开表单地址应保持为目标 form ID')
      .toBe(configuredFormId)
    await expect(page, '页面标题应与目标表单名称完全匹配').toHaveTitle(EXPECTED_FORM_TITLE)
    await expect(page.getByText(EXPECTED_FORM_TITLE, { exact: true }), '页面中应显示目标表单名称').toBeVisible()
    await expect(page.getByText(FORM_SUBTITLE, { exact: true }), '页面中应显示发布脚本配置的表单描述').toBeVisible()
    for (const text of [FORM_CONTENT_HEADING, ...FORM_CONTENT_ITEMS]) {
      await expect(page.getByText(text, { exact: true }), `页面中应显示填写须知“${text}”`).toBeVisible()
    }
    const pageLocale = await page.locator('html').getAttribute('lang')
    logger('info', '目标公开表单加载完成，发布脚本契约断言执行完成', {
      title: EXPECTED_FORM_TITLE,
      formId: configuredFormId,
      locale: pageLocale || 'unknown',
      revisionNo: publishedContract.revisionNo,
      requiredRootQuestionCount: publishedContract.requiredRootKeys.length,
      dateRange: publishedContract.dateRange,
    })

    networkObserver.setPhase('第 1 页空表校验')
    await assertCurrentPage(page, 1, PAGE_FIELD_KEYS[0], PAGE_FIELD_LABELS[0], PAGE_CARD_COUNTS[0], logger)
    await assertClientValidationBlocked(page, {
      currentPage: 1,
      expectedFields: PAGE_FIELD_KEYS[0].map((key, index) => ({ key, label: PAGE_FIELD_LABELS[0][index] })),
      getMutationCount: () => pageValidationRequestCount,
      pageFieldKeys: PAGE_FIELD_KEYS,
      logger,
    })
    networkObserver.setPhase('第 1 页重新加载')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await assertCurrentPage(page, 1, PAGE_FIELD_KEYS[0], PAGE_FIELD_LABELS[0], PAGE_CARD_COUNTS[0], logger)

    networkObserver.setPhase('第 1 页填写')
    const username = await assertField(page, FIELD_KEYS.username, '姓名')
    await selectOption(page, username.locator('[role="combobox"]'), data.nameTitle, '姓名-称谓', logger)
    await fillAndAssert(username.locator('input').first(), data.username, '姓名')
    const mobile = await assertField(page, FIELD_KEYS.mobile, '手机号')
    await expect(mobile.getByRole('combobox'), '手机号区号应为中国大陆 +86').toContainText('+86')
    await fillAndAssert(mobile.locator('input').first(), data.invalidMobile, '手机号非法边界值')
    const email = await assertField(page, FIELD_KEYS.email, '邮箱')
    await fillAndAssert(email.locator('input').first(), data.email, '邮箱')
    const idCard = await assertField(page, FIELD_KEYS.idCard, '身份证件')
    await expect(idCard.getByRole('combobox'), '证件类型应为身份证').toContainText(/身份证|身份證/)
    await fillAndAssert(idCard.locator('input').first(), data.idCard, '身份证件')
    const landline = await assertField(page, FIELD_KEYS.landlinePhone, '固定电话')
    await fillAndAssert(landline.locator('input').first(), data.landlinePhone, '固定电话')
    const address = await assertField(page, FIELD_KEYS.address, '地址')
    const addressSelects = address.locator('[role="combobox"]')
    data.province = await selectOption(page, addressSelects.nth(0), ADDRESS_OPTION_ALIASES.province, '地址-省份', logger)
    data.city = await selectOption(page, addressSelects.nth(1), ADDRESS_OPTION_ALIASES.city, '地址-城市', logger)
    data.district = await selectOption(page, addressSelects.nth(2), ADDRESS_OPTION_ALIASES.district, '地址-区县', logger)
    await fillAndAssert(address.locator('input').first(), data.street, '详细地址')
    const birthday = await assertField(page, FIELD_KEYS.birthday, '生日')
    const birthdaySelects = birthday.locator('[role="combobox"]')
    await selectOption(page, birthdaySelects.nth(0), data.birthday.year, '生日-年份', logger)
    await selectOption(page, birthdaySelects.nth(1), data.birthday.month, '生日-月份', logger)
    await selectOption(page, birthdaySelects.nth(2), data.birthday.day, '生日-日期', logger)

    networkObserver.setPhase('第 1 页服务端校验')
    await assertRuleValidationBlocked(page, publicOrigin, {
      currentPage: 1,
      key: FIELD_KEYS.mobile,
      label: '手机号',
      formId: configuredFormId,
      pageFieldKeys: PAGE_FIELD_KEYS,
      logger,
    })
    await replaceWithUserInputAndBlur(mobile.locator('input').first(), data.mobile, '手机号合法恢复值')
    await assertEmailFormatBoundary(email.locator('input').first(), data.invalidEmail, data.email)
    logger('success', '邮箱格式边界已通过原生 email 控件验证，并已恢复合法值')
    logger('info', '第 1 页联系人题目填写及逐项断言执行完成', {
      nameTitle: data.nameTitle,
      username: data.username,
      mobile: data.mobile,
      email: data.email,
      address: `${data.province}/${data.city}/${data.district}/${data.street}`,
      birthday: `${data.birthday.year}-${data.birthday.month}-${data.birthday.day}`,
    })
    networkObserver.setPhase('第 1 页翻页')
    await goToNextPage(page, publicOrigin, 1, logger, configuredFormId, PAGE_FIELD_KEYS)

    networkObserver.setPhase('第 2 页填写')
    await assertCurrentPage(page, 2, PAGE_FIELD_KEYS[1], PAGE_FIELD_LABELS[1], PAGE_CARD_COUNTS[1], logger)
    const input = await assertField(page, FIELD_KEYS.input, '单行文本')
    const singleLineInput = input.locator('input').first()
    await singleLineInput.fill(data.singleLineTooLong)
    const overLimitSingleLineValue = await singleLineInput.inputValue()
    expect(overLimitSingleLineValue.length, '单行文本控件不应把 21 字边界值扩展为更长内容').toBeLessThanOrEqual(21)
    if (overLimitSingleLineValue.length <= 20) {
      expect(overLimitSingleLineValue, '单行文本控件截断后应精确保留 20 字边界值').toBe(data.singleLine)
      logger('success', '单行文本第 21 字已被控件按 max=20 截断')
    }
    const textarea = await assertField(page, FIELD_KEYS.textarea, '多行文本')
    await fillAndAssert(textarea.locator('textarea').first(), data.multiLine, '多行文本')
    const radio = await assertField(page, FIELD_KEYS.radio, '单项选择')
    const radioControls = radio.locator('.fb-ui-radio-group-item')
    await expect(radioControls, '单项选择应显示 3 个选项控件').toHaveCount(3)
    const radioImages = radio.locator('img')
    await expect(radioImages, '单项选择前两个选项应实际渲染图片').toHaveCount(2)
    for (let index = 0; index < 2; index += 1) {
      await expect(radioImages.nth(index), `单项选择第 ${index + 1} 张图片应包含地址`).toHaveAttribute('src', /^https?:\/\//)
    }
    const customizedRadio = radioControls.nth(2)
    await customizedRadio.click()
    await expect(customizedRadio, '单项选择“其他”应进入选中状态').toHaveAttribute('data-state', 'checked')
    const customizedRadioInput = radio.locator('input[type="text"]:visible')
    await expect(customizedRadioInput, '选择“其他”后应显示一个自定义文本输入框').toHaveCount(1)
    await fillAndAssert(customizedRadioInput, '其他边界选项', '单项选择-其他')
    const radioChoice = radioControls.nth(data.radioIndex)
    await radioChoice.click()
    await expect(radioChoice, '单项选择应选中“选项1”').toHaveAttribute('data-state', 'checked')
    await expect(customizedRadio, '切回普通选项后“其他”应取消选中').toHaveAttribute('data-state', 'unchecked')
    const checkbox = await assertField(page, FIELD_KEYS.checkbox, '多项选择')
    const checkboxControls = checkbox.locator('.fb-ui-checkbox-root')
    await expect(checkboxControls, '多项选择应显示 3 个选项控件').toHaveCount(3)
    await checkboxControls.nth(0).click()
    await expect(checkboxControls.nth(0), '多项选择应先只选 1 项以覆盖最小值下界').toHaveAttribute('data-state', 'checked')
    const select = await assertField(page, FIELD_KEYS.select, '下拉选择')
    await selectOption(page, select.locator('[role="combobox"]'), data.select, '下拉选择', logger)
    const number = await assertField(page, FIELD_KEYS.number, '数字')
    const numberInput = number.locator('input').first()
    await fillAndAssert(numberInput, data.numberTooLarge, '数字上边界越界值')
    const date = await assertField(page, FIELD_KEYS.date, '日期')
    const dateTrigger = date.locator('button').first()
    const datePlaceholder = (await dateTrigger.innerText()).trim()
    await dateTrigger.click()
    const dateOverlay = page.locator('[data-fb-date-overlay]')
    await expect(dateOverlay, '日期题应打开日期面板').toBeVisible()
    await expect(dateOverlay.locator('button[disabled]'), '日期面板应禁用范围外日期').not.toHaveCount(0)
    await expect(dateOverlay.locator('button:not([disabled])'), '日期面板应保留范围内可选日期').not.toHaveCount(0)
    await dateOverlay.locator('button.fb-ring-1:not([disabled])').click()
    await expect.poll(async () => (await dateTrigger.innerText()).trim(), {
      message: '日期题选择日期后应更新回显',
    }).not.toBe(datePlaceholder)
    data.selectedDate = (await dateTrigger.innerText()).trim()
    const time = await assertField(page, FIELD_KEYS.time, '时间')
    const timeTrigger = time.locator('button').first()
    const timePlaceholder = (await timeTrigger.innerText()).trim()
    await timeTrigger.click()
    const timePanel = page.locator('.fb-timepicker-container:visible')
    await expect(timePanel, '时间题应打开时间面板').toBeVisible()
    const timeActions = timePanel.locator('button.fb-h-7.fb-min-w-14')
    await expect(timeActions, '时间面板应显示设为当前时间和确认两个操作').toHaveCount(2)
    await timeActions.nth(0).click()
    await timeActions.nth(1).click()
    await expect(timePanel, '确认时间后时间面板应关闭').toBeHidden()
    await expect.poll(async () => (await timeTrigger.innerText()).trim(), {
      message: '时间题选择时间后应更新回显',
    }).not.toBe(timePlaceholder)
    data.selectedTime = (await timeTrigger.innerText()).trim()
    const imageUpload = await assertField(page, FIELD_KEYS.imageUpload, '图片上传')
    await uploadAndAssert(imageUpload, fixtures.imagePath, '图片上传')
    const fileUpload = await assertField(page, FIELD_KEYS.fileUpload, '文件上传')
    await uploadAndAssert(fileUpload, fixtures.filePath, '文件上传')

    networkObserver.setPhase('第 2 页规则校验')
    if (overLimitSingleLineValue.length > 20) {
      await assertRuleValidationBlocked(page, publicOrigin, {
        currentPage: 2,
        key: FIELD_KEYS.input,
        label: '单行文本 21 字边界',
        formId: configuredFormId,
        pageFieldKeys: PAGE_FIELD_KEYS,
        logger,
      })
      await replaceWithUserInputAndBlur(singleLineInput, data.singleLine, '单行文本 20 字合法上边界')
    }
    await assertRuleValidationBlocked(page, publicOrigin, {
      currentPage: 2,
      key: FIELD_KEYS.checkbox,
      label: '多项选择仅 1 项',
      formId: configuredFormId,
      pageFieldKeys: PAGE_FIELD_KEYS,
      logger,
    })
    await checkboxControls.nth(1).click()
    await expect(checkbox.locator('.fb-ui-checkbox-root[data-state="checked"]'), '多项选择选 2 项应达到合法最小边界').toHaveCount(2)
    await checkboxControls.nth(2).click()
    await expect(checkbox.locator('.fb-ui-checkbox-root[data-state="checked"]'), '多项选择选满 3 项应达到合法最大边界').toHaveCount(3)

    await assertRuleValidationBlocked(page, publicOrigin, {
      currentPage: 2,
      key: FIELD_KEYS.number,
      label: '数字 100.01 越过上边界',
      formId: configuredFormId,
      pageFieldKeys: PAGE_FIELD_KEYS,
      logger,
    })
    await replaceWithUserInputAndBlur(numberInput, data.number, '数字 100.00 合法上边界')
    logger('info', '第 2 页通用题目填写及逐项断言执行完成', {
      radio: data.radio,
      checkbox: data.checkbox,
      select: data.select,
      number: data.number,
      date: data.selectedDate,
      time: data.selectedTime,
      imageFixture: fixtures.imagePath,
      fileFixture: fixtures.filePath,
    })
    networkObserver.setPhase('第 2 页翻页')
    await goToNextPage(page, publicOrigin, 2, logger, configuredFormId, PAGE_FIELD_KEYS)

    networkObserver.setPhase('跨页答案保持')
    await assertCurrentPage(page, 3, PAGE_FIELD_KEYS[2], PAGE_FIELD_LABELS[2], PAGE_CARD_COUNTS[2], logger)
    await goToPreviousPage(page, 3, logger, PAGE_FIELD_KEYS)
    await assertCurrentPage(page, 2, PAGE_FIELD_KEYS[1], PAGE_FIELD_LABELS[1], PAGE_CARD_COUNTS[1], logger)
    await expect(fieldCard(page, FIELD_KEYS.input).locator('input').first(), '跨页返回后单行文本 20 字边界答案不应丢失')
      .toHaveValue(data.singleLine)
    await expect(fieldCard(page, FIELD_KEYS.textarea).locator('textarea').first(), '跨页返回后多行文本答案不应丢失')
      .toHaveValue(data.multiLine)
    await expect(fieldCard(page, FIELD_KEYS.number).locator('input').first(), '跨页返回后数字上边界答案不应丢失')
      .toHaveValue(data.number)
    await expect(fieldCard(page, FIELD_KEYS.checkbox).locator('.fb-ui-checkbox-root[data-state="checked"]'), '跨页返回后多选最大边界答案不应丢失')
      .toHaveCount(3)
    await expect(fieldCard(page, FIELD_KEYS.imageUpload).locator('.fb-runtime-upload-image-preview img'), '跨页返回后图片上传结果不应丢失')
      .toHaveAttribute('alt', fixtures.imagePath.split(/[\\/]/).pop())
    await expect(fieldCard(page, FIELD_KEYS.fileUpload), '跨页返回后文件上传结果不应丢失')
      .toContainText(fixtures.filePath.split(/[\\/]/).pop())
    logger('success', '上一页/下一页往返后，文本、选择、数字和上传答案均保持')
    await goToNextPage(page, publicOrigin, 2, logger, configuredFormId, PAGE_FIELD_KEYS)
    await assertCurrentPage(page, 3, PAGE_FIELD_KEYS[2], PAGE_FIELD_LABELS[2], PAGE_CARD_COUNTS[2], logger)
    networkObserver.setPhase('第 3 页空表校验')
    await assertClientValidationBlocked(page, {
      currentPage: 3,
      expectedFields: [
        { key: FIELD_KEYS.cascader, label: '级联选择' },
        { key: FIELD_KEYS.signature, label: '手写签名' },
        { key: FIELD_KEYS.matrix, label: '矩阵题' },
        { key: FIELD_KEYS.matrixChoice, label: '矩阵选择' },
        { key: FIELD_KEYS.ranking, label: '排序题' },
        { key: FIELD_KEYS.rating, label: '评分题' },
        { key: FIELD_KEYS.nps, label: 'NPS' },
      ],
      getMutationCount: () => submissionRequestCount,
      mutationLabel: '最终提交',
      pageFieldKeys: PAGE_FIELD_KEYS,
      action: () => page.locator('.fb-runtime-submit-button-wrap button.fb-runtime-submit-button').click(),
      logger,
    })
    await expect(fieldCard(page, FIELD_KEYS.fieldGroup).locator('.fb-runtime-field-error'), '空题组实例应只拦截必填的姓名和手机号，邮箱保持可选')
      .toHaveCount(2)
    networkObserver.setPhase('第 3 页填写')
    const cascader = await assertField(page, FIELD_KEYS.cascader, '级联选择')
    const cascaderTrigger = cascader.locator('.fb-runtime-cascader-trigger')
    await selectCascaderPath(page, cascaderTrigger, data.cascader, logger)
    const signature = await assertField(page, FIELD_KEYS.signature, '手写签名')
    await drawSignature(page, signature, logger)
    const fieldGroup = await assertField(page, FIELD_KEYS.fieldGroup, '题组')
    const groupInstances = fieldGroup.locator('.fb-runtime-field-group-instance')
    await expect(groupInstances, '题组应默认显示一个信息实例').toHaveCount(1)
    const groupContent = groupInstances.first().locator('.fb-runtime-field-group-instance-content')
    await expect(groupContent, '题组实例内容应可见').toBeVisible()
    const groupInputs = groupContent.locator('input')
    await expect(groupInputs, '题组实例应包含姓名、手机号和邮箱三个输入控件').toHaveCount(3)
    await fillAndAssert(groupInputs.nth(0), data.groupUsername, '题组-姓名')
    await expect(groupContent.getByRole('combobox'), '题组手机号区号应为中国大陆 +86').toContainText('+86')
    await fillAndAssert(groupInputs.nth(1), data.groupMobile, '题组-手机号')
    await fillAndAssert(groupInputs.nth(2), data.groupEmail, '题组-邮箱')
    await assertField(page, FIELD_KEYS.description, '描述说明')
    await assertField(page, FIELD_KEYS.divider, '分割线')
    const matrix = await assertField(page, FIELD_KEYS.matrix, '矩阵题')
    const matrixInputs = matrix.locator('tbody input[type="text"]')
    await expect(matrixInputs, '矩阵题应有 3×3 共 9 个输入格').toHaveCount(9)
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        const value = data.matrix[row][column]
        const cell = matrixInputs.nth(row * 3 + column)
        await cell.fill(value)
        await expect(cell, `矩阵题“题目${row + 1}/项目${column + 1}”应回显匹配答案`).toHaveValue(value)
      }
    }
    const matrixChoice = await assertField(page, FIELD_KEYS.matrixChoice, '矩阵选择')
    const matrixRadios = matrixChoice.getByRole('radio')
    await expect(matrixRadios, '矩阵选择应有 3×3 共 9 个选项').toHaveCount(9)
    for (const index of data.matrixChoiceIndexes) {
      await matrixRadios.nth(index).click()
      await expect(matrixRadios.nth(index), `矩阵选择第 ${Math.floor(index / 3) + 1} 行应选中目标列`).toBeChecked()
    }
    const ranking = await assertField(page, FIELD_KEYS.ranking, '排序题')
    await rankOptions(ranking, data.ranking)
    const rankedLabels = await ranking.locator('.fb-runtime-ranking-ranked-list .fb-runtime-ranking-label').allTextContents()
    expect(rankedLabels.map((value) => value.trim()), '排序题顺序应与测试数据完全匹配').toEqual(data.ranking)
    const rating = await assertField(page, FIELD_KEYS.rating, '评分题')
    const ratingButtons = rating.locator('button.rating-item')
    await expect(ratingButtons, '评分题应显示 5 个评分按钮').toHaveCount(5)
    await ratingButtons.first().click()
    await expect(ratingButtons.first().locator('.rating-icon--accent'), '评分题应支持选择 1 分下边界').toBeVisible()
    await ratingButtons.nth(data.rating - 1).click()
    await expect(ratingButtons.nth(data.rating - 1).locator('.rating-icon--accent'), '评分题应选择 5 分').toBeVisible()
    const nps = await assertField(page, FIELD_KEYS.nps, 'NPS')
    const npsButtons = nps.locator('button.nps-scale__score-btn')
    await expect(npsButtons, 'NPS 应显示 1 到 10 共 10 个分值').toHaveCount(10)
    const npsMinimumButton = npsButtons.filter({ hasText: /^1$/ })
    await npsMinimumButton.click()
    await expect(npsMinimumButton, 'NPS 应支持选择 1 分下边界').toHaveClass(/fb-text-white/)
    const npsButton = nps.locator('button.nps-scale__score-btn').filter({ hasText: new RegExp(`^${data.nps}$`) })
    await npsButton.click()
    await expect(npsButton, 'NPS 应支持选择 10 分上边界').toHaveClass(/fb-text-white/)
    await expect(npsMinimumButton, '选择 NPS 10 分后，1 分应取消选中').not.toHaveClass(/fb-text-white/)
    logger('info', '第 3 页高级题目和题组填写及逐项断言执行完成', {
      cascader: data.cascader,
      groupUsername: data.groupUsername,
      groupMobile: data.groupMobile,
      groupEmail: data.groupEmail,
      matrixCells: 9,
      matrixChoice: ['题目1/选项1', '题目2/选项2', '题目3/选项3'],
      ranking: data.ranking,
      rating: data.rating,
      nps: data.nps,
    })

    networkObserver.setPhase('最终提交')
    logger('info', '所有题目填写完成，点击“提交”并等待提交接口响应')
    const submission = await waitForPublicMutation(
      page,
      publicOrigin,
      `/f/form/${configuredFormId}/submission`,
      () => page.locator('.fb-runtime-submit-button-wrap button.fb-runtime-submit-button').click(),
      '提交表单',
      { expectBusinessSuccess: false },
    )
    const requestPayload = parseSubmissionRequestPayload(submission.response.request())
    const payloadAssertion = assertSubmissionPayload(requestPayload, data, publishedContract)
    const responseSubmissionId = String(
      submission.body?.data?.submission_id
      ?? submission.body?.data?.id
      ?? submission.body?.submission_id
      ?? '',
    )
    networkObserver.setPhase('提交结果验证')
    await expect(page, '提交后应进入普通表单结果页').toHaveURL(SUBMISSION_RESULT_URL_PATTERN, {
      timeout: NAVIGATION_TIMEOUT_MS,
    })
    const renderedSubmissionId = await assertVisibleSubmissionResult(page, configuredFormId)
    if (responseSubmissionId) {
      expect(renderedSubmissionId, '结果页组件的提交 ID 应与提交接口响应一致').toBe(responseSubmissionId)
    }
    const submissionId = responseSubmissionId || renderedSubmissionId || ''
    expect(authorizationLeaks, '公开表单域名的所有请求都不应携带后台环境 Token').toEqual([])
    expect(publicRequestCount, '应观察到公开表单域名的业务请求').toBeGreaterThan(0)
    expect(submissionRequestCount, '必填失败不应误提交，整个脚本只应产生一次最终提交请求').toBe(1)
    logger('success', '新表单提交成功，题目、答案和提交请求业务断言执行完成', {
      formId: configuredFormId,
      submissionId: submissionId || '响应未返回可识别 ID',
      publicRequestCount,
      pageValidationRequestCount,
      submissionRequestCount,
      assertedAnswerFieldCount: payloadAssertion.answerFieldCount,
      indexedSubmissionFieldCount: payloadAssertion.indexedFieldCount,
      authorizationLeakCount: authorizationLeaks.length,
      token: '[REDACTED]',
    })

    networkObserver.setPhase('运行结果汇总')
    return {
      scriptId,
      scriptName,
      formId: configuredFormId,
      formUrl,
      title: EXPECTED_FORM_TITLE,
      submissionId,
      status: 'submitted',
      browser: 'chrome',
      headless: true,
      pageCount: 3,
      fieldCount: PAGE_FIELD_LABELS.flat().length,
      fieldKeys: FIELD_KEYS,
      linkedContractUsed: Boolean(linkedFormContract),
      publicRequestCount,
      pageValidationRequestCount,
      submissionRequestCount,
      assertedAnswerFieldCount: payloadAssertion.answerFieldCount,
      authorizationLeakCount: authorizationLeaks.length,
    }
  } catch (error) {
    if (signal?.aborted) {
      logger('info', '已响应强制停止，正在清理 Chrome 无头浏览器')
    } else if (page) {
      try {
        const screenshot = await screenshotFailure(page, data.runId, artifactWriter)
        logger('error', `脚本“${scriptName}”执行失败，已保存当前页面全页截图`, {
          scriptId,
          scriptName,
          screenshotPath: screenshot.absolutePath,
          artifact: screenshot,
        })
      } catch (screenshotError) {
        logger('error', `脚本“${scriptName}”执行失败，当前页面截图保存失败`, {
          scriptId,
          scriptName,
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

export {
  EXPECTED_FORM_TITLE,
  FIELD_KEYS,
  FORM_ID,
  FORM_PATH,
  PAGE_CARD_COUNTS,
  PAGE_FIELD_KEYS,
  PAGE_FIELD_LABELS,
  PUBLISHED_FIELD_TYPES,
  REQUIRED_ROOT_FIELD_KEYS,
  SUBMISSION_RESULT_SELECTOR,
  SUBMISSION_RESULT_URL_PATTERN,
  assertEmailFormatBoundary,
  assertPublishedFormContract,
  assertRuleValidationRejected,
  assertRuleValidationBlocked,
  assertSubmissionPayload,
  assertVisibleSubmissionResult,
  buildFormUrl,
  createTestData,
  dismissPublicErrorDialog,
  indexSubmissionEntries,
  isRetryablePageValidationStatus,
  normalizeFormPath,
  parseSubmissionRequestPayload,
  selectOption,
  waitForPublicMutation,
}
