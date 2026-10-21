import { expect } from './recorded-expect.mjs'
import { expect as requireExpect, scaleTimeout } from './environment-timeouts.mjs'
import { resolveAdminLocale } from './admin-locale.mjs'
import { attachNetworkObserver } from './api-response-recorder.mjs'
import { clickWhenReady, observeUiReadiness, waitForUiReady } from './ui-readiness.mjs'

export function parseSearchSamples(value) {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['channel', 'remark'].includes(key))) throw new Error('searchSamples 格式不正确')
  const result = {}
  if (value.channel !== undefined) {
    const channel = value.channel
    if (!channel || typeof channel !== 'object' || Array.isArray(channel)
      || Object.keys(channel).some(key => !['code', 'title'].includes(key))
      || ['code', 'title'].some(key => typeof channel[key] !== 'string' || !channel[key].trim())) {
      throw new Error('searchSamples.channel 必须包含非空 code、title')
    }
    result.channel = { code: channel.code, title: channel.title }
  }
  if (value.remark !== undefined) {
    if (typeof value.remark !== 'string' || !value.remark.trim() || value.remark.length > 500) {
      throw new Error('searchSamples.remark 必须是 1–500 字符的非空备注')
    }
    result.remark = value.remark
  }
  return result
}

export function resolveChannelFormUrl(defaultUrl, channel) {
  if (!channel) return defaultUrl
  parseSearchSamples({ channel: { code: channel.code, title: channel.title } })
  const expected = new URL(defaultUrl)
  const actual = new URL(channel.link)
  if (actual.origin !== expected.origin || actual.pathname !== expected.pathname
    || actual.username || actual.password || actual.hash
    || actual.searchParams.getAll('id').length !== 1
    || actual.searchParams.get('id') !== expected.searchParams.get('id')
    || actual.searchParams.getAll('channel_code').length !== 1
    || actual.searchParams.get('channel_code') !== channel.code) throw new Error('分享渠道链接与当前环境、表单或渠道标识不一致')
  return actual.toString()
}

export function assertSubmittedChannel(payload, channel) {
  if (!channel) return
  requireExpect(payload?.answers?.channel, '公开渲染器必须从真实分享链接提交对应渠道 code').toBe(channel.code)
  expect(payload.answers.channel, '提交渠道应与本次创建的分享渠道一致').toBe(channel.code)
}

async function readBusiness(response, label) {
  requireExpect(response.ok(), `${label} HTTP 必须成功`).toBe(true)
  const body = await response.json()
  requireExpect(body?.code, `${label}业务码必须成功`).toBe(0)
  return body
}

