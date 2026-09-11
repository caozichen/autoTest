function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function jsonForInlineScript(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
}

export const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

const FIXED_BASIC_FIELDS = Object.freeze([
  { key: 'special_code', label: '特殊编号' },
  { key: 'source_text', label: '来源', filterKey: 'filter[source]' },
  { key: 'created_at', label: '提交时间', filterKey: 'filter[created_at_between]' },
  { key: 'updated_at', label: '更新时间' },
  { key: 'revision_no', label: '版本号', filterKey: 'filter[revision_no]' },
])

export const SEARCHABLE_SUBMISSION_FIELDS = Object.freeze([
  { typeCode: 'username', itemKey: 'username_gxacbx', label: '姓名' },
  { typeCode: 'mobile', itemKey: 'mobile_rloaox', label: '手机号' },
  { typeCode: 'email', itemKey: 'email_ewgfmt', label: '邮箱' },
  { typeCode: 'idCard', itemKey: 'idCard_rqhjya', label: '身份证件' },
  { typeCode: 'landlinePhone', itemKey: 'landlinePhone_jhctzz', label: '固定电话' },
  { typeCode: 'address', itemKey: 'address_polpdi', label: '地址' },
  { typeCode: 'birthday', itemKey: 'birthday_pwwumq', label: '生日' },
  { typeCode: 'input', itemKey: 'input_grnbqf', label: '单行文本' },
  { typeCode: 'textarea', itemKey: 'textarea_uoaqwk', label: '多行文本' },
  { typeCode: 'radio', itemKey: 'radio_ufvmqb', label: '单项选择' },
  { typeCode: 'checkbox', itemKey: 'checkbox_svokli', label: '多项选择' },
  { typeCode: 'select', itemKey: 'select_roqpue', label: '下拉选择' },
  { typeCode: 'number', itemKey: 'number_ntadms', label: '数字' },
  { typeCode: 'date', itemKey: 'date_noeowe', label: '日期' },
  { typeCode: 'time', itemKey: 'time_rjlvvy', label: '时间' },
].map((field) => Object.freeze({
  ...field,
  basicKey: `dyn_${field.itemKey}`,
  filterKey: `filter[${field.itemKey}]`,
})))

const NON_SEARCHABLE_DYNAMIC_FIELDS = Object.freeze([
  {
    typeCode: 'imageUpload',
    itemKey: 'imageUpload_bfqtfy',
    basicKey: 'dyn_imageUpload_bfqtfy',
    label: '图片上传',
  },
  {
    typeCode: 'fileUpload',
    itemKey: 'fileUpload_rxujmv',
    basicKey: 'dyn_fileUpload_rxujmv',
    label: '文件上传',
  },
  {
    typeCode: 'channel',
    itemKey: 'channel',
    basicKey: 'dyn_channel',
    label: 'channel',
  },
])

export const BASIC_SUBMISSION_FIELDS = Object.freeze([
  ...FIXED_BASIC_FIELDS,
  ...SEARCHABLE_SUBMISSION_FIELDS.map(({ basicKey: key, label, filterKey }) => ({
    key,
    label,
    filterKey,
  })),
  ...NON_SEARCHABLE_DYNAMIC_FIELDS.map(({ basicKey: key, label }) => ({ key, label })),
].map((field) => Object.freeze(field)))

export const SUBMISSION_SEARCH_FIELDS = Object.freeze([
  { key: 'filter[source]', label: '来源', kind: 'source', basicKey: 'source_text' },
  {
    key: 'filter[created_at_between]',
    label: '提交时间',
    kind: 'date-range',
    basicKey: 'created_at',
  },
  { key: 'filter[revision_no]', label: '版本号', kind: 'revision', basicKey: 'revision_no' },
  ...SEARCHABLE_SUBMISSION_FIELDS.map(({ filterKey: key, label, basicKey, itemKey }) => ({
    key,
    label,
    kind: 'text',
    basicKey,
    itemKey,
  })),
].map((field) => Object.freeze(field)))

if (BASIC_SUBMISSION_FIELDS.length !== 23 || SUBMISSION_SEARCH_FIELDS.length !== 18) {
  throw new Error('提报列表 fixture 字段数量与线上结构不一致')
}

