import assert from 'node:assert/strict'
import test from 'node:test'

import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'
import { runWithAssertionRecorder } from '../../scripts/support/recorded-expect.mjs'
import { createFormLinkContract } from '../../scripts/support/form-link-contract.mjs'
import {
  createPublishedFormFixture,
  createSubmissionPayload,
  remapFixtureKeys,
} from './support/form-lpxavn-fixtures.mjs'

import {
  EXPECTED_FORM_TITLE,
  FIELD_KEYS,
  FORM_ID,
  FORM_PATH,
  PAGE_CARD_COUNTS,
  PAGE_FIELD_KEYS,
  PAGE_FIELD_LABELS,
  PUBLISHED_FIELD_TYPES,
  REQUIRED_ROOT_FIELD_KEYS,
  SUBMISSION_RESULT_SELECTOR,
  assertEmailFormatBoundary,
  assertPublishedFormContract,
  assertRuleValidationRejected,
  assertRuleValidationBlocked,
  assertSubmissionPayload,
  assertVisibleSubmissionResult,
  buildFormUrl,
  createTestData,
  dismissPublicErrorDialog,
  indexSubmissionEntries,
  isRetryablePageValidationStatus,
  normalizeFormPath,
  parseSubmissionRequestPayload,
  selectOption,
  waitForPublicMutation,
} from '../../scripts/form-lpxavn-submit.ui.spec.mjs'

test('targets the new lpXAVN form ID without sharing the previous form configuration', () => {
  assert.equal(FORM_ID, 'lpXAVN')
  assert.equal(FORM_PATH, '/form/?id=lpXAVN')
  assert.equal(EXPECTED_FORM_TITLE, '自动化测试全题型表单-1787048650389')
  assert.deepEqual(PAGE_FIELD_LABELS.map((page) => page.length), [7, 10, 10])
  assert.deepEqual(PAGE_FIELD_KEYS.map((page) => page.length), [7, 10, 10])
  assert.deepEqual(PAGE_CARD_COUNTS, [7, 10, 10])
  assert.equal(Object.keys(FIELD_KEYS).length, 30)
  assert.equal(new Set(Object.values(FIELD_KEYS)).size, 30)
  assert.equal(Object.keys(PUBLISHED_FIELD_TYPES).length, 30)
  assert.equal(REQUIRED_ROOT_FIELD_KEYS.length, 24)
})

test('records malformed validation and submission payloads without stopping later work', async () => {
  const assertions = []
  let reachedEnd = false
  const result = await runWithAssertionRecorder(
    'form-lpxavn-submit',
    (assertion) => assertions.push(assertion),
    () => {
      const businessCode = assertRuleValidationRejected(null, 'email_test', '邮箱')
      const payload = parseSubmissionRequestPayload({
        postDataJSON: () => { throw new Error('invalid JSON') },
        postData: () => null,
      })
      reachedEnd = true
      return { businessCode, payload }
    },
  )

  assert.equal(reachedEnd, true)
  assert.equal(Number.isNaN(result.businessCode), true)
  assert.deepEqual(result.payload, {})
  assert.ok(assertions.some((assertion) => (
    assertion.status === 'failed'
    && assertion.name.includes('规则校验接口应返回有效 JSON 对象')
  )))
  assert.ok(assertions.some((assertion) => (
    assertion.status === 'failed'
    && assertion.name.includes('提交请求应包含 JSON 请求体')
  )))
})

test('records submission body capture errors when both Playwright readers fail', async () => {
  const assertions = []
  let reachedEnd = false

  const payload = await runWithAssertionRecorder(
    'form-lpxavn-submit',
    (assertion) => assertions.push(assertion),
    () => {
      const result = parseSubmissionRequestPayload({
        postDataJSON: () => { throw new Error('JSON body unavailable') },
        postData: () => { throw new Error('raw body unavailable') },
      })
      reachedEnd = true
      return result
    },
  )

  assert.equal(reachedEnd, true)
  assert.deepEqual(payload, {})
  assert.ok(assertions.some((assertion) => (
    assertion.status === 'failed'
    && assertion.name.includes('提交请求体读取失败：raw body unavailable')
  )))
})

