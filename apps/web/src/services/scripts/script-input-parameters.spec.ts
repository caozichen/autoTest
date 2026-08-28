import { describe, expect, it } from 'vitest'

import {
  cloneScriptInputParameters,
  normalizeScriptInputParameters,
  scriptInputParameterDefaults,
} from './script-input-parameters'

describe('script input parameters', () => {
  it('trims fields while preserving empty and JSON default values', () => {
    const normalized = normalizeScriptInputParameters([
      {
        id: ' submission-id ',
        key: ' SUBMISSION_ID ',
        value: ' lpXAWZ ',
        description: ' 提交记录 ID ',
      },
      {
        id: 'assertions',
        key: ' SUBMISSION_ASSERTIONS ',
        value: ' {} ',
        description: ' 断言 JSON ',
      },
      {
        id: 'optional',
        key: ' OPTIONAL_VALUE ',
        value: '   ',
        description: ' 可留空 ',
      },
    ])

    expect(normalized).toEqual([
      {
        id: 'submission-id',
        key: 'SUBMISSION_ID',
        value: 'lpXAWZ',
        description: '提交记录 ID',
      },
      {
        id: 'assertions',
        key: 'SUBMISSION_ASSERTIONS',
        value: '{}',
        description: '断言 JSON',
      },
      {
        id: 'optional',
        key: 'OPTIONAL_VALUE',
        value: '',
        description: '可留空',
      },
    ])
    expect(scriptInputParameterDefaults(normalized)).toEqual({
      SUBMISSION_ID: 'lpXAWZ',
      SUBMISSION_ASSERTIONS: '{}',
      OPTIONAL_VALUE: '',
    })
  })

  it('requires a key and rejects duplicate keys case-insensitively', () => {
    expect(() => normalizeScriptInputParameters([{
      id: 'missing', key: ' ', value: '', description: '',
    }])).toThrow('输入参数名')

    expect(() => normalizeScriptInputParameters([
      { id: 'first', key: 'FORM_ID', value: 'one', description: '' },
      { id: 'second', key: ' form_id ', value: 'two', description: '' },
    ])).toThrow('重复')
  })

  it('returns independent clones', () => {
    const source = [{ id: 'form-id', key: 'FORM_ID', value: 'lg2bkk', description: '表单 ID' }]
    const cloned = cloneScriptInputParameters(source)

    cloned[0]!.value = 'changed'
    expect(source[0]?.value).toBe('lg2bkk')
  })
})
