import assert from 'node:assert/strict'
import * as fileSystem from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'

import {
  DEFAULT_ARTIFACT_ROOT_DIRECTORY,
  createArtifactWriter,
} from './artifact-writer.mjs'

async function temporaryArtifactRoot(t) {
  const directory = await fileSystem.mkdtemp(join(tmpdir(), 'autotest-artifacts-'))
  t.after(() => fileSystem.rm(directory, { recursive: true, force: true }))
  return directory
}

function writerFixture(rootDirectory) {
  return createArtifactWriter({
    rootDirectory,
    executionId: 'execution-001',
    stepId: 'step-001',
    attemptId: 'attempt-001',
  })
}

test('exports the repository outputs/artifacts directory as the default root', () => {
  assert.equal(
    resolve(DEFAULT_ARTIFACT_ROOT_DIRECTORY),
    resolve(import.meta.dirname, '..', '..', 'outputs', 'artifacts'),
  )
})

test('writes files atomically inside the execution, step, and attempt scope', async (t) => {
  const rootDirectory = await temporaryArtifactRoot(t)
  const writer = writerFixture(rootDirectory)
  assert.deepEqual({
    executionId: writer.executionId,
    stepId: writer.stepId,
    attemptId: writer.attemptId,
  }, {
    executionId: 'execution-001',
    stepId: 'step-001',
    attemptId: 'attempt-001',
  })
  const descriptor = await writer.writeFile('logs/result.txt', 'artifact contents', {
    encoding: 'utf8',
    type: 'console',
    mimeType: 'text/plain',
  })
  const expectedPath = join(
    rootDirectory,
    'execution-001',
    'step-001',
    'attempt-001',
    'logs',
    'result.txt',
  )

  assert.equal(await fileSystem.readFile(expectedPath, 'utf8'), 'artifact contents')
  assert.deepEqual({
    executionId: descriptor.executionId,
    stepId: descriptor.stepId,
    attemptId: descriptor.attemptId,
    absolutePath: descriptor.absolutePath,
    relativePath: descriptor.relativePath,
    type: descriptor.type,
    mimeType: descriptor.mimeType,
    sizeBytes: descriptor.sizeBytes,
  }, {
    executionId: 'execution-001',
    stepId: 'step-001',
    attemptId: 'attempt-001',
    absolutePath: expectedPath,
    relativePath: 'logs/result.txt',
    type: 'console',
    mimeType: 'text/plain',
    sizeBytes: Buffer.byteLength('artifact contents'),
  })
  assert.equal(Number.isFinite(Date.parse(descriptor.createdAt)), true)
  assert.deepEqual(writer.list(), [descriptor])
  assert.deepEqual(await fileSystem.readdir(dirname(expectedPath)), ['result.txt'])
})

test('captures producer output through a temporary file in the target directory', async (t) => {
  const rootDirectory = await temporaryArtifactRoot(t)
  const writer = writerFixture(rootDirectory)
  let producerPath

  const descriptor = await writer.capture('traces/trace.zip', async (temporaryPath) => {
    producerPath = temporaryPath
    await fileSystem.writeFile(temporaryPath, Buffer.from('trace archive'))
  }, { type: 'trace', mimeType: 'application/zip' })

  assert.equal(dirname(producerPath), dirname(descriptor.absolutePath))
  assert.notEqual(producerPath, descriptor.absolutePath)
  assert.match(producerPath, /^.*\.trace\.\d+\.[^.]+\.tmp\.zip$/)
  assert.equal(await fileSystem.readFile(descriptor.absolutePath, 'utf8'), 'trace archive')
  assert.equal(descriptor.type, 'trace')
  assert.equal(descriptor.mimeType, 'application/zip')
})

test('captures screenshots with a forced temporary path and screenshot metadata', async (t) => {
  const rootDirectory = await temporaryArtifactRoot(t)
  const writer = writerFixture(rootDirectory)
  let receivedOptions
  const page = {
    async screenshot(options) {
      receivedOptions = options
      await fileSystem.writeFile(options.path, Buffer.from('fake png'))
      return Buffer.from('fake png')
    },
  }

  const descriptor = await writer.captureScreenshot(page, 'screenshots/failure.png', {
    fullPage: true,
    path: '/untrusted/ignored.png',
  })

  assert.equal(receivedOptions.fullPage, true)
  assert.equal(receivedOptions.type, 'png')
  assert.notEqual(receivedOptions.path, '/untrusted/ignored.png')
  assert.equal(dirname(receivedOptions.path), dirname(descriptor.absolutePath))
  assert.equal(descriptor.type, 'screenshot')
  assert.equal(descriptor.mimeType, 'image/png')
  assert.equal(await fileSystem.readFile(descriptor.absolutePath, 'utf8'), 'fake png')
})