test('records a malformed published-form response and returns a safe contract', async () => {
  const assertions = []
  let reachedEnd = false

  const contract = await runWithAssertionRecorder(
    'form-lpxavn-submit',
    (assertion) => assertions.push(assertion),
    () => {
      const result = assertPublishedFormContract(null)
      reachedEnd = true
      return result
    },
  )

  assert.equal(reachedEnd, true)
  assert.equal(contract.revisionNo, 0)
  assert.equal(contract.formId, '')
  assert.deepEqual(contract.pageKeys, [])
  assert.ok(assertions.some((assertion) => (
    assertion.status === 'failed'
    && assertion.name.includes('公开表单配置接口应返回有效 JSON 对象')
  )))
  assert.ok(assertions.some((assertion) => (
    assertion.status === 'failed'
    && assertion.name.includes('公开表单配置接口响应应包含 items 数组')
  )))
})

test('accepts the complete published-form contract and returns its reusable option schema', () => {
  const contract = assertPublishedFormContract(createPublishedFormFixture())

  assert.equal(contract.revisionNo, 1)
  assert.deepEqual(contract.pageKeys, ['page_1', 'page_2', 'page_3'])
  assert.deepEqual(contract.requiredRootKeys, REQUIRED_ROOT_FIELD_KEYS)
  assert.deepEqual(contract.dateRange, { start: '2026-08-18', end: '2026-09-17' })
  assert.equal(contract.optionValues.radio['其他'], 'option_other')
  assert.deepEqual(contract.optionValues.cascader, ['east', 'jiangsu', 'nanjing'])
  assert.deepEqual(contract.optionValues.matrixChoice, ['col_1', 'col_2', 'col_3'])
})

test('validates the published-form contract against a configured form ID', () => {
  const fixture = createPublishedFormFixture()
  fixture.data.form.form_id = 'dynamic-form-id'

  assert.equal(
    assertPublishedFormContract(fixture, 'dynamic-form-id').revisionNo,
    1,
  )
  assert.throws(
    () => assertPublishedFormContract(fixture),
    /公开配置应属于目标表单/,
  )
})

test('resolves every generated question key and verifies the linked form contract', () => {
  const fixture = createPublishedFormFixture()
  const keyMap = remapFixtureKeys(fixture)
  fixture.data.form.form_id = 'linked-form-id'
  const linkedContract = {
    formId: 'linked-form-id',
    title: EXPECTED_FORM_TITLE,
    revisionNo: 1,
    fieldKeys: Object.fromEntries(Object.entries(FIELD_KEYS).map(([name, key]) => [name, keyMap.get(key)])),
  }

  const contract = assertPublishedFormContract(fixture, 'linked-form-id', linkedContract)

  assert.equal(contract.fieldKeys.radio, keyMap.get(FIELD_KEYS.radio))
  assert.equal(contract.fieldKeys.groupUsername, keyMap.get(FIELD_KEYS.groupUsername))
  assert.deepEqual(contract.pageFieldKeys.map((page) => page.length), [7, 10, 10])
})

test('records a missing linked question as an assertion failure without dereferencing undefined', async () => {
  const fixture = createPublishedFormFixture()
  fixture.data.items = fixture.data.items.filter((item) => item.item_key !== FIELD_KEYS.radio)
  const assertions = []

  await runWithAssertionRecorder('form-lpxavn-submit', (assertion) => assertions.push(assertion), async () => {
    const contract = assertPublishedFormContract(fixture)
    assert.equal(contract.fieldKeys.radio, '')
  })

  assert.ok(assertions.some((assertion) => assertion.status === 'failed' && assertion.name.includes('radio')))
})

