import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer as createPortProbe } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createServer as createViteServer } from 'vite'
import { expect } from '@playwright/test'
import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'
import { createRunnerServer } from './server.mjs'
import { AppSettingsStore } from './app-settings-store.mjs'
import { WEB_ORIGIN } from '../../shared/local-services.mjs'

// This fixture uses temporary stores and never authenticates or runs a business script.
test('Chrome migrates settings, changes frontend port, restarts Runner, and restores all settings in a fresh browser context', { timeout: 60000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'autotest-settings-browser-'))
  const webRoot = fileURLToPath(new URL('../web/', import.meta.url))
  const timestamp = new Date().toISOString()
  let runner, vite, browser
  let runnerUrl, webUrl
  const startRunner = async () => {
    runner = createRunnerServer({ appSettingsStore: new AppSettingsStore({ directory: join(directory, 'settings') }),
      runRecordDirectory: join(directory, 'records'), scriptConfigRepository: { list: async () => [] },
      executeScript: async () => { throw new Error('No business script may run in this fixture') } })
    runner.listen(0, '127.0.0.1'); await once(runner, 'listening')
    runnerUrl = `http://127.0.0.1:${runner.address().port}`
  }
  const startWeb = async () => {
    const probe = createPortProbe()
    probe.listen(0, '127.0.0.1'); await once(probe, 'listening')
    const port = probe.address().port
    await new Promise(resolve => probe.close(resolve))
    vite = await createViteServer({ root: webRoot, configFile: join(webRoot, 'vite.config.ts'),
      server: { port, strictPort: true }, logLevel: 'error' })
    await vite.listen()
    webUrl = `http://127.0.0.1:${vite.httpServer.address().port}`
  }
  const stopRunner = async () => { runner.closeAllConnections(); await new Promise(resolve => runner.close(resolve)) }
  t.after(async () => {
    await browser?.close(); await vite?.close()
    if (runner?.listening) await stopRunner()
    await rm(directory, { recursive: true, force: true })
  })
  await startRunner(); await startWeb()
  browser = await launchGoogleChrome()
  const context = async (seedLegacy = false) => {
    const result = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
    await result.route('http://127.0.0.1:4310/**', async route => {
      const upstream = await route.fetch({ url: runnerUrl + new URL(route.request().url()).pathname,
        headers: { ...route.request().headers(), origin: WEB_ORIGIN } })
      await route.fulfill({ response: upstream, headers: { ...upstream.headers(), 'access-control-allow-origin': webUrl } })
    })
    await result.addInitScript(({ seedLegacy, timestamp }) => {
      if (!location.protocol.startsWith('http')) return
      sessionStorage.setItem('autotest.session.v1', JSON.stringify({ token: 'fixture', expiresAt: Date.now() + 60000,
        user: { id: 'fixture-user', username: 'fixture' } }))
      if (!seedLegacy) return
      localStorage.setItem('autotest.environments.v7', JSON.stringify([{ id: 'env-fixture', name: '跨端口环境', code: 'FIXTURE', description: '',
        enabled: true, active: true, baseUrl: 'https://fixture.test', apiBaseUrl: 'https://fixture.test/api', updatedAt: timestamp,
        variables: [{ id: 'var-fixture', key: 'CUSTOM_SETTING', value: 'preserved', secret: false, enabled: true, description: '' }],
        auth: { strategy: 'reuse-session', mode: 'password', method: 'POST', timeoutMs: 1000, loginPath: '/login', requestBody: '{}',
          username: '', password: '', mobile: '', verifyCode: '', successPath: 'code', successValue: '0',
          tokenPath: 'data.token', tokenVariable: 'AUTH_TOKEN', tokenTypePath: 'data.type', tokenTypeFallback: 'Bearer' } }]))
      localStorage.setItem('autotest.automation-pipelines.v1', JSON.stringify([{ id: 'fixture-pipeline', name: '端口迁移流程', description: '',
        createdAt: timestamp, updatedAt: timestamp, steps: [{ scriptId: 'fixture-script', parameterMappings: [] }] }]))
      localStorage.setItem('autotest.run-history-tabs.v1', '[]')
      localStorage.setItem('autotest.environment-session.v1.env-fixture', JSON.stringify({ environmentId: 'env-fixture',
        siteUrl: 'https://fixture.test', apiUrl: 'https://fixture.test/api', token: 'fixture-token', scheme: 'Bearer',
        accountLabel: '迁移账号', savedAt: timestamp, expiresAt: null }))
    }, { seedLegacy, timestamp })
    return result
  }
  const oldContext = await context(true)
  const oldPage = await oldContext.newPage()
  await oldPage.goto(webUrl + '/automations')
  await expect(oldPage.getByText('端口迁移流程', { exact: true })).toBeVisible()
  const original = await new AppSettingsStore({ directory: join(directory, 'settings') }).read()
  assert.equal(Object.keys(original.values).length, 4)
  const oldPort = new URL(webUrl).port
  await oldContext.close(); await vite.close(); await stopRunner()
  await startRunner(); await startWeb()
  assert.notEqual(new URL(webUrl).port, oldPort)
  const freshContext = await context()
  const page = await freshContext.newPage()
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto(webUrl + '/automations')
  await expect(page.getByText('端口迁移流程', { exact: true })).toBeVisible()
  assert.equal(await page.evaluate(() => localStorage.length), 0, 'fresh origin has no legacy browser settings')
  await page.goto(webUrl + '/environments')
  await expect(page.getByText('已保存 · 迁移账号', { exact: true }).first()).toBeVisible()
  await page.goto(webUrl + '/settings/run-history')
  await expect(page.getByText('当前仅显示“全部环境”，可以在上方添加环境 Tab。', { exact: true })).toBeVisible()
  const restored = await new AppSettingsStore({ directory: join(directory, 'settings') }).read()
  assert.deepEqual(restored, original, 'new frontend port and restarted Runner retain byte-equivalent settings')
  assert.deepEqual(errors, [])
})
