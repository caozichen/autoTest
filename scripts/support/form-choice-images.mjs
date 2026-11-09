import { expect } from './recorded-expect.mjs'
import { expect as flowExpect, scaleTimeout } from './environment-timeouts.mjs'
import { clickWhenReady } from './ui-readiness.mjs'

// Both form versions give content images the option label as alt text.
// Empty-alt placeholders and the independent preview button are decorative.
export function choiceContentImages(scope) {
  return scope.locator('img[alt]:not([alt=""]):not([data-option-image-preview] img)')
}

export async function assertChoiceContentImages(scope, count, label = '单项选择') {
  const images = choiceContentImages(scope)
  await expect(images, `${label}应恰好显示 ${count} 张选项内容图片`).toHaveCount(count)
  // Recorded business assertions can continue after failure. Preserve the count
  // failure without spending another locator timeout on a missing image.
  const available = Math.min(count, await images.count())
  for (let index = 0; index < available; index += 1) {
    const image = images.nth(index)
    await expect(image, `${label}第 ${index + 1} 张内容图片应包含 HTTP 地址`)
      .toHaveAttribute('src', /^https?:\/\//)
    await expect(image, `${label}第 ${index + 1} 张内容图片应可见`).toBeVisible()
    await expect.poll(() => image.evaluate(element => element.complete), {
      timeout: scaleTimeout(60_000),
      message: `${label}第 ${index + 1} 张内容图片应完成加载`,
    }).toBe(true)
    expect(await image.evaluate(element => element.naturalWidth),
      `${label}第 ${index + 1} 张内容图片必须实际加载成功`).toBeGreaterThan(0)
  }
  return images
}

export async function radioOptionControl(field, value, label = '单项选择') {
  const valid = (typeof value === 'string' && value.trim().length > 0)
    || (typeof value === 'number' && Number.isFinite(value))
  await expect(valid, `${label}选项必须具有发布契约中的 value`).toBe(true)
  flowExpect(valid, `${label}选项 value 缺失时不得继续点击`).toBe(true)
  const escaped = await field.evaluate((_, expected) => CSS.escape(expected), String(value))
  const control = field.locator(`.fb-ui-radio-group-item:is([value=${escaped}], [data-value=${escaped}])`)
  await expect(control, `${label}应有且仅有一个 value=${value} 的控件`).toHaveCount(1)
  await flowExpect(control, `${label}选项身份必须唯一才能继续`).toHaveCount(1)
  return control
}

export async function clickRadioOption(control, label = '单项选择') {
  const card = control.locator('xpath=ancestor::label[1]')
  await expect(card, `${label}控件应属于唯一选项标签`).toHaveCount(1)
  await flowExpect(card, `${label}必须定位选项标签后才可点击`).toHaveCount(1)
  // The label is the actual target in both versions; image mode hides the radio.
  await clickWhenReady(card)
}

export async function assertRadioChoiceImages(field, optionValues) {
  await assertChoiceContentImages(field, 2)
  const ordinaryOptions = Object.entries(optionValues).filter(([name]) => name !== '其他')
  expect(ordinaryOptions, '单项选择必须有两个普通图片选项').toHaveLength(2)
  flowExpect(ordinaryOptions, '单项选择普通选项身份必须完整').toHaveLength(2)
  for (const [name, value] of ordinaryOptions) {
    const control = await radioOptionControl(field, value, `单项选择“${name}”`)
    await assertChoiceContentImages(control.locator('xpath=ancestor::label[1]'), 1, `单项选择“${name}”`)
  }
  const other = await radioOptionControl(field, optionValues['其他'], '单项选择“其他”')
  await expect(choiceContentImages(other.locator('xpath=ancestor::label[1]')),
    '单项选择“其他”占位图不得充当上传内容图片').toHaveCount(0)
}
