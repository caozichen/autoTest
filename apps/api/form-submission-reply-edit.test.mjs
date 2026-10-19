import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

import {
  DEFAULT_REQUEST_PATH,
  buildDetailUrl,
  inspectMutationResponse,
  isSubmissionMutation,
  normalizeRequestPath,
  parseSubmissionAssertions,
  parseSubmissionEditValues,
  resolveSubmissionContext,
  run,
  submissionAnswerSnapshot,
  assertSubmissionAnswersPreserved,
  detailAnswersSnapshot,
} from '../../scripts/form-submission-reply-edit.ui.spec.mjs'
import { runWithAssertionRecorder } from '../../scripts/support/recorded-expect.mjs'
import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'

test('reads actual matrix cells for the current Chinese, Hong Kong and English detail buttons', async () => {
  const browser = await launchGoogleChrome()
  try {
    const page = await browser.newPage()
    for (const label of ['点击查看', '按一下查看', 'Click to view']) {
      await page.setContent(`<div class="reply-kv__row"><span class="reply-kv__label">矩阵题</span>
        <div class="reply-kv__value"><button class="reply-kv__matrix-view">${label}</button></div></div>
        <div class="reply-kv__row"><span class="reply-kv__label">附件</span>
        <div class="reply-kv__value"><a href="https://files.test/report.pdf?signature=rotating">report.pdf</a></div></div>
        <div class="arco-modal" style="display:none"><button class="arco-modal-close-btn">关闭</button>
        <table><tr><th>项目</th><th>答案</th></tr><tr><td>A</td><td>保留的矩阵答案</td></tr></table></div>
        <script>(() => {
          const modal = document.querySelector('.arco-modal')
          document.querySelector('.reply-kv__matrix-view').onclick = () => { modal.style.display = 'block' }
          document.querySelector('.arco-modal-close-btn').onclick = () => { modal.style.display = 'none' }
        })()</script>`)
      const snapshot = await detailAnswersSnapshot(page)
      assert.deepEqual(snapshot[0].matrix, [['项目', '答案'], ['A', '保留的矩阵答案']])
      assert.deepEqual(snapshot[1].files, [{ name: 'report.pdf', href: 'https://files.test/report.pdf' }])
      assert.equal(await page.locator('.arco-modal:visible').count(), 0)
    }
  } finally { await browser.close() }
})

test('historical answer snapshots preserve matrix cells, upload identities and immutable items by item_key', () => {
  const context = { formId: 'form-history', submissionId: 'submission-v1' }
  const payload = { code: 0, data: {
    submission: { id: context.submissionId, form_id: context.formId, revision_no: 1 },
    items: [
      { item_key: 'text', type_code: 'input', label: '单行输入', revision_no: 1, value: [{ id: 1, answer_item_key: 'text', answer: { value: '旧答案' } }] },
      { item_key: 'matrix', type_code: 'matrix', label: '矩阵', revision_no: 1, value: [{ answer_item_key: 'matrix', answer: { row1: { col1: 'A', col2: 'B' } } }] },
      { item_key: 'upload', type_code: 'fileUpload', label: '附件', revision_no: 1, value: [{ answer_item_key: 'upload', answer: { id: 42, url: 'https://files.test/a.pdf?signature=old' } }] },
      { item_key: 'system', item_kind: 'system', type_code: 'input', label: '系统字段', revision_no: 1, value: [] },
    ],
  } }
  const before = submissionAnswerSnapshot(payload, context)
  const renewed = structuredClone(payload)
  renewed.data.items[0].value[0].id = 999
  renewed.data.items[2].value[0].answer.url = 'https://files.test/a.pdf?signature=new'
  assert.deepEqual(submissionAnswerSnapshot(renewed, context), before)
  const edited = structuredClone(renewed)
  edited.data.items[0].value[0].answer.value = '新答案'
  assertSubmissionAnswersPreserved(before, submissionAnswerSnapshot(edited, context), { '单行输入': '新答案' })
  for (const mutate of [
    p => { p.data.items[1].value[0].answer.row1.col2 = '丢失内容' },
    p => { p.data.items[2].value[0].answer.id = 88 },
    p => { p.data.items[2].value[0].answer.url = 'https://files.test/other.pdf' },
  ]) {
    const invalid = structuredClone(payload)
    mutate(invalid)
    assert.throws(() => assertSubmissionAnswersPreserved(before, submissionAnswerSnapshot(invalid, context)), /答案必须保持|答案不得变化/)
  }
  const wrongVersion = structuredClone(payload)
  wrongVersion.data.items[0].revision_no = 2
  assert.throws(() => submissionAnswerSnapshot(wrongVersion, context), /提报原版本/)
  assert.throws(() => assertSubmissionAnswersPreserved(before, before, { '系统字段': '不允许修改' }), /不得修改系统字段/)
  assert.throws(() => assertSubmissionAnswersPreserved(before, before, { '附件': '不允许修改' }), /付款、上传、签名和矩阵必须保留/)
})

