import { expect } from './recorded-expect.mjs'
import { expect as flowExpect, scaleTimeout } from './environment-timeouts.mjs'
import { clickWhenReady, waitForUiReady } from './ui-readiness.mjs'

const SAVE_AND_SWITCH = /^(保存并切换|儲存並切換|Save and switch)$/i
const SAVE_AND_PUBLISH = /^(保存后发布|儲存後發[佈布]|Save and publish)$/i
const STEPS = {
  settings: /基础设置|基礎設定|Basic Settings/i,
  message: /消息及触达|訊息及觸達|Messages & Outreach/i,
  share: /分享与传播|分享與傳播|Sharing & Distribution/i,
}

function budget(timeout) {
  const deadline = Date.now() + timeout
  return () => Math.max(1, deadline - Date.now())
}

function requireContract(value, message) {
  expect(Boolean(value), message).toBe(true)
  if (!value) throw new Error(message)
}

function currentFormId(page) {
  const id = new URL(page.url()).searchParams.get('id')
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('表单导航需要当前页面中明确的表单 ID')
  return id
}

function confirmation(page, name) {
  // Scope the button to the host's modal; never confirm an unrelated editor dialog.
  return page.locator('.arco-modal:visible').filter({ has: page.getByRole('button', { name }) })
}

function watchWrites(page, formId, label) {
  const entries = []
  const tracked = new WeakMap()
  const onRequest = request => {
    const match = new URL(request.url()).pathname.match(/\/be\/form\/([^/]+)\/(items|config|publish)\/?$/)
    if (!match || match[1] !== String(formId)
      || request.method() !== (match[2] === 'publish' ? 'POST' : 'PUT')) return
    try { if (request.frame().page() !== page) return } catch { return }
    const entry = { kind: match[2], request, settled: false }
    tracked.set(request, entry)
    entries.push(entry)
  }
  const onResponse = response => {
    const entry = tracked.get(response.request())
    if (!entry) return
    entry.response = response
    // Read immediately, before the application's successful navigation releases the document.
    response.json().then(body => {
      entry.body = body
      if (!response.ok() || Number(body?.code) !== 0) {
        entry.error = `${label} ${entry.kind} 失败（HTTP ${response.status()}，业务码 ${body?.code ?? '缺失'}）：${body?.message ?? '响应无法确认成功'}`
      }
      entry.settled = true
    }, () => {
      entry.error = `${label} ${entry.kind} 响应无法读取为 JSON（HTTP ${response.status()}）`
      entry.settled = true
    })
  }
  const onFailed = request => {
    const entry = tracked.get(request)
    if (!entry) return
    entry.error = `${label} ${entry.kind} 请求失败：${request.failure()?.errorText ?? '网络中断'}`
    entry.settled = true
  }
  page.on('request', onRequest)
  page.on('response', onResponse)
  page.on('requestfailed', onFailed)
  return {
    entries,
    failure: () => entries.find(entry => entry.error),
    settled: () => entries.every(entry => entry.settled),
    stop() {
      page.off('request', onRequest)
      page.off('response', onResponse)
      page.off('requestfailed', onFailed)
    },
  }
}

function assertWrites(watcher, formId, label, required = []) {
  const failure = watcher.failure()
  requireContract(!failure, failure?.error ?? `${label}保存和发布接口应成功`)
  for (const kind of required) {
    requireContract(watcher.entries.some(entry => entry.kind === kind && entry.settled && !entry.error),
      `${label}必须真实完成 ${kind} 保存，不能只关闭弹窗`)
  }
  let previousToken
  let savedRevision
  for (const entry of watcher.entries) {
    const data = entry.body?.data
    if (data?.form_id != null) requireContract(String(data.form_id) === String(formId), `${label}响应应属于当前表单`)
    let payload
    try { payload = entry.request.postDataJSON() } catch { /* Report missing credentials through the normal observer. */ }
    if (previousToken) requireContract(payload?.expected_edit_token === previousToken,
      `${label}连续保存和发布必须使用上一步返回的编辑令牌`)
    if (savedRevision != null) requireContract(Number(data?.revision_no) === savedRevision,
      `${label}连续保存和发布应使用同一草稿版本`)
    if (entry.kind !== 'publish') {
      requireContract(Number.isInteger(Number(data?.revision_no)) && Number(data.revision_no) > 0,
        `${label}保存响应应包含有效草稿版本`)
      if (payload?.expected_edit_token != null) {
        requireContract(/^[a-f0-9]{64}$/.test(data?.edit_token ?? ''), `${label}保存响应应包含有效编辑令牌`)
      }
      savedRevision = Number(data.revision_no)
    }
    previousToken = data?.edit_token
  }
}

