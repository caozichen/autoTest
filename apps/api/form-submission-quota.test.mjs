import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'
import { configureSubmissionQuota, assertSubmissionQuotaPersistence } from '../../scripts/support/form-post-collection-settings.mjs'
import { assertSubmissionQuotaRejection } from '../../scripts/form-lpxavn-submit.ui.spec.mjs'
import { runWithAssertionRecorder } from '../../scripts/support/recorded-expect.mjs'

const content = { enabled: true, quota: 2, message: '本表单填报名额已满（上限2人），暂不接受新的填报。' }

test('quota persistence and rejection cannot pass changed values under the assertion recorder', () => {
  for (const change of [value => { value.enabled = 2 }, value => { value.quota = 4 }, value => { value.message = '旧提示' }]) {
    const actual = { enabled: 1, quota: 2, message: content.message }
    change(actual)
    assert.throws(() => runWithAssertionRecorder('form-all-fields-publish', () => {},
      () => assertSubmissionQuotaPersistence(actual, content)), /必须全部匹配/)
  }
  const rejection = body => ({ response: { status: () => 200 }, body })
  for (const code of [40004, 800003]) assertSubmissionQuotaRejection(rejection({ code, message: content.message }), content)
  for (const body of [
    { code: 0, message: content.message },
    { code: 400, message: content.message },
    { code: 800003, message: '旧提示' },
    { code: 800003, message: content.message, data: { submission_id: 'unexpected' } },
    { code: 800003, message: content.message, data: { result_token: 'unexpected' } },
  ]) assert.throws(() => runWithAssertionRecorder('form-lpxavn-submit', () => {},
    () => assertSubmissionQuotaRejection(rejection(body), content)))
})

test('quota UI saves and survives reload in simplified Chinese, traditional Chinese and English', async t => {
  let stored = { enabled: 2 }
  const requests = []
  const labels = {
    cn: ['填报数量限制开关', '请输入数字', '编辑填报数量限制', '确认'],
    hk: ['填報數量限制開關', '請輸入數字', '編輯填報數量限制', '確定'],
    en: ['Submission quantity limit switch', 'Please enter a number', 'Edit submission quantity limit', 'Confirm'],
  }
  const server = createServer(async (request, response) => {
    if (request.url === '/be/form/quota-test/config' && request.method === 'PUT') {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks).toString())
      requests.push(body)
      stored = body.submit_config.submission_quota
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ code: 0 }))
      return
    }
    if (request.url === '/be/form/quota-test') {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ submit_config: { submission_quota: stored } }))
      return
    }
    const locale = new URL(request.url, 'http://fixture').searchParams.get('locale') || 'cn'
    const [toggle, placeholder, edit, confirm] = labels[locale]
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end(`<html><head><link rel="icon" href="data:,"></head><body>
      <button data-menu-key="form">Settings</button><div class="fb-rounded-lg">
      <button role="switch" aria-label="${toggle}" aria-checked="${stored.enabled === 1}" data-state="${stored.enabled === 1 ? 'checked' : 'unchecked'}"></button>
      <section></section></div><script>
      let quota = ${JSON.stringify(stored)}
      const toggle = document.querySelector('[role=switch]')
      const panel = document.querySelector('section')
      function render(editing) {
        panel.replaceChildren()
        if (toggle.getAttribute('aria-checked') !== 'true') return
        if (editing) {
          panel.innerHTML = '<input placeholder="${placeholder}" value="' + (quota.quota || '') + '"><input><button>${confirm}</button>'
          const inputs = panel.querySelectorAll('input')
          inputs[1].value = quota.message || ''
          panel.querySelector('button').onclick = async () => {
            quota = { enabled: 1, quota: Number(inputs[0].value), message: inputs[1].value }
            await fetch('/be/form/quota-test/config', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ submit_config: { submission_quota: quota } }) })
            render(false)
          }
        } else {
          const count = document.createElement('div'); count.textContent = quota.quota
          const message = document.createElement('p'); message.textContent = quota.message
          const edit = document.createElement('button'); edit.setAttribute('aria-label', '${edit}'); edit.textContent = 'Edit'; edit.onclick = () => render(true)
          panel.append(count, message, edit)
        }
      }
      toggle.onclick = () => { toggle.setAttribute('aria-checked','true'); toggle.setAttribute('data-state','checked'); render(true) }
      render(false)
      </script></body></html>`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const origin = `http://127.0.0.1:${server.address().port}`
  const browser = await launchGoogleChrome()
  t.after(() => browser.close())
  const page = await browser.newPage()
  for (const locale of Object.keys(labels)) {
    stored = { enabled: 2 }
    await page.goto(`${origin}/?locale=${locale}`)
    const result = await configureSubmissionQuota({
      page, formId: 'quota-test', content, logger: () => {},
      readForm: () => fetch(`${origin}/be/form/quota-test`).then(r => r.json()),
      inspectBusinessResponse: async response => ({ succeeded: response.ok() && (await response.json()).code === 0 }),
    })
    assert.deepEqual(result.savedParameters, { enabled: 1, quota: 2, message: content.message })
  }
  assert.equal(requests.length, 3, 'each locale must save exactly once')
})
