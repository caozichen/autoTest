import assert from 'node:assert/strict'
import * as fileSystem from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import {
  executeRegisteredScript,
  sanitizeErrorMessage,
  validateRegisteredRunRequest,
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

function registeredConfig({
  id = 'custom-runner-script',
  entryFile = 'custom-runner-script.ui.spec.mjs',
  timeoutMs = 12_345,
  enabled = true,
} = {}) {
  return {
    schemaVersion: 1,
    revision: 0,
    id,
    name: '自定义 Runner 脚本',
    description: '从持久配置解析入口',
    directory: 'scripts',
    entryFile,
    timeoutMs,
    enabled,
    tags: ['Playwright'],
    createdAt: '2026-08-31T08:00:00.000Z',
    updatedAt: '2026-08-31T08:00:00.000Z',
  }
}

async function temporaryScriptsDirectory(t) {
  const root = await fileSystem.mkdtemp(join(tmpdir(), 'autotest-runner-config-'))
  const scriptsDirectory = join(root, 'scripts')
  await fileSystem.mkdir(scriptsDirectory)
  await fileSystem.writeFile(
    join(scriptsDirectory, 'custom-runner-script.ui.spec.mjs'),
    'export async function run() { return { source: "file" } }\n',
  )
  t.after(() => fileSystem.rm(root, { recursive: true, force: true }))
  return scriptsDirectory
}

test('accepts a registered script with a same-origin authorization context', () => {
  const result = validateRunRequest({
    scriptId: 'form-contact-publish',
    context: {
      siteBaseUrl: 'https://example.test/',
      apiBaseUrl: 'https://example.test/api',
      ignoreHTTPSErrors: true,
      variables: { FORM_ID: 'form-123' },
      firstPartyOrigins: [
        'https://forms.example.test/path',
        'https://forms.example.test/other',
      ],
      authorizationOrigin: 'https://example.test',
      extraHTTPHeaders: { Authorization: 'Bearer test-token' },
    },
  })

  assert.equal(result.apiBaseUrl, 'https://example.test/api')
  assert.equal(result.siteBaseUrl, 'https://example.test/')
  assert.equal(result.ignoreHTTPSErrors, true)
  assert.deepEqual(result.variables, { FORM_ID: 'form-123' })
  assert.deepEqual(result.firstPartyOrigins, ['https://forms.example.test'])
  assert.equal(result.authorizationOrigin, 'https://example.test')
  assert.equal(result.timeoutMs, 300_000)
})

test('rejects malformed explicit first-party network origins', () => {
  for (const firstPartyOrigins of [
    'https://forms.example.test',
    ['ws://forms.example.test'],
    Array.from({ length: 21 }, (_, index) => `https://forms-${index}.example.test`),
  ]) {
    assert.throws(
      () => validateRunRequest({
        ...validRunPayload(),
        context: { ...validRunPayload().context, firstPartyOrigins },
      }),
      /一方网络来源/,
    )
  }
})

test('accepts a safe execution ID for artifact grouping and rejects path-like values', () => {
  const result = validateRunRequest({
    ...validRunPayload(),
    executionId: 'execution-001',
  })
  assert.equal(result.executionId, 'execution-001')

  for (const executionId of ['', '../other-run', 'run/step', 'run.step']) {
    assert.throws(
      () => validateRunRequest({ ...validRunPayload(), executionId }),
      /制品执行 ID 格式无效/,
    )
  }
})

test('keeps a supplied run ID as the artifact attempt ID and rejects incompatible IDs', async () => {
  assert.equal(validateRunRequest({
    ...validRunPayload(),
    runId: 'attempt-001',
  }).scriptId, 'form-contact-publish')

  for (const runId of ['short', '-attempt-001', '_attempt-001', 'attempt.001']) {
    assert.throws(
      () => validateRunRequest({ ...validRunPayload(), runId }),
      /运行任务 ID 格式无效/,
    )
  }
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

test('validates registration, enabled state, and default timeout from persistent config', async (t) => {
  const scriptsDirectory = await temporaryScriptsDirectory(t)
  const config = registeredConfig()
  const scriptConfigRepository = { get: async (id) => id === config.id ? config : null }

  const context = await validateRegisteredRunRequest({
    ...validRunPayload(config.id),
    timeoutMs: 1_800_000,
  }, {
    scriptConfigRepository,
    scriptsDirectory,
  })
  assert.equal(context.scriptId, config.id)
  assert.equal(context.timeoutMs, config.timeoutMs)

  await assert.rejects(
    validateRegisteredRunRequest(validRunPayload('missing-runner-script'), {
      scriptConfigRepository,
      scriptsDirectory,
    }),
    /脚本未登记/,
  )
  await assert.rejects(
    validateRegisteredRunRequest(validRunPayload(config.id), {
      scriptConfigRepository: { get: async () => ({ ...config, enabled: false }) },
      scriptsDirectory,
    }),
    /脚本已禁用/,
  )
})

test('executes a custom script with its persistent timeout instead of client overrides', async (t) => {
  const scriptsDirectory = await temporaryScriptsDirectory(t)
  const config = registeredConfig()
  let loadedUrl

  const result = await executeRegisteredScript({
    ...validRunPayload(config.id),
    timeoutMs: 1_800_000,
  }, {
    scriptsDirectory,
    scriptConfigRepository: { get: async () => config },
    loadScript: async (url) => {
      loadedUrl = url
      return { run: async (context) => ({
        source: 'persistent-config',
        timeoutMs: context.timeoutMs,
      }) }
    },
  })

  assert.equal(loadedUrl.pathname.endsWith('/scripts/custom-runner-script.ui.spec.mjs'), true)
  assert.equal(result.ok, true)
  assert.deepEqual(result.result, {
    source: 'persistent-config',
    timeoutMs: config.timeoutMs,
  })
})

test('provides trusted script identity and an attempt-scoped artifact writer', async (t) => {
  const scriptsDirectory = await temporaryScriptsDirectory(t)
  const artifactRootDirectory = await fileSystem.mkdtemp(join(tmpdir(), 'autotest-runner-artifacts-'))
  t.after(() => fileSystem.rm(artifactRootDirectory, { recursive: true, force: true }))
  const config = registeredConfig()
  let receivedContext

  const result = await executeRegisteredScript({
    ...validRunPayload(config.id),
    runId: 'attempt-001',
    executionId: 'execution-001',
  }, {
    artifactRootDirectory,
    scriptsDirectory,
    scriptConfigRepository: { get: async () => config },
    loadScript: async () => ({
      run: async (context) => {
        receivedContext = context
        await context.artifactWriter.writeFile('result.txt', 'artifact body', {
          type: 'attachment',
          mimeType: 'text/plain',
        })
        return { completed: true }
      },
    }),
  })

  assert.equal(receivedContext.scriptId, config.id)
  assert.equal(receivedContext.scriptName, config.name)
  assert.equal(receivedContext.artifactWriter.executionId, 'execution-001')
  assert.equal(receivedContext.artifactWriter.stepId, config.id)
  assert.equal(receivedContext.artifactWriter.attemptId, 'attempt-001')
  assert.equal(result.ok, true)
  assert.equal(result.artifacts.length, 1)
  assert.equal(
    result.artifacts[0].absolutePath,
    resolve(artifactRootDirectory, 'execution-001', config.id, 'attempt-001', 'result.txt'),
  )
  assert.equal(await fileSystem.readFile(result.artifacts[0].absolutePath, 'utf8'), 'artifact body')
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
  assert.equal(result.continuePipeline, undefined)
  assert.equal(result.status, 'interrupted')
  assert.equal(result.error, '操作栏强制停止')
  assert.equal(result.logs.at(-1)?.level, 'warning')
  assert.ok(performance.now() - cancelledAt < 250)
  assert.ok(result.logs.some((log) => /执行已取消.*操作栏强制停止/.test(log.message)))
  assert.ok(result.logs.some((log) => /取消清理超过 20 ms/.test(log.message)))
  assert.deepEqual(streamedLogs, result.logs)
  assert.equal(result.logs.some((log) => log.level === 'error'), false)
})

test('seals artifact capture after cancellation cleanup times out and removes late temporary output', async (t) => {
  const artifactRootDirectory = await fileSystem.mkdtemp(join(tmpdir(), 'autotest-runner-late-artifact-'))
  t.after(() => fileSystem.rm(artifactRootDirectory, { recursive: true, force: true }))
  const controller = new AbortController()
  let notifyScriptStarted
  let notifyCaptureStarted
  let releaseProducer
  let temporaryPath
  let captureOutcome
  const scriptStarted = new Promise((resolveStarted) => { notifyScriptStarted = resolveStarted })
  const captureStarted = new Promise((resolveStarted) => { notifyCaptureStarted = resolveStarted })
  const producerRelease = new Promise((resolveProducer) => { releaseProducer = resolveProducer })
  const execution = executeRegisteredScript({
    ...validRunPayload(),
    executionId: 'execution-late-001',
    runId: 'attempt-late-001',
  }, {
    signal: controller.signal,
    abortCleanupTimeoutMs: 20,
    artifactRootDirectory,
    loadScript: async () => ({
      run: ({ artifactWriter, signal }) => {
        notifyScriptStarted()
        signal.addEventListener('abort', () => {
          const capture = artifactWriter.capture('screenshots/late.png', async (targetPath) => {
            temporaryPath = targetPath
            notifyCaptureStarted()
            await producerRelease
            await fileSystem.writeFile(targetPath, Buffer.from('late screenshot'))
          }, { type: 'screenshot', mimeType: 'image/png' })
          captureOutcome = capture.then(
            () => null,
            (captureError) => captureError,
          )
        }, { once: true })
        return new Promise(() => {})
      },
    }),
  })

  await scriptStarted
  const cancelledAt = performance.now()
  controller.abort('停止并封口制品')
  await captureStarted
  const result = await execution
  const finalPath = resolve(
    artifactRootDirectory,
    'execution-late-001',
    'form-contact-publish',
    'attempt-late-001',
    'screenshots',
    'late.png',
  )

  assert.equal(result.cancelled, true)
  assert.deepEqual(result.artifacts, [])
  assert.ok(performance.now() - cancelledAt < 250)
  assert.ok(result.logs.some((log) => /制品捕获清理超过 .*已放弃 1 个未完成制品/.test(log.message)))
  await assert.rejects(fileSystem.access(finalPath))

  releaseProducer()
  const captureError = await captureOutcome
  assert.match(captureError?.message ?? '', /已封口/)
  await assert.rejects(fileSystem.access(temporaryPath))
  await assert.rejects(fileSystem.access(finalPath))
})

test('counts artifact sealing against the configured script timeout', async (t) => {
  const artifactRootDirectory = await fileSystem.mkdtemp(join(tmpdir(), 'autotest-runner-seal-timeout-'))
  t.after(() => fileSystem.rm(artifactRootDirectory, { recursive: true, force: true }))
  const config = registeredConfig({
    id: 'form-contact-publish',
    entryFile: 'form-contact-publish.ui.spec.mjs',
    timeoutMs: 1_000,
  })
  let releaseProducer
  let captureOutcome
  const producerRelease = new Promise((resolveProducer) => { releaseProducer = resolveProducer })

  const result = await executeRegisteredScript({
    ...validRunPayload(),
    executionId: 'execution-seal-timeout-001',
    runId: 'attempt-seal-timeout-001',
  }, {
    abortCleanupTimeoutMs: 2_000,
    artifactRootDirectory,
    scriptConfigRepository: { get: async () => config },
    loadScript: async () => ({
      run: ({ artifactWriter }) => {
        const capture = artifactWriter.capture('traces/late.zip', async (temporaryPath) => {
          await producerRelease
          await fileSystem.writeFile(temporaryPath, Buffer.from('late trace'))
        }, { type: 'trace', mimeType: 'application/zip' })
        captureOutcome = capture.then(
          () => null,
          (captureError) => captureError,
        )
        return { completed: true }
      },
    }),
  })

  assert.equal(result.ok, false)
  assert.equal(result.timedOut, true)
  assert.equal(result.cancelled, undefined)
  assert.equal(result.status, 'failed')
  assert.equal(result.result, undefined)
  assert.match(result.error, /超过 1000 ms/)
  assert.ok(result.logs.some((log) => log.level === 'error' && /执行超时/.test(log.message)))
  assert.ok(result.logs.some((log) => /制品捕获清理超过 .*已放弃 1 个未完成制品/.test(log.message)))
  assert.deepEqual(result.artifacts, [])

  releaseProducer()
  const captureError = await captureOutcome
  assert.match(captureError?.message ?? '', /已封口/)
  await assert.rejects(fileSystem.access(resolve(
    artifactRootDirectory,
    'execution-seal-timeout-001',
    'form-contact-publish',
    'attempt-seal-timeout-001',
    'traces',
    'late.zip',
  )))
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
  assert.equal(result.continuePipeline, true)
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
          bodyReadError: 'response body unavailable token=diagnostic-secret',
          warning: true,
          incomplete: true,
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
    phase: '未标记阶段',
    isFirstParty: true,
    requestBody: { title: '完整表单', mobile: '[REDACTED]' },
    responseBody: { code: 0, data: { id: 'form-1', access_token: '[REDACTED]' } },
    bodyReadError: 'response body unavailable token=[REDACTED]',
    warning: true,
    incomplete: true,
  }])
  assert.deepEqual(result.networkSummary, {
    api: { observed: 1, recorded: 1, dropped: 0, passed: 0, failed: 0, warnings: 1 },
    resources: { observed: 0, recorded: 0, dropped: 0, passed: 0, failed: 0, warnings: 0 },
  })
  assert.deepEqual(result.resourceResponses, [])
  assert.equal(result.assertions.length, 0)
  assert.equal(result.logs.some(({ level, message }) => (
    level === 'warning' && message.includes('接口响应采集不完整')
  )), true)
})

