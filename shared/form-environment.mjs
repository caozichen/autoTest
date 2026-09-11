// Shared by the runner, browser scripts and request URL preview in the web app.
export function publicOriginForSite(siteBaseUrl) {
  const url = new URL(siteBaseUrl)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('环境域名只允许 http 或 https')

  if (/^[^.]+\.admin\.lingxi360\.com$/.test(url.hostname)) {
    url.hostname = url.hostname.replace('.admin.', '.form.')
  } else if (url.hostname.includes('.admin.')) {
    url.hostname = url.hostname.replace('.admin.', '.')
  } else if (url.hostname.endsWith('.b.lingxi-hk.localtest')) {
    url.hostname = url.hostname.replace('.b.lingxi-hk.localtest', '.f.lingxi-hk.localtest')
  }
  return url.origin
}
