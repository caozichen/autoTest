import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

import {
  inspectBusinessResponse,
  run,
} from '../../scripts/form-contact-publish.ui.spec.mjs'
import { runWithAssertionRecorder } from '../../scripts/support/recorded-expect.mjs'

function createScreenshotArtifactWriter(captures) {
  return {
    async captureScreenshot(page, relativePath, options) {
      const artifact = {
        executionId: 'run-record-001',
        stepId: 'form-contact-publish',
        attemptId: 'attempt-001',
        absolutePath: `/tmp/autotest-artifacts/run-record-001/form-contact-publish/attempt-001/${relativePath}`,
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

function sendJson(response, body) {
  response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

function sendHtml(response, html) {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end(html)
}

test('records unreadable and invalid business response bodies without stopping later work', async () => {
  const cases = [
    {
      label: '读取失败',
      response: {
        ok: () => true,
        status: () => 200,
        text: async () => { throw new Error('body released after navigation') },
      },
      expectedFailure: '',
      expectedSucceeded: true,
    },
    {
      label: '无效 JSON',
      response: {
        ok: () => true,
        status: () => 200,
        text: async () => '{not-json}',
      },
      expectedFailure: '接口应返回有效 JSON',
      expectedSucceeded: false,
    },
  ]

  for (const fixture of cases) {
    const assertions = []
    let reachedLaterWork = false
    const outcome = await runWithAssertionRecorder(
      'form-contact-publish',
      (assertion) => assertions.push(assertion),
      async () => {
        const inspected = await inspectBusinessResponse(fixture.response, fixture.label)
        reachedLaterWork = true
        return inspected
      },
    )

    assert.equal(reachedLaterWork, true)
    assert.equal(outcome.succeeded, fixture.expectedSucceeded)
    assert.deepEqual(outcome.body, {})
    assert.equal(outcome.bodyValid, false)
    if (fixture.expectedFailure) {
      assert.ok(assertions.some(({ status, name }) => (
        status === 'failed' && name.includes(fixture.expectedFailure)
      )))
    } else {
      assert.equal(outcome.warning, true)
      assert.equal(outcome.incomplete, true)
      assert.equal(outcome.bodyReadError, 'body released after navigation')
      assert.equal(assertions.some(({ status }) => status === 'failed'), false)
    }
  }
})

function mockApplicationHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>Mock form activity</title></head>
<body>
  <main id="app"></main>
  <script>
    const app = document.querySelector('#app')
    const token = () => localStorage.getItem('token') || ''
    const api = (path, options = {}) => fetch('/api' + path, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: token(), ...(options.headers || {}) },
    }).then((response) => response.json())

    function button(text, attrs = '') { return '<button type="button" ' + attrs + '>' + text + '</button>' }

    function render() {
      if (location.pathname === '/form-activity/index') {
        app.innerHTML = '<button id="blank" type="button">从空白表单开始</button>'
        document.querySelector('#blank').onclick = async () => {
          const result = await api('/be/form', { method: 'POST', body: '{}' })
          location.href = '/form-activity/designer?id=' + result.data.id
        }
        return
      }

      if (location.pathname === '/form-activity/designer') {
        app.innerHTML = [
          button('联系人', 'data-component-type="contactGroup" id="contact"'),
          '<h1><div class="editable-div" contenteditable="true">未命名表单</div></h1>',
          '<section id="fields"></section>',
          button('保存草稿', 'aria-label="保存草稿" id="save"'),
          '<div class="form-activity-step-nav"><span class="form-activity-step" id="settings">' +
            '<span class="form-activity-step__text">基础设置</span></span></div>',
          '<header><span>基础设置</span></header>',
          '<div role="dialog" id="collect-dialog"><h2>是否收录联系人</h2>' +
            button('确认收录到联系人', 'id="confirm-collect"') + '</div>',
        ].join('')
        const addContactFields = () => {
          document.querySelector('#fields').innerHTML = ['username', 'mobile', 'email']
            .map((type) => '<div class="form-field" data-component-type="' + type + '"></div>')
            .join('')
        }
        document.querySelector('#contact').onclick = () => {
          addContactFields()
        }
        document.querySelector('#confirm-collect').onclick = () => {
          document.querySelector('#collect-dialog').innerHTML = [
            '<h2>联系人信息替换确认</h2>',
            '<label><input type="radio" name="initial-strategy" value="ignore">忽略，不替换</label>',
            button('确定', 'id="confirm-initial-strategy"'),
          ].join('')
          document.querySelector('#confirm-initial-strategy').onclick = async () => {
            await api('/be/form/101/config', { method: 'PUT', body: JSON.stringify({ selected: 'ignore' }) })
            addContactFields()
            document.querySelector('#collect-dialog').remove()
          }
        }
        document.querySelector('#save').onclick = async () => {
          const id = new URL(location.href).searchParams.get('id')
          const title = document.querySelector('.editable-div').textContent
          await api('/be/form/' + id + '/items', {
            method: 'PUT',
            body: JSON.stringify({ title, items: ['username', 'mobile', 'email'] }),
          })
          await api('/be/form/' + id + '/config', { method: 'PUT', body: '{}' })
          const toast = document.createElement('div')
          toast.textContent = '保存成功'
          app.appendChild(toast)
        }
        document.querySelector('#settings').onclick = () => {
          location.href = '/form-activity/settings?id=101'
        }
        return
      }

      if (location.pathname === '/form-activity/settings') {
        app.innerHTML = [
          button('发布', 'aria-label="发布" id="publish"'),
          button('收录联系人设置', 'data-menu-key="collect-contact" id="contact-settings"'),
          '<section id="contact-panel"></section>',
        ].join('')
        document.querySelector('#contact-settings').onclick = () => {
          document.querySelector('#contact-panel').innerHTML = [
            button('', 'role="switch" aria-label="是否收录联系人开关" aria-checked="true" data-state="checked"'),
            button('编辑', 'aria-label="是否收录联系人" id="edit-contact"'),
            '<div id="strategy"></div>',
          ].join('')
          document.querySelector('#edit-contact').onclick = () => {
            document.querySelector('#strategy').innerHTML = [
              '<label><input type="radio" name="strategy" value="ignore">忽略，不替换</label>',
              button('确认', 'aria-label="确认" id="confirm-contact"'),
            ].join('')
            document.querySelector('#confirm-contact').onclick = async () => {
              await api('/be/form/101/config', { method: 'PUT', body: JSON.stringify({ selected: 'ignore' }) })
              document.querySelector('#strategy').innerHTML = '<span>忽略，不替换</span>'
            }
          }
        }
        document.querySelector('#publish').onclick = async () => {
          await api('/be/form/101/publish', { method: 'POST', body: '{}' })
          location.href = '/form-activity/list'
        }
        return
      }

      if (location.pathname === '/form-activity/list') {
        app.innerHTML = [
          '<span class="form-activity-audit-tabs"><span>已发布</span></span>',
          '<input placeholder="请输入标题">',
          button('查询', 'aria-label="查询" id="search"'),
          '<section id="results"></section>',
        ].join('')
        document.querySelector('#search').onclick = () => {
          const title = document.querySelector('input').value
          document.querySelector('#results').innerHTML = '<a class="form-activity-list__title-link">' + title + '</a>'
        }
      }
    }
    render()
  </script>
</body>
</html>`
}

test('executes the form flow through headless Google Chrome UI with the environment token', async () => {
  const requests = []
  let title = ''
  let published = false
  let strategy = ''
  let forcePublishFailure = false

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    if (!url.pathname.startsWith('/api/be/')) {
      sendHtml(response, mockApplicationHtml())
      return
    }

    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    requests.push({ method: request.method, path: url.pathname, authorization: request.headers.authorization, body })

    if (request.method === 'POST' && url.pathname === '/api/be/form') {
      sendJson(response, { code: 0, data: { id: 101, form_id: 101, form_code: '951000000000000101' } })
      return
    }
    if (request.method === 'PUT' && url.pathname === '/api/be/form/101/items') {
      title = body.title
      assert.deepEqual(body.items, ['username', 'mobile', 'email'])
      sendJson(response, { code: 0, data: {} })
      return
    }
    if (request.method === 'PUT' && url.pathname === '/api/be/form/101/config') {
      strategy = body.selected || strategy
      sendJson(response, { code: 0, data: {} })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/be/form/101') {
      sendJson(response, {
        code: 0,
        data: { form: { id: 101, form_id: 101, form_code: '951000000000000101' } },
      })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/be/form/101/publish') {
      if (forcePublishFailure) {
        response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify({ code: 403001, message: 'mock publish business failure' }))
        return
      }
      published = true
      sendJson(response, {
        code: 0,
        data: {
          form_id: 101,
          form_code: '951000000000000101',
          revision_no: 1,
          status: 'published',
        },
      })
      return
    }
    response.writeHead(404)
    response.end()
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const origin = `http://127.0.0.1:${address.port}`
    const logs = []
    const screenshotCaptures = []
    const artifactWriter = createScreenshotArtifactWriter(screenshotCaptures)
    const runScenario = () => run({
      siteBaseUrl: `${origin}/`,
      apiBaseUrl: `${origin}/api`,
      ignoreHTTPSErrors: false,
      extraHTTPHeaders: { Authorization: 'Bearer integration-token' },
      artifactWriter,
      logger: (level, message, details) => logs.push({ level, message, details }),
    })
    const result = await runScenario()

    assert.equal(screenshotCaptures.length, 0)
    assert.equal(result.formId, '101')
    assert.equal(result.formCode, '')
    assert.equal(result.formContract.formId, '101')
    assert.equal(result.formContract.formCode, '')
    assert.notEqual(result.formContract.formId, '951000000000000101')
    assert.equal(result.status, 'published')
    assert.equal(result.browser, 'chrome')
    assert.equal(result.headless, true)
    assert.deepEqual(result.contactFields, ['username', 'mobile', 'email'])
    assert.match(result.title, /^自动化测试表单-\d+$/)
    assert.equal(title, result.title)
    assert.equal(strategy, 'ignore')
    assert.equal(published, true)
    assert.ok(requests.length >= 5)
    assert.ok(requests.every((request) => request.authorization === 'Bearer integration-token'))
    assert.ok(logs.some((log) => log.level === 'success' && log.message.includes('Chrome 无头 UI 自动化执行完成')))

    forcePublishFailure = true
    const failedAssertions = []
    const continuedResult = await runWithAssertionRecorder(
      'form-contact-publish',
      (assertion) => failedAssertions.push(assertion),
      runScenario,
    )
    assert.equal(continuedResult.status, 'published')
    assert.equal(screenshotCaptures.length, 0)
    const publishFailureIndex = failedAssertions.findIndex(({ status, name }) => (
      status === 'failed' && name.includes('发布表单接口应返回成功 HTTP 状态')
    ))
    const laterListAssertionIndex = failedAssertions.findIndex(({ status, name }) => (
      status === 'passed' && name.includes('已发布列表中应找到本次创建的表单')
    ))
    assert.ok(publishFailureIndex >= 0)
    assert.ok(laterListAssertionIndex > publishFailureIndex)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