test('records API and resource failures without interrupting script work and fails only first-party health', async () => {
  let laterWorkExecuted = false
  const result = await executeRegisteredScript(validRunPayload(), {
    loadScript: async () => ({
      run: async ({ recordApiResponse, recordResourceResponse }) => {
        recordApiResponse({
          phase: '最终提交',
          method: 'post',
          url: 'https://example.test/api/submissions?signature=private-signature',
          pageUrl: 'https://example.test/form/?session=user-session',
          status: 503,
          ok: false,
          durationMs: 1500,
          failureKind: 'http',
          error: 'request failed: https://example.test/api/submissions?token=private-token',
          requestBody: { authorization: 'Bearer leaked', title: '表单' },
        })
        recordApiResponse({
          phase: '最终提交',
          method: 'get',
          url: 'https://example.test/api/forms/current',
          status: 200,
          ok: true,
          durationMs: 12,
        })
        recordApiResponse({
          phase: '页面初始化',
          method: 'post',
          url: 'https://analytics.example.net/collect?api_key=analytics-key',
          status: 0,
          ok: false,
          failureKind: 'network',
          error: 'net::ERR_FAILED token=analytics-token',
        })
        recordResourceResponse({
          phase: '页面初始化',
          resourceType: 'script',
          url: 'https://example.test/assets/app.js?X-Amz-Signature=signed-value',
          frameUrl: 'https://example.test/form/?credential=frame-secret',
          status: 404,
          ok: false,
          durationMs: 31,
          mimeType: 'text/html',
          failureKind: 'http',
          error: 'Not Found',
          diagnostics: ['CORS detail token=diagnostic-secret'],
          streaming: false,
        })
        recordResourceResponse({
          phase: '页面初始化',
          resourceType: 'stylesheet',
          url: 'https://example.test/assets/app.css',
          status: 200,
          ok: true,
          durationMs: 9,
          fromCache: true,
        })
        recordResourceResponse({
          phase: '页面初始化',
          resourceType: 'image',
          url: 'https://cdn.example.net/tracker.png?Expires=1234',
          status: 0,
          ok: false,
          durationMs: 50,
          failureKind: 'network',
          error: 'net::ERR_BLOCKED_BY_CLIENT',
        })
        laterWorkExecuted = true
        return { completed: true }
      },
    }),
  })

  assert.equal(laterWorkExecuted, true)
  assert.equal(result.ok, false)
  assert.equal(result.continuePipeline, true)
  assert.deepEqual(result.result, { completed: true })
  assert.deepEqual(result.networkSummary, {
    api: { observed: 3, recorded: 3, dropped: 0, passed: 1, failed: 1, warnings: 1 },
    resources: { observed: 3, recorded: 3, dropped: 0, passed: 1, failed: 2, warnings: 0 },
  })

  const failedAssertions = result.assertions.filter(({ status }) => status === 'failed')
  assert.equal(failedAssertions.length, 3)
  assert.deepEqual(failedAssertions.map(({ module }) => module), [
    '接口健康',
    '资源加载健康',
    '资源加载健康',
  ])
  assert.match(failedAssertions[0].name, /最终提交.*POST.*status=503.*request failed/)
  assert.match(failedAssertions[1].name, /页面初始化.*script.*status=404.*Not Found/)
  assert.equal(result.assertions.filter(({ status }) => status === 'passed').length, 2)

  assert.match(result.apiResponses[0].url, /signature=%5BREDACTED%5D/)
  assert.match(result.apiResponses[0].pageUrl, /session=%5BREDACTED%5D/)
  assert.doesNotMatch(JSON.stringify(result.apiResponses[0]), /private|Bearer leaked/)
  assert.match(result.resourceResponses[0].url, /X-Amz-Signature=%5BREDACTED%5D/)
  assert.match(result.resourceResponses[0].frameUrl, /credential=%5BREDACTED%5D/)
  assert.deepEqual(result.resourceResponses[0].diagnostics, ['CORS detail token=[REDACTED]'])
  assert.equal(result.resourceResponses[0].streaming, false)
  assert.equal(result.resourceResponses[1].fromCache, true)

  assert.equal(result.logs.filter(({ level }) => level === 'error').length, 3)
  assert.equal(result.logs.filter(({ message }) => /第三方.*失败/.test(message)).length, 1)
  assert.doesNotMatch(
    JSON.stringify({ logs: result.logs, resources: result.resourceResponses }),
    /private-token|analytics-token|analytics-key|diagnostic-secret/,
  )
})

