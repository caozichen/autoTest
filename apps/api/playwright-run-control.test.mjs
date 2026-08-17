import assert from 'node:assert/strict'
import test from 'node:test'

import {
  closePlaywrightHandles,
  closePlaywrightOnAbort,
  throwIfRunAborted,
} from '../../scripts/playwright-run-control.mjs'

test('throws the cancellation reason only after a run is aborted', () => {
  const controller = new AbortController()

  assert.doesNotThrow(() => throwIfRunAborted(controller.signal))
  controller.abort('操作员强制停止')
  assert.throws(
    () => throwIfRunAborted(controller.signal),
    (error) => error?.name === 'AbortError' && error.message === '操作员强制停止',
  )
})

test('attempts to close both Playwright handles when one close rejects', async () => {
  const closed = []
  const warnings = []

  const result = await closePlaywrightHandles({
    context: { close: async () => { closed.push('context'); throw new Error('already closed') } },
    browser: { close: async () => { closed.push('browser') } },
  }, {
    logger: (level, message) => warnings.push({ level, message }),
  })

  assert.deepEqual(new Set(closed), new Set(['context', 'browser']))
  assert.equal(result.contextClosed, false)
  assert.equal(result.browserClosed, true)
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0].level, 'warning')
  assert.match(warnings[0].message, /浏览器上下文.*失败/)
})

test('closes Playwright handles when the run signal is aborted', async () => {
  const controller = new AbortController()
  const closed = []
  const dispose = closePlaywrightOnAbort(controller.signal, () => ({
    context: { close: async () => { closed.push('context') } },
    browser: { close: async () => { closed.push('browser') } },
  }))

  controller.abort('用户强制停止运行')
  const closeStarted = await dispose()

  assert.equal(closeStarted, true)
  assert.deepEqual(new Set(closed), new Set(['context', 'browser']))
})

test('bounds close latency and records a warning when a handle does not close', async () => {
  const warnings = []
  const startedAt = performance.now()
  const result = await closePlaywrightHandles({
    context: { close: () => new Promise(() => {}) },
    browser: { close: async () => undefined },
  }, {
    logger: (level, message) => warnings.push({ level, message }),
    timeoutMs: 15,
  })

  assert.equal(result.contextClosed, false)
  assert.equal(result.browserClosed, true)
  assert.ok(performance.now() - startedAt < 250)
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0].level, 'warning')
  assert.match(warnings[0].message, /浏览器上下文.*超过 15 ms/)
})
