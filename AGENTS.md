# Project Instructions

## Google Chrome tests

- This project intentionally runs Playwright against the installed Google Chrome channel.
- On macOS, any command that can reach the Playwright browser tests must run outside the Codex seatbelt sandbox from the first attempt. Use `sandbox_permissions: "require_escalated"` for `npm test`, `npm run test --workspace @autotest/api`, direct `node --test` runs that include the form submission tests, and the UI specs in `scripts/`.
- Do not disable the guard in `scripts/support/google-chrome.mjs`. A sandboxed Chrome process cannot reach LaunchServices and aborts with `SIGABRT`.
- For interactive browser inspection from Codex, use the Browser or Chrome plugin instead of launching `/Applications/Google Chrome.app` from a shell process.
