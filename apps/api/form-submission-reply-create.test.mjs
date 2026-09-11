import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import {
  DEFAULT_REQUEST_PATH,
  buildCreateUrl,
  inspectCreateResponse,
  isSubmissionCreateMutation,
  normalizeRequestPath,
  resolveCreateContext,
  run,
} from '../../scripts/form-submission-reply-create.ui.spec.mjs'
import { createFormLinkContract } from '../../scripts/support/form-link-contract.mjs'
import { runWithAssertionRecorder } from '../../scripts/support/recorded-expect.mjs'
import { executeRegisteredScript } from './script-runner.mjs'
import {
  ONE_PIXEL_PNG,
  createManualSubmissionFormHtml,
} from './support/form-submission-reply-create-fixture.mjs'
import {
  createPublishedFormFixture,
  remapFixtureKeys,
} from './support/form-lpxavn-fixtures.mjs'

const SCRIPT_ID = 'form-submission-reply-create'
const SCRIPT_NAME = '手动创建提报信息'

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

function fakeResponse(method, url) {
  return {
    request: () => ({ method: () => method }),
    url: () => url,
  }
}

function sendJson(response, body, statusCode = 200) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

function sendHtml(response, html) {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end(html)
}

async function readJsonBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

function fixtureContract(formId) {
  const fixture = createPublishedFormFixture()
  fixture.data.form.form_id = formId
  fixture.data.form.form_code = `legacy-${formId}`
  remapFixtureKeys(fixture)
  const contract = createFormLinkContract({
    formId,
    formCode: fixture.data.form.form_code,
    title: fixture.data.form.title,
    revisionNo: fixture.data.revision_no,
    items: fixture.data.items,
  })
  return { fixture, contract }
}

test('resolves a dynamic fid on the same admin origin and rejects inconsistent FORM_ID values', () => {
  assert.equal(
    DEFAULT_REQUEST_PATH,
    '/form-activity/submission/preview/reply/create?fid=q3r72J',
  )
  assert.equal(
    normalizeRequestPath(' form-activity/submission/preview/reply/create?fid=dynamic-form '),
    '/form-activity/submission/preview/reply/create?fid=dynamic-form',
  )
  assert.equal(
    buildCreateUrl('https://example.test/admin', '/form-activity/submission/preview/reply/create?fid=dynamic-form'),
    'https://example.test/form-activity/submission/preview/reply/create?fid=dynamic-form',
  )
  const createUrl = buildCreateUrl(
    'https://example.test/base',
    '/form-activity/submission/preview/reply/create?fid=dynamic-form',
  )
  assert.deepEqual(resolveCreateContext(createUrl, { FORM_ID: 'dynamic-form' }), {
    formId: 'dynamic-form',
  })
  assert.throws(
    () => resolveCreateContext(createUrl, { FORM_ID: 'different-form' }),
    /FORM_ID.*fid.*不一致/,
  )
  assert.throws(
    () => resolveCreateContext('https://example.test/form-activity/submission/preview/reply/create'),
    /formId|FORM_ID|fid/,
  )
  assert.throws(
    () => resolveCreateContext('https://example.test/unexpected/form-activity/submission/preview/reply/create?fid=dynamic-form'),
    /reply\/create 路由/,
  )
})

test('rejects unsafe manual-create paths before opening a browser', () => {
  assert.throws(
    () => normalizeRequestPath('https://other.example.test/form-activity/submission/preview/reply/create?fid=form'),
    /必须是相对路径/,
  )
  assert.throws(
    () => normalizeRequestPath('/\\other.example.test/form-activity/submission/preview/reply/create?fid=form'),
    /不能包含反斜杠/,
  )
  assert.throws(
    () => normalizeRequestPath('/form-activity/submission/preview/reply/create?fid=bad form'),
    /不能包含空格或换行/,
  )
})