async function waitForOutcome(page, readOutcome, remaining, label) {
  let outcome
  await flowExpect.poll(async () => {
    try {
      outcome = page.isClosed() ? 'closed' : await readOutcome()
    } catch (error) {
      if (!page.isClosed()) throw error
      outcome = 'closed'
    }
    return outcome !== 'waiting'
  }, { timeout: remaining(), intervals: [50, 100, 200], message: label }).toBe(true)
  requireContract(outcome !== 'closed', `${label}期间页面已关闭，停止等待和保存`)
  return outcome
}

// The original modal may remain visible throughout saving and its close animation.
// Only a confirmation seen after it closed is a second confirmation.
function afterConfirmation(readOutcome) {
  let closed = false
  return async () => {
    const outcome = await readOutcome()
    if (outcome === 'dialog') {
      return closed ? 'repeated-dialog' : 'waiting'
    }
    if (outcome === 'waiting') closed = true
    return outcome
  }
}

/** Trigger once, handle at most one save, then require the actual destination. */
export async function navigateForm(page, {
  action, arrived, label, formId = currentFormId(page), expectSaved = true,
  logger = () => {}, timeout = scaleTimeout(45_000),
}) {
  const remaining = budget(timeout)
  const designer = new URL(page.url()).pathname.endsWith('/designer')
  const dialog = confirmation(page, SAVE_AND_SWITCH)
  const watcher = watchWrites(page, formId, label)
  let savedBeforeSwitch = false
  try {
    await action({ timeout: remaining() })
    const readOutcome = async () => {
      if (watcher.failure()) return 'error'
      if (await dialog.isVisible()) return 'dialog'
      if (await arrived() && watcher.settled()) return 'arrived'
      return 'waiting'
    }
    let outcome = await waitForOutcome(page, readOutcome, remaining, `${label}应到达目标或显示保存并切换确认`)
    if (outcome === 'dialog') {
      logger(expectSaved ? 'warning' : 'info', `${label}出现未保存修改确认，将通过页面保存后继续`, { expectedSaved: expectSaved })
      if (expectSaved) expect(false, `${label}已保存且没有新增修改时应直接切换`).toBe(true)
      await clickWhenReady(dialog.getByRole('button', { name: SAVE_AND_SWITCH }), { timeout: remaining() })
      savedBeforeSwitch = true
      outcome = await waitForOutcome(page, afterConfirmation(readOutcome), remaining,
        `${label}保存后必须到达目标；校验失败或仍有新修改时停止，禁止重复保存`)
      requireContract(outcome !== 'repeated-dialog', `${label}保存后再次出现未保存确认，已停止重复保存`)
    }
    assertWrites(watcher, formId, label, savedBeforeSwitch ? (designer ? ['items', 'config'] : ['config']) : [])
    await waitForUiReady(page, { timeout: remaining() })
    requireContract(await arrived(), `${label}应确认实际目标页面或栏目，不能只确认弹窗关闭`)
    return { savedBeforeSwitch, saves: watcher.entries }
  } finally {
    watcher.stop()
  }
}

export async function openFormSettingsMenu(page, key, { ready, logger, label = `切换到 ${key} 设置`, ...options } = {}) {
  if (!/^[a-z-]+$/.test(key)) throw new Error('设置栏目 key 无效')
  const menu = page.locator(`[data-menu-key="${key}"]`)
  await navigateForm(page, {
    ...options, logger, label,
    action: clickOptions => clickWhenReady(menu, clickOptions),
    arrived: () => ready ? ready.isVisible() : menu.evaluate(element => element.classList.contains('fb-bg-blue-100')),
  })
}

