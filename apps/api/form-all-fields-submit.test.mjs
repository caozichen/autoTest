import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { createFormLinkContract } from '../../scripts/support/form-link-contract.mjs'
import { executeRegisteredScript } from './script-runner.mjs'
import {
  ONE_PIXEL_PNG,
  createFullRunFormHtml,
} from './support/form-all-fields-submit-full-run-fixture.mjs'
import {
  createPublishedFormFixture,
  remapFixtureKeys,
} from './support/form-lpxavn-fixtures.mjs'
import {
  SCRIPT_ID,
  run,
} from '../../scripts/form-all-fields-submit.ui.spec.mjs'

const SCRIPT_NAME = '已发布全题型表单填写并提交'

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

test('requires the dynamic FORM_ID request path instead of falling back to a fixed form', async () => {
  await assert.rejects(
    () => run(),
    /必须通过 FORM_ID 解析出公开表单路径/,
  )
  for (const requestPath of ['/form/', '/form/?id=', '/form/?id={{FORM_ID}}']) {
    await assert.rejects(
      () => run({ requestPath }),
      /必须通过 FORM_ID 解析出非空表单 ID/,
    )
  }
})

test('production run delegates to the dynamic contract flow and attributes failure artifacts to itself', async (t) => {
  const artifactRoot = await mkdtemp(join(tmpdir(), 'autotest-all-fields-artifacts-'))
  const requests = []
  const server = createServer((request, response) => {
    requests.push(request.url || '/')
    if (request.url === '/f/form/delegated-id') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ code: 0, data: {} }))
      return
    }
    if (request.url === '/form/?id=delegated-id') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(`<!doctype html>
        <html lang="zh-CN">
          <head><title>动态全题型表单</title></head>
          <body>
            <main>contract loading</main>
            <script>fetch('/f/form/delegated-id')</script>
          </body>
        </html>`)
      return
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
    runId: 'attempt-001',
    executionId: 'execution-001',
    scriptId: SCRIPT_ID,
    context: {
      siteBaseUrl,
      apiBaseUrl: `${siteBaseUrl}/api`,
      requestPath: '/form/?id=delegated-id',
      variables: {},
      authorizationOrigin: siteBaseUrl,
      extraHTTPHeaders: { Authorization: 'Bearer test-token' },
    },
  }, { artifactRootDirectory: artifactRoot })

  assert.equal(result.ok, false)
  assert.match(result.error, /locator\.click: Timeout 30000ms exceeded/)
  assert.match(result.error, /fb-runtime-pagination-buttons/)

  const missingFormAssertion = result.assertions.find(({ name }) => (
    name === '公开表单配置接口响应应包含 form 对象'
  ))
  assert.ok(missingFormAssertion)
  assert.equal(missingFormAssertion.status, 'failed')
  assert.match(missingFormAssertion.error, /Expected: true/)
  assert.ok(
    result.assertions.some(({ sequence }) => sequence > missingFormAssertion.sequence),
    '配置结构断言失败后应继续执行后续断言，直到页面操作被真实阻塞',
  )

  assert.ok(requests.includes('/form/?id=delegated-id'))
  assert.ok(requests.includes('/f/form/delegated-id'))
  const identityLog = result.logs.find(({ level, message }) => (
    level === 'info' && message === '已根据所选环境域名拼接公开表单地址'
  ))
  assert.deepEqual(
    { scriptId: identityLog?.details?.scriptId, scriptName: identityLog?.details?.scriptName },
    { scriptId: SCRIPT_ID, scriptName: SCRIPT_NAME },
  )

  const failureLog = result.logs.find(({ level, message }) => (
    level === 'error' && message.includes('已保存当前页面全页截图')
  ))
  assert.ok(failureLog)
  assert.match(failureLog.message, new RegExp(SCRIPT_NAME))
  assert.doesNotMatch(failureLog.message, /lpXAVN/)
  assert.equal(failureLog.details.scriptId, SCRIPT_ID)
  assert.equal(failureLog.details.scriptName, SCRIPT_NAME)

  const expectedAttemptDirectory = resolve(
    artifactRoot,
    'execution-001',
    SCRIPT_ID,
    'attempt-001',
  )
  const screenshotPath = failureLog.details.screenshotPath
  assert.equal(screenshotPath.startsWith(`${expectedAttemptDirectory}/`), true)
  assert.equal((await stat(screenshotPath)).size > 0, true)
  assert.deepEqual(
    [...(await readFile(screenshotPath)).subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  )

  const artifacts = result.artifacts
  assert.equal(artifacts.length, 3)
  assert.deepEqual(
    artifacts.map((artifact) => artifact.type).sort(),
    ['fixture', 'fixture', 'screenshot'],
  )
  assert.ok(artifacts.every((artifact) => artifact.stepId === SCRIPT_ID))
  assert.ok(artifacts.every((artifact) => artifact.absolutePath.startsWith(`${expectedAttemptDirectory}/`)))
})

