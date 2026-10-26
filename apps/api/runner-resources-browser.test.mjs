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
test('Chrome resource page supports safe automatic refresh, route persistence, offline snapshots and responsive layouts', { timeout: 180_000 }, async t => {
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
  const collectionDurations = []
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
    if (path === '/runner/resources') collectionDurations.push((await upstream.json()).collectionDurationMs)
    await route.fulfill({ response: upstream, headers: { ...upstream.headers(), 'access-control-allow-origin': webUrl } })
  })
  await context.addInitScript(() => {
    if (!location.protocol.startsWith('http')) return
    sessionStorage.setItem('autotest.session.v1', JSON.stringify({ token: 'local-resource-qa', expiresAt: Date.now() + 300_000,
      user: { id: 'fixture-user', username: 'fixture' } }))
  })
  const page = await context.newPage()
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto(webUrl + '/settings')
  const refresh = () => page.getByRole('button', { name: '手动刷新', exact: true })
  const autoRefresh = () => page.getByRole('button', { name: '自动刷新', exact: true })
  const stopRefresh = () => page.getByRole('button', { name: '停止自动刷新', exact: true })
  await expect(page.locator('.sample-time')).toContainText('本次采样快照')
  await expect(page.locator('.resource-group')).toHaveCount(7)
  await expect(page.locator('[data-metric="cacheMaxBytes"]')).toContainText('32 MiB')
  const initialSample = await page.locator('.sample-time').innerText()
  const initialCounts = { ...counts }
  await new Promise(resolve => setTimeout(resolve, 6_000))
  assert.deepEqual(counts, initialCounts)
  assert.deepEqual(initialCounts, { health: 1, resources: 1, executionAttempts: 0 })
  await expect(autoRefresh()).toHaveAttribute('aria-pressed', 'false')
  const actions = await page.locator('.resources-actions button').allTextContents()
  assert.deepEqual(actions.map(text => text.trim()), ['手动刷新', '自动刷新'])

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

  const leaveResources = async () => {
    await page.locator('.admin-shell__desktop-sidebar a[href="/settings/run-history"]').click()
    await expect(page.locator('.tab-settings h1')).toHaveText('运行记录 Tab 配置')
  }
  const returnToResources = async () => {
    await page.locator('.admin-shell__desktop-sidebar a[href="/settings"]').click()
    await expect(refresh()).toBeEnabled()
  }
  // Warm both routes before measuring retained heap and detached DOM.
  for (let i = 0; i < 3; i++) { await leaveResources(); await returnToResources() }
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  const readPerformance = async () => {
    await cdp.send('HeapProfiler.collectGarbage')
    const { metrics } = await cdp.send('Performance.getMetrics')
    const selected = Object.fromEntries(metrics.filter(({ name }) => ['JSHeapUsedSize', 'Nodes', 'Documents', 'JSEventListeners', 'TaskDuration'].includes(name)).map(({ name, value }) => [name, value]))
    return { ...selected, dom: await cdp.send('Memory.getDOMCounters') }
  }
  const before = await readPerformance()
  const automaticStartCount = counts.resources
  const automaticStarted = performance.now()
  await autoRefresh().click()
  await expect(stopRefresh()).toHaveAttribute('aria-pressed', 'true')
  const checkpoints = []
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => setTimeout(resolve, 20_000))
    checkpoints.push({ elapsedMs: performance.now() - automaticStarted, resources: counts.resources, ...await readPerformance() })
  }
  await stopRefresh().click()
  await expect(refresh()).toBeEnabled()
  const after = await readPerformance()
  const automaticElapsedMs = performance.now() - automaticStarted
  const automaticSamples = counts.resources - automaticStartCount
  assert.ok(automaticSamples >= 45 && automaticSamples <= 65, `unexpected request rate: ${automaticSamples} in ${automaticElapsedMs}ms`)
  assert.ok(after.JSHeapUsedSize < before.JSHeapUsedSize + 8 * 1024 * 1024, JSON.stringify({ before, after }))
  assert.ok(after.dom.nodes <= before.dom.nodes + 200, JSON.stringify({ before, after }))
  assert.ok(after.dom.jsEventListeners <= before.dom.jsEventListeners + 30, JSON.stringify({ before, after }))
  const stoppedCounts = { ...counts }
  await new Promise(resolve => setTimeout(resolve, 2_200))
  assert.deepEqual(counts, stoppedCounts, 'stopped automatic refresh must issue no further requests')

  // Enabled state survives route changes while sampling stops on other pages.
  await autoRefresh().click(); await expect(refresh()).toBeEnabled()
  await leaveResources()
  const awayCounts = { ...counts }
  await new Promise(resolve => setTimeout(resolve, 2_200))
  assert.deepEqual(counts, awayCounts, 'other routes must not keep the resource timer alive')
  await returnToResources(); await expect(stopRefresh()).toBeVisible()
  const returnedCount = counts.resources
  await expect.poll(() => counts.resources, { timeout: 3_000 }).toBeGreaterThan(returnedCount)
  if (outputDirectory) await page.screenshot({ path: join(outputDirectory, 'runner-resources-auto-preview.png') })
  await stopRefresh().click(); await expect(refresh()).toBeEnabled()
  for (let i = 0; i < 20; i++) {
    await leaveResources(); await returnToResources()
    await expect(autoRefresh()).toBeVisible()
  }
  const navigationImmediately = await readPerformance()
  // Element Plus loading masks finish their leave transition after unmount.
  // Measure retained DOM after that cleanup, with the same strict bounds.
  await new Promise(resolve => setTimeout(resolve, 1_000))
  const afterNavigation = await readPerformance()
  t.diagnostic(JSON.stringify({ navigationImmediately, afterNavigation }))
  assert.ok(afterNavigation.JSHeapUsedSize < after.JSHeapUsedSize + 8 * 1024 * 1024, JSON.stringify({ after, afterNavigation }))
  assert.ok(afterNavigation.dom.nodes <= after.dom.nodes + 200, JSON.stringify({ after, afterNavigation }))
  assert.ok(afterNavigation.dom.jsEventListeners <= after.dom.jsEventListeners + 30, JSON.stringify({ after, afterNavigation }))
  const performanceEvidence = { automaticElapsedMs, automaticSamples, before, checkpoints, after, routeRoundTrips: 20, navigationImmediately, afterNavigation,
    rendererTaskPercent: (after.TaskDuration - before.TaskDuration) / (automaticElapsedMs / 1000) * 100,
    collectionDurationMs: { max: Math.max(...collectionDurations), average: collectionDurations.reduce((sum, value) => sum + value, 0) / collectionDurations.length } }
  t.diagnostic(JSON.stringify({ performance: performanceEvidence }))

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
    const positions = await page.locator('.resources-actions button').evaluateAll(buttons => buttons.map(button => {
      const { x, y, width } = button.getBoundingClientRect(); return { x, y, width }
    }))
    assert.ok(positions[0].x + positions[0].width <= positions[1].x, JSON.stringify(positions))
    assert.equal(positions[0].y, positions[1].y)
    layouts.push(layout)
    if (outputDirectory && width === 390) {
      await page.screenshot({ path: join(outputDirectory, 'runner-resources-narrow.png'), fullPage: true })
      await page.screenshot({ path: join(outputDirectory, 'runner-resources-narrow-preview.png') })
    }
  }
  // An offline first visit must not display empty/zero metrics as current data.
  await page.setViewportSize({ width: 1440, height: 1000 })
  await autoRefresh().click(); await expect(stopRefresh()).toBeVisible()
  offline = true
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('HTTP 503')
  await expect(page.locator('.sample-time')).toContainText('尚无可用资源快照')
  await expect(page.locator('.resource-group')).toHaveCount(0)
  await expect(autoRefresh()).toHaveAttribute('aria-pressed', 'false')
  const reloadedCounts = { ...counts }
  await new Promise(resolve => setTimeout(resolve, 2_200))
  assert.deepEqual(counts, reloadedCounts, 'a full reload must default automatic refresh to off')
  assert.equal(counts.executionAttempts, 0)
  assert.deepEqual(errors, [])
  const evidence = { initialCounts, finalCounts: counts, noPollingObservationMs: 6000, performance: performanceEvidence, layouts, pageErrors: errors }
  if (outputDirectory) await writeFile(join(outputDirectory, 'browser-validation.json'), JSON.stringify(evidence, null, 2) + '\n')
  t.diagnostic(JSON.stringify(evidence))
})