test('records an incomplete cascader contract and returns safe placeholder values', async () => {
  const fixture = createPublishedFormFixture()
  const cascader = fixture.data.items.find((item) => item.item_key === FIELD_KEYS.cascader)
  cascader.option.choices[0].sub_choices = []
  const assertions = []
  let reachedEnd = false

  const contract = await runWithAssertionRecorder(
    'form-lpxavn-submit',
    (assertion) => assertions.push(assertion),
    () => {
      const result = assertPublishedFormContract(fixture)
      reachedEnd = true
      return result
    },
  )

  assert.equal(reachedEnd, true)
  assert.deepEqual(contract.optionValues.cascader, ['east', '', ''])
  assert.ok(assertions.some((assertion) => (
    assertion.status === 'failed'
    && assertion.name.includes('级联选择第三级选项应为数组')
  )))
  assert.ok(assertions.some((assertion) => (
    assertion.status === 'failed'
    && assertion.name.includes('级联选择应与发布脚本的固定三级路径一致')
  )))
})

test('records null option entries and still builds a reusable safe contract', async () => {
  const fixture = createPublishedFormFixture()
  const item = (key) => fixture.data.items.find((entry) => entry.item_key === key)
  item(FIELD_KEYS.username).common_config.name_title.choices[0] = null
  item(FIELD_KEYS.idCard).common_config.collect_mode.choices[0] = null
  item(FIELD_KEYS.radio).option.choices[0] = null
  item(FIELD_KEYS.checkbox).option.choices[0] = null
  item(FIELD_KEYS.select).option.choices[0] = null
  item(FIELD_KEYS.matrix).option.statements[0] = null
  item(FIELD_KEYS.matrix).option.dimensions[0] = null
  item(FIELD_KEYS.matrixChoice).option.statements[0] = null
  item(FIELD_KEYS.matrixChoice).option.choices[0] = null
  item(FIELD_KEYS.ranking).option.choices[0] = null
  const assertions = []
  let reachedEnd = false

  const contract = await runWithAssertionRecorder(
    'form-lpxavn-submit',
    (assertion) => assertions.push(assertion),
    () => {
      const result = assertPublishedFormContract(fixture)
      reachedEnd = true
      return result
    },
  )

  assert.equal(reachedEnd, true)
  assert.equal(contract.optionValues.nameTitle['Mr.（先生）'], undefined)
  assert.equal(contract.optionValues.radio['选项1'], undefined)
  assert.equal(contract.optionValues.checkbox['选项1'], undefined)
  assert.equal(contract.optionValues.select['选项1'], undefined)
  assert.deepEqual(contract.optionValues.matrixChoice, ['', 'col_2', 'col_3'])
  assert.equal(contract.optionValues.ranking['选项1'], undefined)
  for (const label of [
    '姓名称谓选项',
    '身份证件类型选项',
    '单项选择选项',
    '多项选择选项',
    '下拉选择选项',
    '矩阵题行配置',
    '矩阵题列配置',
    '矩阵选择行配置',
    '矩阵选择列选项',
    '排序题选项',
  ]) {
    assert.ok(assertions.some((assertion) => (
      assertion.status === 'failed'
      && assertion.name.includes(`${label}的每一项都应为对象`)
    )), `${label} 应记录结构断言失败`)
  }
})

test('records non-array option collections and returns empty safe defaults', async () => {
  const fixture = createPublishedFormFixture()
  const item = (key) => fixture.data.items.find((entry) => entry.item_key === key)
  item(FIELD_KEYS.username).common_config.name_title.choices = { invalid: true }
  item(FIELD_KEYS.idCard).common_config.collect_mode.choices = 'invalid'
  item(FIELD_KEYS.radio).option.choices = { invalid: true }
  item(FIELD_KEYS.checkbox).option.choices = 'invalid'
  item(FIELD_KEYS.select).option.choices = { invalid: true }
  item(FIELD_KEYS.cascader).option.choices = 'invalid'
  item(FIELD_KEYS.matrix).option.statements = { invalid: true }
  item(FIELD_KEYS.matrix).option.dimensions = 'invalid'
  item(FIELD_KEYS.matrixChoice).option.statements = { invalid: true }
  item(FIELD_KEYS.matrixChoice).option.choices = 'invalid'
  item(FIELD_KEYS.ranking).option.choices = { invalid: true }
  const assertions = []
  let reachedEnd = false

  const contract = await runWithAssertionRecorder(
    'form-lpxavn-submit',
    (assertion) => assertions.push(assertion),
    () => {
      const result = assertPublishedFormContract(fixture)
      reachedEnd = true
      return result
    },
  )

  assert.equal(reachedEnd, true)
  assert.deepEqual(contract.optionValues, {
    nameTitle: {},
    radio: {},
    checkbox: {},
    select: {},
    cascader: ['', '', ''],
    matrixChoice: [],
    ranking: {},
  })
  assert.ok(assertions.filter((assertion) => (
    assertion.status === 'failed'
    && assertion.name.endsWith('应为数组')
  )).length >= 11)
})

