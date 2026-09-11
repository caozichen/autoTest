import { scaleTimeout } from './environment-timeouts.mjs'
import { chromium } from '@playwright/test'

function assertChromeCanLaunch() {
  const isCodexMacSandbox = process.platform === 'darwin'
    && process.env.CODEX_SANDBOX === 'seatbelt'

  if (isCodexMacSandbox) {
    throw new Error(
      'Google Chrome cannot run inside the Codex macOS sandbox. '
      + 'Run this test command with sandbox_permissions="require_escalated".',
    )
  }
}

export function launchGoogleChrome(options = {}) {
  assertChromeCanLaunch()
  return chromium.launch({ channel: 'chrome', headless: true, timeout: scaleTimeout(60_000), ...options })
}