test('keeps third-party API failures as warnings without failing the script', async () => {
  const result = await executeRegisteredScript(validRunPayload(), {
    loadScript: async () => ({
      run: async ({ recordApiResponse }) => {
        recordApiResponse({
          phase: '页面初始化',
          method: 'POST',
          url: 'https://third-party.example/collect',
          status: 0,
          ok: false,
          error: 'net::ERR_BLOCKED_BY_CLIENT',
        })
        return { completed: true }
      },
    }),
  })

  assert.equal(result.ok, true)
  assert.equal(result.continuePipeline, undefined)
  assert.equal(result.networkSummary.api.warnings, 1)
  assert.equal(result.assertions.length, 0)
  assert.equal(result.logs.some(({ level, message }) => (
    level === 'warning' && /第三方接口请求失败/.test(message)
  )), true)
})

test('treats the TEST public form origin and explicit custom origins as first-party while keeping vendors as warnings', async () => {
  const payload = {
    scriptId: 'form-lpxavn-submit',
    context: {
      siteBaseUrl: 'https://lx.admin.lingxi.tech/',
      apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
      authorizationOrigin: 'https://lx.admin.lingxi.tech',
      extraHTTPHeaders: { Authorization: 'Bearer test-token' },
      firstPartyOrigins: ['https://forms.customer.example/runtime-path'],
    },
  }
  const result = await executeRegisteredScript(payload, {
    loadScript: async () => ({
      run: async ({ recordApiResponse }) => {
        for (const url of [
          'https://lx.lingxi.tech/f/form/test-code',
          'https://forms.customer.example/api/form',
          'https://telemetry.vendor.example/collect',
        ]) {
          recordApiResponse({
            phase: '公开表单加载',
            method: 'GET',
            url,
            status: 503,
            ok: false,
            error: 'Service Unavailable',
          })
        }
      },
    }),
  })

  assert.deepEqual(result.apiResponses.map(({ isFirstParty }) => isFirstParty), [true, true, false])
  assert.deepEqual(result.networkSummary.api, {
    observed: 3,
    recorded: 3,
    dropped: 0,
    passed: 0,
    failed: 2,
    warnings: 1,
  })
  assert.equal(result.ok, false)
  assert.equal(result.continuePipeline, true)
  assert.equal(result.assertions.filter(({ module, status }) => (
    module === '接口健康' && status === 'failed'
  )).length, 2)
  assert.equal(result.assertions.some(({ name }) => name.includes('telemetry.vendor.example')), false)
  assert.equal(result.logs.some(({ level, message }) => (
    level === 'warning' && message.includes('telemetry.vendor.example')
  )), true)
})