function createScreenshotArtifactWriter(captures) {
  return {
    async captureScreenshot(page, relativePath, options) {
      const artifact = {
        executionId: 'run-record-001',
        stepId: 'form-submission-reply-edit',
        attemptId: 'attempt-001',
        absolutePath: `/tmp/autotest-artifacts/run-record-001/form-submission-reply-edit/attempt-001/${relativePath}`,
        relativePath,
        type: 'screenshot',
        mimeType: 'image/png',
        sizeBytes: 128,
        createdAt: '2026-09-04T08:00:00.000Z',
      }
      captures.push({ page, relativePath, options, artifact })
      return artifact
    },
  }
}

function fakeResponse(method, url) {
  return {
    request: () => ({ method: () => method }),
    url: () => url,
  }
}

function sendJson(response, body) {
  response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

function sendHtml(response, html) {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end(html)
}

function mockReplyPageHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>Mock submission reply</title></head>
<body>
  <main id="app"></main>
  <script>
    const app = document.querySelector('#app')
    const state = { username: '初始值', groupUsername: '题组姓名' }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      })[character])
    }

    function shell(content, actions) {
      app.innerHTML = [
        '<h2>活动提报详情</h2>',
        '<p>提報 ID：lpXAWZ</p>',
        '<span>已提交</span>',
        '<h3>提報資訊</h3>',
        content,
        actions,
      ].join('')
    }

    function renderDetail() {
      shell(
        '<section class="reply-kv__row"><span class="reply-kv__label">备注</span>' +
          '<span class="reply-kv__value">姓名</span></section>' +
          '<section class="reply-kv__row"><span class="reply-kv__label">姓名</span>' +
          '<span class="reply-kv__value">' + escapeHtml(state.username) + '</span></section>' +
          '<section class="reply-kv__row"><span class="reply-kv__label">姓名</span>' +
          '<span class="reply-kv__value">' + escapeHtml(state.groupUsername) + '</span></section>',
        '<button id="edit" type="button">編輯</button>',
      )
      document.querySelector('#edit').onclick = renderEdit
    }

    function renderEdit() {
      shell(
        '<section class="fb-p-4 fb-px-6"><div class="fb-runtime-field-heading">姓名</div>' +
          '<input placeholder="請輸入姓名" value="' + escapeHtml(state.username) + '"></section>' +
          '<section class="fb-p-4 fb-px-6"><div class="fb-runtime-field-heading">姓名</div>' +
          '<input placeholder="請輸入姓名" value="' + escapeHtml(state.groupUsername) + '"></section>',
        '<button id="cancel" type="button">取消編輯</button>' +
          '<button id="submit" type="button">提交</button>',
      )
      document.querySelector('#cancel').onclick = renderDetail
      document.querySelector('#submit').onclick = async () => {
        const username = document.querySelector('input').value
        const response = await fetch('/api/be/form/lg2bkk/submission/lpXAWZ', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: localStorage.getItem('token') || '',
          },
          body: JSON.stringify({ answers: { username } }),
        })
        const body = await response.json()
        if (response.ok && Number(body.code) === 0) {
          state.username = username
          renderDetail()
        }
      }
    }

    renderDetail()
  </script>
