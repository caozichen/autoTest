import assert from 'node:assert/strict'
import test from 'node:test'

import {
  EXPECTED_FORM_TITLE,
  FIELD_KEYS,
  FORM_CODE,
  FORM_URL,
  PAGE_FIELD_KEYS,
  PAGE_FIELD_LABELS,
  SELECT_MAX_ATTEMPTS,
  SUBMISSION_RESULT_SELECTOR,
  SUBMISSION_RESULT_URL_PATTERN,
  assertVisibleSubmissionResult,
  createTestData,
  selectOption,
} from '../../scripts/form-all-fields-submit.ui.spec.mjs'
import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'
import { runWithAssertionRecorder } from '../../scripts/support/recorded-expect.mjs'

test('targets the published three-page all-fields form with every expected question', () => {
  assert.equal(FORM_CODE, 'qBM33p')
  assert.equal(FORM_URL, 'https://lx.lingxi.tech/form/?id=qBM33p')
  assert.equal(EXPECTED_FORM_TITLE, '自动化测试全题型表单-1786608677952')
  assert.deepEqual(PAGE_FIELD_LABELS.map((page) => page.length), [7, 10, 8])
  assert.deepEqual(PAGE_FIELD_KEYS.map((page) => page.length), [7, 10, 8])
  assert.equal(Object.keys(FIELD_KEYS).length, 25)
  assert.equal(new Set(Object.values(FIELD_KEYS)).size, 25)
  assert.equal(SUBMISSION_RESULT_SELECTOR, 'form-submission-result')
  assert.match('https://lx.lingxi.tech/form/submission-result/?submission_id=123', SUBMISSION_RESULT_URL_PATTERN)
  assert.doesNotMatch('https://lx.lingxi.tech/form/payment-result/?submission_id=123', SUBMISSION_RESULT_URL_PATTERN)
})

test('creates valid, unique and semantically matched form answers', () => {
  const data = createTestData(1786612345678)

  assert.match(data.username, /^自动化测试用户\d{4}$/)
  assert.match(data.mobile, /^139\d{8}$/)
  assert.equal(data.email, 'autotest_1786612345678@example.com')
  assert.match(data.idCard, /^\d{17}[\dX]$/)
  assert.equal(data.matrix.length, 3)
  assert.ok(data.matrix.every((row) => row.length === 3))
  assert.equal(data.matrix[2][2], '题目3-项目3答案')
  assert.deepEqual(data.ranking, ['选项2', '选项1', '选项3'])
  assert.equal(data.rating, 5)
  assert.equal(data.nps, 9)
})

test('accepts a visible result view when its custom-element host is hidden', async () => {
  const browser = await launchGoogleChrome()
  try {
    const page = await browser.newPage()
    await page.setContent(`
      <form-submission-result
        form-code="${FORM_CODE}"
        submission-id="submission-123"
        hidden
      ></form-submission-result>
      <main><h1>Submitted successfully</h1></main>
    `)

    assert.equal(await page.locator(SUBMISSION_RESULT_SELECTOR).isVisible(), false)
    assert.equal(await assertVisibleSubmissionResult(page, { timeout: 1_000 }), 'submission-123')
  } finally {
    await browser.close()
  }
})