test('derives the public origin for generic admin and local TEST host conventions', async () => {
  const cases = [
    {
      siteOrigin: 'https://tenant.admin.example.test',
      publicUrl: 'https://tenant.example.test/f/form/code',
    },
    {
      siteOrigin: 'https://tenant.b.lingxi-hk.localtest',
      publicUrl: 'https://tenant.f.lingxi-hk.localtest/f/form/code',
    },
  ]

  for (const { siteOrigin, publicUrl } of cases) {
    const result = await executeRegisteredScript({
      scriptId: 'form-lpxavn-submit',
      context: {
        siteBaseUrl: `${siteOrigin}/`,
        apiBaseUrl: `${siteOrigin}/api`,
        authorizationOrigin: siteOrigin,
        extraHTTPHeaders: { Authorization: 'Bearer test-token' },
      },
    }, {
      loadScript: async () => ({
        run: async ({ recordApiResponse }) => recordApiResponse({
          phase: '公开表单加载',
          method: 'GET',
          url: publicUrl,
          status: 500,
          ok: false,
          error: 'fixture failure',
        }),
      }),
    })

    assert.equal(result.apiResponses[0].isFirstParty, true, siteOrigin)
    assert.equal(result.networkSummary.api.failed, 1, siteOrigin)
    assert.equal(result.networkSummary.api.warnings, 0, siteOrigin)
  }
})

