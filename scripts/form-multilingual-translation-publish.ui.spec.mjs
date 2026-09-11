import { clickWhenReady, observeUiReadiness } from './support/ui-readiness.mjs'
import { publicOriginForSite } from '../shared/form-environment.mjs'
import { isSystemItem } from './support/form-link-contract.mjs'
import { scaleTimeout } from './support/environment-timeouts.mjs'
import { randomUUID } from 'node:crypto'

import { expect as flowExpect } from './support/environment-timeouts.mjs'
import { request as playwrightRequest } from '@playwright/test'
import jsQR from 'jsqr'

import { expect } from './support/recorded-expect.mjs'
import { attachNetworkObserver } from './support/api-response-recorder.mjs'
import { launchGoogleChrome } from './support/google-chrome.mjs'
import {
  closePlaywrightHandles,
  closePlaywrightOnAbort,
  throwIfRunAborted,
} from './playwright-run-control.mjs'

const SCRIPT_ID = 'form-multilingual-translation-publish'
const DEFAULT_REQUEST_PATH = '/form-activity/translation?id={{FORM_ID}}'
const NAVIGATION_TIMEOUT_MS = 45_000
const ACTION_TIMEOUT_MS = 30_000
const DEFAULT_AI_TRANSLATION_TIMEOUT_MS = 120_000
const PROBE_RECOVERY_TIMEOUT_MS = 10_000
const PROBE_RECOVERY_POLL_INTERVAL_MS = 250
const PROBE_RECOVERY_ACTION_RESERVE_MS = 3_000
const REQUEST_CONTEXT_DISPOSE_TIMEOUT_MS = 1_000
const SUPPORTED_LANGUAGES = Object.freeze(['zh_CN', 'zh_HK', 'en_US'])
const TARGET_LANGUAGES = Object.freeze(['zh_HK', 'en_US'])
const LANGUAGE_LABELS = Object.freeze({
  zh_CN: '简体中文',
  zh_HK: '繁体中文',
  en_US: 'English',
})
const LANGUAGE_LABEL_ALIASES = Object.freeze({
  zh_CN: Object.freeze(['简体中文', '簡體中文']),
  zh_HK: Object.freeze(['繁体中文', '繁體中文']),
  en_US: Object.freeze(['English']),
})
const HTML_LANGS = Object.freeze({
  zh_CN: 'zh-CN',
  zh_HK: 'zh-HK',
  en_US: 'en-US',
})
const SWITCH_LANGUAGE_PATTERN = /切换语言|切換語言|Switch language/i
const AUTHENTICATED_API_PATH_PREFIXES = ['/api/be/', '/api/base/', '/be/', '/base/']
const EXPECTED_UNTRANSLATABLE_SECTIONS = Object.freeze({
  form_structure: Object.freeze([]),
  other_translation: Object.freeze([
    'submission_period',
    'submission_quota',
    'add_to_cart_button_text',
    'terms_of_service',
    'privacy_policy',
    'payment_alert',
    'blacklist_whitelist_message',
    'customized_feedback',
  ]),
  email_translation: Object.freeze([
    'admin_form_submitted_success',
    'admin_activity_submitted_success',
    'admin_submission_audit_approving',
    'user_form_submitted_success',
    'user_activity_submitted_success',
    'user_receipt_sent',
    'user_submission_audit_rejected',
    'admin_form_audit_approved',
    'admin_form_audit_approving',
    'admin_form_audit_rejected',
  ]),
})
const ALL_FIELDS_TYPE_SEQUENCE = Object.freeze([
  'page',
  'username',
  'mobile',
  'email',
  'id_card',
  'landline_phone',
  'address',
  'birthday',
  'page',
  'input',
  'textarea',
  'radio',
  'checkbox',
  'select',
  'number',
  'date',
  'time',
  'image_upload',
  'file_upload',
  'page',
  'cascader',
  'signature',
  'field_group',
  'username',
  'mobile',
  'email',
  'description',
  'divider',
  'matrix',
  'matrix_choice',
  'sort',
  'rating',
  'nps',
])
const CRITICAL_TRANSLATIONS = Object.freeze({
  zh_HK: Object.freeze([
    ['手机号', /手機號/],
    ['邮箱', /郵箱/],
    ['身份证件', /身份證件/],
    ['固定电话', /固定電話/],
    ['单行文本', /單行文本/],
    ['多行文本', /多行文本/],
    ['单项选择', /單項選擇/],
    ['多项选择', /多項選擇/],
    ['下拉选择', /下拉選擇/],
    ['图片上传', /圖片上傳/],
    ['文件上传', /文件上傳/],
    ['级联选择', /級聯選擇/],
    ['手写签名', /手寫簽名/],
    ['题组', /題組/],
    ['矩阵题', /矩陣題/],
    ['矩阵选择', /矩陣選擇/],
    ['排序题', /排序題/],
    ['评分题', /評分題/],
    ['选项1', /選項1/],
    ['华东区', /華東區/],
    ['江苏省', /江蘇省/],
    ['南京市', /南京市/],
    ['非常不满意', /非常不滿意/],
    ['极有可能', /極有可能/],
    ['上一页', /上一頁/],
    ['下一页', /下一頁/],
  ]),
  en_US: Object.freeze([
    ['姓名', /\b(?:full\s+)?name\b/i],
    ['手机号', /mobile|phone/i],
    ['邮箱', /e-?mail/i],
    ['身份证件', /identity|\bID\b/i],
    ['固定电话', /landline|telephone/i],
    ['地址', /address/i],
    ['生日', /birth/i],
    ['单行文本', /single|text/i],
    ['多行文本', /multi|text/i],
    ['单项选择', /single|radio|choice/i],
    ['多项选择', /multiple|checkbox|choice/i],
    ['下拉选择', /drop|select/i],
    ['数字', /number|numeric/i],
    ['日期', /date/i],
    ['时间', /time/i],
    ['图片上传', /image.*upload|upload.*image/i],
    ['文件上传', /file.*upload|upload.*file/i],
    ['级联选择', /cascade|cascad/i],
    ['手写签名', /signature/i],
    ['题组', /group/i],
    ['矩阵题', /matrix/i],
    ['矩阵选择', /matrix/i],
    ['排序题', /rank|sort/i],
    ['评分题', /rating|score/i],
    ['选项1', /option\s*1/i],
    ['上一页', /previous/i],
    ['下一页', /next/i],
  ]),
})
const SIMPLIFIED_TO_TRADITIONAL = Object.freeze({
  体: '體',
  单: '單',
  这: '這',
  请: '請',
  证: '證',
  联: '聯',
  项: '項',
  页: '頁',
  发: '發',
  补: '補',
  选: '選',
  择: '擇',
  号: '號',
  题: '題',
  组: '組',
  写: '寫',
  须: '須',
  实: '實',
  据: '據',
  时: '時',
  间: '間',
  图: '圖',
  传: '傳',
  档: '檔',
  签: '簽',
  阵: '陣',
  评: '評',
  级: '級',
  开: '開',
  关: '關',
  称: '稱',
  谓: '謂',
  邮: '郵',
  码: '碼',
  过: '過',
  满: '滿',
  为: '為',
  与: '與',
  后: '後',
  无: '無',
  误: '誤',
  确: '確',
  额: '額',
  经: '經',
  录: '錄',
  资: '資',
  细: '細',
  带: '帶',
  户: '戶',
  协: '協',
  议: '議',
  务: '務',
  统: '統',
  设: '設',
  置: '置',
})
const TEXTUAL_STRUCTURE_KEYS = new Set([
  'already_closed_message',
  'body',
  'content',
  'description',
  'instance_title',
  'label',
  'max_ratings_display_text',
  'message',
  'min_ratings_display_text',
  'name',
  'next_page_text',
  'not_open_message',
  'placeholder',
  'previous_page_text',
  'prompt',
  'subject',
  'subtitle',
  'text',
  'title',
  'validation_message',
])
const VOLATILE_STRUCTURE_KEYS = new Set([
  'created_at',
  'updated_at',
  'status_text',
  'time_range_text',
])

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asBoolean(value) {
  return value === true || value === 1 || value === '1'
}

function numericValue(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function sortedUnique(values) {
  return [...new Set(values)].sort()
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function languageDisplayLabels(language) {
  return LANGUAGE_LABEL_ALIASES[language] ?? [LANGUAGE_LABELS[language] ?? String(language)]
}

function languageLabelPattern(language) {
  return new RegExp(`^(?:${languageDisplayLabels(language).map(escapeRegExp).join('|')})$`, 'i')
}

function languageCodeForDisplayLabel(label) {
  const normalizedLabel = String(label ?? '').trim()
  return SUPPORTED_LANGUAGES.find((language) => (
    languageDisplayLabels(language).includes(normalizedLabel)
  )) ?? null
}

function languageCodesForDisplayLabels(labels) {
  return labels.map((label) => languageCodeForDisplayLabel(label))
}

function targetLanguageCard(page, language) {
  return page.locator('.target-language-tab').filter({
    has: page.locator('.target-language-tab__title', { hasText: languageLabelPattern(language) }),
  })
}

function redactUrl(rawUrl) {
  const url = new URL(rawUrl)
  for (const key of [...url.searchParams.keys()]) {
    if (/token|authorization|signature|secret|password/i.test(key)) {
      url.searchParams.set(key, '[REDACTED]')
    }
  }
  return url.toString()
}

function findShareUrlSecretLeaks(rawUrl, secrets = []) {
  let decoded = String(rawUrl ?? '')
  const representations = new Set([decoded])
  for (let depth = 0; depth < 3; depth += 1) {
    try {
      decoded = decodeURIComponent(decoded.replace(/\+/g, ' '))
      representations.add(decoded)
    } catch {
      break
    }
  }
  return secrets
    .filter(({ value }) => {
      const secret = String(value ?? '')
      if (!secret) return false
      const encoded = encodeURIComponent(secret)
      const formEncoded = encoded.replace(/%20/gi, '+')
      return [...representations].some((candidate) => (
        candidate.includes(secret) || candidate.includes(encoded) || candidate.includes(formEncoded)
      ))
    })
    .map(({ name }) => String(name ?? '').trim())
    .filter(Boolean)
}

function sensitiveShareUrlParameters(rawUrl) {
  try {
    const url = new URL(rawUrl)
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''))
    return sortedUnique([...url.searchParams.keys(), ...hashParams.keys()]
      .filter((key) => /token|authorization|api[_-]?key|secret|password|signature/i.test(key)))
  } catch {
    return ['invalid-url']
  }
}

function normalizedRequestPath(requestPath = DEFAULT_REQUEST_PATH, variables = {}) {
  if (typeof requestPath !== 'string' || !requestPath.trim()) {
    throw new Error('多语言翻译页 URL 路径不能为空')
  }
  const valuesByKey = new Map(
    Object.entries(variables).map(([key, value]) => [key.trim().toLowerCase(), String(value ?? '').trim()]),
  )
  const missing = new Set()
  const resolved = requestPath.trim().replace(/{{\s*([^{}]+?)\s*}}/g, (_placeholder, rawKey) => {
    const key = String(rawKey).trim().toLowerCase()
    const value = valuesByKey.get(key)
    if (!value) missing.add(String(rawKey).trim())
    return value || ''
  })
  if (missing.size > 0) {
    throw new Error(`多语言翻译页 URL 缺少变量：${[...missing].map((key) => `{{${key}}}`).join('、')}`)
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(resolved) || resolved.startsWith('//')) {
    throw new Error('多语言翻译页 URL 必须使用相对路径')
  }
  if (/\s/.test(resolved)) throw new Error('多语言翻译页 URL 不能包含空格或换行')
  if (resolved.includes('\\')) throw new Error('多语言翻译页 URL 不能包含反斜杠')
  if (/[{}]/.test(resolved)) throw new Error('多语言翻译页 URL 中的变量格式无效')
  return resolved.startsWith('/') ? resolved : `/${resolved}`
}

function buildTranslationUrl(siteBaseUrl, requestPath = DEFAULT_REQUEST_PATH, variables = {}) {
  const siteUrl = new URL(siteBaseUrl)
  if (!['http:', 'https:'].includes(siteUrl.protocol)) throw new Error('环境域名只允许 http 或 https')
  const normalizedPath = normalizedRequestPath(requestPath, variables)
  const result = new URL(normalizedPath.replace(/^\/+/, ''), `${siteUrl.origin}/`)
  if (result.origin !== siteUrl.origin) throw new Error('多语言翻译页必须与管理端环境同源')
  if (!result.pathname.endsWith('/form-activity/translation')) {
    throw new Error('多语言翻译脚本必须打开 /form-activity/translation')
  }
  const formId = result.searchParams.get('id')?.trim()
  if (!formId) throw new Error('多语言翻译页 URL 必须包含非空表单 ID')
  const configuredFormId = Object.entries(variables)
    .find(([key]) => key.trim().toLowerCase() === 'form_id')?.[1]
  if (configuredFormId !== undefined && String(configuredFormId).trim() !== formId) {
    throw new Error('多语言翻译页 URL 的 id 必须与 FORM_ID 一致')
  }
  return result.toString()
}

function parseTranslationExpectations(value) {
  if (value === undefined || value === null || value === '') return {}
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new Error('TRANSLATION_EXPECTATIONS 不是有效 JSON')
    }
  }
  if (!isRecord(parsed)) throw new Error('TRANSLATION_EXPECTATIONS 必须是 JSON 对象')
  const normalized = {}
  for (const [language, entries] of Object.entries(parsed)) {
    if (!TARGET_LANGUAGES.includes(language)) {
      throw new Error(`TRANSLATION_EXPECTATIONS 不支持语言 ${language}`)
    }
    if (!isRecord(entries)) {
      throw new Error(`TRANSLATION_EXPECTATIONS.${language} 必须是原文到译文的对象`)
    }
    normalized[language] = {}
    for (const [reference, expectedValue] of Object.entries(entries)) {
      if (!reference.trim()) {
        throw new Error(`TRANSLATION_EXPECTATIONS.${language} 的 unit_key 或 field_path 键不能为空`)
      }
      if (typeof expectedValue !== 'string' || !expectedValue.trim()) {
        throw new Error(`TRANSLATION_EXPECTATIONS.${language}.${reference} 的译文必须是非空字符串`)
      }
      normalized[language][reference.trim()] = expectedValue
    }
  }
  return normalized
}

function parsePositiveTimeout(value, fallback = DEFAULT_AI_TRANSLATION_TIMEOUT_MS) {
  const candidate = value === undefined || value === null || value === '' ? fallback : value
  const timeout = Number(typeof candidate === 'string' ? candidate.trim() : candidate)
  if (!Number.isFinite(timeout) || !Number.isInteger(timeout) || timeout <= 0) {
    throw new Error('AI_TRANSLATION_TIMEOUT_MS 必须是正整数毫秒值')
  }
  return timeout
}

function resolveAiTimeout(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_AI_TRANSLATION_TIMEOUT_MS
  const timeout = Number(value)
  return parsePositiveTimeout(timeout)
}

function formatBusinessBody(body) {
  let text
  try {
    text = JSON.stringify(body)
  } catch {
    text = String(body)
  }
  return text.length > 2_000 ? `${text.slice(0, 2_000)}...[已截断]` : text
}

