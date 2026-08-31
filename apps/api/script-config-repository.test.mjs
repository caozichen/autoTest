import assert from 'node:assert/strict'
import * as fileSystem from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  FileScriptConfigRepository,
  ScriptConfigStoreError,
  resolveScriptEntryUrl,
  validateScriptConfig,
} from './script-config-repository.mjs'

const firstTime = '2026-08-31T08:00:00.000Z'
const secondTime = '2026-08-31T08:01:00.000Z'

function configFixture({
  id = 'example-script',
  revision = 0,
  entryFile = 'example.ui.spec.mjs',
  updatedAt = firstTime,
  enabled = true,
} = {}) {
  return {
    schemaVersion: 1,
    revision,
    id,
    name: '示例自动化脚本',
    description: '验证文件脚本配置仓储',
    directory: 'scripts',
    entryFile,
    timeoutMs: 300_000,
    enabled,
    requestPath: '/form/?id={{FORM_CODE}}',
    inputParameters: [{
      id: 'form-code',
      key: 'FORM_CODE',
      value: 'fixture',
      description: '表单代码',
    }],
    responseVariableBindings: [{
      id: 'response-form-id',
      variableName: 'FORM_ID',
      responsePath: 'formId',
      secret: false,
    }],
    tags: ['Playwright', 'P0'],
    createdAt: firstTime,
    updatedAt,
  }
}

async function temporaryWorkspace(t) {
  const root = await fileSystem.mkdtemp(join(tmpdir(), 'autotest-script-configs-'))
  const directory = join(root, 'config', 'scripts')
  const scriptsDirectory = join(root, 'scripts')
  await fileSystem.mkdir(scriptsDirectory, { recursive: true })
  await fileSystem.writeFile(
    join(scriptsDirectory, 'example.ui.spec.mjs'),
    'export async function run() { return { ok: true } }\n',
  )
  t.after(() => fileSystem.rm(root, { recursive: true, force: true }))
  return { root, directory, scriptsDirectory }
}

test('persists one validated JSON file per script and restores it after restart', async (t) => {
  const { directory, scriptsDirectory } = await temporaryWorkspace(t)
  const now = new Date(secondTime)
  const repository = new FileScriptConfigRepository({
    directory,
    scriptsDirectory,
    now: () => now,
  })

  const created = await repository.create(configFixture())

  assert.equal(created.createdAt, secondTime)
  assert.equal(created.updatedAt, secondTime)
  assert.deepEqual(await fileSystem.readdir(directory), ['example-script.json'])
  const persisted = JSON.parse(await fileSystem.readFile(
    join(directory, 'example-script.json'),
    'utf8',
  ))
  assert.deepEqual(persisted, created)
  assert.deepEqual(
    await new FileScriptConfigRepository({ directory, scriptsDirectory }).get(created.id),
    created,
  )
})

test('uses revision and updatedAt CAS for update and server-owned timestamps', async (t) => {
  const { directory, scriptsDirectory } = await temporaryWorkspace(t)
  let now = new Date(firstTime)
  const repository = new FileScriptConfigRepository({
    directory,
    scriptsDirectory,
    now: () => now,
  })
  const original = await repository.create(configFixture())
  now = new Date(secondTime)
  const submitted = {
    ...original,
    revision: 99,
    name: '已修改的脚本',
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
  }

  const updated = await repository.update(original.id, submitted, {
    expectedRevision: original.revision,
    expectedUpdatedAt: original.updatedAt,
  })

  assert.equal(updated.revision, 1)
  assert.equal(updated.name, '已修改的脚本')
  assert.equal(updated.createdAt, original.createdAt)
  assert.equal(updated.updatedAt, secondTime)
  await assert.rejects(
    repository.update(original.id, submitted, {
      expectedRevision: original.revision,
      expectedUpdatedAt: original.updatedAt,
    }),
    (error) => error instanceof ScriptConfigStoreError
      && error.statusCode === 409
      && error.code === 'SCRIPT_CONFIG_CONFLICT',
  )
})

test('reloads disk state before CAS so another repository cannot be overwritten', async (t) => {
  const { directory, scriptsDirectory } = await temporaryWorkspace(t)
  let now = new Date(firstTime)
  const firstRepository = new FileScriptConfigRepository({
    directory,
    scriptsDirectory,
    now: () => now,
  })
  const original = await firstRepository.create(configFixture())
  const secondRepository = new FileScriptConfigRepository({
    directory,
    scriptsDirectory,
    now: () => now,
  })

  now = new Date(secondTime)
  const updated = await secondRepository.update(original.id, {
    ...original,
    name: '其它仓储已修改',
  }, {
    expectedRevision: original.revision,
    expectedUpdatedAt: original.updatedAt,
  })

  await assert.rejects(
    firstRepository.update(original.id, { ...original, name: '过期写入' }, {
      expectedRevision: original.revision,
      expectedUpdatedAt: original.updatedAt,
    }),
    (error) => error instanceof ScriptConfigStoreError
      && error.statusCode === 409
      && error.code === 'SCRIPT_CONFIG_CONFLICT',
  )
  assert.deepEqual(await firstRepository.get(original.id), updated)
})

