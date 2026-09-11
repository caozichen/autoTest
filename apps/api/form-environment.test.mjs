import assert from 'node:assert/strict'
import test from 'node:test'

import { publicOriginForSite } from '../../shared/form-environment.mjs'
import { buildFormUrl } from '../../scripts/form-lpxavn-submit.ui.spec.mjs'
import { buildPublicPreviewUrl } from '../../scripts/form-multilingual-translation-publish.ui.spec.mjs'

test('public filling and translation previews use the correct origin in all environments', () => {
  for (const [site, origin] of [
    ['https://prodtest.admin.lingxi360.com/console', 'https://prodtest.form.lingxi360.com'],
    ['https://jxdr.admin.lingxi360.com/', 'https://jxdr.form.lingxi360.com'],
    ['https://prodtest.admin.lxi.hk/', 'https://prodtest.lxi.hk'],
    ['https://lx.admin.lingxi.tech/', 'https://lx.lingxi.tech'],
    ['http://jxdr.b.lingxi-hk.localtest:8080/base', 'http://jxdr.f.lingxi-hk.localtest:8080'],
    ['http://127.0.0.1:4321/base', 'http://127.0.0.1:4321'],
  ]) {
    assert.equal(publicOriginForSite(site), origin)
    assert.equal(buildFormUrl(site, '/form/?id=linked'), `${origin}/form/?id=linked`)
    for (const language of ['zh_CN', 'zh_HK', 'en_US']) {
      assert.equal(buildPublicPreviewUrl(site, 'linked', language), `${origin}/form/?id=linked&locale=${language}`)
    }
    assert.equal(publicOriginForSite(origin), origin, 'already-public origins stay unchanged')
  }
})

test('mainland mapping requires the exact production hostname convention', () => {
  assert.equal(publicOriginForSite('https://tenant.admin.lingxi360.com.example.test'), 'https://tenant.lingxi360.com.example.test')
  assert.equal(publicOriginForSite('https://tenant.admin.notlingxi360.com'), 'https://tenant.notlingxi360.com')
  assert.throws(() => publicOriginForSite('file:///tmp/form'), /http 或 https/)
})
