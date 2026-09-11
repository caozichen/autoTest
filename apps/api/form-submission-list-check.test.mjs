import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import {
  DEFAULT_REQUEST_PATH,
  buildListUrl,
  createFuzzyProbe,
  inspectListResponse,
  isContactListResponse,
  isSubmissionListResponse,
  normalizeRequestPath,
  parseSubmissionAssertions,
  resolveListContext,
} from '../../scripts/form-submission-list-check.ui.spec.mjs'
import { executeRegisteredScript } from './script-runner.mjs'
import {
  BASIC_SUBMISSION_FIELDS,
  ONE_PIXEL_PNG,
  SEARCHABLE_SUBMISSION_FIELDS,
  SUBMISSION_SEARCH_FIELDS,
  createSubmissionDetailHtml,
  createSubmissionListFixture,
  createSubmissionListHtml,
  filterContactRecords,
  filterSubmissionRecords,
} from './support/form-submission-list-check-fixture.mjs'

const SCRIPT_ID = 'form-submission-list-check'

async function listen(server) {
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('测试服务器没有可用端口')
  return `http://127.0.0.1:${address.port}`
}

async function close(server) {
  await new Promise((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose())
  })
}

function sendJson(response, body, statusCode = 200) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

function sendHtml(response, html) {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end(html)
}

function fakeResponse({ method = 'GET', url, status = 200, body = {} }) {
  return {
    request: () => ({ method: () => method }),
    url: () => url,
    status: () => status,
    ok: () => status >= 200 && status < 400,
    text: async () => JSON.stringify(body),
    json: async () => body,
  }
}

function responseWithRecords(baseResponse, records) {
  return {
    ...baseResponse,
    data: {
      ...baseResponse.data,
      list: records,
      meta: {
        ...baseResponse.data?.meta,
        total: records.length,
      },
    },
  }
}

function canonicalFilterKey(key) {
  return key.replace(/\[\]$/, '').replace(/\[\d+\]$/, '')
}

function filterKeys(url) {
  return [...new Set(
    [...url.searchParams.keys()]
      .filter((key) => key.startsWith('filter['))
      .map(canonicalFilterKey),
  )]
}

function requestUrl(entry) {
  return new URL(entry.path, 'http://fixture.local')
}

function answerFor(fixture, itemKey) {
  return String(
    fixture.record.answers.find((answer) => answer.item_key === itemKey)?.answer ?? '',
  )
}

function failureAssertions(result) {
  return result.assertions.filter(({ status }) => status === 'failed')
}

