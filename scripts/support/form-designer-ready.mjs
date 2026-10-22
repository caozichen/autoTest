import { expect, scaleTimeout } from './environment-timeouts.mjs'
import { waitForUiReady } from './ui-readiness.mjs'

// The palette renders before remote configuration finishes. A visible editor can
// still be inert, and Playwright fill() does not wait for that ancestor lock.
export async function waitForDesignerReady(page, {
  timeout = scaleTimeout(45_000),
} = {}) {
  const deadline = Date.now() + timeout
  const remaining = () => Math.max(1, deadline - Date.now())
  const palette = page.locator('button[data-component-type="contactGroup"]')
  await palette.waitFor({ state: 'visible', timeout: remaining() })
  await palette.evaluate(async (element, timeoutMs) => {
    const designer = element.closest('form-designer')
    // Older deployed designers expose only DOM readiness signals.
    if (typeof designer?.whenReady !== 'function') return
    let timer
    try {
      await Promise.race([
        designer.whenReady(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('等待设计器 whenReady 初始化完成超时')), timeoutMs)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }, remaining())
  await waitForUiReady(page, { timeout: remaining() })
  await expect.poll(() => palette.evaluate(element => (
    element.isConnected && !element.closest('[inert], [aria-busy="true"]')
  )), {
    timeout: remaining(),
    intervals: [50, 100, 200],
    message: '等待设计器解除初始化交互锁定',
  }).toBe(true)
}
