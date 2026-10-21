export function resolveAdminLocale(variables = {}) {
  const value = String(variables.ADMIN_LOCALE ?? 'zh-CN').trim().replace('_', '-')
  if (/^zh-cn$/i.test(value)) return 'zh-CN'
  if (/^zh-hk$/i.test(value)) return 'zh-HK'
  throw new Error('ADMIN_LOCALE 仅支持 zh-CN 或 zh-HK')
}