test('matches only the exact same-origin manual-create POST', () => {
  const context = {
    origin: 'https://example.test',
    formId: 'dynamic-form',
    apiPathPrefix: '/api',
  }
  assert.equal(isSubmissionCreateMutation(
    fakeResponse('POST', 'https://example.test/api/be/form/dynamic-form/submission'),
    context,
  ), true)
  assert.equal(isSubmissionCreateMutation(
    fakeResponse('POST', 'https://example.test/be/form/dynamic-form/submission'),
    { ...context, apiPathPrefix: '/' },
  ), true)
  assert.equal(isSubmissionCreateMutation(
    fakeResponse('PUT', 'https://example.test/api/be/form/dynamic-form/submission'),
    context,
  ), false)
  assert.equal(isSubmissionCreateMutation(
    fakeResponse('POST', 'https://example.test/api/be/form/another-form/submission'),
    context,
  ), false)
  assert.equal(isSubmissionCreateMutation(
    fakeResponse('POST', 'https://other.example.test/api/be/form/dynamic-form/submission'),
    context,
  ), false)
  assert.equal(isSubmissionCreateMutation(
    fakeResponse('POST', 'https://example.test/api/be/form/dynamic-form/submission/unexpected'),
    context,
  ), false)
  assert.equal(isSubmissionCreateMutation(
    fakeResponse('POST', 'https://example.test/unexpected/api/be/form/dynamic-form/submission'),
    context,
  ), false)
  assert.equal(isSubmissionCreateMutation(
    fakeResponse('POST', 'https://example.test/be/form/dynamic-form/submission'),
    context,
  ), false)
})

test('records a create business failure and keeps returning a safe response outcome', async () => {
  const assertions = []
  const outcome = await runWithAssertionRecorder(
    SCRIPT_ID,
    (assertion) => assertions.push(assertion),
    () => inspectCreateResponse({
      ok: () => true,
      status: () => 200,
      text: async () => JSON.stringify({ code: 40901, message: 'duplicate submission' }),
    }),
  )

  assert.deepEqual(outcome, {
    body: { code: 40901, message: 'duplicate submission' },
    succeeded: false,
    submissionId: '',
  })
  assert.ok(assertions.some((assertion) => (
    assertion.status === 'failed' && /业务码.*0/.test(assertion.name)
  )))
})

