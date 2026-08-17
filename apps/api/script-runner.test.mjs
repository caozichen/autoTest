import assert from 'node:assert/strict'
import test from 'node:test'

import {
  executeRegisteredScript,
  sanitizeErrorMessage,
  validateRunRequest,
} from './script-runner.mjs'

function validRunPayload(scriptId = 'form-contact-publish') {
  return {
    scriptId,
    context: {
      siteBaseUrl: 'https://example.test/',
      apiBaseUrl: 'https://example.test/api',
      authorizationOrigin: 'https://example.test',
      extraHTTPHeaders: { Authorization: 'Bearer test-token' },
    },
  }
}

test('accepts a registered script with a same-origin authorization context', () => {
  const result = validateRunRequest({
    scriptId: 'form-contact-publish',
    context: {
      siteBaseUrl: 'https://example.test/',
      apiBaseUrl: 'https://example.test/api',
      ignoreHTTPSErrors: true,
      variables: { FORM_ID: 'form-123' },
      authorizationOrigin: 'https://example.test',
      extraHTTPHeaders: { Authorization: 'Bearer test-token' },
    },
  })

  assert.equal(result.apiBaseUrl, 'https://example.test/api')
  assert.equal(result.siteBaseUrl, 'https://example.test/')
  assert.equal(result.ignoreHTTPSErrors, true)
  assert.deepEqual(result.variables, { FORM_ID: 'form-123' })
  assert.equal(result.authorizationOrigin, 'https://example.test')
})

test('accepts the registered all-fields form script', () => {
  const result = validateRunRequest({
    scriptId: 'form-all-fields-publish',
    context: {
      siteBaseUrl: 'https://example.test/',
      apiBaseUrl: 'https://example.test/api',
      authorizationOrigin: 'https://example.test',
      extraHTTPHeaders: { Authorization: 'Bearer test-token' },
    },
  })

  assert.equal(result.scriptId, 'form-all-fields-publish')
})

test('accepts the registered public all-fields submission script', () => {
  const result = validateRunRequest({
    scriptId: 'form-all-fields-submit',
    context: {
      siteBaseUrl: 'https://example.test/',
      apiBaseUrl: 'https://example.test/api',
      authorizationOrigin: 'https://example.test',
      extraHTTPHeaders: { Authorization: 'Bearer test-token' },
    },
  })

  assert.equal(result.scriptId, 'form-all-fields-submit')
})

test('rejects malformed runtime variables', () => {
  assert.throws(() => validateRunRequest({
    scriptId: 'form-contact-publish',
    context: {
      siteBaseUrl: 'https://example.test/',
      apiBaseUrl: 'https://example.test/api',
      variables: { FORM_ID: 123 },
      authorizationOrigin: 'https://example.test',
      extraHTTPHeaders: { Authorization: 'Bearer test-token' },
    },
  }), /变量值必须是字符串/)
})

test('rejects unregistered scripts and cross-origin token forwarding', () => {
  assert.throws(() => validateRunRequest({ scriptId: '../../other.mjs', context: {} }), /脚本未登记/)
  assert.throws(() => validateRunRequest({
    scriptId: 'form-contact-publish',
    context: {
      siteBaseUrl: 'https://web.example.test/',
      apiBaseUrl: 'https://example.test/api',
      authorizationOrigin: 'https://example.test',
      extraHTTPHeaders: { Authorization: 'Bearer test-token' },
    },
  }), /Web 基址.*不同源/)
  assert.throws(() => validateRunRequest({
    scriptId: 'form-contact-publish',
    context: {
      siteBaseUrl: 'https://other.example.test/',
      apiBaseUrl: 'https://api.example.test/api',
      authorizationOrigin: 'https://other.example.test',
      extraHTTPHeaders: { Authorization: 'Bearer test-token' },
    },
  }), /不同源/)
})

test('redacts authorization values and ANSI control sequences from errors', () => {
  const authorization = 'Bearer sensitive-runtime-token'
  const rawError = new Error(
    '\u001b[2mCall log:\u001b[22m - Authorization: Bearer sensitive-runtime-token - accept: application/json',
  )
  const message = sanitizeErrorMessage(rawError, [authorization])

  assert.doesNotMatch(message, /sensitive-runtime-token/)
  assert.doesNotMatch(message, /\u001b/)
  assert.match(message, /Authorization: \[REDACTED\]/)
})

test('passes AbortSignal to a non-cooperative script and bounds cancellation cleanup', async () => {
  const controller = new AbortController()
  const streamedLogs = []
  let receivedSignal
  let markStarted
  const started = new Promise((resolve) => {
    markStarted = resolve
  })

  const execution = executeRegisteredScript(validRunPayload(), {
    signal: controller.signal,
    onLog: (log) => streamedLogs.push(log),
    abortCleanupTimeoutMs: 20,
    loadScript: async () => ({
      run: ({ signal }) => {
        receivedSignal = signal
        markStarted()
        return new Promise(() => {})
      },
    }),
  })

  await started
  const cancelledAt = performance.now()
  controller.abort('操作栏强制停止')
  const result = await execution

  assert.equal(receivedSignal, controller.signal)
  assert.equal(result.ok, false)
  assert.equal(result.cancelled, true)
  assert.equal(result.status, 'interrupted')
  assert.equal(result.error, '操作栏强制停止')
  assert.equal(result.logs.at(-1)?.level, 'warning')
  assert.ok(performance.now() - cancelledAt < 250)
  assert.ok(result.logs.some((log) => /执行已取消.*操作栏强制停止/.test(log.message)))
  assert.ok(result.logs.some((log) => /取消清理超过 20 ms/.test(log.message)))
  assert.deepEqual(streamedLogs, result.logs)
  assert.equal(result.logs.some((log) => log.level === 'error'), false)
})

test('waits for cooperative script cleanup before reporting cancellation', async () => {
  const controller = new AbortController()
  let markStarted
  let cleanupFinished = false
  const started = new Promise((resolve) => { markStarted = resolve })
  const execution = executeRegisteredScript(validRunPayload(), {
    signal: controller.signal,
    abortCleanupTimeoutMs: 200,
    loadScript: async () => ({
      run: ({ signal }) => new Promise((_, reject) => {
        markStarted()
        signal.addEventListener('abort', () => {
          setTimeout(() => {
            cleanupFinished = true
            reject(new Error('Playwright handles closed'))
          }, 25)
        }, { once: true })
      }),
    }),
  })

  await started
  controller.abort('等待浏览器清理')
  const result = await execution

  assert.equal(result.cancelled, true)
  assert.equal(cleanupFinished, true)
  assert.equal(result.logs.some((log) => /取消清理超过/.test(log.message)), false)
})

test('keeps ordinary script errors classified as failures', async () => {
  const controller = new AbortController()
  const result = await executeRegisteredScript(validRunPayload(), {
    signal: controller.signal,
    loadScript: async () => ({
      run: async ({ signal }) => {
        assert.equal(signal, controller.signal)
        throw new Error('普通脚本错误')
      },
    }),
  })

  assert.equal(result.ok, false)
  assert.equal(result.cancelled, undefined)
  assert.equal(result.status, undefined)
  assert.equal(result.error, '普通脚本错误')
  assert.equal(result.logs.at(-1)?.level, 'error')
  assert.match(result.logs.at(-1)?.message ?? '', /执行失败.*普通脚本错误/)
})
