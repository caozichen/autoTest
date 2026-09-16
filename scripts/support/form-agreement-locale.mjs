const KNOWN_LOCALE_ALIASES = new Map([
  ['zh_cn', 'zh_CN'],
  ['zh_hk', 'zh_HK'],
  ['en_us', 'en_US'],
])

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

async function readLocaleDictionary(page) {
  const outcome = await page.evaluate(async () => {
    const response = await fetch(new URL('/api/base/dict/tree', location.origin), {
      headers: { Authorization: localStorage.getItem('token') ?? '' },
    })
    return { ok: response.ok, status: response.status, body: await response.json() }
  })
  if (!outcome.ok) throw new Error(`用户协议语言字典读取失败：HTTP ${outcome.status}`)
  const body = outcome.body
  if (!isRecord(body) || body.code !== 0
    || (Object.hasOwn(body, 'success') && body.success !== true)) {
    throw new Error(`用户协议语言字典业务响应失败：code=${String(body?.code)}`)
  }
  const children = body.data?.supported_locales?.children
  if (!Array.isArray(children)) throw new Error('用户协议语言字典缺少 supported_locales.children')
  return children
}

export async function withAgreementLocaleCompatibility({ page, formId, logger = () => undefined }, action) {
  const origin = new URL(page.url()).origin
  const configUrl = new URL(`/api/be/form/${encodeURIComponent(formId)}/config`, origin).href
  const dictionaryParameters = await readLocaleDictionary(page)
  const compatibility = {
    applied: false,
    reason: 'no-matching-agreement-request',
    dictionaryParameters,
    originalLanguages: [],
    forwardedLanguages: [],
  }
  let handled = false
  const matchesConfig = url => url.href === configUrl
  const handler = async route => {
    const request = route.request()
    if (handled || request.url() !== configUrl || request.method() !== 'PUT') {
      await route.continue()
      return
    }
    let payload
    try {
      payload = request.postDataJSON()
    } catch {
      await route.continue()
      return
    }
    const agreements = payload?.common_config?.privacy_policy?.agreements
    if (!Array.isArray(agreements)) {
      await route.continue()
      return
    }
    handled = true
    compatibility.originalLanguages = agreements.map(entry => entry?.language)
    for (const agreement of agreements) {
      if (!isRecord(agreement)) continue
      const canonical = KNOWN_LOCALE_ALIASES.get(agreement.language)
      if (!canonical) continue
      const matches = dictionaryParameters.filter(entry => entry?.enum_key === agreement.language)
      // Only this run's unique, exact dictionary pair confirms the known UI
      // defect. Never infer a locale by case folding or from a display name.
      if (matches.length !== 1 || matches[0].enum_value !== canonical) continue
      agreement.language = canonical
      compatibility.applied = true
    }
    compatibility.forwardedLanguages = agreements.map(entry => entry?.language)
    compatibility.reason = compatibility.applied
      ? 'dictionary-confirmed-known-aliases'
      : 'no-dictionary-confirmed-known-aliases'
    if (compatibility.applied) {
      await route.continue({ postData: JSON.stringify(payload) })
      logger('warning', '用户协议 UI 将语言键作为保存参数的缺陷已临时兼容；依据本次字典仅转换已知 language 值，后端响应仍按真实结果校验', {
        formId, ...compatibility,
      })
    } else {
      await route.continue()
    }
  }
  await page.route(matchesConfig, handler)
  try {
    return { result: await action(), compatibility }
  } finally {
    await page.unroute(matchesConfig, handler)
  }
}