test('creates one complete all-fields submission on the admin page with the environment Token', async (t) => {
  const formId = 'manual-create-form-id'
  const submissionId = 'manual-submission-001'
  const token = 'Bearer manual-create-sensitive-token'
  const { fixture, contract } = fixtureContract(formId)
  const artifactRoot = await mkdtemp(join(tmpdir(), 'autotest-manual-create-full-run-'))
  const observedRequests = []
  const createRequests = []
  let siteBaseUrl = ''

  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://fixture.local')
    observedRequests.push({
      method: request.method || 'GET',
      path: `${requestUrl.pathname}${requestUrl.search}`,
      authorization: request.headers.authorization,
    })

    try {
      if (
        request.method === 'GET'
        && requestUrl.pathname === '/form-activity/submission/preview/reply/create'
        && requestUrl.searchParams.get('fid') === formId
      ) {
        sendHtml(response, createManualSubmissionFormHtml({
          origin: siteBaseUrl,
          formId,
          title: fixture.data.form.title,
          fieldKeys: contract.fieldKeys,
          simulateRapidSecondSubmit: true,
        }))
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === `/api/be/form/${formId}`) {
        sendJson(response, fixture)
        return
      }
      if (request.method === 'POST' && requestUrl.pathname === `/api/be/form/${formId}/submission`) {
        createRequests.push({
          authorization: request.headers.authorization,
          body: await readJsonBody(request),
        })
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 40))
        sendJson(response, {
          code: 0,
          message: 'success',
          data: { submission_id: submissionId },
        })
        return
      }
      if (
        request.method === 'GET'
        && requestUrl.pathname === `/api/be/form/${formId}/submission/${submissionId}`
      ) {
        sendJson(response, { code: 0, data: { submission_id: submissionId } })
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/fixture-assets/radio-option.png') {
        response.writeHead(200, { 'Content-Type': 'image/png' })
        response.end(ONE_PIXEL_PNG)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/favicon.ico') {
        response.writeHead(200, { 'Content-Type': 'image/png' })
        response.end(ONE_PIXEL_PNG)
        return
      }
      response.writeHead(404)
      response.end('not found')
    } catch (error) {
      sendJson(response, {
        code: 500,
        message: error instanceof Error ? error.message : String(error),
      }, 500)
    }
  })
  siteBaseUrl = await listen(server)
  t.after(async () => {
    await close(server)
    await rm(artifactRoot, { recursive: true, force: true })
  })

  const result = await executeRegisteredScript({
    runId: 'attempt-manual-create-001',
    executionId: 'execution-manual-create-001',
    scriptId: SCRIPT_ID,
    context: {
      siteBaseUrl,
      apiBaseUrl: `${siteBaseUrl}/api`,
      requestPath: `/form-activity/submission/preview/reply/create?fid=${formId}`,
      variables: {
        FORM_ID: formId,
        FORM_CONTRACT: JSON.stringify(contract),
      },
      authorizationOrigin: siteBaseUrl,
      extraHTTPHeaders: { Authorization: token },
    },
  }, { artifactRootDirectory: artifactRoot })

  assert.equal(
    result.ok,
    true,
    [
      result.error,
      ...result.assertions
        .filter(({ status }) => status === 'failed')
        .map(({ module, name, error }) => `[${module}] ${name}: ${error ?? '无错误详情'}`),
    ].filter(Boolean).join('\n'),
  )
  assert.equal(result.result.formId, formId)
  assert.equal(result.result.submissionId, submissionId)
  assert.equal(result.result.submitted, true)
  assert.equal(
    result.result.createUrl,
    `${siteBaseUrl}/form-activity/submission/preview/reply/create?fid=${formId}`,
  )
  assert.equal(result.result.createResponse?.data?.submission_id, submissionId)
  assert.equal(result.assertions.some(({ status }) => status === 'failed'), false)

  assert.equal(createRequests.length, 1, '用户一次提交只能产生一条创建 POST')
  assert.equal(createRequests[0].authorization, token)
  assert.equal(createRequests[0].body.form_id, formId)
  assert.equal(createRequests[0].body.updater_name, '自动化测试操作人')
  const serializedSubmission = JSON.stringify(createRequests[0].body)
  for (const name of [
    'username', 'mobile', 'email', 'idCard', 'landlinePhone', 'address', 'birthday',
    'input', 'textarea', 'radio', 'checkbox', 'select', 'number', 'date', 'time',
    'imageUpload', 'fileUpload', 'cascader', 'signature', 'groupUsername',
    'groupMobile', 'groupEmail', 'matrix', 'matrixChoice', 'ranking', 'rating', 'nps',
  ]) {
    assert.match(serializedSubmission, new RegExp(contract.fieldKeys[name]))
  }

  const adminApiRequests = observedRequests.filter(({ path }) => path.startsWith('/api/'))
  assert.ok(adminApiRequests.length >= 2)
  assert.ok(adminApiRequests.every(({ authorization }) => authorization === token))
  assert.equal(
    observedRequests.some(({ path }) => path.includes('/submission/validate-page')),
    false,
    '后台手动创建同页提交不应调用公开表单分页校验',
  )
  assert.equal(
    observedRequests.filter(({ method, path }) => (
      method === 'GET' && path === `/api/be/form/${formId}/submission/${submissionId}`
    )).length,
    1,
    '创建成功后应只加载一次新提报详情',
  )
  assert.doesNotMatch(JSON.stringify(result), /manual-create-sensitive-token/)

  const expectedAttemptDirectory = resolve(
    artifactRoot,
    'execution-manual-create-001',
    SCRIPT_ID,
    'attempt-manual-create-001',
  )
  assert.equal(result.artifacts.length, 2)
  assert.ok(result.artifacts.every(({ type }) => type === 'fixture'))
  assert.ok(result.artifacts.every(({ stepId }) => stepId === SCRIPT_ID))
  assert.ok(result.artifacts.every(({ absolutePath }) => absolutePath.startsWith(`${expectedAttemptDirectory}/`)))
})

