import assert from 'node:assert/strict'
import test from 'node:test'

import {
  expect,
  inferAssertionModule,
  runWithAssertionRecorder,
} from '../../scripts/support/recorded-expect.mjs'

test('records assertion failures without throwing and continues with later assertions', async () => {
  const assertions = []

  await runWithAssertionRecorder('form-lpxavn-submit', (assertion) => assertions.push(assertion), async () => {
    expect('abc', '单项选择按要求输入 3 个字符').toHaveLength(3)
    expect('abcde', '单项选择最多输入 4 个字符').toHaveLength(4)
    expect('继续执行', '失败后仍应继续执行后续断言').toContain('继续')
  })

  assert.deepEqual(assertions.map(({ name, module, matcher, status }) => ({ name, module, matcher, status })), [
    {
      name: '单项选择按要求输入 3 个字符',
      module: '单项选择',
      matcher: 'toHaveLength',
      status: 'passed',
    },
    {
      name: '单项选择最多输入 4 个字符',
      module: '单项选择',
      matcher: 'toHaveLength',
      status: 'failed',
    },
    {
      name: '失败后仍应继续执行后续断言',
      module: '基础运行流程',
      matcher: 'toContain',
      status: 'passed',
    },
  ])
  assert.match(assertions[1].error, /Expected length/)
})

test('records expect.poll and derives stable modules for non-field assertions', async () => {
  const assertions = []
  let value = 0

  await runWithAssertionRecorder('form-all-fields-publish', (assertion) => assertions.push(assertion), async () => {
    setTimeout(() => { value = 2 }, 5)
    await expect.poll(() => value, {
      message: '发布响应最终应返回成功状态',
      timeout: 100,
      intervals: [1, 5, 10],
    }).toBe(2)
  })

  assert.equal(assertions.length, 1)
  assert.equal(assertions[0].matcher, 'poll.toBe')
  assert.equal(assertions[0].module, '表单创建与发布')
  assert.equal(assertions[0].status, 'passed')
  assert.equal(inferAssertionModule('form-lpxavn-submit', '结果页应显示提交编号'), '表单提交')
})

test('maps multilingual workflow assertions before field and generic publish modules', () => {
  const cases = [
    ['多语言设置中的手机号语言代码应唯一', '多语言设置'],
    ['AI 一键翻译应生成姓名和手机号文案', 'AI 一键翻译'],
    ['翻译保存后应回读手机号题目', '翻译保存与回读'],
    ['完成并发布后应保留姓名翻译', '完成与发布'],
    ['多语言预览中的手机号题目应正确', '多语言预览'],
    ['分享弹窗切换语言后应显示手机号题目', '分享与语言切换'],
    ['多語言設定的姓名語言代碼應正確', '多语言设置'],
    ['一鍵 AI 翻譯應完成手機號文案', 'AI 一键翻译'],
    ['翻譯儲存後應回讀姓名題目', '翻译保存与回读'],
    ['完成並發佈後手機號翻譯應保留', '完成与发布'],
    ['多語言預覽中的姓名題目應正確', '多语言预览'],
    ['分享彈窗的語言切換後應顯示手機號題目', '分享与语言切换'],
  ]

  for (const [name, expectedModule] of cases) {
    assert.equal(inferAssertionModule('form-translation-publish', name), expectedModule)
  }

  assert.equal(
    inferAssertionModule('form-translation-publish', '保存响应应包含 revision_no'),
    '翻译保存与回读',
  )
  assert.equal(
    inferAssertionModule('form-translation-publish', '发布响应状态应为 published'),
    '完成与发布',
  )
  assert.equal(
    inferAssertionModule('form-translation-publish', '完成与发布后手机号应保持完整'),
    '完成与发布',
  )
  assert.equal(
    inferAssertionModule('form-translation-publish', '英文翻译结果中的手机号不应为空'),
    'AI 一键翻译',
  )
  assert.equal(
    inferAssertionModule('form-translation-publish', '页面应恰好显示三种语言和姓名题目'),
    '多语言设置',
  )
  assert.equal(
    inferAssertionModule('form-all-fields-publish', '发布响应最终应返回成功状态'),
    '表单创建与发布',
  )
  assert.equal(inferAssertionModule('form-lpxavn-submit', '手机号应正确回显'), '手机号')
})