test('records a null linked field map without stopping dynamic key resolution', async () => {
  const fixture = createPublishedFormFixture()
  const linkedContract = {
    formId: FORM_ID,
    title: EXPECTED_FORM_TITLE,
    revisionNo: 1,
    fieldKeys: null,
  }
  const assertions = []
  let reachedEnd = false

  const contract = await runWithAssertionRecorder(
    'form-lpxavn-submit',
    (assertion) => assertions.push(assertion),
    () => {
      const result = assertPublishedFormContract(fixture, FORM_ID, linkedContract)
      reachedEnd = true
      return result
    },
  )

  assert.equal(reachedEnd, true)
  assert.equal(contract.fieldKeys.radio, FIELD_KEYS.radio)
  assert.ok(assertions.some((assertion) => (
    assertion.status === 'failed'
    && assertion.name.includes('前序发布脚本字段映射应为对象')
  )))
})

test('rejects a published-form contract when a configured boundary drifts', () => {
  const fixture = createPublishedFormFixture()
  const number = fixture.data.items.find((item) => item.item_key === FIELD_KEYS.number)
  number.rule_config.length.max = 101

  assert.throws(
    () => assertPublishedFormContract(fixture),
    /数字上边界应为 100/,
  )
})

test('rejects a published form that disables email format validation', () => {
  const fixture = createPublishedFormFixture()
  const email = fixture.data.items.find((item) => item.item_key === FIELD_KEYS.email)
  email.rule_config.regex_format.enabled = 2

  assert.throws(
    () => assertPublishedFormContract(fixture),
    /邮箱格式校验应开启/,
  )
})

test('indexes both entry arrays and object-shaped answers by item_key', () => {
  const first = { item_key: FIELD_KEYS.input, answer: '答案1' }
  const second = { item_key: FIELD_KEYS.input, answer: '答案2' }
  const index = indexSubmissionEntries({
    answers: [first, second],
    values: { [FIELD_KEYS.email]: 'indexed@example.com' },
  })

  assert.deepEqual(index.get(FIELD_KEYS.input), [first, second])
  assert.deepEqual(index.get(FIELD_KEYS.email), [{
    item_key: FIELD_KEYS.email,
    answer: 'indexed@example.com',
  }])
})

test('validates the complete structured submission payload by field key', () => {
  const data = createTestData(1787048650389)
  const payload = createSubmissionPayload(data)

  assert.deepEqual(assertSubmissionPayload(payload, data), {
    answerFieldCount: 27,
    indexedFieldCount: 29,
  })

  payload.answers = payload.answers.filter(({ item_key: itemKey }) => itemKey !== FIELD_KEYS.matrix)
  assert.throws(
    () => assertSubmissionPayload(payload, data),
    /提交 JSON 应包含“矩阵题”对应的 item_key/,
  )
})

test('combines the selected environment domain with the new form path', () => {
  assert.equal(
    buildFormUrl('https://lx.admin.lingxi.tech/'),
    'https://lx.lingxi.tech/form/?id=lpXAVN',
  )
  assert.equal(
    buildFormUrl('https://jxdr.b.lingxi-hk.localtest/base'),
    'https://jxdr.f.lingxi-hk.localtest/form/?id=lpXAVN',
  )
  assert.equal(
    buildFormUrl('https://public.example.test/somewhere'),
    'https://public.example.test/form/?id=lpXAVN',
  )
  assert.equal(
    buildFormUrl('https://lx.admin.lingxi.tech/', 'form/?id=configured'),
    'https://lx.lingxi.tech/form/?id=configured',
  )
  assert.equal(normalizeFormPath(' form/?id=configured '), '/form/?id=configured')
  assert.throws(() => buildFormUrl(
    'https://lx.admin.lingxi.tech/',
    'https://other.example.test/form',
  ), /必须是相对路径/)
  assert.throws(() => buildFormUrl(
    'https://lx.admin.lingxi.tech/',
    '/\\other.example.test/form',
  ), /不能包含反斜杠/)
})