async function createFixtureRun(t, {
  scenario = 'success',
  locale = 'zh-TW',
  submissionFailureFilterKey = '',
  submissionBusinessFailureFilterKey = '',
  assertionMode = 'full',
  extendedFields = false,
} = {}) {
  const fixture = createSubmissionListFixture({
    formId: `list-check-${scenario}`,
    submissionId: `submission-${scenario}-001`,
    title: `自动化测试全题型表单-${scenario}-1788940800000`,
    primaryContactName: `自动化测试用户${scenario}3858`,
    groupContactName: `题组联系人${scenario}3859`,
  })
  const token = `Bearer submission-list-${scenario}-sensitive-token`
  if (extendedFields) {
    fixture.additionalSearchFields = [
      { key: 'filter[channel]', basicKey: 'dyn_channel', itemKey: 'channel', label: 'channel', kind: 'text' },
      { key: 'filter[remark]', basicKey: 'dyn_remark', itemKey: 'remark', label: '备注信息', kind: 'text' },
    ]
    fixture.record.answers.push({ item_key: 'remark', answer: '新增备注完整检索样本' })
  }
  const artifactRoot = await mkdtemp(join(tmpdir(), `autotest-submission-list-${scenario}-`))
  const observedRequests = []
  let listDocumentCount = 0

  const server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://fixture.local')
    observedRequests.push({
      method: request.method || 'GET',
      path: `${url.pathname}${url.search}`,
      authorization: request.headers.authorization,
    })
    try {
      if (
        request.method === 'GET'
        && url.pathname === '/form-activity/submission/preview'
        && url.searchParams.get('id') === fixture.formId
      ) {
        listDocumentCount += 1
        if (scenario === 'navigation-failure') {
          request.socket.destroy()
          return
        }
        sendHtml(response, createSubmissionListHtml({
          fixture,
          locale,
          resourcePath: scenario === 'resource-failure'
            ? '/fixture-assets/missing-submission-list.css'
            : '/fixture-assets/submission-list.css',
          injectWriteRequest: scenario === 'write-request' && listDocumentCount === 1,
        }))
        return
      }
      if (
        request.method === 'GET'
        && url.pathname === `/form-activity/submission/preview/reply/${fixture.submissionId}`
        && url.searchParams.get('fid') === fixture.formId
      ) {
        sendHtml(response, createSubmissionDetailHtml({ fixture, locale }))
        return
      }
      if (request.method === 'GET' && url.pathname === `/api/be/form/${fixture.formId}`) {
        sendJson(response, fixture.formResponse)
        return
      }
      if (request.method === 'GET' && url.pathname === `/api/be/form/${fixture.formId}/tab-counts`) {
        sendJson(response, fixture.tabCountsResponse)
        return
      }
      if (request.method === 'GET' && url.pathname === `/api/be/form/${fixture.formId}/submission`) {
        if (submissionFailureFilterKey && filterKeys(url).includes(submissionFailureFilterKey)) {
          sendJson(response, { code: 50301, message: 'fixture submission search failed' }, 503)
          return
        }
        if (
          submissionBusinessFailureFilterKey
          && filterKeys(url).includes(submissionBusinessFailureFilterKey)
        ) {
          sendJson(response, { code: 40901, message: 'fixture submission business failure' })
          return
        }
        const records = filterSubmissionRecords(url, [fixture.record], fixture.additionalSearchFields)
        sendJson(response, responseWithRecords(fixture.submissionResponse, records))
        return
      }
      if (request.method === 'GET' && url.pathname === `/api/be/form/${fixture.formId}/contact`) {
        const contacts = filterContactRecords(url, fixture.contacts)
        sendJson(response, responseWithRecords(fixture.contactResponse, contacts))
        return
      }
      if (
        request.method === 'GET'
        && url.pathname === `/api/be/form/${fixture.formId}/submission/${fixture.submissionId}`
      ) {
        sendJson(response, fixture.detailResponse)
        return
      }
      if (
        request.method === 'PATCH'
        && url.pathname === `/api/be/form/${fixture.formId}/submission/${fixture.submissionId}`
      ) {
        sendJson(response, { code: 0, message: 'fixture write should be rejected by the checker' })
        return
      }
      if (request.method === 'GET' && url.pathname === '/fixture-assets/detail-image.png') {
        setTimeout(() => {
          response.writeHead(200, { 'Content-Type': 'image/png' })
          response.end(ONE_PIXEL_PNG)
        }, 200)
        return
      }
      if (request.method === 'GET' && url.pathname === '/fixture-assets/submission-list.css') {
        response.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' })
        response.end(`
          [hidden] { display: none !important; }
          body { font-family: sans-serif; }
          .info-card, .filter-card, .list-card { margin: 12px; padding: 12px; }
          .arco-tabs-tab { display: inline-block; padding: 8px; cursor: pointer; }
          .filter-card-field { display: inline-block; margin: 4px; }
          .filter-card-label { display: block; }
          .arco-modal-wrapper { position: fixed; inset: 0; background: rgba(0, 0, 0, .1); }
          .arco-modal { margin: 20px auto; width: 900px; background: white; padding: 16px; }
          .field-group-content { display: grid; grid-template-columns: repeat(4, 1fr); }
          table { width: 100%; }
        `)
        return
      }
      if (request.method === 'GET' && url.pathname === '/fixture-assets/missing-submission-list.css') {
        response.writeHead(503, { 'Content-Type': 'text/css; charset=utf-8' })
        response.end('fixture stylesheet unavailable')
        return
      }
      if (
        request.method === 'GET'
        && ['/fixture-assets/submission-list.png', '/favicon.ico'].includes(url.pathname)
      ) {
        response.writeHead(200, { 'Content-Type': 'image/png' })
        response.end(ONE_PIXEL_PNG)
        return
      }
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('not found')
    } catch (error) {
      sendJson(response, {
        code: 500,
        message: error instanceof Error ? error.message : String(error),
      }, 500)
    }
  })
  const siteBaseUrl = await listen(server)
  t.after(async () => {
    await close(server)
    await rm(artifactRoot, { recursive: true, force: true })
  })

  const result = await executeRegisteredScript({
    runId: `attempt-submission-list-${scenario}-001`,
    executionId: `execution-submission-list-${scenario}-001`,
    scriptId: SCRIPT_ID,
    context: {
      siteBaseUrl,
      apiBaseUrl: `${siteBaseUrl}/api`,
      requestPath: `/form-activity/submission/preview?id=${fixture.formId}`,
      variables: {
        FORM_ID: fixture.formId,
        SUBMISSION_ID: fixture.submissionId,
        SUBMISSION_ASSERTIONS: assertionMode === 'empty'
          ? '{}'
          : JSON.stringify({
              title: fixture.title,
              primaryContactName: fixture.primaryContactName,
              groupContactName: fixture.groupContactName,
              fields: {
                '姓名[1]': fixture.primaryContactName,
                '姓名[2]': fixture.groupContactName,
              },
            }),
      },
      authorizationOrigin: siteBaseUrl,
      extraHTTPHeaders: { Authorization: token },
    },
  }, { artifactRootDirectory: artifactRoot })

  return {
    result,
    fixture,
    token,
    artifactRoot,
    observedRequests,
    listDocumentCount,
  }
}

