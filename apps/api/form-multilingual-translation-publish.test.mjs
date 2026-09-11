import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { runWithAssertionRecorder } from '../../scripts/support/recorded-expect.mjs'
import { DEFAULT_RESPONSE_DRAIN_TIMEOUT_MS } from '../../scripts/support/api-response-recorder.mjs'
import { DEFAULT_ABORT_CLEANUP_TIMEOUT_MS } from './script-runner.mjs'
import { DEFAULT_CANCELLATION_WAIT_TIMEOUT_MS } from './server.mjs'
import {
  DEFAULT_AI_TRANSLATION_TIMEOUT_MS,
  PROBE_RECOVERY_TIMEOUT_MS,
  REQUIRED_LANGUAGE_CODES,
  REQUEST_CONTEXT_DISPOSE_TIMEOUT_MS,
  TARGET_LANGUAGE_CODES,
  analyzeTranslationWorkspace,
  assertPublishedListRecord,
  assertTranslationWorkspace,
  buildPublicPreviewUrl,
  buildTranslationUrl,
  compareWorkspaceStructure,
  createTranslationProbeValue,
  disposeRequestContextWithin,
  ensureOriginalTranslationRestored,
  findShareUrlSecretLeaks,
  languageCodeForDisplayLabel,
  languageLabelPattern,
  languageQualityIssues,
  navigationRequestPage,
  normalizeTranslationWorkspace,
  normalizeWorkspace,
  orderedContentFormItems,
  parsePositiveTimeout,
  parseTranslationExpectations,
  publicSourceTextSignature,
  publicStructuralSignature,
  requireTranslationQualityGate,
  requireWorkspaceMutationGate,
  runActionAndWaitForApiResponses,
  sourceTextSignature,
  structuralSignature,
  templateTokens,
  textContentFromHtml,
  tryParseShareLink,
  translationApiUrl,
  translationProbeRecoveryAction,
  visibleLanguageIssues,
} from '../../scripts/form-multilingual-translation-publish.ui.spec.mjs'

function deferredPromise() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function fakeResponsePage(watcherPromises) {
  let index = 0
  return {
    registrations: [],
    waitForResponse(predicate, options) {
      this.registrations.push({ options, predicate })
      const promise = watcherPromises[index]
      index += 1
      return promise
    },
  }
}

async function flushUnhandledRejections() {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

function translationResponse({
  targetLanguage = 'en_US',
  units = [
    {
      unit_key: 'form:title',
      field_path: 'form.title',
      source_hash: 'hash-title',
      source_text: '活动报名',
      translated_text: 'Event registration',
      status: 'translated',
      editor_type: 'plain_text',
    },
    {
      unit_key: 'item:name:label',
      field_path: 'items.name.label',
      source_hash: 'hash-name',
      source_text: '姓名',
      translated_text: 'Name',
      status: 'translated',
      editor_type: 'plain_text',
    },
  ],
} = {}) {
  return {
    code: 0,
    data: {
      revision_no: 18,
      source_language: 'zh_CN',
      target_language: targetLanguage,
      enabled: true,
      published: false,
      source_language_locked: true,
      email_translation_enabled: false,
      languages: [
        {
          language: 'zh_CN',
          language_text: '简体中文',
          enabled: true,
          published: true,
          status: 'source',
          progress: { total: 2, translated: 2, missing: 0, stale: 0, percent: 100 },
        },
        {
          language: targetLanguage,
          language_text: targetLanguage === 'en_US' ? 'English' : '繁體中文',
          enabled: true,
          published: false,
          status: 'editing',
          progress: { total: 2, translated: 2, missing: 0, stale: 0, percent: 100 },
        },
      ],
      sections: [
        {
          group_key: 'form',
          section_key: 'form:basic',
          scope_type: 'form',
          scope_key: 'form',
          type_code: 'form',
          title: '基础信息',
          subtitle: '',
          progress: { total: 2, translated: 2, missing: 0, stale: 0, percent: 100 },
          units,
        },
      ],
    },
  }
}

function publicationReadyResponse(options = {}) {
  const response = translationResponse(options)
  const total = response.data.sections[0].units.length
  response.data.sections[0].group_key = 'form_structure'
  response.data.languages = [
    {
      language: 'zh_HK',
      language_text: '繁體中文',
      enabled: true,
      published: false,
      status: 'editing',
      progress: { total, translated: total, missing: 0, stale: 0, percent: 100 },
    },
    {
      language: 'en_US',
      language_text: 'English',
      enabled: true,
      published: false,
      status: 'editing',
      progress: { total, translated: total, missing: 0, stale: 0, percent: 100 },
    },
  ]
  return response
}

test('keeps a late response-watcher rejection handled when the action fails first', async () => {
  const responseWatcher = deferredPromise()
  const page = fakeResponsePage([responseWatcher.promise])
  const actionError = new Error('action failed')
  const watcherError = new Error('watcher failed later')
  const unhandledRejections = []
  const recordUnhandledRejection = (reason) => unhandledRejections.push(reason)
  process.on('unhandledRejection', recordUnhandledRejection)

  try {
    const operation = runActionAndWaitForApiResponses(page, {
      method: 'PUT',
      pathnameSuffix: '/be/form/example/translation',
    }, async () => { throw actionError })

    await assert.rejects(operation, (error) => error === actionError)
    responseWatcher.reject(watcherError)
    await flushUnhandledRejections()
    assert.deepEqual(unhandledRejections, [])
  } finally {
    process.off('unhandledRejection', recordUnhandledRejection)
  }
})

test('keeps a late action rejection handled when the response watcher fails first', async () => {
  const responseWatcher = deferredPromise()
  const action = deferredPromise()
  const page = fakeResponsePage([responseWatcher.promise])
  const watcherError = new Error('watcher failed')
  const actionError = new Error('action failed later')
  const unhandledRejections = []
  const recordUnhandledRejection = (reason) => unhandledRejections.push(reason)
  process.on('unhandledRejection', recordUnhandledRejection)

  try {
    const operation = runActionAndWaitForApiResponses(page, {
      method: 'GET',
      pathnameSuffix: '/be/form/example/translation',
    }, () => action.promise)

    responseWatcher.reject(watcherError)
    await assert.rejects(operation, (error) => error === watcherError)
    action.reject(actionError)
    await flushUnhandledRejections()
    assert.deepEqual(unhandledRejections, [])
  } finally {
    process.off('unhandledRejection', recordUnhandledRejection)
  }
})

test('keeps the response watcher handled when cancellation rejects the action first', async () => {
  const responseWatcher = deferredPromise()
  const controller = new AbortController()
  const cancellationError = new Error('user cancelled')
  const watcherError = new Error('watcher closed after cancellation')
  const page = fakeResponsePage([responseWatcher.promise])
  const unhandledRejections = []
  const recordUnhandledRejection = (reason) => unhandledRejections.push(reason)
  process.on('unhandledRejection', recordUnhandledRejection)

  try {
    const operation = runActionAndWaitForApiResponses(page, {
      method: 'POST',
      pathnameSuffix: '/be/form/example/translation/complete',
    }, () => new Promise((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })
    }))

    await Promise.resolve()
    controller.abort(cancellationError)
    await assert.rejects(operation, (error) => error === cancellationError)
    responseWatcher.reject(watcherError)
    await flushUnhandledRejections()
    assert.deepEqual(unhandledRejections, [])
  } finally {
    process.off('unhandledRejection', recordUnhandledRejection)
  }
})

