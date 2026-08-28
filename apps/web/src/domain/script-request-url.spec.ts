import { describe, expect, it } from 'vitest'

import {
  buildPublicScriptRequestUrl,
  buildScriptRequestUrl,
  defaultRequestPathForScript,
  normalizeScriptRequestPath,
  publicOriginForEnvironment,
  requestOriginForScript,
  resolveScriptRequestPath,
  supportsScriptRequestPath,
} from './script-request-url'

describe('script request URL', () => {
  it('enables linked URL configuration for submission and reply editing scripts', () => {
    expect(supportsScriptRequestPath('form-lpxavn-submit')).toBe(true)
    expect(supportsScriptRequestPath('form-all-fields-submit')).toBe(true)
    expect(supportsScriptRequestPath('form-submission-reply-edit')).toBe(true)
    expect(supportsScriptRequestPath('form-all-fields-publish')).toBe(false)
    expect(defaultRequestPathForScript('form-lpxavn-submit')).toBe('/form/?id={{FORM_CODE}}')
    expect(defaultRequestPathForScript('form-all-fields-submit')).toBe('/form/?id={{FORM_CODE}}')
    expect(defaultRequestPathForScript('form-submission-reply-edit')).toBe(
      '/form-activity/submission/preview/reply/{{SUBMISSION_ID}}?fid={{FORM_ID}}',
    )
  })

  it('derives the public form domain from the selected environment', () => {
    expect(publicOriginForEnvironment('https://lx.admin.lingxi.tech/')).toBe('https://lx.lingxi.tech')
    expect(publicOriginForEnvironment('https://jxdr.b.lingxi-hk.localtest/base')).toBe(
      'https://jxdr.f.lingxi-hk.localtest',
    )
    expect(publicOriginForEnvironment('https://public.example.test/base')).toBe('https://public.example.test')
  })

  it('uses the admin origin for submission reply editing only', () => {
    const siteBaseUrl = 'https://lx.admin.lingxi.tech/console'
    expect(requestOriginForScript('form-lpxavn-submit', siteBaseUrl)).toBe('https://lx.lingxi.tech')
    expect(requestOriginForScript('form-all-fields-submit', siteBaseUrl)).toBe('https://lx.lingxi.tech')
    expect(requestOriginForScript('form-submission-reply-edit', siteBaseUrl)).toBe(
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
