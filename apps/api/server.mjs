import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { constants as fileSystemConstants } from 'node:fs'
import * as fileSystem from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import { DEFAULT_ARTIFACT_ROOT_DIRECTORY } from './artifact-writer.mjs'
import { RunRecordFileStore, RunRecordStoreError } from './run-record-store.mjs'
import {
  DEFAULT_SCRIPT_CONFIG_DIRECTORY,
  DEFAULT_SCRIPTS_DIRECTORY,
  FileScriptConfigRepository,
  ScriptConfigStoreError,
} from './script-config-repository.mjs'
import { retainScriptRejectionGuard } from './script-rejection-boundary.mjs'
import { executeRegisteredScript, validateRegisteredRunRequest } from './script-runner.mjs'

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
export const DEFAULT_CANCELLATION_WAIT_TIMEOUT_MS = 16_000
const DEFAULT_ARTIFACT_PERSISTENCE_TIMEOUT_MS = 10_000
const DEFAULT_RUN_RECORD_DIRECTORY = fileURLToPath(new URL('../../data/run-records/', import.meta.url))
const DEFAULT_REQUEST_LIMIT_BYTES = 1024 * 1024
export const RUN_RECORD_REQUEST_LIMIT_BYTES = 64 * 1024 * 1024
const RUN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,99}$/
const EXECUTION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/
const ARTIFACT_SCOPE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/
const SCREENSHOT_MIME_TYPES = new Set(['image/png', 'image/jpeg'])
const SCREENSHOT_REVEAL_TIMEOUT_MS = 10_000
const execFileAsync = promisify(execFile)

class RequestBodyTooLargeError extends Error {
  constructor(limitBytes) {
    super(`请求体超过 ${Math.round(limitBytes / 1024 / 1024)} MB 限制`)
    this.name = 'RequestBodyTooLargeError'
    this.statusCode = 413
    this.code = 'REQUEST_BODY_TOO_LARGE'
  }
}

class InvalidJsonBodyError extends Error {
  constructor() {
    super('请求体不是有效 JSON')
    this.name = 'InvalidJsonBodyError'
    this.statusCode = 400
    this.code = 'INVALID_JSON_BODY'
  }
}

class ScreenshotRevealError extends Error {
  constructor(message, { statusCode = 500, code = 'SCREENSHOT_REVEAL_FAILED' } = {}) {
    super(message)
    this.name = 'ScreenshotRevealError'
    this.statusCode = statusCode
    this.code = code
  }
}

export async function revealFileInFolder(
  absolutePath,
  { platform = process.platform, execute = execFileAsync } = {},
) {
  if (platform === 'darwin') {
    await execute('/usr/bin/open', ['-R', absolutePath], {
      timeout: SCREENSHOT_REVEAL_TIMEOUT_MS,
    })
    return
  }
  if (platform === 'win32') {
    await execute('explorer.exe', [`/select,${absolutePath}`], {
      timeout: SCREENSHOT_REVEAL_TIMEOUT_MS,
      windowsHide: true,
    })
    return
  }
  throw new ScreenshotRevealError('当前操作系统暂不支持在文件夹中选中截图', {
    statusCode: 501,
    code: 'SCREENSHOT_REVEAL_UNSUPPORTED',
  })
}

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
    ...(run.result?.assertions ? { assertions: run.result.assertions } : {}),
    ...(run.result?.apiResponses ? { apiResponses: run.result.apiResponses } : {}),
    ...(run.result?.resourceResponses ? { resourceResponses: run.result.resourceResponses } : {}),
    ...(run.result?.networkSummary ? { networkSummary: run.result.networkSummary } : {}),
    ...(run.result?.artifacts ? { artifacts: run.result.artifacts } : {}),
    ...(run.result?.result ? { result: run.result.result } : {}),
    ...(run.result?.error || run.cancellationReason
      ? { error: run.result?.error ?? run.cancellationReason }
      : {}),
    ...(run.result ? { ok: run.result.ok } : interrupted ? { ok: false } : {}),
    ...(run.result?.cancelled || interrupted ? { cancelled: true } : {}),
    ...(run.result?.timedOut === true ? { timedOut: true } : {}),
    ...(run.result?.continuePipeline === true ? { continuePipeline: true } : {}),
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