test('keeps an earlier watcher handled when a later watcher throws during setup', async () => {
  const firstWatcher = deferredPromise()
  const setupError = new Error('second watcher setup failed')
  const lateWatcherError = new Error('first watcher failed later')
  const unhandledRejections = []
  const recordUnhandledRejection = (reason) => unhandledRejections.push(reason)
  let registrations = 0
  let actionStarted = false
  const page = {
    waitForResponse() {
      registrations += 1
      if (registrations === 2) throw setupError
      return firstWatcher.promise
    },
  }
  process.on('unhandledRejection', recordUnhandledRejection)

  try {
    const operation = runActionAndWaitForApiResponses(page, [
      { method: 'GET', pathnameSuffix: '/be/form/example' },
      { method: 'GET', pathnameSuffix: '/be/form/example/translation' },
    ], () => { actionStarted = true })

    await assert.rejects(operation, (error) => error === setupError)
    firstWatcher.reject(lateWatcherError)
    await flushUnhandledRejections()
    assert.deepEqual(unhandledRejections, [])
    assert.equal(registrations, 2)
    assert.equal(actionStarted, false)
  } finally {
    process.off('unhandledRejection', recordUnhandledRejection)
  }
})

test('registers both response watchers before navigation and preserves response order', async () => {
  const detailWatcher = deferredPromise()
  const workspaceWatcher = deferredPromise()
  const page = fakeResponsePage([detailWatcher.promise, workspaceWatcher.promise])
  const detailResponse = { name: 'detail' }
  const workspaceResponse = { name: 'workspace' }
  let navigationStarted = false

  const operation = runActionAndWaitForApiResponses(page, [
    {
      method: 'GET',
      pathnameSuffix: '/be/form/example',
      options: { query: { draft: 1 }, timeout: 45_000 },
    },
    {
      method: 'GET',
      pathnameSuffix: '/be/form/example/translation',
      options: { query: { target_language: 'zh_HK' }, timeout: 45_000 },
    },
  ], async () => {
    assert.equal(page.registrations.length, 2)
    navigationStarted = true
  })

  assert.equal(page.registrations.length, 2)
  assert.equal(navigationStarted, false)
  workspaceWatcher.resolve(workspaceResponse)
  detailWatcher.resolve(detailResponse)
  assert.deepEqual(await operation, [detailResponse, workspaceResponse])
  assert.equal(navigationStarted, true)
  assert.deepEqual(page.registrations.map(({ options }) => options), [
    { timeout: 45_000 },
    { timeout: 45_000 },
  ])
})

