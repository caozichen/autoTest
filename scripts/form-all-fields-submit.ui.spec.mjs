import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium, expect } from '@playwright/test'

import {
  closePlaywrightHandles,
  closePlaywrightOnAbort,
  throwIfRunAborted,
} from './playwright-run-control.mjs'

const FORM_CODE = 'qBM33p'
const FORM_URL = `https://lx.lingxi.tech/form/?id=${FORM_CODE}`
const EXPECTED_FORM_TITLE = '自动化测试全题型表单-1786608677952'
const PUBLIC_ORIGIN = new URL(FORM_URL).origin
const NAVIGATION_TIMEOUT_MS = 45_000
const ACTION_TIMEOUT_MS = 30_000
const SELECT_MAX_ATTEMPTS = 3
const SELECT_VISIBILITY_TIMEOUT_MS = 3_000
const SELECT_COMMIT_TIMEOUT_MS = 1_500
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = resolve(SCRIPT_DIR, '..', 'outputs', 'form-all-fields-submit')
const FIXTURE_DIR = resolve(OUTPUT_DIR, 'fixtures')

const FIELD_KEYS = Object.freeze({
  username: 'username_vlcfzr',
  mobile: 'mobile_urlvjj',
  email: 'email_uvbsvs',
  idCard: 'idCard_hgqrwh',
  landlinePhone: 'landlinePhone_ovojzs',
  address: 'address_jybels',
  birthday: 'birthday_oeulck',
  input: 'input_awoxyp',
  textarea: 'textarea_nimmol',
  radio: 'radio_uahadt',
  checkbox: 'checkbox_yngcfg',
  select: 'select_kkpdld',
  number: 'number_robflc',
  date: 'date_bsbvrr',
  time: 'time_rkzndj',
  imageUpload: 'imageUpload_ncjbmi',
  fileUpload: 'fileUpload_ddrapx',
  cascader: 'cascader_svjvcs',
  signature: 'signature_puuads',
  fieldGroup: 'fieldGroup_hjeiwg',
  matrix: 'matrix_cnekvn',
  matrixChoice: 'matrixChoice_btkgbs',
  ranking: 'ranking_brtpne',
  rating: 'rating_mtiocx',
  nps: 'nps_xntiat',
})

const PAGE_FIELD_LABELS = Object.freeze([
  ['姓名', '手机号', '邮箱', '身份证件', '固定电话', '地址', '生日'],
  ['单行文本', '多行文本', '单项选择', '多项选择', '下拉选择', '数字', '日期', '时间', '图片上传', '文件上传'],
  ['级联选择', '手写签名', '题组', '矩阵题', '矩阵选择', '排序题', '评分题', 'NPS'],
])

function createTestData(now = Date.now()) {
  const suffix = String(now).slice(-8).padStart(8, '0')
  return {
    runId: String(now),
    username: `自动化测试用户${String(now).slice(-4)}`,
    mobile: `139${suffix}`,
    email: `autotest_${now}@example.com`,
    idCard: '11010519491231002X',
    landlinePhone: '0755-12345678',
    province: '广东省',
    city: '深圳市',
    district: '南山区',
    street: `自动化测试地址${String(now).slice(-6)}号`,
    birthday: { year: '1990', month: '8', day: '18' },
    singleLine: `单行文本自动化答案-${now}`,
    multiLine: `多行文本自动化答案\n运行时间戳：${now}`,
    radio: '选项1',
    checkbox: ['选项1', '选项2'],
    select: '选项2',
    number: '2026.08',
    cascader: ['地区', '香港'],
    matrix: Array.from({ length: 3 }, (_, row) =>
      Array.from({ length: 3 }, (_, column) => `题目${row + 1}-项目${column + 1}答案`),
    ),
    matrixChoiceIndexes: [0, 4, 8],
    ranking: ['选项2', '选项1', '选项3'],
    rating: 5,
    nps: 9,
  }
}

function fieldCard(page, key) {
  return page.locator([
    `.fb-runtime-field-card[data-item-key="${key}"]`,
    `.fb-runtime-structural-field-card[data-item-key="${key}"]`,
  ].join(', '))
}

async function assertField(page, key, label) {
  const card = fieldCard(page, key)
  await expect(card, `当前页应唯一显示“${label}”题目`).toHaveCount(1)
  await expect(card, `“${label}”题目应可见`).toBeVisible()
  await expect(card, `题目标题应与“${label}”匹配`).toContainText(label)
  return card
}

