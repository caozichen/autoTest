import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

import { run } from '../../scripts/form-contact-publish.api.spec.mjs'

const systemItems = [
  'duration',
  'device',
  'os',
  'browser',
  'region',
  'ip',
  'lingxi_openid',
  'team_openid',
].map((itemKey) => ({ item_key: itemKey, type_code: 'input' }))

function sendJson(response, body) {
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

async function readJson(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

test('executes the API-only form draft, contact collection, publish and list flow', async () => {
  const requests = []
  let items = []
  let title = ''
  let contactCollectMode = {}
  let published = false

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    const body = ['POST', 'PUT'].includes(request.method) ? await readJson(request) : null
    requests.push({ method: request.method, path: url.pathname, query: url.searchParams, body })
    assert.equal(request.headers.authorization, 'Bearer integration-token')

    if (request.method === 'GET' && url.pathname === '/api/be/form/category') {
      sendJson(response, { code: 0, data: [{ id: 7, title: '普通表单' }] })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/be/form') {
      title = body.title
      sendJson(response, { code: 0, data: { id: 101, form_code: 'FORM101', current_revision_no: 1 } })
      return
    }
    if (request.method === 'PUT' && url.pathname === '/api/be/form/101/items') {
      title = body.title
      items = body.items
      sendJson(response, { code: 0, data: { revision_no: 1 } })
      return
    }
    if (request.method === 'PUT' && url.pathname === '/api/be/form/101/config') {
      contactCollectMode = body.submitted_config.contact_collect_mode
      sendJson(response, { code: 0, data: { revision_no: 1 } })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/be/form/101/publish') {
      published = true
      sendJson(response, { code: 0, data: { id: 101 } })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/be/form/101') {
      sendJson(response, {
        code: 0,
        data: {
          form: {
            title,
            status: published ? 'published' : 'draft',
            submitted_config: { contact_collect_mode: contactCollectMode },
          },
          items: [...items, ...systemItems],
        },
      })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/be/form/list') {
      sendJson(response, { code: 0, data: { list: [{ id: 101, title, status: 'published' }] } })
      return
    }

    response.writeHead(404)
    response.end()
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const logs = []
    const result = await run({
      apiBaseUrl: `http://127.0.0.1:${address.port}/api`,
      ignoreHTTPSErrors: false,
      extraHTTPHeaders: { Authorization: 'Bearer integration-token' },
      logger: (level, message, details) => logs.push({ level, message, details }),
    })

    assert.equal(result.formId, '101')
    assert.equal(result.status, 'published')
    assert.match(result.title, /^自动化测试表单-\d+$/)
    assert.equal(requests.length, 8)
    assert.equal(requests.at(-1).query.get('filter[status]'), 'published')
    assert.equal(requests.at(-1).query.get('filter[title]'), result.title)
    assert.equal(contactCollectMode.enabled, 1)
    assert.equal(contactCollectMode.selected, 'ignore')
    assert.deepEqual(items.map((item) => item.common_config.collect_to_contact.anchor), ['username', 'mobile'])
    assert.ok(logs.some((log) => log.level === 'success' && log.message.includes('所有断言通过')))
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
