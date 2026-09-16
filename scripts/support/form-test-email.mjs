import { readFileSync } from 'node:fs'

export const FIXED_FORM_EMAIL = 'caozichen@lingxi360.cn'
const CONFIG_URL = new URL('../../config/form-test-data.json', import.meta.url)

// Read for each run so switching the JSON flag does not require restarting Runner.
export function createFormEmailData(now, options = JSON.parse(readFileSync(CONFIG_URL, 'utf8'))) {
  if (typeof options?.useFixedEmail !== 'boolean') {
    throw new Error('config/form-test-data.json 的 useFixedEmail 必须为 true 或 false')
  }
  if (options.useFixedEmail) {
    return { email: FIXED_FORM_EMAIL, groupEmail: FIXED_FORM_EMAIL }
  }
  // 原随机邮箱逻辑保留在关闭分支；开启开关时不执行。
  return {
    email: `autotest_${now}@example.com`,
    groupEmail: `group_${now}@example.com`,
  }
}