test('excludes ignored navigation aborts from resource records and health counters', async () => {
  const result = await executeRegisteredScript(validRunPayload(), {
    loadScript: async () => ({
      run: async ({ recordResourceResponse }) => {
        recordResourceResponse({
          phase: '页面跳转',
          resourceType: 'document',
          url: 'https://example.test/aborted-first',
          status: 0,
          ok: true,
          ignored: true,
          failureKind: 'aborted',
          error: 'net::ERR_ABORTED',
        })
        recordResourceResponse({
          phase: '页面加载',
          resourceType: 'script',
          url: 'https://example.test/app.js',
          status: 200,
          ok: true,
        })
        recordResourceResponse({
          phase: '页面跳转',
          resourceType: 'document',
          url: 'https://example.test/aborted-second',
          status: 0,
          ok: true,
          ignored: true,
          failureKind: 'aborted',
          error: 'net::ERR_ABORTED',
        })
        recordResourceResponse({
          phase: '页面加载',
          resourceType: 'stylesheet',
          url: 'https://example.test/app.css',
          status: 200,
          ok: true,
        })
      },
    }),
  })

  assert.deepEqual(result.resourceResponses.map(({ sequence, resourceType }) => ({
    sequence,
    resourceType,
  })), [
    { sequence: 1, resourceType: 'script' },
    { sequence: 2, resourceType: 'stylesheet' },
  ])
  assert.deepEqual(result.networkSummary.resources, {
    observed: 2,
    recorded: 2,
    dropped: 0,
    passed: 2,
    failed: 0,
    warnings: 0,
  })
  assert.equal(result.ok, true)
  assert.equal(result.logs.some(({ message }) => message.includes('ERR_ABORTED')), false)
})

