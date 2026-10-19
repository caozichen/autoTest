import { chmod, mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

export const DEFAULT_APP_SETTINGS_DIRECTORY = fileURLToPath(new URL('../../data/app-settings/', import.meta.url))
const queues = new Map()
const KEYS = new Set(['autotest.environments.v7', 'autotest.automation-pipelines.v1', 'autotest.run-history-tabs.v1'])
const SESSION_PREFIX = 'autotest.environment-session.v1.'

function failure(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode })
}
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function strings(value, keys) { return keys.every(key => typeof value[key] === 'string') }

function validPipeline(item) {
  if (!record(item) || !strings(item, ['id', 'name', 'description', 'createdAt', 'updatedAt']) || !item.id.trim() || !item.name.trim()
    || !Number.isFinite(Date.parse(item.createdAt)) || !Number.isFinite(Date.parse(item.updatedAt))
    || (item.environmentId !== undefined && typeof item.environmentId !== 'string') || !Array.isArray(item.steps) || !item.steps.length) return false
  const previous = new Set()
  for (const step of item.steps) {
    if (!record(step) || typeof step.scriptId !== 'string' || !step.scriptId.trim() || previous.has(step.scriptId.trim()) || !Array.isArray(step.parameterMappings)) return false
    const targets = new Set()
    for (const mapping of step.parameterMappings) {
      if (!record(mapping) || !strings(mapping, ['sourceScriptId', 'sourcePath', 'targetKey'])
        || !previous.has(mapping.sourceScriptId.trim()) || !mapping.sourcePath.trim() || !mapping.targetKey.trim() || targets.has(mapping.targetKey.trim())) return false
      targets.add(mapping.targetKey.trim())
    }
    previous.add(step.scriptId.trim())
  }
  return true
}

function validateEntries(entries) {
  if (!record(entries) || Object.keys(entries).length > 1000) throw failure('配置数据格式无效')
  for (const [key, raw] of Object.entries(entries)) {
    const sessionId = key.startsWith(SESSION_PREFIX) ? key.slice(SESSION_PREFIX.length) : ''
    if (!KEYS.has(key) && !/^[a-zA-Z0-9_-]{1,100}$/.test(sessionId)) throw failure('不支持的配置项')
    if (raw === null) continue // A tombstone prevents legacy origins from resurrecting removed data.
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > 1024 * 1024) throw failure('配置内容格式或大小无效')
    let value
    try { value = JSON.parse(raw) } catch { throw failure('配置内容必须是有效 JSON') }
    let valid = false
    if (key === 'autotest.environments.v7') {
      valid = Array.isArray(value) && value.every(item => record(item) && strings(item, ['id', 'name', 'code', 'baseUrl', 'apiBaseUrl'])
        && typeof item.enabled === 'boolean' && typeof item.active === 'boolean' && record(item.auth) && typeof item.auth.loginPath === 'string'
        && Array.isArray(item.variables) && item.variables.every(variable => record(variable) && strings(variable, ['id', 'key'])))
      if (valid) valid = new Set(value.map(item => item.id)).size === value.length && value.filter(item => item.active).length <= 1
    } else if (key === 'autotest.automation-pipelines.v1') {
      valid = Array.isArray(value) && value.every(validPipeline)
      if (valid) valid = new Set(value.map(item => item.id)).size === value.length
    } else if (key === 'autotest.run-history-tabs.v1') {
      valid = Array.isArray(value) && value.every(id => typeof id === 'string')
    } else {
      valid = record(value) && value.environmentId === sessionId && strings(value, ['siteUrl', 'apiUrl', 'token', 'scheme', 'accountLabel', 'savedAt'])
        && (value.expiresAt === null || (typeof value.expiresAt === 'number' && Number.isFinite(value.expiresAt)))
    }
    if (!valid) throw failure('配置项内容格式无效')
  }
  return structuredClone(entries)
}

export class AppSettingsStore {
  constructor({ directory = DEFAULT_APP_SETTINGS_DIRECTORY } = {}) {
    this.directory = resolve(directory)
    this.path = join(this.directory, 'settings.json')
  }
  async read() {
    let raw
    try { raw = await readFile(this.path, 'utf8') } catch (error) {
      if (error.code === 'ENOENT') return { schemaVersion: 1, revision: 0, values: {} }
      throw failure('无法读取本地配置文件，请检查文件权限', 500)
    }
    try {
      const snapshot = JSON.parse(raw)
      if (!record(snapshot) || snapshot.schemaVersion !== 1 || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) throw new Error()
      validateEntries(snapshot.values)
      return snapshot
    } catch {
      throw failure('本地配置文件损坏，已停止写入以保留原数据；请检查备份 settings.json.bak', 500)
    }
  }
  update(changes, expectedRevision) {
    const validated = validateEntries(changes)
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw failure('缺少有效的配置版本')
    return this.mutate(snapshot => {
      if (snapshot.revision !== expectedRevision) throw failure('配置已在其他页面更新，请刷新后重试', 409)
      return validated
    })
  }
  migrate(entries) {
    const validated = validateEntries(entries)
    return this.mutate(snapshot => Object.fromEntries(Object.entries(validated).filter(([key, value]) => value !== null && !Object.hasOwn(snapshot.values, key))))
  }
  mutate(changesFor) {
    const operation = (queues.get(this.path) ?? Promise.resolve()).then(async () => {
      const snapshot = await this.read()
      const changes = changesFor(snapshot)
      if (!Object.keys(changes).length) return snapshot
      const next = { schemaVersion: 1, revision: snapshot.revision + 1, values: { ...snapshot.values, ...changes } }
      validateEntries(next.values)
      const temporary = `${this.path}.${randomUUID()}.tmp`
      const backupTemporary = `${temporary}.bak`
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      await chmod(this.directory, 0o700)
      try {
        // Keep the previous complete state before atomically replacing the current one.
        const backup = snapshot.revision === 0 ? next : snapshot
        await writeFile(backupTemporary, JSON.stringify(backup, null, 2), { mode: 0o600, flag: 'wx' })
        await rename(backupTemporary, `${this.path}.bak`)
        await writeFile(temporary, JSON.stringify(next, null, 2), { mode: 0o600, flag: 'wx' })
        await rename(temporary, this.path)
      } finally {
        await rm(temporary, { force: true })
        await rm(backupTemporary, { force: true })
      }
      return next
    })
    const tail = operation.catch(() => undefined)
    queues.set(this.path, tail)
    void tail.then(() => { if (queues.get(this.path) === tail) queues.delete(this.path) })
    return operation
  }
}
