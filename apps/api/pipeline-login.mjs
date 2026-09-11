import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { valueAtPath } from './pipeline-values.mjs'

export function httpUrl(value, label) {
  let url
  try { url = new URL(value) } catch { throw new Error(`${label}不是有效 URL`) }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(`${label}必须是 HTTP(S) 地址且不能包含凭据`)
  return url
}

export function requestLoginJson(url, { method, body, timeoutMs, signal, ignoreHTTPSErrors }) {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method, signal, rejectUnauthorized: !ignoreHTTPSErrors,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    })
    const timer = setTimeout(() => request.destroy(new Error(`登录请求超过 ${timeoutMs} ms`)), timeoutMs)
    request.on('error', reject)
    request.on('close', () => clearTimeout(timer))
    request.on('response', response => {
      const chunks = []
      let bytes = 0
      response.on('data', chunk => {
        bytes += chunk.length
        if (bytes > 8 * 1024 * 1024) request.destroy(new Error('登录响应体过大'))
        else chunks.push(chunk)
      })
      response.on('error', reject)
      response.on('aborted', () => reject(new Error('登录响应中断')))
      response.on('end', () => {
        clearTimeout(timer)
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`环境登录失败（HTTP ${response.statusCode}）`)); return
        }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
        catch { reject(new Error('登录响应不是有效 JSON')) }
      })
    })
    request.end(body)
  })
}

export async function authenticatePipeline(environment, session, signal, request = requestLoginJson) {
  const auth = environment.auth
  if (signal.aborted) throw new Error('认证已取消')
  if (auth.strategy === 'reuse-session') {
    const normalized = value => httpUrl(value, '登录态绑定地址').href.replace(/\/+$/, '')
    if (!session || session.environmentId !== environment.id || session.siteUrl !== normalized(environment.baseUrl)
      || session.apiUrl !== normalized(environment.apiBaseUrl) || typeof session.token !== 'string' || !session.token
      || /\s/.test(session.token) || !/^[A-Za-z][A-Za-z0-9+.-]*$/.test(session.scheme ?? '')) {
      throw new Error('没有与当前环境匹配的登录态，请重新导入')
    }
    if (session.expiresAt !== null && (!Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now())) {
      throw new Error('登录态已过期，请手动登录后更新')
    }
    return { token: session.token, scheme: session.scheme }
  }
  const apiUrl = httpUrl(environment.apiBaseUrl, 'API 地址')
  const loginUrl = httpUrl(`${environment.apiBaseUrl.replace(/\/+$/, '')}/${auth.loginPath.replace(/^\/+/, '')}`, '登录地址')
  if (loginUrl.origin !== apiUrl.origin) throw new Error('登录地址必须与 API 同源')
  const response = await request(loginUrl, {
    method: auth.method, body: JSON.stringify(JSON.parse(auth.requestBody)),
    timeoutMs: auth.timeoutMs * (/hk/i.test(environment.code) ? 3 : 1), signal,
    ignoreHTTPSErrors: environment.ignoreHTTPSErrors ?? apiUrl.hostname === 'lx.admin.lingxi.tech',
  })
  if (signal.aborted) throw new Error('认证已取消')
  if (auth.successPath.trim()) {
    const actual = valueAtPath(response, auth.successPath)
    const expected = auth.successValue
    const matches = !expected.trim() ? Boolean(actual) : typeof actual === 'string' ? actual === expected : JSON.stringify(actual) === expected
    if (!matches) throw new Error('环境登录业务校验失败，请检查成功规则')
  }
  const extractedToken = valueAtPath(response, auth.tokenPath)
  const token = ['string', 'number', 'boolean'].includes(typeof extractedToken) ? String(extractedToken) : null
  if (!token || !token.trim() || /\s/.test(token)) throw new Error(`登录成功，但无法从 ${auth.tokenPath} 提取有效 Token`)
  const extractedScheme = valueAtPath(response, auth.tokenTypePath)
  const scheme = typeof extractedScheme === 'string' && extractedScheme.trim() ? extractedScheme.trim() : auth.tokenTypeFallback || 'Bearer'
  if (!/^[A-Za-z][A-Za-z0-9+.-]*$/.test(scheme)) throw new Error('Token 类型无效')
  return { token, scheme }
}