async function assertCurrentPage(page, pageNumber, expectedLabels, logger) {
  await expect(page.getByText(`第 ${pageNumber} 页/共 3 页`, { exact: true }), `应显示第 ${pageNumber} 页`).toBeVisible()
  const visibleCards = page.locator([
    '.fb-runtime-field-card:visible',
    '.fb-runtime-structural-field-card[data-item-key]:visible',
  ].join(', '))
  await expect(visibleCards, `第 ${pageNumber} 页题目数应正确`).toHaveCount(expectedLabels.length)
  const visibleText = await visibleCards.allTextContents()
  for (const label of expectedLabels) {
    expect(visibleText.some((text) => text.includes(label)), `第 ${pageNumber} 页应包含“${label}”`).toBeTruthy()
  }
  logger('success', `第 ${pageNumber} 页结构断言通过`, { questionCount: expectedLabels.length, labels: expectedLabels })
}

async function fillAndAssert(input, value, label) {
  await input.fill(value)
  await expect(input, `“${label}”填写值应回显`).toHaveValue(value)
}

async function selectOption(page, trigger, optionName, label, logger = () => undefined) {
  let lastError

  for (let attempt = 1; attempt <= SELECT_MAX_ATTEMPTS; attempt += 1) {
    let listbox
    try {
      await trigger.evaluate((element) => {
        element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
      })
      await trigger.click()

      const listboxId = await trigger.getAttribute('aria-controls')
      expect(listboxId, `“${label}”下拉框应关联选项列表`).toBeTruthy()
      listbox = page.locator(`[role="listbox"][id=${JSON.stringify(listboxId)}]`)
      await expect(listbox, `“${label}”选项列表应打开`).toBeVisible()

      const option = listbox.getByRole('option', { name: optionName, exact: true })
      await expect(option, `“${label}”应唯一提供“${optionName}”选项`).toHaveCount(1)
      await option.scrollIntoViewIfNeeded()
      await option.evaluate((element) => {
        element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
      })
      await expect(option, `“${label}”的“${optionName}”选项应完整进入视口`).toBeInViewport({
        ratio: 1,
        timeout: SELECT_VISIBILITY_TIMEOUT_MS,
      })
      await option.focus()
      await expect(option, `“${label}”的“${optionName}”选项应获得键盘焦点`).toBeFocused()
      await page.keyboard.press('Enter')

      await expect(listbox, `选择“${optionName}”后选项列表应关闭`).toBeHidden({
        timeout: SELECT_COMMIT_TIMEOUT_MS,
      })
      await expect(trigger, `“${label}”应精确回显“${optionName}”`).toHaveText(optionName, {
        timeout: SELECT_COMMIT_TIMEOUT_MS,
      })
      return
    } catch (error) {
      lastError = error
      const actualText = await trigger.innerText().catch(() => '')
      await trigger.press('Escape').catch(() => undefined)
      if (listbox) {
        await expect(listbox).toBeHidden({ timeout: 500 }).catch(() => undefined)
      }

      if (attempt < SELECT_MAX_ATTEMPTS) {
        logger('warning', `“${label}”第 ${attempt} 次选择未生效，准备重新选择“${optionName}”`, {
          attempt,
          expected: optionName,
          actual: actualText.trim(),
        })
      }
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError)
  throw new Error(`“${label}”连续 ${SELECT_MAX_ATTEMPTS} 次未能选择“${optionName}”：${detail}`, {
    cause: lastError,
  })
}

async function waitForPublicMutation(page, pathSuffix, action, label) {
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.origin === PUBLIC_ORIGIN
      && url.pathname.endsWith(pathSuffix)
      && response.request().method() === 'POST'
  }, { timeout: ACTION_TIMEOUT_MS })
  await action()
  const response = await responsePromise
  expect(response.ok(), `${label} HTTP 状态应成功，实际 ${response.status()}`).toBeTruthy()
  const body = await response.json().catch(() => null)
  if (body && Object.prototype.hasOwnProperty.call(body, 'code')) {
    expect(body.code, `${label}业务码应为 0`).toBe(0)
  }
  return { response, body }
}

async function goToNextPage(page, currentPage, logger) {
  logger('info', `第 ${currentPage} 页填写完成，点击“下一页”并等待服务端分页校验`)
  await waitForPublicMutation(
    page,
    `/f/form/${FORM_CODE}/submission/validate-page`,
    () => page.getByRole('button', { name: '下一页', exact: true }).click(),
    `第 ${currentPage} 页校验`,
  )
  await expect(page.getByText(`第 ${currentPage + 1} 页/共 3 页`, { exact: true }), '分页后页码应更新').toBeVisible()
  logger('success', `第 ${currentPage} 页服务端校验通过，已进入第 ${currentPage + 1} 页`)
}

