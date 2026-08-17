import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

import { run } from '../../scripts/form-contact-publish.ui.spec.mjs'

function sendJson(response, body) {
  response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

function sendHtml(response, html) {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end(html)
}

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
      sendJson(response, { code: 0, data: { id: 101 } })
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
    if (request.method === 'POST' && url.pathname === '/api/be/form/101/publish') {
      published = true
      sendJson(response, { code: 0, data: {} })
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
    const result = await run({
      siteBaseUrl: `${origin}/`,
      apiBaseUrl: `${origin}/api`,
      ignoreHTTPSErrors: false,
      extraHTTPHeaders: { Authorization: 'Bearer integration-token' },
      logger: (level, message, details) => logs.push({ level, message, details }),
    })

    assert.equal(result.formId, '101')
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
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