test('keeps every response and popup watcher behind the managed action helper', async () => {
  const source = await readFile(
    new URL('../../scripts/form-multilingual-translation-publish.ui.spec.mjs', import.meta.url),
    'utf8',
  )

  assert.equal(source.match(/\bexactApiResponse\s*\(/g)?.length, 2)
  assert.equal(source.match(/\.waitForResponse\s*\(/g)?.length, 1)
  assert.equal(source.match(/await runActionAndWaitForApiResponses\s*\(/g)?.length, 12)
  assert.equal(source.match(/context\.waitForEvent\('page'/g)?.length, 1)
  assert.match(source, /runActionAndWaitForWatchers\(\[\s*\(\) => context\.waitForEvent\('page'/)
  assert.doesNotMatch(source, /\b(?:const|let)\s+\w+Promise\s*=\s*exactApiResponse\s*\(/)
  assert.doesNotMatch(source, /\b(?:const|let)\s+popupPromise\s*=\s*context\.waitForEvent\s*\(/)
})

test('locates the AI submit button from the modal page layer rather than its body content', async () => {
  const source = await readFile(
    new URL('../../scripts/form-multilingual-translation-publish.ui.spec.mjs', import.meta.url),
    'utf8',
  )

  assert.match(source, /const startTranslationButton = page\.getByRole\('button', \{[\s\S]*?开始翻译/)
  assert.match(source, /\}, \(\) => clickWhenReady\(startTranslationButton\)\)/)
  assert.doesNotMatch(source, /modal\.getByRole\('button', \{ name: \/开始翻译/)
})

test('selects the requested target tab before editor checks and translation saves', async () => {
  const source = await readFile(
    new URL('../../scripts/form-multilingual-translation-publish.ui.spec.mjs', import.meta.url),
    'utf8',
  )

  assert.match(source, /async function activateTargetLanguage\(page, language\)/)
  assert.match(source, /target-language-tab--active/)
  assert.doesNotMatch(source, /languageCard\.getAttribute\('aria-selected'\)/)
  assert.match(source, /const alternateLanguage = TARGET_LANGUAGES\.find\(\(candidate\) => candidate !== language\)/)
  assert.match(source, /await activateTargetLanguage\(page, language\)\n  const navItems/)
  assert.match(source, /async function fillTranslationUnit\(page, language, workspace, unit, value\)[\s\S]*?await activateTargetLanguage\(page, language\)/)
  assert.match(source, /async function waitForRenderedTargetText\(article, unit, language\)/)
  assert.match(source, /UI 译文必须与接口一致，才能保存或发布/)
})

test('uses a configurable positive integer AI timeout with a two-minute default', () => {
  assert.equal(DEFAULT_AI_TRANSLATION_TIMEOUT_MS, 120_000)
  assert.equal(parsePositiveTimeout(undefined), 120_000)
  assert.equal(parsePositiveTimeout(''), 120_000)
  assert.equal(parsePositiveTimeout(' 120000 '), 120_000)
  assert.equal(parsePositiveTimeout(135_000), 135_000)
  assert.equal(parsePositiveTimeout(undefined, 90_000), 90_000)

  for (const invalidValue of [
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '0',
    '-100',
    '120000.5',
    'two minutes',
    '120000ms',
    {},
    [],
  ]) {
    assert.throws(
      () => parsePositiveTimeout(invalidValue),
      /AI_TRANSLATION_TIMEOUT_MS.*正整数|正整数.*AI_TRANSLATION_TIMEOUT_MS/,
      `应拒绝非法 AI 翻译超时值 ${String(invalidValue)}`,
    )
  }
})

test('recognizes share links only after their asynchronous display value becomes a valid HTTP URL', () => {
  assert.equal(tryParseShareLink(''), null)
  assert.equal(tryParseShareLink('生成中'), null)
  assert.equal(tryParseShareLink('ftp://1xi.co/invalid'), null)
  assert.equal(
    tryParseShareLink('https://1xi.co/AbCd12')?.toString(),
    'https://1xi.co/AbCd12',
  )
})

test('does not throw when a popup first-navigation request has no frame yet', () => {
  const popup = { id: 'popup-page' }
  assert.equal(navigationRequestPage({
    frame: () => ({ page: () => popup }),
  }), popup)
  assert.equal(navigationRequestPage({
    frame: () => { throw new Error('frame is not available') },
  }), null)
})

test('keeps translation cancellation cleanup within runner and server deadlines', () => {
  const translationCleanupBudgetMs = PROBE_RECOVERY_TIMEOUT_MS
    + DEFAULT_RESPONSE_DRAIN_TIMEOUT_MS
    + REQUEST_CONTEXT_DISPOSE_TIMEOUT_MS

  assert.equal(PROBE_RECOVERY_TIMEOUT_MS, 10_000)
  assert.equal(DEFAULT_RESPONSE_DRAIN_TIMEOUT_MS, 2_000)
  assert.equal(REQUEST_CONTEXT_DISPOSE_TIMEOUT_MS, 1_000)
  assert.equal(DEFAULT_ABORT_CLEANUP_TIMEOUT_MS, 15_000)
  assert.equal(DEFAULT_CANCELLATION_WAIT_TIMEOUT_MS, 16_000)
  assert.ok(translationCleanupBudgetMs < DEFAULT_ABORT_CLEANUP_TIMEOUT_MS)
  assert.ok(DEFAULT_ABORT_CLEANUP_TIMEOUT_MS < DEFAULT_CANCELLATION_WAIT_TIMEOUT_MS)
})

test('bounds and reports independent recovery request context disposal', async () => {
  for (const fixture of [
    {
      name: 'success',
      dispose: async () => undefined,
      expectedWarnings: 0,
    },
    {
      name: 'failure',
      dispose: async () => { throw new Error('dispose failed') },
      expectedWarnings: 1,
      expectedMessage: /销毁失败/,
    },
    {
      name: 'timeout',
      dispose: () => new Promise(() => {}),
      expectedWarnings: 1,
      expectedMessage: /销毁超过 5ms/,
    },
  ]) {
    let disposeCount = 0
    const logs = []
    await disposeRequestContextWithin({
      dispose: async (...args) => {
        disposeCount += 1
        return await fixture.dispose(...args)
      },
    }, (level, message, details) => logs.push({ level, message, details }), 5)
    assert.equal(disposeCount, 1, fixture.name)
    assert.equal(logs.length, fixture.expectedWarnings, fixture.name)
    if (fixture.expectedMessage) {
      assert.equal(logs[0]?.level, 'warning', fixture.name)
      assert.match(logs[0]?.message ?? '', fixture.expectedMessage, fixture.name)
    }
  }
})

test('defines the source and two target languages in a stable order', () => {
  assert.deepEqual(REQUIRED_LANGUAGE_CODES, ['zh_CN', 'zh_HK', 'en_US'])
  assert.deepEqual(TARGET_LANGUAGE_CODES, ['zh_HK', 'en_US'])
  assert.equal(new Set(REQUIRED_LANGUAGE_CODES).size, 3)
  assert.deepEqual(REQUIRED_LANGUAGE_CODES.slice(1), TARGET_LANGUAGE_CODES)
})

test('accepts simplified and traditional display labels for the zh_HK target language', () => {
  assert.equal(languageCodeForDisplayLabel('繁体中文'), 'zh_HK')
  assert.equal(languageCodeForDisplayLabel('繁體中文'), 'zh_HK')
  assert.equal(languageCodeForDisplayLabel('简体中文'), 'zh_CN')
  assert.equal(languageCodeForDisplayLabel('English'), 'en_US')
  assert.equal(languageCodeForDisplayLabel('French'), null)
  assert.match('繁体中文', languageLabelPattern('zh_HK'))
  assert.match('繁體中文', languageLabelPattern('zh_HK'))
  assert.doesNotMatch('简体中文', languageLabelPattern('zh_HK'))
})

test('excludes system fields and sorts content fields before checking the full-form baseline', () => {
  const items = [
    { item_kind: 'system', sort: null, type_code: 'input' },
    { item_kind: 'common', sort: 3, type_code: 'email' },
    { item_kind: 'common', sort: 1, type_code: 'page' },
    { sort: 2, type_code: 'username' },
  ]
  assert.deepEqual(
    orderedContentFormItems(items).map((item) => item.type_code),
    ['page', 'username', 'email'],
  )
})

test('builds the admin translation URL from a configurable form ID', () => {
  assert.equal(
    buildTranslationUrl(
      'https://lx.admin.lingxi.tech/console',
      '/form-activity/translation?id={{FORM_ID}}',
      { FORM_ID: 'another-form-id' },
    ),
    'https://lx.admin.lingxi.tech/form-activity/translation?id=another-form-id',
  )
  assert.throws(
    () => buildTranslationUrl(
      'https://lx.admin.lingxi.tech',
      '/form-activity/translation?id=fixed-id',
      { FORM_ID: 'different-id' },
    ),
    /FORM_ID.*一致|一致.*FORM_ID/,
  )
})

test('uses locale as the authoritative public preview language parameter', () => {
  const preview = new URL(buildPublicPreviewUrl(
    'https://lx.admin.lingxi.tech',
    'another-form-id',
    'en_US',
  ))
  assert.equal(preview.origin, 'https://lx.lingxi.tech')
  assert.equal(preview.pathname, '/form/')
  assert.equal(preview.searchParams.get('id'), 'another-form-id')
  assert.equal(preview.searchParams.get('locale'), 'en_US')
  assert.equal(preview.searchParams.has('language'), false)
})

test('aligns API items by identity while detecting changes to actual order, content, groups and options', () => {
  const source = { data: { revision_no: 1, form: { form_id: 'ordered-form', source_language: 'zh_CN' }, items: [
    { item_key: 'name', type_code: 'username', sort: 2, label: '姓名', group_code: '', option: [] },
    { item_key: 'page', type_code: 'page', sort: 1, label: '第一页', group_code: '', option: [] },
    { item_key: 'choice', type_code: 'radio', sort: 3, label: '选择', group_code: '', option: [{ value: 'a', label: '甲' }, { value: 'b', label: '乙' }] },
  ] } }
  const publicPayload = structuredClone(source)
  publicPayload.data.items.reverse()
  const expectedStructure = structuralSignature(source)
  const expectedText = sourceTextSignature(source)
  assert.deepEqual(publicStructuralSignature(source, publicPayload), expectedStructure)
  assert.deepEqual(publicSourceTextSignature(source, publicPayload), expectedText)
  assert.deepEqual(structuralSignature(publicPayload), expectedStructure)
  assert.deepEqual(sourceTextSignature(publicPayload), expectedText)

  for (const mutate of [
    (items) => { items.find((item) => item.item_key === 'name').sort = 4 },
    (items) => { items.find((item) => item.item_key === 'name').group_code = 'different-group' },
    (items) => { items.find((item) => item.item_key === 'choice').option.reverse() },
    (items) => { items.pop() },
    (items) => { items[1] = structuredClone(items[0]) },
  ]) {
    const changed = structuredClone(publicPayload)
    mutate(changed.data.items)
    assert.notDeepEqual(publicStructuralSignature(source, changed), expectedStructure)
  }
  const changedText = structuredClone(publicPayload)
  changedText.data.items.find((item) => item.item_key === 'name').label = '错误的姓名'
  assert.notDeepEqual(publicSourceTextSignature(source, changedText), expectedText)
  assert.deepEqual(source.data.items.map((item) => item.item_key), ['name', 'page', 'choice'], 'signature comparison must not mutate the API response')
})

test('public source text comparison excludes admin submission metadata while preserving authored fields and admin checks', () => {
  const source = { code: 0, data: { form: { title: '活动', source_language: 'zh_CN' }, items: [
    { item_key: 'name_dynamic', item_kind: 'common', label: '姓名', placeholder: '请输入姓名' },
    { item_key: 'duration', label: '用时' },
    { item_key: 'future_metadata', item_kind: 'system', label: '后台系统字段' },
  ] } }
  const publicPayload = structuredClone(source)
  publicPayload.data.items[1].label = ''
  publicPayload.data.items[2].label = ''
  const expected = sourceTextSignature(source, { includeSystemItems: false })
  assert.deepEqual(publicSourceTextSignature(source, publicPayload), expected)
  assert.notDeepEqual(sourceTextSignature(source), sourceTextSignature(publicPayload), 'admin source checks must still detect changed metadata labels')

  for (const field of ['label', 'placeholder']) {
    const changed = structuredClone(publicPayload)
    changed.data.items[0][field] = '错误的原文'
    assert.notDeepEqual(publicSourceTextSignature(source, changed), expected, `authored ${field} changes must fail`)
  }
  const missingQuestion = structuredClone(publicPayload)
  missingQuestion.data.items.shift()
  assert.notDeepEqual(publicSourceTextSignature(source, missingQuestion), expected)
})

test('parses optional exact translation expectations for both target languages', () => {
  assert.deepEqual(parseTranslationExpectations(undefined), {})
  assert.deepEqual(parseTranslationExpectations(''), {})
  assert.deepEqual(parseTranslationExpectations('{}'), {})

  const expectations = {
    zh_HK: {
      'form.title': '活動報名',
      'item:name:label': '姓名',
    },
    en_US: {
      'form.title': 'Event registration',
      'item:name:label': 'Name',
    },
  }
  assert.deepEqual(
    parseTranslationExpectations(JSON.stringify(expectations)),
    expectations,
  )
})

test('rejects malformed or ambiguous exact translation expectations', () => {
  const invalidExpectations = [
    ['{not-json}', /TRANSLATION_EXPECTATIONS.*JSON|JSON.*TRANSLATION_EXPECTATIONS/],
    ['null', /TRANSLATION_EXPECTATIONS.*对象|对象.*TRANSLATION_EXPECTATIONS/],
    ['[]', /TRANSLATION_EXPECTATIONS.*对象|对象.*TRANSLATION_EXPECTATIONS/],
    [JSON.stringify({ zh_CN: { title: '源文不能作为目标译文' } }), /zh_CN|目标语言/],
    [JSON.stringify({ fr_FR: { title: 'Inscription' } }), /fr_FR|目标语言/],
    [JSON.stringify({ zh_HK: [] }), /zh_HK.*对象|对象.*zh_HK/],
    [JSON.stringify({ en_US: { '': 'Name' } }), /键|unit_key|field_path/],
    [JSON.stringify({ en_US: { title: '' } }), /非空字符串|译文/],
    [JSON.stringify({ en_US: { title: '   ' } }), /非空字符串|译文/],
    [JSON.stringify({ en_US: { title: 123 } }), /非空字符串|译文/],
  ]

  for (const [raw, expectedError] of invalidExpectations) {
    assert.throws(() => parseTranslationExpectations(raw), expectedError)
  }
})

test('normalizes the real translation workspace response without losing unit identity', () => {
  const workspace = normalizeTranslationWorkspace(translationResponse(), 'en_US')

  assert.equal(workspace.revisionNo, 18)
  assert.equal(workspace.sourceLanguage, 'zh_CN')
  assert.equal(workspace.targetLanguage, 'en_US')
  assert.equal(workspace.enabled, true)
  assert.equal(workspace.published, false)
  assert.equal(workspace.languages.length, 2)
  assert.equal(workspace.sections.length, 1)
  assert.equal(workspace.units.length, 2)
  assert.deepEqual(workspace.units[0], {
    unitKey: 'form:title',
    fieldPath: 'form.title',
    sourceText: '活动报名',
    sourceHash: 'hash-title',
    translatedText: 'Event registration',
    status: 'translated',
    editorType: 'plain_text',
    sectionKey: 'form:basic',
  })
})

test('rejects malformed translation workspaces before they can drive save or publish', () => {
  const malformedCases = [
    [{}, /业务信封|code|data/],
    [{ code: 500, message: 'failed' }, /业务码|code/],
    [translationResponse({ targetLanguage: 'zh_HK' }), /en_US|目标语言/],
    [{ ...translationResponse(), data: { ...translationResponse().data, sections: null } }, /sections.*数组|数组.*sections/],
    [{
      ...translationResponse(),
      data: { ...translationResponse().data, source_language_locked: undefined },
    }, /source_language_locked/],
    [{
      ...translationResponse(),
      data: { ...translationResponse().data, source_language_locked: 'yes' },
    }, /source_language_locked.*布尔值|布尔值.*source_language_locked/],
    [{
      ...translationResponse(),
      data: {
        ...translationResponse().data,
        sections: [{ ...translationResponse().data.sections[0], units: null }],
      },
    }, /units.*数组|数组.*units/],
    [translationResponse({
      units: [{
        unit_key: '',
        field_path: 'form.title',
        source_hash: 'hash-title',
        source_text: '活动报名',
        translated_text: 'Event registration',
        status: 'translated',
        editor_type: 'plain_text',
      }],
    }), /unit_key|关键字段/],
  ]

  for (const [body, expectedError] of malformedCases) {
    assert.throws(
      () => normalizeTranslationWorkspace(body, 'en_US'),
      expectedError,
    )
  }
})

test('accepts a fully translated workspace when AI output already exists from an earlier run', () => {
  const workspace = normalizeTranslationWorkspace(translationResponse(), 'en_US')

  assert.deepEqual(analyzeTranslationWorkspace(workspace), {
    total: 2,
    translated: 2,
    missing: 0,
    stale: 0,
    complete: true,
    duplicateUnitKeys: [],
    invalidUnits: [],
  })
})

test('reports missing, stale, duplicate and invalid translation units instead of treating them as complete', () => {
  const base = normalizeTranslationWorkspace(translationResponse(), 'en_US')
  const workspace = {
    ...base,
    units: [
      base.units[0],
      { ...base.units[1], translatedText: '', status: 'missing' },
      { ...base.units[0], translatedText: 'Old title', status: 'stale' },
      { ...base.units[1], unitKey: '', translatedText: 'Invalid' },
    ],
  }
  const analysis = analyzeTranslationWorkspace(workspace)

  assert.equal(analysis.total, 4)
  assert.equal(analysis.translated, 2)
  assert.equal(analysis.missing, 1)
  assert.equal(analysis.stale, 1)
  assert.equal(analysis.complete, false)
  assert.deepEqual(analysis.duplicateUnitKeys, ['form:title'])
  assert.equal(analysis.invalidUnits.length, 1)
})

test('compares stable source structure while allowing target-language translated text to differ', () => {
  const english = normalizeTranslationWorkspace(translationResponse(), 'en_US')
  const traditional = normalizeTranslationWorkspace(translationResponse({
    targetLanguage: 'zh_HK',
    units: [
      { ...translationResponse().data.sections[0].units[0], translated_text: '活動報名' },
      { ...translationResponse().data.sections[0].units[1], translated_text: '姓名' },
    ],
  }), 'zh_HK')

  assert.deepEqual(compareWorkspaceStructure(english, traditional), [])

  for (const changedUnit of [
    { ...traditional.units[0], fieldPath: 'form.changed_title' },
    { ...traditional.units[0], sourceText: '活动报名表' },
    { ...traditional.units[0], sourceHash: 'changed-hash' },
    { ...traditional.units[0], sectionKey: 'changed-section' },
  ]) {
    const changed = {
      ...traditional,
      units: [changedUnit, traditional.units[1]],
    }
    assert.ok(compareWorkspaceStructure(english, changed).length > 0)
  }

  const reordered = {
    ...traditional,
    units: [traditional.units[1], traditional.units[0]],
  }
  assert.ok(compareWorkspaceStructure(english, reordered).length > 0)
})

test('compares public payloads against their sparse admin source without hiding structural changes', () => {
  const sourcePayload = {
    data: {
      revision_no: 18,
      form: { form_id: '4Eo73A', title: '活动报名' },
      items: [{
        item_key: 'mobile',
        type_code: 'mobile',
        group_code: '',
        item_kind: 'common',
        sort: 1,
        hidden: 2,
        private: 2,
        label: '手机号',
        placeholder: '请输入手机号',
        option: [],
        rule_config: { required: { enabled: 1 } },
        common_config: { area_code: { default: '+86', enabled: 1 } },
      }],
    },
  }
  const publicPayload = structuredClone(sourcePayload)
  delete publicPayload.data.items[0].option
  publicPayload.data.items[0].common_config.area_code.choices = [{
    code: '+86',
    title: 'China',
    length: 11,
  }]

  assert.deepEqual(publicStructuralSignature(sourcePayload, publicPayload), structuralSignature(sourcePayload))
  assert.deepEqual(publicSourceTextSignature(sourcePayload, publicPayload), sourceTextSignature(sourcePayload))

  const changedRule = structuredClone(publicPayload)
  changedRule.data.items[0].rule_config.required.enabled = 2
  assert.notDeepEqual(publicStructuralSignature(sourcePayload, changedRule), structuralSignature(sourcePayload))

  const changedOption = structuredClone(publicPayload)
  changedOption.data.items[0].option = [{ code: 'unexpected' }]
  assert.notDeepEqual(publicStructuralSignature(sourcePayload, changedOption), structuralSignature(sourcePayload))

  const missingSourceField = structuredClone(publicPayload)
  delete missingSourceField.data.items[0].common_config.area_code.default
  assert.notDeepEqual(publicStructuralSignature(sourcePayload, missingSourceField), structuralSignature(sourcePayload))
})

test('matches rendered rich-text descriptions using browser textContent semantics', () => {
  assert.equal(
    textContentFromHtml('<p><strong>Filling Instructions</strong></p><ul><li><p>Please check carefully.</p></li></ul>'),
    'Filling InstructionsPlease check carefully.',
  )
  assert.equal(textContentFromHtml('Hello <strong>world</strong>'), 'Hello world')
})

test('detects raw and URL-encoded secrets in share links without echoing secret values', () => {
  const adminToken = 'Bearer admin-secret-token-123456'
  const apiKey = 'preview-api-key-654321'
  const cleanUrl = 'https://example.test/form/?id=4Eo73A&channel_code=default'

  assert.deepEqual(
    findShareUrlSecretLeaks(cleanUrl, [
      { name: 'adminToken', value: adminToken },
      { name: 'apiKey', value: apiKey },
    ]),
    [],
  )

  for (const { url, expectedLeak } of [
    { url: `${cleanUrl}&token=${encodeURIComponent(adminToken)}`, expectedLeak: 'adminToken' },
    {
      url: `${cleanUrl}&redirect=${encodeURIComponent(`https://example.test/?api_key=${apiKey}`)}`,
      expectedLeak: 'apiKey',
    },
    { url: `${cleanUrl}#authorization=${encodeURIComponent(adminToken)}`, expectedLeak: 'adminToken' },
  ]) {
    const leaks = findShareUrlSecretLeaks(url, [
      { name: 'adminToken', value: adminToken },
      { name: 'apiKey', value: apiKey },
    ])
    assert.deepEqual(leaks, [expectedLeak])
    assert.doesNotMatch(JSON.stringify(leaks), /admin-secret-token|preview-api-key/)
  }

  const spacedSecret = 'Bearer admin secret'
  const formEncodedUrl = new URL(cleanUrl)
  formEncodedUrl.searchParams.set('token', spacedSecret)
  assert.match(formEncodedUrl.toString(), /Bearer\+admin\+secret/)
  assert.deepEqual(
    findShareUrlSecretLeaks(formEncodedUrl, [{ name: 'adminToken', value: spacedSecret }]),
    ['adminToken'],
  )
})

test('permits an unlocked source language during setup and enforces mutation identity gates', () => {
  const response = translationResponse()
  response.data.languages = [
    {
      language: 'zh_HK',
      language_text: '繁體中文',
      enabled: false,
      published: false,
      status: 'disabled',
      progress: { total: 2, translated: 0, missing: 2, stale: 0, percent: 0 },
    },
    {
      language: 'en_US',
      language_text: 'English',
      enabled: false,
      published: false,
      status: 'disabled',
      progress: { total: 2, translated: 0, missing: 2, stale: 0, percent: 0 },
    },
  ]
  response.data.sections[0].group_key = 'form_structure'
  response.data.source_language_locked = false

  assert.equal(normalizeTranslationWorkspace(response, 'en_US').sourceLanguageLocked, false)
  assert.equal(normalizeWorkspace(response).source_language_locked, false)

  assert.doesNotThrow(() => assertTranslationWorkspace(response, {
    expectedRevision: 18,
    expectedTargetLanguage: 'en_US',
    requireEnabled: false,
  }))
  assert.throws(() => assertTranslationWorkspace(response, {
    expectedRevision: 18,
    expectedTargetLanguage: 'en_US',
  }), /en_US.*启用|zh_HK.*启用/)
  assert.doesNotThrow(() => requireWorkspaceMutationGate(response, {
    expectedRevision: 18,
    expectedTargetLanguage: 'en_US',
    requireEnabled: false,
  }))
  assert.throws(() => requireWorkspaceMutationGate(response, {
    expectedRevision: 19,
    expectedTargetLanguage: 'en_US',
    requireEnabled: false,
  }), /版本.*一致/)

  const wrongSource = structuredClone(response)
  wrongSource.data.source_language = 'en_US'
  assert.throws(() => requireWorkspaceMutationGate(wrongSource, {
    expectedRevision: 18,
    expectedTargetLanguage: 'en_US',
    requireEnabled: false,
  }), /原文语言.*zh_CN/)

  const enabled = publicationReadyResponse()
  enabled.data.source_language_locked = false
  assert.doesNotThrow(() => requireWorkspaceMutationGate(enabled, {
    expectedRevision: 18,
    expectedTargetLanguage: 'en_US',
  }))
  enabled.data.enabled = false
  assert.throws(() => requireWorkspaceMutationGate(enabled, {
    expectedRevision: 18,
    expectedTargetLanguage: 'en_US',
  }), /当前目标语言.*启用/)

  const extraLanguage = publicationReadyResponse()
  extraLanguage.data.languages.push({
    language: 'fr_FR',
    language_text: 'Français',
    enabled: true,
    published: false,
    status: 'editing',
    progress: { total: 2, translated: 2, missing: 0, stale: 0, percent: 100 },
  })
  assert.throws(() => requireWorkspaceMutationGate(extraLanguage, {
    expectedRevision: 18,
    expectedTargetLanguage: 'en_US',
  }), /目标语言集合/)
})

test('normalizes template tokens while preserving duplicate occurrences', () => {
  assert.deepEqual(templateTokens('Hello {{ name }} and {{name}}'), ['{{name}}', '{{name}}'])
  assert.deepEqual(templateTokens('{{ account . id }}'), ['{{account.id}}'])
  assert.notDeepEqual(templateTokens('{{name}} {{name}}'), templateTokens('{{name}}'))
})

test('hard-blocks deterministic translation hazards but keeps language heuristics diagnostic', () => {
  const properName = publicationReadyResponse({
    units: [{
      unit_key: 'form:title',
      field_path: 'form.title',
      source_hash: 'hash-title',
      source_text: '欢迎来到北京',
      translated_text: 'Welcome to 北京',
      status: 'translated',
      editor_type: 'plain_text',
    }],
  })
  const normalizedProperName = normalizeWorkspace(properName)
  assert.ok(languageQualityIssues(normalizedProperName, 'en_US')
    .some((issue) => issue.type === 'english-contains-han'))
  assert.doesNotThrow(() => requireTranslationQualityGate(properName, 'en_US'))

  const plainJavascript = publicationReadyResponse({
    units: [{
      unit_key: 'form:description',
      field_path: 'form.description',
      source_hash: 'hash-description',
      source_text: '输入 javascript: 作为文字',
      translated_text: 'Type javascript: as plain text',
      status: 'translated',
      editor_type: 'plain_text',
    }],
  })
  assert.doesNotThrow(() => requireTranslationQualityGate(plainJavascript, 'en_US'))

  const duplicateTokens = publicationReadyResponse({
    units: [{
      unit_key: 'form:description',
      field_path: 'form.description',
      source_hash: 'hash-description',
      source_text: '您好 {{ name }}，账号 {{name}}',
      translated_text: 'Hello {{name}}, account {{ name }}',
      status: 'translated',
      editor_type: 'plain_text',
    }],
  })
  assert.doesNotThrow(() => requireTranslationQualityGate(duplicateTokens, 'en_US'))
  duplicateTokens.data.sections[0].units[0].translated_text = 'Hello {{name}}'
  assert.throws(
    () => requireTranslationQualityGate(duplicateTokens, 'en_US'),
    /模板变量.*禁止保存发布/,
  )

  const unsafeRichText = publicationReadyResponse({
    units: [{
      unit_key: 'form:description',
      field_path: 'form.description',
      source_hash: 'hash-description',
      source_text: '<p>填写说明</p>',
      translated_text: '<a href="javascript:alert(1)">Instructions</a>',
      status: 'translated',
      editor_type: 'rich_text',
    }],
  })
  assert.throws(
    () => requireTranslationQualityGate(unsafeRichText, 'en_US'),
    /危险富文本.*禁止保存发布/,
  )

  const damagedRichTextList = publicationReadyResponse({
    units: [{
      unit_key: 'form:description',
      field_path: 'form.description',
      source_hash: 'hash-description',
      source_text: '<ul><li>姓名</li><li>手机号</li></ul>',
      translated_text: '<ul><li>Name and mobile number</li></ul>',
      status: 'translated',
      editor_type: 'rich_text',
    }],
  })
  assert.throws(
    () => requireTranslationQualityGate(damagedRichTextList, 'en_US'),
    /列表结构损坏.*禁止保存发布/,
  )
})

test('keeps built-in semantic checks recorded while hard-blocking explicit exact expectations', () => {
  const semanticSynonym = publicationReadyResponse({
    targetLanguage: 'zh_HK',
    units: [{
      unit_key: 'item:mobile:label',
      field_path: 'items.mobile.label',
      source_hash: 'hash-mobile',
      source_text: '手机号',
      translated_text: '流動電話號碼',
      status: 'translated',
      editor_type: 'plain_text',
    }],
  })
  assert.doesNotThrow(() => requireTranslationQualityGate(semanticSynonym, 'zh_HK'))

  const exactMismatch = publicationReadyResponse()
  const assertions = []
  assert.throws(() => runWithAssertionRecorder(
    'form-multilingual-translation-publish',
    (assertion) => assertions.push(assertion),
    () => assertTranslationWorkspace(exactMismatch, {
      expectedRevision: 18,
      expectedTargetLanguage: 'en_US',
      requireComplete: true,
      customExpectations: { en_US: { 'form.title': 'Different title' } },
    }),
  ), /自定义精确译文.*禁止保存发布/)
  assert.ok(assertions.some((assertion) => (
    assertion.status === 'failed' && assertion.name.includes('精确匹配配置译文')
  )))
})

test('creates run-unique reversible probes and refuses to overwrite concurrent values', () => {
  const original = 'Automated test form'
  const probe = createTranslationProbeValue(original, '1234567890abcdef')
  assert.notEqual(probe, original)
  assert.equal(probe.length, original.length)
  assert.equal(createTranslationProbeValue('Name', 'abcdef123456'), 'Name[Pabcdef12]')
  assert.equal(translationProbeRecoveryAction(original, probe, original), 'already-restored')
  assert.equal(translationProbeRecoveryAction(probe, probe, original), 'restore-probe')
  assert.equal(translationProbeRecoveryAction('Concurrent edit', probe, original), 'conflict')
})

function recoveryReadPayload(workspace, unit, translatedText) {
  return publicationReadyResponse({
    targetLanguage: workspace.target_language,
    units: workspace.units.map((entry) => ({
      unit_key: entry.unit_key,
      field_path: entry.field_path,
      source_hash: entry.source_hash,
      source_text: entry.source_text,
      translated_text: entry.unit_key === unit.unit_key ? translatedText : entry.translated_text,
      status: entry.status,
      editor_type: entry.editor_type,
    })),
  })
}

function successfulRecoveryResponse(body) {
  return {
    ok: () => true,
    json: async () => body,
  }
}

test('keeps polling an uncertain save until a delayed probe is observed and restored', async () => {
  const originalValue = 'Event registration'
  const probeValue = 'probe registration'
  const workspacePayload = publicationReadyResponse()
  const workspace = normalizeWorkspace(workspacePayload)
  const unit = workspace.units[0]
  const getValues = [originalValue, originalValue, probeValue, originalValue]
  const requests = []
  let nowMs = 0
  const requestContext = {
    async fetch(url, options) {
      assert.equal(typeof url, 'string')
      requests.push({ url, options })
      const method = options.method
      const value = method === 'GET' ? getValues.shift() : undefined
      const body = method === 'GET'
        ? recoveryReadPayload(workspace, unit, value)
        : { code: 0, data: {} }
      return successfulRecoveryResponse(body)
    },
  }

  await ensureOriginalTranslationRestored({
    requestContext,
    apiBaseUrl: 'https://example.test/api',
    formId: '4Eo73A',
    language: 'en_US',
    workspace,
    unit,
    originalValue,
    probeValue,
    probePersistenceUncertain: true,
    recoveryTimeoutMs: 200,
    recoveryPollIntervalMs: 1,
    recoveryActionReserveMs: 100,
    now: () => nowMs,
    wait: async (timeoutMs) => { nowMs += timeoutMs },
  })

  assert.equal(getValues.length, 0)
  assert.deepEqual(requests.map((request) => request.options.method), ['GET', 'GET', 'GET', 'PUT', 'GET'])
  assert.deepEqual(
    requests.slice(0, 3).map((request) => request.options.timeout),
    [100, 99, 98],
  )
  assert.equal(requests[3].options.timeout, 148)
  assert.equal(requests[4].options.timeout, 198)
  const recoveryPayload = JSON.parse(requests[3].options.data)
  assert.deepEqual(recoveryPayload.translations, [{
    unit_key: unit.unit_key,
    source_hash: unit.source_hash,
    translated_text: originalValue,
  }])
})

test('stops uncertain observation at its deadline without spending recovery action time', async () => {
  const originalValue = 'Event registration'
  const probeValue = 'probe registration'
  const workspace = normalizeWorkspace(publicationReadyResponse())
  const unit = workspace.units[0]
  const requests = []
  let nowMs = 0
  const requestContext = {
    async fetch(url, options) {
      assert.equal(typeof url, 'string')
      requests.push({ url, options })
      return successfulRecoveryResponse(recoveryReadPayload(workspace, unit, originalValue))
    },
  }

  await ensureOriginalTranslationRestored({
    requestContext,
    apiBaseUrl: 'https://example.test/api',
    formId: '4Eo73A',
    language: 'en_US',
    workspace,
    unit,
    originalValue,
    probeValue,
    probePersistenceUncertain: true,
    recoveryTimeoutMs: 100,
    recoveryPollIntervalMs: 20,
    recoveryActionReserveMs: 40,
    now: () => nowMs,
    wait: async (timeoutMs) => { nowMs += timeoutMs },
  })

  assert.equal(nowMs, 60)
  assert.deepEqual(requests.map((request) => request.options.method), ['GET', 'GET', 'GET'])
  assert.deepEqual(requests.map((request) => request.options.timeout), [60, 40, 20])
})

test('rejects an original-value GET that returns after the observation deadline', async () => {
  const originalValue = 'Event registration'
  const probeValue = 'probe registration'
  const workspace = normalizeWorkspace(publicationReadyResponse())
  const unit = workspace.units[0]
  const requests = []
  let nowMs = 0
  const requestContext = {
    async fetch(url, options) {
      assert.equal(typeof url, 'string')
      requests.push({ url, options })
      nowMs += options.timeout + 1
      return successfulRecoveryResponse(recoveryReadPayload(workspace, unit, originalValue))
    },
  }

  await assert.rejects(
    ensureOriginalTranslationRestored({
      requestContext,
      apiBaseUrl: 'https://example.test/api',
      formId: '4Eo73A',
      language: 'en_US',
      workspace,
      unit,
      originalValue,
      probeValue,
      probePersistenceUncertain: true,
      recoveryTimeoutMs: 100,
      recoveryPollIntervalMs: 20,
      recoveryActionReserveMs: 40,
      now: () => nowMs,
      wait: async (timeoutMs) => { nowMs += timeoutMs },
    }),
    /响应超过观察截止时间，结果不可信/,
  )

  assert.equal(nowMs, 61)
  assert.deepEqual(requests.map((request) => request.options.method), ['GET'])
  assert.equal(requests[0].options.timeout, 60)
})

test('reserves a final GET budget when restoring a persisted probe after a slow PUT', async () => {
  const originalValue = 'Event registration'
  const probeValue = 'probe registration'
  const workspace = normalizeWorkspace(publicationReadyResponse())
  const unit = workspace.units[0]
  const getValues = [probeValue, originalValue]
  const requests = []
  let nowMs = 0
  const requestContext = {
    async fetch(url, options) {
      assert.equal(typeof url, 'string')
      requests.push({ url, options })
      if (options.method === 'PUT') {
        nowMs += options.timeout - 1
        return successfulRecoveryResponse({ code: 0, data: {} })
      }
      const value = getValues.shift()
      nowMs += 5
      return successfulRecoveryResponse(recoveryReadPayload(workspace, unit, value))
    },
  }

  await ensureOriginalTranslationRestored({
    requestContext,
    apiBaseUrl: 'https://example.test/api',
    formId: '4Eo73A',
    language: 'en_US',
    workspace,
    unit,
    originalValue,
    probeValue,
    recoveryTimeoutMs: 100,
    recoveryActionReserveMs: 40,
    now: () => nowMs,
    wait: async (timeoutMs) => { nowMs += timeoutMs },
  })

  assert.deepEqual(requests.map((request) => request.options.method), ['GET', 'PUT', 'GET'])
  assert.deepEqual(requests.map((request) => request.options.timeout), [60, 75, 21])
  assert.equal(getValues.length, 0)
  assert.equal(nowMs, 84)
})

test('builds direct cleanup URLs beneath the configured API base path', () => {
  assert.equal(
    translationApiUrl('https://lx.admin.lingxi.tech/api', '4Eo73A').toString(),
    'https://lx.admin.lingxi.tech/api/be/form/4Eo73A/translation',
  )
  assert.equal(
    translationApiUrl('https://example.test/custom/api/', 'id with space').toString(),
    'https://example.test/custom/api/be/form/id%20with%20space/translation',
  )
})

test('flags mixed-language text from visible field controls, not only field headings', () => {
  const cleanSnapshot = {
    documentTitle: 'Registration',
    title: 'Registration',
    subtitle: '',
    description: '',
    fieldLabels: [{ itemKey: 'id', text: 'ID Document' }],
    fieldContent: [{ itemKey: 'id', value: 'ID Document\nPassport' }],
    placeholders: [{ itemKey: 'id', value: 'Enter your ID number' }],
    controlLabels: ['Passport'],
    pagination: ['Next Page'],
  }
  assert.deepEqual(visibleLanguageIssues(cleanSnapshot, 'en_US'), [])
  assert.ok(visibleLanguageIssues({
    ...cleanSnapshot,
    controlLabels: ['身份證'],
  }, 'en_US').some((issue) => issue.type === 'english-preview-contains-han'))
})

test('locates the exact published list record and checks publication metadata', () => {
  const payload = {
    data: {
      list: [
        { id: 'other', title: 'Same title', status: 'published', current_revision_no: 18 },
        {
          id: 'internal-row-id',
          form_id: '4Eo73A',
          title: 'Target title',
          status: 'published',
          current_revision_no: 18,
          translation_progress: { total: 2, completed: 2, published_languages: 2 },
        },
      ],
    },
  }
  const match = assertPublishedListRecord(payload, '4Eo73A', 'Target title', 18)
  assert.equal(match.recordIndex, 1)
  assert.equal(match.record.id, 'internal-row-id')
  assert.equal(match.record.form_id, '4Eo73A')
})