const UI_TEXT = Object.freeze({
  'zh-CN': Object.freeze({
    back: '返回',
    published: '已发布',
    contactTag: '联系人',
    submissionTab: '提报详情',
    contactTab: '联系人信息',
    search: '查询',
    reset: '重设',
    expand: '展开',
    operation: '操作',
    view: '查看',
    settingsTitle: '自定义列表字段',
    basicGroup: '基础字段',
    searchGroup: '检索字段',
    confirm: '确认',
    cancel: '取消',
    source: '来源',
    submittedAt: '提交时间',
    updatedAt: '更新时间',
    revision: '版本号',
    specialCode: '特殊编号',
    name: '姓名',
    mobile: '手机号',
    choose: '请选择',
    input: '请输入',
    startDate: '开始日期',
    endDate: '结束日期',
    total: '共 {count} 条',
  }),
  'zh-TW': Object.freeze({
    back: '返回',
    published: '已發佈',
    contactTag: '聯絡人',
    submissionTab: '提報詳情',
    contactTab: '聯絡人資訊',
    search: '查詢',
    reset: '重設',
    expand: '展開',
    operation: '操作',
    view: '檢視',
    settingsTitle: '自訂列表欄位',
    basicGroup: '基礎欄位',
    searchGroup: '檢索欄位',
    confirm: '確認',
    cancel: '取消',
    source: '來源',
    submittedAt: '提交時間',
    updatedAt: '更新時間',
    revision: '版本號',
    specialCode: '特殊編號',
    name: '姓名',
    mobile: '手機號',
    choose: '請選擇',
    input: '請輸入',
    startDate: '開始日期',
    endDate: '結束日期',
    total: '共 {count} 條',
  }),
  en: Object.freeze({
    back: 'Back',
    published: 'Published',
    contactTag: 'Contact',
    submissionTab: 'Submission details',
    contactTab: 'Contact information',
    search: 'Search',
    reset: 'Reset',
    expand: 'Expand',
    operation: 'Actions',
    view: 'View',
    settingsTitle: 'Custom list fields',
    basicGroup: 'Basic fields',
    searchGroup: 'Search fields',
    confirm: 'Confirm',
    cancel: 'Cancel',
    source: 'Source',
    submittedAt: 'Submitted at',
    updatedAt: 'Updated at',
    revision: 'Revision',
    specialCode: 'Special code',
    name: 'Name',
    mobile: 'Mobile',
    choose: 'Please select',
    input: 'Please enter',
    startDate: 'Start date',
    endDate: 'End date',
    total: '{count} total',
  }),
})

export function createSubmissionListFixture({
  formId = 'fixture-form-id',
  submissionId = 'fixture-submission-id',
  title = '自动化测试全题型表单-1788940800000',
  primaryContactName = '自动化测试用户3858',
  groupContactName = '题组联系人3859',
} = {}) {
  const answersByType = {
    username: primaryContactName,
    mobile: '+86-13912343858',
    email: 'autotest_1788940800000@example.com',
    idCard: '身份证: 11010519491231002X',
    landlinePhone: '0755-12345678',
    address: '广东省深圳市南山区自动化测试地址3858号',
    birthday: '公历: 1990-08-18',
    input: '边界测试1234567890123456',
    textarea: '多行文本自动化答案 运行时间戳：1788940800000',
    radio: '选项一甲',
    checkbox: '选项一甲,选项二乙,选项三丙',
    select: '下拉选项二乙',
    number: '100.00',
    date: '2026-09-09',
    time: '14:35:28',
    imageUpload: 'form-answer-1788940800000.png',
    fileUpload: 'form-answer-1788940800000.txt',
    channel: '-',
  }
  const dynamicFields = [...SEARCHABLE_SUBMISSION_FIELDS, ...NON_SEARCHABLE_DYNAMIC_FIELDS]
  const items = dynamicFields.map(({ itemKey, typeCode, label }) => ({
    item_key: itemKey,
    type_code: typeCode,
    title: label,
  }))
  items.push({
    item_key: 'group_username_fixture',
    type_code: 'username',
    title: '姓名',
    parent_item_key: 'field_group_fixture',
  })
  const answers = dynamicFields.map(({ itemKey, typeCode }) => ({
    item_key: itemKey,
    type_code: typeCode,
    answer: answersByType[typeCode],
    answer_token: `fixture-token-${itemKey}`,
  }))
  answers.push({
    item_key: 'group_username_fixture',
    type_code: 'username',
    answer: groupContactName,
    answer_token: 'fixture-token-group-username',
    parent_item_key: 'field_group_fixture',
  })
  const createdAt = '2026-09-09 14:36:00'
  const record = {
    id: submissionId,
    submission_id: submissionId,
    special_code: '-',
    source: 'public',
    source_text: 'C端用户提交',
    created_at: createdAt,
    updated_at: createdAt,
    revision_no: 2,
    answers,
    contacts: [
      { id: 'contact-primary', username: primaryContactName, name: primaryContactName },
      { id: 'contact-group', username: groupContactName, name: groupContactName },
    ],
  }
  const contacts = [
    {
      id: 'contact-group',
      username: groupContactName,
      name: groupContactName,
      mobile: '13812343859',
      email: 'group_1788940800000@example.com',
      created_at: createdAt,
      updated_at: createdAt,
      submission_id: submissionId,
    },
    {
      id: 'contact-primary',
      username: primaryContactName,
      name: primaryContactName,
      mobile: '13912343858',
      email: 'autotest_1788940800000@example.com',
      created_at: createdAt,
      updated_at: createdAt,
      submission_id: submissionId,
    },
  ]
  return {
    formId,
    submissionId,
    title,
    primaryContactName,
    groupContactName,
    createdAt,
    sourceText: record.source_text,
    revisionNo: record.revision_no,
    items,
    record,
    contacts,
    formResponse: {
      code: 0,
      message: 'success',
      data: {
        revision_no: record.revision_no,
        form: {
          id: formId,
          form_id: formId,
          title,
          status: 'published',
          current_revision_no: record.revision_no,
          items,
        },
        items,
      },
    },
    submissionResponse: {
      code: 0,
      message: 'success',
      data: {
        list: [record],
        meta: { current_page: 1, per_page: 10, total: 1 },
      },
    },
    contactResponse: {
      code: 0,
      message: 'success',
      data: {
        list: contacts,
        meta: { current_page: 1, per_page: 10, total: 2 },
      },
    },
    detailResponse: {
      code: 0,
      message: 'success',
      data: {
        ...record,
        items: [primaryContactName, groupContactName].map((name) => ({
          type_code: 'username',
          value: [{ answer: { collect_mode: 'name_zh', name_zh: name } }],
        })),
      },
    },
    tabCountsResponse: {
      code: 0,
      message: 'success',
      data: { submission_count: 1, contact_count: 2 },
    },
  }
}

