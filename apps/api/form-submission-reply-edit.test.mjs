import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

import {
  DEFAULT_REQUEST_PATH,
  buildDetailUrl,
  isSubmissionMutation,
  normalizeRequestPath,
  parseSubmissionAssertions,
  parseSubmissionEditValues,
  resolveSubmissionContext,
  run,
} from '../../scripts/form-submission-reply-edit.ui.spec.mjs'

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

test('does not submit when a configured detail-field assertion fails', async () => {
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
    await assert.rejects(run({
      siteBaseUrl: `${origin}/`,
      apiBaseUrl: `${origin}/api`,
      extraHTTPHeaders: { Authorization: 'Bearer reply-edit-token' },
      variables: {
        SUBMISSION_ASSERTIONS: JSON.stringify({ fields: { 姓名: '姓名' } }),
        SUBMISSION_EDIT_VALUES: JSON.stringify({ '姓名[1]': '不应提交的姓名' }),
      },
      captureFailureScreenshot: false,
      logger: () => undefined,
    }), /提报详情应唯一显示字段“姓名”/)
    assert.equal(mutationCount, 0)
  } finally {
    await new Promise((resolvePromise, rejectPromise) => {
      server.close((error) => error ? rejectPromise(error) : resolvePromise())
    })
  }
})
