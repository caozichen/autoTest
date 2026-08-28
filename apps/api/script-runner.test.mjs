import assert from 'node:assert/strict'
import test from 'node:test'

import {
  executeRegisteredScript,
  sanitizeErrorMessage,
  validateRunRequest,
} from './script-runner.mjs'
import { expect as recordedExpect } from '../../scripts/support/recorded-expect.mjs'

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
  assert.equal(result.timeoutMs, 300_000)
})

test('accepts a per-script execution timeout and rejects unsafe timeout values', () => {
  const result = validateRunRequest({
    ...validRunPayload(),
    timeoutMs: 12_345,
  })
  assert.equal(result.timeoutMs, 12_345)

  for (const timeoutMs of [999, 1_800_001, 1.5, '30000']) {
    assert.throws(
      () => validateRunRequest({ ...validRunPayload(), timeoutMs }),
      /脚本执行超时/,
    )
  }
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

test('accepts the registered lpXAVN submission script', () => {
  const result = validateRunRequest({
    scriptId: 'form-lpxavn-submit',
    context: {
      siteBaseUrl: 'https://example.test/',
      apiBaseUrl: 'https://example.test/api',
      requestPath: 'form/?id=configured',
      authorizationOrigin: 'https://example.test',
      extraHTTPHeaders: { Authorization: 'Bearer test-token' },
    },
  })

  assert.equal(result.scriptId, 'form-lpxavn-submit')
  assert.equal(result.requestPath, '/form/?id=configured')
})

test('accepts the registered submission reply editor script', () => {
  const result = validateRunRequest({
    scriptId: 'form-submission-reply-edit',
    context: {
      siteBaseUrl: 'https://example.test/',
      apiBaseUrl: 'https://example.test/api',
      requestPath: 'form-activity/submission/preview/reply/configured?fid=form-123',
      variables: {
        SUBMISSION_ID: 'configured',
        FORM_ID: 'form-123',
        SUBMISSION_ASSERTIONS: '{}',
        SUBMISSION_EDIT_VALUES: '{}',
      },
      authorizationOrigin: 'https://example.test',
      extraHTTPHeaders: { Authorization: 'Bearer test-token' },
    },
  })

  assert.equal(result.scriptId, 'form-submission-reply-edit')
  assert.equal(
    result.requestPath,
    '/form-activity/submission/preview/reply/configured?fid=form-123',
  )
  assert.deepEqual(result.variables, {
    SUBMISSION_ID: 'configured',
    FORM_ID: 'form-123',
    SUBMISSION_ASSERTIONS: '{}',
    SUBMISSION_EDIT_VALUES: '{}',
  })
})

test('rejects unsafe script URL path configuration', () => {
  for (const requestPath of [
    '',
    'https://other.example.test/form',
    '//other.example.test/form',
    '/\\other.example.test/form',
    '/form/?id={{FORM_ID}}',
  ]) {
    assert.throws(() => validateRunRequest({
      scriptId: 'form-lpxavn-submit',
      context: {
        siteBaseUrl: 'https://example.test/',
        apiBaseUrl: 'https://example.test/api',
        requestPath,
        authorizationOrigin: 'https://example.test',
        extraHTTPHeaders: { Authorization: 'Bearer test-token' },
      },
    }), /URL 路径/)
  }
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

  assert.notEqual(receivedSignal, controller.signal)
  assert.equal(receivedSignal.aborted, true)
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
        assert.notEqual(signal, controller.signal)
        assert.equal(signal.aborted, false)
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

test('returns every recorded assertion in execution order, including the failing assertion', async () => {
  const result = await executeRegisteredScript(validRunPayload('form-lpxavn-submit'), {
    loadScript: async () => ({
      run: async () => {
        recordedExpect(3, '单项选择应显示三个选项').toBe(3)
        recordedExpect('12345', '单项选择最多输入四个字符').toHaveLength(4)
        recordedExpect('后续步骤', '断言失败后仍执行后续步骤').toContain('后续')
        return { completed: true }
      },
    }),
  })

  assert.equal(result.ok, false)
  assert.deepEqual(result.assertions.map(({ sequence, name, module, status }) => ({
    sequence,
    name,
    module,
    status,
  })), [
    { sequence: 1, name: '单项选择应显示三个选项', module: '单项选择', status: 'passed' },
    { sequence: 2, name: '单项选择最多输入四个字符', module: '单项选择', status: 'failed' },
    { sequence: 3, name: '断言失败后仍执行后续步骤', module: '基础运行流程', status: 'passed' },
  ])
  assert.match(result.assertions[1].error, /Expected length/)
  assert.deepEqual(result.result, { completed: true })
  assert.match(result.error, /1 条断言失败/)
})

test('returns structured API responses and redacts sensitive request and response fields', async () => {
  const result = await executeRegisteredScript(validRunPayload(), {
    loadScript: async () => ({
      run: async ({ recordApiResponse }) => {
        recordApiResponse({
          timestamp: '2026-08-21T08:00:00.000Z',
          name: '/api/be/form',
          method: 'post',
          url: 'https://example.test/api/be/form?token=query-token&source=ui',
          status: 200,
          ok: true,
          durationMs: 18.6,
          requestBody: { title: '完整表单', mobile: '13671153204' },
          responseBody: { code: 0, data: { id: 'form-1', access_token: 'response-token' } },
        })
        return { formId: 'form-1' }
      },
    }),
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.apiResponses, [{
    sequence: 1,
    timestamp: '2026-08-21T08:00:00.000Z',
    name: '/api/be/form',
    method: 'POST',
    url: 'https://example.test/api/be/form?token=%5BREDACTED%5D&source=ui',
    status: 200,
    ok: true,
    durationMs: 19,
    requestBody: { title: '完整表单', mobile: '[REDACTED]' },
    responseBody: { code: 0, data: { id: 'form-1', access_token: '[REDACTED]' } },
  }])
})

test('stops a script at its configured timeout and reports a failure instead of interruption', async () => {
  let receivedSignal
  let cleanupFinished = false
  const result = await executeRegisteredScript({
    ...validRunPayload(),
    timeoutMs: 1_000,
  }, {
    abortCleanupTimeoutMs: 100,
    loadScript: async () => ({
      run: ({ signal }) => new Promise((_, reject) => {
        receivedSignal = signal
        signal.addEventListener('abort', () => {
          cleanupFinished = true
          reject(new Error('浏览器已关闭'))
        }, { once: true })
      }),
    }),
  })

  assert.equal(receivedSignal.aborted, true)
  assert.equal(cleanupFinished, true)
  assert.equal(result.ok, false)
  assert.equal(result.timedOut, true)
  assert.equal(result.cancelled, undefined)
  assert.equal(result.status, 'failed')
  assert.match(result.error, /超过 1000 ms/)
  assert.equal(result.logs.some((log) => log.level === 'error' && /执行超时/.test(log.message)), true)
})

test('stops immediately on runtime exceptions and does not execute later work', async () => {
  let laterWorkExecuted = false
  const result = await executeRegisteredScript(validRunPayload(), {
    loadScript: async () => ({
      run: async () => {
        recordedExpect(true, '异常前断言').toBe(true)
        throw new Error('接口返回业务码 500')
        // eslint-disable-next-line no-unreachable
        laterWorkExecuted = true
      },
    }),
  })

  assert.equal(result.ok, false)
  assert.equal(result.error, '接口返回业务码 500')
  assert.equal(laterWorkExecuted, false)
  assert.equal(result.assertions.length, 1)
})
