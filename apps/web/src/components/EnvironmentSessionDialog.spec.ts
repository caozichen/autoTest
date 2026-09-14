// @vitest-environment jsdom
import { createApp, h, nextTick, ref, type App } from 'vue'
import ElementPlus from 'element-plus'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalEnvironmentSessionService } from '@/services/environments/local-environment-session.service'
import { LocalEnvironmentService } from '@/services/environments/local-environment.service'
import type { TestEnvironment } from '@/domain/environment'

vi.mock('@/services/container', () => ({ services: {
  environmentSessions: new LocalEnvironmentSessionService(window.localStorage, () => Date.UTC(2029, 0, 1)),
} }))
import { services } from '@/services/container'
import EnvironmentSessionDialog from './EnvironmentSessionDialog.vue'

let app: App | undefined

async function settle(): Promise<void> {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 50))
  await nextTick()
}

async function openDialog(environment: TestEnvironment): Promise<void> {
  const visible = ref(true)
  const root = document.createElement('div')
  document.body.append(root)
  app = createApp({ render: () => h(EnvironmentSessionDialog, {
    modelValue: visible.value,
    environment,
    'onUpdate:modelValue': (value: boolean) => { visible.value = value },
  }) })
  app.use(ElementPlus).mount(root)
  await settle()
}

function expiryInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('[aria-label="失效时间"]')!
}

async function saveDialog(): Promise<void> {
  const button = [...document.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.includes('保存登录态'))!
  button.click()
  await settle()
}

afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ''
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('saved session expiry editing', () => {
  it.each([false, true])('preserves the local expiry and milliseconds when editing the account label: %s', async (editLabel) => {
    const environment = (await new LocalEnvironmentService(localStorage).list())[0]!
    const expiresAt = new Date(2030, 0, 2, 13, 14, 15, 678).getTime()
    services.environmentSessions.save(environment, { token: 'opaque-token', accountLabel: 'original', expiresAt })

    await openDialog(environment)
    expect(expiryInput().value).toBe('2030-01-02T13:14:15.678')
    expect(expiryInput().validity.valid).toBe(true)
    if (editLabel) {
      const label = document.querySelector<HTMLInputElement>('input[placeholder="例如：生产测试账号"]')!
      label.value = 'updated'
      label.dispatchEvent(new Event('input', { bubbles: true }))
      await settle()
    }
    await saveDialog()

    expect(services.environmentSessions.get(environment)).toMatchObject({
      expiresAt,
      accountLabel: editLabel ? 'updated' : 'original',
    })
  })

  it('keeps an unchanged timestamp during an ambiguous daylight-saving hour', async () => {
    const environment = (await new LocalEnvironmentService(localStorage).list())[0]!
    const expiresAt = Date.parse('2030-11-03T06:30:15.678Z')
    services.environmentSessions.save(environment, { token: 'opaque-token', accountLabel: '', expiresAt })

    await openDialog(environment)
    await saveDialog()

    expect(services.environmentSessions.get(environment)?.expiresAt).toBe(expiresAt)
  })

  it('saves an explicitly edited expiry using local time with millisecond precision', async () => {
    const environment = (await new LocalEnvironmentService(localStorage).list())[0]!
    services.environmentSessions.save(environment, { token: 'opaque-token', accountLabel: '' })
    await openDialog(environment)
    expect(expiryInput().value).toBe('')

    const input = expiryInput()
    input.value = '2030-02-03T14:15:16.789'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    await saveDialog()

    expect(services.environmentSessions.get(environment)?.expiresAt)
      .toBe(new Date(2030, 1, 3, 14, 15, 16, 789).getTime())
  })

  it.each([false, true])('lets users clear the manual limit while retaining JWT expiry: %s', async (isJwt) => {
    const environment = (await new LocalEnvironmentService(localStorage).list())[0]!
    const jwtExpiresAt = Date.UTC(2031, 0, 1)
    const token = isJwt
      ? `header.${btoa(JSON.stringify({ exp: jwtExpiresAt / 1000 }))}.signature`
      : 'opaque-token'
    services.environmentSessions.save(environment, {
      token,
      accountLabel: '',
      expiresAt: Date.UTC(2030, 0, 1),
    })
    await openDialog(environment)
    expect(expiryInput().value).not.toBe('')

    const input = expiryInput()
    input.value = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    await saveDialog()

    expect(services.environmentSessions.get(environment)?.expiresAt).toBe(isJwt ? jwtExpiresAt : null)
  })
})
