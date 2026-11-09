import assert from 'node:assert/strict'
import test from 'node:test'
import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'
import { runWithAssertionRecorder } from '../../scripts/support/recorded-expect.mjs'
import {
  assertChoiceContentImages,
  assertRadioChoiceImages,
  choiceContentImages,
  clickRadioOption,
  radioOptionControl,
} from '../../scripts/support/form-choice-images.mjs'
import { ONE_PIXEL_PNG } from './support/form-all-fields-submit-full-run-fixture.mjs'

const values = { 选项1: 'first', 选项2: 'second', 其他: 'other' }
const inlineImage = `data:image/png;base64,${ONE_PIXEL_PNG.toString('base64')}`

function markup({ decorated = true, hideControls = true } = {}) {
  return `<style>
    label { display: inline-flex; position: relative; width: 160px; min-height: 80px; padding: 20px; align-items: center; }
    img { width: 24px; height: 24px; }
    ${hideControls ? '.fb-ui-radio-group-item { position:absolute; width:1px; height:1px; padding:0; margin:0; overflow:hidden; clip-path:inset(50%); }' : ''}
  </style><article id="radio">${Object.entries(values).map(([name, value], index) => `
    <label for="choice-${index}">
      <button type="button" role="radio" id="choice-${index}" class="fb-ui-radio-group-item" value="${value}" data-state="unchecked"></button>
      ${index < 2 ? `<img src="http://choice-fixture.test/${index}.png" alt="${name}">
        ${decorated ? `<button data-option-image-preview type="button"><img src="${inlineImage}" alt="预览图标"></button>` : ''}` :
        (decorated ? `<img src="${inlineImage}" alt="">` : '')}
      <span>${name}</span>
    </label>`).join('')}</article>`
}

test('choice image checks distinguish content, preview icons and placeholders and click hidden radios through option labels', async t => {
  const browser = await launchGoogleChrome()
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.route('http://choice-fixture.test/**', route => route.fulfill({
    status: 200, contentType: 'image/png', body: ONE_PIXEL_PNG,
  }))
  for (const version of [
    { decorated: false, hideControls: false },
    { decorated: true, hideControls: true },
  ]) {
    await t.test(version.decorated ? 'release cards with 5 image nodes' : 'legacy labels with 2 image nodes', async () => {
      await page.setContent(markup(version))
      await page.evaluate(() => {
        document.querySelectorAll('.fb-ui-radio-group-item').forEach(control => {
          control.addEventListener('click', () => {
            document.querySelectorAll('.fb-ui-radio-group-item').forEach(item => item.dataset.state = 'unchecked')
            control.dataset.state = 'checked'
          })
        })
      })
      const field = page.locator('#radio')
      assert.equal(await field.locator('img').count(), version.decorated ? 5 : 2)
      await assertRadioChoiceImages(field, values)
      const other = await radioOptionControl(field, values['其他'])
      await clickRadioOption(other)
      assert.equal(await other.getAttribute('data-state'), 'checked')
      const first = await radioOptionControl(field, values['选项1'])
      await clickRadioOption(first)
      assert.equal(await first.getAttribute('data-state'), 'checked')
      assert.equal(await other.getAttribute('data-state'), 'unchecked')
      // Identity is resolved from value, even when card order differs.
      await page.evaluate(() => document.querySelector('#radio').prepend(document.querySelector('label[for="choice-1"]')))
      const second = await radioOptionControl(field, values['选项2'])
      await clickRadioOption(second)
      assert.equal(await second.getAttribute('data-state'), 'checked')
    })
  }
  await t.test('radio identity supports numeric values and CSS punctuation without broad matching', async () => {
    await page.setContent(markup())
    const first = page.locator('#choice-0')
    for (const value of [0, 'a" b\\c]']) {
      await first.evaluate((element, expected) => element.setAttribute('value', String(expected)), value)
      const selected = await radioOptionControl(page.locator('#radio'), value)
      assert.equal(await selected.getAttribute('id'), 'choice-0')
    }
  })
  await t.test('a missing content image is not replaced by decorative image nodes', async () => {
    await page.setContent(markup())
    await page.locator('#choice-0').locator('xpath=ancestor::label[1]').locator('img[alt="选项1"]').evaluate(element => element.remove())
    assert.equal(await page.locator('#radio img').count(), 4)
    assert.equal(await choiceContentImages(page.locator('#radio')).count(), 1)
    const assertions = []
    await runWithAssertionRecorder('form-lpxavn-submit', assertion => assertions.push(assertion),
      () => assertChoiceContentImages(page.locator('#radio'), 2))
    assert.ok(assertions.some(assertion => assertion.status === 'failed'
      && assertion.name.includes('应恰好显示 2 张选项内容图片')))
  })
  await t.test('broken HTTP content images fail actual image loading validation', async () => {
    await page.route('http://choice-fixture.test/broken.png', route => route.fulfill({
      status: 200, contentType: 'image/png', body: 'invalid image bytes',
    }))
    await page.setContent('<article id="broken"><img src="http://choice-fixture.test/broken.png" alt="选项1"></article>')
    await assert.rejects(() => assertChoiceContentImages(page.locator('#broken'), 1), /实际加载成功/)
  })
})