async function createUploadFixtures(runId) {
  await mkdir(FIXTURE_DIR, { recursive: true })
  const imagePath = resolve(FIXTURE_DIR, `form-answer-${runId}.png`)
  const filePath = resolve(FIXTURE_DIR, `form-answer-${runId}.txt`)
  const onePixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  )
  await writeFile(imagePath, onePixelPng)
  await writeFile(filePath, `自动化测试表单附件\n运行时间戳：${runId}\n`, 'utf8')
  return { imagePath, filePath }
}

async function uploadAndAssert(card, filePath, label) {
  const input = card.locator('input[type="file"]')
  await expect(input, `“${label}”应包含文件选择控件`).toHaveCount(1)
  await input.setInputFiles(filePath)
  const fileName = filePath.split(/[\\/]/).pop()
  const uploadStatus = card.locator('.fb-runtime-upload-status')
  await expect(uploadStatus, `“${label}”上传完成后数量应为 1`).toContainText('已上传 1/', {
    timeout: ACTION_TIMEOUT_MS,
  })

  if (label === '图片上传') {
    const previewImage = card.locator('.fb-runtime-upload-image-preview img')
    await expect(previewImage, '图片上传完成后应显示一个缩略图').toHaveCount(1)
    await expect(previewImage, '图片上传缩略图应可见').toBeVisible()
    await expect(previewImage, '图片上传结果应保留原文件名').toHaveAttribute('alt', fileName)
    await expect(previewImage, '图片上传结果应包含可访问地址').toHaveAttribute('src', /\S+/)
    return
  }

  await expect(card, `“${label}”上传完成后应回显文件名`).toContainText(fileName, {
    timeout: ACTION_TIMEOUT_MS,
  })
}

async function drawSignature(page, card, logger) {
  await card.locator('.fb-signature-empty-trigger').click()
  const dialog = page.getByRole('dialog').filter({ hasText: '请在下方区域手写签名' })
  await expect(dialog, '点击签名题后应打开手写签名弹窗').toBeVisible()
  const canvas = dialog.locator('canvas')
  await expect(canvas, '签名弹窗应包含画布').toBeVisible()
  const box = await canvas.boundingBox()
  expect(box, '签名画布应有可绘制尺寸').toBeTruthy()
  const points = [
    [0.18, 0.62], [0.28, 0.35], [0.38, 0.68], [0.50, 0.28], [0.62, 0.64], [0.76, 0.42], [0.84, 0.58],
  ]
  await page.mouse.move(box.x + box.width * points[0][0], box.y + box.height * points[0][1])
  await page.mouse.down()
  for (const [x, y] of points.slice(1)) {
    await page.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 4 })
  }
  await page.mouse.up()
  await dialog.getByRole('button', { name: '确定', exact: true }).click()
  await expect(dialog, '确认并上传签名后弹窗应关闭').toBeHidden({ timeout: ACTION_TIMEOUT_MS })
  await expect(card.locator('.fb-signature-filled-surface'), '签名题应回显签名结果').toBeVisible()
  logger('success', '手写签名已通过画布完成并上传')
}

async function screenshotFailure(page, runId) {
  await mkdir(OUTPUT_DIR, { recursive: true })
  const screenshotPath = resolve(OUTPUT_DIR, `填写失败-${runId}.png`)
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined)
  return screenshotPath
}

