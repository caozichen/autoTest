import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { uploadAndAssert } from '../../scripts/form-lpxavn-submit.ui.spec.mjs'
import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'
import { runWithAssertionRecorder } from '../../scripts/support/recorded-expect.mjs'

for (const label of ['图片上传', '文件上传']) {
  test(`${label} waits for completion beyond the former five-second thumbnail limit`, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'autotest-upload-wait-'))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const fileName = label === '图片上传' ? 'slow-image.png' : 'slow-file.txt'
    const filePath = join(directory, fileName)
    const imageUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH1sAAAAASUVORK5CYII='
    await writeFile(filePath, label === '图片上传' ? Buffer.from(imageUrl.split(',')[1], 'base64') : 'slow upload fixture')
    const browser = await launchGoogleChrome()
    t.after(() => browser.close())
    const page = await browser.newPage()
    await page.setContent(`<!doctype html><main>
      <input type="file"><span class="fb-runtime-upload-status" hidden>上传中</span>
      <div class="fb-runtime-upload-image-preview"></div>
      <script>
        document.querySelector('input').onchange = event => {
          const file = event.target.files[0]
          const status = document.querySelector('.fb-runtime-upload-status')
          status.hidden = false
          setTimeout(() => {
            status.textContent = file.name
            if (file.type.startsWith('image/')) {
              const image = new Image()
              image.alt = file.name
              image.src = ${JSON.stringify(imageUrl)}
              document.querySelector('.fb-runtime-upload-image-preview').append(image)
            }
          }, 6000)
        }
      </script></main>`)
    const assertions = []
    await runWithAssertionRecorder('form-submission-reply-create', entry => assertions.push(entry),
      () => uploadAndAssert(page.locator('main'), filePath, label))
    assert.equal(assertions.some(entry => entry.status === 'failed'), false, JSON.stringify(assertions))
    assert.match(await page.locator('.fb-runtime-upload-status').textContent(), /slow-/)
    if (label === '图片上传') {
      assert.equal(await page.locator('img').count(), 1)
      assert.equal(await page.locator('img').getAttribute('alt'), fileName)
    }
  })
}
