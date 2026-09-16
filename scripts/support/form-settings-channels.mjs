import { expect } from './recorded-expect.mjs'
import { expect as flowExpect, scaleTimeout } from './environment-timeouts.mjs'
import { clickWhenReady, waitForUiReady } from './ui-readiness.mjs'

const CONFIRM = /^(确认|確認)$/
const CATEGORY = /^(设置分类|設定分類)$/
const TAG = /^(设置标签|設定標籤)(?:[:：].*)?$/

function settingsUrl(page, formId, { step, menu } = {}) {
  const url = new URL('/form-activity/settings', page.url())
  url.searchParams.set('id', formId)
  if (step) url.searchParams.set('step', step)
  if (menu) url.hash = menu
  return url.toString()
}

function waitForResponse(page, method, path, payloadPredicate = () => true) {
  return page.waitForResponse(response => {
    const request = response.request()
    if (request.method() !== method || !new URL(response.url()).pathname.endsWith(path)) return false
    return payloadPredicate(request.postDataJSON())
  }, { timeout: scaleTimeout(45_000) })
}

async function successfulBody(response, label) {
  const body = await response.json()
  expect(response.ok(), `${label} HTTP 响应应成功`).toBe(true)
  expect(Number(body?.code), `${label}业务响应 code 应为 0`).toBe(0)
  if (!response.ok() || Number(body?.code) !== 0) throw new Error(`${label}失败，不能继续配置`)
  return body
}

function metadataOptions(body) {
  const candidates = [body, body?.list, body?.data, body?.data?.list, body?.data?.data?.list]
  const rows = candidates.find(Array.isArray) ?? []
  return rows.flatMap(row => {
    const id = row?.id ?? row?.value ?? row?.key ?? row?.code
    const name = row?.title ?? row?.label ?? row?.name
    return id == null || name == null || !String(name).trim()
      ? [] : [{ id: String(id), name: String(name) }]
  })
}

async function savedConfig(page, formId, action, key, label) {
  const [response] = await Promise.all([
    waitForResponse(page, 'PUT', `/be/form/${formId}/config`, payload => (
      key === 'channel' ? Array.isArray(payload?.share_config?.channel)
        : payload?.submitted_config?.[key] != null
    )),
    action(),
  ])
  await successfulBody(response, label)
  await waitForUiReady(page)
  const payload = response.request().postDataJSON()
  return structuredClone(key === 'channel' ? payload.share_config.channel : payload.submitted_config[key])
}

async function reloadDetail(page, formId, label) {
  const [response] = await Promise.all([
    waitForResponse(page, 'GET', `/be/form/${formId}`),
    page.reload({ waitUntil: 'domcontentloaded' }),
  ])
  const body = await successfulBody(response, label)
  await waitForUiReady(page)
  return body?.data?.form ?? body?.data?.data?.form ?? body?.data
}

async function checked(control) {
  return await control.getAttribute('aria-checked') === 'true'
    || await control.getAttribute('data-state') === 'checked'
}

export function assertClassificationTagOptionsAvailable(selectedCategory, selectedTag) {
  expect(Boolean(selectedCategory || selectedTag), '分类与标签至少应有一个可选项；都没有时跳过本项并保留失败断言').toBe(true)
  return true
}