async function openRemarkTab(page) {
  const aside = page.locator('.reply-detail-page__aside')
  const tabs = aside.locator('.reply-detail-page__tabs .arco-tabs-tab')
  const tab = tabs.filter({ hasText: /^(备注|備註|Remarks)$/ })
  await requireExpect(tab, '答卷详情必须显示备注标签页').toBeVisible()
  const selected = aside.locator('.reply-detail-page__tabs .arco-tabs-tab-active')
  const previous = await selected.count() === 1 ? (await selected.innerText()).trim() : ''
  if (!/\barco-tabs-tab-active\b/.test(await tab.getAttribute('class') ?? '')) await clickWhenReady(tab)
  await requireExpect(page.locator('.reply-remark__composer-card'), '切换备注标签后必须挂载备注区').toBeVisible()
  return async () => {
    if (previous && !/^(备注|備註|Remarks)$/.test(previous)) {
      await clickWhenReady(tabs.filter({ hasText: new RegExp(`^${previous.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }))
    }
  }
}

// This read is also used after editing, so a successful edit cannot silently
// remove the run's channel or remark. Read only; never repair missing data here.
export async function assertPersistedSearchSamples(page, { apiBaseUrl, formId, submissionId, searchSamples }) {
  if (!searchSamples) return
  const base = `${apiBaseUrl.replace(/\/+$/, '')}/be/form/${encodeURIComponent(formId)}/submission`
  const read = async endpoint => {
    const result = await page.evaluate(async url => {
      const response = await fetch(url, { headers: { Authorization: localStorage.getItem('token') ?? '' } })
      return { ok: response.ok, body: await response.json() }
    }, endpoint)
    requireExpect(result.ok, '检索样本独立回读 HTTP 必须成功').toBe(true)
    requireExpect(result.body?.code, '检索样本独立回读业务码必须成功').toBe(0)
    return result.body.data
  }
  if (searchSamples.channel) {
    const data = await read(`${base}/${encodeURIComponent(submissionId)}`)
    requireExpect(String(data?.submission?.id ?? ''), '渠道回读必须定位本次答卷').toBe(submissionId)
    requireExpect(String(data?.submission?.form_id ?? ''), '渠道回读必须属于本次表单').toBe(formId)
    const channel = data?.items?.find(item => item.item_key === 'channel')
    const values = (channel?.value ?? []).map(entry => entry.answer)
    requireExpect(values, '后台独立回读必须保留提交渠道 code').toContain(searchSamples.channel.code)
  }
  if (searchSamples.remark) {
    const data = await read(`${base}/${encodeURIComponent(submissionId)}/remark`)
    const matches = data?.list?.filter(item => item.remark === searchSamples.remark) ?? []
    requireExpect(matches, '本次答卷必须且只能保存一条本次备注').toHaveLength(1)
    const restoreTab = await openRemarkTab(page)
    try {
      await requireExpect(page.locator('.reply-remark__content').filter({ hasText: searchSamples.remark }),
        '刷新后的详情页面必须回显完整备注').toHaveText(searchSamples.remark)
      expect(true, '独立回读及备注标签页必须保留本次完整备注').toBe(true)
    } finally { await restoreTab() }
  }
}

export async function prepareSubmissionSearchSamples({ browser, siteBaseUrl, apiBaseUrl, authorization,
  formId, submissionId, channel, runMarker, variables, ignoreHTTPSErrors, signal,
  logger = () => undefined, recordApiResponse, recordResourceResponse }) {
  const searchSamples = parseSearchSamples({ ...(channel ? { channel: { code: channel.code, title: channel.title } } : {}),
    remark: `自动化检索备注-${runMarker}-${submissionId}-完整保存校验` })
  const adminOrigin = new URL(siteBaseUrl).origin
  if (new URL(apiBaseUrl).origin !== adminOrigin) throw new Error('备注准备的后台 Web 与 API 必须同源')
  const context = await browser.newContext({ ignoreHTTPSErrors, viewport: { width: 1440, height: 1000 }, locale: resolveAdminLocale(variables) })
  const observer = attachNetworkObserver(context, { initialPhase: '准备本次答卷检索样本',
    onApiResponse: recordApiResponse, onResourceResponse: recordResourceResponse })
  const writes = []
  const authViolations = []
  context.on('request', request => {
    const url = new URL(request.url())
    const headers = request.headers()
    if (url.origin !== adminOrigin) {
      if (headers.authorization) authViolations.push(`${request.method()} ${url.origin}${url.pathname}`)
      return
    }
    if (!url.pathname.startsWith(new URL(apiBaseUrl).pathname.replace(/\/+$/, '') + '/')) return
    if (headers.authorization !== authorization) authViolations.push(`${request.method()} ${url.pathname}`)
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writes.push(`${request.method()} ${url.pathname}`)
  })
  try {
    await observer.ready
    await context.addInitScript(({ token, origin, locale }) => {
      if (location.origin !== origin) return
      localStorage.setItem('token', token)
      localStorage.setItem('arco-locale', locale)
    }, { token: authorization, origin: adminOrigin, locale: resolveAdminLocale(variables) })
    const page = await context.newPage()
    observeUiReadiness(page)
    page.setDefaultTimeout(scaleTimeout(30_000))
    const detailUrl = new URL(`/form-activity/submission/preview/reply/${encodeURIComponent(submissionId)}?fid=${encodeURIComponent(formId)}`, adminOrigin).toString()
    await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: scaleTimeout(45_000) })
    await requireExpect(page, '准备备注必须定位本次答卷详情').toHaveURL(detailUrl)
    await waitForUiReady(page)
    await openRemarkTab(page)
    const composer = page.locator('.reply-remark__composer-card')
    const textarea = composer.locator('textarea')
    await requireExpect(textarea, '应显示真实备注输入框').toBeVisible()
    await textarea.fill(searchSamples.remark)
    const endpoint = `/be/form/${formId}/submission/${submissionId}/remark`
    const saved = page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname.endsWith(endpoint))
    saved.catch(() => undefined)
    await clickWhenReady(composer.locator('button.arco-btn-primary'))
    const response = await saved
    requireExpect(response.request().postDataJSON()?.remark, '备注保存请求必须包含本次完整备注').toBe(searchSamples.remark)
    await readBusiness(response, '保存本次检索备注')
    await requireExpect(page.locator('.reply-remark__content').filter({ hasText: searchSamples.remark }), '保存后备注必须可见').toHaveText(searchSamples.remark)
    requireExpect(await observer.waitForIdle({ timeoutMs: scaleTimeout(45_000), signal }), '刷新备注前所有响应正文必须完成').toBe(true)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForUiReady(page)
    await assertPersistedSearchSamples(page, { apiBaseUrl, formId, submissionId, searchSamples })
    requireExpect(await observer.waitForIdle({ timeoutMs: scaleTimeout(45_000), signal }), '备注独立回读及资源必须完成').toBe(true)
    requireExpect(authViolations, '备注准备的后台请求必须携带环境 Token，且不得向其他域名泄漏').toEqual([])
    requireExpect(writes, '检索样本准备只能保存一次当前答卷备注，不得产生其他业务写入').toEqual([
      `POST ${new URL(apiBaseUrl).pathname.replace(/\/+$/, '')}${endpoint}`,
    ])
    logger('success', '已在本次公开答卷上准备备注，刷新并独立回读渠道、备注成功', { formId, submissionId, searchSamples })
    return searchSamples
  } finally {
    try { await observer.stop({ signal }) } finally { await context.close() }
  }
}
