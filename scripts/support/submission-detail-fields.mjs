const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function parseDetailReference(reference) {
  const match = String(reference).match(/^(.*?)(?:\[(\d+)\])?$/)
  return { label: match[1].trim(), occurrence: match[2] ? Number(match[2]) : null }
}

// The keys remain readable aliases; identity no longer depends on DOM row order.
export function parseFieldIdentities(value, fields = {}) {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('SUBMISSION_ASSERTIONS.fieldIdentities 必须是字段身份对象')
  }
  return Object.fromEntries(Object.entries(value).map(([reference, identity]) => {
    if (!Object.hasOwn(fields, reference) || !identity || typeof identity !== 'object' || Array.isArray(identity)
      || Object.keys(identity).some(key => !['itemKey', 'groupCode', 'groupIndex'].includes(key))
      || typeof identity.itemKey !== 'string' || !/^[\w-]+$/.test(identity.itemKey)
      || typeof identity.groupCode !== 'string' || !/^[\w-]*$/.test(identity.groupCode)
      || (identity.groupCode ? !Number.isSafeInteger(identity.groupIndex) || identity.groupIndex < 1 : identity.groupIndex !== null)) {
      throw new Error(`SUBMISSION_ASSERTIONS.fieldIdentities.${reference} 必须引用已有字段及有效题目、题组身份`)
    }
    return [reference, { ...identity }]
  }))
}

export function contactFieldIdentities(fieldKeys) {
  return {
    '姓名[1]': { itemKey: fieldKeys.username, groupCode: '', groupIndex: null },
    '姓名[2]': { itemKey: fieldKeys.groupUsername, groupCode: fieldKeys.fieldGroup, groupIndex: 1 },
  }
}

export async function detailFieldRows(page, reference, { scope = page, identity } = {}) {
  const { label, occurrence } = parseDetailReference(reference)
  const labelPattern = /^(?:姓名|Name)$/i.test(label) ? '(?:姓名|Name)' : escapeRegExp(label)
  const rows = scope.locator('.reply-kv__row')
  const groupedRows = rows.locator('xpath=self::*[@data-group-code and string-length(@data-group-code)>0]')
  const exact = rows.filter({ has: page.locator('.reply-kv__label').filter({ hasText: new RegExp(`^\\s*${labelPattern}\\s*$`, 'i') }) })
  // Old deployments have no group attributes. Keep their ordinal inputs working;
  // once group metadata exists, a missing group must never fall back to another row.
  if (await groupedRows.count() === 0) return occurrence === null ? exact : exact.nth(occurrence - 1)
  if (identity?.groupCode || (!identity && occurrence !== null && occurrence > 1)) {
    const group = identity
      ? groupedRows.and(scope.locator(`[data-group-code=${JSON.stringify(identity.groupCode)}][data-group-index=${JSON.stringify(String(identity.groupIndex))}]`))
      : groupedRows.and(scope.locator(`[data-group-index=${JSON.stringify(String(occurrence - 1))}]`))
    return group.filter({ has: page.locator('.reply-kv__label').filter({ hasText: new RegExp(`(?:^|\\s/\\s)${labelPattern}\\s*$`, 'i') }) })
  }
  if (identity || occurrence === 1) return exact.and(scope.locator('.reply-kv__row:not([data-group-code]), .reply-kv__row[data-group-code=""]'))
  return exact
}
