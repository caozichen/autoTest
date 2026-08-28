const FIELD_TYPE_CODES = Object.freeze({
  username: 'username',
  mobile: 'mobile',
  email: 'email',
  idCard: 'id_card',
  landlinePhone: 'landline_phone',
  address: 'address',
  birthday: 'birthday',
  input: 'input',
  textarea: 'textarea',
  radio: 'radio',
  checkbox: 'checkbox',
  select: 'select',
  number: 'number',
  date: 'date',
  time: 'time',
  imageUpload: 'image_upload',
  fileUpload: 'file_upload',
  cascader: 'cascader',
  signature: 'signature',
  fieldGroup: 'field_group',
  description: 'description',
  divider: 'divider',
  matrix: 'matrix',
  matrixChoice: 'matrix_choice',
  ranking: 'sort',
  rating: 'rating',
  nps: 'nps',
})

const PAGE_FIELD_NAMES = Object.freeze([
  ['username', 'mobile', 'email', 'idCard', 'landlinePhone', 'address', 'birthday'],
  ['input', 'textarea', 'radio', 'checkbox', 'select', 'number', 'date', 'time', 'imageUpload', 'fileUpload'],
  ['cascader', 'signature', 'fieldGroup', 'description', 'divider', 'matrix', 'matrixChoice', 'ranking', 'rating', 'nps'],
])
const SYSTEM_ITEM_KEYS = new Set([
  'duration',
  'device',
  'os',
  'browser',
  'region',
  'ip',
  'lingxi_openid',
  'team_openid',
])

function itemKey(item) {
  return typeof item?.item_key === 'string' ? item.item_key.trim() : ''
}

function rootItem(items, typeCode) {
  return items.find((item) => (
    item?.type_code === typeCode
    && !item?.group_code
    && itemKey(item)
    && !SYSTEM_ITEM_KEYS.has(itemKey(item))
  ))
}

export function resolveFormFieldKeys(items, fallback = {}) {
  const sourceItems = Array.isArray(items) ? items : []
  const fieldKeys = {}
  for (const [name, typeCode] of Object.entries(FIELD_TYPE_CODES)) {
    fieldKeys[name] = itemKey(rootItem(sourceItems, typeCode)) || fallback[name] || ''
  }

  const groupKey = fieldKeys.fieldGroup
  const groupItems = groupKey
    ? sourceItems.filter((item) => item?.group_code === groupKey)
    : []
  for (const [name, typeCode] of [
    ['groupUsername', 'username'],
    ['groupMobile', 'mobile'],
    ['groupEmail', 'email'],
  ]) {
    fieldKeys[name] = itemKey(groupItems.find((item) => item?.type_code === typeCode))
      || fallback[name]
      || ''
  }
  return fieldKeys
}

export function pageFieldKeysFor(fieldKeys, { includeLayout = true } = {}) {
  return PAGE_FIELD_NAMES.map((page) => page
    .filter((name) => includeLayout || !['description', 'divider'].includes(name))
    .map((name) => fieldKeys[name])
    .filter(Boolean))
}

export function createFormLinkContract({
  formId,
  formCode,
  title,
  revisionNo,
  items,
}) {
  const contractItems = Array.isArray(items)
    ? items.filter((item) => (
        item
        && typeof item === 'object'
        && Number(item.hidden) !== 1
        && !SYSTEM_ITEM_KEYS.has(itemKey(item))
      ))
    : []
  const fieldKeys = resolveFormFieldKeys(contractItems)
  return {
    version: 1,
    formId: String(formId ?? '').trim(),
    formCode: String(formCode ?? '').trim(),
    title: String(title ?? '').trim(),
    revisionNo: Number(revisionNo) || 0,
    fieldKeys,
    pageFieldKeys: pageFieldKeysFor(fieldKeys),
    items: structuredClone(contractItems),
  }
}

export function parseFormLinkContract(value) {
  if (value === undefined || value === null || value === '') return null
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new Error('FORM_CONTRACT 不是有效 JSON，请检查前序脚本的参数映射')
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('FORM_CONTRACT 必须是 JSON 对象')
  }
  return parsed
}

export function firstFormCode(...sources) {
  for (const source of sources) {
    const candidates = [
      source?.formCode,
      source?.form_code,
      source?.data?.form_code,
      source?.data?.form?.form_code,
      source?.data?.form?.code,
      source?.form?.form_code,
      source?.form?.code,
    ]
    const value = candidates.find((candidate) => String(candidate ?? '').trim())
    if (value !== undefined) return String(value).trim()
  }
  return ''
}

export { FIELD_TYPE_CODES, PAGE_FIELD_NAMES }