async function readResponseJsonWithin(response, label, timeoutMs = scaleTimeout(ACTION_TIMEOUT_MS)) {
  let timer
  try {
    return await Promise.race([
      Promise.resolve().then(() => response.json()),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}响应体读取超过 ${timeoutMs}ms，HTTP 响应已到达但正文未完成`)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function inspectBusinessResponse(response, label) {
  const status = Number(response?.status?.() ?? 0)
  const httpSucceeded = Boolean(response?.ok?.())
  expect(httpSucceeded, `${label}接口应返回成功 HTTP 状态，实际 ${status}`).toBe(true)

  let body = null
  let bodyReadError = ''
  try {
    body = await readResponseJsonWithin(response, label)
  } catch (error) {
    bodyReadError = error instanceof Error ? error.message : String(error)
    if (bodyReadError.includes('响应体读取超过')) throw error
  }
  const bodyValid = isRecord(body)
  expect(bodyValid, `${label}接口应返回有效 JSON 业务信封`).toBe(true)
  const code = bodyValid ? Number(body.code) : Number.NaN
  expect(Number.isFinite(code), `${label}响应应包含业务码，实际 ${formatBusinessBody(body)}`).toBe(true)
  expect(code, `${label}业务码应为 0，实际响应 ${formatBusinessBody(body)}`).toBe(0)
  return {
    body: bodyValid ? body : {},
    bodyReadError,
    bodyValid,
    httpSucceeded,
    succeeded: httpSucceeded && bodyValid && code === 0,
    status,
  }
}

function parseRequestPayload(request, label) {
  try {
    const payload = request.postDataJSON()
    expect(isRecord(payload), `${label}请求体应为 JSON 对象`).toBe(true)
    return isRecord(payload) ? payload : {}
  } catch {
    const raw = request.postData()
    expect(Boolean(raw), `${label}请求应包含 JSON 请求体`).toBe(true)
    if (!raw) return {}
    try {
      const payload = JSON.parse(raw)
      expect(isRecord(payload), `${label}请求体应为 JSON 对象`).toBe(true)
      return isRecord(payload) ? payload : {}
    } catch {
      expect(false, `${label}请求体应可解析为 JSON`).toBe(true)
      return {}
    }
  }
}

function exactApiResponse(page, method, pathnameSuffix, options = {}) {
  const { query = {}, timeout = scaleTimeout(ACTION_TIMEOUT_MS), acceptRequest = () => true } = options
  return page.waitForResponse(async (response) => {
    const url = new URL(response.url())
    if (response.request().method() !== method || !url.pathname.endsWith(pathnameSuffix)) return false
    if (!acceptRequest(response.request())) return false
    if (!Object.entries(query).every(([key, value]) => url.searchParams.get(key) === String(value))) return false
    // GET headers alone do not mean usable data. A stalled duplicate must not win
    // over a later complete response. Mutations retain their first response.
    if (method === 'GET') {
      try {
        if (await response.finished()) return false
        await response.body()
      } catch { return false }
    }
    return true
  }, { timeout })
}

async function runActionAndWaitForWatchers(watcherFactories, action = () => undefined) {
  const watcherPromises = []
  for (const startWatcher of watcherFactories) {
    const watcherPromise = Promise.resolve(startWatcher())
    void watcherPromise.catch(() => undefined)
    watcherPromises.push(watcherPromise)
  }
  const responsesPromise = Promise.all(watcherPromises)
  const actionPromise = Promise.resolve().then(action)
  const [responses] = await Promise.all([responsesPromise, actionPromise])
  return responses
}

function runActionAndWaitForApiResponses(page, responseSpecs, action = () => undefined) {
  const specs = Array.isArray(responseSpecs) ? responseSpecs : [responseSpecs]
  if (specs.length === 0) throw new Error('至少需要一个 API 响应监听条件')
  const navigationScoped = specs.some(spec => spec.options?.afterNavigation)
  const documentRequests = new WeakSet()
  let committed = false
  const onNavigation = frame => {
    if (frame === page.mainFrame()) committed = true
  }
  const onRequest = request => {
    if (committed) documentRequests.add(request)
  }
  if (navigationScoped) {
    page.on('framenavigated', onNavigation)
    page.on('request', onRequest)
  }
  return runActionAndWaitForWatchers(specs.map(({ method, pathnameSuffix, options }) => (
    () => exactApiResponse(page, method, pathnameSuffix, {
      ...options,
      ...(options?.afterNavigation ? { acceptRequest: request => documentRequests.has(request) } : {}),
    })
  )), action).finally(() => {
    if (navigationScoped) {
      page.off('framenavigated', onNavigation)
      page.off('request', onRequest)
    }
  })
}

function unwrapFormPayload(payload) {
  const envelope = isRecord(payload) ? payload : {}
  const data = isRecord(envelope.data) ? envelope.data : envelope
  const nestedData = isRecord(data.data) && (isRecord(data.data.form) || Array.isArray(data.data.items))
    ? data.data
    : data
  return {
    data: nestedData,
    form: isRecord(nestedData.form) ? nestedData.form : {},
    items: Array.isArray(nestedData.items)
      ? nestedData.items.filter(isRecord)
      : Array.isArray(nestedData.form?.items)
        ? nestedData.form.items.filter(isRecord)
        : [],
  }
}

function normalizeWorkspace(payload) {
  const envelope = isRecord(payload) ? payload : {}
  const data = isRecord(envelope.data) ? envelope.data : envelope
  const languages = Array.isArray(data.languages) ? data.languages.filter(isRecord).map((language) => ({
    ...language,
    language: String(language.language ?? ''),
    language_text: String(language.language_text ?? ''),
    enabled: asBoolean(language.enabled),
    published: asBoolean(language.published),
    progress: {
      total: numericValue(language.progress?.total),
      translated: numericValue(language.progress?.translated),
      missing: numericValue(language.progress?.missing),
      stale: numericValue(language.progress?.stale),
      percent: numericValue(language.progress?.percent),
    },
  })) : []
  const sections = Array.isArray(data.sections) ? data.sections.filter(isRecord).map((section) => ({
    ...section,
    group_key: String(section.group_key ?? ''),
    section_key: String(section.section_key ?? ''),
    scope_type: String(section.scope_type ?? ''),
    scope_key: String(section.scope_key ?? ''),
    type_code: String(section.type_code ?? ''),
    title: String(section.title ?? ''),
    subtitle: String(section.subtitle ?? ''),
    units: Array.isArray(section.units) ? section.units.filter(isRecord).map((unit) => ({
      ...unit,
      unit_key: String(unit.unit_key ?? ''),
      field_path: String(unit.field_path ?? ''),
      source_hash: String(unit.source_hash ?? ''),
      source_text: String(unit.source_text ?? ''),
      translated_text: String(unit.translated_text ?? ''),
      status: String(unit.status ?? ''),
      editor_type: String(unit.editor_type ?? ''),
    })) : [],
  })) : []
  return {
    ...data,
    valid: isRecord(data) && Array.isArray(data.languages) && Array.isArray(data.sections),
    revision_no: numericValue(data.revision_no),
    source_language: String(data.source_language ?? ''),
    target_language: String(data.target_language ?? ''),
    enabled: asBoolean(data.enabled),
    published: asBoolean(data.published),
    source_language_locked: asBoolean(data.source_language_locked),
    email_translation_enabled: asBoolean(data.email_translation_enabled),
    languages,
    sections,
    units: sections.flatMap((section) => section.units.map((unit) => ({
      ...unit,
      group_key: section.group_key,
      section_key: section.section_key,
      scope_type: section.scope_type,
      scope_key: section.scope_key,
      type_code: section.type_code,
    }))),
  }
}

function normalizeTranslationWorkspace(payload, expectedTargetLanguage) {
  if (!isRecord(payload)
    || !Object.prototype.hasOwnProperty.call(payload, 'code')
    || !isRecord(payload.data)) {
    throw new Error('翻译工作区业务信封必须包含 code 和 data')
  }
  if (Number(payload.code) !== 0) throw new Error('翻译工作区 code 必须为 0')

  const data = payload.data
  if (!Number.isInteger(Number(data.revision_no)) || Number(data.revision_no) <= 0) {
    throw new Error('翻译工作区 revision_no 必须是正整数')
  }
  const sourceLanguage = String(data.source_language ?? '').trim()
  const targetLanguage = String(data.target_language ?? '').trim()
  if (!sourceLanguage) throw new Error('翻译工作区 source_language 不能为空')
  if (!targetLanguage) throw new Error('翻译工作区 target_language 不能为空')
  if (expectedTargetLanguage && targetLanguage !== expectedTargetLanguage) {
    throw new Error(`翻译工作区目标语言应为 ${expectedTargetLanguage}`)
  }
  if (!Array.isArray(data.languages)) throw new Error('翻译工作区 languages 必须是数组')
  if (!Array.isArray(data.sections)) throw new Error('翻译工作区 sections 必须是数组')
  if (!Object.prototype.hasOwnProperty.call(data, 'source_language_locked')) {
    throw new Error('翻译工作区必须明确包含 source_language_locked')
  }
  if (![true, false, 0, 1, '0', '1'].includes(data.source_language_locked)) {
    throw new Error('翻译工作区 source_language_locked 必须是布尔值')
  }

  const languages = data.languages.map((language, index) => {
    if (!isRecord(language)) throw new Error(`翻译工作区 languages[${index}] 必须是对象`)
    return {
      code: String(language.language ?? '').trim(),
      label: String(language.language_text ?? '').trim(),
      enabled: asBoolean(language.enabled),
      published: asBoolean(language.published),
      status: String(language.status ?? ''),
      progress: {
        total: numericValue(language.progress?.total),
        translated: numericValue(language.progress?.translated),
        missing: numericValue(language.progress?.missing),
        stale: numericValue(language.progress?.stale),
        percent: numericValue(language.progress?.percent),
      },
    }
  })

  const units = []
  const sections = data.sections.map((section, sectionIndex) => {
    if (!isRecord(section)) throw new Error(`翻译工作区 sections[${sectionIndex}] 必须是对象`)
    if (!Array.isArray(section.units)) {
      throw new Error(`翻译工作区 sections[${sectionIndex}].units 必须是数组`)
    }
    const sectionKey = String(section.section_key ?? '').trim()
    const normalizedUnits = section.units.map((unit, unitIndex) => {
      if (!isRecord(unit)) {
        throw new Error(`翻译工作区 sections[${sectionIndex}].units[${unitIndex}] 必须是对象`)
      }
      const normalized = {
        unitKey: String(unit.unit_key ?? '').trim(),
        fieldPath: String(unit.field_path ?? '').trim(),
        sourceText: String(unit.source_text ?? ''),
        sourceHash: String(unit.source_hash ?? '').trim(),
        translatedText: String(unit.translated_text ?? ''),
        status: String(unit.status ?? '').trim(),
        editorType: String(unit.editor_type ?? '').trim(),
        sectionKey,
      }
      if (!normalized.unitKey
        || !normalized.fieldPath
        || !normalized.sourceText.trim()
        || !normalized.sourceHash
        || !normalized.status
        || !normalized.editorType
        || !normalized.sectionKey) {
        throw new Error(
          `翻译工作区 sections[${sectionIndex}].units[${unitIndex}] 的 unit_key 等关键字段不能为空`,
        )
      }
      units.push(normalized)
      return normalized
    })
    return {
      groupKey: String(section.group_key ?? '').trim(),
      sectionKey,
      scopeType: String(section.scope_type ?? '').trim(),
      scopeKey: String(section.scope_key ?? '').trim(),
      typeCode: String(section.type_code ?? '').trim(),
      title: String(section.title ?? ''),
      subtitle: String(section.subtitle ?? ''),
      progress: {
        total: numericValue(section.progress?.total),
        translated: numericValue(section.progress?.translated),
        missing: numericValue(section.progress?.missing),
        stale: numericValue(section.progress?.stale),
        percent: numericValue(section.progress?.percent),
      },
      units: normalizedUnits,
    }
  })

  return {
    revisionNo: Number(data.revision_no),
    sourceLanguage,
    targetLanguage,
    enabled: asBoolean(data.enabled),
    published: asBoolean(data.published),
    sourceLanguageLocked: asBoolean(data.source_language_locked),
    emailTranslationEnabled: asBoolean(data.email_translation_enabled),
    languages,
    sections,
    units,
  }
}

function requireWorkspaceMutationGate(payload, {
  expectedRevision,
  expectedTargetLanguage,
  requireEnabled = true,
  label = '翻译工作区',
} = {}) {
  const workspace = normalizeTranslationWorkspace(payload, expectedTargetLanguage)
  flowExpect(workspace.sourceLanguage, `${label}原文语言必须为 zh_CN，才能修改或发布`).toBe('zh_CN')
  flowExpect(workspace.revisionNo, `${label}版本必须与初始表单版本一致，才能修改或发布`)
    .toBe(Number(expectedRevision))
  flowExpect(
    workspace.languages.map((entry) => entry.code).sort(),
    `${label}目标语言集合必须且只能包含繁体中文和 English`,
  ).toEqual([...TARGET_LANGUAGES].sort())
  if (requireEnabled) {
    const enabledLanguages = workspace.languages
      .filter((entry) => entry.enabled && TARGET_LANGUAGES.includes(entry.code))
      .map((entry) => entry.code)
      .sort()
    flowExpect(enabledLanguages, `${label}必须启用繁体中文和 English，才能修改或发布`)
      .toEqual([...TARGET_LANGUAGES].sort())
    flowExpect(workspace.enabled, `${label}当前目标语言必须处于启用状态，才能修改或发布`).toBe(true)
    flowExpect(
      workspace.languages.find((entry) => entry.code === expectedTargetLanguage)?.enabled,
      `${label}当前目标语言 ${expectedTargetLanguage} 必须已启用，才能修改或发布`,
    ).toBe(true)
  }
  return workspace
}

function templateTokens(value) {
  return (String(value ?? '').match(/{{\s*[^{}]+?\s*}}/g) ?? [])
    .map((token) => `{{${token.slice(2, -2).replace(/\s+/g, '')}}}`)
    .sort()
}

function stripHtml(value) {
  return String(value ?? '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// `textContent` does not insert whitespace at block-element boundaries. Keep
// this separate from `stripHtml`, whose word-separating behavior is useful for
// language-quality analysis of rich-text content.
function textContentFromHtml(value) {
  return String(value ?? '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function languageQualityIssues(workspaceValue, language = workspaceValue?.target_language) {
  const workspace = workspaceValue?.units ? workspaceValue : normalizeWorkspace(workspaceValue)
  const issues = []
  for (const unit of workspace.units) {
    const translatedText = String(unit.translated_text ?? '').trim()
    const sourceText = String(unit.source_text ?? '').trim()
    const context = `${unit.group_key}/${unit.section_key}/${unit.field_path}`
    if (!translatedText) issues.push({ type: 'blank', context, unit_key: unit.unit_key })
    if (unit.status === 'missing' || unit.status === 'stale') {
      issues.push({ type: unit.status, context, unit_key: unit.unit_key })
    }
    if (JSON.stringify(templateTokens(sourceText)) !== JSON.stringify(templateTokens(translatedText))) {
      issues.push({ type: 'template-token-mismatch', context, unit_key: unit.unit_key })
    }
    if (unit.editor_type === 'rich_text' && (
      /<script\b[^>]*>/i.test(translatedText)
        || /<[^>]+\son\w+\s*=/i.test(translatedText)
        || /<(?:a|area|iframe|img|link|object|script)\b[^>]*(?:href|src|data)\s*=\s*["']?\s*javascript:/i.test(translatedText)
    )) {
      issues.push({ type: 'unsafe-html', context, unit_key: unit.unit_key })
    }
    if (unit.editor_type === 'rich_text') {
      const sourceListItems = (sourceText.match(/<li\b/gi) ?? []).length
      const translatedListItems = (translatedText.match(/<li\b/gi) ?? []).length
      if (sourceListItems !== translatedListItems) {
        issues.push({ type: 'rich-text-list-structure', context, unit_key: unit.unit_key })
      }
    }
    const plainTarget = stripHtml(translatedText).replace(/{{\s*[^{}]+?\s*}}/g, '')
    if (language === 'en_US' && /[\u3400-\u9fff]/u.test(plainTarget)) {
      issues.push({ type: 'english-contains-han', context, unit_key: unit.unit_key, value: plainTarget })
    }
    if (language === 'zh_HK') {
      for (const [simplified, traditional] of Object.entries(SIMPLIFIED_TO_TRADITIONAL)) {
        if (sourceText.includes(simplified) && translatedText.includes(simplified) && !translatedText.includes(traditional)) {
          issues.push({
            type: 'traditional-kept-simplified-character',
            context,
            unit_key: unit.unit_key,
            value: simplified,
          })
        }
      }
    }
  }
  return issues
}

function workspaceStructureSignature(workspaceValue) {
  const workspace = workspaceValue?.units ? workspaceValue : normalizeWorkspace(workspaceValue)
  return workspace.sections.map((section) => ({
    group_key: section.group_key,
    section_key: section.section_key,
    scope_type: section.scope_type,
    scope_key: section.scope_key,
    type_code: section.type_code,
    units: section.units.map((unit) => ({
      unit_key: unit.unit_key,
      field_path: unit.field_path,
      source_hash: unit.source_hash,
      source_text: unit.source_text,
      editor_type: unit.editor_type,
    })),
  }))
}

function analyzeTranslationWorkspace(workspaceValue) {
  const units = Array.isArray(workspaceValue?.units)
    ? workspaceValue.units
    : normalizeTranslationWorkspace(workspaceValue).units
  const normalizedUnits = units.map((unit) => ({
    unitKey: String(unit?.unitKey ?? unit?.unit_key ?? '').trim(),
    fieldPath: String(unit?.fieldPath ?? unit?.field_path ?? '').trim(),
    sourceText: String(unit?.sourceText ?? unit?.source_text ?? ''),
    sourceHash: String(unit?.sourceHash ?? unit?.source_hash ?? '').trim(),
    translatedText: String(unit?.translatedText ?? unit?.translated_text ?? ''),
    status: String(unit?.status ?? '').trim(),
    editorType: String(unit?.editorType ?? unit?.editor_type ?? '').trim(),
    sectionKey: String(unit?.sectionKey ?? unit?.section_key ?? '').trim(),
  }))
  const translated = normalizedUnits.filter((unit) => unit.status === 'translated').length
  const missing = normalizedUnits.filter((unit) => unit.status === 'missing').length
  const stale = normalizedUnits.filter((unit) => unit.status === 'stale').length
  const keyCounts = new Map()
  for (const unit of normalizedUnits) {
    if (unit.unitKey) keyCounts.set(unit.unitKey, (keyCounts.get(unit.unitKey) ?? 0) + 1)
  }
  const duplicateUnitKeys = [...keyCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([unitKey]) => unitKey)
    .sort()
  const invalidUnits = normalizedUnits.flatMap((unit, index) => {
    const invalidFields = [
      ['unitKey', unit.unitKey],
      ['fieldPath', unit.fieldPath],
      ['sourceText', unit.sourceText.trim()],
      ['sourceHash', unit.sourceHash],
      ['status', /^(translated|missing|stale)$/.test(unit.status) ? unit.status : ''],
      ['editorType', /^(plain_text|rich_text)$/.test(unit.editorType) ? unit.editorType : ''],
      ['sectionKey', unit.sectionKey],
    ].filter(([, fieldValue]) => !fieldValue).map(([field]) => field)
    if (unit.status === 'translated' && !unit.translatedText.trim()) invalidFields.push('translatedText')
    return invalidFields.length > 0 ? [{ index, unitKey: unit.unitKey, invalidFields }] : []
  })
  const total = normalizedUnits.length
  return {
    total,
    translated,
    missing,
    stale,
    complete: total > 0
      && translated === total
      && missing === 0
      && stale === 0
      && duplicateUnitKeys.length === 0
      && invalidUnits.length === 0,
    duplicateUnitKeys,
    invalidUnits,
  }
}

function compareWorkspaceStructure(leftValue, rightValue) {
  const comparableUnits = (workspaceValue) => {
    const workspaceUnits = Array.isArray(workspaceValue?.units)
      ? workspaceValue.units
      : normalizeTranslationWorkspace(workspaceValue).units
    return workspaceUnits.map((unit) => ({
      unitKey: String(unit?.unitKey ?? unit?.unit_key ?? ''),
      fieldPath: String(unit?.fieldPath ?? unit?.field_path ?? ''),
      sourceText: String(unit?.sourceText ?? unit?.source_text ?? ''),
      sourceHash: String(unit?.sourceHash ?? unit?.source_hash ?? ''),
      editorType: String(unit?.editorType ?? unit?.editor_type ?? ''),
      sectionKey: String(unit?.sectionKey ?? unit?.section_key ?? ''),
    }))
  }
  const leftUnits = comparableUnits(leftValue)
  const rightUnits = comparableUnits(rightValue)
  const differences = []
  if (leftUnits.length !== rightUnits.length) differences.push('units.length')
  const comparableFields = ['unitKey', 'fieldPath', 'sourceText', 'sourceHash', 'editorType', 'sectionKey']
  for (let index = 0; index < Math.max(leftUnits.length, rightUnits.length); index += 1) {
    const leftUnit = leftUnits[index]
    const rightUnit = rightUnits[index]
    if (!leftUnit || !rightUnit) {
      differences.push(`units[${index}]`)
      continue
    }
    for (const field of comparableFields) {
      if (leftUnit[field] !== rightUnit[field]) differences.push(`units[${index}].${field}`)
    }
  }
  return differences
}

function assertCriticalTranslations(workspace, language, customExpectations = {}) {
  const unitsBySource = new Map()
  for (const unit of workspace.units) {
    const entries = unitsBySource.get(unit.source_text) ?? []
    entries.push(unit)
    unitsBySource.set(unit.source_text, entries)
  }

  for (const [sourceText, expectedPattern] of CRITICAL_TRANSLATIONS[language] ?? []) {
    const matches = unitsBySource.get(sourceText) ?? []
    for (const unit of matches) {
      expect(unit.translated_text, `${language} AI 翻译“${sourceText}”语义应正确`).toMatch(expectedPattern)
    }
  }

  const dynamicTitleUnits = workspace.units.filter((unit) => /^自动化测试全题型表单-\d+$/.test(unit.source_text))
  for (const unit of dynamicTitleUnits) {
    if (language === 'zh_HK') {
      expect(unit.translated_text, '繁体中文表单标题应完成简繁转换')
        .toMatch(/^自動化測試全題型表單-\d+$/)
    } else if (language === 'en_US') {
      expect(unit.translated_text, '英文表单标题应保留编号并表达自动化全题型表单')
        .toMatch(/^(?=.*\d)(?=.*(?:Automated|Automation))(?=.*Form).+$/i)
    }
  }

  for (const [reference, expectedValue] of Object.entries(customExpectations[language] ?? {})) {
    const matches = workspace.units.filter((unit) => (
      unit.unit_key === reference || unit.field_path === reference
    ))
    expect(matches.length, `${language} 自定义精确断言应找到 unit_key 或 field_path “${reference}”`)
      .toBeGreaterThan(0)
    for (const unit of matches) {
      expect(unit.translated_text.trim(), `${language} ${reference} 应精确匹配配置译文`)
        .toBe(expectedValue.trim())
    }
  }
}

function criticalTranslationIssues(workspace, language, customExpectations = {}) {
  const issues = []
  const unitsBySource = new Map()
  for (const unit of workspace.units) {
    const entries = unitsBySource.get(unit.source_text) ?? []
    entries.push(unit)
    unitsBySource.set(unit.source_text, entries)
  }

  for (const [sourceText, expectedPattern] of CRITICAL_TRANSLATIONS[language] ?? []) {
    for (const unit of unitsBySource.get(sourceText) ?? []) {
      if (!expectedPattern.test(unit.translated_text)) {
        issues.push({
          type: 'critical-semantic-mismatch',
          context: unit.field_path,
          unit_key: unit.unit_key,
          source_text: sourceText,
        })
      }
    }
  }

  const dynamicTitleUnits = workspace.units.filter((unit) => /^自动化测试全题型表单-\d+$/.test(unit.source_text))
  for (const unit of dynamicTitleUnits) {
    const titleMatches = language === 'zh_HK'
      ? /^自動化測試全題型表單-\d+$/.test(unit.translated_text)
      : /^(?=.*\d)(?=.*(?:Automated|Automation))(?=.*Form).+$/i.test(unit.translated_text)
    if (!titleMatches) {
      issues.push({
        type: 'dynamic-title-mismatch',
        context: unit.field_path,
        unit_key: unit.unit_key,
      })
    }
  }

  for (const [reference, expectedValue] of Object.entries(customExpectations[language] ?? {})) {
    const matches = workspace.units.filter((unit) => (
      unit.unit_key === reference || unit.field_path === reference
    ))
    if (matches.length === 0) {
      issues.push({ type: 'custom-expectation-unit-missing', context: reference })
      continue
    }
    for (const unit of matches) {
      if (unit.translated_text.trim() !== expectedValue.trim()) {
        issues.push({
          type: 'custom-expectation-mismatch',
          context: reference,
          unit_key: unit.unit_key,
        })
      }
    }
  }
  return issues
}

function requireTranslationQualityGate(workspace, language, customExpectations = {}, label = language) {
  const normalizedWorkspace = Array.isArray(workspace?.units)
    && workspace.units.every((unit) => Object.prototype.hasOwnProperty.call(unit, 'translated_text'))
    ? workspace
    : normalizeWorkspace(workspace)
  const qualityIssues = languageQualityIssues(normalizedWorkspace, language)
  const blockingQualityIssues = qualityIssues.filter((issue) => [
    'blank',
    'missing',
    'stale',
    'template-token-mismatch',
    'unsafe-html',
    'rich-text-list-structure',
  ].includes(issue.type))
  flowExpect(
    blockingQualityIssues,
    `${label}存在空白、陈旧、模板变量丢失、危险富文本或列表结构损坏，禁止保存发布`,
  ).toEqual([])
  const criticalIssues = criticalTranslationIssues(normalizedWorkspace, language, customExpectations)
  const customExpectationIssues = criticalIssues.filter((issue) => issue.type.startsWith('custom-expectation-'))
  flowExpect(
    customExpectationIssues,
    `${label}用户配置的自定义精确译文不符合要求，禁止保存发布`,
  ).toEqual([])
  return { blockingQualityIssues, criticalIssues, customExpectationIssues, qualityIssues }
}

function assertTranslationWorkspace(payload, {
  label,
  expectedRevision,
  expectedTargetLanguage,
  requireEnabled = true,
  requireComplete = false,
  requirePublished = false,
  customExpectations = {},
} = {}) {
  const workspace = normalizeWorkspace(payload)
  const prefix = label || `${expectedTargetLanguage || '目标语言'}翻译工作区`
  expect(workspace.valid, `${prefix}响应应包含 languages 和 sections`).toBe(true)
  expect(workspace.revision_no, `${prefix} revision_no 应为正整数`).toBeGreaterThan(0)
  if (expectedRevision !== undefined) {
    expect(workspace.revision_no, `${prefix} revision_no 应与表单版本一致`).toBe(Number(expectedRevision))
  }
  expect(workspace.source_language, `${prefix}原文语言应为简体中文`).toBe('zh_CN')
  if (expectedTargetLanguage) {
    expect(workspace.target_language, `${prefix} target_language 应正确`).toBe(expectedTargetLanguage)
  }
  expect(workspace.languages.map((entry) => entry.language).sort(), `${prefix}应只配置两个目标语言`)
    .toEqual([...TARGET_LANGUAGES].sort())
  expect(workspace.sections.length, `${prefix}应包含翻译分区`).toBeGreaterThan(0)
  expect(workspace.units.length, `${prefix}应包含翻译单元`).toBeGreaterThan(0)
  expect(workspace.units.map((unit) => unit.unit_key).filter(Boolean), `${prefix}翻译单元 key 应唯一`)
    .toHaveLength(new Set(workspace.units.map((unit) => unit.unit_key).filter(Boolean)).size)

  for (const section of workspace.sections) {
    expect(section.group_key, `${prefix}每个分区都应包含 group_key`).toMatch(/^(form_structure|other_translation|email_translation)$/)
    expect(section.section_key, `${prefix}每个分区都应包含 section_key`).toMatch(/\S+/)
    expect(section.scope_type, `${prefix}每个分区都应包含合法 scope_type`).toMatch(/^(form|item|config)$/)
    expect(section.units.length, `${prefix}分区 ${section.section_key} 应包含翻译单元`).toBeGreaterThan(0)
  }

  for (const unit of workspace.units) {
    const unitLabel = `${prefix} ${unit.section_key}/${unit.field_path}`
    expect(unit.unit_key, `${unitLabel} 应包含 unit_key`).toMatch(/\S+/)
    expect(unit.field_path, `${unitLabel} 应包含 field_path`).toMatch(/\S+/)
    expect(unit.source_hash, `${unitLabel} 应包含 source_hash`).toMatch(/\S+/)
    expect(unit.source_text, `${unitLabel} 原文不应为空`).toMatch(/\S+/)
    expect(unit.editor_type, `${unitLabel}编辑器类型应受支持`).toMatch(/^(plain_text|rich_text)$/)
    expect(unit.status, `${unitLabel}状态应受支持`).toMatch(/^(translated|missing|stale)$/)
    expect(templateTokens(unit.translated_text), `${unitLabel}译文必须保留模板变量`)
      .toEqual(templateTokens(unit.source_text))
    if (requireComplete) {
      expect(unit.status, `${unitLabel}在完成发布前应为已翻译`).toBe('translated')
      expect(unit.translated_text.trim(), `${unitLabel}在完成发布前译文不应为空`).toMatch(/\S+/)
    }
  }

  for (const language of TARGET_LANGUAGES) {
    const entry = workspace.languages.find((candidate) => candidate.language === language)
    expect(entry, `${prefix}应包含 ${language} 配置`).toBeTruthy()
    expect(entry?.language_text, `${prefix} ${language} 应包含展示名称`).toMatch(/\S+/)
    if (requireEnabled) {
      expect(entry?.enabled, `${prefix} ${language} 应启用`).toBe(true)
    }
    if (requireComplete) {
      expect(entry?.progress?.total, `${prefix} ${language} 应包含翻译单元`).toBeGreaterThan(0)
      expect(entry?.progress?.missing, `${prefix} ${language} 不应有待翻译项`).toBe(0)
      expect(entry?.progress?.stale, `${prefix} ${language} 不应有需更新项`).toBe(0)
      expect(entry?.progress?.translated, `${prefix} ${language} 应全部翻译`)
        .toBe(entry?.progress?.total)
      expect(entry?.progress?.percent, `${prefix} ${language} 翻译进度应为 100%`).toBe(100)
    }
    if (requirePublished) {
      expect(entry?.published, `${prefix} ${language} 应已发布`).toBe(true)
    }
  }

  if (requireComplete && expectedTargetLanguage) {
    const issues = languageQualityIssues(workspace, expectedTargetLanguage)
    for (const issue of issues) {
      expect(issue, `${prefix}语言质量不应出现 ${issue.type}：${issue.context}`).toBeNull()
    }
    expect(issues, `${prefix}不应存在空白、陈旧、语言混用、变量丢失或富文本结构问题`).toEqual([])
    assertCriticalTranslations(workspace, expectedTargetLanguage, customExpectations)
    requireTranslationQualityGate(workspace, expectedTargetLanguage, customExpectations, prefix)
  }
  return workspace
}

function structureOnly(value, parentKey = '') {
  if (Array.isArray(value)) return value.map((entry) => structureOnly(entry, parentKey))
  if (!isRecord(value)) return value
  const result = {}
  for (const key of Object.keys(value).sort()) {
    if (VOLATILE_STRUCTURE_KEYS.has(key) || TEXTUAL_STRUCTURE_KEYS.has(key)) continue
    result[key] = structureOnly(value[key], key || parentKey)
  }
  return result
}

function signatureItems(items) {
  // Admin list settings can change API array order without changing the form.
  // Align by identity; structural signatures still compare each item's sort,
  // group, rules and ordered options, including missing or duplicate items.
  return [...items].sort((left, right) => String(left.item_key ?? '').localeCompare(String(right.item_key ?? '')))
}

function structuralSignature(payload) {
  const { data, form, items } = unwrapFormPayload(payload)
  const revisionNo = numericValue(data.revision_no)
    || numericValue(form.current_revision_no)
    || numericValue(form.draft_revision_no)
    || numericValue(items.find((item) => numericValue(item.revision_no))?.revision_no)
  return {
    formId: String(form.form_id ?? form.id ?? data.form_id ?? ''),
    revisionNo,
    items: signatureItems(items).map((item) => ({
      item_key: String(item.item_key ?? ''),
      type_code: String(item.type_code ?? ''),
      group_code: String(item.group_code ?? ''),
      item_kind: String(item.item_kind ?? ''),
      sort: numericValue(item.sort),
      hidden: numericValue(item.hidden),
      private: numericValue(item.private),
      rule_config: structureOnly(item.rule_config),
      common_config: structureOnly(item.common_config),
      option: structureOnly(item.option),
    })),
  }
}

function projectSignatureAgainstReference(reference, candidate) {
  if (Array.isArray(reference)) {
    // The public endpoint omits an empty option array. It is semantically the
    // same value, but a populated or reordered array must still fail.
    if (reference.length === 0) {
      if (candidate === undefined || candidate === null || (Array.isArray(candidate) && candidate.length === 0)) {
        return []
      }
      return candidate
    }
    if (!Array.isArray(candidate) || candidate.length !== reference.length) return candidate
    return reference.map((entry, index) => projectSignatureAgainstReference(entry, candidate[index]))
  }
  if (!isRecord(reference)) return candidate
  if (!isRecord(candidate)) return candidate

  // Public form responses hydrate locale dictionaries (for example area-code
  // choices) that are intentionally absent from the sparse admin response.
  // Compare every field present in the admin source while excluding only those
  // response-only additions.
  return Object.fromEntries(Object.keys(reference).map((key) => [
    key,
    projectSignatureAgainstReference(reference[key], candidate[key]),
  ]))
}

function publicStructuralSignature(sourcePayload, publicPayload) {
  const source = structuralSignature(sourcePayload)
  return projectSignatureAgainstReference(source, structuralSignature(publicPayload))
}

function sourceTextSignature(payload, { includeSystemItems = true } = {}) {
  const { form, items } = unwrapFormPayload(payload)
  return {
    source_language: String(form.source_language ?? ''),
    title: String(form.title ?? ''),
    subtitle: String(form.subtitle ?? ''),
    description: String(form.description ?? ''),
    items: signatureItems(items.filter((item) => includeSystemItems || !isSystemItem(item))).map((item) => ({
      item_key: String(item.item_key ?? ''),
      label: String(item.label ?? ''),
      description: String(item.description ?? ''),
      placeholder: String(item.placeholder ?? ''),
      validation_message: String(item.validation_message ?? ''),
      option: item.option,
      common_config: item.common_config,
    })),
  }
}

function publicSourceTextSignature(sourcePayload, publicPayload) {
  // Submission metadata labels (device, duration, etc.) belong to the admin
  // list settings and are intentionally absent from the public form content.
  // Admin-to-admin checks above still compare them; structure checks keep every item.
  const options = { includeSystemItems: false }
  const source = sourceTextSignature(sourcePayload, options)
  return projectSignatureAgainstReference(source, sourceTextSignature(publicPayload, options))
}

function orderedContentFormItems(items) {
  return items
    .filter((item) => String(item.item_kind ?? 'common') !== 'system')
    .sort((left, right) => numericValue(left.sort) - numericValue(right.sort))
}

function assertSourceFormDetail(payload, formId) {
  const { data, form, items } = unwrapFormPayload(payload)
  expect(String(form.form_id ?? form.id ?? ''), '翻译前表单详情应属于目标表单 ID').toBe(formId)
  expect(form.source_language, '表单原文语言应为 zh_CN').toBe('zh_CN')
  expect(String(form.title ?? ''), '翻译前表单应包含标题').toMatch(/\S+/)
  expect(items.length, '翻译前表单应包含题目').toBeGreaterThan(0)
  expect(items.map((item) => item.item_key).filter(Boolean), '翻译前题目 item_key 应唯一')
    .toHaveLength(new Set(items.map((item) => item.item_key).filter(Boolean)).size)
  expect(items.every((item) => numericValue(item.revision_no) > 0), '翻译前每个题目都应属于有效版本').toBe(true)

  const translation = form.translation
  expect(isRecord(translation), '表单详情应明确包含多语言配置').toBe(true)
  const untranslatable = isRecord(translation) ? translation.untranslatable_sections : null
  expect(isRecord(untranslatable), '多语言配置应明确包含不可翻译分区').toBe(true)
  for (const [group, expectedSections] of Object.entries(EXPECTED_UNTRANSLATABLE_SECTIONS)) {
    expect(
      isRecord(untranslatable) && Object.prototype.hasOwnProperty.call(untranslatable, group),
      `多语言设置应明确包含 ${group} 不可翻译分组`,
    ).toBe(true)
    expect(isRecord(untranslatable) ? untranslatable[group] : undefined, `多语言设置中 ${group} 的不可翻译分区应符合产品契约`)
      .toEqual([...expectedSections])
  }

  if (/^自动化测试全题型表单-\d+$/.test(String(form.title ?? ''))) {
    const contentItems = orderedContentFormItems(items)
    expect(contentItems.map((item) => item.type_code), '全题型表单的题型和分页顺序应保持基线')
      .toEqual([...ALL_FIELDS_TYPE_SEQUENCE])
    flowExpect(contentItems.map((item) => item.type_code), '全题型表单的题型和分页顺序应保持基线')
      .toEqual([...ALL_FIELDS_TYPE_SEQUENCE])
    expect(contentItems.filter((item) => item.type_code === 'page'), '全题型表单应保留三个分页组件').toHaveLength(3)
    flowExpect(contentItems.filter((item) => item.type_code === 'page'), '全题型表单应保留三个分页组件').toHaveLength(3)
    expect(contentItems.filter((item) => item.type_code !== 'page'), '全题型表单应保留 30 个题目或布局组件').toHaveLength(30)
    flowExpect(contentItems.filter((item) => item.type_code !== 'page'), '全题型表单应保留 30 个题目或布局组件').toHaveLength(30)
  }
  return {
    data,
    form,
    items,
    revisionNo: structuralSignature(payload).revisionNo,
    sourceSignature: sourceTextSignature(payload),
    structureSignature: structuralSignature(payload),
  }
}

function splitFieldPath(path) {
  const segments = []
  let current = ''
  let bracketDepth = 0
  for (const character of String(path ?? '')) {
    if (character === '[') bracketDepth += 1
    if (character === ']') bracketDepth = Math.max(0, bracketDepth - 1)
    if (character === '.' && bracketDepth === 0) {
      if (!current) return null
      segments.push(current)
      current = ''
    } else {
      current += character
    }
  }
  if (!current || bracketDepth !== 0) return null
  segments.push(current)
  return segments
}

function parseFieldSegment(segment) {
  const match = String(segment).match(/^([A-Za-z0-9_]+)((?:\[[A-Za-z0-9_-]+=[^\]]*\])*)$/)
  if (!match) return null
  const selectors = {}
  for (const selector of match[2].matchAll(/\[([A-Za-z0-9_-]+)=([^\]]*)\]/g)) {
    try {
      selectors[selector[1]] = selector[2] === '*' ? null : decodeURIComponent(selector[2])
    } catch {
      return null
    }
  }
  return { field: match[1], selectors }
}

function readFieldPath(target, path) {
  const rawSegments = splitFieldPath(path)
  if (!rawSegments) return undefined
  const segments = rawSegments.map(parseFieldSegment)
  if (segments.some((segment) => !segment)) return undefined
  let current = target
  for (const segment of segments) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment.field)) return undefined
    current = current[segment.field]
    const selectors = Object.entries(segment.selectors)
    if (selectors.length > 0) {
      if (!Array.isArray(current)) return undefined
      current = current.find((candidate) => isRecord(candidate) && selectors.every(([key, expected]) => {
        const actual = candidate[key]
        return expected === null || String(actual ?? '') === expected
      }))
    }
  }
  return typeof current === 'string' ? current : undefined
}

function objectForWorkspaceSection(payload, section) {
  const { form, items } = unwrapFormPayload(payload)
  if (section.scope_type === 'form' || section.scope_type === 'config') return form
  if (section.scope_type !== 'item') return null
  return items.find((item) => String(item.item_key ?? '') === section.scope_key) ?? null
}

function normalizeComparableText(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim()
}

function assertWorkspaceAppliedToPayload(workspace, sourcePayload, localizedPayload, language) {
  for (const section of workspace.sections) {
    if (section.group_key === 'email_translation') continue
    const sourceObject = objectForWorkspaceSection(sourcePayload, section)
    const localizedObject = objectForWorkspaceSection(localizedPayload, section)
    expect(sourceObject, `${language} ${section.section_key} 应能定位原文对象`).toBeTruthy()
    expect(localizedObject, `${language} ${section.section_key} 应能定位公开页对象`).toBeTruthy()
    if (!sourceObject || !localizedObject) continue
    for (const unit of section.units) {
      const sourceValue = readFieldPath(sourceObject, unit.field_path)
      const localizedValue = readFieldPath(localizedObject, unit.field_path)
      expect(normalizeComparableText(sourceValue), `${language} ${unit.field_path} 工作区原文应与表单源字段一致`)
        .toBe(normalizeComparableText(unit.source_text))
      expect(normalizeComparableText(localizedValue), `${language} ${unit.field_path} 公开接口应使用已发布译文`)
        .toBe(normalizeComparableText(unit.translated_text))
    }
  }
}

function isApiBusinessRequest(request, apiOrigin) {
  const url = new URL(request.url())
  return url.origin === apiOrigin
    && AUTHENTICATED_API_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
}

function buildPublicPreviewUrl(siteBaseUrl, formId, language) {
  if (!SUPPORTED_LANGUAGES.includes(language)) throw new Error(`不支持的公开预览语言：${language}`)
  const url = new URL('/form/', `${publicOriginForSite(siteBaseUrl)}/`)
  url.searchParams.set('id', formId)
  url.searchParams.set('locale', language)
  return url.toString()
}

function firstPageItems(payload) {
  const { items } = unwrapFormPayload(payload)
  const firstPage = items.find((item) => item.type_code === 'page' && !item.group_code)
  if (!firstPage) return items.filter((item) => !item.group_code && item.type_code !== 'page')
  const sorted = [...items].sort((left, right) => numericValue(left.sort) - numericValue(right.sort))
  const pageIndex = sorted.indexOf(firstPage)
  const nextPageIndex = sorted.findIndex((item, index) => index > pageIndex && item.type_code === 'page' && !item.group_code)
  return sorted.slice(pageIndex + 1, nextPageIndex < 0 ? sorted.length : nextPageIndex)
    .filter((item) => !item.group_code)
}

async function readVisiblePreview(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element)
      const rectangle = element.getBoundingClientRect()
      return style.visibility !== 'hidden' && style.display !== 'none' && rectangle.width > 0 && rectangle.height > 0
    }
    const text = (selector) => {
      const element = [...document.querySelectorAll(selector)].find(visible)
      return element?.textContent?.trim() ?? ''
    }
    return {
      htmlLang: document.documentElement.lang,
      documentTitle: document.title,
      title: text('.fb-runtime-form-title'),
      subtitle: text('.fb-runtime-form-subtitle'),
      description: text('.fb-runtime-form-content'),
      fieldLabels: [...document.querySelectorAll('[data-item-key] .fb-runtime-field-heading')]
        .filter(visible)
        .map((element) => ({
          itemKey: element.closest('[data-item-key]')?.getAttribute('data-item-key') ?? '',
          text: element.textContent?.replace(/\s*\*\s*$/, '').trim() ?? '',
        })),
      fieldContent: [...document.querySelectorAll('[data-item-key]')]
        .filter(visible)
        .map((element) => ({
          itemKey: element.getAttribute('data-item-key') ?? '',
          value: element.innerText?.trim() ?? '',
        })),
      placeholders: [...document.querySelectorAll('[data-item-key] input[placeholder], [data-item-key] textarea[placeholder]')]
        .filter(visible)
        .map((element) => ({
          itemKey: element.closest('[data-item-key]')?.getAttribute('data-item-key') ?? '',
          value: element.getAttribute('placeholder') ?? '',
        })),
      controlLabels: [...document.querySelectorAll('[data-item-key] button, [data-item-key] [role="button"], [data-item-key] [role="combobox"]')]
        .filter(visible)
        .flatMap((element) => [
          element.textContent?.trim() ?? '',
          element.getAttribute('aria-label')?.trim() ?? '',
        ])
        .filter(Boolean),
      pagination: [...document.querySelectorAll('.fb-runtime-pagination-buttons button')]
        .filter(visible)
        .map((element) => element.textContent?.trim() ?? ''),
      qrCodes: [...document.querySelectorAll('img[alt*="QR"], img[alt*="二维码"], img[alt*="二維碼"]')]
        .filter(visible)
        .map((element) => ({ alt: element.getAttribute('alt') ?? '', src: element.getAttribute('src') ?? '' })),
    }
  })
}

function visibleLanguageIssues(snapshot, language) {
  const values = [
    ['documentTitle', snapshot.documentTitle],
    ['title', snapshot.title],
    ['subtitle', snapshot.subtitle],
    ['description', snapshot.description],
    ...snapshot.fieldLabels.map((entry) => [`field:${entry.itemKey}`, entry.text]),
    ...snapshot.fieldContent.map((entry) => [`field-content:${entry.itemKey}`, entry.value]),
    ...snapshot.placeholders.map((entry) => [`placeholder:${entry.itemKey}`, entry.value]),
    ...snapshot.controlLabels.map((entry, index) => [`control:${index}`, entry]),
    ...snapshot.pagination.map((entry, index) => [`pagination:${index}`, entry]),
  ]
  const issues = []
  for (const [context, rawValue] of values) {
    const value = stripHtml(rawValue)
    if (!value) continue
    if (language === 'en_US' && /[\u3400-\u9fff]/u.test(value)) {
      issues.push({ type: 'english-preview-contains-han', context, value })
    }
    if (language === 'zh_HK') {
      for (const [simplified, traditional] of Object.entries(SIMPLIFIED_TO_TRADITIONAL)) {
        if (value.includes(simplified) && !value.includes(traditional)) {
          issues.push({ type: 'traditional-preview-kept-simplified-character', context, value: simplified })
        }
      }
    }
  }
  return issues
}

async function assertPublicPreviewUi(page, payload, language, formId) {
  const { form } = unwrapFormPayload(payload)
  await flowExpect(page.locator('.fb-runtime-form-title'), `${language} 公开预览主标题必须完成挂载`)
    .toBeVisible()
  const snapshot = await readVisiblePreview(page)
  expect(snapshot.htmlLang, `${language} 公开预览 html lang 应正确`).toBe(HTML_LANGS[language])
  expect(snapshot.documentTitle, `${language} 公开预览浏览器标题应使用本语言表单标题`).toBe(String(form.title ?? ''))
  expect(snapshot.title, `${language} 公开预览主标题应使用本语言表单标题`).toBe(String(form.title ?? ''))
  expect(snapshot.subtitle, `${language} 公开预览副标题应使用本语言译文`).toBe(String(form.subtitle ?? ''))
  expect(snapshot.description, `${language} 公开预览说明应与本语言配置一致`)
    .toBe(textContentFromHtml(form.description ?? ''))

  const expectedFirstPageItems = firstPageItems(payload)
  const visibleLabelsByKey = new Map(snapshot.fieldLabels.map((entry) => [entry.itemKey, entry.text]))
  for (const item of expectedFirstPageItems.filter((entry) => (
    entry.hidden !== true
      && numericValue(entry.hidden) !== 1
      && !['page', 'description', 'divider'].includes(String(entry.type_code ?? ''))
  ))) {
    expect(visibleLabelsByKey.get(String(item.item_key ?? '')), `${language} 公开预览应显示 ${item.item_key} 的本语言标题`)
      .toBe(String(item.label ?? ''))
  }
  const hasMultiplePages = unwrapFormPayload(payload).items
    .filter((item) => item.type_code === 'page' && !item.group_code).length > 1
  if (hasMultiplePages) {
    expect(snapshot.pagination.length, `${language} 多页公开预览第 1 页应显示翻页按钮`).toBeGreaterThan(0)
  }

  const issues = language === 'zh_CN' ? [] : visibleLanguageIssues(snapshot, language)
  expect(issues, `${language} 公开预览可见标题、字段、占位符和分页按钮应符合目标语言`).toEqual([])
  return snapshot
}

async function captureEvidence(page, artifactWriter, relativePath, logger, options = {}) {
  if (!artifactWriter || typeof artifactWriter.captureScreenshot !== 'function') {
    expect(false, `证据截图 ${relativePath} 需要 Runner 提供 artifactWriter`).toBe(true)
    return null
  }
  try {
    const artifact = await artifactWriter.captureScreenshot(page, relativePath, {
      fullPage: false,
      animations: 'disabled',
      ...options,
    })
    expect(artifact?.relativePath, `证据截图 ${relativePath} 应成功写入制品`).toBe(relativePath)
    logger('success', '已保存多语言测试证据截图', { artifact })
    return artifact
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    expect(false, `证据截图 ${relativePath} 写入失败：${reason}`).toBe(true)
    return null
  }
}

async function ensureTargetLanguagesEnabled(page, workspace, formId, logger) {
  let currentWorkspace = workspace
  for (const language of TARGET_LANGUAGES) {
    const entry = currentWorkspace.languages.find((candidate) => candidate.language === language)
    const languageCard = targetLanguageCard(page, language)
    await expect(languageCard, `多语言设置应显示 ${language} 目标语言`).toHaveCount(1)
    await flowExpect(languageCard, `多语言设置应显示 ${language} 目标语言`).toHaveCount(1)
    const toggle = languageCard.getByRole('switch')
    await expect(toggle, `${language} 目标语言开关应可见`).toBeVisible()
    await flowExpect(toggle, `${language} 目标语言开关应可见`).toBeVisible()
    await expect(toggle, `${language} 目标语言开关初始状态应与接口 enabled 一致`)
      .toHaveAttribute('aria-checked', entry?.enabled ? 'true' : 'false')
    await flowExpect(toggle, `${language} 目标语言开关初始状态应与接口 enabled 一致`)
      .toHaveAttribute('aria-checked', entry?.enabled ? 'true' : 'false')
    if (entry?.enabled) continue
    const [response] = await runActionAndWaitForApiResponses(page, {
      method: 'PUT',
      pathnameSuffix: `/be/form/${formId}/translation/language`,
    }, () => clickWhenReady(toggle))
    const outcome = await inspectBusinessResponse(response, `启用 ${language} 目标语言`)
    flowExpect(outcome.succeeded, `启用 ${language} 接口必须成功，才能继续多语言配置`).toBe(true)
    const requestPayload = parseRequestPayload(response.request(), `启用 ${language} 目标语言`)
    expect(requestPayload.enabled_languages, `启用 ${language} 请求应只新增该语言`).toContain(language)
    expect(requestPayload.disabled_languages ?? [], `启用 ${language} 请求不应停用语言`).toEqual([])
    requireWorkspaceMutationGate(outcome.body, {
      expectedRevision: currentWorkspace.revision_no,
      expectedTargetLanguage: currentWorkspace.target_language,
      requireEnabled: false,
      label: `启用 ${language} 响应工作区`,
    })
    currentWorkspace = normalizeWorkspace(outcome.body)
    expect(currentWorkspace.languages.find((candidate) => candidate.language === language)?.enabled, `${language} 回读后应已启用`).toBe(true)
    flowExpect(
      currentWorkspace.languages.find((candidate) => candidate.language === language)?.enabled,
      `${language} 响应必须确认本次目标语言已启用`,
    ).toBe(true)
    await expect(toggle, `${language} 启用成功后 UI 开关应更新为选中`).toHaveAttribute('aria-checked', 'true')
    await flowExpect(toggle, `${language} 启用成功后 UI 开关必须更新为选中`).toHaveAttribute('aria-checked', 'true')
    logger('success', '目标语言已按多语言设置要求启用', { language })
  }
  for (const language of TARGET_LANGUAGES) {
    const languageCard = targetLanguageCard(page, language)
    await expect(languageCard.getByRole('switch'), `${language} 在 AI 翻译前应保持启用`)
      .toHaveAttribute('aria-checked', 'true')
    await flowExpect(languageCard.getByRole('switch'), `${language} 在 AI 翻译前应保持启用`)
      .toHaveAttribute('aria-checked', 'true')
  }
  flowExpect(currentWorkspace.enabled, 'AI 一键翻译前当前目标语言必须处于启用状态').toBe(true)
  return currentWorkspace
}

async function activateTargetLanguage(page, language) {
  const languageCard = targetLanguageCard(page, language)
  await expect(languageCard, `多语言编辑器应显示 ${language} 目标语言标签`).toHaveCount(1)
  await flowExpect(languageCard, `多语言编辑器应显示 ${language} 目标语言标签`).toHaveCount(1)
  const activeClassPattern = /(^|\s)target-language-tab--active(\s|$)/
  if (activeClassPattern.test(await languageCard.getAttribute('class') ?? '')) {
    // A direct URL can mark this tab active before its cached editor data switches.
    const alternateLanguage = TARGET_LANGUAGES.find((candidate) => candidate !== language)
    const alternateCard = targetLanguageCard(page, alternateLanguage)
    await flowExpect(alternateCard, `${language} 同步前必须存在另一目标语言标签`).toHaveCount(1)
    await clickWhenReady(alternateCard)
    await flowExpect(alternateCard, `${language} 同步前应先切换到另一目标语言标签`)
      .toHaveClass(activeClassPattern)
  }
  await clickWhenReady(languageCard)
  await expect(languageCard, `${language} 保存前应是当前选中的目标语言标签`)
    .toHaveClass(activeClassPattern)
  await flowExpect(languageCard, `${language} 保存前必须是当前选中的目标语言标签`)
    .toHaveClass(activeClassPattern)
}

async function navigateToWorkspaceSection(page, workspace, sectionKey) {
  const sectionIndex = workspace.sections.findIndex((section) => section.section_key === sectionKey)
  flowExpect(sectionIndex, `翻译编辑器必须能定位分区 ${sectionKey}`).toBeGreaterThanOrEqual(0)
  const navItem = page.locator('.section-nav__item').nth(sectionIndex)
  await flowExpect(navItem, `翻译编辑器必须显示分区 ${sectionKey} 的导航项`).toBeVisible()
  await clickWhenReady(navItem)
  return navItem
}

async function readRenderedTranslationUnits(page) {
  const units = await page.locator('article.translation-unit').evaluateAll((articles) => articles.map((article) => {
    const sourceEditor = article.querySelector('.source-column textarea, .source-column input')
    const targetEditor = article.querySelector('.target-column textarea, .target-column input')
    const iframe = article.querySelector('.target-column iframe')
    return {
      id: article.id,
      className: article.className,
      sourceText: sourceEditor?.value ?? '',
      sourceReadonly: sourceEditor?.readOnly === true || sourceEditor?.disabled === true,
      targetText: targetEditor?.value ?? '',
      hasRichTextEditor: Boolean(iframe),
    }
  }))

  for (const unit of units.filter((entry) => entry.hasRichTextEditor)) {
    const article = page.locator(`article.translation-unit[id="${unit.id.replace(/["\\]/g, '\\$&')}"]`)
    const body = article.frameLocator('.target-column iframe').locator('body')
    await flowExpect(body, `${unit.id} 富文本译文编辑器必须完成挂载`).toBeVisible()
    unit.targetText = await body.innerText()
  }
  return units
}

