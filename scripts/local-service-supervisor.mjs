import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SUPERVISOR_HOST = '127.0.0.1'
const SUPERVISOR_PORT = 4311
const SUPERVISOR_ORIGIN = `http://${SUPERVISOR_HOST}:${SUPERVISOR_PORT}`
const WEB_URL = 'http://127.0.0.1:5174/'
const RUNNER_HEALTH_URL = 'http://127.0.0.1:4310/health'
const CONTROL_HEADER = 'x-autotest-control'
const CONTROL_HEADER_VALUE = 'start-runner'
const ALLOWED_ORIGINS = new Set([
  'http://127.0.0.1:5174',
  'http://localhost:5174',
])
const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const WORKSPACE_DIRECTORY = resolve(SCRIPT_DIRECTORY, '..')
const WEB_DIRECTORY = resolve(WORKSPACE_DIRECTORY, 'apps', 'web')
const API_DIRECTORY = resolve(WORKSPACE_DIRECTORY, 'apps', 'api')
const VITE_ENTRY = resolve(WORKSPACE_DIRECTORY, 'node_modules', 'vite', 'bin', 'vite.js')

function wait(delayMs) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs))
}

export function createServiceStarter({
  name,
  isHealthy,
  startProcess,
  waitForDelay = wait,
  pollIntervalMs = 100,
  pollAttempts = 50,
}) {
  let pendingStart = null

  async function startService() {
    if (await isHealthy()) return { status: 'already-running' }

    const pid = startProcess()
    for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
      if (await isHealthy()) return { status: 'started', ...(pid ? { pid } : {}) }
      if (attempt < pollAttempts - 1) await waitForDelay(pollIntervalMs)
    }
    throw new Error(`${name} 启动命令已执行，但健康检查未在 5 秒内通过`)
  }

  return {
    async start() {
      if (pendingStart) return pendingStart
      pendingStart = startService()
      try {
        return await pendingStart
      } finally {
        pendingStart = null
      }
    },
  }
}

async function isHealthy(url, timeoutMs = 1_000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json, text/html' },
      signal: controller.signal,
    })
    if (!response.ok) return false
    if (url !== RUNNER_HEALTH_URL) return true
    const body = await response.json().catch(() => null)
    return body?.ok === true
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

function isLoopbackRequest(request) {
  const address = request.socket.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function requestOrigin(request) {
  const origin = request.headers.origin
  return typeof origin === 'string' && ALLOWED_ORIGINS.has(origin) ? origin : ''
}

function sendJson(request, response, statusCode, body) {
  const origin = requestOrigin(request)
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
  })
  response.end(JSON.stringify(body))
}

export function startSupervisor() {
  let managedWeb = null
  let managedRunner = null
  let stopping = false

  function trackProcess(name, child, onExit) {
    child.once('error', (error) => {
      console.error(`[supervisor] ${name} 进程错误: ${error.message}`)
    })
    child.once('exit', (code, signal) => {
      onExit()
      if (!stopping) {
        console.warn(`[supervisor] ${name} 已退出 (code=${code ?? 'null'}, signal=${signal ?? 'none'})`)
      }
    })
    return child.pid
  }

  const webStarter = createServiceStarter({
    name: 'Web',
    isHealthy: () => isHealthy(WEB_URL),
    startProcess: () => {
      if (managedWeb?.exitCode === null) managedWeb.kill()
      const child = spawn(process.execPath, [VITE_ENTRY, '--host', '127.0.0.1'], {
        cwd: WEB_DIRECTORY,
        env: process.env,
        stdio: 'inherit',
      })
      managedWeb = child
      return trackProcess('Web', child, () => {
        if (managedWeb === child) managedWeb = null
      })
    },
  })

  const runnerStarter = createServiceStarter({
    name: 'Runner',
    isHealthy: () => isHealthy(RUNNER_HEALTH_URL),
    startProcess: () => {
      if (managedRunner?.exitCode === null) managedRunner.kill()
      const child = spawn(process.execPath, ['--watch', 'server.mjs'], {
        cwd: API_DIRECTORY,
        env: process.env,
        stdio: 'inherit',
      })
      managedRunner = child
      return trackProcess('Runner', child, () => {
        if (managedRunner === child) managedRunner = null
      })
    },
  })

  const server = createServer((request, response) => {
    const origin = request.headers.origin
    if (!isLoopbackRequest(request) || (origin && !requestOrigin(request))) {
      sendJson(request, response, 403, { ok: false, error: 'Supervisor 仅允许本地 AutoTest 页面调用' })
      return
    }

    if (request.method === 'OPTIONS') {
      const allowedOrigin = requestOrigin(request)
      if (!allowedOrigin) {
        sendJson(request, response, 403, { ok: false, error: '跨域来源未获授权' })
        return
      }
      response.writeHead(204, {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Headers': 'Content-Type, X-Autotest-Control',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      })
      response.end()
      return
    }

    const pathname = new URL(request.url ?? '/', SUPERVISOR_ORIGIN).pathname
    if (request.method === 'GET' && pathname === '/health') {
      sendJson(request, response, 200, { ok: true, service: 'autotest-local-supervisor' })
      return
    }
    if (request.method === 'POST' && pathname === '/runner/start') {
      if (request.headers[CONTROL_HEADER] !== CONTROL_HEADER_VALUE) {
        sendJson(request, response, 403, { ok: false, error: 'Runner 启动请求未通过本地安全校验' })
        return
      }
      void runnerStarter.start()
        .then((result) => sendJson(request, response, 200, { ok: true, ...result }))
        .catch((error) => sendJson(request, response, 503, {
          ok: false,
          error: error instanceof Error ? error.message : 'Runner 启动失败',
        }))
      return
    }
    sendJson(request, response, 404, { ok: false, error: 'Supervisor 接口不存在' })
  })

  const webMonitor = setInterval(() => {
    if (!stopping) void webStarter.start().catch((error) => {
      console.error(`[supervisor] Web 自动恢复失败: ${error.message}`)
    })
  }, 3_000)
  webMonitor.unref()

  function shutdown(signal) {
    if (stopping) return
    stopping = true
    console.log(`[supervisor] 收到 ${signal}，停止托管服务`)
    clearInterval(webMonitor)
    if (managedWeb?.exitCode === null) managedWeb.kill()
    if (managedRunner?.exitCode === null) managedRunner.kill()
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 2_000).unref()
  }

  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.log(`[supervisor] ${SUPERVISOR_ORIGIN} 已有 Supervisor 运行`)
      process.exit(0)
    }
    throw error
  })
  server.listen(SUPERVISOR_PORT, SUPERVISOR_HOST, () => {
    console.log(`[supervisor] 本地服务管理器: ${SUPERVISOR_ORIGIN}`)
    void Promise.allSettled([webStarter.start(), runnerStarter.start()])
  })

  return server
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startSupervisor()
}