/** Configure one submit-success behavior rule, retaining the server's exact ID representation. */
export async function configureFormClassificationTags({
  page, formId, logger = () => {}, assertOptionsAvailable = assertClassificationTagOptionsAvailable,
}) {
  logger('info', '进入分类与标签，读取当前环境可选分类和标签')
  const [categoryResponse, tagResponse] = await Promise.all([
    waitForResponse(page, 'GET', '/be/form/contact/category'),
    waitForResponse(page, 'GET', '/be/form/contact/tag'),
    page.goto(settingsUrl(page, formId, { menu: 'category' }), { waitUntil: 'domcontentloaded' }),
  ])
  const categories = metadataOptions(await successfulBody(categoryResponse, '读取联系人分类'))
  const tags = metadataOptions(await successfulBody(tagResponse, '读取联系人标签'))
  await waitForUiReady(page)
  const control = page.getByRole('switch', { name: /^(启用分类标签设定|啟用分類標籤設定)$/ })
  await flowExpect(control, '分类标签设定开关应可见').toBeVisible()
  const selectedCategory = categories[0] ?? null
  const selectedTag = tags[0] ?? null
  const availabilityAsserted = assertOptionsAvailable(selectedCategory, selectedTag)
  if (!selectedCategory && !selectedTag) {
    if (availabilityAsserted) logger('warning', '分类和标签均无可选项，跳过本项；本次运行保留失败断言')
    else logger('info', '内地分类和标签均无可选项，跳过本项；可选项存在断言已注释停用')
    return { enabled: await checked(control), trigger: 'submitted_success', categories: [], tags: [], skipped: true, reason: 'no-category-or-tag' }
  }
  if (!selectedCategory) logger('info', '当前环境没有分类，仅设置第一个标签')
  if (!selectedTag) logger('info', '当前环境没有标签，仅设置第一个分类')
  if (!await checked(control)) {
    const enabled = await savedConfig(page, formId, () => clickWhenReady(control), 'category_and_tag', '开启分类标签设定')
    expect(Number(enabled.enabled), '分类标签设定开启请求应为 enabled=1').toBe(1)
  }
  await flowExpect.poll(() => checked(control), { message: '分类标签设定开关必须开启' }).toBe(true)
  await clickWhenReady(page.getByRole('button', { name: /^(按行为设定|按行為設定)$/ }))
  const behaviorSection = page.locator('section').filter({
    has: page.getByRole('button', { name: /^(按行为设定说明|按行為設定說明)$/ }),
  }).last()
  await flowExpect(behaviorSection, '按行为设定编辑区应唯一可见').toHaveCount(1)
  const rows = page.locator('[id^="category-tag-behavior-row-"]')
  const previousCount = await rows.count()
  await clickWhenReady(behaviorSection.getByRole('button', { name: /^\+?\s*(添加|新增|继续添加|繼續添加)$/ }))
  await flowExpect(rows, '应新增一条按行为设定规则').toHaveCount(previousCount + 1)
  const row = rows.last()
  await clickWhenReady(row.getByRole('combobox').first())
  await clickWhenReady(page.getByRole('option', { name: /^提交成功$/ }))
  await expect(row.getByRole('combobox').first(), '分类标签规则的用户行为应为提交成功').toHaveText('提交成功')

  if (selectedCategory) {
    await clickWhenReady(row.getByRole('combobox', { name: CATEGORY }))
    const option = page.getByRole('option').first()
    await expect(option, '分类下拉首项应匹配接口返回的第一个分类').toHaveText(selectedCategory.name)
    await clickWhenReady(option)
    await expect(row.getByRole('combobox', { name: CATEGORY }), '应选中第一个分类').toHaveText(selectedCategory.name)
  }
  if (selectedTag) {
    const trigger = row.getByRole('button', { name: TAG })
    await clickWhenReady(trigger)
    // aria-labelledby derives the popover name from this trigger; selecting a
    // tag changes that name. Its aria-controls target remains stable.
    const popoverId = await trigger.getAttribute('aria-controls')
    flowExpect(popoverId, '标签按钮应关联多选浮层').toBeTruthy()
    const popover = page.locator(`[id=${JSON.stringify(popoverId)}][role="dialog"]`)
    await flowExpect(popover, '标签多选浮层应可见').toBeVisible()
    const firstLabel = popover.locator('label').first()
    await expect(firstLabel, '标签首项应匹配接口返回的第一个标签').toHaveText(selectedTag.name)
    const firstCheckbox = firstLabel.getByRole('checkbox')
    if (!await checked(firstCheckbox)) await clickWhenReady(firstCheckbox)
    await expect(firstCheckbox, '应选中第一个标签').toBeChecked()
    await clickWhenReady(popover.getByRole('button', { name: /^(完成|完成选择|完成選擇)$/ }))
    await expect(row.getByRole('button', { name: TAG }), '标签按钮应回显第一个标签').toContainText(selectedTag.name)
  }

  const savedParameters = await savedConfig(page, formId,
    () => clickWhenReady(page.getByRole('button', { name: CONFIRM })),
    'category_and_tag', '保存分类与标签行为规则')
  const rule = savedParameters.user_behavior?.at(-1)
  expect(Number(savedParameters.enabled), '分类与标签保存请求应保持开启').toBe(1)
  expect(rule?.action, '分类与标签保存参数应为提交成功行为 submitted_success').toBe('submitted_success')
  expect((rule?.category ?? []).map(String), '分类与标签保存参数应记录第一个分类 ID').toEqual(selectedCategory ? [selectedCategory.id] : [])
  expect((rule?.tag ?? []).map(String), '分类与标签保存参数应记录第一个标签 ID').toEqual(selectedTag ? [selectedTag.id] : [])
  const detail = await reloadDetail(page, formId, '刷新回读分类与标签配置')
  const persisted = detail?.submitted_config?.category_and_tag
  expect(persisted, '分类与标签刷新回读应与实际保存参数一致').toEqual(savedParameters)
  await expect(page.getByRole('switch', { name: /^(启用分类标签设定|啟用分類標籤設定)$/ }), '刷新后分类与标签应保持开启').toBeChecked()
  const summary = page.locator('section').filter({ has: page.getByRole('button', { name: /^(按行为设定|按行為設定)$/ }) }).last()
  await expect(summary, '刷新后行为规则应回显提交成功').toContainText('提交成功')
  if (selectedCategory) await expect(summary, '刷新后行为规则应回显选中的分类名称').toContainText(selectedCategory.name)
  if (selectedTag) await expect(summary, '刷新后行为规则应回显选中的标签名称').toContainText(selectedTag.name)
  logger('success', '分类与标签已保存并通过刷新回读', { categories: selectedCategory ? [selectedCategory] : [], tags: selectedTag ? [selectedTag] : [] })
  return { enabled: true, trigger: rule?.action, categories: selectedCategory ? [selectedCategory] : [], tags: selectedTag ? [selectedTag] : [], savedParameters: persisted, skipped: false }
}