async function waitForRenderedTargetText(article, unit, language) {
  if (unit.editor_type === 'rich_text') {
    const body = article.frameLocator('.target-column iframe').locator('body')
    await flowExpect(body, `${language} ${unit.section_key}/${unit.field_path} 切换语言后富文本译文必须完成同步`)
      .toContainText(stripHtml(unit.translated_text))
    return
  }
  const editor = article.locator('.target-column textarea, .target-column input').first()
  await flowExpect(editor, `${language} ${unit.section_key}/${unit.field_path} 切换语言后译文编辑器必须完成同步`)
    .toHaveValue(unit.translated_text)
}

async function assertTranslationEditorMatchesWorkspace(page, workspace, language, logger) {
  await activateTargetLanguage(page, language)
  const navItems = page.locator('.section-nav__item')
  expect(await navItems.count(), `${language} 结构导航项数量应与接口 sections 一致`)
    .toBe(workspace.sections.length)

  for (const section of workspace.sections) {
    const navItem = await navigateToWorkspaceSection(page, workspace, section.section_key)
    const firstUnit = section.units[0]
    if (!firstUnit) {
      expect(section.units, `${language} ${section.section_key} 应包含可翻译单元`).not.toHaveLength(0)
      continue
    }
    const firstUnitLocator = page.locator(
      `article.translation-unit[id="translation-unit-${firstUnit.unit_key.replace(/["\\]/g, '\\$&')}"]`,
    )
    await flowExpect(
      firstUnitLocator,
      `${language} ${section.section_key} 首个翻译单元必须渲染，才能继续逐单元核对`,
    ).toBeVisible()
    await waitForRenderedTargetText(firstUnitLocator, firstUnit, language)

    const renderedUnits = await readRenderedTranslationUnits(page)
    const expectedProgress = `${section.units.filter((unit) => unit.status === 'translated').length}/${section.units.length}`
    expect(await navItem.innerText(), `${language} ${section.section_key} 导航进度应为 ${expectedProgress}`)
      .toContain(expectedProgress)
    expect(renderedUnits.map((unit) => unit.id), `${language} ${section.section_key} 应逐一渲染接口返回的 unit_key`)
      .toEqual(section.units.map((unit) => `translation-unit-${unit.unit_key}`))

    const renderedById = new Map(renderedUnits.map((unit) => [unit.id, unit]))
    for (const unit of section.units) {
      const rendered = renderedById.get(`translation-unit-${unit.unit_key}`)
      expect(rendered, `${language} ${section.section_key}/${unit.field_path} 应存在编辑器单元`).toBeTruthy()
      if (!rendered) continue
      expect(rendered.sourceReadonly, `${language} ${section.section_key}/${unit.field_path} 原文编辑器应只读`).toBe(true)
      const renderedSourceText = rendered.hasRichTextEditor
        ? stripHtml(rendered.sourceText)
        : normalizeComparableText(rendered.sourceText)
      const expectedSourceText = rendered.hasRichTextEditor
        ? stripHtml(unit.source_text)
        : normalizeComparableText(unit.source_text)
      const renderedTargetText = rendered.hasRichTextEditor
        ? stripHtml(rendered.targetText)
        : normalizeComparableText(rendered.targetText)
      const expectedTargetText = rendered.hasRichTextEditor
        ? stripHtml(unit.translated_text)
        : normalizeComparableText(unit.translated_text)
      expect(renderedSourceText, `${language} ${section.section_key}/${unit.field_path} UI 原文应与接口一致`)
        .toBe(expectedSourceText)
      expect(renderedTargetText, `${language} ${section.section_key}/${unit.field_path} UI 译文应与接口一致`)
        .toBe(expectedTargetText)
      flowExpect(renderedTargetText, `${language} ${section.section_key}/${unit.field_path} UI 译文必须与接口一致，才能保存或发布`)
        .toBe(expectedTargetText)
      if (unit.status === 'translated') {
        expect(rendered.className, `${language} ${section.section_key}/${unit.field_path} UI 应显示已翻译状态`)
          .toContain('translation-unit--translated')
      }
    }
  }
  logger('success', '翻译编辑器已逐分区、逐单元与工作区接口完成对照', {
    language,
    sectionCount: workspace.sections.length,
    unitCount: workspace.units.length,
  })
}

