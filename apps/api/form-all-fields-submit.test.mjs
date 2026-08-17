import assert from 'node:assert/strict'
import test from 'node:test'

import { chromium } from '@playwright/test'

import {
  EXPECTED_FORM_TITLE,
  FIELD_KEYS,
  FORM_CODE,
  FORM_URL,
  PAGE_FIELD_LABELS,
  SELECT_MAX_ATTEMPTS,
  createTestData,
  selectOption,
} from '../../scripts/form-all-fields-submit.ui.spec.mjs'

test('targets the published three-page all-fields form with every expected question', () => {
  assert.equal(FORM_CODE, 'qBM33p')
  assert.equal(FORM_URL, 'https://lx.lingxi.tech/form/?id=qBM33p')
  assert.equal(EXPECTED_FORM_TITLE, '自动化测试全题型表单-1786608677952')
  assert.deepEqual(PAGE_FIELD_LABELS.map((page) => page.length), [7, 10, 8])
  assert.equal(Object.keys(FIELD_KEYS).length, 25)
  assert.equal(new Set(Object.values(FIELD_KEYS)).size, 25)
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

test('selects an exact option from its own long list and retries an adjacent wrong value', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
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

    await page.setContent(`
      <style>
        body { min-height: 1000px; margin: 0; padding: 460px 24px 24px; }
        [role="listbox"] { background: white; border: 1px solid #ccc; }
        [role="option"] { box-sizing: border-box; height: 36px; padding: 8px; }
        #province-list { max-height: 108px; overflow-y: auto; width: 220px; }
        #stale-list { position: fixed; right: 10px; top: 10px; }
      </style>
      <button
        id="province-trigger"
        type="button"
        role="combobox"
        aria-controls="province-list"
        aria-expanded="false"
        data-state="closed"
      >省份</button>
      <div id="stale-list" role="listbox" data-state="closed">
        <div role="option" tabindex="-1">广东省</div>
      </div>
      <div id="province-list" role="listbox" data-state="closed" hidden>
        ${provinceOptions}
      </div>
      <script>
        const trigger = document.querySelector('#province-trigger')
        const listbox = document.querySelector('#province-list')
        const staleList = document.querySelector('#stale-list')
        let selectionAttempts = 0
        let staleSelections = 0
        let maxObservedScrollTop = 0

        function setOpen(open) {
          listbox.hidden = !open
          listbox.dataset.state = open ? 'open' : 'closed'
          trigger.dataset.state = open ? 'open' : 'closed'
          trigger.setAttribute('aria-expanded', String(open))
        }

        function commit(option) {
          selectionAttempts += 1
          maxObservedScrollTop = Math.max(maxObservedScrollTop, listbox.scrollTop)
          trigger.textContent = selectionAttempts === 1 ? '湖南省' : option.textContent.trim()
          setOpen(false)
        }

        trigger.addEventListener('click', () => setOpen(true))
        listbox.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && event.target.matches('[role="option"]')) commit(event.target)
        })
        staleList.addEventListener('click', () => { staleSelections += 1 })
        window.readFixtureState = () => ({
          selectionAttempts,
          staleSelections,
          maxObservedScrollTop,
        })
      </script>
    `)

    const logs = []
    const trigger = page.getByRole('combobox')
    await selectOption(page, trigger, '广东省', '地址-省份', (...entry) => logs.push(entry))

    assert.equal(await trigger.innerText(), '广东省')
    const fixtureState = await page.evaluate(() => window.readFixtureState())
    assert.equal(fixtureState.selectionAttempts, 2)
    assert.equal(fixtureState.staleSelections, 0)
    assert.ok(fixtureState.maxObservedScrollTop > 0)
    assert.equal(logs.length, 1)
    assert.equal(logs[0][0], 'warning')
    assert.match(logs[0][1], /第 1 次选择未生效/)
    assert.deepEqual(logs[0][2], {
      attempt: 1,
      expected: '广东省',
      actual: '湖南省',
    })
    assert.equal(SELECT_MAX_ATTEMPTS, 3)
  } finally {
    await browser.close()
  }
})
