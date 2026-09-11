import assert from 'node:assert/strict'
import test from 'node:test'
import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'
import { rankOptions } from '../../scripts/form-lpxavn-submit.ui.spec.mjs'

test('selects ranking labels without clicking an overlapping centre or drag handle', async t => {
  const browser = await launchGoogleChrome()
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.setContent(`<main><div class="fb-runtime-ranking-ranked-list"></div>${['选项1','选项2','选项3'].map(label => `<div class="fb-runtime-ranking-item" style="width:600px;height:50px;position:relative"><span class="fb-runtime-ranking-label">${label}</span><span style="position:absolute;left:100px;right:0;top:0;bottom:0" onclick="event.stopPropagation()"></span></div>`).join('')}</main>`)
  await page.evaluate(() => {
    document.querySelectorAll('.fb-runtime-ranking-item').forEach(item => item.onclick = () => {
      const list = document.querySelector('.fb-runtime-ranking-ranked-list')
      if (item.parentElement === list) item.remove()
      else list.append(item)
    })
  })
  await rankOptions(page.locator('main'), ['选项2','选项1','选项3'])
  assert.deepEqual(await page.locator('.fb-runtime-ranking-ranked-list .fb-runtime-ranking-label').allTextContents(), ['选项2','选项1','选项3'])
})