async function triggerAiTranslation(page, workspace, formId, aiTimeoutMs, logger) {
  const aiButton = page.getByRole('button', { name: /一键\s*AI\s*翻译|一鍵\s*AI\s*翻譯/i })
  await expect(aiButton, '多语言页面应提供“一键 AI 翻译”按钮').toBeVisible()
  await flowExpect(aiButton, '一键 AI 翻译流程入口必须可点击').toBeEnabled()
  await clickWhenReady(aiButton)

  const modal = page.locator('.ai-translation-modal')
  await expect(modal, 'AI 一键翻译应打开目标语言确认弹窗').toBeVisible()
  const checkboxes = modal.getByRole('checkbox')
  await expect(checkboxes, 'AI 一键翻译弹窗应恰好列出两个目标语言').toHaveCount(2)
  await flowExpect(checkboxes, 'AI 一键翻译弹窗应恰好列出两个目标语言').toHaveCount(2)
  for (const language of TARGET_LANGUAGES) {
    const checkbox = modal.getByRole('checkbox', { name: languageLabelPattern(language) })
    await expect(checkbox, `AI 一键翻译应提供 ${language} 选项`).toHaveCount(1)
    await flowExpect(checkbox, `AI 一键翻译应提供 ${language} 选项`).toHaveCount(1)
    if (!await checkbox.isChecked()) await checkbox.check()
    await expect(checkbox, `AI 一键翻译应选中 ${language}`).toBeChecked()
    await flowExpect(checkbox, `AI 一键翻译应选中 ${language}`).toBeChecked()
  }
  await expect(
    modal.getByText(/仅补全空白项和需更新项|僅補全空白項和需更新項|Only empty and outdated entries/i),
    'AI 一键翻译应说明保留有效人工译文',
  ).toBeVisible()
  // Arco Modal renders its footer outside the modal body carrying this class.
  const startTranslationButton = page.getByRole('button', {
    name: /^(开始翻译|開始翻譯|Start translation)$/i,
  }).last()
  await expect(startTranslationButton, 'AI 一键翻译弹窗应提供“开始翻译”按钮').toBeVisible()
  await flowExpect(startTranslationButton, 'AI 一键翻译弹窗应提供可点击的“开始翻译”按钮').toBeEnabled()

  const startedAt = Date.now()
  const deadline = startedAt + aiTimeoutMs
  const remainingTimeout = () => Math.max(1, deadline - Date.now())
  const [aiResponse] = await runActionAndWaitForApiResponses(page, {
    method: 'POST',
    pathnameSuffix: `/be/form/${formId}/translation/ai`,
    options: { timeout: remainingTimeout() },
  }, () => clickWhenReady(startTranslationButton))
  const outcome = await inspectBusinessResponse(aiResponse, 'AI 一键翻译任务提交')
  const requestPayload = parseRequestPayload(aiResponse.request(), 'AI 一键翻译任务提交')
  expect(Number(requestPayload.revision_no), 'AI 一键翻译请求 revision_no 应匹配工作区').toBe(workspace.revision_no)
  expect([...(requestPayload.target_languages ?? [])].sort(), 'AI 一键翻译请求应包含全部已启用目标语言')
    .toEqual([...TARGET_LANGUAGES].sort())
  flowExpect(Number(requestPayload.revision_no), 'AI 一键翻译请求必须携带当前工作区 revision_no')
    .toBe(workspace.revision_no)
  flowExpect([...(requestPayload.target_languages ?? [])].sort(), 'AI 一键翻译请求必须且只能包含两个目标语言')
    .toEqual([...TARGET_LANGUAGES].sort())
  flowExpect(outcome.succeeded, 'AI 一键翻译 POST 必须成功，才能等待任务终态').toBe(true)
  let task = isRecord(outcome.body.data) ? outcome.body.data : {}
  let statusOutcome = outcome
  while (asBoolean(task.busy) || Number(task.status) !== 4) {
    const status = Number(task.status)
    if (status === 5 || status === 6) {
      throw new Error(`AI 一键翻译失败，status=${status}，error_message=${String(task.error_message ?? '')}`)
    }
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      throw new Error(`AI 一键翻译未在 ${aiTimeoutMs}ms 内完成`)
    }
    const [statusResponse] = await runActionAndWaitForApiResponses(page, {
      method: 'GET',
      pathnameSuffix: `/be/form/${formId}/translation/ai/status`,
      options: { query: { revision_no: workspace.revision_no }, timeout: remaining },
    })
    statusOutcome = await inspectBusinessResponse(statusResponse, 'AI 一键翻译任务状态轮询')
    flowExpect(statusOutcome.succeeded, 'AI 一键翻译状态接口必须成功，才能继续保存发布').toBe(true)
    task = isRecord(statusOutcome.body.data) ? statusOutcome.body.data : {}
  }
  expect(Number(task.revision_no), 'AI 一键翻译终态 revision_no 应匹配').toBe(workspace.revision_no)
  expect([...(Array.isArray(task.target_languages) ? task.target_languages : [])].sort(), 'AI 一键翻译终态应确认两个目标语言')
    .toEqual([...TARGET_LANGUAGES].sort())
  flowExpect(Number(task.revision_no), 'AI 一键翻译终态必须属于当前工作区版本')
    .toBe(workspace.revision_no)
  flowExpect([...(Array.isArray(task.target_languages) ? task.target_languages : [])].sort(), 'AI 一键翻译终态必须确认两个目标语言')
    .toEqual([...TARGET_LANGUAGES].sort())
  expect(asBoolean(task.busy), 'AI 一键翻译终态 busy 应为 false').toBe(false)
  expect(Number(task.status), 'AI 一键翻译终态 status 应为 4').toBe(4)
  flowExpect(Number(task.status), '后续保存和发布仅允许在 AI status=4 后执行').toBe(4)
  if (Date.now() >= deadline) {
    throw new Error(`AI 一键翻译已完成，但按钮未能在 ${aiTimeoutMs}ms 总超时内恢复`)
  }
  await flowExpect(aiButton, 'AI 一键翻译成功后按钮必须在总超时内恢复可用')
    .toBeEnabled({ timeout: remainingTimeout() })
  logger('success', 'AI 一键翻译任务已完成或确认当前译文无需覆盖', {
    revisionNo: workspace.revision_no,
    targetLanguages: TARGET_LANGUAGES,
    taskStatus: task.status,
  })
  return {
    outcome,
    requestPayload,
    statusOutcome,
    task,
    durationMs: Date.now() - startedAt,
  }
}

