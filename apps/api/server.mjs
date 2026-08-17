import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { executeRegisteredScript, validateRunRequest } from './script-runner.mjs'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 4310
const allowedOrigins = new Set([
  'http://127.0.0.1:5174',
  'http://localhost:5174',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
])
const RUN_SNAPSHOT_TTL_MS = 5 * 60 * 1000
const DEFAULT_CANCELLATION_REASON = '用户强制停止运行'
const DEFAULT_CANCELLATION_WAIT_TIMEOUT_MS = 3_500

function requestPath(requestUrl) {
  return new URL(requestUrl || '/', 'http://runner.local').pathname
}

function liveRunSnapshot(run) {
  const interrupted = run.status === 'interrupted'
  return {
    runId: run.runId,
    scriptId: run.scriptId,
    status: run.status,
    durationMs: run.result?.durationMs ?? Math.round(performance.now() - run.startedAt),
    logs: run.result?.logs ?? run.logs,
    ...(run.result?.result ? { result: run.result.result } : {}),
    ...(run.result?.error || run.cancellationReason
      ? { error: run.result?.error ?? run.cancellationReason }
      : {}),
    ...(run.result ? { ok: run.result.ok } : interrupted ? { ok: false } : {}),
    ...(run.result?.cancelled || interrupted ? { cancelled: true } : {}),
  }
}

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

function parseCancellationReason(payload) {
  if (payload?.reason === undefined || payload?.reason === null) {
    return DEFAULT_CANCELLATION_REASON
  }
  if (typeof payload.reason !== 'string' || !payload.reason.trim()) {
    throw new Error('停止原因必须是非空字符串')
  }
  const reason = payload.reason.trim()
  if (reason.length > 200) throw new Error('停止原因不能超过 200 个字符')
  return reason
}

