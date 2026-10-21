import { launchGoogleChrome } from './support/google-chrome.mjs'
import { expect } from './support/recorded-expect.mjs'
import { expect as flowExpect, scaleTimeout } from './support/environment-timeouts.mjs'
import { closePlaywrightOnAbort, throwIfRunAborted } from './playwright-run-control.mjs'

async function read(response, label) {
  const body = await response.json()
  flowExpect(response.ok() && Number(body.code) === 0, `${label}必须成功`).toBe(true)
  return body.data
}

export function requireEditConflict(responseStatus, body, label) {
  // Authentication, permission and ordinary validation failures are not edit conflicts.
  const messages = [body?.message, ...Object.values(body?.errors ?? {}).flat()].filter(value => typeof value === 'string')
  const explicitConflict = messages.some(message => [
    'form.edit_conflict',
    '表单在读取后已被修改，请重新读取并核对变化后再保存或发布。',
    '表單在讀取後已被修改，請重新讀取並核對變更後再儲存或發佈。',
    'This form changed after it was read. Reload it and review the changes before saving or publishing.',
  ].includes(message.trim()))
  const conflict = [200, 409, 422].includes(responseStatus)
    && Number(body?.code) === 30001 && explicitConflict
  expect(conflict, `${label}必须明确返回编辑冲突，不能将鉴权或普通参数错误当作通过`).toBe(true)
  flowExpect(conflict, `${label}必须确认是编辑冲突`).toBe(true)
}

