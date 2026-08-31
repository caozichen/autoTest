import { randomUUID } from 'node:crypto'
import * as defaultFileSystem from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const DEFAULT_SCRIPT_CONFIG_DIRECTORY = fileURLToPath(
  new URL('../../config/scripts/', import.meta.url),
)
export const DEFAULT_SCRIPTS_DIRECTORY = fileURLToPath(new URL('../../scripts/', import.meta.url))
export const DEFAULT_SCRIPT_TIMEOUT_MS = 300_000
export const MIN_SCRIPT_TIMEOUT_MS = 1_000
export const MAX_SCRIPT_TIMEOUT_MS = 1_800_000
export const SAFE_SCRIPT_CONFIG_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/

const ENTRY_FILE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.mjs$/
const VARIABLE_PATTERN = /{{\s*([^{}]+?)\s*}}/g

export class ScriptConfigStoreError extends Error {
  constructor(message, { statusCode = 400, code = 'INVALID_SCRIPT_CONFIG' } = {}) {
    super(message)
    this.name = 'ScriptConfigStoreError'
    this.statusCode = statusCode
    this.code = code
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizedString(value, label, {
  allowEmpty = false,
  maxLength = 5_000,
} = {}) {
  if (typeof value !== 'string') {
    throw new ScriptConfigStoreError(`${label}必须是字符串`)
  }
  const normalized = value.trim()
  if (!allowEmpty && !normalized) throw new ScriptConfigStoreError(`${label}不能为空`)
  if (normalized.length > maxLength) {
    throw new ScriptConfigStoreError(`${label}不能超过 ${maxLength} 个字符`)
  }
  return normalized
}

function normalizedDateString(value, label) {
  const normalized = normalizedString(value, label, { maxLength: 100 })
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new ScriptConfigStoreError(`${label}不是有效时间`)
  }
  return normalized
}

export function assertSafeScriptConfigId(value) {
  if (typeof value !== 'string' || !SAFE_SCRIPT_CONFIG_ID_PATTERN.test(value)) {
    throw new ScriptConfigStoreError('脚本 ID 格式无效，只允许小写字母、数字和短横线')
  }
  return value
}

function normalizeRequestPath(value) {
  if (value === undefined) return undefined
  const requestPath = normalizedString(value, 'requestPath', { maxLength: 2_000 })
  if (/^[a-z][a-z\d+.-]*:/i.test(requestPath) || requestPath.startsWith('//')) {
    throw new ScriptConfigStoreError('requestPath 必须是相对路径')
  }
  const pathWithoutVariables = requestPath.replace(VARIABLE_PATTERN, 'VARIABLE')
  if (/[{}]/.test(pathWithoutVariables)) {
    throw new ScriptConfigStoreError('requestPath 中的动态变量格式无效')
  }
  if (/\s/.test(pathWithoutVariables)) {
    throw new ScriptConfigStoreError('requestPath 不能包含变量外的空格或换行')
  }
  if (requestPath.includes('\\')) {
    throw new ScriptConfigStoreError('requestPath 不能包含反斜杠')
  }
  return requestPath.startsWith('/') ? requestPath : `/${requestPath}`
}

function normalizeInputParameters(value) {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    throw new ScriptConfigStoreError('inputParameters 必须是数组')
  }
  const parameters = value.map((parameter, index) => {
    if (!isObject(parameter)) {
      throw new ScriptConfigStoreError(`inputParameters[${index}] 必须是对象`)
    }
    return {
      id: normalizedString(parameter.id, `inputParameters[${index}].id`, { maxLength: 100 }),
      key: normalizedString(parameter.key, `inputParameters[${index}].key`, { maxLength: 100 }),
      value: normalizedString(parameter.value, `inputParameters[${index}].value`, {
        allowEmpty: true,
        maxLength: 100_000,
      }),
      description: normalizedString(
        parameter.description,
        `inputParameters[${index}].description`,
        { allowEmpty: true, maxLength: 1_000 },
      ),
    }
  })
  const ids = parameters.map(({ id }) => id)
  if (new Set(ids).size !== ids.length) {
    throw new ScriptConfigStoreError('inputParameters 不能包含重复 ID')
  }
  const keys = parameters.map(({ key }) => key.toLowerCase())
  if (new Set(keys).size !== keys.length) {
    throw new ScriptConfigStoreError('inputParameters 不能包含重复参数名')
  }
  return parameters
}