test('treats same-host WebSocket errors as resource health failures', async () => {
  const result = await executeRegisteredScript(validRunPayload(), {
    loadScript: async () => ({
      run: async ({ recordResourceResponse }) => {
        recordResourceResponse({
          phase: '实时连接',
          method: 'GET',
          resourceType: 'websocket',
          url: 'wss://example.test/socket?token=socket-token',
          status: 0,
          ok: false,
          streaming: true,
          failureKind: 'websocket',
          diagnostics: ['WebSocket connection failed token=socket-diagnostic'],
        })
      },
    }),
  })

  assert.equal(result.ok, false)
  assert.equal(result.continuePipeline, true)
  assert.equal(result.resourceResponses[0].isFirstParty, true)
  assert.equal(result.resourceResponses[0].method, 'GET')
  assert.equal(result.resourceResponses[0].streaming, true)
  assert.match(result.resourceResponses[0].url, /token=%5BREDACTED%5D/)
  assert.deepEqual(result.resourceResponses[0].diagnostics, [
    'WebSocket connection failed token=[REDACTED]',
  ])
  assert.doesNotMatch(JSON.stringify(result), /socket-token|socket-diagnostic/)
  assert.equal(result.networkSummary.resources.failed, 1)
})

test('permits pipeline continuation when script and network assertions fail', async () => {
  const result = await executeRegisteredScript(validRunPayload(), {
    loadScript: async () => ({
      run: async ({ recordApiResponse }) => {
        recordedExpect(false, '业务断言失败').toBe(true)
        recordApiResponse({
          phase: '提交',
          method: 'POST',
          url: 'https://example.test/api/submit',
          status: 500,
          ok: false,
          error: 'Internal Server Error',
        })
      },
    }),
  })

  assert.equal(result.ok, false)
  assert.equal(result.continuePipeline, true)
  assert.equal(result.assertions.filter(({ status }) => status === 'failed').length, 2)
})

