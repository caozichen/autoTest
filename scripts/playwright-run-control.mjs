const CLOSE_STEP_TIMEOUT_MS = 2_500

function cancellationError(signal) {
  if (signal?.reason instanceof Error) return signal.reason
  const message = typeof signal?.reason === 'string' && signal.reason.trim()
    ? signal.reason.trim()
    : '用户强制停止运行'
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

export function throwIfRunAborted(signal) {
  if (signal?.aborted) throw cancellationError(signal)
}

function reportCloseWarning(logger, message) {
  try {
    logger?.('warning', message)
  } catch {
    // 清理日志失败不能阻断后续浏览器关闭步骤。
  }
}

async function settleWithin(label, action, {
  logger,
  timeoutMs = CLOSE_STEP_TIMEOUT_MS,
} = {}) {
  let timer
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ status: 'timed-out' }), timeoutMs)
  })
  const outcome = await Promise.race([
    Promise.resolve()
      .then(action)
      .then(
        () => ({ status: 'closed' }),
        () => ({ status: 'failed' }),
      ),
    deadline,
  ])
  clearTimeout(timer)

  if (outcome.status === 'timed-out') {
    reportCloseWarning(logger, `关闭 Playwright ${label} 超过 ${timeoutMs} ms，已继续后续清理`)
  } else if (outcome.status === 'failed') {
    reportCloseWarning(logger, `关闭 Playwright ${label} 失败，已继续后续清理`)
  }
  return outcome.status === 'closed'
}

export async function closePlaywrightHandles({ context, browser }, options = {}) {
  const result = { contextClosed: !context, browserClosed: !browser }
  await Promise.all([
    context
      ? settleWithin('浏览器上下文', () => context.close(), options)
        .then((closed) => { result.contextClosed = closed })
      : undefined,
    browser
      ? settleWithin('浏览器进程', () => browser.close(), options)
        .then((closed) => { result.browserClosed = closed })
      : undefined,
  ])
  return result
}

export function closePlaywrightOnAbort(signal, getHandles, options = {}) {
  let closePromise = null
  const startClose = () => {
    if (!closePromise) closePromise = closePlaywrightHandles(getHandles(), options)
    return closePromise
  }
  const handleAbort = () => {
    void startClose()
  }

  if (signal) {
    signal.addEventListener('abort', handleAbort, { once: true })
    if (signal.aborted) handleAbort()
  }

  return async () => {
    signal?.removeEventListener('abort', handleAbort)
    if (!closePromise) return false
    await closePromise
    return true
  }
}