test('creates unique answers for the main contact and nested field-group contact', () => {
  const data = createTestData(1787048650389)
  assert.match(data.mobile, /^139\d{8}$/)
  assert.match(data.groupMobile, /^138\d{8}$/)
  assert.notEqual(data.mobile, data.groupMobile)
  assert.notEqual(data.email, data.groupEmail)
  assert.equal(data.singleLine.length, 20)
  assert.equal(data.singleLineTooLong.length, 21)
  assert.equal(data.number, '100.00')
  assert.equal(data.numberTooLarge, '100.01')
  assert.deepEqual(data.cascader, ['华东区', '江苏省', '南京市'])
  assert.equal(data.radioIndex, 0)
  assert.deepEqual(data.checkboxIndexes, [0, 1, 2])
  assert.equal(data.nps, 10)
  assert.equal(data.matrix[2][2], '题目3-项目3答案')
})

test('checks the native email format boundary and restores a valid value before pagination', async () => {
  const browser = await launchGoogleChrome()
  try {
    const page = await browser.newPage()
    await page.setContent(`
      <label for="email">邮箱</label>
      <input id="email" type="email" value="valid@example.com">
      <button type="button">下一页</button>
    `)
    const assertions = []

    await runWithAssertionRecorder('form-lpxavn-submit', (assertion) => assertions.push(assertion), async () => {
      await assertEmailFormatBoundary(
        page.locator('#email'),
        'invalid-email',
        'valid@example.com',
      )
    })

    assert.equal(assertions.filter((assertion) => assertion.status === 'failed').length, 0)
    assert.equal(await page.locator('#email').inputValue(), 'valid@example.com')
    assert.equal(await page.locator('#email').evaluate((input) => input.validity.valid), true)
  } finally {
    await browser.close()
  }
})

test('records an unexpectedly accepted invalid email and continues checking page state', async () => {
  const browser = await launchGoogleChrome()
  try {
    const page = await browser.newPage()
    await page.route('https://public.example.test/**', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (request.method() === 'POST' && url.pathname.endsWith('/submission/validate-page')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, data: {} }),
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `
          <main>
            <section id="page-1">
              <div class="fb-runtime-field-card" data-item-key="username_test"><input></div>
              <div class="fb-runtime-field-card" data-item-key="email_test"><input value="invalid-email"></div>
              <div class="fb-runtime-pagination-buttons">
                <button class="fb-runtime-submit-button" type="button">下一页</button>
              </div>
            </section>
            <section id="page-2" hidden>
              <div class="fb-runtime-field-card" data-item-key="input_test"><input></div>
            </section>
          </main>
          <script>
            document.querySelector('.fb-runtime-submit-button').addEventListener('click', async () => {
              const response = await fetch('/f/form/test-form/submission/validate-page', { method: 'POST' })
              const body = await response.json()
              if (Number(body.code) === 0) {
                document.querySelector('#page-1').hidden = true
                document.querySelector('#page-2').hidden = false
              }
            })
          </script>
        `,
      })
    })
    await page.goto('https://public.example.test/form')
    const assertions = []

    await runWithAssertionRecorder(
      'form-lpxavn-submit',
      (assertion) => assertions.push(assertion),
      () => assertRuleValidationBlocked(page, 'https://public.example.test', {
        currentPage: 1,
        key: 'email_test',
        label: '邮箱',
        formId: 'test-form',
        pageFieldKeys: [
          ['username_test', 'email_test'],
          ['input_test'],
        ],
        logger: () => undefined,
      }),
    )

    assert.ok(assertions.some((assertion) => (
      assertion.status === 'failed'
      && assertion.name.includes('邮箱')
      && assertion.name.includes('businessCode: 0')
    )))
    assert.ok(assertions.some((assertion) => (
      assertion.status === 'failed'
      && assertion.name.includes('校验失败后应停留在第 1 页')
    )))
    await page.locator('#page-2').waitFor({ state: 'visible', timeout: 1_000 })
    assert.equal(await page.locator('[data-item-key="email_test"]:visible').count(), 0)
  } finally {
    await browser.close()
  }
})