test('keeps captured network failures as assertions when later script work throws', async () => {
  const result = await executeRegisteredScript(validRunPayload(), {
    loadScript: async () => ({
      run: async ({ recordApiResponse }) => {
        recordApiResponse({
          phase: '页面初始化',
          method: 'GET',
          url: 'https://example.test/api/bootstrap',
          status: 503,
          ok: false,
          error: 'Service Unavailable',
        })
        throw new Error('页面控件不存在')
      },
    }),
  })

  assert.equal(result.ok, false)
  assert.equal(result.continuePipeline, undefined)
  assert.match(result.error, /页面控件不存在/)
  assert.equal(result.assertions.some((assertion) => (
    assertion.module === '接口健康'
    && assertion.status === 'failed'
    && assertion.name.includes('/api/bootstrap')
  )), true)
})

test('keeps failures when independent API and resource capture limits are reached', async () => {
  const result = await executeRegisteredScript(validRunPayload(), {
    loadScript: async () => ({
      run: async ({ recordApiResponse, recordResourceResponse }) => {
        for (let index = 0; index < 500; index += 1) {
          recordApiResponse({
            phase: '批量接口',
            method: 'GET',
            url: `https://example.test/api/items/${index}`,
            status: 200,
            ok: true,
          })
        }
        recordApiResponse({
          phase: '批量接口',
          method: 'GET',
          url: 'https://example.test/api/items/failure',
          status: 500,
          ok: false,
          error: 'fixture API failure',
        })
        for (let index = 0; index < 2_000; index += 1) {
          recordResourceResponse({
            phase: '批量资源',
            resourceType: 'image',
            url: `https://example.test/assets/${index}.png`,
            status: 200,
            ok: true,
          })
        }
        recordResourceResponse({
          phase: '批量资源',
          resourceType: 'image',
          url: 'https://example.test/assets/failure.png',
          status: 404,
          ok: false,
          error: 'fixture resource failure',
        })
      },
    }),
  })

  assert.equal(result.apiResponses.length, 500)
  assert.equal(result.resourceResponses.length, 2_000)
  assert.equal(result.apiResponses.at(-1).sequence, 501)
  assert.equal(result.apiResponses.at(-1).ok, false)
  assert.equal(result.resourceResponses.at(-1).sequence, 2_001)
  assert.equal(result.resourceResponses.at(-1).ok, false)
  assert.deepEqual(result.networkSummary.api, {
    observed: 501,
    recorded: 500,
    dropped: 1,
    passed: 500,
    failed: 1,
    warnings: 0,
  })
  assert.deepEqual(result.networkSummary.resources, {
    observed: 2_001,
    recorded: 2_000,
    dropped: 1,
    passed: 2_000,
    failed: 1,
    warnings: 0,
  })
})

test('bounds repeated network failure logs and assertion details without hiding overflow', async () => {
  const result = await executeRegisteredScript(validRunPayload(), {
    loadScript: async () => ({
      run: async ({ recordApiResponse }) => {
        for (let index = 0; index < 501; index += 1) {
          recordApiResponse({
            phase: '批量失败接口',
            method: 'GET',
            url: `https://example.test/api/failures/${index}`,
            status: 503,
            ok: false,
            error: 'Service Unavailable',
          })
        }
      },
    }),
  })

  const networkFailures = result.assertions.filter((assertion) => (
    assertion.module === '接口健康' && assertion.status === 'failed'
  ))
  assert.equal(result.apiResponses.length, 500)
  assert.equal(result.networkSummary.api.failed, 501)
  assert.equal(networkFailures.length, 501)
  assert.match(networkFailures.at(-1).name, /另有 1 个失败接口/)
  assert.equal(result.logs.filter(({ level }) => level === 'error').length, 200)
  assert.equal(result.logs.some(({ message }) => /网络失败日志超过 200 条/.test(message)), true)
})

test('stops a script at its configured timeout and reports a failure instead of interruption', async () => {
  let receivedSignal
  let cleanupFinished = false
  const config = registeredConfig({
    id: 'form-contact-publish',
    entryFile: 'form-contact-publish.ui.spec.mjs',
    timeoutMs: 1_000,
  })
  const result = await executeRegisteredScript({
    ...validRunPayload(),
    timeoutMs: 1_800_000,
  }, {
    abortCleanupTimeoutMs: 100,
    scriptConfigRepository: { get: async () => config },
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
  assert.equal(result.continuePipeline, undefined)
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
  assert.equal(result.continuePipeline, undefined)
  assert.equal(laterWorkExecuted, false)
  assert.equal(result.assertions.length, 1)
})