async function loadPersistedWorkspace(page, translationUrl, formId, language, expectedRevision) {
  const url = new URL(translationUrl)
  url.searchParams.set('target_language', language)
  url.searchParams.set('revision_no', String(expectedRevision))
  const [response] = await runActionAndWaitForApiResponses(page, {
    method: 'GET',
    pathnameSuffix: `/be/form/${formId}/translation`,
    options: {
      query: { target_language: language, revision_no: expectedRevision },
      afterNavigation: true,
      timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS),
    },
  }, () => page.goto(url.toString(), { waitUntil: 'domcontentloaded' }))
  const outcome = await inspectBusinessResponse(response, `${language} 翻译保存后回读`)
  return { outcome, url: url.toString() }
}

function workspaceUnitByKey(payload, unitKey) {
  return normalizeWorkspace(payload).units.find((unit) => unit.unit_key === unitKey)
}

async function fillTranslationUnit(page, language, workspace, unit, value) {
  await navigateToWorkspaceSection(page, workspace, unit.section_key)
  await activateTargetLanguage(page, language)
  const article = page.locator(
    `article.translation-unit[id="translation-unit-${unit.unit_key.replace(/["\\]/g, '\\$&')}"]`,
  )
  await flowExpect(article, `${unit.field_path} 翻译单元必须可见，才能执行保存回读`).toBeVisible()
  const editor = article.locator(
    '.target-column textarea:not([readonly]), .target-column input:not([readonly])',
  ).first()
  await flowExpect(editor, `${unit.field_path} 普通译文编辑器必须可编辑`).toBeVisible()
  await flowExpect(editor, `${unit.field_path} 编辑前必须回显 ${language} 当前译文，才能保存`)
    .toHaveValue(unit.translated_text)
  await editor.fill(value)
  await flowExpect(editor, `${unit.field_path} 编辑器必须回显待保存值`).toHaveValue(value)
}

async function saveTranslationValue(page, formId, language, workspace, unit, value, label) {
  await fillTranslationUnit(page, language, workspace, unit, value)
  const saveButton = page.getByRole('button', { name: /^(保存|储存|儲存|Save)$/ })
  await expect(saveButton, `${language} 翻译页面应显示保存按钮`).toBeVisible()
  await flowExpect(saveButton, `${language} 产生译文改动后保存按钮必须可用`).toBeEnabled()
  const [response] = await runActionAndWaitForApiResponses(page, {
    method: 'PUT',
    pathnameSuffix: `/be/form/${formId}/translation`,
  }, () => clickWhenReady(saveButton))
  const outcome = await inspectBusinessResponse(response, label)
  const requestPayload = parseRequestPayload(response.request(), label)
  expect(Number(requestPayload.revision_no), `${label} revision_no 应匹配`).toBe(workspace.revision_no)
  expect(requestPayload.target_language, `${label} target_language 应匹配`).toBe(language)
  expect(Array.isArray(requestPayload.translations), `${label} translations 应为数组`).toBe(true)
  expect(requestPayload.translations, `${label} 应只提交当前 dirty 翻译单元`).toEqual([{
    unit_key: unit.unit_key,
    source_hash: unit.source_hash,
    translated_text: value,
  }])
  const savedTranslation = Array.isArray(requestPayload.translations)
    ? requestPayload.translations.find((entry) => entry?.unit_key === unit.unit_key)
    : null
  expect(savedTranslation?.source_hash, `${label} 应携带当前 source_hash`).toBe(unit.source_hash)
  expect(savedTranslation?.translated_text, `${label} 应携带当前编辑器译文`).toBe(value)
  flowExpect(outcome.succeeded, `${label}接口必须成功，才能继续回读`).toBe(true)
  flowExpect(Number(requestPayload.revision_no), `${label}必须提交当前工作区 revision_no`)
    .toBe(workspace.revision_no)
  flowExpect(requestPayload.target_language, `${label}必须提交当前目标语言`).toBe(language)
  flowExpect(requestPayload.translations, `${label}必须且只能真实提交目标 dirty 单元`).toEqual([{
    unit_key: unit.unit_key,
    source_hash: unit.source_hash,
    translated_text: value,
  }])
  await expect(
    page.getByText(/译文已保存|譯文已儲存|Translations saved/i).last(),
    `${label}后页面应提示译文已保存`,
  ).toBeVisible()
  return { outcome, requestPayload }
}

function translationApiUrl(apiBaseUrl, formId) {
  const base = new URL(`${String(apiBaseUrl).replace(/\/+$/, '')}/`)
  return new URL(`be/form/${encodeURIComponent(formId)}/translation`, base)
}

async function directTranslationRequest(requestContext, url, options, label, timeoutMs) {
  const response = await requestContext.fetch(String(url), {
    method: options.method,
    failOnStatusCode: false,
    maxRedirects: 0,
    timeout: timeoutMs,
    ...(options.body
      ? {
          data: options.body,
          headers: { 'Content-Type': 'application/json' },
        }
      : {}),
  })
  const body = await response.json().catch(() => null)
  flowExpect(response.ok(), `${label}必须返回成功 HTTP 状态，才能确认探针已恢复`).toBe(true)
  flowExpect(isRecord(body), `${label}必须返回有效 JSON，才能确认探针已恢复`).toBe(true)
  flowExpect(Number(body?.code), `${label}业务码必须为 0，才能确认探针已恢复`).toBe(0)
  return body
}

async function disposeRequestContextWithin(
  requestContext,
  logger,
  disposeTimeoutMs = scaleTimeout(REQUEST_CONTEXT_DISPOSE_TIMEOUT_MS),
) {
  if (!requestContext) return
  let timeoutId
  const outcome = await Promise.race([
    requestContext.dispose({ reason: '多语言可逆探针恢复已结束' }).then(
      () => ({ status: 'disposed' }),
      (error) => ({ status: 'failed', error }),
    ),
    new Promise((resolve) => {
      timeoutId = setTimeout(
        () => resolve({ status: 'timed-out' }),
        disposeTimeoutMs,
      )
    }),
  ])
  clearTimeout(timeoutId)
  if (outcome.status === 'timed-out') {
    logger('warning', `独立探针请求上下文销毁超过 ${disposeTimeoutMs}ms，已停止等待`)
  } else if (outcome.status === 'failed') {
    logger('warning', '独立探针请求上下文销毁失败', {
      reason: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
    })
  }
}

function translationProbeRecoveryAction(currentValue, probeValue, originalValue) {
  if (currentValue === originalValue) return 'already-restored'
  if (currentValue === probeValue) return 'restore-probe'
  return 'conflict'
}

function createTranslationProbeValue(originalValue, marker = randomUUID().replaceAll('-', '')) {
  const original = String(originalValue)
  const normalizedMarker = String(marker).replace(/[^a-zA-Z0-9]/g, '') || 'AUTOTEST'
  if (original.length < 8) return `${original}[P${normalizedMarker.slice(0, 8)}]`
  const replacementLength = Math.min(12, original.length)
  let replacement = normalizedMarker.padEnd(replacementLength, '0').slice(0, replacementLength)
  if (`${replacement}${original.slice(replacementLength)}` === original) {
    replacement = `${replacement.slice(0, -1)}${replacement.endsWith('Z') ? 'Y' : 'Z'}`
  }
  return `${replacement}${original.slice(replacementLength)}`
}

async function ensureOriginalTranslationRestored({
  requestContext,
  apiBaseUrl,
  formId,
  language,
  workspace,
  unit,
  originalValue,
  probeValue,
  probePersistenceUncertain = false,
  recoveryTimeoutMs = scaleTimeout(PROBE_RECOVERY_TIMEOUT_MS),
  recoveryPollIntervalMs = PROBE_RECOVERY_POLL_INTERVAL_MS,
  recoveryActionReserveMs = PROBE_RECOVERY_ACTION_RESERVE_MS,
  now = Date.now,
  wait = (timeoutMs) => new Promise((resolve) => setTimeout(resolve, timeoutMs)),
}) {
  const deadline = now() + recoveryTimeoutMs
  const recoveryActionBudgetMs = Math.min(
    Math.max(0, recoveryActionReserveMs),
    Math.max(0, recoveryTimeoutMs - 1),
  )
  const observationDeadline = deadline - recoveryActionBudgetMs
  const finalReadReserveMs = Math.floor(recoveryActionBudgetMs / 2)
  const recoveryWriteDeadline = deadline - finalReadReserveMs
  const remainingTimeout = (requestDeadline, label, phase) => {
    const remaining = requestDeadline - now()
    if (remaining <= 0) throw new Error(`${label}超过${phase}截止时间`)
    return remaining
  }
  const endpoint = translationApiUrl(apiBaseUrl, formId)
  const readEndpoint = new URL(endpoint)
  readEndpoint.searchParams.set('target_language', language)
  readEndpoint.searchParams.set('revision_no', String(workspace.revision_no))
  const readCurrentUnit = async (label, requestDeadline, phase) => {
    const payload = await directTranslationRequest(
      requestContext,
      readEndpoint,
      { method: 'GET' },
      label,
      remainingTimeout(requestDeadline, label, phase),
    )
    if (now() > requestDeadline) throw new Error(`${label}响应超过${phase}截止时间，结果不可信`)
    requireWorkspaceMutationGate(payload, {
      expectedRevision: workspace.revision_no,
      expectedTargetLanguage: language,
      label,
    })
    const currentUnit = workspaceUnitByKey(payload, unit.unit_key)
    if (!currentUnit) throw new Error(`${label}无法定位单元 ${unit.unit_key}`)
    flowExpect(currentUnit.source_hash, `${label} source_hash 必须仍与保存前一致`)
      .toBe(unit.source_hash)
    return currentUnit
  }

  let currentUnit = await readCurrentUnit(
    `${language} 探针清理前独立回读`,
    observationDeadline,
    '观察',
  )
  while (
    probePersistenceUncertain
    && currentUnit.translated_text === originalValue
    && now() < observationDeadline
  ) {
    await wait(Math.min(
      Math.max(1, recoveryPollIntervalMs),
      observationDeadline - now(),
    ))
    if (now() >= observationDeadline) break
    currentUnit = await readCurrentUnit(
      `${language} 不确定探针延迟持续回读`,
      observationDeadline,
      '观察',
    )
  }

  const recoveryAction = translationProbeRecoveryAction(
    currentUnit.translated_text,
    probeValue,
    originalValue,
  )
  expect(recoveryAction, `${language} 探针清理不得覆盖其他会话写入的译文`).not.toBe('conflict')
  flowExpect(recoveryAction, `${language} 探针清理检测到并发译文，已拒绝覆盖`).not.toBe('conflict')

  if (recoveryAction === 'restore-probe') {
    await directTranslationRequest(
      requestContext,
      endpoint,
      {
        method: 'PUT',
        body: JSON.stringify({
          revision_no: workspace.revision_no,
          target_language: language,
          translations: [{
            unit_key: unit.unit_key,
            source_hash: currentUnit.source_hash,
            translated_text: originalValue,
          }],
        }),
      },
      `${language} 探针异常清理`,
      remainingTimeout(recoveryWriteDeadline, `${language} 探针异常清理`, '恢复写入'),
    )
    if (now() > recoveryWriteDeadline) {
      throw new Error(`${language} 探针异常清理响应超过恢复写入截止时间，无法保证最终回读预算`)
    }
    currentUnit = await readCurrentUnit(
      `${language} 探针清理后独立回读`,
      deadline,
      '恢复总超时',
    )
  }
  if (!currentUnit || currentUnit.translated_text !== originalValue) {
    throw new Error(`${language} 探针译文未恢复为原值`)
  }
}

async function assertSaveRoundTrip(
  page,
  translationUrl,
  recoveryRequestContext,
  apiBaseUrl,
  formId,
  language,
  workspace,
  logger,
) {
  const unit = workspace.units.find((candidate) => (
    candidate.field_path === 'form.title'
      && candidate.editor_type === 'plain_text'
      && candidate.translated_text.trim()
      && templateTokens(candidate.translated_text).length === 0
  )) ?? workspace.units.find((candidate) => (
    candidate.editor_type === 'plain_text'
      && candidate.translated_text.trim()
      && templateTokens(candidate.translated_text).length === 0
  ))
  flowExpect(unit, `${language} 必须至少有一个非空普通文本单元，以验证真实保存能力`).toBeTruthy()
  const originalValue = unit.translated_text
  const probeValue = createTranslationProbeValue(originalValue)
  flowExpect(probeValue, `${language} 可逆探针必须使用本次运行唯一且非原值的内容`).not.toBe(originalValue)
  let probeMayHavePersisted = false
  let probeSaveConfirmed = false
  let primaryError

  try {
    probeMayHavePersisted = true
    await saveTranslationValue(
      page,
      formId,
      language,
      workspace,
      unit,
      probeValue,
      `${language} 可逆探针保存`,
    )
    probeSaveConfirmed = true
    const probeRead = await loadPersistedWorkspace(
      page,
      translationUrl,
      formId,
      language,
      workspace.revision_no,
    )
    const persistedProbe = workspaceUnitByKey(probeRead.outcome.body, unit.unit_key)
    expect(persistedProbe?.translated_text, `${language} 探针保存后 GET 应回读相同译文`).toBe(probeValue)
    flowExpect(persistedProbe?.translated_text, `${language} 探针必须持久化后才执行恢复`).toBe(probeValue)

    await saveTranslationValue(
      page,
      formId,
      language,
      normalizeWorkspace(probeRead.outcome.body),
      persistedProbe,
      originalValue,
      `${language} 原译文恢复保存`,
    )
  } catch (error) {
    primaryError = error
  } finally {
    if (probeMayHavePersisted) {
      try {
        await ensureOriginalTranslationRestored({
          requestContext: recoveryRequestContext,
          apiBaseUrl,
          formId,
          language,
          workspace,
          unit,
          originalValue,
          probeValue,
          probePersistenceUncertain: !probeSaveConfirmed,
        })
      } catch (cleanupError) {
        logger('error', '可逆探针恢复失败，已停止后续发布以避免覆盖并发译文', {
          language,
          unitKey: unit.unit_key,
          reason: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        })
        throw new AggregateError(
          [primaryError, cleanupError].filter(Boolean),
          `${language} 保存验证失败，且自动恢复原译文失败`,
        )
      }
    }
  }
  if (primaryError) throw primaryError

  const restoredRead = await loadPersistedWorkspace(
    page,
    translationUrl,
    formId,
    language,
    workspace.revision_no,
  )
  const restoredUnit = workspaceUnitByKey(restoredRead.outcome.body, unit.unit_key)
  expect(restoredUnit?.translated_text, `${language} 恢复保存后应回读原译文`).toBe(originalValue)
  flowExpect(restoredUnit?.translated_text, `${language} 原译文必须恢复，才能继续发布`).toBe(originalValue)
  logger('success', '已通过可逆编辑验证翻译 PUT、请求体和独立 GET 持久化回读', {
    language,
    unitKey: unit.unit_key,
  })
  return restoredRead
}

