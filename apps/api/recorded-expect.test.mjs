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
