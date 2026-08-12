import { describe, expect, it } from 'vitest'

import { getValueAtPath, stringifyExtractedValue } from './object-path'

describe('object path extraction', () => {
  const response = {
    code: 0,
    data: {
      token: 'runtime-token',
      items: [{ id: 7 }],
    },
  }

  it('supports dot paths, root prefixes and array indexes', () => {
    expect(getValueAtPath(response, 'data.token')).toBe('runtime-token')
    expect(getValueAtPath(response, '$.data.token')).toBe('runtime-token')
    expect(getValueAtPath(response, 'data.items[0].id')).toBe(7)
  })

  it('rejects prototype traversal segments', () => {
    expect(getValueAtPath(response, '__proto__.polluted')).toBeUndefined()
    expect(getValueAtPath(response, 'data.constructor.name')).toBeUndefined()
  })

  it('only converts scalar values into runtime variables', () => {
    expect(stringifyExtractedValue('token')).toBe('token')
    expect(stringifyExtractedValue(0)).toBe('0')
    expect(stringifyExtractedValue({ token: 'nested' })).toBeNull()
  })
})