function normalizeResponseVariableBindings(value) {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    throw new ScriptConfigStoreError('responseVariableBindings 必须是数组')
  }
  const bindings = value.map((binding, index) => {
    if (!isObject(binding)) {
      throw new ScriptConfigStoreError(`responseVariableBindings[${index}] 必须是对象`)
    }
    if (typeof binding.secret !== 'boolean') {
      throw new ScriptConfigStoreError(`responseVariableBindings[${index}].secret 必须是布尔值`)
    }
    return {
      id: normalizedString(binding.id, `responseVariableBindings[${index}].id`, {
        maxLength: 100,
      }),
      variableName: normalizedString(
        binding.variableName,
        `responseVariableBindings[${index}].variableName`,
        { maxLength: 100 },
      ),
      responsePath: normalizedString(
        binding.responsePath,
        `responseVariableBindings[${index}].responsePath`,
        { maxLength: 500 },
      ),
      secret: binding.secret,
    }
  })
  const ids = bindings.map(({ id }) => id)
  if (new Set(ids).size !== ids.length) {
    throw new ScriptConfigStoreError('responseVariableBindings 不能包含重复 ID')
  }
  const names = bindings.map(({ variableName }) => variableName.toLowerCase())
  if (new Set(names).size !== names.length) {
    throw new ScriptConfigStoreError('responseVariableBindings 不能包含重复变量名')
  }
  return bindings
}

function normalizeTags(value) {
  if (!Array.isArray(value)) throw new ScriptConfigStoreError('tags 必须是字符串数组')
  const tags = value.map((tag, index) => normalizedString(tag, `tags[${index}]`, {
    maxLength: 100,
  }))
  if (new Set(tags).size !== tags.length) {
    throw new ScriptConfigStoreError('tags 不能包含重复值')
  }
  return tags
}

function normalizeScriptFields(value) {
  if (!isObject(value)) throw new ScriptConfigStoreError('脚本配置必须是对象')
  const directory = normalizedString(value.directory, 'directory', { maxLength: 100 })
  if (directory !== 'scripts') {
    throw new ScriptConfigStoreError('directory 只允许使用项目 scripts 目录')
  }
  const entryFile = normalizedString(value.entryFile, 'entryFile', { maxLength: 255 })
  if (!ENTRY_FILE_PATTERN.test(entryFile)) {
    throw new ScriptConfigStoreError('entryFile 必须是 scripts 目录下不含路径的 .mjs 文件名')
  }
  if (!Number.isInteger(value.timeoutMs)
    || value.timeoutMs < MIN_SCRIPT_TIMEOUT_MS
    || value.timeoutMs > MAX_SCRIPT_TIMEOUT_MS) {
    throw new ScriptConfigStoreError(
      `timeoutMs 必须是 ${MIN_SCRIPT_TIMEOUT_MS} 到 ${MAX_SCRIPT_TIMEOUT_MS} 之间的整数`,
    )
  }
  if (typeof value.enabled !== 'boolean') {
    throw new ScriptConfigStoreError('enabled 必须是布尔值')
  }

  const requestPath = normalizeRequestPath(value.requestPath)
  const inputParameters = normalizeInputParameters(value.inputParameters)
  const responseVariableBindings = normalizeResponseVariableBindings(value.responseVariableBindings)
  return {
    name: normalizedString(value.name, 'name', { maxLength: 200 }),
    description: normalizedString(value.description, 'description', {
      allowEmpty: true,
      maxLength: 10_000,
    }),
    directory,
    entryFile,
    timeoutMs: value.timeoutMs,
    enabled: value.enabled,
    ...(requestPath === undefined ? {} : { requestPath }),
    ...(inputParameters === undefined ? {} : { inputParameters }),
    ...(responseVariableBindings === undefined ? {} : { responseVariableBindings }),
    tags: normalizeTags(value.tags),
  }
}

export function validateScriptConfig(value) {
  if (!isObject(value)) throw new ScriptConfigStoreError('脚本配置必须是对象')
  if (value.schemaVersion !== 1) {
    throw new ScriptConfigStoreError('脚本配置 schemaVersion 无效')
  }
  assertSafeScriptConfigId(value.id)
  if (!Number.isInteger(value.revision) || value.revision < 0) {
    throw new ScriptConfigStoreError('脚本配置 revision 必须是非负整数')
  }
  const createdAt = normalizedDateString(value.createdAt, 'createdAt')
  const updatedAt = normalizedDateString(value.updatedAt, 'updatedAt')
  return {
    schemaVersion: 1,
    revision: value.revision,
    id: value.id,
    ...normalizeScriptFields(value),
    createdAt,
    updatedAt,
  }
}

function newestFirst(left, right) {
  const difference = Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  return difference || left.id.localeCompare(right.id)
}

