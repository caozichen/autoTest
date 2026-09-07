import { randomUUID } from 'node:crypto'
import { chmodSync, lstatSync, renameSync } from 'node:fs'
import * as fileSystem from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_ARTIFACT_ROOT_DIRECTORY = fileURLToPath(
  new URL('../../outputs/artifacts/', import.meta.url),
)

const SAFE_SCOPE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/
const SAFE_ARTIFACT_TYPE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,99}$/
const DEFAULT_SEAL_TIMEOUT_MS = 3_000

function assertSafeScopeId(value, label) {
  if (typeof value !== 'string' || !SAFE_SCOPE_ID_PATTERN.test(value)) {
    throw new Error(`${label} 格式无效，只允许字母、数字、短横线和下划线`)
  }
  return value
}

function normalizeRelativePath(value) {
  if (typeof value !== 'string' || !value) {
    throw new Error('制品相对路径必须是非空字符串')
  }
  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    throw new Error('制品相对路径不能包含 NUL 或控制字符')
  }
  if (value.includes('\\')) {
    throw new Error('制品相对路径不能包含反斜杠')
  }
  if (isAbsolute(value) || value.startsWith('//') || /^[a-zA-Z]:/.test(value)) {
    throw new Error('制品路径必须是相对路径')
  }

  const segments = value.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('制品相对路径不能包含空路径段、. 或 ..')
  }
  return segments.join('/')
}

function normalizeCaptureOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('制品捕获选项必须是对象')
  }
  const type = options.type ?? 'attachment'
  const mimeType = options.mimeType ?? 'application/octet-stream'
  if (typeof type !== 'string' || !SAFE_ARTIFACT_TYPE_PATTERN.test(type)) {
    throw new Error('制品类型格式无效')
  }
  if (
    typeof mimeType !== 'string'
    || !mimeType.trim()
    || mimeType.length > 200
    || CONTROL_CHARACTER_PATTERN.test(mimeType)
  ) {
    throw new Error('制品 MIME 类型格式无效')
  }
  return { type, mimeType: mimeType.trim() }
}

function splitWriteOptions(options) {
  if (typeof options === 'string') {
    return {
      fileOptions: options,
      captureOptions: { type: 'attachment', mimeType: 'application/octet-stream' },
    }
  }
  if (options === undefined) {
    return {
      fileOptions: undefined,
      captureOptions: { type: 'attachment', mimeType: 'application/octet-stream' },
    }
  }
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('制品写入选项必须是字符串或对象')
  }
  const { type, mimeType, ...fileOptions } = options
  return {
    fileOptions,
    captureOptions: normalizeCaptureOptions({ type, mimeType }),
  }
}

function screenshotMimeType(relativePath, screenshotType) {
  const normalizedType = typeof screenshotType === 'string' ? screenshotType.toLowerCase() : ''
  if (normalizedType === 'jpeg' || normalizedType === 'jpg') return 'image/jpeg'
  if (normalizedType === 'png') return 'image/png'
  const extension = extname(relativePath).toLowerCase()
  return extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : 'image/png'
}

function screenshotFormat(relativePath, screenshotType) {
  const normalizedType = typeof screenshotType === 'string' ? screenshotType.toLowerCase() : ''
  if (normalizedType === 'jpeg' || normalizedType === 'jpg') return 'jpeg'
  if (normalizedType === 'png') return 'png'
  const extension = extname(relativePath).toLowerCase()
  return extension === '.jpg' || extension === '.jpeg' ? 'jpeg' : 'png'
}

function temporaryArtifactPath(absolutePath) {
  const targetDirectory = dirname(absolutePath)
  const targetName = basename(absolutePath)
  const extension = extname(targetName)
  const stem = extension ? targetName.slice(0, -extension.length) : targetName
  return resolve(
    targetDirectory,
    `.${stem || 'artifact'}.${process.pid}.${randomUUID()}.tmp${extension}`,
  )
}