test('excludes hidden and unflagged system fields from the linked form contract', () => {
  const contract = createFormLinkContract({
    formId: '202',
    formCode: 'linked-form',
    title: 'Linked form',
    revisionNo: 1,
    items: [
      { item_key: 'device', type_code: 'input' },
      { item_key: 'duration', type_code: 'number' },
      { item_key: 'input_business', type_code: 'input', hidden: 2 },
      { item_key: 'number_business', type_code: 'number', hidden: 2 },
    ],
  })

  assert.equal(contract.fieldKeys.input, 'input_business')
  assert.equal(contract.fieldKeys.number, 'number_business')
  assert.deepEqual(contract.items.map((item) => item.item_key), ['input_business', 'number_business'])
})

test('dismisses the traditional Chinese validation acknowledgement dialog', async () => {
  const browser = await launchGoogleChrome()
  try {
    const page = await browser.newPage()
    await page.setContent(`
      <div role="dialog" aria-label="请输入有效邮箱地址">
        <button type="button" onclick="this.closest('[role=dialog]').remove()">我已知曉</button>
      </div>
    `)

    await dismissPublicErrorDialog(page)

    assert.equal(await page.locator('[role="dialog"]').count(), 0)
  } finally {
    await browser.close()
  }
})

test('accepts an HTTP 200 final submission with an empty response body', async () => {
  const browser = await launchGoogleChrome()
  try {
    const page = await browser.newPage()
    await page.route('https://public.example.test/**', async (route) => {
      if (route.request().url().endsWith('/submission')) {
        await route.fulfill({ status: 200, body: '' })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<button id="submit">提交</button><script>submit.onclick=()=>fetch("/submission",{method:"POST"})</script>',
      })
    })
    await page.goto('https://public.example.test/form')

    const result = await waitForPublicMutation(
      page,
      'https://public.example.test',
      '/submission',
      () => page.locator('#submit').click(),
      '提交表单',
      { expectBusinessSuccess: false },
    )

    assert.equal(result.response.status(), 200)
    assert.deepEqual(result.body, {})
    assert.equal(result.httpSucceeded, true)
  } finally {
    await browser.close()
  }
})

test('records HTTP and business failures from a public mutation and continues', async () => {
  const browser = await launchGoogleChrome()
  try {
    const page = await browser.newPage()
    await page.route('https://public.example.test/**', async (route) => {
      if (route.request().url().endsWith('/submission')) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ code: 9001, message: 'temporary failure' }),
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<button id="submit">提交</button><script>submit.onclick=()=>fetch("/submission",{method:"POST"})</script>',
      })
    })
    await page.goto('https://public.example.test/form')
    const assertions = []
    let reachedEnd = false

    const result = await runWithAssertionRecorder(
      'form-lpxavn-submit',
      (assertion) => assertions.push(assertion),
      async () => {
        const mutation = await waitForPublicMutation(
          page,
          'https://public.example.test',
          '/submission',
          () => page.locator('#submit').click(),
          '提交表单',
        )
        reachedEnd = true
        return mutation
      },
    )

    assert.equal(reachedEnd, true)
    assert.equal(result.httpSucceeded, false)
    assert.equal(result.businessSucceeded, false)
    assert.equal(result.body.code, 9001)
    assert.ok(assertions.some((assertion) => (
      assertion.status === 'failed'
      && assertion.name.includes('成功 HTTP 状态')
    )))
    assert.ok(assertions.some((assertion) => (
      assertion.status === 'failed'
      && assertion.name.includes('业务码应为 0')
    )))
  } finally {
    await browser.close()
  }
})

