import { expect } from './recorded-expect.mjs'

export async function assertGreenContribution(page, payload, { success = true } = {}) {
  const form = payload?.data?.form ?? payload?.form
  const items = payload?.data?.items ?? payload?.items
  const config = form?.notification_config?.green_contribution
  const section = page.locator('[data-submit-green-contribution]')
  const lineGrams = config?.calculation?.description_line_grams
  const itemGrams = config?.calculation?.form_item_grams
  const display = success && Number(config?.enabled ?? 1) === 1 && Array.isArray(items)
    && Number.isFinite(lineGrams) && lineGrams >= 0 && Number.isFinite(itemGrams) && itemGrams >= 0
  if (!display) {
    await expect(section, '关闭、失败或缺少计算参数时不应展示绿色贡献').toHaveCount(0)
    return null
  }
  // Count server definitions once, independently of visible cards and answer instances.
  const questionCount = items.filter(item => item.item_kind !== 'system'
    && !['page', 'field_group', 'fieldGroup', 'description', 'divider'].includes(item.type_code)).length
  const lineCount = await page.evaluate(description => {
    const text = String(description ?? '')
    if (!/<\/?[a-z][^>]*>/i.test(text)) return text.split(/\r\n?|\n/).filter(line => line.trim()).length
    const content = document.createElement('div')
    content.innerHTML = text.replace(/\r\n?|\n/g, ' ')
    content.querySelectorAll('script, style').forEach(node => node.remove())
    content.querySelectorAll('br').forEach(node => node.replaceWith('\n'))
    content.querySelectorAll('p, div, li, h1, h2, h3, h4, h5, h6, blockquote, pre, tr')
      .forEach(node => { node.prepend('\n'); node.append('\n') })
    return content.textContent.replace(/[\u200B-\u200D\uFEFF]/g, '').split('\n').filter(line => line.trim()).length
  }, form.description)
  const amount = String(Math.round((lineCount * lineGrams + questionCount * itemGrams + Number.EPSILON) * 10) / 10)
  await expect(section, '开启绿色贡献时成功结果页应唯一展示贡献说明').toHaveCount(1)
  await expect(section, '绿色贡献说明应可见').toBeVisible()
  await expect(section, '绿色贡献数值应按描述行和静态题目数计算').toContainText(new RegExp(`(?:^|[^\\d.])${amount.replace('.', '\\.')}([^\\d.]|$)`))
  if (config.provider_name) await expect(section, '绿色贡献应展示当前系统供应商').toContainText(config.provider_name)
  return { amount, questionCount, lineCount }
}