async function realScriptEntry(config, { fileSystem, scriptsDirectory }) {
  let scriptsRoot
  let entryPath
  try {
    scriptsRoot = await fileSystem.realpath(scriptsDirectory)
    entryPath = await fileSystem.realpath(resolve(scriptsRoot, config.entryFile))
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new ScriptConfigStoreError(`脚本入口文件不存在：scripts/${config.entryFile}`, {
        code: 'SCRIPT_ENTRY_NOT_FOUND',
      })
    }
    throw error
  }
  const relativeEntry = relative(scriptsRoot, entryPath)
  if (!relativeEntry || relativeEntry.startsWith('..') || isAbsolute(relativeEntry)) {
    throw new ScriptConfigStoreError('脚本入口必须位于项目 scripts 目录内', {
      code: 'UNSAFE_SCRIPT_ENTRY',
    })
  }
  const entryStat = await fileSystem.stat(entryPath)
  if (!entryStat.isFile()) {
    throw new ScriptConfigStoreError('脚本入口必须是文件', {
      code: 'INVALID_SCRIPT_ENTRY',
    })
  }
  return entryPath
}

export async function resolveScriptEntryUrl(config, {
  fileSystem = defaultFileSystem,
  scriptsDirectory = DEFAULT_SCRIPTS_DIRECTORY,
} = {}) {
  const normalized = validateScriptConfig(config)
  const entryPath = await realScriptEntry(normalized, { fileSystem, scriptsDirectory })
  return pathToFileURL(entryPath)
}

// File-backed implementation of the ScriptConfigRepository contract. Callers only depend on
// list/get/create/update/remove, so a future MySQL repository can replace it without API changes.
export class FileScriptConfigRepository {
  constructor({
    directory = DEFAULT_SCRIPT_CONFIG_DIRECTORY,
    scriptsDirectory = DEFAULT_SCRIPTS_DIRECTORY,
    fileSystem = defaultFileSystem,
    temporaryIdFactory = randomUUID,
    now = () => new Date(),
    warningLogger = (message) => console.warn(message),
  } = {}) {
    if (typeof directory !== 'string' || !directory) {
      throw new Error('FileScriptConfigRepository 需要存储目录')
    }
    if (typeof scriptsDirectory !== 'string' || !scriptsDirectory) {
      throw new Error('FileScriptConfigRepository 需要脚本目录')
    }
    this.directory = directory
    this.scriptsDirectory = scriptsDirectory
    this.fileSystem = fileSystem
    this.temporaryIdFactory = temporaryIdFactory
    this.now = now
    this.warningLogger = warningLogger
    this.configs = new Map()
    this.storedConfigIds = new Set()
    this.readyPromise = null
    this.mutationTail = Promise.resolve()
  }

  async list() {
    return this.mutate(() => [...this.configs.values()]
      .sort(newestFirst)
      .map((config) => structuredClone(config)))
  }

  async get(id) {
    assertSafeScriptConfigId(id)
    return this.mutate(() => {
      const config = this.configs.get(id)
      return config ? structuredClone(config) : null
    })
  }

  async create(value) {
    const submitted = validateScriptConfig(value)
    if (submitted.revision !== 0) {
      throw new ScriptConfigStoreError('新脚本配置 revision 必须为 0')
    }
    const timestamp = this.currentTimestamp()
    const config = {
      ...submitted,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await this.assertEntryFile(config)
    return this.mutate(async () => {
      if (this.storedConfigIds.has(config.id)) {
        throw new ScriptConfigStoreError('脚本配置 ID 已存在', {
          statusCode: 409,
          code: 'SCRIPT_CONFIG_EXISTS',
        })
      }
      await this.writeConfig(config, { createOnly: true })
      return structuredClone(config)
    })
  }

  async update(id, value, { expectedRevision, expectedUpdatedAt } = {}) {
    assertSafeScriptConfigId(id)
    const submitted = validateScriptConfig(value)
    if (submitted.id !== id) {
      throw new ScriptConfigStoreError('URL 与脚本配置中的 ID 不一致')
    }
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new ScriptConfigStoreError('expectedRevision 必须是非负整数')
    }
    normalizedDateString(expectedUpdatedAt, 'expectedUpdatedAt')

    return this.mutate(async () => {
      const current = this.configs.get(id)
      if (!current) {
        throw new ScriptConfigStoreError('脚本配置不存在', {
          statusCode: 404,
          code: 'SCRIPT_CONFIG_NOT_FOUND',
        })
      }
      if (current.revision !== expectedRevision || current.updatedAt !== expectedUpdatedAt) {
        throw new ScriptConfigStoreError('脚本配置已在其它页面更新，请刷新后重试', {
          statusCode: 409,
          code: 'SCRIPT_CONFIG_CONFLICT',
        })
      }
      const updated = {
        ...submitted,
        schemaVersion: 1,
        revision: current.revision + 1,
        id,
        createdAt: current.createdAt,
        updatedAt: this.currentTimestamp(),
      }
      await this.assertEntryFile(updated)
      await this.writeConfig(updated)
      return structuredClone(updated)
    })
  }

