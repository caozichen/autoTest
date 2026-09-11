import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createServer as createViteServer } from 'vite'
import { expect } from '@playwright/test'
import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'
import { createRunnerServer } from './server.mjs'
import { RunRecordFileStore } from './run-record-store.mjs'

// Entirely local fixture: all default Runner requests are intercepted before they
// reach port 4310. No real environment authentication or business scripts run.
test('Chrome refresh/close/reopen preserves the entire pipeline and can stop it from a new page', { timeout: 60000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'autotest-pipeline-browser-'))
  const records = new RunRecordFileStore({ directory })
  const timestamp = new Date().toISOString()
  const configs = ['first', 'second', 'third'].map(id => ({ schemaVersion: 1, revision: 0, id, name: id, description: '',
    directory: 'scripts', entryFile: `${id}.mjs`, timeoutMs: 30000, enabled: true, tags: [], createdAt: timestamp, updatedAt: timestamp,
    inputParameters: [], responseVariableBindings: [] }))
  const calls = []
  const releases = new Map()
  const runner = createRunnerServer({ runRecordStore: records,
    scriptConfigRepository: { list: async () => configs, get: async id => configs.find(config => config.id === id) },
    validateRequest: payload => ({ scriptId: payload.scriptId, executionId: payload.executionId }),
    pipelineLogin: async () => ({ token: 'local-fixture', scheme: 'Bearer' }),
    recordMaintenanceIntervalMs: 20,
    executeScript: async (payload, { signal, onLog }) => {
      calls.push(payload.scriptId)
      onLog({ timestamp: new Date().toISOString(), level: 'info', message: '本地浏览器回归步骤执行中' })
      await new Promise(resolve => { releases.set(payload.scriptId, resolve); signal.addEventListener('abort', resolve, { once: true }) })
      return { ok: true, status: 'passed', durationMs: 1, logs: [{ timestamp: new Date().toISOString(), level: 'success', message: '本地后台步骤已完成' }], result: { formId: 'fixture-created' } }
    },
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
    releases.forEach(resolve => resolve())
    await browser.close(); await vite.close()
    runner.closeAllConnections(); await new Promise(resolve => runner.close(resolve))
    await rm(directory, { recursive: true, force: true })
  })
  const context = await browser.newContext()
  await context.route('http://127.0.0.1:4310/**', async route => {
    const upstream = await route.fetch({ url: runnerUrl + new URL(route.request().url()).pathname,
      headers: { ...route.request().headers(), origin: 'http://127.0.0.1:5174' } })
    await route.fulfill({ response: upstream, headers: { ...upstream.headers(), 'access-control-allow-origin': webUrl } })
  })
  await context.addInitScript(({ timestamp }) => {
    if (!location.protocol.startsWith('http')) return
    sessionStorage.setItem('autotest.session.v1', JSON.stringify({ token: 'fixture', expiresAt: Date.now() + 60000,
      user: { id: 'fixture-user', username: 'fixture' } }))
    localStorage.setItem('autotest.environments.v7', JSON.stringify([{ id: 'env-fixture', name: '本地模拟环境', code: 'TEST', description: '',
      enabled: true, active: true, baseUrl: 'http://127.0.0.1:1', apiBaseUrl: 'http://127.0.0.1:1/api', updatedAt: timestamp,
      variables: [], auth: { strategy: 'api-login', mode: 'mobile-code', method: 'POST', timeoutMs: 1000, loginPath: '/login', requestBody: '{}',
        username: '', password: '', mobile: '', verifyCode: '', successPath: 'code', successValue: '0',
        tokenPath: 'data.token', tokenVariable: 'AUTH_TOKEN', tokenTypePath: 'data.type', tokenTypeFallback: 'Bearer' } }]))
    localStorage.setItem('autotest.automation-pipelines.v1', JSON.stringify([{ id: 'browser-pipeline', name: '页面关闭回归', description: '',
      createdAt: timestamp, updatedAt: timestamp, steps: ['first', 'second', 'third'].map(scriptId => ({ scriptId, parameterMappings: [] })) }]))
  }, { timestamp })
  let page = await context.newPage()
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto(webUrl + '/automations')
  const run = () => page.getByRole('button', { name: '运行自动化配置', exact: true })
  const stop = () => page.getByRole('button', { name: '强制停止自动化配置', exact: true })
  await expect(run()).toBeEnabled(); await run().click()
  await expect.poll(() => calls.length).toBe(1)
  await page.reload()
  await expect(run()).toBeDisabled(); await expect(stop()).toBeEnabled()
  await page.close()
  releases.get('first')()
  await expect.poll(() => calls.length).toBe(2)
  assert.deepEqual(calls, ['first', 'second'])
  page = await context.newPage(); await page.goto(webUrl + '/automations')
  await expect(run()).toBeDisabled(); await expect(stop()).toBeEnabled()
  await stop().click()
  await page.getByRole('button', { name: '强制停止', exact: true }).click()
  await expect.poll(async () => (await records.list())[0]?.status).toBe('interrupted')
  await expect(run()).toBeEnabled()
  assert.equal(calls.length, 2)
  await run().click(); await expect.poll(() => calls.length).toBe(3)
  await page.close()
  releases.get('first')(); await expect.poll(() => calls.length).toBe(4)
  releases.get('second')(); await expect.poll(() => calls.length).toBe(5)
  releases.get('third')()
  await expect.poll(async () => (await records.list())[0]?.status).toBe('passed')
  const finalRecord = (await records.list())[0]
  assert.equal(finalRecord.counts.passed, 3)
  page = await context.newPage(); await page.goto(webUrl + '/automations')
  await expect(run()).toBeEnabled(); await expect(stop()).toBeDisabled()
  await page.goto(webUrl + '/scripts')
  const scriptRuns = page.getByRole('button', { name: '运行脚本', exact: true })
  await expect(scriptRuns.first()).toBeEnabled()
  const logs = page.getByRole('button', { name: '查看运行日志', exact: true })
  await expect(logs.first()).toBeEnabled(); await logs.first().click()
  await expect(page.getByRole('dialog').getByText('本地后台步骤已完成', { exact: true })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
  await page.goto(webUrl + '/automations'); await run().click()
  await expect.poll(() => calls.length).toBe(6)
  await page.goto(webUrl + '/scripts')
  const scriptStops = page.getByRole('button', { name: '强制停止脚本', exact: true })
  await expect(scriptStops.first()).toBeEnabled(); await scriptStops.first().click()
  await page.getByRole('button', { name: '强制停止', exact: true }).click()
  await expect.poll(async () => (await records.list())[0]?.status).toBe('interrupted')
  await expect(scriptRuns.first()).toBeEnabled()
  assert.equal(calls.length, 6)
  assert.deepEqual(errors, [])
})