function screenshotNotFound() {
  return new RunRecordStoreError('截图不存在', {
    statusCode: 404,
    code: 'SCREENSHOT_NOT_FOUND',
  })
}

function assertSafeArtifactScopeId(value, label) {
  if (typeof value !== 'string' || !ARTIFACT_SCOPE_ID_PATTERN.test(value)) {
    throw new RunRecordStoreError(`${label}格式无效`)
  }
  return value
}

function normalizeArtifactRelativePath(value) {
  if (
    typeof value !== 'string'
    || !value
    || value.length > 4_096
    || CONTROL_CHARACTER_PATTERN.test(value)
    || value.includes('\\')
    || isAbsolute(value)
    || value.startsWith('//')
    || /^[a-zA-Z]:/.test(value)
  ) {
    throw new RunRecordStoreError('截图相对路径格式无效')
  }
  const segments = value.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new RunRecordStoreError('截图相对路径格式无效')
  }
  return segments.join('/')
}

function isPathInside(rootPath, targetPath) {
  const relativePath = relative(rootPath, targetPath)
  return Boolean(relativePath)
    && relativePath !== '..'
    && !relativePath.startsWith(`..${sep}`)
    && !isAbsolute(relativePath)
}

function isMissingFileError(error) {
  return ['ENOENT', 'ENOTDIR', 'ELOOP'].includes(error?.code)
}

async function readJson(request, limitBytes = DEFAULT_REQUEST_LIMIT_BYTES) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > limitBytes) throw new RequestBodyTooLargeError(limitBytes)
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    throw new InvalidJsonBodyError()
  }
}

function decodePathSegment(value, label = '运行记录 ID') {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new RunRecordStoreError(`URL 中的${label}编码无效`)
  }
}

function decodeScriptConfigPathSegment(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new ScriptConfigStoreError('URL 中的脚本 ID 编码无效')
  }
}

function parseScreenshotRequest(request, routeMatch) {
  const recordId = decodePathSegment(routeMatch[1])
  const stepId = assertSafeArtifactScopeId(
    decodePathSegment(routeMatch[2], '脚本 ID'),
    '脚本 ID',
  )
  const attemptId = assertSafeArtifactScopeId(
    decodePathSegment(routeMatch[3], '运行尝试 ID'),
    '运行尝试 ID',
  )
  const screenshotPaths = new URL(request.url || '/', 'http://runner.local')
    .searchParams
    .getAll('path')
  if (screenshotPaths.length !== 1) {
    throw new RunRecordStoreError('截图请求必须包含唯一的 path 参数')
  }
  return {
    recordId,
    stepId,
    attemptId,
    relativePath: normalizeArtifactRelativePath(screenshotPaths[0]),
  }
}

function sendRunRecordError(response, error, origin) {
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500
  const message = statusCode >= 500
    ? '运行记录存储失败'
    : error instanceof Error ? error.message : '运行记录请求无效'
  sendJson(response, statusCode, {
    ok: false,
    error: message,
    ...(typeof error?.code === 'string' ? { code: error.code } : {}),
  }, origin)
}