  async remove(id, { expectedRevision, expectedUpdatedAt } = {}) {
    assertSafeScriptConfigId(id)
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new ScriptConfigStoreError('expectedRevision 必须是非负整数')
    }
    normalizedDateString(expectedUpdatedAt, 'expectedUpdatedAt')
    return this.mutate(async () => {
      const current = this.configs.get(id)
      if (!current) {
        throw new ScriptConfigStoreError('脚本配置不存在', {
          statusCode: 404,
          code: 'SCRIPT_CONFIG_NOT_FOUND',
        })
      }
      if (current.revision !== expectedRevision || current.updatedAt !== expectedUpdatedAt) {
        throw new ScriptConfigStoreError('脚本配置已在其它页面更新，请刷新后重试', {
          statusCode: 409,
          code: 'SCRIPT_CONFIG_CONFLICT',
        })
      }
      await this.fileSystem.unlink(join(this.directory, `${id}.json`))
      this.configs.delete(id)
      this.storedConfigIds.delete(id)
    })
  }

  currentTimestamp() {
    const timestamp = this.now()
    if (!(timestamp instanceof Date) || !Number.isFinite(timestamp.getTime())) {
      throw new ScriptConfigStoreError('系统时间无效', {
        statusCode: 500,
        code: 'INVALID_SYSTEM_TIME',
      })
    }
    return timestamp.toISOString()
  }

  async assertEntryFile(config) {
    await realScriptEntry(config, {
      fileSystem: this.fileSystem,
      scriptsDirectory: this.scriptsDirectory,
    })
  }

  async ensureReady() {
    if (!this.readyPromise) this.readyPromise = this.loadFromDisk()
    return this.readyPromise
  }

  async loadFromDisk() {
    await this.fileSystem.mkdir(this.directory, { recursive: true, mode: 0o700 })
    const entries = await this.fileSystem.readdir(this.directory, { withFileTypes: true })
    const configs = new Map()
    const storedConfigIds = new Set()
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const id = entry.name.slice(0, -'.json'.length)
      if (!SAFE_SCRIPT_CONFIG_ID_PATTERN.test(id)) continue
      storedConfigIds.add(id)
      try {
        const raw = await this.fileSystem.readFile(join(this.directory, entry.name), 'utf8')
        const config = validateScriptConfig(JSON.parse(raw))
        if (config.id !== id) throw new Error('文件名与脚本配置 ID 不一致')
        await this.assertEntryFile(config)
        configs.set(id, config)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.warningLogger(`[runner] 跳过无效脚本配置 ${entry.name}: ${message}`)
      }
    }
    this.configs = configs
    this.storedConfigIds = storedConfigIds
  }

  async mutate(operation) {
    const pending = this.mutationTail.then(async () => {
      await this.ensureReady()
      // JSON files are the source of truth and may change through Git or another Runner process.
      await this.loadFromDisk()
      return operation()
    })
    this.mutationTail = pending.then(() => undefined, () => undefined)
    return pending
  }

  async writeConfig(config, { createOnly = false } = {}) {
    const serialized = `${JSON.stringify(config, null, 2)}\n`
    const targetPath = join(this.directory, `${config.id}.json`)
    const temporaryPath = join(
      this.directory,
      `.${config.id}.${process.pid}.${this.temporaryIdFactory()}.tmp`,
    )
    try {
      await this.fileSystem.writeFile(temporaryPath, serialized, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      })
      if (createOnly) {
        try {
          await this.fileSystem.link(temporaryPath, targetPath)
        } catch (error) {
          if (error?.code === 'EEXIST') {
            throw new ScriptConfigStoreError('脚本配置 ID 已存在', {
              statusCode: 409,
              code: 'SCRIPT_CONFIG_EXISTS',
            })
          }
          throw error
        }
        await this.fileSystem.unlink(temporaryPath).catch(() => undefined)
      } else {
        await this.fileSystem.rename(temporaryPath, targetPath)
      }
    } catch (error) {
      await this.fileSystem.unlink(temporaryPath).catch(() => undefined)
      throw error
    }
    this.configs.set(config.id, config)
    this.storedConfigIds.add(config.id)
  }
}