test('rejects unsafe scope identifiers', async (t) => {
  const rootDirectory = await temporaryArtifactRoot(t)
  for (const [field, value] of [
    ['executionId', '../execution'],
    ['stepId', 'step/one'],
    ['attemptId', 'attempt.one'],
    ['attemptId', 'attempt\ncontrol'],
  ]) {
    assert.throws(() => createArtifactWriter({
      rootDirectory,
      executionId: 'execution-001',
      stepId: 'step-001',
      attemptId: 'attempt-001',
      [field]: value,
    }), /格式无效/)
  }
})

test('rejects absolute, traversal, backslash, dot, NUL, and control-character paths', async (t) => {
  const rootDirectory = await temporaryArtifactRoot(t)
  const writer = writerFixture(rootDirectory)
  const unsafePaths = [
    '/tmp/outside.txt',
    'C:/outside.txt',
    '../outside.txt',
    'nested/../outside.txt',
    '.',
    './artifact.txt',
    'nested/./artifact.txt',
    'nested\\artifact.txt',
    'nested//artifact.txt',
    'nul\0artifact.txt',
    'line\nartifact.txt',
    'delete\u007fartifact.txt',
  ]

  for (const relativePath of unsafePaths) {
    await assert.rejects(writer.writeFile(relativePath, 'unsafe'))
  }
  assert.deepEqual(writer.list(), [])
  assert.deepEqual(await fileSystem.readdir(rootDirectory).catch(() => []), [])
})

test('cleans a failed producer temporary file and does not register an artifact', async (t) => {
  const rootDirectory = await temporaryArtifactRoot(t)
  const writer = writerFixture(rootDirectory)
  let temporaryPath

  await assert.rejects(
    writer.capture('screenshots/failure.png', async (targetPath) => {
      temporaryPath = targetPath
      await fileSystem.writeFile(targetPath, Buffer.from('partial screenshot'))
      throw new Error('fixture producer failure')
    }, { type: 'screenshot', mimeType: 'image/png' }),
    /fixture producer failure/,
  )

  assert.deepEqual(writer.list(), [])
  await assert.rejects(fileSystem.access(temporaryPath))
  await assert.rejects(fileSystem.access(join(
    rootDirectory,
    'execution-001',
    'step-001',
    'attempt-001',
    'screenshots',
    'failure.png',
  )))
  assert.deepEqual(await fileSystem.readdir(dirname(temporaryPath)), [])
})

test('seal waits for captures already in progress and freezes the returned artifact list', async (t) => {
  const rootDirectory = await temporaryArtifactRoot(t)
  const writer = writerFixture(rootDirectory)
  let releaseProducer
  let notifyProducerStarted
  const producerStarted = new Promise((resolveStarted) => { notifyProducerStarted = resolveStarted })
  const producerRelease = new Promise((resolveProducer) => { releaseProducer = resolveProducer })
  const capture = writer.capture('traces/trace.zip', async (temporaryPath) => {
    notifyProducerStarted()
    await producerRelease
    await fileSystem.writeFile(temporaryPath, Buffer.from('sealed trace'))
  }, { type: 'trace', mimeType: 'application/zip' })
  await producerStarted

  const sealing = writer.seal({ timeoutMs: 200 })
  await assert.rejects(
    writer.writeFile('late.txt', 'too late'),
    /已封口/,
  )
  releaseProducer()
  const descriptor = await capture
  const sealed = await sealing

  assert.equal(sealed.timedOut, false)
  assert.equal(sealed.abandonedCaptureCount, 0)
  assert.deepEqual(sealed.artifacts, [descriptor])
  assert.deepEqual(writer.list(), [descriptor])
})

test('seal timeout discards a late producer result without renaming or registering it', async (t) => {
  const rootDirectory = await temporaryArtifactRoot(t)
  const writer = writerFixture(rootDirectory)
  let temporaryPath
  let releaseProducer
  let notifyProducerStarted
  const producerStarted = new Promise((resolveStarted) => { notifyProducerStarted = resolveStarted })
  const producerRelease = new Promise((resolveProducer) => { releaseProducer = resolveProducer })
  const capture = writer.capture('screenshots/late.png', async (targetPath) => {
    temporaryPath = targetPath
    notifyProducerStarted()
    await producerRelease
    await fileSystem.writeFile(targetPath, Buffer.from('late screenshot'))
  }, { type: 'screenshot', mimeType: 'image/png' })
  await producerStarted

  const sealed = await writer.seal({ timeoutMs: 10 })
  const finalPath = join(
    rootDirectory,
    'execution-001',
    'step-001',
    'attempt-001',
    'screenshots',
    'late.png',
  )
  assert.equal(sealed.timedOut, true)
  assert.equal(sealed.abandonedCaptureCount, 1)
  assert.deepEqual(sealed.artifacts, [])
  await assert.rejects(fileSystem.access(finalPath))

  releaseProducer()
  await assert.rejects(capture, /已封口/)
  await assert.rejects(fileSystem.access(temporaryPath))
  await assert.rejects(fileSystem.access(finalPath))
  assert.deepEqual(writer.list(), [])
  assert.deepEqual(await fileSystem.readdir(dirname(finalPath)), [])
})