export async function run({ apiBaseUrl, variables = {}, extraHTTPHeaders, ignoreHTTPSErrors = false,
  signal, logger = () => undefined, artifactWriter }) {
  const formId = String(variables.FORM_ID ?? '').trim()
  if (!/^[a-zA-Z0-9_-]+$/.test(formId)) throw new Error('并发检查需要明确的 FORM_ID')
  const authorization = extraHTTPHeaders?.Authorization
  if (!authorization) throw new Error('并发检查需要环境登录 Token')
  const endpoint = `${apiBaseUrl.replace(/\/$/, '')}/be/form/${encodeURIComponent(formId)}`
  const browser = await launchGoogleChrome()
  const contexts = []
  const stopAbortClose = closePlaywrightOnAbort(signal, () => ({ browser }), { logger })
  let originalShow
  let headerKey
  let changed = false
  let ownToken
  let requestA
  try {
    for (let i = 0; i < 2; i += 1) {
      contexts.push(await browser.newContext({ ignoreHTTPSErrors,
        extraHTTPHeaders: { Authorization: authorization },
      }))
    }
    requestA = contexts[0].request
    const requestB = contexts[1].request
    const options = { timeout: scaleTimeout(30_000) }
    const before = await read(await requestA.get(`${endpoint}?draft=1`, options), '编辑者 A 读取草稿')
    const second = await read(await requestB.get(`${endpoint}?draft=1`, options), '编辑者 B 读取草稿')
    const form = before.form
    flowExpect(form.status, '并发检查仅用于已发布的测试表单').toBe('published')
    flowExpect(Number(form.draft_revision_no || 0), '检查前不能覆盖已有未发布草稿，请使用本次创建的表单').toBe(0)
    flowExpect(form.edit_token, '详情必须返回 SHA-256 编辑令牌').toMatch(/^[a-f0-9]{64}$/)
    flowExpect(second.form.edit_token, '两个上下文读取同一持久状态应取得相同令牌').toBe(form.edit_token)
    headerKey = Object.hasOwn(form.theme_config?.header_image ?? {}, 'show') ? 'show' : 'hidden'
    originalShow = form.theme_config?.header_image?.[headerKey]
    flowExpect([true, false, 0, 1, 2].includes(originalShow), '头图开关必须明确，才能恢复').toBe(true)
    const newShow = headerKey === 'hidden' ? (Number(originalShow) === 1 ? 2 : 1)
      : (originalShow === true || originalShow === 1 ? 0 : 1)
    const data = { revision_no: Number(form.current_revision_no), expected_edit_token: form.edit_token,
      theme_config: { header_image: { [headerKey]: newShow } } }
    throwIfRunAborted(signal)
    // A timeout can follow a committed write, so cleanup also checks the persisted token.
    changed = true
    const saved = await read(await requestA.put(`${endpoint}/config`, { ...options, data }), '编辑者 A 修改头图开关')
    ownToken = saved.edit_token
    flowExpect(ownToken, '持久化修改后必须返回新的编辑令牌').toMatch(/^[a-f0-9]{64}$/)
    flowExpect(ownToken, '持久化修改后令牌必须推进').not.toBe(form.edit_token)
    const draft = await read(await requestA.get(`${endpoint}?draft=1`, options), '独立回读共享草稿')
    flowExpect(Number(draft.form.theme_config.header_image[headerKey]), '共享草稿应保存 A 的修改').toBe(newShow)
    const staleSave = await requestB.put(`${endpoint}/config`, { ...options,
      data: { ...data, theme_config: { header_image: { [headerKey]: originalShow } } },
    })
    const staleSaveBody = await staleSave.json()
    requireEditConflict(staleSave.status(), staleSaveBody, '编辑者 B 保存')
    const stalePublish = await requestB.post(`${endpoint}/publish`, { ...options,
      data: { expected_edit_token: form.edit_token },
    })
    const stalePublishBody = await stalePublish.json()
    requireEditConflict(stalePublish.status(), stalePublishBody, '编辑者 B 发布')
    const after = await read(await requestA.get(`${endpoint}?draft=1`, options), '冲突后回读草稿')
    expect(after.form.edit_token, '冲突请求不得改变 A 的草稿令牌').toBe(ownToken)
    expect(Number(after.form.theme_config.header_image[headerKey]), '冲突请求不得覆盖 A 的草稿内容').toBe(newShow)
    const published = await read(await requestA.get(`${endpoint}?draft=0`, options), '冲突后回读发布态')
    expect(Number(published.form.theme_config.header_image[headerKey]), '被拒绝的发布不得改变公开头图配置').toBe(Number(originalShow))
    expect(Number(published.form.current_revision_no), '被拒绝的发布不得推进发布版本').toBe(Number(form.current_revision_no))
    const evidence = { formId, staleSaveStatus: staleSave.status(), stalePublishStatus: stalePublish.status(),
      publishedRevision: Number(form.current_revision_no), draftRevision: Number(after.form.draft_revision_no) }
    if (artifactWriter) await artifactWriter.writeFile('edit-concurrency.json', JSON.stringify(evidence, null, 2),
      { encoding: 'utf8', type: 'attachment', mimeType: 'application/json' })
    logger('success', '两个独立 API 客户端已验证旧令牌保存与发布冲突，发布态未改变', evidence)
    return evidence
  } finally {
    try {
      if (changed && requestA && !signal?.aborted) {
        const state = await read(await requestA.get(`${endpoint}?draft=1`), '清理前回读草稿')
        // Never overwrite a third party's intervening save during cleanup.
        flowExpect(Boolean(ownToken) && state.form.edit_token === ownToken, '清理只能恢复本次检查留下的草稿').toBe(true)
        await read(await requestA.put(`${endpoint}/config`, { data: {
          revision_no: Number(state.form.current_revision_no), expected_edit_token: state.form.edit_token,
          theme_config: { header_image: { [headerKey]: originalShow } },
        } }), '恢复原头图开关')
        const restored = await read(await requestA.get(`${endpoint}?draft=1`), '恢复后独立回读')
        flowExpect(Number(restored.form.theme_config.header_image[headerKey]), '原头图开关必须恢复').toBe(Number(originalShow))
        logger('info', '并发检查已恢复头图开关，保留本次生成的未发布草稿', { formId })
      }
    } finally {
      const aborted = await stopAbortClose()
      if (!aborted) {
        await Promise.allSettled(contexts.map(context => context.close()))
        await browser.close()
      }
    }
  }
}