/** Create and verify a channel without adding channel data to the downstream form contract. */
export async function createFormShareChannel({ page, formId, channelName, logger = () => {} }) {
  flowExpect(String(channelName ?? '').trim(), '新建分享渠道需要本次运行的渠道名称').not.toBe('')
  await page.goto(settingsUrl(page, formId, { step: 'share' }), { waitUntil: 'domcontentloaded' })
  const cards = page.locator('.share-link-channel-card')
  await flowExpect(cards.first(), '分享页必须至少显示默认渠道').toBeVisible()
  await waitForUiReady(page)
  const previousCount = await cards.count()
  logger('info', '创建本次自动化测试专用分享渠道')
  await clickWhenReady(page.getByRole('button', { name: /^(创建分享渠道|建立分享渠道)$/ }))
  await flowExpect(cards, '分享页应新增一个渠道卡片').toHaveCount(previousCount + 1)
  await cards.last().getByPlaceholder(/^(渠道名称|渠道名稱)$/).fill(channelName)
  const shareSection = page.locator('section').filter({ has: page.locator('.share-link-add-button') }).last()
  const confirm = shareSection.getByRole('button', { name: CONFIRM })
  await flowExpect(confirm, '分享渠道短链生成完成后才可确认').toBeEnabled({ timeout: scaleTimeout(45_000) })
  const savedChannels = await savedConfig(page, formId, () => clickWhenReady(confirm), 'channel', '保存新建分享渠道')
  expect(savedChannels.length, '分享渠道保存请求应新增恰好一个渠道').toBe(previousCount + 1)
  const channel = savedChannels.at(-1)
  expect(channel?.title, '新建分享渠道保存名称应匹配本次测试').toBe(channelName)
  expect(channel?.code, '新建分享渠道应具有非空标识').toMatch(/\S+/)
  expect(channel?.link, '新建分享渠道应具有长链').toMatch(/^https?:\/\//)
  expect(channel?.short_link, '新建分享渠道应具有短链').toMatch(/^https?:\/\//)
  const detail = await reloadDetail(page, formId, '刷新回读新建分享渠道')
  const persisted = detail?.share_config?.channel
  expect(persisted?.map(({ code, title, link, short_link }) => ({ code, title, link, short_link })),
    '分享渠道刷新回读的所有可编辑参数应与保存请求一致').toEqual(savedChannels)
  const storedChannel = persisted?.find(item => item.code === channel?.code)
  expect(String(storedChannel?.id ?? ''), '新建分享渠道回读应具有服务器分配的 ID').not.toBe('')
  expect(Number(storedChannel?.enabled), '新建分享渠道回读应为启用状态').toBe(1)
  await expect(cards, '刷新后新建分享渠道应保留').toHaveCount(previousCount + 1)
  await expect(cards.last().locator('.share-link-title-display'), '刷新后应回显本次分享渠道名称').toContainText(channelName)
  logger('success', '新建分享渠道已保存，并通过配置与页面刷新回读')
}