export function createRunnerServer({
  executeScript = executeRegisteredScript,
  validateRequest = validateRunRequest,
  runSnapshotTtlMs = RUN_SNAPSHOT_TTL_MS,
  cancellationWaitTimeoutMs = DEFAULT_CANCELLATION_WAIT_TIMEOUT_MS,
} = {}) {
  const activeRuns = new Map()

  function appendRunLog(run, level, message) {
    run.logs.push({
      timestamp: new Date().toISOString(),
      level,
      message,
    })
  }

  function scheduleRunCleanup(run) {
    if (run.cleanupTimer) return
    run.cleanupTimer = setTimeout(() => {
      if (activeRuns.get(run.runId) === run) activeRuns.delete(run.runId)
    }, runSnapshotTtlMs)
    run.cleanupTimer.unref()
  }

  function interruptRuns(runs, reason) {
    const interruptedRuns = []
    for (const run of runs) {
      if (run.status !== 'running') continue
      run.status = 'interrupted'
      run.cancellationReason = reason
      appendRunLog(run, 'warning', `已请求强制停止：${reason}，正在等待浏览器清理`)
      run.abortController.abort(reason)
      scheduleRunCleanup(run)
      interruptedRuns.push(run)
    }
    return interruptedRuns
  }

  async function waitForRunCompletion(run) {
    if (!run.completion) return true
    let timer
    const completed = await Promise.race([
      run.completion.then(() => true, () => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), cancellationWaitTimeoutMs)
      }),
    ])
    clearTimeout(timer)
    if (!completed && !run.cleanupWaitWarningLogged) {
      run.cleanupWaitWarningLogged = true
      appendRunLog(
        run,
        'warning',
        `等待脚本停止清理超过 ${cancellationWaitTimeoutMs} ms，Runner 已返回停止结果`,
      )
    }
    return completed
  }

  async function executeLiveRun(run, payload) {
    try {
      const rawResult = await executeScript(payload, {
        onLog: (log) => run.logs.push(log),
        signal: run.abortController.signal,
      })
      const cancelled = rawResult?.cancelled || run.abortController.signal.aborted
      const result = cancelled
        ? {
            ...rawResult,
            ok: false,
            cancelled: true,
            status: 'interrupted',
            logs: run.logs,
            error: run.cancellationReason ?? rawResult?.error ?? DEFAULT_CANCELLATION_REASON,
          }
        : rawResult
      run.result = result
      run.status = cancelled ? 'interrupted' : result?.ok ? 'passed' : 'failed'
      return { statusCode: 200, responseBody: result }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Runner 请求处理失败'
      const cancelled = run.abortController.signal.aborted
      appendRunLog(
        run,
        cancelled ? 'warning' : 'error',
        cancelled ? `执行已取消：${message}` : `执行失败：${message}`,
      )
      run.result = {
        ok: false,
        ...(cancelled ? { cancelled: true, status: 'interrupted' } : {}),
        durationMs: Math.round(performance.now() - run.startedAt),
        logs: run.logs,
        error: cancelled ? run.cancellationReason ?? message : message,
      }
      run.status = cancelled ? 'interrupted' : 'failed'
      return {
        statusCode: cancelled ? 200 : 400,
        responseBody: cancelled ? run.result : { ok: false, error: message },
      }
    } finally {
      scheduleRunCleanup(run)
    }
  }

  return createServer(async (request, response) => {
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

  const pathname = requestPath(request.url)

  const runCancellationMatch = pathname.match(/^\/runs\/([^/]+)\/cancel$/)
  if (request.method === 'POST' && runCancellationMatch) {
    try {
      const runId = decodeURIComponent(runCancellationMatch[1])
      const run = activeRuns.get(runId)
      if (!run) {
        sendJson(response, 404, { ok: false, error: '运行任务不存在或已过期' }, origin)
        return
      }
      const reason = parseCancellationReason(await readJson(request))
      if (run.status !== 'running') {
        sendJson(response, 409, {
          ok: false,
          error: '运行任务已结束，无法强制停止',
          run: liveRunSnapshot(run),
        }, origin)
        return
      }
      const interruptedRuns = interruptRuns([run], reason)
      const completionStates = await Promise.all(interruptedRuns.map(waitForRunCompletion))
      sendJson(response, 200, {
        ok: true,
        status: 'interrupted',
        cancelledRunIds: interruptedRuns.map((item) => item.runId),
        cleanupTimedOutRunIds: interruptedRuns
          .filter((_, index) => !completionStates[index])
          .map((item) => item.runId),
        runs: interruptedRuns.map(liveRunSnapshot),
      }, origin)
    } catch (error) {
      const message = error instanceof Error ? error.message : '停止运行任务失败'
      sendJson(response, 400, { ok: false, error: message }, origin)
    }
    return
  }

  const scriptCancellationMatch = pathname.match(/^\/scripts\/([^/]+)\/cancel$/)
  if (request.method === 'POST' && scriptCancellationMatch) {
    try {
      const scriptId = decodeURIComponent(scriptCancellationMatch[1])
      const reason = parseCancellationReason(await readJson(request))
      const runs = [...activeRuns.values()].filter((run) => (
        run.scriptId === scriptId && run.status === 'running'
      ))
      if (runs.length === 0) {
        sendJson(response, 404, {
          ok: false,
          error: '该脚本没有正在运行的任务',
          scriptId,
        }, origin)
        return
      }
      const interruptedRuns = interruptRuns(runs, reason)
      const completionStates = await Promise.all(interruptedRuns.map(waitForRunCompletion))
      sendJson(response, 200, {
        ok: true,
        status: 'interrupted',
        cancelledRunIds: interruptedRuns.map((item) => item.runId),
        cleanupTimedOutRunIds: interruptedRuns
          .filter((_, index) => !completionStates[index])
          .map((item) => item.runId),
        runs: interruptedRuns.map(liveRunSnapshot),
      }, origin)
    } catch (error) {
      const message = error instanceof Error ? error.message : '停止脚本运行失败'
      sendJson(response, 400, { ok: false, error: message }, origin)
    }
    return
  }

  if (request.method === 'GET' && pathname.startsWith('/runs/')) {
    const runId = decodeURIComponent(pathname.slice('/runs/'.length))
    const run = activeRuns.get(runId)
    if (!run) {
      sendJson(response, 404, { ok: false, error: '运行任务不存在或已过期' }, origin)
      return
    }
    sendJson(response, 200, liveRunSnapshot(run), origin)
    return
  }

  if (request.method === 'POST' && request.url === '/runs') {
    let liveRun = null
    try {
      const payload = await readJson(request)
      const runId = typeof payload?.runId === 'string' && payload.runId.trim()
        ? payload.runId.trim()
        : randomUUID()
      if (!/^[a-zA-Z0-9_-]{8,100}$/.test(runId)) {
        throw new Error('运行任务 ID 格式无效')
      }
      if (activeRuns.has(runId)) {
        throw new Error('运行任务 ID 已存在')
      }
      const context = validateRequest(payload)
      const abortController = new AbortController()
      liveRun = {
        runId,
        scriptId: context.scriptId,
        status: 'running',
        startedAt: performance.now(),
        logs: [],
        result: null,
        abortController,
        cancellationReason: null,
        completion: null,
        cleanupTimer: null,
        cleanupWaitWarningLogged: false,
      }
      activeRuns.set(runId, liveRun)
      liveRun.completion = executeLiveRun(liveRun, payload)
      const outcome = await liveRun.completion
      sendJson(response, outcome.statusCode, outcome.responseBody, origin)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Runner 请求处理失败'
      sendJson(response, 400, { ok: false, error: message }, origin)
    }
    return
  }

  sendJson(response, 404, { error: '接口不存在' }, origin)
  })
}

const isMainModule = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url

if (isMainModule) {
  const host = DEFAULT_HOST
  const port = Number(process.env.AUTOTEST_RUNNER_PORT || DEFAULT_PORT)
  const server = createRunnerServer()
  server.listen(port, host, () => {
    console.log(`[runner] Playwright runner: http://${host}:${port}`)
  })
}
