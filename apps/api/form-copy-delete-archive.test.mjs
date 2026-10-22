import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import test from 'node:test'

import {
  copyTitleFor,
  identifyNewCopy,
  openFormMoreMenu,
} from '../../scripts/form-copy-delete-archive.ui.spec.mjs'
import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'
import { clickWhenReady } from '../../scripts/support/ui-readiness.mjs'
import { resolveScriptEntryUrl, validateScriptConfig } from './script-config-repository.mjs'

test('registers the universal copy flow with the requested source and standard timeout', async () => {
  const config = validateScriptConfig(JSON.parse(await readFile(
    new URL('../../config/scripts/form-copy-delete-archive.json', import.meta.url), 'utf8',
  )))
  assert.equal(config.name, '表单复制-删除归档')
  assert.equal(config.timeoutMs, 600_000)
  assert.equal(config.inputParameters.find(parameter => parameter.key === 'FORM_ID')?.value, 'lg2wd5')
  await import(await resolveScriptEntryUrl(config))
})

test('identifies only the new same-name copy and rejects unsafe or ambiguous IDs', () => {
  const title = copyTitleFor('原表单')
  assert.equal(title, '原表单 - 复制')
  const previousIds = new Set(['oldcopy'])
  const records = [
    { id: 'oldcopy', title, status: 'published' },
    { id: 'newcopy', title, status: 'draft' },
    { id: 'unrelated', title: '其他表单', status: 'draft' },
  ]
  assert.equal(identifyNewCopy(records, previousIds, title, 'source', 'newcopy').id, 'newcopy')
  assert.throws(() => identifyNewCopy(records, previousIds, title, 'source', 'wrongcopy'))
  assert.throws(() => identifyNewCopy([...records, { id: 'another', title }], previousIds, title, 'source'))
  assert.throws(() => identifyNewCopy([{ id: 'source', title }], previousIds, title, 'source'))
})

for (const copyLabel of ['复制', '複製']) {
  test(`copies the selected row through its body-mounted ${copyLabel} menu`, async t => {
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(`<!doctype html>
        <table><tbody>
          <tr data-id="other"><td><button aria-label="更多">…</button></td></tr>
          <tr data-id="source"><td><button aria-label="更多">…</button></td></tr>
        </tbody></table>
        <div class="form-activity-operation-dropdown" style="display:none">
          <button>${copyLabel}</button>
        </div>
        <script>
          window.copies = [];
          for (const row of document.querySelectorAll('tr')) {
            row.querySelector('button').onclick = () => {
              const menu = document.createElement('div');
              menu.className = 'form-activity-operation-dropdown';
              const copy = document.createElement('button');
              copy.textContent = '${copyLabel}';
              copy.onclick = () => { window.copies.push(row.dataset.id); menu.remove(); };
              menu.append(copy); document.body.append(menu);
            };
          }
        </script>`)
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    t.after(() => { server.closeAllConnections(); server.close() })
    const browser = await launchGoogleChrome()
    t.after(() => browser.close())
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    const sourceRow = page.locator('tr[data-id="source"]')
    assert.equal(await sourceRow.getByRole('button', { name: copyLabel }).count(), 0)
    const menu = await openFormMoreMenu(page, sourceRow, '源表单')
    await clickWhenReady(menu.getByRole('button', { name: /^(复制|複製)$/ }))
    assert.deepEqual(await page.evaluate(() => window.copies), ['source'])
  })
}