async function completeAndPublish(page, formId, workspace, formTitle, logger) {
  const completeButton = page.getByRole('button', { name: /完成并发布|完成並發佈|Complete and publish/i }).first()
  await expect(completeButton, '全部目标语言完成后“完成并发布”按钮应可用').toBeEnabled()
  await flowExpect(completeButton, '发布流程依赖全部已启用语言达到 100%').toBeEnabled()
  await clickWhenReady(completeButton)

  const confirmationText = page.getByText(/确认发布全部已启用语言|確認發佈全部已啟用語言|Publish all enabled languages/i)
  await expect(confirmationText, '完成并发布前应二次确认全部已启用语言').toBeVisible()
  const confirmationPopup = page.locator('.arco-popconfirm, .arco-trigger-popup').filter({ has: confirmationText }).last()
  const confirmButton = confirmationPopup.getByRole('button', {
    name: /完成并发布|完成並發佈|Complete and publish/i,
  }).last()
  await expect(confirmButton, '发布确认层应提供“完成并发布”按钮').toBeVisible()

  const [completeResponse] = await runActionAndWaitForApiResponses(page, {
    method: 'POST',
    pathnameSuffix: `/be/form/${formId}/translation/complete`,
  }, () => clickWhenReady(confirmButton))
  const outcome = await inspectBusinessResponse(completeResponse, '多语言完成并发布')
  flowExpect(outcome.succeeded, '多语言完成并发布接口必须成功，才能进入发布结果检查').toBe(true)
  const requestPayload = parseRequestPayload(completeResponse.request(), '多语言完成并发布')
  expect(Number(requestPayload.revision_no), '多语言完成并发布请求 revision_no 应匹配').toBe(workspace.revision_no)
  expect(requestPayload.target_language, '多语言完成并发布请求应携带当前目标语言').toBe(workspace.target_language)
  const completedWorkspace = assertTranslationWorkspace(outcome.body, {
    label: '多语言完成并发布响应',
    expectedRevision: workspace.revision_no,
    expectedTargetLanguage: workspace.target_language,
    requireComplete: true,
    requirePublished: true,
  })
  const completedGate = requireWorkspaceMutationGate(outcome.body, {
    expectedRevision: workspace.revision_no,
    expectedTargetLanguage: workspace.target_language,
    label: '完成发布响应',
  })
  flowExpect(analyzeTranslationWorkspace(completedGate).complete, '完成发布响应中全部翻译单元必须完整').toBe(true)
  flowExpect(
    completedGate.languages
      .filter((entry) => TARGET_LANGUAGES.includes(entry.code))
      .map((entry) => entry.code)
      .sort(),
    '完成发布响应必须包含两个目标语言',
  ).toEqual([...TARGET_LANGUAGES].sort())
  flowExpect(
    completedGate.languages
      .filter((entry) => TARGET_LANGUAGES.includes(entry.code))
      .every((entry) => entry.published),
    '完成发布响应中两个目标语言必须都标记为已发布',
  ).toBe(true)
  await page.waitForURL(/\/form-activity\/list(?:[/?#]|$)/, { timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS) })

  const statusFilter = page.locator('.filter-card-field').filter({
    has: page.locator('.filter-card-label', { hasText: /发布状态|發佈狀態|Publication status/i }),
  })
  await flowExpect(statusFilter, '发布后列表必须提供发布状态筛选器').toHaveCount(1)
  const statusSelect = statusFilter.locator('.arco-select')
  await flowExpect(statusSelect, '发布状态筛选器必须可操作').toBeVisible()
  await clickWhenReady(statusSelect)
  const publishedOption = page.locator('.arco-select-option:visible').filter({
    hasText: /^(已发布|已發佈|Published)$/i,
  })
  await flowExpect(publishedOption, '发布状态筛选器必须提供已发布选项').toHaveCount(1)
  await clickWhenReady(publishedOption)
  await flowExpect(statusSelect, '发布后定向查询必须限定为已发布状态')
    .toHaveAttribute('title', /^(已发布|已發佈|Published)$/i)
  const titleInput = page.getByPlaceholder(/请输入标题|請輸入標題|Enter title/i)
  await flowExpect(titleInput, '发布后列表标题筛选框必须可用').toBeVisible()
  await titleInput.fill(formTitle)
  const [listResponse] = await runActionAndWaitForApiResponses(page, {
    method: 'GET',
    pathnameSuffix: '/be/form/list',
    options: {
      query: { 'filter[title]': formTitle },
      timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS),
    },
  }, () => clickWhenReady(page.getByRole('button', { name: /查询|查詢|搜索|搜尋|Search/i })))
  const listOutcome = await inspectBusinessResponse(listResponse, '多语言发布后定向查询表单列表')
  logger('success', '两个目标语言已完成并发布，页面已返回表单列表', {
    formId,
    revisionNo: workspace.revision_no,
  })
  return { completedWorkspace, completeOutcome: outcome, listOutcome }
}

function assertPublishedListRecord(payload, formId, formTitle, expectedRevision) {
  const body = isRecord(payload) ? payload : {}
  const records = Array.isArray(body.data?.list)
    ? body.data.list
    : Array.isArray(body.data?.records)
      ? body.data.records
      : []
  const recordIndex = records.findIndex((candidate) => (
    [candidate?.id, candidate?.form_id].some((value) => String(value ?? '') === formId)
  ))
  const record = recordIndex >= 0 ? records[recordIndex] : null
  expect(record, '多语言发布后列表接口应返回目标表单').toBeTruthy()
  flowExpect(recordIndex, '发布后必须在列表接口中定位目标 FORM_ID').toBeGreaterThanOrEqual(0)
  expect(record?.title, '多语言发布后列表接口标题应完全匹配').toBe(formTitle)
  expect(record?.status, '多语言发布后列表接口表单状态应为 published').toBe('published')
  expect(Number(record?.current_revision_no), '多语言发布后列表接口版本应匹配翻译版本')
    .toBe(Number(expectedRevision))
  const progress = record?.translation_progress ?? record?.translation ?? {}
  expect(Number(progress.total), '多语言发布后目标语言总数应为 2').toBe(TARGET_LANGUAGES.length)
  expect(Number(progress.completed), '多语言发布后完成语言数应为 2').toBe(TARGET_LANGUAGES.length)
  expect(Number(progress.published_languages), '多语言发布后已发布语言数应为 2').toBe(TARGET_LANGUAGES.length)
  return { record, recordIndex }
}

async function assertPublishedListUi(page, formTitle, formId, recordIndex) {
  const rows = page.locator('tbody > tr.arco-table-tr')
  await flowExpect(rows.nth(recordIndex), 'API 定位的目标 FORM_ID 必须映射到同序号列表行').toBeVisible()
  const row = rows.nth(recordIndex)
  const titleLink = row.locator('.form-activity-list__title-link')
  await expect(titleLink, '多语言发布后目标行应显示一个表单标题').toHaveCount(1)
  await expect(titleLink, '多语言发布后目标行标题应完全匹配').toHaveText(formTitle)
  const translationLinks = row.locator('a.arco-link').filter({ hasText: /^\s*2\s*\/\s*2\s*$/ })
  await flowExpect(translationLinks, '目标表单行必须且只能显示一个多语言进度链接').toHaveCount(1)
  const translationLink = translationLinks.first()
  const translationCell = translationLink.locator('xpath=ancestor::td[1]')
  await expect(translationCell, '多语言列表列应显示 2/2 完成进度').toContainText('2/2')
  await expect(
    translationCell.getByText(/^(已发布|已發佈|Published)$/i),
    '多语言列表列应显示已发布状态',
  ).toHaveCount(1)
  await flowExpect(translationLink, '多语言列表进度应可进入目标表单翻译页').toBeVisible()
  await clickWhenReady(translationLink)
  await flowExpect(page, '多语言列表目标行应导航到对应 FORM_ID 的翻译页')
    .toHaveURL((url) => (
      url.pathname.endsWith('/form-activity/translation')
        && url.searchParams.get('id') === formId
    ), { timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS) })
}

function parseShareLink(rawValue, label) {
  const url = tryParseShareLink(rawValue)
  expect(url, `${label}应为有效绝对 URL`).toBeTruthy()
  return url
}

function tryParseShareLink(rawValue) {
  try {
    const url = new URL(String(rawValue ?? '').trim())
    if (!['http:', 'https:'].includes(url.protocol)) return null
    return url
  } catch {
    return null
  }
}

async function waitForShareLink(rows, index, label) {
  const value = rows.locator('.share-link-display-value').nth(index)
  await flowExpect(value, `${label}展示区域必须可见`).toBeVisible()
  await flowExpect.poll(async () => tryParseShareLink(await value.innerText()), {
    message: `${label}必须在分享页异步生成完成后显示有效绝对 URL`,
    timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS),
  }).toBeTruthy()
  return String(await value.innerText()).trim()
}

async function decodeQrImage(qrImage, expectedValue, label) {
  await flowExpect.poll(async () => qrImage.evaluate((image) => (
    image.complete && image.naturalWidth > 0 && image.naturalHeight > 0
  )), {
    message: `${label}二维码图片必须完成加载，才能解码`,
    timeout: scaleTimeout(ACTION_TIMEOUT_MS),
  }).toBe(true)
  const pixels = await qrImage.evaluate((image) => {
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('浏览器无法创建二维码像素读取上下文')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
    return {
      data: Array.from(imageData.data),
      height: imageData.height,
      width: imageData.width,
    }
  })
  const decoded = jsQR(
    Uint8ClampedArray.from(pixels.data),
    pixels.width,
    pixels.height,
    { inversionAttempts: 'attemptBoth' },
  )
  expect(decoded?.data, `${label}二维码应成功解码并严格编码对应链接`).toBe(expectedValue)
  return decoded?.data ?? ''
}

function navigationRequestPage(request) {
  try {
    return request.frame().page()
  } catch {
    // Playwright has no frame yet for the first navigation request of a popup.
    return null
  }
}

function isMainFrameNavigationRequest(request, page) {
  if (!request.isNavigationRequest()) return false
  try {
    return request.frame() === page.mainFrame()
  } catch {
    return false
  }
}

async function inspectDirectOpenButton(page, row, openedUrl, expectedLandingUrl, label) {
  const directOpen = row.getByRole('button', { name: /直接打开|直接打開|Open directly/i })
  await expect(directOpen, `${label}应提供一个“直接打开”按钮`).toHaveCount(1)
  if (await directOpen.count() !== 1) return null
  const context = page.context()
  const navigationRequests = []
  const trackNavigation = (request) => {
    if (!request.isNavigationRequest()) return
    navigationRequests.push({ page: navigationRequestPage(request), url: request.url() })
  }
  context.on('request', trackNavigation)
  let popup
  try {
    const [openedPopup] = await runActionAndWaitForWatchers([
      () => context.waitForEvent('page', { timeout: scaleTimeout(ACTION_TIMEOUT_MS) }),
    ], () => clickWhenReady(directOpen))
    popup = openedPopup
    await popup.waitForLoadState('domcontentloaded', { timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS) }).catch(() => undefined)
    await popup.waitForURL((url) => (
      url.origin === expectedLandingUrl.origin
        && url.pathname === expectedLandingUrl.pathname
        && url.searchParams.get('id') === expectedLandingUrl.searchParams.get('id')
    ), {
      timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS),
    })
    const popupNavigations = navigationRequests
      .filter((entry) => entry.page === popup || entry.page === null)
      .map((entry) => entry.url)
    expect(popupNavigations[0], `${label}直接打开的首次导航必须命中界面显示链接`)
      .toBe(openedUrl.toString())
    const actualUrl = new URL(popup.url())
    expect(actualUrl.origin, `${label}直接打开后应进入公开域名`).toBe(expectedLandingUrl.origin)
    expect(actualUrl.pathname, `${label}直接打开后应进入公开表单路径`).toBe(expectedLandingUrl.pathname)
    expect(actualUrl.searchParams.get('id'), `${label}直接打开后应保留表单 ID`)
      .toBe(expectedLandingUrl.searchParams.get('id'))
    expect(actualUrl.searchParams.get('channel_code'), `${label}直接打开后应保留分享渠道`)
      .toBe(expectedLandingUrl.searchParams.get('channel_code'))
    return actualUrl.toString()
  } catch (error) {
    expect(false, `${label}直接打开应成功创建并导航公开页：${error instanceof Error ? error.message : String(error)}`)
      .toBe(true)
    return null
  } finally {
    context.off('request', trackNavigation)
    await popup?.close().catch(() => undefined)
  }
}

async function assertUnauthenticatedShareRedirect(context, shortUrlValue, longUrlValue, formId) {
  const shortUrl = new URL(shortUrlValue)
  const longUrl = new URL(longUrlValue)
  const page = await context.newPage()
  observeUiReadiness(page)
  page.setDefaultTimeout(scaleTimeout(ACTION_TIMEOUT_MS))
  page.setDefaultNavigationTimeout(scaleTimeout(NAVIGATION_TIMEOUT_MS))
  const navigations = []
  const trackNavigation = (request) => {
    if (!isMainFrameNavigationRequest(request, page)) return
    navigations.push({ headers: request.headers(), url: request.url() })
  }
  context.on('request', trackNavigation)
  try {
    await page.goto(shortUrl.toString(), { waitUntil: 'domcontentloaded' })
    await flowExpect(page, '无认证上下文打开短链必须重定向到对应公开长链').toHaveURL((url) => (
      url.origin === longUrl.origin
        && url.pathname === longUrl.pathname
        && url.searchParams.get('id') === formId
        && url.searchParams.get('channel_code') === longUrl.searchParams.get('channel_code')
    ), { timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS) })
    await flowExpect(page.locator('.fb-runtime-form-title'), '无认证上下文经短链进入后公开表单必须完成挂载')
      .toBeVisible()
    flowExpect(navigations[0]?.url, '无认证短链验证的首次主框架导航必须严格命中界面显示短链')
      .toBe(shortUrl.toString())
    expect(navigations[0]?.headers?.authorization, '无认证短链首次请求不得携带 Authorization').toBeUndefined()
    expect(navigations[0]?.headers?.cookie, '无认证短链首次请求不得携带管理端 Cookie').toBeUndefined()
    const landingUrl = new URL(page.url())
    expect(landingUrl.origin, '无认证短链最终公开域名应与长链一致').toBe(longUrl.origin)
    expect(landingUrl.pathname, '无认证短链最终公开路径应与长链一致').toBe(longUrl.pathname)
    expect(landingUrl.searchParams.get('id'), '无认证短链最终表单 ID 应与长链一致').toBe(formId)
    expect(landingUrl.searchParams.get('channel_code'), '无认证短链最终渠道应与长链一致')
      .toBe(longUrl.searchParams.get('channel_code'))
  } finally {
    context.off('request', trackNavigation)
    await page.close().catch(() => undefined)
  }
}

