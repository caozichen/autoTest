import assert from 'node:assert/strict'
import test from 'node:test'
import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'
import { assertPublicLanguageControl } from '../../scripts/support/public-language-control.mjs'
import { runWithAssertionRecorder } from '../../scripts/support/recorded-expect.mjs'
import { draftDefinitionSignature } from '../../scripts/form-multilingual-translation-publish.ui.spec.mjs'

test('translation metadata may change while the unpublished definition and revision remain intact', () => {
  const source = { data: { revision_no: 2, form: { id: 'one', current_revision_no: 1,
    draft_revision_no: 2, title: 'Unpublished title', edit_token: 'old', translation: { published: false },
    theme_config: { header_image: { hidden: 1 } } }, items: [{ item_key: 'name', sort: 1, type_code: 'input' }] } }
  const translated = structuredClone(source)
  translated.data.form.translation.published = true
  translated.data.form.edit_token = 'new'
  assert.deepEqual(draftDefinitionSignature(translated), draftDefinitionSignature(source))
  for (const mutate of [
    value => { value.data.form.current_revision_no = 2; value.data.form.draft_revision_no = 0 },
    value => { value.data.items[0].type_code = 'number' },
    value => { value.data.form.title = 'Overwritten' },
    value => { value.data.form.theme_config.header_image.hidden = 2 },
  ]) {
    const broken = structuredClone(translated)
    mutate(broken)
    assert.notDeepEqual(draftDefinitionSignature(broken), draftDefinitionSignature(source))
  }
})

test('language control assertions detect wrong labels, wrong placement and a visible single-language entry', async () => {
  const browser = await launchGoogleChrome()
  try {
    const page = await browser.newPage()
    for (const scenario of [
      { label: '简', position: 'absolute', language: 'zh_CN', headerVisible: true, failed: false },
      { label: '繁', position: 'fixed', language: 'zh_HK', headerVisible: false, failed: false },
      { label: 'EN', position: 'absolute', language: 'en_US', headerVisible: true, failed: false },
      { label: '简', position: 'absolute', language: 'zh_HK', headerVisible: true, failed: true },
      { label: '简', position: 'fixed', language: 'zh_CN', headerVisible: true, failed: true },
      { label: '简', position: 'absolute', language: 'zh_CN', headerVisible: true, visible: false, failed: true },
      { label: null, language: 'zh_CN', visible: false, failed: false },
    ]) {
      await page.setContent(scenario.label === null ? '<main>Single language</main>'
        : `<div style="position:${scenario.position}"><button aria-label="切换语言">${scenario.label}</button></div>`)
      const assertions = []
      await runWithAssertionRecorder('language-control', entry => assertions.push(entry), () => assertPublicLanguageControl(page, scenario))
      assert.equal(assertions.some(entry => entry.status === 'failed'), scenario.failed, JSON.stringify(scenario))
    }
  } finally {
    await browser.close()
  }
})