test('uses CAS when deleting and removes only the target configuration', async (t) => {
  const { directory, scriptsDirectory } = await temporaryWorkspace(t)
  const repository = new FileScriptConfigRepository({ directory, scriptsDirectory })
  const original = await repository.create(configFixture())

  await assert.rejects(
    repository.remove(original.id, {
      expectedRevision: original.revision + 1,
      expectedUpdatedAt: original.updatedAt,
    }),
    (error) => error instanceof ScriptConfigStoreError && error.statusCode === 409,
  )
  await repository.remove(original.id, {
    expectedRevision: original.revision,
    expectedUpdatedAt: original.updatedAt,
  })

  assert.equal(await repository.get(original.id), null)
  const storedFiles = await fileSystem.readdir(directory).catch((error) => {
    if (error?.code === 'ENOENT') return []
    throw error
  })
  assert.deepEqual(storedFiles, [])
})

test('keeps the previous configuration intact when atomic rename fails', async (t) => {
  const { directory, scriptsDirectory } = await temporaryWorkspace(t)
  const original = await new FileScriptConfigRepository({
    directory,
    scriptsDirectory,
  }).create(configFixture())
  const failingFileSystem = {
    ...fileSystem,
    async rename() {
      throw new Error('fixture rename failure')
    },
  }
  const repository = new FileScriptConfigRepository({
    directory,
    scriptsDirectory,
    fileSystem: failingFileSystem,
    now: () => new Date(secondTime),
  })

  await assert.rejects(
    repository.update(original.id, { ...original, name: '不能覆盖原文件' }, {
      expectedRevision: original.revision,
      expectedUpdatedAt: original.updatedAt,
    }),
    /fixture rename failure/,
  )

  assert.deepEqual(
    await new FileScriptConfigRepository({ directory, scriptsDirectory }).get(original.id),
    original,
  )
  assert.equal((await fileSystem.readdir(directory)).some((name) => name.endsWith('.tmp')), false)
})

test('does not overwrite an invalid configuration that already occupies the id', async (t) => {
  const { directory, scriptsDirectory } = await temporaryWorkspace(t)
  await fileSystem.mkdir(directory, { recursive: true })
  const targetPath = join(directory, 'example-script.json')
  const invalidContents = '{ "schemaVersion": 1, "damaged": true }\n'
  await fileSystem.writeFile(targetPath, invalidContents)
  const warnings = []
  const repository = new FileScriptConfigRepository({
    directory,
    scriptsDirectory,
    warningLogger: (message) => warnings.push(message),
  })

  await assert.rejects(
    repository.create(configFixture()),
    (error) => error instanceof ScriptConfigStoreError
      && error.statusCode === 409
      && error.code === 'SCRIPT_CONFIG_EXISTS',
  )
  assert.equal(await fileSystem.readFile(targetPath, 'utf8'), invalidContents)
  assert.equal(warnings.some((message) => message.includes('example-script.json')), true)
})

test('rejects unsafe ids, fields, paths, missing files, and symlink escapes', async (t) => {
  const { root, directory, scriptsDirectory } = await temporaryWorkspace(t)
  const repository = new FileScriptConfigRepository({ directory, scriptsDirectory })

  for (const invalid of [
    configFixture({ id: '../../outside' }),
    { ...configFixture(), directory: '../scripts' },
    configFixture({ entryFile: '../outside.mjs' }),
    configFixture({ entryFile: 'example.js' }),
    configFixture({ entryFile: 'missing.ui.spec.mjs' }),
    { ...configFixture(), requestPath: 'https://outside.test/form' },
    { ...configFixture(), tags: ['P0', 123] },
    { ...configFixture(), timeoutMs: 999 },
  ]) {
    await assert.rejects(repository.create(invalid), ScriptConfigStoreError)
  }

  const outsidePath = join(root, 'outside.mjs')
  await fileSystem.writeFile(outsidePath, 'export async function run() {}\n')
  await fileSystem.symlink(outsidePath, join(scriptsDirectory, 'escaped.ui.spec.mjs'))
  await assert.rejects(
    repository.create(configFixture({ entryFile: 'escaped.ui.spec.mjs' })),
    (error) => error instanceof ScriptConfigStoreError && error.code === 'UNSAFE_SCRIPT_ENTRY',
  )
  const storedFiles = await fileSystem.readdir(directory).catch((error) => {
    if (error?.code === 'ENOENT') return []
    throw error
  })
  assert.deepEqual(storedFiles, [])
})

test('resolves only a real .mjs file inside the real scripts directory', async (t) => {
  const { scriptsDirectory } = await temporaryWorkspace(t)
  const config = validateScriptConfig(configFixture())
  const url = await resolveScriptEntryUrl(config, { scriptsDirectory })

  assert.equal(url.protocol, 'file:')
  assert.equal(url.pathname.endsWith('/scripts/example.ui.spec.mjs'), true)
})