function sendScriptConfigError(response, error, origin) {
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500
  const message = statusCode >= 500
    ? '脚本配置存储失败'
    : error instanceof Error ? error.message : '脚本配置请求无效'
  sendJson(response, statusCode, {
    ok: false,
    error: message,
    ...(typeof error?.code === 'string' ? { code: error.code } : {}),
  }, origin)
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
  executeScript,
  validateRequest,
  revealFile = revealFileInFolder,
  runSnapshotTtlMs = RUN_SNAPSHOT_TTL_MS,
  cancellationWaitTimeoutMs = DEFAULT_CANCELLATION_WAIT_TIMEOUT_MS,
  artifactPersistenceTimeoutMs = DEFAULT_ARTIFACT_PERSISTENCE_TIMEOUT_MS,
  artifactRootDirectory = DEFAULT_ARTIFACT_ROOT_DIRECTORY,
  runRecordDirectory = DEFAULT_RUN_RECORD_DIRECTORY,
  runRecordStore,
  scriptConfigDirectory = DEFAULT_SCRIPT_CONFIG_DIRECTORY,
  scriptsDirectory = DEFAULT_SCRIPTS_DIRECTORY,
  scriptConfigRepository,
} = {}) {
  const activeRuns = new Map()
  const pendingRunCancellations = new Map()
  const pendingExecutionCancellations = new Map()
  const artifactPersistenceDeadlineMs = Number.isFinite(artifactPersistenceTimeoutMs)
    && artifactPersistenceTimeoutMs > 0
    ? Math.max(1, Math.floor(artifactPersistenceTimeoutMs))
    : DEFAULT_ARTIFACT_PERSISTENCE_TIMEOUT_MS
  if (typeof artifactRootDirectory !== 'string' || !artifactRootDirectory.trim()) {
    throw new Error('截图制品根目录必须是非空字符串')
  }
  const trustedArtifactRoot = resolve(artifactRootDirectory)
  const storedRunRecords = runRecordStore ?? new RunRecordFileStore({ directory: runRecordDirectory })
  const storedScriptConfigs = scriptConfigRepository ?? new FileScriptConfigRepository({
    directory: scriptConfigDirectory,
    scriptsDirectory,
  })
  const runValidator = validateRequest ?? ((payload) => validateRegisteredRunRequest(payload, {
    scriptConfigRepository: storedScriptConfigs,
    scriptsDirectory,
  }))
  const scriptExecutor = executeScript ?? ((payload, options) => executeRegisteredScript(payload, {
    ...options,
    artifactRootDirectory: trustedArtifactRoot,
    scriptConfigRepository: storedScriptConfigs,
    scriptsDirectory,
  }))

  function appendRunLog(run, level, message) {
    const log = {
      timestamp: new Date().toISOString(),
      level,
      message,
    }
    run.logs.push(log)
    return log
  }

  function pendingCancellationSnapshot(runId, cancellation) {
    return {
      runId,
      status: 'interrupted',
      ok: false,
      cancelled: true,
      pendingRegistration: true,
      durationMs: 0,
      logs: [{
        timestamp: cancellation.createdAt,
        level: 'warning',
        message: `运行在启动前已请求停止：${cancellation.reason}`,
      }],
      error: cancellation.reason,
    }
  }

  function reserveRunCancellation(runId, reason) {
    const previous = pendingRunCancellations.get(runId)
    if (previous?.cleanupTimer) clearTimeout(previous.cleanupTimer)
    const cancellation = {
      reason,
      createdAt: new Date().toISOString(),
      cleanupTimer: null,
    }
    cancellation.cleanupTimer = setTimeout(() => {
      if (pendingRunCancellations.get(runId) === cancellation) {
        pendingRunCancellations.delete(runId)
      }
    }, runSnapshotTtlMs)
    cancellation.cleanupTimer.unref?.()
    pendingRunCancellations.set(runId, cancellation)
    return cancellation
  }

  function reserveExecutionCancellation(executionId, reason) {
    const previous = pendingExecutionCancellations.get(executionId)
    if (previous?.cleanupTimer) clearTimeout(previous.cleanupTimer)
    const cancellation = {
      reason,
      createdAt: new Date().toISOString(),
      cleanupTimer: null,
    }
    cancellation.cleanupTimer = setTimeout(() => {
      if (pendingExecutionCancellations.get(executionId) === cancellation) {
        pendingExecutionCancellations.delete(executionId)
      }
    }, runSnapshotTtlMs)
    cancellation.cleanupTimer.unref?.()
    pendingExecutionCancellations.set(executionId, cancellation)
    return cancellation
  }

  function takeRunCancellation(runId) {
    const cancellation = pendingRunCancellations.get(runId)
    if (!cancellation) return null
    pendingRunCancellations.delete(runId)
    if (cancellation.cleanupTimer) clearTimeout(cancellation.cleanupTimer)
    return cancellation
  }

  async function persistRunArtifacts(run, result) {
    if (!Array.isArray(result?.artifacts) || result.artifacts.length === 0) return null
    let timeoutId
    const persistence = Promise.resolve().then(() => storedRunRecords.mergeScriptArtifacts(
        run.executionId,
        run.scriptId,
        result.artifacts,
      )).then(
        () => null,
        (error) => error ?? new Error('未知错误'),
      )
    const timeout = new Promise((resolveTimeout) => {
      timeoutId = setTimeout(() => {
        resolveTimeout(new Error(`超过 ${artifactPersistenceDeadlineMs} ms`))
      }, artifactPersistenceDeadlineMs)
      timeoutId.unref?.()
    })
    const error = await Promise.race([persistence, timeout])
    clearTimeout(timeoutId)
    if (!error) return null
    const message = error instanceof Error ? error.message : String(error)
    return appendRunLog(run, 'warning', `运行制品写入历史记录失败：${message}`)
  }

  async function openRegisteredScreenshot(recordId, stepId, attemptId, requestedPath) {
    const record = await storedRunRecords.get(recordId)
    if (!record) throw screenshotNotFound()

    const script = record.scripts.find((item) => item.id === stepId)
    const artifact = script?.artifacts.find((item) => (
      item.executionId === recordId
      && item.stepId === stepId
      && item.attemptId === attemptId
      && item.relativePath === requestedPath
    ))
    if (
      !artifact
      || artifact.type !== 'screenshot'
      || !SCREENSHOT_MIME_TYPES.has(artifact.mimeType)
    ) {
      throw screenshotNotFound()
    }

    const scopeDirectory = resolve(trustedArtifactRoot, recordId, stepId, attemptId)
    const candidatePath = resolve(scopeDirectory, ...requestedPath.split('/'))
    if (!isPathInside(scopeDirectory, candidatePath)) {
      throw new RunRecordStoreError('截图相对路径超出本次执行范围')
    }
    if (typeof artifact.absolutePath !== 'string' || resolve(artifact.absolutePath) !== candidatePath) {
      throw screenshotNotFound()
    }

    let handle
    try {
      const [realArtifactRoot, candidateInfo] = await Promise.all([
        fileSystem.realpath(trustedArtifactRoot),
        fileSystem.lstat(candidatePath),
      ])
      if (!candidateInfo.isFile() || candidateInfo.isSymbolicLink()) throw screenshotNotFound()

      const realCandidatePath = await fileSystem.realpath(candidatePath)
      if (!isPathInside(realArtifactRoot, realCandidatePath)) throw screenshotNotFound()

      handle = await fileSystem.open(
        realCandidatePath,
        fileSystemConstants.O_RDONLY | (fileSystemConstants.O_NOFOLLOW ?? 0),
      )
      const openedInfo = await handle.stat()
      if (!openedInfo.isFile() || openedInfo.size !== artifact.sizeBytes) throw screenshotNotFound()

      return { artifact, handle, absolutePath: realCandidatePath, sizeBytes: openedInfo.size }
    } catch (error) {
      await handle?.close().catch(() => undefined)
      if (error instanceof RunRecordStoreError) throw error
      if (isMissingFileError(error)) throw screenshotNotFound()
      throw error
    }
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
      const rawResult = await scriptExecutor(payload, {
        onLog: (log) => run.logs.push(log),
        signal: run.abortController.signal,
      })
      const explicitlyFailed = rawResult?.status === 'failed' || rawResult?.timedOut === true
      const cancelled = rawResult?.cancelled === true
        || (!explicitlyFailed && run.abortController.signal.aborted)
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
      run.status = cancelled
        ? 'interrupted'
        : result?.timedOut === true
          ? 'failed'
          : ['passed', 'partial', 'failed'].includes(result?.status)
            ? result.status
            : result?.ok ? 'passed' : 'failed'
      const artifactWarning = await persistRunArtifacts(run, result)
      if (artifactWarning && Array.isArray(run.result?.logs) && run.result.logs !== run.logs) {
        run.result = { ...run.result, logs: [...run.result.logs, artifactWarning] }
      }
      return { statusCode: 200, responseBody: run.result }
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
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
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

  if (request.method === 'GET' && pathname === '/script-configs') {
    try {
      const scripts = await storedScriptConfigs.list()
      sendJson(response, 200, { scripts }, origin)
    } catch (error) {
      sendScriptConfigError(response, error, origin)
    }
    return
  }

  if (request.method === 'POST' && pathname === '/script-configs') {
    try {
      const payload = await readJson(request)
      const script = await storedScriptConfigs.create(payload?.script)
      sendJson(response, 201, { script }, origin)
    } catch (error) {
      sendScriptConfigError(response, error, origin)
    }
    return
  }

  const scriptConfigMatch = pathname.match(/^\/script-configs\/([^/]+)$/)
  if (scriptConfigMatch && request.method === 'GET') {
    try {
      const id = decodeScriptConfigPathSegment(scriptConfigMatch[1])
      const script = await storedScriptConfigs.get(id)
      if (!script) {
        sendJson(response, 404, { ok: false, error: '脚本配置不存在' }, origin)
        return
      }
      sendJson(response, 200, { script }, origin)
    } catch (error) {
      sendScriptConfigError(response, error, origin)
    }
    return
  }

  if (scriptConfigMatch && request.method === 'PATCH') {
    try {
      const id = decodeScriptConfigPathSegment(scriptConfigMatch[1])
      const payload = await readJson(request)
      const script = await storedScriptConfigs.update(id, payload?.script, {
        expectedRevision: payload?.expectedRevision,
        expectedUpdatedAt: payload?.expectedUpdatedAt,
      })
      sendJson(response, 200, { script }, origin)
    } catch (error) {
      sendScriptConfigError(response, error, origin)
    }
    return
  }

  if (scriptConfigMatch && request.method === 'DELETE') {
    try {
      const id = decodeScriptConfigPathSegment(scriptConfigMatch[1])
      const payload = await readJson(request)
      await storedScriptConfigs.remove(id, {
        expectedRevision: payload?.expectedRevision,
        expectedUpdatedAt: payload?.expectedUpdatedAt,
      })
      response.writeHead(204, {
        'Cache-Control': 'no-store',
        ...(allowedOrigins.has(origin)
          ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
          : {}),
      })
      response.end()
    } catch (error) {
      sendScriptConfigError(response, error, origin)
    }
    return
  }

  if (request.method === 'GET' && pathname === '/run-records') {
    try {
      const records = await storedRunRecords.list()
      sendJson(response, 200, { records }, origin)
    } catch (error) {
      sendRunRecordError(response, error, origin)
    }
    return
  }

  if (request.method === 'POST' && pathname === '/run-records') {
    try {
      const payload = await readJson(request, RUN_RECORD_REQUEST_LIMIT_BYTES)
      const record = await storedRunRecords.create(payload?.record)
      sendJson(response, 201, { record }, origin)
    } catch (error) {
      sendRunRecordError(response, error, origin)
    }
    return
  }

  if (request.method === 'POST' && pathname === '/run-records/migrations/local-storage-v1') {
    try {
      const payload = await readJson(request, RUN_RECORD_REQUEST_LIMIT_BYTES)
      const result = await storedRunRecords.migrate(payload?.records)
      sendJson(response, 200, result, origin)
    } catch (error) {
      sendRunRecordError(response, error, origin)
    }
    return
  }

  const screenshotRevealMatch = pathname.match(
    /^\/run-records\/([^/]+)\/screenshots\/([^/]+)\/([^/]+)\/reveal$/,
  )
  if (screenshotRevealMatch && request.method === 'POST') {
    let openedScreenshot
    try {
      const { recordId, stepId, attemptId, relativePath } = parseScreenshotRequest(
        request,
        screenshotRevealMatch,
      )
      openedScreenshot = await openRegisteredScreenshot(
        recordId,
        stepId,
        attemptId,
        relativePath,
      )
      try {
        await revealFile(openedScreenshot.absolutePath)
      } catch (error) {
        if (error instanceof ScreenshotRevealError) throw error
        throw new ScreenshotRevealError('无法在文件夹中显示截图，请确认系统文件管理器可用')
      }
      sendJson(response, 200, { ok: true }, origin)
    } catch (error) {
      if (error instanceof ScreenshotRevealError) {
        sendJson(response, error.statusCode, {
          ok: false,
          error: error.message,
          code: error.code,
        }, origin)
      } else {
        sendRunRecordError(response, error, origin)
      }
    } finally {
      await openedScreenshot?.handle.close().catch(() => undefined)
    }
    return
  }

  const screenshotMatch = pathname.match(
    /^\/run-records\/([^/]+)\/screenshots\/([^/]+)\/([^/]+)$/,
  )
  if (screenshotMatch && request.method === 'GET') {
    let openedScreenshot
    try {
      const { recordId, stepId, attemptId, relativePath } = parseScreenshotRequest(
        request,
        screenshotMatch,
      )
      openedScreenshot = await openRegisteredScreenshot(
        recordId,
        stepId,
        attemptId,
        relativePath,
      )

      response.writeHead(200, {
        'Content-Type': openedScreenshot.artifact.mimeType,
        'Content-Length': openedScreenshot.sizeBytes,
        'Content-Disposition': 'inline',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...(allowedOrigins.has(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
      })
      await pipeline(
        openedScreenshot.handle.createReadStream({ autoClose: false }),
        response,
      )
    } catch (error) {
      if (response.headersSent) response.destroy()
      else sendRunRecordError(response, error, origin)
    } finally {
      await openedScreenshot?.handle.close().catch(() => undefined)
    }
    return
  }

  const storedRunRecordMatch = pathname.match(/^\/run-records\/([^/]+)$/)
  if (storedRunRecordMatch && request.method === 'GET') {
    try {
      const id = decodePathSegment(storedRunRecordMatch[1])
      const record = await storedRunRecords.get(id)
      if (!record) {
        sendJson(response, 404, { ok: false, error: '运行记录不存在' }, origin)
        return
      }
      sendJson(response, 200, { record }, origin)
    } catch (error) {
      sendRunRecordError(response, error, origin)
    }
    return
  }

  if (storedRunRecordMatch && request.method === 'PATCH') {
    try {
      const id = decodePathSegment(storedRunRecordMatch[1])
      const payload = await readJson(request, RUN_RECORD_REQUEST_LIMIT_BYTES)
      const record = await storedRunRecords.update(id, payload?.record, {
        expectedRevision: payload?.expectedRevision,
        expectedUpdatedAt: payload?.expectedUpdatedAt,
      })
      sendJson(response, 200, { record }, origin)
    } catch (error) {
      sendRunRecordError(response, error, origin)
    }
    return
  }

  const runCancellationMatch = pathname.match(/^\/runs\/([^/]+)\/cancel$/)
  if (request.method === 'POST' && runCancellationMatch) {
    try {
      const runId = decodeURIComponent(runCancellationMatch[1])
      if (!RUN_ID_PATTERN.test(runId)) throw new Error('运行任务 ID 格式无效')
      const cancellationPayload = await readJson(request)
      const reason = parseCancellationReason(cancellationPayload)
      const run = activeRuns.get(runId)
      if (!run) {
        if (cancellationPayload?.reserveIfMissing === true) {
          const cancellation = reserveRunCancellation(runId, reason)
          const snapshot = pendingCancellationSnapshot(runId, cancellation)
          sendJson(response, 200, {
            ok: true,
            status: 'interrupted',
            pendingRegistration: true,
            cancelledRunIds: [runId],
            cleanupTimedOutRunIds: [],
            runs: [snapshot],
          }, origin)
          return
        }
        sendJson(response, 404, { ok: false, error: '运行任务不存在或已过期' }, origin)
        return
      }
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

  const executionCancellationMatch = pathname.match(/^\/executions\/([^/]+)\/cancel$/)
  if (request.method === 'POST' && executionCancellationMatch) {
    try {
      const executionId = decodeURIComponent(executionCancellationMatch[1])
      if (!EXECUTION_ID_PATTERN.test(executionId)) throw new Error('批次执行 ID 格式无效')
      const reason = parseCancellationReason(await readJson(request))
      reserveExecutionCancellation(executionId, reason)
      const runs = [...activeRuns.values()].filter((run) => (
        run.executionId === executionId && run.status === 'running'
      ))
      const interruptedRuns = interruptRuns(runs, reason)
      const completionStates = await Promise.all(interruptedRuns.map(waitForRunCompletion))
      sendJson(response, 200, {
        ok: true,
        status: 'interrupted',
        executionId,
        pendingRegistration: true,
        cancelledRunIds: interruptedRuns.map((item) => item.runId),
        cleanupTimedOutRunIds: interruptedRuns
          .filter((_, index) => !completionStates[index])
          .map((item) => item.runId),
        runs: interruptedRuns.map(liveRunSnapshot),
      }, origin)
    } catch (error) {
      const message = error instanceof Error ? error.message : '停止运行批次失败'
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
      const cancellation = pendingRunCancellations.get(runId)
      if (cancellation) {
        sendJson(response, 200, pendingCancellationSnapshot(runId, cancellation), origin)
        return
      }
      sendJson(response, 404, { ok: false, error: '运行任务不存在或已过期' }, origin)
      return
    }
    sendJson(response, 200, liveRunSnapshot(run), origin)
    return
  }

  if (request.method === 'POST' && request.url === '/runs') {
    let liveRun = null
    try {
      const submittedPayload = await readJson(request)
      const runId = typeof submittedPayload?.runId === 'string' && submittedPayload.runId.trim()
        ? submittedPayload.runId.trim()
        : randomUUID()
      if (!RUN_ID_PATTERN.test(runId)) {
        throw new Error('运行任务 ID 格式无效')
      }
      if (activeRuns.has(runId)) {
        throw new Error('运行任务 ID 已存在')
      }
      const payload = { ...submittedPayload, runId }
      const context = await runValidator(payload)
      const executionId = context.executionId ?? runId
      const pendingCancellation = takeRunCancellation(runId)
        ?? pendingExecutionCancellations.get(executionId)
      const abortController = new AbortController()
      liveRun = {
        runId,
        scriptId: context.scriptId,
        executionId,
        status: pendingCancellation ? 'interrupted' : 'running',
        startedAt: performance.now(),
        logs: [],
        result: null,
        abortController,
        cancellationReason: pendingCancellation?.reason ?? null,
        completion: null,
        cleanupTimer: null,
        cleanupWaitWarningLogged: false,
      }
      activeRuns.set(runId, liveRun)
      if (pendingCancellation) {
        appendRunLog(
          liveRun,
          'warning',
          `运行在启动前已停止：${pendingCancellation.reason}`,
        )
        abortController.abort(pendingCancellation.reason)
        liveRun.result = {
          ok: false,
          cancelled: true,
          status: 'interrupted',
          durationMs: 0,
          logs: liveRun.logs,
          error: pendingCancellation.reason,
        }
        scheduleRunCleanup(liveRun)
        sendJson(response, 200, liveRun.result, origin)
        return
      }
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
  let releaseRejectionGuard = null
  server.once('listening', () => {
    releaseRejectionGuard = retainScriptRejectionGuard()
  })
  server.once('close', () => {
    releaseRejectionGuard?.()
    releaseRejectionGuard = null
  })
  return server
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
