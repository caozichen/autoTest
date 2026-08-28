import type { ScriptAssertionResult } from '@/domain/assertion'
import type { RunScriptRecord } from '@/domain/run-record'

export interface RunAssertionDetail extends ScriptAssertionResult {
  id: string
  scriptRecordId: string
  scriptName: string
  legacy: boolean
  order: number
}

export interface RunAssertionGroup {
  id: string
  name: string
  scriptRecordId: string
  scriptName: string
  status: 'passed' | 'failed'
  passed: number
  failed: number
  firstOrder: number
  assertions: RunAssertionDetail[]
}

export interface RunAssertionAnalysis {
  total: number
  passed: number
  failed: number
  passRate: number
  moduleTotal: number
  passedModules: number
  failedModules: number
  groups: RunAssertionGroup[]
  successGroups: RunAssertionGroup[]
  failedGroups: RunAssertionGroup[]
  legacy: boolean
}

const FIELD_MODULES = [
  '图片上传', '文件上传', '单项选择', '多项选择', '下拉选择', '单行文本', '多行文本',
  '矩阵选择', '矩阵题', '级联选择', '手写签名', '身份证件', '固定电话', '题组',
  '排序题', '评分题', '手机号', '姓名', '邮箱', '地址', '生日', '数字', '日期', '时间',
  'NPS', '描述说明', '分割线',
]

export function inferLegacyAssertionModule(scriptId: string, name: string): string {
  const fieldModule = FIELD_MODULES.find((label) => name.includes(label))
  if (fieldModule) return fieldModule
  if (/提交|结果页|submission|请求体|请求 JSON|提交 JSON/i.test(name)) return '表单提交'
  if (/Token|Authorization|登录|鉴权|同源|域名|请求地址/i.test(name)) return '鉴权与请求安全'
  if (/第\s*1\s*页|联系人/.test(name)) return '第 1 页联系人'
  if (/第\s*2\s*页|通用题/.test(name)) return '第 2 页通用题'
  if (/第\s*3\s*页|高级题/.test(name)) return '第 3 页高级题'
  if (/上一页|下一页|翻页|分页|跨页/.test(name)) return '分页与答案保持'
  if (/公开配置|发布产物|表单配置|表单地址|表单名称|页面标题|设计器|题型|已发布列表|发布响应/.test(name)) {
    return scriptId.includes('publish') ? '表单创建与发布' : '公开表单契约'
  }
  return scriptId.includes('publish') ? '表单创建与发布' : '基础运行流程'
}

function structuredAssertions(script: RunScriptRecord, orderStart: number): RunAssertionDetail[] {
  return script.assertions.map((assertion, index) => ({
    ...assertion,
    id: `${script.recordId}:assertion:${assertion.sequence}:${index}`,
    scriptRecordId: script.recordId,
    scriptName: script.name,
    legacy: false,
    order: orderStart + index,
  }))
}

function legacyAssertions(script: RunScriptRecord, orderStart: number): RunAssertionDetail[] {
  const assertionLogs = script.logs.filter((log) => log.level === 'success' || log.level === 'error')
  const assertions = assertionLogs.map((log, index): RunAssertionDetail => ({
    id: `${script.recordId}:legacy:${log.id}`,
    scriptRecordId: script.recordId,
    scriptName: script.name,
    sequence: index + 1,
    timestamp: log.timestamp,
    name: log.message,
    module: inferLegacyAssertionModule(script.id, log.message),
    matcher: '运行日志',
    status: log.level === 'error' ? 'failed' : 'passed',
    durationMs: 0,
    ...(log.level === 'error' ? { error: log.message } : {}),
    legacy: true,
    order: orderStart + index,
  }))

  if (assertions.length === 0 && (script.status === 'passed' || script.status === 'failed')) {
    const failed = script.status === 'failed'
    const name = failed ? script.error?.trim() || '脚本执行失败' : '脚本全部检查通过'
    assertions.push({
      id: `${script.recordId}:legacy:outcome`,
      scriptRecordId: script.recordId,
      scriptName: script.name,
      sequence: 1,
      timestamp: new Date(0).toISOString(),
      name,
      module: inferLegacyAssertionModule(script.id, name),
      matcher: '脚本结果',
      status: failed ? 'failed' : 'passed',
      durationMs: script.durationMs ?? 0,
      ...(failed ? { error: name } : {}),
      legacy: true,
      order: orderStart,
    })
  }
  return assertions
}

function ensureFailureIsRepresented(script: RunScriptRecord, assertions: RunAssertionDetail[]): void {
  if (script.status !== 'failed' || assertions.some((assertion) => assertion.status === 'failed')) return
  const name = script.error?.trim() || '脚本在非 expect 检查中失败'
  assertions.push({
    id: `${script.recordId}:assertion:runtime-failure`,
    scriptRecordId: script.recordId,
    scriptName: script.name,
    sequence: assertions.length + 1,
    timestamp: new Date(0).toISOString(),
    name,
    module: inferLegacyAssertionModule(script.id, name),
    matcher: '运行时检查',
    status: 'failed',
    durationMs: 0,
    error: name,
    legacy: script.assertions.length === 0,
    order: (assertions[assertions.length - 1]?.order ?? 0) + 1,
  })
}

export function buildRunAssertionAnalysis(scripts: RunScriptRecord[]): RunAssertionAnalysis {
  const details: RunAssertionDetail[] = []
  let order = 0
  for (const script of scripts) {
    const scriptAssertions = script.assertions.length
      ? structuredAssertions(script, order)
      : legacyAssertions(script, order)
    ensureFailureIsRepresented(script, scriptAssertions)
    details.push(...scriptAssertions)
    order += scriptAssertions.length
  }

  const groupsById = new Map<string, RunAssertionGroup>()
  for (const assertion of details) {
    const id = `${assertion.scriptRecordId}:${assertion.module}`
    const current = groupsById.get(id) ?? {
      id,
      name: assertion.module,
      scriptRecordId: assertion.scriptRecordId,
      scriptName: assertion.scriptName,
      status: 'passed' as const,
      passed: 0,
      failed: 0,
      firstOrder: assertion.order,
      assertions: [],
    }
    current.assertions.push(assertion)
    if (assertion.status === 'passed') current.passed += 1
    else current.failed += 1
    if (current.failed > 0) current.status = 'failed'
    groupsById.set(id, current)
  }

  const groups = [...groupsById.values()].sort((left, right) => left.firstOrder - right.firstOrder)
  const passed = details.filter((assertion) => assertion.status === 'passed').length
  const failed = details.length - passed
  return {
    total: details.length,
    passed,
    failed,
    passRate: details.length ? Math.round((passed / details.length) * 1_000) / 10 : 0,
    moduleTotal: groups.length,
    passedModules: groups.filter((group) => group.status === 'passed').length,
    failedModules: groups.filter((group) => group.status === 'failed').length,
    groups,
    successGroups: groups.filter((group) => group.status === 'passed'),
    failedGroups: groups.filter((group) => group.status === 'failed'),
    legacy: details.some((assertion) => assertion.legacy),
  }
}