function valuesForKey(url, key) {
  const direct = url.searchParams.getAll(key)
  if (direct.length > 0) return direct
  const indexed = [...url.searchParams.entries()]
    .filter(([candidate]) => candidate === `${key}[]` || candidate.startsWith(`${key}[`))
    .map(([, value]) => value)
  if (indexed.length > 0) return indexed
  return []
}

function normalizedDateRange(url, key) {
  const values = valuesForKey(url, key)
  if (values.length === 1 && values[0].includes(',')) return values[0].split(',')
  if (values.length === 1 && /^\s*\[/.test(values[0])) {
    try {
      const parsed = JSON.parse(values[0])
      if (Array.isArray(parsed)) return parsed.map(String)
    } catch {
      return values
    }
  }
  return values
}

function answerValue(record, itemKey) {
  return record.answers.find((answer) => answer.item_key === itemKey)?.answer ?? ''
}

export function filterSubmissionRecords(requestUrl, records, additionalFields = []) {
  const url = requestUrl instanceof URL ? requestUrl : new URL(requestUrl, 'http://fixture.local')
  return records.filter((record) => {
    for (const field of [...SUBMISSION_SEARCH_FIELDS, ...additionalFields]) {
      if (field.kind === 'date-range') {
        const range = normalizedDateRange(url, field.key).filter(Boolean)
        if (range.length > 0) {
          const date = String(record.created_at ?? '').slice(0, 10)
          const [start, end = start] = range
          if (date < String(start).slice(0, 10) || date > String(end).slice(0, 10)) return false
        }
        continue
      }
      const query = String(url.searchParams.get(field.key) ?? '').trim().toLocaleLowerCase()
      if (!query) continue
      const candidate = field.kind === 'source'
        ? `${record.source ?? ''} ${record.source_text ?? ''}`
        : field.kind === 'revision'
          ? String(record.revision_no ?? '')
          : String(answerValue(record, field.itemKey))
      if (!candidate.toLocaleLowerCase().includes(query)) return false
    }
    return true
  })
}

export function filterContactRecords(requestUrl, contacts) {
  const url = requestUrl instanceof URL ? requestUrl : new URL(requestUrl, 'http://fixture.local')
  const keyword = String(url.searchParams.get('filter[keyword]') ?? '').trim().toLocaleLowerCase()
  const range = normalizedDateRange(url, 'filter[created_at_between]').filter(Boolean)
  return contacts.filter((contact) => {
    if (keyword) {
      const searchable = [contact.name, contact.username, contact.mobile, contact.email]
        .map((value) => String(value ?? ''))
        .join(' ')
        .toLocaleLowerCase()
      if (!searchable.includes(keyword)) return false
    }
    if (range.length > 0) {
      const date = String(contact.created_at ?? '').slice(0, 10)
      const [start, end = start] = range
      if (date < String(start).slice(0, 10) || date > String(end).slice(0, 10)) return false
    }
    return true
  })
}

export function createSubmissionListHtml({
  fixture,
  locale = 'zh-TW',
  resourcePath = '/fixture-assets/submission-list.css',
  injectWriteRequest = false,
  omitContactTag = false,
} = {}) {
  if (!fixture) throw new Error('提报列表 HTML fixture 缺少业务数据')
  const ui = UI_TEXT[locale] ?? UI_TEXT['zh-CN']
  const initiallyCheckedBasics = ['source_text', 'created_at', SEARCHABLE_SUBMISSION_FIELDS[0].basicKey]
  const initiallyCheckedSearches = [
    'filter[source]',
    'filter[created_at_between]',
    SEARCHABLE_SUBMISSION_FIELDS[0].filterKey,
  ]
  const model = {
    formId: fixture.formId,
    submissionId: fixture.submissionId,
    title: fixture.title,
    primaryContactName: fixture.primaryContactName,
    groupContactName: fixture.groupContactName,
    sourceText: fixture.sourceText,
    ui,
    basicFields: [
      ...BASIC_SUBMISSION_FIELDS.map((field) => {
        const extra = fixture.additionalSearchFields?.find((candidate) => candidate.basicKey === field.key)
        return extra ? { ...field, filterKey: extra.key } : field
      }),
      ...(fixture.additionalSearchFields ?? [])
        .filter((extra) => !BASIC_SUBMISSION_FIELDS.some((field) => field.key === extra.basicKey))
        .map((extra) => ({ key: extra.basicKey, label: extra.label, filterKey: extra.key })),
    ],
    searchFields: [...SUBMISSION_SEARCH_FIELDS, ...(fixture.additionalSearchFields ?? [])],
    searchableFields: [...SEARCHABLE_SUBMISSION_FIELDS, ...(fixture.additionalSearchFields ?? [])
      .map((extra) => ({ ...extra, filterKey: extra.key }))],
    initialBasic: initiallyCheckedBasics,
    initialSearch: initiallyCheckedSearches,
    injectWriteRequest,
    choiceSamples: fixture.additionalSearchFields ? Object.fromEntries(
      fixture.record.answers.filter((answer) => /^(radio|checkbox|select)_/.test(answer.item_key))
        .map((answer) => [`filter[${answer.item_key}]`, String(answer.answer).split(',')]),
    ) : {},
  }
  const tag = omitContactTag
    ? ''
    : `<span class="arco-tag"><svg class="info-card__ability-icon" aria-hidden="true"></svg><span>${escapeHtml(ui.contactTag)}</span></span>`

  return `<!doctype html>
<html lang="${escapeHtml(locale)}">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(fixture.title)}</title>
  <link rel="stylesheet" href="${escapeHtml(resourcePath)}">
  <link rel="icon" href="/fixture-assets/submission-list.png" type="image/png">
</head>
<body>
  <main class="submission-preview-page">
    <a class="back-link" href="/form-activity/list">${escapeHtml(ui.back)}</a>
    <section class="info-card">
      <h2 class="info-card__title">${escapeHtml(fixture.title)}</h2>
      <span class="status">${escapeHtml(ui.published)}</span>
      ${tag}
    </section>
    <div class="arco-tabs-nav" role="presentation">
      <div class="arco-tabs-tab arco-tabs-tab-active" data-tab="submission">
        <span>${escapeHtml(ui.submissionTab)}</span><span class="tab-count">(1)</span>
      </div>
      <div class="arco-tabs-tab" data-tab="contact">
        <span>${escapeHtml(ui.contactTab)}</span><span class="tab-count">(2)</span>
      </div>
    </div>
    <section class="filter-card comp-filter-card"><div id="filter-fields"></div>
      <button type="button" data-action="search">${escapeHtml(ui.search)}</button>
      <button type="button" data-action="reset">${escapeHtml(ui.reset)}</button>
      <button type="button" data-action="expand">${escapeHtml(ui.expand)}</button>
    </section>
    <section class="list-card">
      <table class="header-table"><thead><tr id="list-header"></tr></thead></table>
      <table class="data-table"><tbody id="list-body"></tbody></table>
      <div id="list-total"></div>
    </section>
    <div class="load-error" hidden></div>
  </main>
  <div class="arco-modal-wrapper" data-modal="field-settings" hidden>
    <div class="arco-modal">
      <div class="arco-modal-title">${escapeHtml(ui.settingsTitle)}</div>
      <div class="fields-modal-content">
        <div class="field-group" data-field-group="basic">
          <div class="field-group-title">${escapeHtml(ui.basicGroup)}</div>
          <div class="field-group-content basic-setting-list"></div>
        </div>
        <div class="field-group" data-field-group="search">
          <div class="field-group-title">${escapeHtml(ui.searchGroup)}</div>
          <div class="field-group-content search-setting-list"></div>
        </div>
      </div>
      <footer>
        <button type="button" data-action="cancel-settings">${escapeHtml(ui.cancel)}</button>
        <button type="button" data-action="confirm-settings">${escapeHtml(ui.confirm)}</button>
      </footer>
    </div>
  </div>
  <script>
  (() => {
    const model = ${jsonForInlineScript(model)}
    const state = {
      activeTab: 'submission',
      selectedBasic: new Set(model.initialBasic),
      selectedSearch: new Set(model.initialSearch),
      filterValues: Object.create(null),
      submissions: [],
      contacts: [],
    }
    const byId = (id) => document.getElementById(id)
    const tokenHeaders = () => ({ Authorization: localStorage.getItem('token') || '' })
    const escapeText = (value) => String(value ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;')
    const parseBody = async (response) => {
      const body = await response.json()
      if (!response.ok || (Object.prototype.hasOwnProperty.call(body, 'code') && Number(body.code) !== 0)) {
        throw new Error(String(body.message || 'request failed'))
      }
      return body
    }
    const getJson = (url) => fetch(url, { headers: tokenHeaders() }).then(parseBody)
    const recordsOf = (body) => {
      const data = body && body.data
      if (Array.isArray(data && data.list)) return data.list
      if (Array.isArray(data && data.data)) return data.data
      if (Array.isArray(data && data.items)) return data.items
      return []
    }
    const setActiveTab = (tabName) => {
      state.activeTab = tabName
      document.querySelectorAll('.arco-tabs-tab').forEach((tab) => {
        tab.classList.toggle('arco-tabs-tab-active', tab.dataset.tab === tabName)
      })
    }
    const labelForBasic = (field) => {
      if (field.key === 'source_text') return model.ui.source
      if (field.key === 'created_at') return model.ui.submittedAt
      if (field.key === 'updated_at') return model.ui.updatedAt
      if (field.key === 'revision_no') return model.ui.revision
      if (field.key === 'special_code') return model.ui.specialCode
      return field.label
    }
    const labelForSearch = (field) => {
      if (field.kind === 'source') return model.ui.source
      if (field.kind === 'date-range') return model.ui.submittedAt
      if (field.kind === 'revision') return model.ui.revision
      return field.label
    }
    const checkboxMarkup = (field, group, selected) => {
      const wrapperClass = group === 'basic' ? 'basic-setting-checkbox' : 'search-setting-checkbox'
      return '<div class="' + wrapperClass + '"><label class="arco-checkbox'
        + (selected ? ' arco-checkbox-checked' : '') + '"><input class="arco-checkbox-target" type="checkbox" value="'
        + escapeText(field.key) + '" data-checkbox-group="' + group + '"'
        + (selected ? ' checked' : '') + '><span class="arco-checkbox-icon"></span><span>'
        + escapeText(group === 'basic' ? labelForBasic(field) : labelForSearch(field))
        + '</span></label></div>'
    }
    const updateCheckboxPresentation = (input) => {
      input.closest('.arco-checkbox')?.classList.toggle('arco-checkbox-checked', input.checked)
    }
    const renderSettings = () => {
      document.querySelector('.basic-setting-list').innerHTML = model.basicFields
        .map((field) => checkboxMarkup(field, 'basic', state.selectedBasic.has(field.key))).join('')
      document.querySelector('.search-setting-list').innerHTML = model.searchFields
        .map((field) => checkboxMarkup(field, 'search', state.selectedSearch.has(field.key))).join('')
      document.querySelectorAll('[data-checkbox-group]').forEach((input) => {
        input.addEventListener('change', () => {
          const group = input.dataset.checkboxGroup
          const targetSet = group === 'basic' ? state.selectedBasic : state.selectedSearch
          if (input.checked) targetSet.add(input.value)
          else targetSet.delete(input.value)
          updateCheckboxPresentation(input)
          if (group === 'basic') {
            const basic = model.basicFields.find((field) => field.key === input.value)
            if (basic && basic.filterKey) {
              const linked = document.querySelector('[data-checkbox-group="search"][value="' + CSS.escape(basic.filterKey) + '"]')
              if (linked) {
                linked.checked = input.checked
                if (input.checked) state.selectedSearch.add(linked.value)
                else state.selectedSearch.delete(linked.value)
                updateCheckboxPresentation(linked)
              }
            }
          } else if (input.checked) {
            const search = model.searchFields.find((field) => field.key === input.value)
            if (search && search.basicKey) {
              const linked = document.querySelector('[data-checkbox-group="basic"][value="' + CSS.escape(search.basicKey) + '"]')
              if (linked) {
                linked.checked = true
                state.selectedBasic.add(linked.value)
                updateCheckboxPresentation(linked)
              }
            }
          }
        })
      })
    }
    const textFilterMarkup = (field) => '<div class="filter-card-field" data-filter-key="'
      + escapeText(field.key) + '"><div class="filter-card-label">' + escapeText(labelForSearch(field))
      + '</div><input class="arco-input arco-input-size-medium filter-card-control" type="text" name="'
      + escapeText(field.key) + '" data-filter-input="' + escapeText(field.key)
      + '" placeholder="' + escapeText(model.ui.input) + '"></div>'
    const sourceFilterMarkup = (field) => '<div class="filter-card-field" data-filter-key="'
      + escapeText(field.key) + '"><div class="filter-card-label">' + escapeText(model.ui.source)
      + '</div><div class="arco-select-view-single arco-select filter-card-control arco-select-view arco-select-view-size-medium" data-source-select>'
      + '<input class="arco-select-view-input" role="combobox" readonly placeholder="' + escapeText(model.ui.choose)
      + '" data-filter-input="' + escapeText(field.key) + '"></div></div>'
    const dateFilterMarkup = (field) => '<div class="filter-card-field" data-filter-key="'
      + escapeText(field.key) + '"><div class="filter-card-label">' + escapeText(model.ui.submittedAt)
      + '</div><div class="arco-picker arco-picker-range arco-picker-size-medium filter-card-control" data-date-range>'
      + '<div class="arco-picker-input"><input data-filter-date="start" placeholder="' + escapeText(model.ui.startDate)
      + '"></div><span>-</span><div class="arco-picker-input"><input data-filter-date="end" placeholder="'
      + escapeText(model.ui.endDate) + '"></div></div></div>'
    const renderFilters = () => {
      const container = byId('filter-fields')
      if (state.activeTab === 'contact') {
        container.innerHTML = '<div class="filter-card-field" data-filter-key="filter[keyword]"><div class="filter-card-label">'
          + escapeText(model.ui.name) + '</div><input class="arco-input arco-input-size-medium filter-card-control" type="text"'
          + ' name="filter[keyword]" data-filter-input="filter[keyword]" placeholder="' + escapeText(model.ui.input) + '"></div>'
          + dateFilterMarkup({ key: 'filter[created_at_between]', kind: 'date-range' })
      } else {
        const dynamic = model.searchableFields
          .map((candidate) => model.searchFields.find((field) => field.key === candidate.filterKey))
          .filter((field) => field && state.selectedSearch.has(field.key))
        const fixed = model.searchFields
          .filter((field) => field.kind !== 'text' && state.selectedSearch.has(field.key))
        container.innerHTML = [...dynamic, ...fixed].map((field) => {
          if (field.kind === 'source') return sourceFilterMarkup(field)
          if (field.kind === 'date-range') return dateFilterMarkup(field)
          return textFilterMarkup(field)
        }).join('')
      }
      for (const [key, samples] of Object.entries(model.choiceSamples)) {
        const input = Array.from(container.querySelectorAll('[data-filter-input]'))
          .find((candidate) => candidate.dataset.filterInput === key)
        if (!input) continue
        input.removeAttribute('data-filter-input')
        const select = document.createElement('div')
        select.className = 'arco-select'
        input.replaceWith(select)
        select.append(input)
        const selected = document.createElement('span')
        selected.dataset.choiceLabel = ''
        select.append(selected)
        input.addEventListener('input', () => {
          document.querySelector('[data-choice-dropdown]')?.remove()
          const dropdown = document.createElement('div')
          dropdown.className = 'arco-select-dropdown'
          dropdown.dataset.choiceDropdown = ''
          for (const sample of [...samples, '不相关干扰项']) {
            if (!sample.includes(input.value)) continue
            const option = document.createElement('div')
            option.className = 'arco-select-option'
            option.textContent = sample
            option.addEventListener('click', () => {
              state.filterValues[key] = sample
              selected.textContent = sample
              input.value = ''
              dropdown.remove()
            })
            dropdown.append(option)
          }
          document.body.append(dropdown)
        })
      }
      const source = document.querySelector('[data-source-select]')
      if (source) source.addEventListener('click', () => {
        let dropdown = document.querySelector('[data-source-dropdown]')
        if (!dropdown) {
          dropdown = document.createElement('div')
          dropdown.className = 'arco-select-dropdown'
          dropdown.dataset.sourceDropdown = 'true'
          dropdown.innerHTML = '<div class="arco-select-option" role="option" data-source-value="public">'
            + escapeText(model.sourceText) + '</div>'
          document.body.append(dropdown)
          dropdown.querySelector('.arco-select-option').addEventListener('click', () => {
            state.filterValues['filter[source]'] = model.sourceText
            source.querySelector('input').value = model.sourceText
            dropdown.hidden = true
          })
        }
        dropdown.hidden = false
      })
    }
    const selectedColumnFields = () => model.basicFields.filter((field) => state.selectedBasic.has(field.key))
    const renderSubmissionTable = () => {
      const columns = selectedColumnFields()
      byId('list-header').innerHTML = columns.map((field) => '<th>' + escapeText(labelForBasic(field)) + '</th>').join('')
        + '<th>' + escapeText(model.ui.operation) + '<button type="button" data-action="field-settings">'
        + '<svg class="arco-icon-settings" aria-hidden="true"></svg></button></th>'
      byId('list-body').innerHTML = state.submissions.map((record) => {
        const answerFor = (basicKey) => {
          if (!basicKey.startsWith('dyn_')) return record[basicKey] ?? '-'
          const itemKey = basicKey.slice(4)
          return record.answers?.find((answer) => answer.item_key === itemKey)?.answer ?? '-'
        }
        return '<tr class="arco-table-tr" data-submission-id="' + escapeText(record.id || record.submission_id) + '">'
          + columns.map((field) => '<td>' + escapeText(answerFor(field.key)) + '</td>').join('')
          + '<td><button type="button" aria-label="' + escapeText(model.ui.view) + '" data-view-submission="'
          + escapeText(record.id || record.submission_id) + '">' + escapeText(model.ui.view) + '</button></td></tr>'
      }).join('')
      byId('list-total').textContent = model.ui.total.replace('{count}', String(state.submissions.length))
      document.querySelectorAll('[data-view-submission]').forEach((button) => {
        button.addEventListener('click', () => {
          location.href = '/form-activity/submission/preview/reply/' + encodeURIComponent(button.dataset.viewSubmission)
            + '?fid=' + encodeURIComponent(model.formId)
        })
      })
      document.querySelector('[data-action="field-settings"]')?.addEventListener('click', () => {
        renderSettings()
        document.querySelector('[data-modal="field-settings"]').hidden = false
      })
    }
    const renderContactTable = () => {
      byId('list-header').innerHTML = '<th>' + escapeText(model.ui.name) + '</th><th>'
        + escapeText(model.ui.mobile) + '</th><th>' + escapeText(model.ui.updatedAt) + '</th><th>'
        + escapeText(model.ui.operation) + '</th>'
      byId('list-body').innerHTML = state.contacts.map((contact) => '<tr class="arco-table-tr" data-contact-id="'
        + escapeText(contact.id) + '"><td><a href="/contact/list/detail?id=' + encodeURIComponent(contact.id) + '">'
        + escapeText(contact.name || contact.username) + '</a></td><td>' + escapeText(contact.mobile)
        + '</td><td>' + escapeText(contact.updated_at) + '</td><td><button type="button" aria-label="'
        + escapeText(model.ui.view) + '">' + escapeText(model.ui.view) + '</button></td></tr>').join('')
      byId('list-total').textContent = model.ui.total.replace('{count}', String(state.contacts.length))
    }
    const appendDateRange = (params) => {
      const start = document.querySelector('[data-filter-date="start"]')?.value.trim() || ''
      const end = document.querySelector('[data-filter-date="end"]')?.value.trim() || ''
      if (start || end) params.set('filter[created_at_between]', [start, end].join(','))
    }
    const executeSearch = async () => {
      const params = new URLSearchParams({ page: '1', per_page: '10' })
      for (const [key, value] of Object.entries(state.filterValues)) if (value) params.set(key, value)
      document.querySelectorAll('[data-filter-input]').forEach((input) => {
        const value = input.value.trim()
        if (value) params.set(input.dataset.filterInput, value)
      })
      appendDateRange(params)
      const resource = state.activeTab === 'contact' ? 'contact' : 'submission'
      const body = await getJson('/api/be/form/' + encodeURIComponent(model.formId) + '/' + resource + '?' + params)
      if (state.activeTab === 'contact') {
        state.contacts = recordsOf(body)
        renderContactTable()
      } else {
        state.submissions = recordsOf(body)
        renderSubmissionTable()
      }
    }
    const resetFilters = () => {
      state.filterValues = Object.create(null)
      document.querySelectorAll('[data-choice-label]').forEach((node) => { node.textContent = '' })
      document.querySelector('[data-choice-dropdown]')?.remove()
      document.querySelectorAll('#filter-fields input').forEach((input) => { input.value = '' })
      document.querySelector('[data-source-dropdown]')?.setAttribute('hidden', '')
    }
    document.querySelectorAll('.arco-tabs-tab').forEach((tab) => {
      tab.addEventListener('click', async () => {
        setActiveTab(tab.dataset.tab)
        resetFilters()
        renderFilters()
        if (state.activeTab === 'contact') {
          const body = await getJson('/api/be/form/' + encodeURIComponent(model.formId) + '/contact?page=1&per_page=10')
          state.contacts = recordsOf(body)
          renderContactTable()
        } else {
          const body = await getJson('/api/be/form/' + encodeURIComponent(model.formId) + '/submission?page=1&per_page=10')
          state.submissions = recordsOf(body)
          renderSubmissionTable()
        }
      })
    })
    document.querySelector('[data-action="search"]').addEventListener('click', () => executeSearch().catch(showError))
    document.querySelector('[data-action="reset"]').addEventListener('click', resetFilters)
    document.querySelector('[data-action="expand"]').addEventListener('click', () => {})
    document.querySelector('[data-action="cancel-settings"]').addEventListener('click', () => {
      document.querySelector('[data-modal="field-settings"]').hidden = true
    })
    document.querySelector('[data-action="confirm-settings"]').addEventListener('click', () => {
      localStorage.setItem('fields-config', JSON.stringify({
        basic: [...state.selectedBasic],
        search: [...state.selectedSearch],
      }))
      document.querySelector('[data-modal="field-settings"]').hidden = true
      renderFilters()
      renderSubmissionTable()
    })
    const showError = (error) => {
      const target = document.querySelector('.load-error')
      target.hidden = false
      target.textContent = String(error && error.message || error)
    }
    renderFilters()
    renderSubmissionTable()
    Promise.all([
      getJson('/api/be/form/' + encodeURIComponent(model.formId)),
      getJson('/api/be/form/' + encodeURIComponent(model.formId) + '/tab-counts'),
      getJson('/api/be/form/' + encodeURIComponent(model.formId) + '/submission?page=1&per_page=10'),
    ]).then(([, counts, submissions]) => {
      state.submissions = recordsOf(submissions)
      const countData = counts && counts.data || {}
      document.querySelector('[data-tab="submission"] .tab-count').textContent = '('
        + String(countData.submission_count ?? state.submissions.length) + ')'
      document.querySelector('[data-tab="contact"] .tab-count').textContent = '('
        + String(countData.contact_count ?? 2) + ')'
      renderSubmissionTable()
      if (model.injectWriteRequest) {
        fetch('/api/be/form/' + encodeURIComponent(model.formId) + '/submission/' + encodeURIComponent(model.submissionId), {
          method: 'PATCH',
          headers: { ...tokenHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ fixture_write: true }),
        }).catch(() => undefined)
      }
    }).catch(showError)
  })()
  </script>
</body>
</html>`
}

export function createSubmissionDetailHtml({ fixture, locale = 'zh-TW' } = {}) {
  if (!fixture) throw new Error('提报详情 HTML fixture 缺少业务数据')
  const ui = UI_TEXT[locale] ?? UI_TEXT['zh-CN']
  return `<!doctype html>
<html lang="${escapeHtml(locale)}">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(fixture.title)}</title>
  <link rel="stylesheet" href="/fixture-assets/submission-list.css">
</head>
<body>
  <main class="reply-detail-page">
    <h2>${escapeHtml(fixture.title)}</h2>
    <img src="/fixture-assets/detail-image.png" alt="提报图片">
    <section class="reply-kv">
      <div class="reply-kv__row"><span class="reply-kv__label">姓名</span><div class="reply-kv__value">${escapeHtml(fixture.primaryContactName)} Mr.（先生）</div></div>
      <div class="reply-kv__row"><span class="reply-kv__label">姓名</span><div class="reply-kv__value">${escapeHtml(fixture.groupContactName)}</div></div>
    </section>
    <span>${escapeHtml(ui.submissionTab)}</span>
  </main>
  <script>
    fetch('/api/be/form/${encodeURIComponent(fixture.formId)}/submission/${encodeURIComponent(fixture.submissionId)}', {
      headers: { Authorization: localStorage.getItem('token') || '' },
    }).then((response) => response.json()).catch(() => undefined)
  </script>
</body>
</html>`
}
