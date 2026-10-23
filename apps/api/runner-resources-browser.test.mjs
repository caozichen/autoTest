import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createServer as createViteServer } from 'vite'
import { expect } from '@playwright/test'
import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'
import { WEB_ORIGIN } from '../../shared/local-services.mjs'
import { AppSettingsStore } from './app-settings-store.mjs'
import { RunRecordFileStore } from './run-record-store.mjs'
import { createRunnerServer } from './server.mjs'

// Local integration fixture. Every default Runner request is intercepted and
// sent to this temporary server; no real history, credentials or business runs.
test('Chrome resource page samples manually, handles offline snapshots, and fits desktop and narrow layouts', { timeout: 60_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'autotest-resource-browser-'))
  const records = new RunRecordFileStore({ directory: join(directory, 'records') })
  await records.ensureReady()
  const runner = createRunnerServer({ runRecordDirectory: records.directory, runRecordStore: records,
    appSettingsStore: new AppSettingsStore({ directory: join(directory, 'settings') }),
    scriptConfigRepository: { list: async () => [], get: async () => null },
    executeScript: async () => { throw new Error('Business execution prohibited in resource QA') },
  })
  runner.listen(0, '127.0.0.1'); await once(runner, 'listening')
  const runnerUrl = `http://127.0.0.1:${runner.address().port}`
  const webRoot = fileURLToPath(new URL('../web/', import.meta.url))
  const vite = await createViteServer({ root: webRoot, configFile: join(webRoot, 'vite.config.ts'),
    server: { port: 0, strictPort: false }, logLevel: 'error' })
  await vite.listen()
  const webUrl = `http://127.0.0.1:${vite.httpServer.address().port}`
  const browser = await launchGoogleChrome()
  t.after(async () => {
    await browser.close(); await vite.close()
    runner.closeAllConnections(); await new Promise(resolve => runner.close(resolve))
    await rm(directory, { recursive: true, force: true })
  })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const counts = { health: 0, resources: 0, executionAttempts: 0 }
  let offline = false, releaseSample = null
  await context.route('http://127.0.0.1:4310/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/health') counts.health++
    if (path === '/runner/resources') {
      counts.resources++
      if (releaseSample) await releaseSample.promise
    }
    if (path.startsWith('/executions') || path.startsWith('/runs') || path.includes('/cancel')) {
      counts.executionAttempts++; await route.abort(); return
    }
    if (offline && ['/health', '/runner/resources'].includes(path)) {
      await route.fulfill({ status: 503, headers: { 'access-control-allow-origin': webUrl }, json: {} }); return
    }
    const upstream = await route.fetch({ url: runnerUrl + path, headers: { ...route.request().headers(), origin: WEB_ORIGIN } })
    await route.fulfill({ response: upstream, headers: { ...upstream.headers(), 'access-control-allow-origin': webUrl } })
  })
  await context.addInitScript(() => {
    if (!location.protocol.startsWith('http')) return
    sessionStorage.setItem('autotest.session.v1', JSON.stringify({ token: 'local-resource-qa', expiresAt: Date.now() + 60_000,
      user: { id: 'fixture-user', username: 'fixture' } }))
  })
  const page = await context.newPage()
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto(webUrl + '/settings')
  const refresh = () => page.getByRole('button', { name: '手动刷新', exact: true })
  await expect(page.locator('.sample-time')).toContainText('本次采样快照')
  await expect(page.locator('.resource-group')).toHaveCount(7)
  await expect(page.locator('[data-metric="cacheMaxBytes"]')).toContainText('32 MiB')
  const initialSample = await page.locator('.sample-time').innerText()
  const initialCounts = { ...counts }
  await new Promise(resolve => setTimeout(resolve, 6_000))
  assert.deepEqual(counts, initialCounts)
  assert.deepEqual(initialCounts, { health: 1, resources: 1, executionAttempts: 0 })

  const outputDirectory = process.env.AUTOTEST_RESOURCE_QA_OUTPUT
  if (outputDirectory) {
    await mkdir(outputDirectory, { recursive: true })
    await page.screenshot({ path: join(outputDirectory, 'runner-resources-desktop.png'), fullPage: true })
    await page.screenshot({ path: join(outputDirectory, 'runner-resources-desktop-preview.png') })
  }
  // Hold a request so loading and overlap suppression are verified visibly.
  let release
  releaseSample = { promise: new Promise(resolve => { release = resolve }) }
  await refresh().click()
  await expect(page.getByRole('button', { name: '正在采集', exact: true })).toBeDisabled()
  assert.equal(counts.resources, 2)
  release(); releaseSample = null
  await expect(refresh()).toBeEnabled()
  await expect(page.locator('.sample-time')).not.toHaveText(initialSample)
  assert.deepEqual(counts, { health: 2, resources: 2, executionAttempts: 0 })

  offline = true
  await refresh().click()
  await expect(page.getByRole('alert')).toContainText('下方保留上次成功数据，不代表当前状态')
  await expect(page.locator('.sample-time')).toContainText('已过期')
  await expect(page.locator('.runner-status')).toHaveText('离线')
  await expect(page.locator('.resource-group')).toHaveCount(7)
  if (outputDirectory) {
    await page.screenshot({ path: join(outputDirectory, 'runner-resources-offline.png'), fullPage: true })
    await page.screenshot({ path: join(outputDirectory, 'runner-resources-offline-preview.png') })
  }
  offline = false
  await refresh().click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.locator('.runner-status')).toHaveText('在线')
  await expect(page.locator('.sample-time')).toContainText('本次采样快照')

  const layouts = []
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    const layout = await page.evaluate(() => {
      const panel = document.querySelector('.runner-resources')
      const metrics = [...document.querySelectorAll('.resource-metrics > div')]
      return { viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        panelWidth: panel.getBoundingClientRect().width,
        overflow: metrics.filter(metric => metric.scrollWidth > metric.clientWidth + 1).length }
    })
    assert.ok(layout.scrollWidth <= width + 1, JSON.stringify(layout))
    assert.equal(layout.overflow, 0, JSON.stringify(layout))
    layouts.push(layout)
    if (outputDirectory && width === 390) {
      await page.screenshot({ path: join(outputDirectory, 'runner-resources-narrow.png'), fullPage: true })
      await page.screenshot({ path: join(outputDirectory, 'runner-resources-narrow-preview.png') })
    }
  }
  // An offline first visit must not display empty/zero metrics as current data.
  offline = true
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('HTTP 503')
  await expect(page.locator('.sample-time')).toContainText('尚无可用资源快照')
  await expect(page.locator('.resource-group')).toHaveCount(0)
  assert.equal(counts.executionAttempts, 0)
  assert.deepEqual(errors, [])
  const evidence = { initialCounts, finalCounts: counts, noPollingObservationMs: 6000, layouts, pageErrors: errors }
  if (outputDirectory) await writeFile(join(outputDirectory, 'browser-validation.json'), JSON.stringify(evidence, null, 2) + '\n')
  t.diagnostic(JSON.stringify(evidence))
})
