import assert from 'node:assert/strict'
import test from 'node:test'
import { withEnvironmentTimeouts, scaleTimeout, expect } from '../../scripts/support/environment-timeouts.mjs'
import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'

test('isolates timeout multipliers across concurrent runs and async boundaries', async () => {
  const values = await Promise.all(['HK_PROD', 'TEST', 'CN_PROD', 'prod_hk'].map(code => withEnvironmentTimeouts(code, async () => {
    await new Promise(resolve => setTimeout(resolve, 5))
    return [scaleTimeout(30000), scaleTimeout(45000), scaleTimeout(180000), scaleTimeout(0)]
  })))
  assert.deepEqual(values, [[90000,135000,540000,0],[30000,45000,180000,0],[30000,45000,180000,0],[90000,135000,540000,0]])
  assert.equal(scaleTimeout(30000), 30000)
})
test('Chrome actions honor the scaled timeout and expect remains usable', async t => {
  const browser = await launchGoogleChrome(); t.after(() => browser.close())
  const page = await browser.newPage()
  await withEnvironmentTimeouts('HK', async () => {
    page.setDefaultTimeout(scaleTimeout(200))
    await page.setContent('<div id="root"></div>')
    await page.evaluate(() => setTimeout(() => document.querySelector('#root').innerHTML='<button>Ready</button>', 350))
    await page.getByRole('button').click()
    await expect(page.getByRole('button')).toHaveText('Ready')
    await expect.poll(async () => scaleTimeout(100)).toBe(300)
  })
})