async function inspectShareSettingsPage({
  page,
  siteBaseUrl,
  formId,
  authorization,
  extraHTTPHeaders,
  artifactWriter,
  logger,
}) {
  const shareUrl = new URL('/form-activity/settings', `${new URL(siteBaseUrl).origin}/`)
  shareUrl.searchParams.set('id', formId)
  shareUrl.searchParams.set('step', 'share')
  await page.goto(shareUrl.toString(), { waitUntil: 'domcontentloaded' })
  await flowExpect(page, '分享设置页不得跳转登录').not.toHaveURL(/\/login(?:[/?#]|$)/)
  const channelCards = page.locator('.share-link-channel-card')
  await flowExpect(channelCards.first(), '分享设置页必须至少渲染一个分享渠道').toBeVisible()
  expect(await channelCards.count(), '分享设置页应包含可用分享渠道').toBeGreaterThan(0)

  const card = channelCards.first()
  const rows = card.locator('.share-link-display-row')
  await flowExpect(rows, '目标分享渠道必须同时显示长链和短链').toHaveCount(2)
  const rawLongUrl = await waitForShareLink(rows, 0, '分享长链')
  const rawShortUrl = await waitForShareLink(rows, 1, '分享短链')
  const longUrl = parseShareLink(rawLongUrl, '分享长链')
  const shortUrl = parseShareLink(rawShortUrl, '分享短链')
  flowExpect(longUrl, '必须提取有效分享长链，才能继续公开页验证').toBeTruthy()
  flowExpect(shortUrl, '必须提取有效分享短链，才能继续直达验证').toBeTruthy()

  const publicOrigin = publicOriginForSite(siteBaseUrl)
  expect(longUrl.origin, '分享长链应使用当前环境公开域名').toBe(publicOrigin)
  expect(longUrl.pathname, '分享长链应进入公开表单路径').toBe('/form/')
  expect(longUrl.searchParams.get('id'), '分享长链应携带目标表单 ID').toBe(formId)
  expect(longUrl.searchParams.get('channel_code'), '分享长链应携带非空 channel_code').toMatch(/\S+/)
  expect(longUrl.searchParams.has('locale'), '分享长链不应固化语言，应由右上角菜单切换').toBe(false)
  expect(shortUrl.protocol, '分享短链应使用 HTTPS').toBe('https:')
  expect(shortUrl.origin, '分享短链应使用产品短链域名').toBe('https://1xi.co')
  expect(shortUrl.pathname, '分享短链路径不应为空').not.toBe('/')
  expect(longUrl.toString(), '长链和短链不应相同').not.toBe(shortUrl.toString())

  const secretCandidates = Object.entries(extraHTTPHeaders ?? {})
    .filter(([name, value]) => /authorization|token|api[_-]?key|secret/i.test(name) && value)
    .map(([name, value]) => ({ name, value }))
  secretCandidates.push({ name: 'adminAuthorization', value: authorization })
  for (const [label, link] of [['长链', longUrl], ['短链', shortUrl]]) {
    expect(sensitiveShareUrlParameters(link), `分享${label}不得包含敏感参数`).toEqual([])
    expect(findShareUrlSecretLeaks(link, secretCandidates), `分享${label}不得泄漏管理端凭证`).toEqual([])
  }

  const qrImage = card.locator('.share-link-qr-image')
  await expect(qrImage, '分享渠道应显示二维码图片').toHaveCount(1)
  await expect(qrImage, '分享二维码应可见').toBeVisible()
  const qrState = await qrImage.evaluate((image) => ({
    alt: image.getAttribute('alt') ?? '',
    src: image.getAttribute('src') ?? '',
    complete: image.complete,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
  }))
  expect(qrState.src, '分享二维码应使用非空图片数据').toMatch(/^data:image\/png;base64,/)
  expect(qrState.complete, '分享二维码资源应加载完成').toBe(true)
  expect(qrState.naturalWidth, '分享二维码宽度应大于 0').toBeGreaterThan(0)
  expect(qrState.naturalHeight, '分享二维码高度应大于 0').toBeGreaterThan(0)
  expect(qrState.alt, '分享二维码应包含可访问文本').toMatch(/\S+/)
  const decodedLongQr = await decodeQrImage(qrImage, rawLongUrl, '分享长链')

  const segmentedButtons = card.locator('.share-link-segmented-button')
  await expect(segmentedButtons, '二维码应提供长链和短链两种模式').toHaveCount(2)
  if (await segmentedButtons.count() === 2) {
    await expect(segmentedButtons.nth(0), '二维码默认应选择长链').toHaveAttribute('aria-pressed', 'true')
    const longQrSource = qrState.src
    await clickWhenReady(segmentedButtons.nth(1))
    await expect(segmentedButtons.nth(1), '二维码应能切换到短链模式').toHaveAttribute('aria-pressed', 'true')
    await expect(qrImage, '长短链二维码图片内容应不同').not.toHaveAttribute('src', longQrSource)
    const decodedShortQr = await decodeQrImage(qrImage, rawShortUrl, '分享短链')
    expect(decodedShortQr, '短链二维码不得错误编码成长链').not.toBe(decodedLongQr)
    await clickWhenReady(segmentedButtons.nth(0))
    await expect(segmentedButtons.nth(0), '二维码应能切回长链模式').toHaveAttribute('aria-pressed', 'true')
    await decodeQrImage(qrImage, rawLongUrl, '切回后的分享长链')
  }

  await inspectDirectOpenButton(page, rows.nth(0), longUrl, longUrl, '分享长链')
  const shortOpenedUrl = await inspectDirectOpenButton(page, rows.nth(1), shortUrl, longUrl, '分享短链')
  if (shortOpenedUrl) {
    expect(new URL(shortOpenedUrl).searchParams.get('channel_code'), '短链重定向后应落到同一分享渠道')
      .toBe(longUrl.searchParams.get('channel_code'))
  }

  const artifact = await captureEvidence(
    page,
    artifactWriter,
    'screenshots/multilingual-share-settings.png',
    logger,
  )
  logger('success', '分享设置页长链、短链、二维码、渠道和直接打开已完成验证', {
    formId,
    channelCode: longUrl.searchParams.get('channel_code'),
    shortOrigin: shortUrl.origin,
  })
  return { artifact, longUrl: longUrl.toString(), shortUrl: shortUrl.toString() }
}

async function openPublicPreview({
  context,
  siteBaseUrl,
  formId,
  language,
  expectedRevision,
  sourcePayload,
  workspace,
  artifactWriter,
  logger,
}) {
  const page = await context.newPage()
  observeUiReadiness(page)
  page.setDefaultTimeout(scaleTimeout(ACTION_TIMEOUT_MS))
  page.setDefaultNavigationTimeout(scaleTimeout(NAVIGATION_TIMEOUT_MS))
  const previewUrl = buildPublicPreviewUrl(siteBaseUrl, formId, language)
  const publicOrigin = new URL(previewUrl).origin
  const [response] = await runActionAndWaitForApiResponses(page, {
    method: 'GET',
    pathnameSuffix: `/f/form/${formId}`,
    options: { timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS) },
  }, () => page.goto(previewUrl, { waitUntil: 'domcontentloaded' }))
  const outcome = await inspectBusinessResponse(response, `${language} 公开预览配置`)
  const { form } = unwrapFormPayload(outcome.body)
  expect(new URL(page.url()).origin, `${language} 公开预览应使用公开域名`).toBe(publicOrigin)
  expect(new URL(page.url()).searchParams.get('id'), `${language} 公开预览应保持目标表单 ID`).toBe(formId)
  expect(new URL(page.url()).searchParams.get('locale'), `${language} 公开预览 URL 应携带 locale`).toBe(language)
  expect(String(form.form_id ?? form.id ?? ''), `${language} 公开配置应属于目标表单`).toBe(formId)
  expect(form.status, `${language} 公开配置应为 published`).toBe('published')
  expect(publicStructuralSignature(sourcePayload, outcome.body), `${language} 公开配置不得改变题目结构、规则和选项值`)
    .toEqual(structuralSignature(sourcePayload))
  expect(structuralSignature(outcome.body).revisionNo, `${language} 公开配置版本应与翻译版本一致`)
    .toBe(expectedRevision)

  if (language === 'zh_CN') {
    expect(publicSourceTextSignature(sourcePayload, outcome.body), '简体中文公开配置应保持原文内容不变')
      .toEqual(sourceTextSignature(sourcePayload, { includeSystemItems: false }))
  } else {
    assertWorkspaceAppliedToPayload(workspace, sourcePayload, outcome.body, language)
  }
  const snapshot = await assertPublicPreviewUi(page, outcome.body, language, formId)
  const artifact = await captureEvidence(
    page,
    artifactWriter,
    `screenshots/multilingual-public-${language}.png`,
    logger,
  )
  logger('success', '公开页本语言接口、结构与首屏呈现断言执行完成', {
    language,
    title: form.title,
    visibleFieldCount: snapshot.fieldLabels.length,
  })
  return { artifact, outcome, page, previewUrl, snapshot }
}

async function assertShareLanguageMenu(page, previews, formId, shareLongUrl, artifactWriter, logger) {
  const localeOrder = ['zh_CN', 'zh_HK', 'en_US']
  const shareUrl = new URL(shareLongUrl)
  const [initialResponse] = await runActionAndWaitForApiResponses(page, {
    method: 'GET',
    pathnameSuffix: `/f/form/${formId}`,
    options: { timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS) },
  }, () => page.goto(shareUrl.toString(), { waitUntil: 'domcontentloaded' }))
  const initialOutcome = await inspectBusinessResponse(initialResponse, '分享长链公开配置')
  flowExpect(initialOutcome.succeeded, '分享长链必须能读取公开表单配置').toBe(true)
  await flowExpect(page.locator('.fb-runtime-form-title'), '分享长链公开表单必须完成挂载').toBeVisible()

  const initialSwitchButton = page.getByRole('button', { name: SWITCH_LANGUAGE_PATTERN })
  await flowExpect(initialSwitchButton, '分享长链右上角必须显示语言切换入口').toBeVisible()
  await clickWhenReady(initialSwitchButton)
  const initialMenu = page.getByRole('group', { name: SWITCH_LANGUAGE_PATTERN })
  await flowExpect(initialMenu, '分享长链右上角语言菜单必须展开').toBeVisible()
  const initialMenuButtons = initialMenu.getByRole('button')
  await expect(initialMenuButtons, '分享长链语言菜单应恰好显示三种语言').toHaveCount(3)
  const initialButtonStates = await initialMenuButtons.evaluateAll((buttons) => buttons.map((button) => ({
    label: button.textContent?.trim() ?? '',
    pressed: button.getAttribute('aria-pressed') === 'true',
  })))
  const selectedButtons = initialButtonStates.filter((entry) => entry.pressed)
  flowExpect(selectedButtons, '分享长链初始语言菜单必须且只能选中一种语言').toHaveLength(1)
  const initialLanguage = languageCodeForDisplayLabel(selectedButtons[0]?.label)
  flowExpect(initialLanguage, '分享长链初始选中语言必须属于多语言设置').toBeTruthy()
  if (initialLanguage) {
    expect(sourceTextSignature(initialOutcome.body), '分享长链初始接口内容应与菜单选中语言一致')
      .toEqual(sourceTextSignature(previews[initialLanguage].outcome.body))
    await assertPublicPreviewUi(page, previews[initialLanguage].outcome.body, initialLanguage, formId)
  }
  await clickWhenReady(initialSwitchButton)

  for (const language of localeOrder) {
    const switchButton = page.getByRole('button', { name: SWITCH_LANGUAGE_PATTERN })
    await expect(switchButton, `${language} 预览右上角应显示语言切换入口`).toHaveCount(1)
    await flowExpect(switchButton, `${language} 语言切换入口必须可点击`).toBeVisible()
    await clickWhenReady(switchButton)
    const menu = page.getByRole('group', { name: SWITCH_LANGUAGE_PATTERN })
    await flowExpect(menu, `${language} 右上角语言菜单必须展开`).toBeVisible()
    const menuButtons = menu.getByRole('button')
    await expect(menuButtons, '分享公开页语言菜单应恰好显示简体、繁体、English 三种语言').toHaveCount(3)
    const menuLanguageCodes = languageCodesForDisplayLabels(
      (await menuButtons.allTextContents()).map((value) => value.trim()),
    )
    expect(menuLanguageCodes, '分享公开页三种语言及顺序应正确').toEqual(localeOrder)

    const targetButton = menu.getByRole('button', { name: languageLabelPattern(language) })
    await expect(targetButton, `分享菜单应显示 ${language} 切换项`).toHaveCount(1)
    await flowExpect(targetButton, `分享菜单应显示 ${language} 切换项`).toHaveCount(1)
    const alreadySelected = await targetButton.getAttribute('aria-pressed') === 'true'
    let switchedResponse = null
    if (alreadySelected) {
      await clickWhenReady(targetButton)
    } else {
      [switchedResponse] = await runActionAndWaitForApiResponses(page, {
        method: 'GET',
        pathnameSuffix: `/f/form/${formId}`,
        options: { timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS) },
      }, () => clickWhenReady(targetButton))
    }
    if (switchedResponse) {
      const switchedOutcome = await inspectBusinessResponse(
        switchedResponse,
        `分享公开页切换 ${language} 配置`,
      )
      expect(sourceTextSignature(switchedOutcome.body), `分享公开页切换 ${language} 后接口内容应与独立预览一致`)
        .toEqual(sourceTextSignature(previews[language].outcome.body))
    }
    const expectedTitle = String(unwrapFormPayload(previews[language].outcome.body).form.title ?? '')
    await flowExpect(
      page.locator('.fb-runtime-form-title'),
      `分享公开页切换到 ${language} 后标题必须完成更新`,
    ).toHaveText(expectedTitle)
    await expect(page.locator('html'), `分享菜单切换到 ${language} 后 html lang 应更新`)
      .toHaveAttribute('lang', HTML_LANGS[language])
    await expect(page, `分享菜单切换到 ${language} 后浏览器标题应更新`).toHaveTitle(expectedTitle)
    await expect(page.getByText(expectedTitle, { exact: true }), `分享菜单切换到 ${language} 后表单标题应更新`).toBeVisible()
    const currentUrl = new URL(page.url())
    expect(currentUrl.origin, `${language} 切换后应保留分享公开域名`).toBe(shareUrl.origin)
    expect(currentUrl.pathname, `${language} 切换后应保留分享公开路径`).toBe(shareUrl.pathname)
    expect(currentUrl.searchParams.get('id'), `${language} 切换后应保留表单 ID`).toBe(formId)
    expect(currentUrl.searchParams.get('channel_code'), `${language} 切换后应保留 channel_code`)
      .toBe(shareUrl.searchParams.get('channel_code'))
    const switchedSnapshot = await assertPublicPreviewUi(page, previews[language].outcome.body, language, formId)

    await clickWhenReady(page.getByRole('button', { name: SWITCH_LANGUAGE_PATTERN }))
    const reopenedMenu = page.getByRole('group', { name: SWITCH_LANGUAGE_PATTERN })
    await expect(
      reopenedMenu.getByRole('button', { name: languageLabelPattern(language) }),
      `分享菜单 ${language} 应显示为当前选中语言`,
    ).toHaveAttribute('aria-pressed', 'true')
    await flowExpect(
      reopenedMenu.getByRole('button', { name: languageLabelPattern(language) }),
      `分享菜单 ${language} 应显示为当前选中语言`,
    ).toHaveAttribute('aria-pressed', 'true')
    await clickWhenReady(page.getByRole('button', { name: SWITCH_LANGUAGE_PATTERN }))
    logger('success', '分享公开页语言菜单切换和本语言首屏呈现正确', {
      language,
      title: switchedSnapshot.title,
    })
  }

  await clickWhenReady(page.getByRole('button', { name: SWITCH_LANGUAGE_PATTERN }))
  const artifact = await captureEvidence(
    page,
    artifactWriter,
    'screenshots/multilingual-share-language-menu.png',
    logger,
  )
  const menu = page.getByRole('group', { name: SWITCH_LANGUAGE_PATTERN })
  const finalMenuLanguageCodes = languageCodesForDisplayLabels(await menu.getByRole('button').allTextContents())
  expect(finalMenuLanguageCodes, '分享界面最终证据应包含三种语言').toEqual(localeOrder)
  logger('success', '分享长链公开页右上角三语言切换校验完成', {
    formId,
    languages: localeOrder,
  })
  return artifact
}

