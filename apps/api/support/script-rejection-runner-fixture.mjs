import * as fileSystem from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createRunnerServer } from '../server.mjs'

const fixtureRoot = await fileSystem.mkdtemp(join(tmpdir(), 'autotest-rejection-runner-'))
const scriptConfigDirectory = join(fixtureRoot, 'config')
const scriptsDirectory = join(fixtureRoot, 'scripts')
const artifactRootDirectory = join(fixtureRoot, 'artifacts')
const runRecordDirectory = join(fixtureRoot, 'records')
await Promise.all([
  fileSystem.mkdir(scriptConfigDirectory, { recursive: true }),
  fileSystem.mkdir(scriptsDirectory, { recursive: true }),
])

await fileSystem.writeFile(join(scriptsDirectory, 'rejection-fixture.ui.spec.mjs'), `
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

export async function run({ variables, logger }) {
  if (variables.MODE === 'watcher-first') {
    void new Promise((_, reject) => {
      setTimeout(() => reject(new Error('watcher failed before action')), 20)
    })
    await new Promise((_, reject) => {
      setTimeout(() => reject(new Error('action failed after watcher')), 80)
    })
  }

  if (variables.MODE === 'watcher-first-cancel-later') {
    void new Promise((_, reject) => {
      setTimeout(() => reject(new Error('watcher won before user cancellation')), 20)
    })
    await new Promise((_, reject) => {
      setTimeout(() => reject(new Error('slow action cleanup completed')), 180)
    })
  }

  if (variables.MODE === 'cancel-first') {
    logger('info', 'cancel-first-started')
    void new Promise((_, reject) => {
      setTimeout(() => reject(new Error('watcher rejected during cancellation cleanup')), 80)
    })
    await new Promise((_, reject) => {
      setTimeout(() => reject(new Error('cancelled action cleanup completed')), 140)
    })
  }

  if (variables.MODE === 'action-first') {
    void new Promise((_, reject) => {
      setTimeout(() => reject(new Error('late watcher contains TOP_SECRET')), 80)
    })
    await delay(20)
    throw new Error('action failed first')
  }

  await delay(100)
  return { mode: variables.MODE, completed: true }
}
`)

await fileSystem.writeFile(
  join(scriptConfigDirectory, 'rejection-fixture.json'),
  `${JSON.stringify({
    schemaVersion: 1,
    revision: 0,
    id: 'rejection-fixture',
    name: '异步拒绝隔离测试脚本',
    description: '仅供 Runner 子进程测试使用',
    directory: 'scripts',
    entryFile: 'rejection-fixture.ui.spec.mjs',
    timeoutMs: 2_000,
    enabled: true,
    tags: ['fixture'],
    createdAt: '2026-09-08T00:00:00.000Z',
    updatedAt: '2026-09-08T00:00:00.000Z',
  }, null, 2)}\n`,
)

const server = createRunnerServer({
  artifactRootDirectory,
  runRecordDirectory,
  scriptConfigDirectory,
  scriptsDirectory,
})

async function shutdown() {
  await new Promise((resolve) => server.close(resolve))
  await fileSystem.rm(fixtureRoot, { recursive: true, force: true })
}

process.on('message', (message) => {
  if (message?.type === 'trigger-unscoped-rejection') {
    setTimeout(() => {
      void Promise.reject(new Error('unscoped rejection contains TOP_SECRET'))
    }, 0)
    setTimeout(() => process.send?.({ type: 'unscoped-rejection-triggered' }), 50)
    return
  }
  if (message?.type === 'shutdown') {
    void shutdown().then(() => process.exit(0))
  }
})

server.listen(0, '127.0.0.1', () => {
  const address = server.address()
  process.send?.({ type: 'ready', port: address.port })
})