</body>
</html>`
}

test('parses the default detail path, linked identifiers, assertions, and edit values', () => {
  assert.equal(
    DEFAULT_REQUEST_PATH,
    '/form-activity/submission/preview/reply/lpXAWZ?fid=lg2bkk',
  )
  const detailUrl = buildDetailUrl('https://example.test/base', DEFAULT_REQUEST_PATH)
  assert.equal(
    detailUrl,
    'https://example.test/form-activity/submission/preview/reply/lpXAWZ?fid=lg2bkk',
  )
  assert.deepEqual(resolveSubmissionContext(detailUrl), {
    submissionId: 'lpXAWZ',
    formId: 'lg2bkk',
  })
  const overrideDetailUrl = buildDetailUrl(
    'https://example.test/base',
    '/form-activity/submission/preview/reply/submission-override?fid=form-override',
  )
  assert.deepEqual(resolveSubmissionContext(overrideDetailUrl, {
    SUBMISSION_ID: 'submission-override',
    FORM_ID: 'form-override',
  }), {
    submissionId: 'submission-override',
    formId: 'form-override',
  })
  assert.throws(() => resolveSubmissionContext(detailUrl, {
    SUBMISSION_ID: 'different-submission',
  }), /SUBMISSION_ID.*不一致/)
  assert.throws(() => resolveSubmissionContext(detailUrl, {
    FORM_ID: 'different-form',
  }), /FORM_ID.*不一致/)

  assert.deepEqual(parseSubmissionAssertions('{}'), {
    title: '',
    status: '',
    texts: [],
    fields: [],
    editFields: [],
    configuredAssertionCount: 0,
  })
  assert.deepEqual(
    parseSubmissionAssertions('{"editFields":["姓名[2]"]}').editFields,
    [{ label: '姓名[2]' }],
  )
  assert.deepEqual(parseSubmissionAssertions(JSON.stringify({
    title: '活动提报详情',
    status: '已提交',
    texts: ['提報資訊'],
    fields: { '姓名[1]': '初始姓名', 年龄: 18 },
    editFields: { '姓名[2]': '题组姓名' },
  })), {
    title: '活动提报详情',
    status: '已提交',
    texts: ['提報資訊'],
    fields: [
      { label: '姓名[1]', expectedText: '初始姓名' },
      { label: '年龄', expectedText: '18' },
    ],
    editFields: [{ label: '姓名[2]', expectedValue: '题组姓名' }],
    configuredAssertionCount: 6,
  })
  assert.deepEqual(parseSubmissionEditValues('{"姓名[2]":"修改姓名","年龄":19}'), {
    '姓名[2]': '修改姓名',
    年龄: '19',
  })
})

test('rejects unsafe paths and malformed variable JSON', () => {
  assert.equal(
    normalizeRequestPath(' form-activity/submission/preview/reply/id?fid=form '),
    '/form-activity/submission/preview/reply/id?fid=form',
  )
  assert.throws(() => normalizeRequestPath('https://other.example.test/reply/id'), /必须是相对路径/)
  assert.throws(() => normalizeRequestPath('/\\other.example.test/reply/id'), /不能包含反斜杠/)
  assert.throws(() => parseSubmissionAssertions('{not-json}'), /不是有效 JSON/)
  assert.throws(
    () => parseSubmissionAssertions('{"texts":"not-an-array"}'),
    /必须是字符串数组/,
  )
  assert.throws(
    () => parseSubmissionEditValues('{"姓名":{"nested":true}}'),
    /必须是字符串、数字或布尔值/,
  )
  assert.throws(
    () => parseSubmissionEditValues('{"姓名[0]":"无效序号"}'),
    /序号必须是从 1 开始的整数/,
  )
})

test('matches same-origin submission mutations and rejects reads or cross-origin responses', () => {
  const context = {
    origin: 'https://example.test',
    formId: 'lg2bkk',
    submissionId: 'lpXAWZ',
  }
  assert.equal(isSubmissionMutation(
    fakeResponse('PUT', 'https://example.test/api/be/form/lg2bkk/submission/lpXAWZ'),
    context,
  ), true)
  assert.equal(isSubmissionMutation(
    fakeResponse('PATCH', 'https://example.test/api/submission/update'),
    context,
  ), false)
  assert.equal(isSubmissionMutation(
    fakeResponse('GET', 'https://example.test/api/be/form/lg2bkk/submission/lpXAWZ'),
    context,
  ), false)
  assert.equal(isSubmissionMutation(
    fakeResponse('PUT', 'https://other.example.test/api/be/form/lg2bkk/submission/lpXAWZ'),
    context,
  ), false)
})

test('does not report successful editing when the mutation response body is unavailable', async () => {
  const assertions = []
  const outcome = await runWithAssertionRecorder(
    'form-submission-reply-edit',
    (assertion) => assertions.push(assertion),
    () => inspectMutationResponse({
      ok: () => true,
      status: () => 200,
      text: async () => { throw new Error('body released after navigation') },
    }),
  )

  assert.deepEqual(outcome, { body: null, succeeded: false })
  assert.equal(assertions.filter((assertion) => assertion.status === 'failed').length, 1)
})

test('edits a local submission reply through Google Chrome and restores the detail state', async () => {
  const mutations = []
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    if (request.method === 'PUT' && url.pathname === '/api/be/form/lg2bkk/submission/lpXAWZ') {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      mutations.push({
        authorization: request.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'),
      })
      sendJson(response, {
        code: 0,
        message: 'editSaveSuccess',
        data: { submission_id: 'lpXAWZ' },
      })
      return
    }
    sendHtml(response, mockReplyPageHtml())
  })

  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const origin = `http://127.0.0.1:${address.port}`
    const logs = []
    const apiResponses = []
    const result = await run({
      siteBaseUrl: `${origin}/`,
      apiBaseUrl: `${origin}/api`,
      extraHTTPHeaders: { Authorization: 'Bearer reply-edit-token' },
      variables: {
        SUBMISSION_ASSERTIONS: JSON.stringify({
          title: '活动提报详情',
          status: '已提交',
          texts: ['提報資訊'],
          fields: { '姓名[1]': '初始值' },
          editFields: { '姓名[1]': '初始值' },
        }),
        SUBMISSION_EDIT_VALUES: JSON.stringify({ '姓名[1]': '修改后的姓名' }),
      },
      logger: (level, message, details) => logs.push({ level, message, details }),
      recordApiResponse: (entry) => apiResponses.push(entry),
    })

    assert.deepEqual(result, {
      submissionId: 'lpXAWZ',
      formId: 'lg2bkk',
      detailUrl: `${origin}${DEFAULT_REQUEST_PATH}`,
      submitted: true,
      appliedEditFields: ['姓名[1]'],
      configuredAssertionCount: 5,
      updateResponse: {
        code: 0,
        message: 'editSaveSuccess',
        data: { submission_id: 'lpXAWZ' },
      },
      submissionAssertions: {
        title: '活动提报详情', status: '已提交', texts: ['提報資訊'],
        fields: { '姓名[1]': '初始值' }, editFields: { '姓名[1]': '初始值' },
      },
      updateRequestCount: 1, createRequestCount: 0, reloaded: false,
    })
    assert.deepEqual(mutations, [{
      authorization: 'Bearer reply-edit-token',
      body: { answers: { username: '修改后的姓名' } },
    }])
    const updateApiResponse = apiResponses.find((entry) => entry.method === 'PUT')
    assert.deepEqual(updateApiResponse?.requestBody, {
      answers: { username: '修改后的姓名' },
    })
    assert.deepEqual(updateApiResponse?.responseBody, result.updateResponse)
    assert.ok(logs.some((log) => (
      log.level === 'success' && log.message.includes('页面恢复详情态')
    )))
  } finally {
    await new Promise((resolvePromise, rejectPromise) => {
      server.close((error) => error ? rejectPromise(error) : resolvePromise())
    })
  }
})