export function createArtifactWriter({
  rootDirectory = DEFAULT_ARTIFACT_ROOT_DIRECTORY,
  executionId,
  stepId,
  attemptId,
} = {}) {
  if (typeof rootDirectory !== 'string' || !rootDirectory.trim()) {
    throw new Error('制品根目录必须是非空字符串')
  }
  const scope = {
    executionId: assertSafeScopeId(executionId, 'executionId'),
    stepId: assertSafeScopeId(stepId, 'stepId'),
    attemptId: assertSafeScopeId(attemptId, 'attemptId'),
  }
  const artifactRoot = resolve(rootDirectory)
  const scopeDirectory = resolve(
    artifactRoot,
    scope.executionId,
    scope.stepId,
    scope.attemptId,
  )
  const descriptors = new Map()
  const pendingCaptures = new Set()
  const pendingTemporaryPaths = new Set()
  let state = 'open'
  let sealPromise = null

  function assertOpen() {
    if (state !== 'open') throw new Error('制品写入器已封口，不能继续捕获制品')
  }

  function list() {
    return [...descriptors.values()].map((descriptor) => structuredClone(descriptor))
  }

  function targetFor(relativePath) {
    const normalizedPath = normalizeRelativePath(relativePath)
    const absolutePath = resolve(scopeDirectory, ...normalizedPath.split('/'))
    const relativeToScope = relative(scopeDirectory, absolutePath)
    if (
      !relativeToScope
      || relativeToScope === '..'
      || relativeToScope.startsWith(`..${sep}`)
      || isAbsolute(relativeToScope)
    ) {
      throw new Error('制品路径超出当前执行范围')
    }
    return { absolutePath, relativePath: normalizedPath }
  }

  function capture(relativePath, producer, options = {}) {
    if (typeof producer !== 'function') throw new Error('制品 producer 必须是函数')
    assertOpen()
    const target = targetFor(relativePath)
    const captureOptions = normalizeCaptureOptions(options)
    const targetDirectory = dirname(target.absolutePath)
    const temporaryPath = temporaryArtifactPath(target.absolutePath)
    pendingTemporaryPaths.add(temporaryPath)

    const operation = (async () => {
      try {
        await fileSystem.mkdir(targetDirectory, { recursive: true, mode: 0o700 })
        if (state === 'sealed') throw new Error('制品写入器已封口，已放弃未完成的制品')
        await producer(temporaryPath)
        if (state === 'sealed') throw new Error('制品写入器已封口，已放弃未完成的制品')

        // Keep the final commit synchronous so seal() cannot interleave between
        // the last state check, the atomic rename, and descriptor registration.
        const temporaryStat = lstatSync(temporaryPath)
        if (!temporaryStat.isFile() || temporaryStat.isSymbolicLink()) {
          throw new Error('制品 producer 必须生成普通文件')
        }
        chmodSync(temporaryPath, 0o600)
        renameSync(temporaryPath, target.absolutePath)

        const descriptor = {
          ...scope,
          absolutePath: target.absolutePath,
          relativePath: target.relativePath,
          type: captureOptions.type,
          mimeType: captureOptions.mimeType,
          sizeBytes: temporaryStat.size,
          createdAt: new Date().toISOString(),
        }
        descriptors.set(target.relativePath, descriptor)
        return structuredClone(descriptor)
      } catch (error) {
        await fileSystem.unlink(temporaryPath).catch(() => undefined)
        throw error
      } finally {
        pendingTemporaryPaths.delete(temporaryPath)
      }
    })()

    pendingCaptures.add(operation)
    void operation.then(
      () => pendingCaptures.delete(operation),
      () => pendingCaptures.delete(operation),
    )
    return operation
  }

  async function writeFile(relativePath, data, options) {
    const { fileOptions, captureOptions } = splitWriteOptions(options)
    return capture(relativePath, async (temporaryPath) => {
      if (typeof fileOptions === 'string') {
        await fileSystem.writeFile(temporaryPath, data, {
          encoding: fileOptions,
          flag: 'wx',
          mode: 0o600,
        })
        return
      }
      await fileSystem.writeFile(temporaryPath, data, {
        flag: 'wx',
        mode: 0o600,
        ...fileOptions,
      })
    }, captureOptions)
  }

  async function captureScreenshot(page, relativePath, options = {}) {
    if (!page || typeof page.screenshot !== 'function') {
      throw new Error('截图捕获需要提供 Playwright page')
    }
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new Error('截图选项必须是对象')
    }
    const normalizedPath = normalizeRelativePath(relativePath)
    const format = screenshotFormat(normalizedPath, options.type)
    return capture(normalizedPath, (temporaryPath) => page.screenshot({
      ...options,
      type: format,
      path: temporaryPath,
    }), {
      type: 'screenshot',
      mimeType: screenshotMimeType(normalizedPath, format),
    })
  }

  function seal({ timeoutMs = DEFAULT_SEAL_TIMEOUT_MS } = {}) {
    if (sealPromise) return sealPromise
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      return Promise.reject(new Error('制品封口超时必须是大于等于 0 的有限数字'))
    }

    state = 'closing'
    const captures = [...pendingCaptures]
    sealPromise = (async () => {
      let timer
      let outcome
      if (captures.length === 0) {
        outcome = { timedOut: false }
      } else if (timeoutMs === 0) {
        outcome = { timedOut: true }
      } else {
        outcome = await Promise.race([
          Promise.allSettled(captures).then(() => ({ timedOut: false })),
          new Promise((resolveTimeout) => {
            timer = setTimeout(() => resolveTimeout({ timedOut: true }), timeoutMs)
          }),
        ])
      }
      clearTimeout(timer)
      state = 'sealed'

      const abandonedCaptureCount = outcome.timedOut ? pendingCaptures.size : 0
      if (outcome.timedOut) {
        await Promise.allSettled([...pendingTemporaryPaths].map((temporaryPath) => (
          fileSystem.unlink(temporaryPath)
        )))
      }
      return Object.freeze({
        timedOut: outcome.timedOut,
        abandonedCaptureCount,
        artifacts: list(),
      })
    })()
    return sealPromise
  }

  return Object.freeze({
    ...scope,
    writeFile,
    capture,
    captureScreenshot,
    seal,
    list,
  })
}
