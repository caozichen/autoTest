const scriptRegistry = Object.freeze({
  'form-contact-publish': new URL('../../scripts/form-contact-publish.api.spec.mjs', import.meta.url),
})

function assertHttpUrl(rawUrl, label) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error(`${label}不是有效 URL`)
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${label}只允许 http 或 https`)
  }
  return url
}

export function validateRunRequest(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('运行参数不能为空')
  if (typeof payload.scriptId !== 'string' || !scriptRegistry[payload.scriptId]) {
    throw new Error('脚本未登记，Runner 拒绝执行')
  }
  const context = payload.context
  if (!context || typeof context !== 'object') throw new Error('缺少脚本运行上下文')

  const apiBaseUrl = assertHttpUrl(context.apiBaseUrl, 'API 基址')
  const authorizationOrigin = assertHttpUrl(context.authorizationOrigin, '授权来源')
  if (apiBaseUrl.origin !== authorizationOrigin.origin) {
    throw new Error('API 基址与 Token 授权来源不同源')
  }

  const authorization = context.extraHTTPHeaders?.Authorization
  if (typeof authorization !== 'string' || !authorization.trim()) {
    throw new Error('缺少 Authorization 请求头')
  }

  const variables = context.variables ?? {}
  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
    throw new Error('运行时变量必须是键值对象')
  }
  const variableEntries = Object.entries(variables)
  if (variableEntries.some(([key, value]) => !key.trim() || typeof value !== 'string')) {
    throw new Error('运行时变量名称不能为空，且变量值必须是字符串')
  }

  return {
    scriptId: payload.scriptId,
    apiBaseUrl: apiBaseUrl.toString(),
    ignoreHTTPSErrors: context.ignoreHTTPSErrors === true,
    variables: Object.fromEntries(variableEntries),
    authorizationOrigin: authorizationOrigin.origin,
    extraHTTPHeaders: { Authorization: authorization.trim() },
  }
}

export function sanitizeErrorMessage(error, secrets = []) {
  let message = error instanceof Error ? error.message : String(error)
  message = message.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
  message = message.replace(
    /(authorization\s*:)\s*[^\r\n]*?(?=\s+-\s+[a-z][a-z-]*\s*:|$)/gi,
    '$1 [REDACTED]',
  )
  for (const secret of secrets) {
    if (typeof secret !== 'string' || !secret) continue
    message = message.split(secret).join('[REDACTED]')
  }
  return message
}

export async function executeRegisteredScript(payload) {
  const context = validateRunRequest(payload)
  const scriptUrl = scriptRegistry[context.scriptId]
  const logs = []
  const startedAt = performance.now()
  const logger = (level, message, details) => {
    logs.push({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(details === undefined ? {} : { details }),
    })
  }

  try {
    const scriptModule = await import(scriptUrl.href)
    if (typeof scriptModule.run !== 'function') throw new Error('脚本入口未导出 run 函数')
    const result = await scriptModule.run({ ...context, logger })
    return {
      ok: true,
      durationMs: Math.round(performance.now() - startedAt),
      logs,
      result,
    }
  } catch (error) {
    const message = sanitizeErrorMessage(error, [context.extraHTTPHeaders.Authorization])
    logger('error', `执行失败：${message}`)
    return {
      ok: false,
      durationMs: Math.round(performance.now() - startedAt),
      logs,
      error: message,
    }
  }
}
