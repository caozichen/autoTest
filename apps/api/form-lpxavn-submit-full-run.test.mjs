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
const SCRIPT_ID = 'form-lpxavn-submit'

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

async function runPublicSubmissionFixture(t, { withSettings = false, withQuota = false, acceptsSecondSubmission = false } = {}) {
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
  if (withSettings) {
    const agreement = {
      enabled: 1,
      confirm_required: 2,
      name: '自动化兼容测试协议',
      agreements: [{ language: 'zh_CN', original: 1, content: '<p>仅用于本次自动化测试。</p>' }],
    }
    const feedback = {
      enabled: 1,
      body: '<h2>自动化测试已完成</h2><p><strong>登记成功</strong>，<em>请保留本次记录</em>。</p><ul><li>无需重复提交</li></ul>',
    }
    const promotion = {
      enabled: 1,
      button_text: '测试完成查看百度',
      selected: 'href',
      actions: [{ type: 'href', link: 'https://www.baidu.com' }],
    }
    fixture.data.form.common_config = { privacy_policy: agreement }
    fixture.data.form.notification_config = { customized_feedback: feedback, promotion_link: promotion }
    linkedContract.settings = {
      schemaVersion: 1,
      runMarker: 'fixture-settings-compatibility',
      agreement: {
        enabled: true, name: agreement.name, body: agreement.agreements[0].content,
        readBeforeFill: false, configKey: 'privacy_policy', savedParameters: agreement,
      },
      feedback: { enabled: true, body: feedback.body },
      promotion: { enabled: true, buttonText: promotion.button_text, type: 'href', link: promotion.actions[0].link },
    }
  }
  const quota = { enabled: 1, quota: 2, message: '本表单填报名额已满（上限2人），暂不接受新的填报。' }
  if (withQuota) {
    fixture.data.form.submit_config = { submission_quota: quota }
    linkedContract.settings = { ...linkedContract.settings, submissionQuota: { ...quota, enabled: true } }
  }
  const submittedPayloads = []
  const artifactRoot = await mkdtemp(join(tmpdir(), 'autotest-all-fields-full-run-'))
  const observedRequests = []
  const resultToken = 'b'.repeat(64)
  const resultEndpoint = `/f/form/${formId}/submission/full-run-submission-001?with_answer=0`
  const resultLoader = `
    const resultKey = 'form-result-token:' + encodeURIComponent(${JSON.stringify(formId)}) + ':full-run-submission-001'
    const credential = JSON.parse(sessionStorage.getItem(resultKey) || 'null')
    const resultBody = await fetch(${JSON.stringify(resultEndpoint)}, { headers: { 'X-Form-Result-Token': credential?.result_token || '' } }).then(r => r.json())
    document.querySelector('main').setAttribute('data-submit-success-screen', '')
    document.querySelector('main').setAttribute('data-submit-status', Number(resultBody.code) === 0 ? 'success' : 'error')
  `
  let submittedPayload = null
  let siteBaseUrl = ''
  let documents = 0
  let initialLoadsFinished = 0
  let resultImagesFinished = 0
  let loadsFinishedBeforeReload = null

  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://fixture.local')
    observedRequests.push({
      method: request.method || 'GET',
      path: `${requestUrl.pathname}${requestUrl.search}`,
      authorization: request.headers.authorization,
    })

    try {
      if (request.method === 'GET' && requestUrl.pathname === '/form/' && requestUrl.searchParams.get('id') === formId) {
        documents++
        if (documents === 2) loadsFinishedBeforeReload = initialLoadsFinished
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        let html = createFullRunFormHtml({
          origin: siteBaseUrl,
          formId,
          title: fixture.data.form.title,
          fieldKeys: linkedContract.fieldKeys,
          formSettings: fixture.data.form,
        })
        if (withQuota) html = html.replace('const submissionId = String(body.data', `
          if (Number(body.code) !== 0) {
            const dialog = document.createElement('div')
            dialog.setAttribute('role', 'dialog')
            const message = document.createElement('p')
            message.textContent = body.message
            dialog.append(message)
            const image = document.createElement('img')
            image.src = '/quota-error.png'
            dialog.append(image)
            document.body.append(dialog)
            return
          }
          const submissionId = String(body.data`)
        if (documents === 1) html = html.replace('</body>', '<img src="/slow-initial.png"><script>fetch("/api/area/tree")</script></body>')
        html = html.replace("history.pushState({}, '', '/form/submission-result/')", `
          sessionStorage.setItem('form-result-token:' + encodeURIComponent(formId) + ':' + encodeURIComponent(submissionId), JSON.stringify({ result_token: body.data.result_token }))
          location.assign('/form/submission-result/?form_id=' + formId + '&submission_id=' + submissionId)
          return`)
        response.end(html)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/form/submission-result/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(`<html><head><link rel="icon" href="data:,"></head><body>
          <form-submission-result form-id="${formId}" submission-id="full-run-submission-001"></form-submission-result>
          <main><h1>提交成功</h1></main><img src="/slow-result.png"><script>(async () => { ${resultLoader} })()</script></body></html>`)
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === `/f/form/${formId}/submission/full-run-submission-001`) {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        const valid = request.headers['x-form-result-token'] === resultToken
        response.end(JSON.stringify(valid ? { code: 0, data: { submission: { id: 'full-run-submission-001', form_id: formId, revision_no: 1 }, participants: [] } }
          : { code: 403, message: 'invalid credential' }))
        return
      }
      if (requestUrl.pathname === '/slow-initial.png' || requestUrl.pathname === '/api/area/tree') {
        const isImage = requestUrl.pathname.endsWith('.png')
        response.writeHead(200, { 'Content-Type': isImage ? 'image/png' : 'application/json' })
        response.flushHeaders()
        setTimeout(() => {
          initialLoadsFinished++
          response.end(isImage ? ONE_PIXEL_PNG : '{"code":0,"data":[]}')
        }, 2500)
        return
      }
      if (requestUrl.pathname === '/slow-result.png') {
        response.writeHead(200, { 'Content-Type': 'image/png' })
        response.flushHeaders()
        setTimeout(() => { resultImagesFinished++; response.end(ONE_PIXEL_PNG) }, 2600)
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
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        submittedPayloads.push(payload)
        submittedPayload ??= payload
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify(withQuota && submittedPayloads.length === 2 && !acceptsSecondSubmission
          ? { code: 800003, message: quota.message, data: null }
          : { code: 0, data: { submission_id: 'full-run-submission-001', result_token: resultToken } }))
        return
      }
      if (request.method === 'GET' && requestUrl.pathname === '/quota-error.png') {
        response.writeHead(200, { 'Content-Type': 'image/png' })
        response.end(ONE_PIXEL_PNG)
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

  if (acceptsSecondSubmission) {
    assert.equal(result.ok, false, 'an unexpectedly accepted second submission must fail the run')
    assert.match(result.error, /第二次填写必须返回数量不足或禁止新增的业务码/)
    assert.ok(result.assertions.some(entry => entry.status === 'failed'
      && entry.name === '第二次填写应返回数量不足或禁止新增的业务码'))
    assert.equal(submittedPayloads.length, 2, 'failure must not cause an extra submission or retry')
    assert.ok(result.artifacts.some(entry => entry.type === 'screenshot'))
    return
  }

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
  assert.equal(loadsFinishedBeforeReload, 2, '主动刷新前必须完成旧文档的地区树正文和图片加载')
  assert.equal(result.result.scriptId, SCRIPT_ID)
  assert.equal(result.result.status, 'submitted')
  assert.equal(result.result.formId, formId)
  assert.equal(result.result.submissionId, 'full-run-submission-001')
  assert.equal(result.result.submissionAssertions.title, fixture.data.form.title)
  assert.match(result.result.submissionAssertions.primaryContactName, /^自动化测试用户\d{6}$/)
  assert.match(result.result.submissionAssertions.groupContactName, /^题组联系人\d{6}$/)
  assert.match(result.result.submissionAssertions.fields['姓名[1]'], /^自动化测试用户\d{6}$/)
  assert.match(result.result.submissionAssertions.fields['姓名[2]'], /^题组联系人\d{6}$/)
  assert.equal(
    result.result.submissionAssertions.primaryContactName,
    result.result.submissionAssertions.fields['姓名[1]'],
  )
  assert.equal(
    result.result.submissionAssertions.groupContactName,
    result.result.submissionAssertions.fields['姓名[2]'],
  )
  assert.notEqual(
    result.result.submissionAssertions.fields['姓名[1]'],
    result.result.submissionAssertions.fields['姓名[2]'],
  )
  assert.equal(result.result.pageCount, 3)
  assert.equal(result.result.linkedContractUsed, true)
  assert.equal(result.result.pageValidationRequestCount, withQuota ? 6 : 3)
  assert.equal(result.result.submissionRequestCount, withQuota ? 2 : 1)
  assert.equal(result.result.assertedAnswerFieldCount, 27)
  assert.equal(result.result.authorizationLeakCount, 0)
  assert.equal(result.assertions.some(({ status }) => status === 'failed'), false)

  const validationRequests = observedRequests.filter(({ method, path }) => (
    method === 'POST' && path === `/f/form/${formId}/submission/validate-page`
  ))
  const submissionRequests = observedRequests.filter(({ method, path }) => (
    method === 'POST' && path === `/f/form/${formId}/submission`
  ))
  assert.equal(validationRequests.length, withQuota ? 6 : 3)
  assert.equal(submissionRequests.length, withQuota ? 2 : 1)
  assert.equal(observedRequests.filter(({ method, path }) => method === 'GET' && path === resultEndpoint).length, 2)
  assert.equal(resultImagesFinished, 2, 'both result documents must finish their images before reload or cleanup')
  const capturedSubmission = result.apiResponses.find(entry => entry.method === 'POST' && new URL(entry.url).pathname === `/f/form/${formId}/submission`)
  assert.equal(capturedSubmission.responseBody.code, 0)
  assert.notEqual(capturedSubmission.incomplete, true, 'a full document navigation must not discard the captured POST body')
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
  assert.doesNotMatch(JSON.stringify(result), new RegExp(resultToken))

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
  assert.equal(result.artifacts.length, withQuota ? 6 : 2)
  assert.equal(result.artifacts.filter(({ type }) => type === 'fixture').length, withQuota ? 4 : 2)
  if (withQuota) {
    assert.equal(result.result.quotaCheck.status, 'blocked')
    assert.equal(result.result.quotaCheck.businessCode, 800003)
    assert.equal(result.result.quotaCheck.message, quota.message)
    assert.equal(result.result.quotaCheck.acceptedSubmissionId, 'full-run-submission-001')
    assert.equal(result.resourceResponses.some(entry => entry.url.endsWith('/quota-error.png') && entry.ok), true)
    assert.equal(result.apiResponses.filter(entry => entry.method === 'POST' && entry.responseBody?.code === 800003).length, 1)
    assert.notEqual(JSON.stringify(submittedPayloads[0]), JSON.stringify(submittedPayloads[1]), 'second attempt must fill fresh answers')
  }
  assert.ok(result.artifacts.every(({ stepId }) => stepId === SCRIPT_ID))
  assert.ok(result.artifacts.every(({ absolutePath }) => absolutePath.startsWith(`${expectedAttemptDirectory}/`)))
}

test('registered production entry uses formId for public GET, validation, submission and result', async (t) => {
  await runPublicSubmissionFixture(t)
})

test('public submission remains compatible with a passive agreement, rich feedback, promotion and additive settings contract', async (t) => {
  await runPublicSubmissionFixture(t, { withSettings: true })
})

test('second complete public filling is blocked by saved quota while preserving the first successful record', async (t) => {
  await runPublicSubmissionFixture(t, { withSettings: true, withQuota: true })
})

test('an unexpectedly accepted second submission records a failed quota assertion without retrying', async (t) => {
  await runPublicSubmissionFixture(t, { withSettings: true, withQuota: true, acceptsSecondSubmission: true })
})
