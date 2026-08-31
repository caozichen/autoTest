import assert from 'node:assert/strict'
import test from 'node:test'

import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'
import { runWithAssertionRecorder } from '../../scripts/support/recorded-expect.mjs'
import { createFormLinkContract } from '../../scripts/support/form-link-contract.mjs'

import {
  EXPECTED_FORM_TITLE,
  FIELD_KEYS,
  FORM_CODE,
  FORM_PATH,
  PAGE_CARD_COUNTS,
  PAGE_FIELD_KEYS,
  PAGE_FIELD_LABELS,
  PUBLISHED_FIELD_TYPES,
  REQUIRED_ROOT_FIELD_KEYS,
  SUBMISSION_RESULT_SELECTOR,
  assertEmailFormatBoundary,
  assertPublishedFormContract,
  assertRuleValidationBlocked,
  assertSubmissionPayload,
  assertVisibleSubmissionResult,
  buildFormUrl,
  createTestData,
  dismissPublicErrorDialog,
  indexSubmissionEntries,
  isRetryablePageValidationStatus,
  normalizeFormPath,
  selectOption,
  waitForPublicMutation,
} from '../../scripts/form-lpxavn-submit.ui.spec.mjs'

const NAME_TITLES = ['Mr.（先生）', 'Ms.（女士）', 'Mrs.（太太）', 'Dr.（医生/博士）']

function option(name, value) {
  return { name, value }
}