test('resolves only the exact same-origin submission-list route and matching run identifiers', () => {
  assert.equal(DEFAULT_REQUEST_PATH, '/form-activity/submission/preview?id=4J02PQ')
  assert.equal(
    normalizeRequestPath(' form-activity/submission/preview?id=dynamic-form '),
    '/form-activity/submission/preview?id=dynamic-form',
  )
  assert.equal(
    buildListUrl(
      'https://example.test/admin',
      '/form-activity/submission/preview?id=dynamic-form',
    ),
    'https://example.test/form-activity/submission/preview?id=dynamic-form',
  )
  const listUrl = buildListUrl(
    'https://example.test/admin',
    '/form-activity/submission/preview?id=dynamic-form',
  )
  assert.deepEqual(resolveListContext(listUrl, {
    FORM_ID: 'dynamic-form',
    SUBMISSION_ID: 'dynamic-submission',
  }), {
    formId: 'dynamic-form',
    submissionId: 'dynamic-submission',
  })
  assert.throws(
    () => resolveListContext(listUrl, {
      FORM_ID: 'another-form',
      SUBMISSION_ID: 'dynamic-submission',
    }),
    /FORM_ID.*id.*不一致|id.*FORM_ID.*不一致/,
  )
  assert.throws(
    () => resolveListContext(listUrl, { FORM_ID: 'dynamic-form' }),
    /SUBMISSION_ID|提报 ID/,
  )
  assert.throws(
    () => resolveListContext(
      'https://example.test/unexpected/form-activity/submission/preview?id=dynamic-form',
      { FORM_ID: 'dynamic-form', SUBMISSION_ID: 'dynamic-submission' },
    ),
    /submission\/preview 路由|提报列表路由/,
  )
})

test('rejects unsafe submission-list request paths before Chrome is launched', () => {
  assert.throws(
    () => normalizeRequestPath('https://other.example.test/form-activity/submission/preview?id=form'),
    /必须是相对路径/,
  )
  assert.throws(
    () => normalizeRequestPath('/\\other.example.test/form-activity/submission/preview?id=form'),
    /不能包含反斜杠/,
  )
  assert.throws(
    () => normalizeRequestPath('/form-activity/submission/preview?id=bad form'),
    /不能包含空格或换行/,
  )
})

test('normalizes semantic and legacy contact-name assertions and rejects contradictory values', () => {
  const expected = {
    title: '动态表单标题',
    primaryContactName: '自动化测试用户3858',
    groupContactName: '题组联系人3859',
  }
  const semantic = parseSubmissionAssertions(JSON.stringify({
    ...expected,
    fields: {
      '姓名[1]': expected.primaryContactName,
      '姓名[2]': expected.groupContactName,
    },
  }))
  assert.equal(semantic.title, expected.title)
  assert.equal(semantic.primaryContactName, expected.primaryContactName)
  assert.equal(semantic.groupContactName, expected.groupContactName)
  assert.deepEqual(semantic.fields, {
    '姓名[1]': expected.primaryContactName,
    '姓名[2]': expected.groupContactName,
  })
  assert.equal(semantic.configuredAssertionCount, 3)

  const legacy = parseSubmissionAssertions(JSON.stringify({
    title: expected.title,
    fields: {
      '姓名[1]': expected.primaryContactName,
      '姓名[2]': expected.groupContactName,
    },
  }))
  assert.equal(legacy.primaryContactName, expected.primaryContactName)
  assert.equal(legacy.groupContactName, expected.groupContactName)

  assert.throws(
    () => parseSubmissionAssertions(JSON.stringify({
      primaryContactName: '语义姓名',
      fields: { '姓名[1]': '冲突姓名', '姓名[2]': expected.groupContactName },
    })),
    /冲突|不一致/,
  )
  assert.throws(() => parseSubmissionAssertions('{invalid-json'), /JSON|解析/)
})

