import { describe, expect, it } from 'vitest'

import {
  buildPublicScriptRequestUrl,
  buildScriptRequestUrl,
  defaultRequestPathForScript,
  normalizeScriptRequestPath,
  publicOriginForEnvironment,
  requestOriginForScript,
  resolveScriptRequestPath,
  segmentScriptRequestPath,
  supportsScriptRequestPath,
} from './script-request-url'

describe('script request URL', () => {
  it('enables linked URL configuration for submission, list checking, reply creation, editing, and translation scripts', () => {
    expect(supportsScriptRequestPath('form-lpxavn-submit')).toBe(true)
    expect(supportsScriptRequestPath('form-all-fields-submit')).toBe(true)
    expect(supportsScriptRequestPath('form-submission-reply-edit')).toBe(true)
    expect(supportsScriptRequestPath('form-submission-reply-create')).toBe(true)
    expect(supportsScriptRequestPath('form-submission-list-check')).toBe(true)
    expect(supportsScriptRequestPath('form-multilingual-translation-publish')).toBe(true)
    expect(supportsScriptRequestPath('form-all-fields-publish')).toBe(false)
    expect(defaultRequestPathForScript('form-lpxavn-submit')).toBe('/form/?id={{FORM_ID}}')
    expect(defaultRequestPathForScript('form-all-fields-submit')).toBe('/form/?id={{FORM_ID}}')
    expect(defaultRequestPathForScript('form-submission-reply-edit')).toBe(
      '/form-activity/submission/preview/reply/{{SUBMISSION_ID}}?fid={{FORM_ID}}',
    )
    expect(defaultRequestPathForScript('form-submission-reply-create')).toBe(
      '/form-activity/submission/preview/reply/create?fid={{FORM_ID}}',
    )
    expect(defaultRequestPathForScript('form-submission-list-check')).toBe(
      '/form-activity/submission/preview?id={{FORM_ID}}',
    )
    expect(defaultRequestPathForScript('form-multilingual-translation-publish')).toBe(
      '/form-activity/translation?id={{FORM_ID}}',
    )
  })

  it('derives the public form domain from the selected environment', () => {
    expect(publicOriginForEnvironment('https://prodtest.admin.lingxi360.com/')).toBe('https://prodtest.form.lingxi360.com')
    expect(publicOriginForEnvironment('https://jxdr.admin.lingxi360.com/form-activity/list')).toBe('https://jxdr.form.lingxi360.com')
    expect(publicOriginForEnvironment('https://prodtest.admin.lxi.hk/')).toBe('https://prodtest.lxi.hk')
    expect(publicOriginForEnvironment('https://lx.admin.lingxi.tech/')).toBe('https://lx.lingxi.tech')
    expect(publicOriginForEnvironment('https://jxdr.b.lingxi-hk.localtest/base')).toBe(
      'https://jxdr.f.lingxi-hk.localtest',
    )
    expect(publicOriginForEnvironment('https://public.example.test/base')).toBe('https://public.example.test')
  })

  it.each([
    ['https://prodtest.admin.lingxi360.com', 'https://prodtest.form.lingxi360.com'],
    ['https://prodtest.admin.lxi.hk', 'https://prodtest.lxi.hk'],
    ['https://lx.admin.lingxi.tech', 'https://lx.lingxi.tech'],
  ])('uses public and admin routes consistently for all five scripts in %s', (adminOrigin, publicOrigin) => {
    for (const scriptId of ['form-lpxavn-submit', 'form-all-fields-submit']) {
      expect(buildScriptRequestUrl(scriptId, adminOrigin, defaultRequestPathForScript(scriptId), { FORM_ID: 'linked' }))
        .toBe(`${publicOrigin}/form/?id=linked`)
    }
    for (const scriptId of ['form-submission-reply-create', 'form-submission-list-check', 'form-multilingual-translation-publish']) {
      const url = new URL(buildScriptRequestUrl(scriptId, adminOrigin, defaultRequestPathForScript(scriptId), { FORM_ID: 'linked' }))
      expect(url.origin).toBe(adminOrigin)
      expect(url.searchParams.get(scriptId === 'form-submission-reply-create' ? 'fid' : 'id')).toBe('linked')
    }
  })

  it('uses the admin origin for submission list checking, reply creation, editing, and multilingual translation', () => {
    const siteBaseUrl = 'https://lx.admin.lingxi.tech/console'
    expect(requestOriginForScript('form-lpxavn-submit', siteBaseUrl)).toBe('https://lx.lingxi.tech')
    expect(requestOriginForScript('form-all-fields-submit', siteBaseUrl)).toBe('https://lx.lingxi.tech')
    expect(requestOriginForScript('form-submission-reply-edit', siteBaseUrl)).toBe(
      'https://lx.admin.lingxi.tech',
    )
    expect(requestOriginForScript('form-submission-reply-create', siteBaseUrl)).toBe(
      'https://lx.admin.lingxi.tech',
    )
    expect(requestOriginForScript('form-submission-list-check', siteBaseUrl)).toBe(
      'https://lx.admin.lingxi.tech',
    )
    expect(requestOriginForScript('form-multilingual-translation-publish', siteBaseUrl)).toBe(
      'https://lx.admin.lingxi.tech',
    )
    expect(buildScriptRequestUrl(
      'form-submission-reply-edit',
      siteBaseUrl,
      '/form-activity/submission/preview/reply/{{SUBMISSION_ID}}?fid={{FORM_ID}}',
      { SUBMISSION_ID: 'lpXAWZ', FORM_ID: 'lg2bkk' },
    )).toBe(
      'https://lx.admin.lingxi.tech/form-activity/submission/preview/reply/lpXAWZ?fid=lg2bkk',
    )
    expect(buildScriptRequestUrl(
      'form-submission-reply-create',
      siteBaseUrl,
      '/form-activity/submission/preview/reply/create?fid={{FORM_ID}}',
      { FORM_ID: 'q3r72J' },
    )).toBe(
      'https://lx.admin.lingxi.tech/form-activity/submission/preview/reply/create?fid=q3r72J',
    )
    expect(buildScriptRequestUrl(
      'form-submission-list-check',
      siteBaseUrl,
      '/form-activity/submission/preview?id={{FORM_ID}}',
      { FORM_ID: '4J02PQ' },
    )).toBe(
      'https://lx.admin.lingxi.tech/form-activity/submission/preview?id=4J02PQ',
    )
    expect(buildScriptRequestUrl(
      'form-multilingual-translation-publish',
      siteBaseUrl,
      '/form-activity/translation?id={{FORM_ID}}',
      { FORM_ID: 'dynamic-form-id' },
    )).toBe(
      'https://lx.admin.lingxi.tech/form-activity/translation?id=dynamic-form-id',
    )
  })

  it('normalizes and combines a configurable relative path', () => {
    expect(normalizeScriptRequestPath(' form/?id=custom ')).toBe('/form/?id=custom')
    expect(buildPublicScriptRequestUrl(
      'https://lx.admin.lingxi.tech/',
      '/form/?id=custom',
    )).toBe('https://lx.lingxi.tech/form/?id=custom')
  })

  it('resolves runtime variables before combining the final URL', () => {
    expect(normalizeScriptRequestPath('/form/?id={{ FORM_ID }}')).toBe('/form/?id={{ FORM_ID }}')
    expect(resolveScriptRequestPath('/form/?id={{ FORM_ID }}', { FORM_ID: 'dynamic-123' }))
      .toBe('/form/?id=dynamic-123')
    expect(buildPublicScriptRequestUrl(
      'https://lx.admin.lingxi.tech/',
      '/form/?id={{FORM_ID}}',
      { FORM_ID: 'dynamic-123' },
    )).toBe('https://lx.lingxi.tech/form/?id=dynamic-123')
  })

  it('matches request path variables without regard to English letter casing', () => {
    expect(resolveScriptRequestPath('/form/?id={{form_id}}', { FORM_ID: 'upper-source' }))
      .toBe('/form/?id=upper-source')
    expect(resolveScriptRequestPath('/form/?id={{ FORM_ID }}', { form_id: 'lower-source' }))
      .toBe('/form/?id=lower-source')
    expect(resolveScriptRequestPath('/form/?id={{Form_Id}}', { FORM_ID: 'mixed-source' }))
      .toBe('/form/?id=mixed-source')
  })

  it('lets later variable sources override earlier keys with different casing', () => {
    expect(resolveScriptRequestPath('/form/?id={{FORM_ID}}', {
      FORM_ID: 'default-id',
      form_id: 'runtime-id',
    })).toBe('/form/?id=runtime-id')
  })

  it('segments complete variable placeholders for request path highlighting', () => {
    expect(segmentScriptRequestPath('/form/?id={{form_id}}&next={{ Submission_Id }}')).toEqual([
      { text: '/form/?id=', variable: false },
      { text: '{{form_id}}', variable: true },
      { text: '&next=', variable: false },
      { text: '{{ Submission_Id }}', variable: true },
    ])
    expect(segmentScriptRequestPath('/form/?id={{FORM_ID}')).toEqual([
      { text: '/form/?id={{FORM_ID}', variable: false },
    ])
    expect(segmentScriptRequestPath('/form/?query=<value>&id={{FORM_ID}}')).toEqual([
      { text: '/form/?query=<value>&id=', variable: false },
      { text: '{{FORM_ID}}', variable: true },
    ])
  })

  it('rejects absolute URLs and empty paths', () => {
    expect(() => normalizeScriptRequestPath('')).toThrow('请输入 URL 路径')
    expect(() => normalizeScriptRequestPath('https://other.example.test/form')).toThrow('请输入相对路径')
    expect(() => normalizeScriptRequestPath('//other.example.test/form')).toThrow('请输入相对路径')
    expect(() => normalizeScriptRequestPath('/\\other.example.test/form')).toThrow('不能包含反斜杠')
    expect(() => normalizeScriptRequestPath('/form/?id={{FORM_ID}')).toThrow('变量格式无效')
    expect(() => resolveScriptRequestPath('/form/?id={{MISSING}}', {})).toThrow('未定义变量')
    expect(() => resolveScriptRequestPath('{{TARGET_PATH}}', {
      TARGET_PATH: '//other.example.test/form',
    })).toThrow('请输入相对路径')
  })
})