// Each environment deliberately uses the same configuration and script IDs.
test('Chrome runs three environments, restores them after reload and selects exact logs and cancellation', { timeout: 60000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'autotest-concurrent-browser-'))
  const records = new RunRecordFileStore({ directory })
  const timestamp = new Date().toISOString()
  const codes = ['TEST', 'CN_PROD', 'HK_PROD']
  const configs = ['first', 'second'].map(id => ({ schemaVersion: 1, revision: 0, id, name: id, description: '',
    directory: 'scripts', entryFile: `${id}.mjs`, timeoutMs: 30000, enabled: true, tags: [], createdAt: timestamp, updatedAt: timestamp,
    inputParameters: [], responseVariableBindings: [] }))
  const calls = []; const releases = new Map()
  const runner = createRunnerServer({ runRecordStore: records,
    scriptConfigRepository: { list: async () => configs, get: async id => configs.find(config => config.id === id) },
    validateRequest: payload => ({ scriptId: payload.scriptId, executionId: payload.executionId }),
    pipelineLogin: async env => ({ token: `fixture-${env.code}`, scheme: 'Bearer' }), recordMaintenanceIntervalMs: 20,
    executeScript: async (payload, { signal, onLog }) => {
      const code = payload.context.environmentCode; calls.push(`${code}:${payload.scriptId}`)
      const log = { timestamp: new Date().toISOString(), level: 'info', message: `仅属于 ${code} 的运行日志` }
      onLog(log)
      if (payload.scriptId === 'first') await new Promise(resolve => { releases.set(code, resolve); signal.addEventListener('abort', resolve, { once: true }) })
      return { ok: true, status: 'passed', durationMs: 1, logs: [log], result: { formId: `fixture-${code}` } }
    },
  })
  runner.listen(0, '127.0.0.1'); await once(runner, 'listening')
  const runnerUrl = `http://127.0.0.1:${runner.address().port}`
  const webRoot = fileURLToPath(new URL('../web/', import.meta.url))
  const vite = await createViteServer({ root: webRoot, configFile: join(webRoot, 'vite.config.ts'), server: { port: 0, strictPort: false }, logLevel: 'error' })
  await vite.listen()
  const webUrl = `http://127.0.0.1:${vite.httpServer.address().port}`
  const browser = await launchGoogleChrome()
  t.after(async () => {
    releases.forEach(resolve => resolve()); await browser.close(); await vite.close()
    runner.closeAllConnections(); await new Promise(resolve => runner.close(resolve))
    await rm(directory, { recursive: true, force: true })
  })
  const context = await browser.newContext()
  await context.route('http://127.0.0.1:4310/**', async route => {
    const upstream = await route.fetch({ url: runnerUrl + new URL(route.request().url()).pathname,
      headers: { ...route.request().headers(), origin: 'http://127.0.0.1:5174' } })
    await route.fulfill({ response: upstream, headers: { ...upstream.headers(), 'access-control-allow-origin': webUrl } })
  })
  await context.addInitScript(({ timestamp, codes }) => {
    if (!location.protocol.startsWith('http')) return
    sessionStorage.setItem('autotest.session.v1', JSON.stringify({ token: 'fixture', expiresAt: Date.now() + 120000, user: { id: 'fixture', username: 'fixture' } }))
    if (localStorage.getItem('autotest.environments.v7')) return
    localStorage.setItem('autotest.environments.v7', JSON.stringify(codes.map((code, index) => ({ id: `env-${code}`, name: code, code, description: '',
      enabled: true, active: index === 0, baseUrl: `https://${code.toLowerCase()}.example.test`, apiBaseUrl: `https://${code.toLowerCase()}.example.test/api`, updatedAt: timestamp,
      variables: [], auth: { strategy: 'api-login', mode: 'mobile-code', method: 'POST', timeoutMs: 1000, loginPath: '/login', requestBody: '{}',
        username: '', password: '', mobile: '', verifyCode: '', successPath: 'code', successValue: '0', tokenPath: 'data.token', tokenVariable: 'AUTH_TOKEN', tokenTypePath: 'data.type', tokenTypeFallback: 'Bearer' } }))))
    localStorage.setItem('autotest.automation-pipelines.v1', JSON.stringify([{ id: 'shared-config', name: '共享脚本回归', description: '', createdAt: timestamp, updatedAt: timestamp,
      steps: ['first', 'second'].map(scriptId => ({ scriptId, parameterMappings: [] })) }]))
  }, { timestamp, codes })
  let page = await context.newPage()
  const errors = []; context.on('page', page => page.on('pageerror', error => errors.push(error.message)))
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(webUrl + '/automations')
  for (const code of codes) {
    await page.locator('.environment-select').click()
    await page.getByRole('option', { name: `${code} · ${code}`, exact: true }).click()
    await expect(page.getByRole('button', { name: '运行自动化配置', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: '运行自动化配置', exact: true }).click()
    await expect.poll(() => releases.has(code)).toBe(true)
  }
  await expect(page.getByLabel('后台运行批次').locator('.active-execution')).toHaveCount(3)
  await page.reload()
  await expect(page.getByLabel('后台运行批次').locator('.active-execution')).toHaveCount(3)
  await page.close(); page = await context.newPage(); await page.goto(webUrl + '/scripts')
  const firstRow = page.getByRole('row').filter({ has: page.getByText('first', { exact: true }) })
  await expect(firstRow.getByRole('button', { name: '强制停止脚本', exact: true })).toBeEnabled()
  await firstRow.getByRole('button', { name: '查看运行日志', exact: true }).click()
  let picker = page.getByRole('dialog', { name: '选择要查看的环境结果' })
  await picker.getByRole('row').filter({ hasText: 'HK_PROD' }).getByRole('button', { name: '查看日志' }).click()
  const logs = page.getByRole('dialog').filter({ hasText: '仅属于 HK_PROD 的运行日志' })
  await expect(logs).toBeVisible(); await expect(logs.getByText('仅属于 TEST 的运行日志')).toHaveCount(0)
  await logs.getByRole('button', { name: '关闭', exact: true }).click()
  await firstRow.getByRole('button', { name: '强制停止脚本', exact: true }).click()
  picker = page.getByRole('dialog', { name: '选择要停止的批次' })
  await picker.getByRole('row').filter({ hasText: 'CN_PROD' }).getByRole('button', { name: '停止此批次' }).click()
  await page.getByRole('button', { name: '强制停止', exact: true }).click()
  const forEnvironment = async code => (await records.list()).find(record => record.environment.code === code)
  await expect.poll(async () => (await forEnvironment('CN_PROD'))?.status).toBe('interrupted')
  assert.equal((await forEnvironment('TEST')).status, 'running'); assert.equal((await forEnvironment('HK_PROD')).status, 'running')
  await page.goto(webUrl + '/automations')
  await page.getByLabel('后台运行批次').locator('.active-execution').filter({ hasText: 'TEST' }).getByRole('button', { name: '停止此批次' }).click()
  await page.getByRole('button', { name: '强制停止', exact: true }).click()
  await expect.poll(async () => (await forEnvironment('TEST'))?.status).toBe('interrupted')
  releases.get('HK_PROD')()
  await expect.poll(async () => (await forEnvironment('HK_PROD'))?.status).toBe('passed')
  assert.deepEqual(calls.filter(value => value.startsWith('HK_PROD:')), ['HK_PROD:first', 'HK_PROD:second'])
  assert.equal(calls.filter(value => value.startsWith('TEST:')).length, 1)
  assert.equal(calls.filter(value => value.startsWith('CN_PROD:')).length, 1)
  await expect(page.getByLabel('后台运行批次')).toHaveCount(0)
  assert.deepEqual(errors, [])
})