test('builds a non-prefix/non-suffix probe for contains-style fuzzy-search verification', () => {
  for (const value of ['自动化测试用户3858', 'autotest_1788940800000@example.com', '0755-12345678']) {
    const probe = createFuzzyProbe(value)
    assert.ok(probe.length >= 2)
    assert.ok(probe.length < value.length)
    assert.ok(value.includes(probe))
    assert.ok(value.indexOf(probe) > 0, `${probe} 不应只是前缀探针`)
    assert.ok(value.indexOf(probe) + probe.length < value.length, `${probe} 不应只是后缀探针`)
  }
})

test('matches only exact same-origin submission and contact list GET responses', () => {
  const context = {
    origin: 'https://example.test',
    formId: 'dynamic-form',
    apiPathPrefix: '/api',
  }
  assert.equal(isSubmissionListResponse(fakeResponse({
    url: 'https://example.test/api/be/form/dynamic-form/submission?page=1',
  }), context), true)
  assert.equal(isContactListResponse(fakeResponse({
    url: 'https://example.test/api/be/form/dynamic-form/contact?page=1',
  }), context), true)
  for (const candidate of [
    fakeResponse({ method: 'POST', url: 'https://example.test/api/be/form/dynamic-form/submission' }),
    fakeResponse({ url: 'https://other.example.test/api/be/form/dynamic-form/submission' }),
    fakeResponse({ url: 'https://example.test/api/be/form/another-form/submission' }),
    fakeResponse({ url: 'https://example.test/api/be/form/dynamic-form/submission/unexpected' }),
    fakeResponse({ url: 'https://example.test/be/form/dynamic-form/submission' }),
  ]) {
    assert.equal(isSubmissionListResponse(candidate, context), false)
  }
  assert.equal(isContactListResponse(fakeResponse({
    url: 'https://example.test/api/be/form/dynamic-form/submission',
  }), context), false)
})

test('parses a successful list payload and associates names only after locating the exact submission id', async () => {
  const fixture = createSubmissionListFixture()
  const outcome = await inspectListResponse(fakeResponse({
    url: `https://example.test/api/be/form/${fixture.formId}/submission`,
    body: fixture.submissionResponse,
  }), {
    submissionId: fixture.submissionId,
    expectedNames: [fixture.primaryContactName, fixture.groupContactName],
    label: 'fixture 提报列表接口',
  })

  assert.equal(outcome.succeeded, true)
  assert.equal(outcome.records.length, 1)
  assert.equal(outcome.targetIndex, 0)
  assert.equal(outcome.targetRecord.id, fixture.submissionId)
})

