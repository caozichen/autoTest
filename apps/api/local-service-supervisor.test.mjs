import assert from 'node:assert/strict'
import test from 'node:test'

import { createServiceStarter } from '../../scripts/local-service-supervisor.mjs'

test('does not start another process when a supervised service is healthy', async () => {
  let processStarts = 0
  const starter = createServiceStarter({
    name: 'Runner',
    isHealthy: async () => true,
    startProcess: () => { processStarts += 1; return 1001 },
  })

  assert.deepEqual(await starter.start(), { status: 'already-running' })
  assert.equal(processStarts, 0)
})

test('starts a service and waits for its health check', async () => {
  const healthStates = [false, false, true]
  const starter = createServiceStarter({
    name: 'Runner',
    isHealthy: async () => healthStates.shift() ?? true,
    startProcess: () => 1002,
    waitForDelay: async () => undefined,
    pollAttempts: 3,
  })

  assert.deepEqual(await starter.start(), { status: 'started', pid: 1002 })
})

test('deduplicates concurrent service start requests', async () => {
  let healthy = false
  let processStarts = 0
  const starter = createServiceStarter({
    name: 'Runner',
    isHealthy: async () => healthy,
    startProcess: () => {
      processStarts += 1
      healthy = true
      return 1003
    },
  })

  assert.deepEqual(await Promise.all([starter.start(), starter.start()]), [
    { status: 'started', pid: 1003 },
    { status: 'started', pid: 1003 },
  ])
  assert.equal(processStarts, 1)
})

test('reports a service that fails its startup health check', async () => {
  const starter = createServiceStarter({
    name: 'Runner',
    isHealthy: async () => false,
    startProcess: () => 1004,
    waitForDelay: async () => undefined,
    pollAttempts: 2,
  })

  await assert.rejects(starter.start(), /Runner 启动命令已执行，但健康检查未在 5 秒内通过/)
})