test('selects an exact option from its own long list and retries an adjacent wrong value', async () => {
  const browser = await launchGoogleChrome()
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 600 } })
    const provinces = [
      '北京市', '天津市', '河北省', '山西省', '内蒙古自治区', '辽宁省', '吉林省', '黑龙江省',
      '上海市', '江苏省', '浙江省', '安徽省', '福建省', '江西省', '山东省', '河南省',
      '湖北省', '湖南省', '广东省', '广西壮族自治区', '海南省', '重庆市', '四川省', '贵州省',
      '云南省', '西藏自治区', '陕西省', '甘肃省', '青海省', '宁夏回族自治区', '新疆维吾尔自治区',
    ]
    const provinceOptions = provinces
      .map((province) => `<div role="option" tabindex="-1">${province}</div>`)
      .join('')
    const provinceLists = Array.from({ length: SELECT_MAX_ATTEMPTS }, (_, index) => `
      <div id="province-list-${index + 1}" role="listbox" data-state="closed" hidden>
        ${provinceOptions}
      </div>
    `).join('')

    await page.setContent(`
      <style>
        body { min-height: 1000px; margin: 0; padding: 460px 24px 24px; }
        [role="listbox"] { background: white; border: 1px solid #ccc; }
        [role="option"] { box-sizing: border-box; height: 36px; padding: 8px; }
        [id^="province-list-"] { max-height: 108px; overflow-y: auto; width: 220px; }
        #stale-list { position: fixed; right: 10px; top: 10px; }
      </style>
      <div id="form-root">
        <button
          id="province-trigger"
          type="button"
          role="combobox"
          aria-controls="unmounted-list"
          aria-expanded="false"
          data-state="closed"
        >省份</button>
      </div>
      <div id="stale-list" role="listbox" data-state="closed">
        <div role="option" tabindex="-1">广东省</div>
      </div>
      ${provinceLists}
      <script>
        const trigger = document.querySelector('#province-trigger')
        const listboxes = [...document.querySelectorAll('[id^="province-list-"]')]
        const staleList = document.querySelector('#stale-list')
        const formRoot = document.querySelector('#form-root')
        let activeListbox = null
        let openCount = 0
        let selectionAttempts = 0
        let staleSelections = 0
        let maxObservedScrollTop = 0

        function setOpen(open) {
          if (open) {
            for (const listbox of listboxes) {
              listbox.hidden = true
              listbox.dataset.state = 'closed'
            }
            activeListbox = listboxes[Math.min(openCount, listboxes.length - 1)]
            openCount += 1
            activeListbox.hidden = false
            activeListbox.dataset.state = 'open'
            trigger.setAttribute('aria-controls', activeListbox.id)
          } else if (activeListbox) {
            activeListbox.hidden = true
            activeListbox.dataset.state = 'closed'
          }
          trigger.dataset.state = open ? 'open' : 'closed'
          trigger.setAttribute('aria-expanded', String(open))
          if (open) formRoot.setAttribute('aria-hidden', 'true')
          else formRoot.removeAttribute('aria-hidden')
        }

        function commit(option) {
          selectionAttempts += 1
          maxObservedScrollTop = Math.max(maxObservedScrollTop, activeListbox.scrollTop)
          trigger.textContent = selectionAttempts === 1 ? '湖南省' : option.textContent.trim()
          setOpen(false)
        }

        trigger.addEventListener('click', () => setOpen(true))
        for (const listbox of listboxes) {
          listbox.addEventListener('click', (event) => {
            const option = event.target.closest('[role="option"]')
            if (option) commit(option)
          })
          listbox.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && event.target.matches('[role="option"]')) commit(event.target)
          })
        }
        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') setOpen(false)
        })
        staleList.addEventListener('click', () => { staleSelections += 1 })
        window.readFixtureState = () => ({
          selectionAttempts,
          staleSelections,
          maxObservedScrollTop,
          openCount,
        })
      </script>
    `)

    const logs = []
    const assertions = []
    const trigger = page.locator('#province-trigger')
    await runWithAssertionRecorder('form-all-fields-submit', (assertion) => assertions.push(assertion), () => (
      selectOption(page, trigger, ['广东省', '廣東省'], '地址-省份', (...entry) => logs.push(entry))
    ))

    assert.equal(await trigger.innerText(), '广东省')
    const fixtureState = await page.evaluate(() => window.readFixtureState())
    assert.equal(fixtureState.selectionAttempts, 2)
    assert.equal(fixtureState.openCount, 2)
    assert.equal(fixtureState.staleSelections, 0)
    assert.ok(fixtureState.maxObservedScrollTop > 0)
    assert.equal(logs.length, 1)
    assert.equal(logs[0][0], 'warning')
    assert.match(logs[0][1], /第 1 次选择未生效/)
    assert.deepEqual({
      attempt: logs[0][2].attempt,
      expected: logs[0][2].expected,
      actual: logs[0][2].actual,
    }, {
      attempt: 1,
      expected: '广东省 / 廣東省',
      actual: '湖南省',
    })
    assert.match(logs[0][2].reason, /精确回显/)
    assert.ok(assertions.some((assertion) => (
      assertion.status === 'passed' && assertion.name.includes('成功选择“广东省”')
    )))
    assert.equal(SELECT_MAX_ATTEMPTS, 3)
  } finally {
    await browser.close()
  }
})
