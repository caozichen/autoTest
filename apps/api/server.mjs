import { createServer } from 'node:http'

import { executeRegisteredScript } from './script-runner.mjs'

const host = '127.0.0.1'
const port = Number(process.env.AUTOTEST_RUNNER_PORT || 4310)
const allowedOrigins = new Set([
  'http://127.0.0.1:5174',
  'http://localhost:5174',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
])

function sendJson(response, statusCode, body, origin = '') {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...(allowedOrigins.has(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
  })
  response.end(JSON.stringify(body))
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 1024 * 1024) throw new Error('请求体超过 1 MB 限制')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : null
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin || ''
  if (origin && !allowedOrigins.has(origin)) {
    sendJson(response, 403, { error: 'Runner 仅允许本地 AutoTest 页面调用' })
    return
  }

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      Vary: 'Origin',
    })
    response.end()
    return
  }

  if (request.method === 'GET' && request.url === '/health') {
    sendJson(response, 200, { ok: true, service: 'autotest-playwright-runner' }, origin)
    return
  }

  if (request.method === 'POST' && request.url === '/runs') {
    try {
      const payload = await readJson(request)
      const result = await executeRegisteredScript(payload)
      sendJson(response, 200, result, origin)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Runner 请求处理失败'
      sendJson(response, 400, { ok: false, error: message }, origin)
    }
    return
  }

  sendJson(response, 404, { error: '接口不存在' }, origin)
})

server.listen(port, host, () => {
  console.log(`[runner] Playwright API runner: http://${host}:${port}`)
})