async function screenshotFailure(page, formId, artifactWriter) {
  if (!artifactWriter || typeof artifactWriter.captureScreenshot !== 'function') {
    throw new Error('Runner 必须提供 artifactWriter')
  }
  return artifactWriter.captureScreenshot(
    page,
    `screenshots/multilingual-${String(formId).replace(/[^a-zA-Z0-9_-]/g, '_')}-失败-${Date.now()}.png`,
    { fullPage: true, animations: 'disabled' },
  )
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
}) {
  if (!siteBaseUrl) throw new Error('运行环境必须提供 Web 基址')
  if (!apiBaseUrl) throw new Error('运行环境必须提供 API 基址')
  if (!artifactWriter || typeof artifactWriter.captureScreenshot !== 'function') {
    throw new Error('Runner 必须提供 artifactWriter')
  }
  const authorization = extraHTTPHeaders?.Authorization
  if (!authorization) throw new Error('多语言翻译必须使用环境登录后的 Token')
  const translationUrl = buildTranslationUrl(siteBaseUrl, requestPath, variables)
  const formId = new URL(translationUrl).searchParams.get('id')
  const customExpectations = parseTranslationExpectations(variables.TRANSLATION_EXPECTATIONS)
  const aiTimeoutMs = scaleTimeout(resolveAiTimeout(variables.AI_TRANSLATION_TIMEOUT_MS))
  const siteOrigin = new URL(siteBaseUrl).origin
  const apiOrigin = new URL(apiBaseUrl).origin
  if (siteOrigin !== apiOrigin) throw new Error('Web 基址与 API 基址必须同源')

  let browser
  let adminContext
  let publicContext
  let shareContext
  let recoveryRequestContext
  let page
  let stopAbortClose = () => undefined
  let adminNetworkObserver = { setPhase: () => undefined, stop: async () => undefined }
  let publicNetworkObserver = { setPhase: () => undefined, stop: async () => undefined }
  let shareNetworkObserver = { setPhase: () => undefined, stop: async () => undefined }
  const evidence = []
  const apiMutations = []
  const adminTokenViolations = []
  const adminPublicAuthorizationLeaks = []
  const publicAuthorizationLeaks = []
  let adminBusinessRequestCount = 0
  let authenticatedAdminRequestCount = 0

  try {
    throwIfRunAborted(signal)
    logger('info', '启动 Google Chrome 无头浏览器，执行表单多语言完整链路', {
      browser: 'Google Chrome',
      headless: true,
      formId,
      translationUrl,
      targetLanguages: TARGET_LANGUAGES,
      aiTimeoutMs,
    })
    browser = await launchGoogleChrome()
    stopAbortClose = closePlaywrightOnAbort(signal, () => ({
      browser,
      context: shareContext ?? publicContext ?? adminContext,
    }), { logger })
    throwIfRunAborted(signal)

    adminContext = await browser.newContext({
      ignoreHTTPSErrors,
      viewport: { width: 1600, height: 1000 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    })
    await adminContext.addInitScript(({ token, adminOrigin }) => {
      if (globalThis.location?.origin !== adminOrigin) return
      localStorage.setItem('token', token)
      localStorage.setItem('arco-locale', 'zh-CN')
    }, { token: authorization, adminOrigin: siteOrigin })
    adminNetworkObserver = attachNetworkObserver(adminContext, {
      initialPhase: '多语言浏览器初始化',
      onApiResponse: recordApiResponse,
      onResourceResponse: recordResourceResponse,
    })
    await adminNetworkObserver.ready
    adminContext.on('request', (request) => {
      const url = new URL(request.url())
      if (url.origin !== apiOrigin && request.headers().authorization) {
        adminPublicAuthorizationLeaks.push(`${request.method()} ${url.origin}${url.pathname}`)
      }
      if (request.method() !== 'GET' && url.origin === apiOrigin) {
        apiMutations.push({ method: request.method(), pathname: url.pathname, url: redactUrl(url) })
      }
      if (!isApiBusinessRequest(request, apiOrigin)) return
      adminBusinessRequestCount += 1
      if (request.headers().authorization === authorization) authenticatedAdminRequestCount += 1
      else adminTokenViolations.push(`${request.method()} ${url.origin}${url.pathname}`)
    })

    page = await adminContext.newPage()
    observeUiReadiness(page)
    page.setDefaultTimeout(scaleTimeout(ACTION_TIMEOUT_MS))
    page.setDefaultNavigationTimeout(scaleTimeout(NAVIGATION_TIMEOUT_MS))
    adminNetworkObserver.setPhase('加载多语言设置')
    const initialTranslationUrl = new URL(translationUrl)
    initialTranslationUrl.searchParams.set('target_language', 'zh_HK')
    const [detailResponse, initialWorkspaceResponse] = await runActionAndWaitForApiResponses(page, [
      {
        method: 'GET',
        pathnameSuffix: `/be/form/${formId}`,
        options: { query: { draft: 1 }, timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS) },
      },
      {
        method: 'GET',
        pathnameSuffix: `/be/form/${formId}/translation`,
        options: { query: { target_language: 'zh_HK' }, timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS) },
      },
    ], () => page.goto(initialTranslationUrl.toString(), { waitUntil: 'domcontentloaded' }))
    await expect(page, '环境 Token 生效后不应跳转登录页').not.toHaveURL(/\/login(?:[/?#]|$)/)
    await flowExpect(page, '必须成功进入多语言翻译页面').not.toHaveURL(/\/login(?:[/?#]|$)/)
    await flowExpect(page.locator('.translation-page'), '多语言翻译工作区必须完成挂载').toBeVisible()

    const detailOutcome = await inspectBusinessResponse(detailResponse, '多语言翻译前表单详情')
    flowExpect(detailOutcome.succeeded, '表单详情接口必须成功，才能执行 AI 翻译或发布').toBe(true)
    const source = assertSourceFormDetail(detailOutcome.body, formId)
    flowExpect(String(source.form.form_id ?? source.form.id ?? ''), '发布门禁必须确认表单详情属于目标 FORM_ID')
      .toBe(formId)
    flowExpect(source.form.source_language, '发布门禁必须确认原文语言为 zh_CN').toBe('zh_CN')
    flowExpect(source.revisionNo, '发布门禁必须确认表单版本为正整数').toBeGreaterThan(0)
    const initialWorkspaceOutcome = await inspectBusinessResponse(initialWorkspaceResponse, '多语言设置加载')
    flowExpect(initialWorkspaceOutcome.succeeded, '初始翻译工作区接口必须成功，才能执行 AI 翻译或发布').toBe(true)
    let currentWorkspace = assertTranslationWorkspace(initialWorkspaceOutcome.body, {
      label: '多语言设置初始工作区',
      expectedRevision: source.revisionNo,
      expectedTargetLanguage: 'zh_HK',
      requireEnabled: false,
    })
    const initialWorkspaceGate = requireWorkspaceMutationGate(initialWorkspaceOutcome.body, {
      expectedRevision: source.revisionNo,
      expectedTargetLanguage: 'zh_HK',
      requireEnabled: false,
      label: '初始多语言工作区',
    })
    expect(typeof initialWorkspaceGate.sourceLanguageLocked, '多语言接口应明确回显布尔型原文语言锁定状态')
      .toBe('boolean')
    await expect(page.locator('.translation-heading__source-select'), '多语言页面应回显简体中文原文语言')
      .toContainText(/简体中文|簡體中文/)
    await expect(page.locator('.target-language-tab'), '多语言页面应显示繁体中文和 English 两个目标语言').toHaveCount(2)
    currentWorkspace = await ensureTargetLanguagesEnabled(page, currentWorkspace, formId, logger)
    flowExpect(currentWorkspace.source_language, '启用目标语言后原文语言必须仍为 zh_CN').toBe('zh_CN')
    flowExpect(currentWorkspace.revision_no, '启用目标语言后版本必须与初始表单一致')
      .toBe(source.revisionNo)
    expect(currentWorkspace.languages.filter((entry) => entry.enabled).map((entry) => entry.language).sort(), '多语言设置应启用全部两个目标语言')
      .toEqual([...TARGET_LANGUAGES].sort())
    flowExpect(
      currentWorkspace.languages.filter((entry) => entry.enabled).map((entry) => entry.language).sort(),
      'AI 一键翻译前必须启用繁体中文和 English',
    ).toEqual([...TARGET_LANGUAGES].sort())
    logger('success', '多语言设置、原文契约及不可翻译范围断言执行完成', {
      sourceLanguage: currentWorkspace.source_language,
      sourceLanguageLocked: currentWorkspace.source_language_locked,
      targetLanguages: currentWorkspace.languages.map((entry) => ({
        language: entry.language,
        enabled: entry.enabled,
        progress: entry.progress,
      })),
      sectionCount: currentWorkspace.sections.length,
      unitCount: currentWorkspace.units.length,
    })

    throwIfRunAborted(signal)
    adminNetworkObserver.setPhase('AI 一键翻译')
    const aiResult = await triggerAiTranslation(page, currentWorkspace, formId, aiTimeoutMs, logger)
    recoveryRequestContext = await playwrightRequest.newContext({
      extraHTTPHeaders: {
        Accept: 'application/json',
        ...extraHTTPHeaders,
      },
      ignoreHTTPSErrors,
      storageState: await adminContext.storageState(),
      timeout: scaleTimeout(PROBE_RECOVERY_TIMEOUT_MS),
    })

    const persistedWorkspaces = {}
    for (const language of TARGET_LANGUAGES) {
      throwIfRunAborted(signal)
      adminNetworkObserver.setPhase(`${language} 翻译保存与回读`)
      logger('info', `开始加载 ${language} 翻译工作区并校验响应体`)
      const firstRead = await loadPersistedWorkspace(page, translationUrl, formId, language, source.revisionNo)
      const workspaceGate = requireWorkspaceMutationGate(firstRead.outcome.body, {
        expectedRevision: source.revisionNo,
        expectedTargetLanguage: language,
        label: `${language} AI 翻译回读`,
      })
      const workspace = assertTranslationWorkspace(firstRead.outcome.body, {
        label: `${language} AI 翻译保存后回读`,
        expectedRevision: source.revisionNo,
        expectedTargetLanguage: language,
        requireComplete: true,
        customExpectations,
      })
      flowExpect(
        analyzeTranslationWorkspace(workspaceGate).complete,
        `${language} AI 翻译必须全部完成且单元合法，才能执行保存和发布`,
      ).toBe(true)
      if (persistedWorkspaces[TARGET_LANGUAGES[0]]) {
        const structureDifferences = compareWorkspaceStructure(
          persistedWorkspaces[TARGET_LANGUAGES[0]],
          workspace,
        )
        expect(structureDifferences, `${language} 与繁体中文的翻译单元结构、原文和 source_hash 应完全一致`)
          .toEqual([])
        flowExpect(structureDifferences, `${language} 与繁体中文的工作区结构必须一致，才能保存发布`)
          .toEqual([])
      }
      await assertTranslationEditorMatchesWorkspace(page, workspace, language, logger)
      const secondRead = await assertSaveRoundTrip(
        page,
        translationUrl,
        recoveryRequestContext,
        apiBaseUrl,
        formId,
        language,
        workspace,
        logger,
      )
      const reloadedWorkspace = assertTranslationWorkspace(secondRead.outcome.body, {
        label: `${language} 保存后第二次独立回读`,
        expectedRevision: source.revisionNo,
        expectedTargetLanguage: language,
        requireComplete: true,
        customExpectations,
      })
      const reloadedGate = requireWorkspaceMutationGate(secondRead.outcome.body, {
        expectedRevision: source.revisionNo,
        expectedTargetLanguage: language,
        label: `${language} 保存后独立回读`,
      })
      flowExpect(analyzeTranslationWorkspace(reloadedGate).complete, `${language} 保存后工作区必须保持完整`)
        .toBe(true)
      expect(
        reloadedWorkspace.units.map((unit) => [unit.unit_key, unit.source_hash, unit.translated_text, unit.status]),
        `${language} 保存并重载后全部译文、哈希与状态应持久化`,
      ).toEqual(workspace.units.map((unit) => [unit.unit_key, unit.source_hash, unit.translated_text, unit.status]))
      flowExpect(
        JSON.stringify(reloadedWorkspace.units.map((unit) => [unit.unit_key, unit.source_hash, unit.translated_text, unit.status])),
        `${language} 保存回读必须与 AI 译文完全一致，才能继续发布`,
      ).toBe(JSON.stringify(workspace.units.map((unit) => [unit.unit_key, unit.source_hash, unit.translated_text, unit.status])))
      persistedWorkspaces[language] = reloadedWorkspace
      const artifact = await captureEvidence(
        page,
        artifactWriter,
        `screenshots/multilingual-editor-${language}.png`,
        logger,
      )
      if (artifact) evidence.push(artifact)
    }

    throwIfRunAborted(signal)
    adminNetworkObserver.setPhase('完成并发布多语言')
    currentWorkspace = persistedWorkspaces.en_US
    flowExpect(currentWorkspace.source_language, '完成发布前原文语言必须保持为 zh_CN').toBe('zh_CN')
    flowExpect(currentWorkspace.revision_no, '完成发布前工作区版本必须与初始表单一致')
      .toBe(source.revisionNo)
    flowExpect(
      currentWorkspace.languages.filter((entry) => entry.enabled).map((entry) => entry.language).sort(),
      '完成发布前必须仍启用繁体中文和 English',
    ).toEqual([...TARGET_LANGUAGES].sort())
    const publication = await completeAndPublish(
      page,
      formId,
      currentWorkspace,
      String(source.form.title ?? ''),
      logger,
    )
    const publishedMatch = assertPublishedListRecord(
      publication.listOutcome.body,
      formId,
      String(source.form.title ?? ''),
      source.revisionNo,
    )
    const publishedRecord = publishedMatch.record
    await assertPublishedListUi(
      page,
      String(source.form.title ?? ''),
      formId,
      publishedMatch.recordIndex,
    )

    adminNetworkObserver.setPhase('发布后回读与原文保护')
    const publishedTranslationUrl = new URL(translationUrl)
    publishedTranslationUrl.searchParams.set('target_language', 'zh_HK')
    const [publishedDetailResponse, publishedWorkspaceResponse] = await runActionAndWaitForApiResponses(page, [
      {
        method: 'GET',
        pathnameSuffix: `/be/form/${formId}`,
        options: { query: { draft: 1 }, timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS) },
      },
      {
        method: 'GET',
        pathnameSuffix: `/be/form/${formId}/translation`,
        options: { query: { target_language: 'zh_HK' }, timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS) },
      },
    ], () => page.goto(publishedTranslationUrl.toString(), { waitUntil: 'domcontentloaded' }))
    const publishedDetailOutcome = await inspectBusinessResponse(publishedDetailResponse, '多语言发布后表单详情回读')
    const publishedWorkspaceOutcome = await inspectBusinessResponse(publishedWorkspaceResponse, '多语言发布后翻译工作区回读')
    flowExpect(publishedDetailOutcome.succeeded, '发布后表单详情必须成功回读').toBe(true)
    flowExpect(publishedWorkspaceOutcome.succeeded, '发布后翻译工作区必须成功回读').toBe(true)
    const publishedSource = unwrapFormPayload(publishedDetailOutcome.body)
    flowExpect(String(publishedSource.form.form_id ?? publishedSource.form.id ?? ''), '发布后表单详情必须仍属于目标 FORM_ID')
      .toBe(formId)
    flowExpect(structuralSignature(publishedDetailOutcome.body).revisionNo, '发布后表单版本必须与发布版本一致')
      .toBe(source.revisionNo)
    expect(structuralSignature(publishedDetailOutcome.body), 'AI 翻译和多语言发布不得改变题目结构、规则与选项值')
      .toEqual(source.structureSignature)
    expect(sourceTextSignature(publishedDetailOutcome.body), 'AI 翻译和多语言发布不得改写简体中文原文')
      .toEqual(source.sourceSignature)
    const publishedWorkspaces = {}
    for (const language of TARGET_LANGUAGES) {
      const publishedOutcome = language === 'zh_HK'
        ? publishedWorkspaceOutcome
        : (await loadPersistedWorkspace(
            page,
            translationUrl,
            formId,
            language,
            source.revisionNo,
          )).outcome
      const publishedWorkspace = assertTranslationWorkspace(publishedOutcome.body, {
        label: `多语言发布后 ${language} 工作区`,
        expectedRevision: source.revisionNo,
        expectedTargetLanguage: language,
        requireComplete: true,
        requirePublished: true,
        customExpectations,
      })
      const publishedGate = requireWorkspaceMutationGate(publishedOutcome.body, {
        expectedRevision: source.revisionNo,
        expectedTargetLanguage: language,
        label: `${language} 发布后工作区`,
      })
      flowExpect(analyzeTranslationWorkspace(publishedGate).complete, `${language} 发布后工作区必须保持完整`)
        .toBe(true)
      flowExpect(
        publishedGate.languages.find((entry) => entry.code === language)?.published,
        `${language} 发布后必须标记 published`,
      ).toBe(true)
      expect(
        publishedWorkspace.units.map((unit) => [unit.unit_key, unit.translated_text]),
        `完成并发布后 ${language} 译文应与发布前保存内容一致`,
      ).toEqual(persistedWorkspaces[language].units.map((unit) => [unit.unit_key, unit.translated_text]))
      publishedWorkspaces[language] = publishedWorkspace
    }

    throwIfRunAborted(signal)
    adminNetworkObserver.setPhase('分享设置页')
    const shareSettings = await inspectShareSettingsPage({
      page,
      siteBaseUrl,
      formId,
      authorization,
      extraHTTPHeaders,
      artifactWriter,
      logger,
    })
    if (shareSettings.artifact) evidence.push(shareSettings.artifact)

    throwIfRunAborted(signal)
    publicContext = await browser.newContext({
      ignoreHTTPSErrors,
      viewport: { width: 1440, height: 1000 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    })
    publicNetworkObserver = attachNetworkObserver(publicContext, {
      initialPhase: '多语言公开预览',
      onApiResponse: recordApiResponse,
      onResourceResponse: recordResourceResponse,
    })
    await publicNetworkObserver.ready
    publicContext.on('request', (request) => {
      const url = new URL(request.url())
      if (request.headers().authorization) {
        publicAuthorizationLeaks.push(`${request.method()} ${url.origin}${url.pathname}`)
      }
    })

    const previews = {}
    for (const language of SUPPORTED_LANGUAGES) {
      throwIfRunAborted(signal)
      publicNetworkObserver.setPhase(`${language} 公开预览`)
      previews[language] = await openPublicPreview({
        context: publicContext,
        siteBaseUrl,
        formId,
        language,
        expectedRevision: source.revisionNo,
        sourcePayload: publishedDetailOutcome.body,
        workspace: language === 'zh_CN' ? null : publishedWorkspaces[language],
        artifactWriter,
        logger,
      })
      if (previews[language].artifact) evidence.push(previews[language].artifact)
      if (language !== 'zh_CN') await previews[language].page.close()
    }

    throwIfRunAborted(signal)
    shareContext = await browser.newContext({
      ignoreHTTPSErrors,
      viewport: { width: 1440, height: 1000 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    })
    shareNetworkObserver = attachNetworkObserver(shareContext, {
      initialPhase: '分享与三语言切换',
      onApiResponse: recordApiResponse,
      onResourceResponse: recordResourceResponse,
    })
    await shareNetworkObserver.ready
    shareContext.on('request', (request) => {
      if (!request.headers().authorization) return
      const url = new URL(request.url())
      publicAuthorizationLeaks.push(`${request.method()} ${url.origin}${url.pathname}`)
    })
    await assertUnauthenticatedShareRedirect(
      shareContext,
      shareSettings.shortUrl,
      shareSettings.longUrl,
      formId,
    )
    const sharePage = await shareContext.newPage()
    observeUiReadiness(sharePage)
    sharePage.setDefaultTimeout(scaleTimeout(ACTION_TIMEOUT_MS))
    sharePage.setDefaultNavigationTimeout(scaleTimeout(NAVIGATION_TIMEOUT_MS))
    const shareArtifact = await assertShareLanguageMenu(
      sharePage,
      previews,
      formId,
      shareSettings.longUrl,
      artifactWriter,
      logger,
    )
    if (shareArtifact) evidence.push(shareArtifact)

    adminNetworkObserver.setPhase('运行结果汇总')
    publicNetworkObserver.setPhase('运行结果汇总')
    shareNetworkObserver.setPhase('运行结果汇总')
    expect(adminTokenViolations, '管理端全部 API 业务请求都必须携带环境 Token').toEqual([])
    expect(authenticatedAdminRequestCount, '应观察到携带 Token 的管理端 API 请求').toBeGreaterThan(0)
    expect(authenticatedAdminRequestCount, '携带 Token 的管理端请求数应等于全部管理端业务请求数')
      .toBe(adminBusinessRequestCount)
    expect(publicAuthorizationLeaks, '公开预览和分享请求不得携带管理端 Token').toEqual([])
    expect(adminPublicAuthorizationLeaks, '管理端打开分享链接时不得向公开域名发送 Authorization').toEqual([])
    const mutationPaths = apiMutations.map((entry) => `${entry.method} ${entry.pathname}`)
    expect(mutationPaths.some((entry) => entry.endsWith(`/be/form/${formId}/translation/ai`)), '本次运行必须真实调用 AI 一键翻译接口').toBe(true)
    expect(mutationPaths.some((entry) => entry.endsWith(`/be/form/${formId}/translation`) && entry.startsWith('PUT ')), '本次运行必须真实调用翻译保存 PUT 接口').toBe(true)
    expect(mutationPaths.some((entry) => entry.endsWith(`/be/form/${formId}/translation/complete`)), '本次运行必须真实调用多语言完成发布接口').toBe(true)
    expect(evidence.length, '多语言编辑、三语言公开预览、分享设置和语言菜单应产出完整截图证据').toBe(7)
    logger('success', '表单多语言 AI 翻译、保存回读、完成发布、公开预览和分享三语言校验全部执行完成', {
      formId,
      revisionNo: source.revisionNo,
      sourceLanguage: 'zh_CN',
      targetLanguages: TARGET_LANGUAGES,
      publishedRecord,
      evidenceCount: evidence.length,
      adminBusinessRequestCount,
      authenticatedAdminRequestCount,
      aiTaskStatus: aiResult.task.status,
      token: '[REDACTED]',
    })

    return {
      formId,
      revisionNo: source.revisionNo,
      status: 'published',
      sourceLanguage: 'zh_CN',
      targetLanguages: [...TARGET_LANGUAGES],
      publishedLanguages: [...SUPPORTED_LANGUAGES],
      translationProgress: Object.fromEntries(TARGET_LANGUAGES.map((language) => [
        language,
        persistedWorkspaces[language].languages.find((entry) => entry.language === language)?.progress,
      ])),
      publicPreviewUrls: Object.fromEntries(SUPPORTED_LANGUAGES.map((language) => [
        language,
        previews[language].previewUrl,
      ])),
      shareLinks: {
        long: shareSettings.longUrl,
        short: shareSettings.shortUrl,
      },
      evidence,
      authenticatedRequestCount: authenticatedAdminRequestCount,
      publishedRecord,
    }
  } catch (error) {
    if (signal?.aborted) {
      logger('info', '已响应强制停止，正在清理多语言测试 Chrome 会话')
    } else if (captureFailureScreenshot && page) {
      try {
        const artifact = await screenshotFailure(page, formId, artifactWriter)
        logger('error', '多语言自动化执行失败，已保存当前页面截图', { artifact })
      } catch (screenshotError) {
        logger('error', '多语言自动化执行失败，失败截图保存失败', {
          reason: screenshotError instanceof Error ? screenshotError.message : String(screenshotError),
        })
      }
    }
    throw error
  } finally {
    adminNetworkObserver.setPhase('结束清理')
    publicNetworkObserver.setPhase('结束清理')
    shareNetworkObserver.setPhase('结束清理')
    const observerStops = await Promise.allSettled([
      adminNetworkObserver.stop({ discardPending: true }),
      publicNetworkObserver.stop({ discardPending: true }),
      shareNetworkObserver.stop({ discardPending: true }),
    ])
    const discardedPending = observerStops.reduce((total, result) => (
      result.status === 'fulfilled'
        ? total + Number(result.value?.summary?.discardedPending ?? 0)
        : total
    ), 0)
    if (discardedPending > 0) {
      logger('warning', '结束清理时忽略浏览器仍在后台加载的未完成请求；已完成的接口和资源健康断言不受影响', {
        discardedPending,
      })
    }
    const abortCloseStarted = await stopAbortClose()
    if (!abortCloseStarted) {
      await Promise.allSettled([
        shareContext?.close(),
        publicContext?.close(),
        adminContext?.close(),
      ])
      await closePlaywrightHandles({ browser }, { logger })
    }
    await disposeRequestContextWithin(recoveryRequestContext, logger)
  }
}

const REQUIRED_LANGUAGE_CODES = SUPPORTED_LANGUAGES
const TARGET_LANGUAGE_CODES = TARGET_LANGUAGES

export {
  DEFAULT_AI_TRANSLATION_TIMEOUT_MS,
  DEFAULT_REQUEST_PATH,
  PROBE_RECOVERY_ACTION_RESERVE_MS,
  PROBE_RECOVERY_POLL_INTERVAL_MS,
  PROBE_RECOVERY_TIMEOUT_MS,
  REQUIRED_LANGUAGE_CODES,
  REQUEST_CONTEXT_DISPOSE_TIMEOUT_MS,
  SCRIPT_ID,
  SUPPORTED_LANGUAGES,
  TARGET_LANGUAGE_CODES,
  TARGET_LANGUAGES,
  analyzeTranslationWorkspace,
  assertPublishedListRecord,
  assertTranslationWorkspace,
  buildPublicPreviewUrl,
  buildTranslationUrl,
  compareWorkspaceStructure,
  createTranslationProbeValue,
  criticalTranslationIssues,
  disposeRequestContextWithin,
  ensureOriginalTranslationRestored,
  findShareUrlSecretLeaks,
  languageQualityIssues,
  languageCodeForDisplayLabel,
  languageLabelPattern,
  navigationRequestPage,
  normalizeTranslationWorkspace,
  normalizeWorkspace,
  orderedContentFormItems,
  parsePositiveTimeout,
  parseTranslationExpectations,
  projectSignatureAgainstReference,
  publicSourceTextSignature,
  publicStructuralSignature,
  readResponseJsonWithin,
  readFieldPath,
  requireTranslationQualityGate,
  requireWorkspaceMutationGate,
  runActionAndWaitForApiResponses,
  sourceTextSignature,
  structuralSignature,
  translationApiUrl,
  translationProbeRecoveryAction,
  templateTokens,
  textContentFromHtml,
  tryParseShareLink,
  visibleLanguageIssues,
  workspaceStructureSignature,
}
