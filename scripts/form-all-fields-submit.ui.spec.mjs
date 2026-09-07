import { run as runPublishedAllFieldsForm } from './form-lpxavn-submit.ui.spec.mjs'

const SCRIPT_ID = 'form-all-fields-submit'

function requireDynamicFormId(requestPath) {
  let formUrl
  try {
    formUrl = new URL(requestPath, 'https://runner.local')
  } catch {
    throw new Error('已发布全题型表单填写脚本必须通过 FORM_ID 解析出非空表单 ID')
  }
  const formId = formUrl.searchParams.get('id')?.trim() ?? ''
  if (!formId || /[{}]/.test(formId)) {
    throw new Error('已发布全题型表单填写脚本必须通过 FORM_ID 解析出非空表单 ID')
  }
}

export async function run(options = {}) {
  const requestPath = typeof options.requestPath === 'string'
    ? options.requestPath.trim()
    : ''
  if (!requestPath) {
    throw new Error('已发布全题型表单填写脚本必须通过 FORM_ID 解析出公开表单路径')
  }
  requireDynamicFormId(requestPath)

  return runPublishedAllFieldsForm({
    ...options,
    scriptId: options.scriptId ?? SCRIPT_ID,
    scriptName: options.scriptName ?? options.scriptId ?? SCRIPT_ID,
    requestPath,
  })
}

export {
  SCRIPT_ID,
}