test('checks all submission/contact filters with contains probes, exact ids, Token, and no writes', async (t) => {
  const {
    result,
    fixture,
    token,
    observedRequests,
  } = await createFixtureRun(t)

  assert.equal(
    result.ok,
    true,
    [
      result.error,
      ...failureAssertions(result).map(({ module, name, error }) => (
        `[${module}] ${name}: ${error ?? '无错误详情'}`
      )),
    ].filter(Boolean).join('\n'),
  )
  assert.equal(result.status, 'passed')
  assert.equal(result.result.status, 'checked')
  assert.equal(result.result.formId, fixture.formId)
  assert.equal(result.result.submissionId, fixture.submissionId)
  assert.equal(result.result.title, fixture.title)
  assert.equal(result.result.primaryContactName, fixture.primaryContactName)
  assert.equal(result.result.groupContactName, fixture.groupContactName)
  assert.equal(result.result.basicFieldCount, BASIC_SUBMISSION_FIELDS.length)
  assert.equal(result.result.searchFieldCount, SUBMISSION_SEARCH_FIELDS.length)
  assert.equal(result.result.submissionSearchCount, SUBMISSION_SEARCH_FIELDS.length)
  assert.equal(result.result.contactSearchCount, 3)
  assert.equal(result.assertions.some(({ status }) => status === 'failed'), false)

  const apiRequests = observedRequests.filter(({ path }) => path.startsWith('/api/'))
  assert.ok(apiRequests.length > SUBMISSION_SEARCH_FIELDS.length)
  assert.ok(apiRequests.every(({ authorization }) => authorization === token))
  assert.ok(apiRequests.every(({ method }) => method === 'GET'), '列表检查脚本不得触发任何后台写请求')
  assert.equal(result.result.authenticatedRequestCount, result.result.businessRequestCount)

  const submissionSearches = observedRequests
    .filter(({ method, path }) => method === 'GET'
      && requestUrl({ path }).pathname === `/api/be/form/${fixture.formId}/submission`
      && filterKeys(requestUrl({ path })).length > 0)
    .map((entry) => requestUrl(entry))
  assert.equal(submissionSearches.length, SUBMISSION_SEARCH_FIELDS.length)
  for (const field of SUBMISSION_SEARCH_FIELDS) {
    const matches = submissionSearches.filter((url) => filterKeys(url).includes(field.key))
    assert.equal(matches.length, 1, `${field.label} 应且只应执行一次独立检索`)
    const [url] = matches
    assert.deepEqual(filterKeys(url), [field.key], `${field.label} 查询不得残留其它筛选条件`)
    assert.equal(url.searchParams.get('page'), '1')
    assert.equal(url.searchParams.get('per_page'), '10')
    if (field.kind === 'text') {
      const answer = answerFor(fixture, field.itemKey)
      const probe = url.searchParams.get(field.key)
      assert.equal(probe, createFuzzyProbe(answer), `${field.label} 应使用确定性的中间片段`)
      assert.ok(answer.includes(probe))
      assert.ok(answer.indexOf(probe) > 0)
      assert.ok(answer.indexOf(probe) + probe.length < answer.length)
    } else if (field.kind === 'source') {
      assert.equal(url.searchParams.get(field.key), fixture.sourceText)
    } else if (field.kind === 'revision') {
      assert.equal(url.searchParams.get(field.key), String(fixture.revisionNo))
    } else {
      const values = url.searchParams.get(field.key).split(',')
      assert.equal(values.length, 2)
      assert.ok(values[0].slice(0, 10) <= fixture.createdAt.slice(0, 10))
      assert.ok(values[1].slice(0, 10) >= fixture.createdAt.slice(0, 10))
    }
  }

  const contactSearches = observedRequests
    .filter(({ method, path }) => method === 'GET'
      && requestUrl({ path }).pathname === `/api/be/form/${fixture.formId}/contact`
      && filterKeys(requestUrl({ path })).length > 0)
    .map((entry) => requestUrl(entry))
  assert.equal(contactSearches.length, 3)
  const keywordQueries = contactSearches.filter((url) => url.searchParams.has('filter[keyword]'))
  assert.deepEqual(
    keywordQueries.map((url) => url.searchParams.get('filter[keyword]')).sort(),
    [createFuzzyProbe(fixture.primaryContactName), createFuzzyProbe(fixture.groupContactName)].sort(),
  )
  assert.ok(keywordQueries.every((url) => filterKeys(url).length === 1))
  const contactDateQuery = contactSearches.find((url) => (
    filterKeys(url).includes('filter[created_at_between]')
  ))
  assert.ok(contactDateQuery)
  assert.deepEqual(filterKeys(contactDateQuery), ['filter[created_at_between]'])

  const expectedDetailPath = `/form-activity/submission/preview/reply/${fixture.submissionId}`
  assert.equal(
    observedRequests.filter(({ method, path }) => {
      const url = requestUrl({ path })
      return method === 'GET'
        && url.pathname === expectedDetailPath
        && url.searchParams.get('fid') === fixture.formId
    }).length,
    1,
  )
  assert.ok(observedRequests.some(({ method, path }) => (
    method === 'GET'
      && path === `/api/be/form/${fixture.formId}/submission/${fixture.submissionId}`
  )))
  assert.doesNotMatch(JSON.stringify(result), /submission-list-success-sensitive-token/)
})