test('selects the traditional Chinese address alias and returns the rendered value', async () => {
  const browser = await launchGoogleChrome()
  try {
    const page = await browser.newPage()
    await page.setContent(`
      <button id="province" role="combobox" aria-controls="province-list" aria-expanded="false">省份</button>
      <div id="province-list" role="listbox" hidden>
        <div role="option">廣東省</div>
      </div>
      <script>
        const trigger = document.querySelector('#province')
        const listbox = document.querySelector('#province-list')
        trigger.onclick = () => {
          trigger.setAttribute('aria-expanded', 'true')
          listbox.hidden = false
        }
        listbox.onclick = (event) => {
          const option = event.target.closest('[role="option"]')
          if (!option) return
          trigger.textContent = option.textContent.trim()
          trigger.setAttribute('aria-expanded', 'false')
          listbox.hidden = true
        }
      </script>
    `)

    const assertions = []
    const selected = await runWithAssertionRecorder(
      'form-lpxavn-submit',
      (assertion) => assertions.push(assertion),
      () => selectOption(
        page,
        page.locator('#province'),
        ['广东省', '廣東省'],
        '地址-省份',
      ),
    )

    assert.equal(selected, '廣東省')
    assert.equal(await page.locator('#province').innerText(), '廣東省')
    assert.ok(assertions.some((assertion) => (
      assertion.status === 'passed' && assertion.name.includes('成功选择“廣東省”')
    )))
  } finally {
    await browser.close()
  }
})

test('retries temporary page-validation gateway failures only', () => {
  for (const status of [405, 408, 425, 429, 500, 502, 503, 504]) {
    assert.equal(isRetryablePageValidationStatus(status), true)
  }
  for (const status of [200, 400, 401, 403, 404, 422]) {
    assert.equal(isRetryablePageValidationStatus(status), false)
  }
})

test('accepts visible result content when the result component host is hidden', async () => {
  const browser = await launchGoogleChrome()
  try {
    const page = await browser.newPage()
    await page.setContent(`
      <form-submission-result form-id="${FORM_ID}" submission-id="submission-123" hidden>
      </form-submission-result>
      <main><h1>Submitted successfully</h1></main>
    `)
    assert.equal(await page.locator(SUBMISSION_RESULT_SELECTOR).isVisible(), false)
    assert.equal(await assertVisibleSubmissionResult(page, { timeout: 1_000 }), 'submission-123')
  } finally {
    await browser.close()
  }
})

test('validates the result component against a configured form ID', async () => {
  const browser = await launchGoogleChrome()
  try {
    const page = await browser.newPage()
    await page.setContent(`
      <form-submission-result form-id="dynamic-form-id" submission-id="submission-456" hidden>
      </form-submission-result>
      <main><h1>Submitted successfully</h1></main>
    `)
    assert.equal(
      await assertVisibleSubmissionResult(page, 'dynamic-form-id', { timeout: 1_000 }),
      'submission-456',
    )
  } finally {
    await browser.close()
  }
})

test('records a missing result component and returns without a secondary locator timeout', async () => {
  const browser = await launchGoogleChrome()
  try {
    const page = await browser.newPage()
    await page.setContent('<main><h1>Submitted successfully</h1></main>')
    const assertions = []
    let reachedEnd = false

    const submissionId = await runWithAssertionRecorder(
      'form-lpxavn-submit',
      (assertion) => assertions.push(assertion),
      async () => {
        const result = await assertVisibleSubmissionResult(page, { timeout: 50 })
        reachedEnd = true
        return result
      },
    )

    assert.equal(reachedEnd, true)
    assert.equal(submissionId, null)
    assert.ok(assertions.some((assertion) => (
      assertion.status === 'failed' && assertion.name.includes('应挂载唯一')
    )))
    assert.ok(assertions.some((assertion) => (
      assertion.status === 'passed' && assertion.name.includes('结果页主标题')
    )))
  } finally {
    await browser.close()
  }
})