function createPublishedFormFixture() {
  const requiredKeys = new Set(REQUIRED_ROOT_FIELD_KEYS)
  const items = Object.entries(PUBLISHED_FIELD_TYPES).map(([itemKey, typeCode]) => ({
    item_key: itemKey,
    type_code: typeCode,
    group_code: '',
    hidden: 2,
    label: itemKey,
    description: '',
    rule_config: { required: { enabled: requiredKeys.has(itemKey) ? 1 : 2 } },
    common_config: {},
  }))
  const byKey = new Map(items.map((item) => [item.item_key, item]))
  const field = (key) => byKey.get(key)

  Object.assign(field(FIELD_KEYS.username).common_config, {
    name_title: {
      enabled: 1,
      choices: NAME_TITLES.map((title, index) => ({ code: `title_${index + 1}`, title })),
    },
  })
  field(FIELD_KEYS.email).rule_config.regex_format = { enabled: 1 }
  const documentTypes = Array.from({ length: 10 }, (_, index) => ({
    code: `document_${index + 1}`,
    title: `证件${index + 1}`,
  }))
  Object.assign(field(FIELD_KEYS.idCard).common_config, {
    collect_mode: {
      custom_enabled: 1,
      choices: documentTypes,
      selected: documentTypes.map(({ code }) => code),
    },
  })
  field(FIELD_KEYS.input).rule_config.length = { enabled: 1, min: 0, max: 20 }

  Object.assign(field(FIELD_KEYS.radio), {
    common_config: { allow_image: 1, allow_customized_text: { enabled: 1 } },
    option: {
      choices: [
        { ...option('选项1', 'option_1'), image_id: 'image-1', image_url: 'https://files.example.test/1.png' },
        { ...option('选项2', 'option_2'), image_id: 'image-2', image_url: 'https://files.example.test/2.png' },
        option('其他', 'option_other'),
      ],
    },
  })
  Object.assign(field(FIELD_KEYS.checkbox), {
    rule_config: {
      required: { enabled: 1 },
      length: { enabled: 1, min: 2, max: 3 },
    },
    option: { choices: [option('选项1', 'option_1'), option('选项2', 'option_2'), option('选项3', 'option_3')] },
  })
  field(FIELD_KEYS.select).option = {
    choices: [option('选项1', 'option_1'), option('选项2', 'option_2')],
  }
  Object.assign(field(FIELD_KEYS.number), {
    rule_config: {
      required: { enabled: 1 },
      length: { enabled: 1, min: 0, max: 100 },
    },
    common_config: { decimals: 2 },
  })
  field(FIELD_KEYS.date).rule_config.date_range = {
    enabled: 1,
    start: '2026-08-18',
    end: '2026-09-17',
  }
  field(FIELD_KEYS.imageUpload).common_config = {
    max_size: 20,
    max_file_quantity: 1,
    media_type: [{
      type: 'image',
      extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'psd', 'tif', 'heic', 'heif'],
    }],
  }
  field(FIELD_KEYS.fileUpload).common_config = {
    max_size: 20,
    max_file_quantity: 1,
    media_type: [{ type: 'unlimited', extensions: [] }],
  }
  Object.assign(field(FIELD_KEYS.cascader), {
    common_config: { levels: 3, type_mode: 'multiple' },
    option: {
      choices: [{
        ...option('华东区', 'east'),
        sub_choices: [{
          ...option('江苏省', 'jiangsu'),
          sub_choices: [option('南京市', 'nanjing')],
        }],
      }],
    },
  })
  field(FIELD_KEYS.fieldGroup).common_config = {
    allow_add_item: { enabled: 1, min: 1, max: 5 },
  }
  for (const [key, anchor, required] of [
    [FIELD_KEYS.groupUsername, 'username', 1],
    [FIELD_KEYS.groupMobile, 'mobile', 1],
    [FIELD_KEYS.groupEmail, 'email', 2],
  ]) {
    Object.assign(field(key), {
      group_code: FIELD_KEYS.fieldGroup,
      rule_config: { required: { enabled: required } },
      common_config: { collect_to_contact: { enabled: 1, anchor } },
    })
  }
  Object.assign(field(FIELD_KEYS.description), {
    label: '报名与联系人说明',
    description: '<p>请确认联系人信息准确无误，提交后将用于活动报名及相关通知。</p>',
  })
  field(FIELD_KEYS.divider).label = '补充信息'
  field(FIELD_KEYS.matrix).option = {
    statements: ['题目1', '题目2', '题目3'].map((label, index) => ({ label, item_key: `row_${index + 1}` })),
    dimensions: ['项目1', '项目2', '项目3'].map((name, index) => ({ name, value: `col_${index + 1}` })),
  }
  field(FIELD_KEYS.matrixChoice).option = {
    choice_style: 'single',
    statements: Array.from({ length: 3 }, (_, index) => ({ label: `题目${index + 1}`, item_key: `row_${index + 1}` })),
    choices: Array.from({ length: 3 }, (_, index) => option(`选项${index + 1}`, `col_${index + 1}`)),
  }
  field(FIELD_KEYS.ranking).option = {
    choices: Array.from({ length: 3 }, (_, index) => option(`选项${index + 1}`, `option_${index + 1}`)),
  }
  field(FIELD_KEYS.rating).common_config.rating_max = 5
  field(FIELD_KEYS.nps).common_config.rating_max = 10

  return {
    code: 0,
    data: {
      revision_no: 1,
      form: {
        form_code: FORM_CODE,
        status: 'published',
        title: EXPECTED_FORM_TITLE,
        subtitle: '本表单用于活动报名与信息登记，请按实际情况完整填写。',
        description: '<p><strong>填写须知</strong></p><ul><li>请确保姓名、证件及联系方式真实有效。</li><li>提交前请仔细核对，带星号项目为必填。</li></ul>',
        submitted_config: { contact_collect_mode: { enabled: 1, selected: 'ignore' } },
        theme_config: {
          header_image: { image: { id: 'header-image', url: 'https://files.example.test/header.png' } },
          submit_button: { background_color: '#123456' },
          form_container: { background_color: '#abcdef' },
          wallpaper: { background_color: { color: '#fedcba' } },
        },
      },
      items: [
        { type_code: 'page', item_key: 'page_1', group_code: '', hidden: 2 },
        { type_code: 'page', item_key: 'page_2', group_code: '', hidden: 2 },
        { type_code: 'page', item_key: 'page_3', group_code: '', hidden: 2 },
        ...items,
      ],
    },
  }
}

