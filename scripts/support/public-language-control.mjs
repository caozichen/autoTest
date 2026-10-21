import { expect } from './recorded-expect.mjs'
import { expect as flowExpect, scaleTimeout } from './environment-timeouts.mjs'
import { createPageCompletionTracker } from './page-response-completion.mjs'

export const LANGUAGE_CONTROL_NAME = /切换语言|切換語言|Switch language/i
const SHORT_LABEL = { zh_CN: '简', zh_HK: '繁', en_US: 'EN' }

export async function assertPublicLanguageControl(page, { visible = true, language, headerVisible = true }) {
  const trigger = page.getByRole('button', { name: LANGUAGE_CONTROL_NAME })
  await expect(trigger, visible ? '多语言公开页应唯一显示语言入口' : '单语言公开页应隐藏语言入口')
    .toHaveCount(visible ? 1 : 0)
  if (!visible) return
  await flowExpect(trigger, '语言入口必须可见才能验证位置和当前语言').toBeVisible()
  await expect(trigger, '语言入口应显示当前语言简写').toHaveText(SHORT_LABEL[language])
  const position = await trigger.evaluate(button => getComputedStyle(button.parentElement).position)
  expect(position, headerVisible ? '有头图时语言入口应位于表单头部' : '无头图时语言入口应使用固定定位')
    .toBe(headerVisible ? 'absolute' : 'fixed')
}

// Feed two explicit response fixtures into the deployed renderer. This is UI
// coverage only: these variants never save a form or claim backend acceptance.
export async function inspectLanguageControlVariants(context, previewUrl, payload, formId, { completionTracker } = {}) {
  const origin = new URL(previewUrl).origin
  const tracker = completionTracker ?? createPageCompletionTracker(context, { origins: [origin] })
  try {
    for (const variant of ['no-header', 'single-language']) {
      const page = await context.newPage()
      page.setDefaultTimeout(scaleTimeout(30_000))
      let intercepted = 0
      try {
        await page.route(url => url.origin === origin && url.pathname.endsWith(`/f/form/${formId}`), async route => {
          const fixture = structuredClone(payload)
          const form = fixture.data?.form
          if (!form) throw new Error('语言布局响应夹具缺少 data.form')
          if (variant === 'no-header') {
            form.thumb = { ...form.thumb, show: false }
            form.theme_config = { ...form.theme_config, header_image: { ...form.theme_config?.header_image, hidden: 1 } }
          }
          else form.available_languages = ['zh_CN']
          form.resolved_language = 'zh_CN'
          intercepted += 1
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) })
        })
        await page.goto(previewUrl, { waitUntil: 'domcontentloaded' })
        await flowExpect(page.locator('.fb-runtime-form-title'), '语言布局夹具必须由真实公开渲染器挂载').toBeVisible()
        expect(intercepted, '语言布局场景必须实际使用指定响应夹具').toBeGreaterThan(0)
        await assertPublicLanguageControl(page, { visible: variant !== 'single-language',
          language: 'zh_CN', headerVisible: false })
        await tracker.waitForPage(page, `${variant}语言布局页面关闭前`)
      } finally {
        await page.close()
      }
    }
    return { source: 'renderer-response-fixtures', variants: ['no-header', 'single-language'] }
  } finally {
    if (!completionTracker) await tracker.dispose()
  }
}