test('checks 24 basic and 20 visible search fields with channel and remarks searches temporarily disabled', async (t) => {
  const { result, observedRequests, fixture } = await createFixtureRun(t, {
    scenario: 'extended-fields', extendedFields: true, locale: 'zh-CN',
  })
  assert.equal(result.ok, true, JSON.stringify(failureAssertions(result)))
  assert.equal(result.result.basicFieldCount, 24)
  assert.equal(result.result.searchFieldCount, 20)
  assert.equal(result.result.submissionSearchCount, 18)
  assert.equal(result.result.successfulSubmissionSearchCount, 18)
  assert.ok(result.resourceResponses.some((entry) => entry.url.endsWith('/detail-image.png')
    && entry.status === 200 && !entry.incomplete))
  for (const field of fixture.additionalSearchFields) {
    const requests = observedRequests.map(requestUrl).filter((url) => filterKeys(url).includes(field.key))
    assert.equal(requests.length, 0)
  }
  assert.ok(!result.logs.some((log) => log.message.includes('目标记录该字段为空')))
})

test('derives the form title and both contact names from the exact target detail when assertions are empty', async (t) => {
  const {
    result,
    fixture,
    token,
    observedRequests,
  } = await createFixtureRun(t, {
    scenario: 'empty-assertions',
    assertionMode: 'empty',
  })

  assert.equal(
    result.ok,
    true,
    [
      result.error,
      ...failureAssertions(result).map(({ module, name, error }) => (
        `[${module}] ${name}: ${error ?? '无错误详情'}`
      )),
    ].filter(Boolean).join('\n'),
  )
  assert.equal(result.status, 'passed')
  assert.equal(result.result.status, 'checked')
  assert.equal(result.result.formId, fixture.formId)
  assert.equal(result.result.submissionId, fixture.submissionId)
  assert.equal(result.result.title, fixture.title)
  assert.equal(result.result.primaryContactName, fixture.primaryContactName)
  assert.equal(result.result.groupContactName, fixture.groupContactName)
  assert.equal(result.result.submissionSearchCount, SUBMISSION_SEARCH_FIELDS.length)
  assert.equal(result.result.contactSearchCount, 3)
  assert.ok(observedRequests.some(({ method, path, authorization }) => (
    method === 'GET'
      && path === `/api/be/form/${fixture.formId}/submission/${fixture.submissionId}`
      && authorization === token
  )))
  assert.ok(
    observedRequests
      .filter(({ path }) => path.startsWith('/api/'))
      .every(({ method, authorization }) => method === 'GET' && authorization === token),
  )
})

test('reports a first-party stylesheet failure while still completing the read-only functional flow', async (t) => {
  const { result, observedRequests } = await createFixtureRun(t, { scenario: 'resource-failure' })

  assert.equal(result.ok, false)
  assert.equal(result.status, 'partial')
  assert.equal(result.continuePipeline, true)
  assert.equal(result.result.status, 'checked')
  assert.ok(observedRequests.some(({ path }) => path === '/fixture-assets/missing-submission-list.css'))
  assert.ok(result.resourceResponses.some((entry) => (
    entry.status === 503 && entry.url.endsWith('/fixture-assets/missing-submission-list.css')
  )))
  assert.ok(failureAssertions(result).some(({ module, name }) => (
    module === 'network.resources' || /资源/.test(name)
  )))
})

