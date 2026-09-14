import {
  buildDetailUrl,
  resolveSubmissionContext,
  run as runSubmissionReplyEdit,
} from './form-submission-reply-edit.ui.spec.mjs'

const SCRIPT_ID = 'form-all-fields-submit'

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
    variables: { ...options.variables, SUBMISSION_EDIT_VALUES: '{}' },
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