test('records a configured detail-field assertion failure and still submits the edit', async () => {
  let mutationCount = 0
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    if (request.method === 'PUT' && url.pathname === '/api/be/form/lg2bkk/submission/lpXAWZ') {
      mutationCount += 1
      sendJson(response, { code: 0, data: {} })
      return
    }
    sendHtml(response, mockReplyPageHtml())
  })

  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const origin = `http://127.0.0.1:${address.port}`
    const screenshotCaptures = []
    const logs = []
    const assertions = []
    const runScenario = (overrides = {}) => run({
      siteBaseUrl: `${origin}/`,
      apiBaseUrl: `${origin}/api`,
      extraHTTPHeaders: { Authorization: 'Bearer reply-edit-token' },
      variables: {
        SUBMISSION_ASSERTIONS: JSON.stringify({ fields: { 姓名: '姓名' } }),
        SUBMISSION_EDIT_VALUES: JSON.stringify({ '姓名[1]': '断言失败后仍提交的姓名' }),
      },
      logger: (level, message, details) => logs.push({ level, message, details }),
      ...overrides,
    })
    const result = await runWithAssertionRecorder(
      'form-submission-reply-edit',
      (assertion) => assertions.push(assertion),
      () => runScenario({ artifactWriter: createScreenshotArtifactWriter(screenshotCaptures) }),
    )

    assert.equal(result.submitted, true)
    assert.deepEqual(result.appliedEditFields, ['姓名[1]'])
    assert.equal(mutationCount, 1)
    assert.equal(screenshotCaptures.length, 0)
    const failedAssertionIndex = assertions.findIndex((assertion) => (
      assertion.status === 'failed'
      && assertion.name.includes('提报详情应唯一显示字段“姓名”')
    ))
    const completedAssertionIndex = assertions.findIndex((assertion) => (
      assertion.status === 'passed'
      && assertion.name.includes('提交成功后详情态字段“姓名[1]”应回显修改值')
    ))
    assert.ok(failedAssertionIndex >= 0)
    assert.ok(completedAssertionIndex > failedAssertionIndex)
    assert.ok(logs.some((log) => (
      log.level === 'success' && log.message.includes('页面恢复详情态')
    )))
  } finally {
    await new Promise((resolvePromise, rejectPromise) => {
      server.close((error) => error ? rejectPromise(error) : resolvePromise())
    })
  }
})