test('stops after an empty-form validation unexpectedly sends one create POST', async (t) => {
  const formId = 'manual-create-empty-validation-post'
  const token = 'Bearer manual-create-empty-validation-token'
  const { fixture, contract } = fixtureContract(formId)
  const artifactRoot = await mkdtemp(join(tmpdir(), 'autotest-manual-create-empty-post-'))
  const createRequests = []
  let fieldInputRequestCount = 0
  let siteBaseUrl = ''

  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://fixture.local')
    try {
      if (
        request.method === 'GET'
        && requestUrl.pathname === '/form-activity/submission/preview/reply/create'
        && requestUrl.searchParams.get('fid') === formId
      ) {
        sendHtml(response, createManualSubmissionFormHtml({
          origin: siteBaseUrl,
          formId,
          title: fixture.data.form.title,
          fieldKeys: contract.fieldKeys,
          simulateEmptyValidationPost: true,
        }))
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === `/api/be/form/${formId}`) {
        assert.equal(request.headers.authorization, token)
        sendJson(response, fixture)
        return
      }
      if (request.method === 'POST' && requestUrl.pathname === `/api/be/form/${formId}/submission`) {
        createRequests.push({
          authorization: request.headers.authorization,
          body: await readJsonBody(request),
        })
        sendJson(response, { code: 42201, message: 'empty form must not be submitted' })
        return
      }
      if (request.method === 'POST' && requestUrl.pathname === '/fixture-events/manual-create-field-input') {
        fieldInputRequestCount += 1
        response.writeHead(204)
        response.end()
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/fixture-assets/radio-option.png') {
        response.writeHead(200, { 'Content-Type': 'image/png' })
        response.end(ONE_PIXEL_PNG)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/favicon.ico') {
        response.writeHead(200, { 'Content-Type': 'image/png' })
        response.end(ONE_PIXEL_PNG)
        return
      }
      response.writeHead(404)
      response.end('not found')
    } catch (error) {
      sendJson(response, { code: 500, message: String(error) }, 500)
    }
  })
  siteBaseUrl = await listen(server)
  t.after(async () => {
    await close(server)
    await rm(artifactRoot, { recursive: true, force: true })
  })

  const result = await executeRegisteredScript({
    runId: 'attempt-manual-create-empty-post-001',
    executionId: 'execution-manual-create-empty-post-001',
    scriptId: SCRIPT_ID,
    context: {
      siteBaseUrl,
      apiBaseUrl: `${siteBaseUrl}/api`,
      requestPath: `/form-activity/submission/preview/reply/create?fid=${formId}`,
      variables: { FORM_ID: formId, FORM_CONTRACT: JSON.stringify(contract) },
      authorizationOrigin: siteBaseUrl,
      extraHTTPHeaders: { Authorization: token },
    },
  }, { artifactRootDirectory: artifactRoot })

  assert.equal(result.ok, false)
  assert.equal(result.status, 'failed')
  assert.equal(result.continuePipeline, undefined)
  assert.match(result.error, /空表校验若误发创建 POST，必须立即停止以避免后续重复创建/)
  assert.equal(createRequests.length, 1, '异常空表请求后不得再次点击创建提报')
  assert.equal(createRequests[0].authorization, token)
  assert.equal(createRequests[0].body.synthetic_empty_validation, true)
  assert.deepEqual(createRequests[0].body.answers, {})
  assert.equal(fieldInputRequestCount, 0, '硬门禁触发后不得继续填写任何字段')
  assert.ok(result.assertions.some((assertion) => (
    assertion.status === 'failed'
    && assertion.name.includes('空表必填校验不得发送创建 POST')
  )))
})

