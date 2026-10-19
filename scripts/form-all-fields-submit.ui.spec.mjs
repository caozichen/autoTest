import {
  buildDetailUrl,
  resolveSubmissionContext,
  run as runSubmissionReplyEdit,
} from './form-submission-reply-edit.ui.spec.mjs'

const SCRIPT_ID = 'form-all-fields-submit'

export function resolveEditValues(variables = {}) {
  const mode = String(variables.SUBMISSION_EDIT_MODE ?? 'unchanged').trim()
  if (!['unchanged', 'configured'].includes(mode)) throw new Error('SUBMISSION_EDIT_MODE 仅支持 unchanged 或 configured')
  if (mode === 'unchanged') return '{}'
  let values
  try { values = JSON.parse(variables.SUBMISSION_EDIT_VALUES ?? '{}') } catch { throw new Error('SUBMISSION_EDIT_VALUES 必须是 JSON 对象') }
  if (!values || typeof values !== 'object' || Array.isArray(values) || !Object.keys(values).length) {
    throw new Error('configured 编辑模式必须显式提供非空 SUBMISSION_EDIT_VALUES')
  }
  return JSON.stringify(values)
}

export async function run(options = {}) {
  const requestPath = typeof options.requestPath === 'string'
    ? options.requestPath.trim()
    : ''
  if (!requestPath) {
    throw new Error('提报编辑脚本必须通过 FORM_ID 和 SUBMISSION_ID 解析出已有提报详情路径')
  }
  resolveSubmissionContext(buildDetailUrl('https://runner.local', requestPath), options.variables)

  const result = await runSubmissionReplyEdit({
    ...options,
    requestPath,
    variables: { ...options.variables, SUBMISSION_EDIT_VALUES: resolveEditValues(options.variables) },
    captureSuccessScreenshots: true,
    verifyPersistence: true,
  })
  return {
    ...result,
    scriptId: options.scriptId ?? SCRIPT_ID,
    scriptName: options.scriptName ?? '检查并编辑提报信息',
  }
}

export {
  SCRIPT_ID,
}