test('registered production entry uses formId for public GET, validation, submission and result', async (t) => {
  const formId = 'full-run-form-id'
  const formCode = 'legacy-full-run-code'
  assert.notEqual(formId, formCode)
  const token = 'Bearer full-run-sensitive-token'
  const fixture = createPublishedFormFixture()
  fixture.data.form.form_id = formId
  fixture.data.form.form_code = formCode
  remapFixtureKeys(fixture)
  const linkedContract = createFormLinkContract({
    formId,
    formCode,
    title: fixture.data.form.title,
    revisionNo: fixture.data.revision_no,
    items: fixture.data.items,
  })
  const artifactRoot = await mkdtemp(join(tmpdir(), 'autotest-all-fields-full-run-'))
  const observedRequests = []
  let submittedPayload = null
  let siteBaseUrl = ''

  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://fixture.local')
    observedRequests.push({
      method: request.method || 'GET',
      path: `${requestUrl.pathname}${requestUrl.search}`,
      authorization: request.headers.authorization,
    })

    try {
      if (request.method === 'GET' && requestUrl.pathname === '/form/' && requestUrl.searchParams.get('id') === formId) {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(createFullRunFormHtml({
          origin: siteBaseUrl,
          formId,
          title: fixture.data.form.title,
          fieldKeys: linkedContract.fieldKeys,
        }))
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === `/f/form/${formId}`) {
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify(fixture))
        return
      }
      if (request.method === 'POST' && requestUrl.pathname === `/f/form/${formId}/submission/validate-page`) {
        for await (const _chunk of request) {
          // Consume the request before replying so Chrome observes a normal completed mutation.
        }
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify({ code: 0, data: {} }))
        return
      }
      if (request.method === 'POST' && requestUrl.pathname === `/f/form/${formId}/submission`) {
        const chunks = []
        for await (const chunk of request) chunks.push(chunk)
        submittedPayload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify({
          code: 0,
          data: { submission_id: 'full-run-submission-001' },
        }))
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
      response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ code: 500, message: error instanceof Error ? error.message : String(error) }))
    }
  })
  siteBaseUrl = await listen(server)
  t.after(async () => {
    await close(server)
    await rm(artifactRoot, { recursive: true, force: true })
  })

  const result = await executeRegisteredScript({
    runId: 'attempt-full-run-001',
    executionId: 'execution-full-run-001',
    scriptId: SCRIPT_ID,
    context: {
      siteBaseUrl,
      apiBaseUrl: `${siteBaseUrl}/api`,
      requestPath: `/form/?id=${formId}`,
      variables: { FORM_CONTRACT: JSON.stringify(linkedContract) },
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
  assert.equal(result.result.scriptId, SCRIPT_ID)
  assert.equal(result.result.status, 'submitted')
  assert.equal(result.result.formId, formId)
  assert.equal(result.result.pageCount, 3)
  assert.equal(result.result.linkedContractUsed, true)
  assert.equal(result.result.pageValidationRequestCount, 3)
  assert.equal(result.result.submissionRequestCount, 1)
  assert.equal(result.result.assertedAnswerFieldCount, 27)
  assert.equal(result.result.authorizationLeakCount, 0)
  assert.equal(result.assertions.some(({ status }) => status === 'failed'), false)

  const validationRequests = observedRequests.filter(({ method, path }) => (
    method === 'POST' && path === `/f/form/${formId}/submission/validate-page`
  ))
  const submissionRequests = observedRequests.filter(({ method, path }) => (
    method === 'POST' && path === `/f/form/${formId}/submission`
  ))
  assert.equal(validationRequests.length, 3)
  assert.equal(submissionRequests.length, 1)
  for (const [method, path] of [
    ['GET', `/f/form/${formId}`],
    ['POST', `/f/form/${formId}/submission/validate-page`],
    ['POST', `/f/form/${formId}/submission`],
  ]) {
    assert.ok(
      observedRequests.some((request) => request.method === method && request.path === path),
      `${method} ${path} should use formId`,
    )
  }
  assert.ok(observedRequests.every(({ path }) => !path.includes(`/f/form/${formCode}`)))
  assert.ok(observedRequests.every(({ authorization }) => authorization === undefined))
  assert.doesNotMatch(JSON.stringify(result), /full-run-sensitive-token/)

  assert.ok(submittedPayload)
  const serializedSubmission = JSON.stringify(submittedPayload)
  for (const name of [
    'username', 'mobile', 'email', 'idCard', 'landlinePhone', 'address', 'birthday',
    'input', 'textarea', 'radio', 'checkbox', 'select', 'number', 'date', 'time',
    'imageUpload', 'fileUpload', 'cascader', 'signature', 'groupUsername',
    'groupMobile', 'groupEmail', 'matrix', 'matrixChoice', 'ranking', 'rating', 'nps',
  ]) {
    assert.match(serializedSubmission, new RegExp(linkedContract.fieldKeys[name]))
  }

  const expectedAttemptDirectory = resolve(
    artifactRoot,
    'execution-full-run-001',
    SCRIPT_ID,
    'attempt-full-run-001',
  )
  assert.equal(result.artifacts.length, 2)
  assert.ok(result.artifacts.every(({ type }) => type === 'fixture'))
  assert.ok(result.artifacts.every(({ stepId }) => stepId === SCRIPT_ID))
  assert.ok(result.artifacts.every(({ absolutePath }) => absolutePath.startsWith(`${expectedAttemptDirectory}/`)))
})
