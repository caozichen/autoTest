export const LPXAVN_SCRIPT_ID = 'form-lpxavn-submit'
export const ALL_FIELDS_SUBMIT_SCRIPT_ID = 'form-all-fields-submit'
export const SUBMISSION_REPLY_EDIT_SCRIPT_ID = 'form-submission-reply-edit'
export const DEFAULT_LPXAVN_REQUEST_PATH = '/form/?id={{FORM_CODE}}'
export const DEFAULT_ALL_FIELDS_REQUEST_PATH = '/form/?id={{FORM_CODE}}'
export const DEFAULT_SUBMISSION_REPLY_EDIT_REQUEST_PATH = '/form-activity/submission/preview/reply/{{SUBMISSION_ID}}?fid={{FORM_ID}}'
const REQUEST_PATH_SCRIPT_IDS = new Set([
  LPXAVN_SCRIPT_ID,
  ALL_FIELDS_SUBMIT_SCRIPT_ID,
  SUBMISSION_REPLY_EDIT_SCRIPT_ID,
])
const VARIABLE_PATTERN = /{{\s*([^{}]+?)\s*}}/g

export interface ScriptRequestPathSegment {
  text: string
  variable: boolean
}

export type ScriptRequestOriginMode = 'public' | 'admin'

export function supportsScriptRequestPath(scriptId?: string): boolean {
  return typeof scriptId === 'string' && REQUEST_PATH_SCRIPT_IDS.has(scriptId)
}

export function defaultRequestPathForScript(scriptId?: string): string {
  if (scriptId === LPXAVN_SCRIPT_ID) return DEFAULT_LPXAVN_REQUEST_PATH
  if (scriptId === ALL_FIELDS_SUBMIT_SCRIPT_ID) return DEFAULT_ALL_FIELDS_REQUEST_PATH
  if (scriptId === SUBMISSION_REPLY_EDIT_SCRIPT_ID) return DEFAULT_SUBMISSION_REPLY_EDIT_REQUEST_PATH
  return ''
}

export function requestOriginModeForScript(scriptId?: string): ScriptRequestOriginMode {
  return scriptId === SUBMISSION_REPLY_EDIT_SCRIPT_ID ? 'admin' : 'public'
}

function pathWithoutVariableWhitespace(value: string): string {
  return value.replace(VARIABLE_PATTERN, 'VARIABLE')
}

function normalizedVariableKey(value: string): string {
  return value.trim().toLowerCase()
}

export function segmentScriptRequestPath(value: string): ScriptRequestPathSegment[] {
  const segments: ScriptRequestPathSegment[] = []
  let offset = 0

  for (const match of value.matchAll(VARIABLE_PATTERN)) {
    const index = match.index ?? 0
    if (index > offset) segments.push({ text: value.slice(offset, index), variable: false })
    segments.push({ text: match[0], variable: true })
    offset = index + match[0].length
  }

  if (offset < value.length) segments.push({ text: value.slice(offset), variable: false })
  return segments
}

export function normalizeScriptRequestPath(value: string): string {
  const requestPath = value.trim()
  if (!requestPath) throw new Error('请输入 URL 路径')
  if (/^[a-z][a-z\d+.-]*:/i.test(requestPath) || requestPath.startsWith('//')) {
    throw new Error('请输入相对路径，域名将根据所选环境自动拼接')
  }
  const pathWithoutVariables = pathWithoutVariableWhitespace(requestPath)
  if (/[{}]/.test(pathWithoutVariables)) throw new Error('URL 路径中的变量格式无效')
  if (/\s/.test(pathWithoutVariables)) throw new Error('URL 路径不能包含变量外的空格或换行')
  if (requestPath.includes('\\')) throw new Error('URL 路径不能包含反斜杠')

  return requestPath.startsWith('/') ? requestPath : `/${requestPath}`
}

export function resolveScriptRequestPath(
  requestPath: string,
  variables: Readonly<Record<string, string>>,
): string {
  const normalizedTemplate = normalizeScriptRequestPath(requestPath)
  const variablesByKey = new Map<string, string>()
  for (const [key, value] of Object.entries(variables)) {
    const normalizedKey = normalizedVariableKey(key)
    if (normalizedKey) variablesByKey.set(normalizedKey, value)
  }
  const missingVariables = new Set<string>()
  const resolvedPath = normalizedTemplate.replace(VARIABLE_PATTERN, (_placeholder, rawKey: string) => {
    const key = rawKey.trim()
    const normalizedKey = normalizedVariableKey(key)
    if (!normalizedKey || !variablesByKey.has(normalizedKey)) {
      missingVariables.add(key || '空变量名')
      return ''
    }
    return variablesByKey.get(normalizedKey) ?? ''
  })

  if (missingVariables.size > 0) {
    const names = [...missingVariables].map((key) => `{{${key}}}`).join('、')
    throw new Error(`URL 路径引用了未定义变量：${names}`)
  }
  return normalizeScriptRequestPath(resolvedPath)
}

export function publicOriginForEnvironment(siteBaseUrl: string): string {
  const url = new URL(siteBaseUrl)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('环境域名只允许 http 或 https')

  if (url.hostname.includes('.admin.')) {
    url.hostname = url.hostname.replace('.admin.', '.')
  } else if (url.hostname.includes('.b.lingxi-hk.localtest')) {
    url.hostname = url.hostname.replace('.b.lingxi-hk.localtest', '.f.lingxi-hk.localtest')
  }
  return url.origin
}

function adminOriginForEnvironment(siteBaseUrl: string): string {
  const url = new URL(siteBaseUrl)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('环境域名只允许 http 或 https')
  return url.origin
}

export function requestOriginForScript(scriptId: string | undefined, siteBaseUrl: string): string {
  return requestOriginModeForScript(scriptId) === 'admin'
    ? adminOriginForEnvironment(siteBaseUrl)
    : publicOriginForEnvironment(siteBaseUrl)
}

function buildScriptRequestUrlForOrigin(
  origin: string,
  requestPath: string,
  variables: Readonly<Record<string, string>>,
  sameOriginError: string,
): string {
  const normalizedPath = resolveScriptRequestPath(requestPath, variables)
  const requestUrl = new URL(normalizedPath.replace(/^\/+/, ''), `${origin}/`)
  if (requestUrl.origin !== origin) throw new Error(sameOriginError)
  return requestUrl.toString()
}

export function buildScriptRequestUrl(
  scriptId: string | undefined,
  siteBaseUrl: string,
  requestPath: string,
  variables: Readonly<Record<string, string>> = {},
): string {
  return buildScriptRequestUrlForOrigin(
    requestOriginForScript(scriptId, siteBaseUrl),
    requestPath,
    variables,
    '最终请求地址必须与环境域名同源',
  )
}

export function buildPublicScriptRequestUrl(
  siteBaseUrl: string,
  requestPath: string,
  variables: Readonly<Record<string, string>> = {},
): string {
  return buildScriptRequestUrlForOrigin(
    publicOriginForEnvironment(siteBaseUrl),
    requestPath,
    variables,
    '最终请求地址必须与环境公开域名同源',
  )
}