test('keeps creating once after a side-panel assertion drifts and reports a partial result', async (t) => {
  const formId = 'manual-create-soft-failure'
  const submissionId = 'manual-submission-soft-001'
  const token = 'Bearer manual-create-soft-token'
  const { fixture, contract } = fixtureContract(formId)
  const artifactRoot = await mkdtemp(join(tmpdir(), 'autotest-manual-create-soft-'))
  let createRequestCount = 0
  let siteBaseUrl = ''

  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://fixture.local')
    try {
      if (
        request.method === 'GET'
        && requestUrl.pathname === '/form-activity/submission/preview/reply/create'
        && requestUrl.searchParams.get('fid') === formId
      ) {
        sendHtml(response, createManualSubmissionFormHtml({
          origin: siteBaseUrl,
          formId,
          title: fixture.data.form.title,
          fieldKeys: contract.fieldKeys,
          omitSidePanelText: '特殊编号',
        }))
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === `/api/be/form/${formId}`) {
        assert.equal(request.headers.authorization, token)
        sendJson(response, fixture)
        return
      }
      if (request.method === 'POST' && requestUrl.pathname === `/api/be/form/${formId}/submission`) {
        createRequestCount += 1
        assert.equal(request.headers.authorization, token)
        await readJsonBody(request)
        sendJson(response, { code: 0, data: { submission_id: submissionId } })
        return
      }
      if (
        request.method === 'GET'
        && requestUrl.pathname === `/api/be/form/${formId}/submission/${submissionId}`
      ) {
        assert.equal(request.headers.authorization, token)
        sendJson(response, { code: 0, data: { submission_id: submissionId } })
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/fixture-assets/radio-option.png') {
        response.writeHead(200, { 'Content-Type': 'image/png' })
        response.end(ONE_PIXEL_PNG)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/favicon.ico') {
        response.writeHead(200, { 'Content-Type': 'image/png' })
        response.end(ONE_PIXEL_PNG)
        return
      }
      response.writeHead(404)
      response.end('not found')
    } catch (error) {
      sendJson(response, { code: 500, message: String(error) }, 500)
    }
  })
  siteBaseUrl = await listen(server)
  t.after(async () => {
    await close(server)
    await rm(artifactRoot, { recursive: true, force: true })
  })

  const result = await executeRegisteredScript({
    runId: 'attempt-manual-create-soft-001',
    executionId: 'execution-manual-create-soft-001',
    scriptId: SCRIPT_ID,
    context: {
      siteBaseUrl,
      apiBaseUrl: `${siteBaseUrl}/api`,
      requestPath: `/form-activity/submission/preview/reply/create?fid=${formId}`,
      variables: { FORM_ID: formId, FORM_CONTRACT: JSON.stringify(contract) },
      authorizationOrigin: siteBaseUrl,
      extraHTTPHeaders: { Authorization: token },
    },
  }, { artifactRootDirectory: artifactRoot })

  assert.equal(result.status, 'partial')
  assert.equal(result.continuePipeline, true)
  assert.equal(result.result.submitted, true)
  assert.equal(result.result.submissionId, submissionId)
  assert.equal(createRequestCount, 1)
  const uiFailure = result.assertions.find((assertion) => (
    assertion.status === 'failed'
    && assertion.name.includes('右侧信息区应显示“特殊编号”')
  ))
  assert.ok(uiFailure, '右侧信息区遗漏应被记录为界面结构断言失败')
  assert.ok(
    result.assertions.some((assertion) => (
      assertion.sequence > uiFailure.sequence
      && assertion.status === 'passed'
      && /创建|提交|详情/.test(assertion.name)
    )),
    '界面断言失败后应继续记录创建和详情页验证',
  )
  assert.equal(result.artifacts.filter(({ type }) => type === 'screenshot').length, 0)
})

test('captures a scoped PNG when the create page transport fails without attempting a mutation', async (t) => {
  const formId = 'manual-create-navigation-failure'
  const artifactRoot = await mkdtemp(join(tmpdir(), 'autotest-manual-create-failure-'))
  let createRequestCount = 0
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://fixture.local')
    if (
      request.method === 'GET'
      && requestUrl.pathname === '/form-activity/submission/preview/reply/create'
    ) {
      request.socket.destroy()
      return
    }
    if (request.method === 'POST' && requestUrl.pathname.endsWith('/submission')) {
      createRequestCount += 1
    }
    response.writeHead(404)
    response.end('not found')
  })
  const siteBaseUrl = await listen(server)
  t.after(async () => {
    await close(server)
    await rm(artifactRoot, { recursive: true, force: true })
  })

  const result = await executeRegisteredScript({
    runId: 'attempt-manual-create-failure-001',
    executionId: 'execution-manual-create-failure-001',
    scriptId: SCRIPT_ID,
    context: {
      siteBaseUrl,
      apiBaseUrl: `${siteBaseUrl}/api`,
      requestPath: `/form-activity/submission/preview/reply/create?fid=${formId}`,
      variables: { FORM_ID: formId },
      authorizationOrigin: siteBaseUrl,
      extraHTTPHeaders: { Authorization: 'Bearer navigation-failure-token' },
    },
  }, { artifactRootDirectory: artifactRoot })

  assert.equal(result.ok, false)
  assert.equal(result.status, 'failed')
  assert.match(result.error, /ERR_EMPTY_RESPONSE|page\.goto|Navigation|navigation/i)
  assert.equal(createRequestCount, 0)
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