export async function run({
  extraHTTPHeaders,
  ignoreHTTPSErrors = false,
  signal,
  logger,
}) {
  const authorization = extraHTTPHeaders?.Authorization
  expect(authorization, '平台运行上下文应包含环境登录 Token').toBeTruthy()

  const data = createTestData()
  let browser
  let context
  let page
  let stopAbortClose = () => undefined
  try {
    throwIfRunAborted(signal)
    const fixtures = await createUploadFixtures(data.runId)
    throwIfRunAborted(signal)
    logger('info', '启动 Google Chrome 无头浏览器，后台模拟用户填写公开表单', {
      browser: 'Google Chrome',
      headless: true,
      formCode: FORM_CODE,
      formUrl: FORM_URL,
    })
    logger('info', '公开填写页无需登录；环境 Token 仅用于平台鉴权，不会注入或发送到公开表单域名')

    browser = await chromium.launch({ channel: 'chrome', headless: true })
    stopAbortClose = closePlaywrightOnAbort(signal, () => ({ browser, context }), { logger })
    throwIfRunAborted(signal)
    context = await browser.newContext({
      ignoreHTTPSErrors,
      viewport: { width: 1440, height: 1000 },
      locale: 'zh-CN',
    })
    throwIfRunAborted(signal)
    page = await context.newPage()
    page.setDefaultTimeout(ACTION_TIMEOUT_MS)
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS)

    let publicRequestCount = 0
    const authorizationLeaks = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.origin !== PUBLIC_ORIGIN) return
      publicRequestCount += 1
      if (request.headers().authorization) {
        authorizationLeaks.push(`${request.method()} ${url.origin}${url.pathname}`)
      }
    })

    await page.goto(FORM_URL, { waitUntil: 'domcontentloaded' })
    await expect(page, '公开表单地址应保持为目标 form code').toHaveURL(new RegExp(`[?&]id=${FORM_CODE}(?:&|$)`))
    await expect(page, '页面标题应与目标表单名称完全匹配').toHaveTitle(EXPECTED_FORM_TITLE)
    await expect(page.getByText(EXPECTED_FORM_TITLE, { exact: true }), '页面中应显示目标表单名称').toBeVisible()
    logger('success', '目标公开表单加载成功', { title: EXPECTED_FORM_TITLE, formCode: FORM_CODE })

    await assertCurrentPage(page, 1, PAGE_FIELD_LABELS[0], logger)
    const username = await assertField(page, FIELD_KEYS.username, '姓名')
    await fillAndAssert(username.getByPlaceholder('请输入姓名'), data.username, '姓名')
    const mobile = await assertField(page, FIELD_KEYS.mobile, '手机号')
    await expect(mobile.getByRole('combobox'), '手机号区号应为中国大陆 +86').toContainText('+86')
    await fillAndAssert(mobile.getByPlaceholder('请输入手机号'), data.mobile, '手机号')
    const email = await assertField(page, FIELD_KEYS.email, '邮箱')
    await fillAndAssert(email.getByPlaceholder('请输入邮箱'), data.email, '邮箱')
    const idCard = await assertField(page, FIELD_KEYS.idCard, '身份证件')
    await expect(idCard.getByRole('combobox'), '证件类型应为身份证').toContainText('身份证')
    await fillAndAssert(idCard.getByPlaceholder('请输入证件号码'), data.idCard, '身份证件')
    const landline = await assertField(page, FIELD_KEYS.landlinePhone, '固定电话')
    await fillAndAssert(landline.getByPlaceholder('请输入固定电话'), data.landlinePhone, '固定电话')

    const address = await assertField(page, FIELD_KEYS.address, '地址')
    const addressSelects = address.getByRole('combobox')
    await selectOption(page, addressSelects.nth(0), data.province, '地址-省份', logger)
    await selectOption(page, addressSelects.nth(1), data.city, '地址-城市', logger)
    await selectOption(page, addressSelects.nth(2), data.district, '地址-区县', logger)
    await fillAndAssert(address.getByPlaceholder('请输入地址'), data.street, '详细地址')

    const birthday = await assertField(page, FIELD_KEYS.birthday, '生日')
    const birthdaySelects = birthday.getByRole('combobox')
    await selectOption(page, birthdaySelects.nth(0), data.birthday.year, '生日-年份', logger)
    await selectOption(page, birthdaySelects.nth(1), data.birthday.month, '生日-月份', logger)
    await selectOption(page, birthdaySelects.nth(2), data.birthday.day, '生日-日期', logger)
    logger('success', '第 1 页联系人题目全部填写并逐项断言通过', {
      username: data.username,
      mobile: data.mobile,
      email: data.email,
      address: `${data.province}/${data.city}/${data.district}/${data.street}`,
      birthday: `${data.birthday.year}-${data.birthday.month}-${data.birthday.day}`,
    })
    await goToNextPage(page, 1, logger)

    await assertCurrentPage(page, 2, PAGE_FIELD_LABELS[1], logger)
    const input = await assertField(page, FIELD_KEYS.input, '单行文本')
    await fillAndAssert(input.getByPlaceholder('请输入单行文本'), data.singleLine, '单行文本')
    const textarea = await assertField(page, FIELD_KEYS.textarea, '多行文本')
    await fillAndAssert(textarea.getByPlaceholder('请输入多行文本'), data.multiLine, '多行文本')

    const radio = await assertField(page, FIELD_KEYS.radio, '单项选择')
    const radioChoice = radio.getByRole('radio', { name: data.radio, exact: true })
    await radioChoice.click()
    await expect(radioChoice, '单项选择应选中“选项1”').toBeChecked()
    const checkbox = await assertField(page, FIELD_KEYS.checkbox, '多项选择')
    for (const choice of data.checkbox) {
      const control = checkbox.getByRole('checkbox', { name: choice, exact: true })
      await control.click()
      await expect(control, `多项选择应选中“${choice}”`).toBeChecked()
    }
    const select = await assertField(page, FIELD_KEYS.select, '下拉选择')
    await selectOption(page, select.getByRole('combobox'), data.select, '下拉选择', logger)
    const number = await assertField(page, FIELD_KEYS.number, '数字')
    await fillAndAssert(number.getByPlaceholder('请输入数字'), data.number, '数字')

    const date = await assertField(page, FIELD_KEYS.date, '日期')
    const dateTrigger = date.locator('button').first()
    await dateTrigger.click()
    const dateOverlay = page.locator('[data-fb-date-overlay]')
    await expect(dateOverlay, '日期题应打开日期面板').toBeVisible()
    await dateOverlay.locator('button.fb-ring-1:not([disabled])').click()
    await expect(dateTrigger, '日期题选择今天后不应再显示占位文字').not.toContainText('请选择日期')

    const time = await assertField(page, FIELD_KEYS.time, '时间')
    const timeTrigger = time.locator('button').first()
    await timeTrigger.click()
    const timePanel = page.locator('[data-fb-renderer-portal]')
    await expect(timePanel, '时间题应打开时间面板').toBeVisible()
    await timePanel.getByRole('button', { name: '此刻', exact: true }).click()
    await timePanel.getByRole('button', { name: '确定', exact: true }).click()
    await expect(timeTrigger, '时间题选择此刻后不应再显示占位文字').not.toContainText('请选择时间')

    const imageUpload = await assertField(page, FIELD_KEYS.imageUpload, '图片上传')
    await uploadAndAssert(imageUpload, fixtures.imagePath, '图片上传')
    const fileUpload = await assertField(page, FIELD_KEYS.fileUpload, '文件上传')
    await uploadAndAssert(fileUpload, fixtures.filePath, '文件上传')
    logger('success', '第 2 页通用题目全部填写并逐项断言通过', {
      radio: data.radio,
      checkbox: data.checkbox,
      select: data.select,
      number: data.number,
      imageFixture: fixtures.imagePath,
      fileFixture: fixtures.filePath,
    })
    await goToNextPage(page, 2, logger)

    await assertCurrentPage(page, 3, PAGE_FIELD_LABELS[2], logger)
    const cascader = await assertField(page, FIELD_KEYS.cascader, '级联选择')
    const cascaderTrigger = cascader.locator('.fb-runtime-cascader-trigger')
    await cascaderTrigger.click()
    await page.getByRole('button', { name: data.cascader[0], exact: true }).click()
    await page.getByRole('button', { name: data.cascader[1], exact: true }).click()
    await expect(cascaderTrigger, '级联选择应回显“地区 / 香港”').toContainText(/地区.*香港/)

    const signature = await assertField(page, FIELD_KEYS.signature, '手写签名')
    await drawSignature(page, signature, logger)
    const fieldGroup = await assertField(page, FIELD_KEYS.fieldGroup, '题组')
    await expect(fieldGroup, '空题组不应要求填写不存在的子题').not.toContainText('请填写')

    const matrix = await assertField(page, FIELD_KEYS.matrix, '矩阵题')
    const matrixInputs = matrix.locator('tbody input[type="text"]')
    await expect(matrixInputs, '矩阵题应有 3×3 共 9 个输入格').toHaveCount(9)
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        const value = data.matrix[row][column]
        const cell = matrixInputs.nth(row * 3 + column)
        await cell.fill(value)
        await expect(cell, `矩阵题“题目${row + 1}/项目${column + 1}”应回显匹配答案`).toHaveValue(value)
      }
    }

    const matrixChoice = await assertField(page, FIELD_KEYS.matrixChoice, '矩阵选择')
    const matrixRadios = matrixChoice.getByRole('radio')
    await expect(matrixRadios, '矩阵选择应有 3×3 共 9 个选项').toHaveCount(9)
    for (const index of data.matrixChoiceIndexes) {
      await matrixRadios.nth(index).click()
      await expect(matrixRadios.nth(index), `矩阵选择第 ${Math.floor(index / 3) + 1} 行应选中目标列`).toBeChecked()
    }

    const ranking = await assertField(page, FIELD_KEYS.ranking, '排序题')
    for (const option of data.ranking) {
      await ranking.locator('.fb-runtime-ranking-item').filter({ hasText: option }).click()
    }
    const rankedLabels = await ranking.locator('.fb-runtime-ranking-ranked-list .fb-runtime-ranking-label').allTextContents()
    expect(rankedLabels.map((value) => value.trim()), '排序题顺序应与测试数据完全匹配').toEqual(data.ranking)

    const rating = await assertField(page, FIELD_KEYS.rating, '评分题')
    const ratingButtons = rating.locator('button.rating-item')
    await expect(ratingButtons, '评分题应显示 5 个评分按钮').toHaveCount(5)
    await ratingButtons.nth(data.rating - 1).click()
    await expect(ratingButtons.nth(data.rating - 1).locator('.rating-icon--accent'), '评分题应选择 5 分').toBeVisible()
    const nps = await assertField(page, FIELD_KEYS.nps, 'NPS')
    const npsButton = nps.locator('button.nps-scale__score-btn').filter({ hasText: new RegExp(`^${data.nps}$`) })
    await npsButton.click()
    await expect(npsButton, 'NPS 应选择 9 分').toHaveClass(/fb-text-white/)
    logger('success', '第 3 页高级题目全部填写并逐项断言通过', {
      cascader: data.cascader,
      matrixCells: 9,
      matrixChoice: ['题目1/选项1', '题目2/选项2', '题目3/选项3'],
      ranking: data.ranking,
      rating: data.rating,
      nps: data.nps,
    })

    logger('info', '所有题目填写完成，点击“提交”并等待提交接口响应')
    const submission = await waitForPublicMutation(
      page,
      `/f/form/${FORM_CODE}/submission`,
      () => page.getByRole('button', { name: '提交', exact: true }).click(),
      '提交表单',
    )
    const requestPayload = submission.response.request().postData() || ''
    for (const expectedValue of [data.username, data.mobile, data.email, data.singleLine, data.matrix[2][2]]) {
      expect(requestPayload.includes(expectedValue), `提交请求应包含与题目匹配的值“${expectedValue}”`).toBeTruthy()
    }
    const submissionId = String(
      submission.body?.data?.submission_id
      ?? submission.body?.data?.id
      ?? submission.body?.submission_id
      ?? '',
    )
    await page.waitForURL(/\/form\/submission-result\//, { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => undefined)
    await expect(page.getByText('提交成功', { exact: true }).first(), '提交后应显示“提交成功”结果').toBeVisible({ timeout: NAVIGATION_TIMEOUT_MS })
    expect(authorizationLeaks, '公开表单域名的所有请求都不应携带后台环境 Token').toEqual([])
    expect(publicRequestCount, '应观察到公开表单域名的业务请求').toBeGreaterThan(0)
    logger('success', '表单提交成功，题目、答案和提交请求断言全部通过', {
      formCode: FORM_CODE,
      submissionId: submissionId || '响应未返回可识别 ID',
      publicRequestCount,
      authorizationLeakCount: authorizationLeaks.length,
      token: '[REDACTED]',
    })
    logger('success', 'Chrome 无头公开表单填写 UI 自动化执行完成')

    return {
      formCode: FORM_CODE,
      formUrl: FORM_URL,
      title: EXPECTED_FORM_TITLE,
      submissionId,
      status: 'submitted',
      browser: 'chrome',
      headless: true,
      pageCount: 3,
      questionCount: PAGE_FIELD_LABELS.flat().length,
      publicRequestCount,
      authorizationLeakCount: authorizationLeaks.length,
    }
  } catch (error) {
    if (signal?.aborted) {
      logger('info', '已响应强制停止，正在清理 Chrome 无头浏览器')
    } else if (page) {
      const screenshotPath = await screenshotFailure(page, data.runId)
      logger('error', '公开表单填写自动化执行失败，已保存当前页面全页截图', { screenshotPath })
    }
    throw error
  } finally {
    const abortCloseStarted = await stopAbortClose()
    if (!abortCloseStarted) await closePlaywrightHandles({ context, browser }, { logger })
  }
}

export {
  EXPECTED_FORM_TITLE,
  FIELD_KEYS,
  FORM_CODE,
  FORM_URL,
  PAGE_FIELD_LABELS,
  SELECT_MAX_ATTEMPTS,
  createTestData,
  selectOption,
}
