const forbidden = new Set(['__proto__', 'prototype', 'constructor'])
export function valueAtPath(source, path) {
  const parts = String(path).trim().replace(/^\$\.?/, '').replace(/\[(\d+)\]/g, '.$1')
    .split('.').map(part => part.trim()).filter(Boolean)
  if (parts.some(part => forbidden.has(part))) return undefined
  return parts.reduce((value, key) => value && typeof value === 'object' && Object.hasOwn(value, key) ? value[key] : undefined, source)
}
export function runtimeValue(value) {
  if (typeof value === 'string') return value
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  if (value && typeof value === 'object') return JSON.stringify(value)
  return null
}
export function resolvePipelinePath(template, variables) {
  const values = new Map(Object.entries(variables).map(([key, value]) => [key.trim().toLowerCase(), value]))
  const path = template.replace(/{{\s*([^{}]+?)\s*}}/g, (_, key) => {
    const value = values.get(key.trim().toLowerCase())
    if (value === undefined) throw new Error(`URL 路径引用了未定义变量：${key}`)
    return value
  }).trim()
  if (!path || /^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('//') || /[{}\s\\]/.test(path)) {
    throw new Error('脚本 URL 路径必须是已解析的相对路径')
  }
  return path.startsWith('/') ? path : `/${path}`
}
export function safeVariableName(value) {
  return typeof value === 'string' && value.trim() && !forbidden.has(value.trim())
}