export async function openFormSettingsStep(page, step, { ready, logger, label = `切换到 ${step} 步骤`, ...options } = {}) {
  if (!STEPS[step]) throw new Error('表单步骤无效')
  const formId = String(options.formId ?? currentFormId(page))
  const origin = new URL(page.url()).origin
  const link = page.locator('.form-activity-step-nav .form-activity-step').filter({ hasText: STEPS[step] })
  await navigateForm(page, {
    ...options, formId, logger, label,
    action: clickOptions => clickWhenReady(link, clickOptions),
    arrived: async () => {
      const url = new URL(page.url())
      return url.origin === origin && url.pathname.endsWith('/form-activity/settings') && url.searchParams.get('id') === formId
        && (step === 'settings' ? !['message', 'share'].includes(url.searchParams.get('step')) : url.searchParams.get('step') === step)
        && (!ready || await ready.isVisible())
    },
  })
}

/** Full-document readback must never silently discard an editor's unsaved work. */
export async function reloadSavedFormPage(page, { timeout = scaleTimeout(45_000), label = '保存后刷新回读' } = {}) {
  const remaining = budget(timeout)
  await waitForUiReady(page, { timeout: remaining() })
  const dirty = await page.evaluate(() => [...document.querySelectorAll('form-designer, form-settings')]
    .some(editor => typeof editor.getHasUnsavedChanges === 'function' && editor.getHasUnsavedChanges()))
  requireContract(!dirty, `${label}前不应残留未保存修改；已停止刷新以保留页面内容`)
  let blocked = false
  let unexpectedDialog
  const onDialog = async dialog => {
    if (dialog.type() === 'beforeunload') blocked = true
    else unexpectedDialog = dialog.type()
    await dialog.dismiss().catch(() => {})
  }
  page.on('dialog', onDialog)
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: remaining() })
    requireContract(!blocked, `${label}被未保存内容保护拦截，已取消刷新`)
    await waitForUiReady(page, { timeout: remaining() })
    requireContract(!unexpectedDialog, `${label}出现意外的原生弹窗：${unexpectedDialog}`)
  } catch (error) {
    if (blocked) throw new Error(`${label}被未保存内容保护拦截，已取消刷新`, { cause: error })
    throw error
  } finally {
    page.off('dialog', onDialog)
  }
}

/** Wait for either publication or its delayed save confirmation, without racing two timeouts. */
export async function publishFormFromDesigner(page, {
  formId = currentFormId(page), label = '设计器发布', logger = () => {}, timeout = scaleTimeout(45_000),
} = {}) {
  const remaining = budget(timeout)
  const watcher = watchWrites(page, formId, label)
  const dialog = confirmation(page, SAVE_AND_PUBLISH)
  let savedBeforePublish = false
  const published = () => watcher.entries.find(entry => entry.kind === 'publish' && entry.settled)
  try {
    await clickWhenReady(page.getByRole('button', { name: /^(发布|發[佈布]|Publish)$/i }), { timeout: remaining() })
    const outcome = await waitForOutcome(page, async () => {
      if (watcher.failure()) return 'error'
      if (published() && watcher.settled()) return 'published'
      if (await dialog.isVisible()) return 'dialog'
      return 'waiting'
    }, remaining, `${label}应返回发布响应或显示保存后发布确认`)
    if (outcome === 'dialog') {
      logger('info', `${label}需要先保存，正在确认保存后发布`)
      await clickWhenReady(dialog.getByRole('button', { name: SAVE_AND_PUBLISH }), { timeout: remaining() })
      savedBeforePublish = true
      const savedOutcome = await waitForOutcome(page, afterConfirmation(async () => {
        if (watcher.failure()) return 'error'
        if (published() && watcher.settled()) return 'published'
        return await dialog.isVisible() ? 'dialog' : 'waiting'
      }), remaining, `${label}保存成功后必须实际发布；校验失败时禁止重复保存`)
      requireContract(savedOutcome !== 'repeated-dialog', `${label}保存后再次出现发布确认，已停止重复保存`)
    }
    assertWrites(watcher, formId, label, savedBeforePublish ? ['items', 'config', 'publish'] : ['publish'])
    return { ...published(), saves: watcher.entries.filter(entry => entry.kind !== 'publish'), savedBeforePublish }
  } finally {
    watcher.stop()
  }
}