test('records one exact submission search HTTP failure and completes the remaining read-only checks', async (t) => {
  const failedKey = SEARCHABLE_SUBMISSION_FIELDS[4].filterKey
  const {
    result,
    fixture,
    observedRequests,
  } = await createFixtureRun(t, {
    scenario: 'api-failure',
    submissionFailureFilterKey: failedKey,
  })

  assert.equal(result.ok, false)
  assert.equal(result.status, 'partial')
  assert.equal(result.continuePipeline, true)
  assert.equal(result.result.status, 'checked')
  assert.equal(
    result.result.successfulSubmissionSearchCount,
    SUBMISSION_SEARCH_FIELDS.length - 1,
  )
  assert.ok(result.apiResponses.some((entry) => entry.status === 503))
  const failedSearchIndex = observedRequests.findIndex(({ method, path }) => {
    const url = requestUrl({ path })
    return method === 'GET'
      && url.pathname === `/api/be/form/${fixture.formId}/submission`
      && filterKeys(url).includes(failedKey)
  })
  assert.ok(failedSearchIndex >= 0)
  assert.equal(
    observedRequests.slice(failedSearchIndex + 1).some(({ method, path }) => (
      method !== 'GET' && path.startsWith('/api/')
    )),
    false,
    '筛选结果不确定后不得以写请求恢复或制造测试数据',
  )
  assert.ok(failureAssertions(result).some(({ name, error }) => (
    /HTTP|接口|固定电话|network/i.test(`${name} ${error ?? ''}`)
  )))
  const screenshots = result.artifacts.filter(({ type }) => type === 'screenshot')
  assert.equal(screenshots.length, 0, '单项功能失败应继续覆盖后续项目，不应提前中断并截图')
})

test('rejects an HTTP 200 submission search response whose business code is nonzero', async (t) => {
  const failedKey = SEARCHABLE_SUBMISSION_FIELDS[8].filterKey
  const { result, fixture, observedRequests } = await createFixtureRun(t, {
    scenario: 'business-failure',
    submissionBusinessFailureFilterKey: failedKey,
  })

  assert.equal(result.ok, false)
  assert.equal(result.status, 'partial')
  assert.equal(result.continuePipeline, true)
  assert.equal(
    result.result.successfulSubmissionSearchCount,
    SUBMISSION_SEARCH_FIELDS.length - 1,
  )
  const failedRequest = observedRequests.find(({ method, path }) => {
    const url = requestUrl({ path })
    return method === 'GET'
      && url.pathname === `/api/be/form/${fixture.formId}/submission`
      && filterKeys(url).includes(failedKey)
  })
  assert.ok(failedRequest)
  assert.ok(result.apiResponses.some((entry) => (
    entry.status === 200
      && entry.responseBody?.code === 40901
      && entry.url.includes(encodeURIComponent(failedKey).replaceAll('%5B', '[').replaceAll('%5D', ']'))
  )) || result.apiResponses.some((entry) => (
    entry.status === 200 && entry.responseBody?.code === 40901
  )))
  assert.ok(failureAssertions(result).some(({ name, error }) => (
    /业务码|code.*0|business/i.test(`${name} ${error ?? ''}`)
  )))
  assert.equal(
    result.apiResponses.some((entry) => entry.status >= 400),
    false,
    '本用例只能由业务码失败，不能借助 HTTP 失败通过',
  )
})

test('captures a scoped PNG when the list document transport fails before any business request', async (t) => {
  const { result, observedRequests } = await createFixtureRun(t, {
    scenario: 'navigation-failure',
  })

  assert.equal(result.ok, false)
  assert.equal(result.status, 'failed')
  assert.match(result.error, /ERR_EMPTY_RESPONSE|page\.goto|Navigation|navigation/i)
  assert.equal(observedRequests.some(({ path }) => path.startsWith('/api/')), false)
  assert.equal(observedRequests.some(({ method }) => method !== 'GET'), false)
  const screenshots = result.artifacts.filter(({ type }) => type === 'screenshot')
  assert.equal(screenshots.length, 1)
  assert.equal(screenshots[0].stepId, SCRIPT_ID)
  assert.match(screenshots[0].relativePath, /^screenshots\/.*\.png$/)
  assert.equal((await stat(screenshots[0].absolutePath)).size > 0, true)
  assert.deepEqual(
    [...(await readFile(screenshots[0].absolutePath)).subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  )
})

test('detects an unexpected same-origin PATCH instead of accepting a read-only pass', async (t) => {
  const { result, fixture, observedRequests } = await createFixtureRun(t, {
    scenario: 'write-request',
  })

  assert.equal(result.ok, false)
  assert.notEqual(result.status, 'passed')
  assert.equal(
    observedRequests.filter(({ method, path }) => (
      method === 'PATCH'
        && path === `/api/be/form/${fixture.formId}/submission/${fixture.submissionId}`
    )).length,
    1,
  )
  assert.ok(failureAssertions(result).some(({ name, error }) => (
    /只读|写请求|POST|PUT|PATCH|DELETE|mutation/i.test(`${name} ${error ?? ''}`)
  )))
})