function createSubmissionPayload(data) {
  const entry = (itemKey, answer) => ({ item_key: itemKey, answer })
  return {
    form_code: FORM_CODE,
    revision_no: 1,
    answers: [
      entry(FIELD_KEYS.username, { name_title: data.nameTitle, value: data.username }),
      entry(FIELD_KEYS.mobile, { area_code: '+86', value: data.mobile }),
      entry(FIELD_KEYS.email, data.email),
      entry(FIELD_KEYS.idCard, { document_type: 'id_card', value: data.idCard }),
      entry(FIELD_KEYS.landlinePhone, data.landlinePhone),
      entry(FIELD_KEYS.address, {
        province: data.province,
        city: data.city,
        district: data.district,
        street: data.street,
      }),
      entry(FIELD_KEYS.birthday, '1990-08-18'),
      entry(FIELD_KEYS.input, data.singleLine),
      entry(FIELD_KEYS.textarea, data.multiLine),
      entry(FIELD_KEYS.radio, { name: data.radio, value: 'option_1' }),
      entry(FIELD_KEYS.checkbox, data.checkbox.map((name, index) => ({
        name,
        value: `option_${index + 1}`,
      }))),
      entry(FIELD_KEYS.select, { name: data.select, value: 'option_2' }),
      entry(FIELD_KEYS.number, Number(data.number)),
      entry(FIELD_KEYS.date, { value: '2026-08-21' }),
      entry(FIELD_KEYS.time, { value: '12:34:56' }),
      entry(FIELD_KEYS.imageUpload, { upload_id: 'image-upload-id' }),
      entry(FIELD_KEYS.fileUpload, { upload_id: 'file-upload-id' }),
      entry(FIELD_KEYS.cascader, [{ name: '南京市', value: 'u6oPXf' }]),
      entry(FIELD_KEYS.signature, { upload_id: 'signature-upload-id' }),
      entry(FIELD_KEYS.groupUsername, data.groupUsername),
      entry(FIELD_KEYS.groupMobile, { area_code: '+86', value: data.groupMobile }),
      entry(FIELD_KEYS.groupEmail, data.groupEmail),
      entry(FIELD_KEYS.matrix, data.matrix),
      entry(FIELD_KEYS.matrixChoice, ['col_1', 'col_2', 'col_3']),
      entry(FIELD_KEYS.ranking, data.ranking.map((name) => ({
        name,
        value: `option_${name.at(-1)}`,
      }))),
      entry(FIELD_KEYS.rating, data.rating),
      entry(FIELD_KEYS.nps, data.nps),
      entry(FIELD_KEYS.description, { value: [], _customized: '' }),
      entry(FIELD_KEYS.divider, { value: [], _customized: '' }),
    ],
  }
}

function remapFixtureKeys(fixture) {
  const keyMap = new Map(fixture.data.items.map((item, index) => [
    item.item_key,
    `linked_${String(index + 1).padStart(2, '0')}`,
  ]))
  for (const item of fixture.data.items) {
    item.item_key = keyMap.get(item.item_key)
    if (item.group_code) item.group_code = keyMap.get(item.group_code) || item.group_code
  }
  return keyMap
}

test('targets the new lpXAVN form without sharing the previous form configuration', () => {
  assert.equal(FORM_CODE, 'lpXAVN')
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

test('validates the published-form contract against a configured form code', () => {
  const fixture = createPublishedFormFixture()
  fixture.data.form.form_code = 'dynamic-form-code'

  assert.equal(
    assertPublishedFormContract(fixture, 'dynamic-form-code').revisionNo,
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
  fixture.data.form.form_code = 'linked-form-code'
  const linkedContract = {
    formCode: 'linked-form-code',
    title: EXPECTED_FORM_TITLE,
    revisionNo: 1,
    fieldKeys: Object.fromEntries(Object.entries(FIELD_KEYS).map(([name, key]) => [name, keyMap.get(key)])),
  }

  const contract = assertPublishedFormContract(fixture, 'linked-form-code', linkedContract)

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

test('hard-stops when page validation unexpectedly accepts an invalid email', async () => {
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

    await assert.rejects(
      () => runWithAssertionRecorder(
        'form-lpxavn-submit',
        (assertion) => assertions.push(assertion),
        () => assertRuleValidationBlocked(page, 'https://public.example.test', {
          currentPage: 1,
          key: 'email_test',
          label: '邮箱',
          formCode: 'test-form',
          pageFieldKeys: [
            ['username_test', 'email_test'],
            ['input_test'],
          ],
          logger: () => undefined,
        }),
      ),
      /validate-page 实际返回 businessCode: 0/,
    )

    assert.ok(assertions.some((assertion) => (
      assertion.status === 'failed'
      && assertion.name.includes('邮箱')
      && assertion.name.includes('businessCode: 0')
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
    assert.equal(result.body, null)
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
      <form-submission-result form-code="${FORM_CODE}" submission-id="submission-123" hidden>
      </form-submission-result>
      <main><h1>Submitted successfully</h1></main>
    `)
    assert.equal(await page.locator(SUBMISSION_RESULT_SELECTOR).isVisible(), false)
    assert.equal(await assertVisibleSubmissionResult(page, { timeout: 1_000 }), 'submission-123')
  } finally {
    await browser.close()
  }
})

test('validates the result component against a configured form code', async () => {
  const browser = await launchGoogleChrome()
  try {
    const page = await browser.newPage()
    await page.setContent(`
      <form-submission-result form-code="dynamic-form-code" submission-id="submission-456" hidden>
      </form-submission-result>
      <main><h1>Submitted successfully</h1></main>
    `)
    assert.equal(
      await assertVisibleSubmissionResult(page, 'dynamic-form-code', { timeout: 1_000 }),
      'submission-456',
    )
  } finally {
    await browser.close()
  }
})
