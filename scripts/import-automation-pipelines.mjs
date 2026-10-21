import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const PIPELINES_KEY = 'autotest.automation-pipelines.v1'
const DEFAULT_FILE = fileURLToPath(new URL('../config/automation-pipelines.json', import.meta.url))

export async function importAutomationPipelines({ catalog, runnerUrl = 'http://127.0.0.1:4310', replace = false, fetchImpl = fetch }) {
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.pipelines) || catalog.pipelines.length === 0) {
    throw new Error('自动化配置文件格式无效')
  }
  const ids = new Set()
  const names = new Set()
  for (const pipeline of catalog.pipelines) {
    if (!pipeline?.id?.trim() || !pipeline?.name?.trim() || !Array.isArray(pipeline.steps)
      || ids.has(pipeline.id) || names.has(pipeline.name.toLocaleLowerCase())) {
      throw new Error('自动化配置必须包含唯一 ID、名称和脚本步骤')
    }
    ids.add(pipeline.id)
    names.add(pipeline.name.toLocaleLowerCase())
  }
  const endpoint = new URL('/app-settings', runnerUrl)
  const response = await fetchImpl(endpoint, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`读取 Runner 配置失败：HTTP ${response.status}`)
  const snapshot = await response.json()
  const pipelines = JSON.parse(snapshot.values[PIPELINES_KEY] ?? '[]')
  const actions = []
  for (const preset of catalog.pipelines) {
    const byId = pipelines.findIndex(item => item.id === preset.id)
    const byName = pipelines.findIndex(item => item.name.toLocaleLowerCase() === preset.name.toLocaleLowerCase())
    if (byId >= 0 && byName >= 0 && byId !== byName) throw new Error(`配置 ID 与名称匹配了不同的本机配置：${preset.name}`)
    const index = byId >= 0 ? byId : byName
    if (index >= 0 && !replace) {
      actions.push({ name: preset.name, action: 'skipped' })
      continue
    }
    const incoming = {
      id: preset.id, name: preset.name, description: preset.description,
      steps: preset.steps, createdAt: preset.createdAt, updatedAt: preset.updatedAt,
    }
    if (index < 0) pipelines.push(incoming)
    else pipelines[index] = { ...incoming, id: pipelines[index].id, createdAt: pipelines[index].createdAt, updatedAt: new Date().toISOString() }
    actions.push({ name: preset.name, action: index < 0 ? 'created' : 'updated' })
  }
  if (actions.some(item => item.action !== 'skipped')) {
    const saved = await fetchImpl(endpoint, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ expectedRevision: snapshot.revision, changes: { [PIPELINES_KEY]: JSON.stringify(pipelines) } }),
    })
    if (!saved.ok) throw new Error(saved.status === 409
      ? '配置已在其他页面更新，请重新执行导入'
      : `保存自动化配置失败：HTTP ${saved.status}`)
    await saved.arrayBuffer()
  }
  return actions
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: {
      replace: { type: 'boolean', default: false },
      file: { type: 'string', default: DEFAULT_FILE },
      'runner-url': { type: 'string', default: 'http://127.0.0.1:4310' },
    } })
    const catalog = JSON.parse(await readFile(values.file, 'utf8'))
    const actions = await importAutomationPipelines({ catalog, runnerUrl: values['runner-url'], replace: values.replace })
    const labels = { created: '新增', updated: '更新', skipped: '保留已有' }
    for (const item of actions) console.log(`${labels[item.action]}：${item.name}`)
  } catch (error) {
    console.error(`导入失败：${error.message}`)
    process.exitCode = 1
  }
}
