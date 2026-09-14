// @vitest-environment jsdom
import { createApp, h, nextTick, ref, type App } from 'vue'
import ElementPlus from 'element-plus'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalEnvironmentSessionService } from '@/services/environments/local-environment-session.service'
import { ElMessage } from 'element-plus'
import { defaultSessionCheck } from '@/domain/environment'
import { LocalEnvironmentService } from '@/services/environments/local-environment.service'

vi.mock('@/services/container', () => ({ services: {
  environmentSessions: new LocalEnvironmentSessionService(window.localStorage),
  environments: new LocalEnvironmentService(window.localStorage),
  environmentLogin: { login: vi.fn() },
} }))
import { services } from '@/services/container'
import EnvironmentManagementView from '@/views/EnvironmentManagementView.vue'
import EnvironmentEditorDialog from './EnvironmentEditorDialog.vue'
import EnvironmentSessionDialog from './EnvironmentSessionDialog.vue'

let app: App | undefined
async function settle() {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 50))
  await nextTick()
}

afterEach(() => {
  app?.unmount()
  document.body.innerHTML = ''
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('environment authentication dialogs', () => {
  it('opens the configuration dialog from the environment management page', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    app = createApp(EnvironmentManagementView)
    app.use(ElementPlus).mount(root)
    await settle()
    const create = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('新增环境'))!
    create.click()
    await settle()
    expect(document.querySelector('[role="dialog"][aria-label="新增环境"]')?.textContent).toContain('认证方式')
  })

  it('opens the editor and preserves original login settings when reuse is selected', async () => {
    const env = (await new LocalEnvironmentService(localStorage).list())[0]!
    env.auth.strategy = 'reuse-session'
    const visible = ref(false)
    const save = vi.fn()
    const root = document.createElement('div')
    document.body.append(root)
    app = createApp({ render: () => h(EnvironmentEditorDialog, { modelValue: visible.value, environment: env, onSave: save }) })
    app.use(ElementPlus).mount(root)
    visible.value = true
    await settle()
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('认证方式')
    expect(dialog.textContent).toContain('复用已有登录态')
    expect(dialog.textContent).not.toContain('登录接口路径')
    expect(dialog.textContent).toContain('登录态校验')
    const manage = [...dialog.querySelectorAll('button')].find((button) => button.textContent?.includes('配置／更新 Token'))!
    const success = vi.spyOn(ElMessage, 'success')
    const update = vi.spyOn(services.environments, 'update')
    manage.click()
    await settle()
    expect(save).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(success).not.toHaveBeenCalled()
    const tokenDialog = document.querySelector('[role="dialog"][aria-label="管理登录态 · 测试环境"]')!
    expect(tokenDialog).not.toBeNull()
    const tokenInput = tokenDialog.querySelector<HTMLInputElement>('[aria-label="已有登录态 Token"]')!
    tokenInput.value = 'Bearer updated-token'
    tokenInput.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    ;[...tokenDialog.querySelectorAll('button')].find((button) => button.textContent?.includes('保存登录态'))!.click()
    await settle()
    expect(success).toHaveBeenCalledOnce()
    expect(services.environmentSessions.get(env)?.token).toBe('updated-token')
    expect(save).not.toHaveBeenCalled()
    const button = [...dialog.querySelectorAll('button')].find((button) => button.textContent?.includes('保存环境'))!
    button.click()
    await settle()
    expect(save).toHaveBeenCalledOnce()
    expect(save.mock.calls[0]![0].auth).toEqual({ ...env.auth, sessionCheck: defaultSessionCheck() })
  })

  it('tests a reused session from the list and shows validation results without token extraction', async () => {
    const env = (await services.environments.list())[0]!
    env.auth.strategy = 'reuse-session'
    env.auth.sessionCheck = { ...defaultSessionCheck(), path: '/user/info' }
    await services.environments.update(env.id, env)
    services.environmentSessions.save(env, { token: 'Bearer current-token', accountLabel: '' })
    const login = vi.mocked(services.environmentLogin.login)
    login.mockResolvedValue({ businessSuccess: true, ok: true, status: 200, statusText: 'OK',
      targetUrl: 'https://example.test/user/info', durationMs: 2, receivedAt: '', requestBody: {},
      responseBody: { code: 0 }, rawResponse: '{"code":0}', responseHeaders: {} })
    const root = document.createElement('div')
    document.body.append(root)
    app = createApp(EnvironmentManagementView)
    app.use(ElementPlus).mount(root)
    await settle()
    expect(document.querySelector('button[aria-label="管理登录态"]')).toBeNull()
    document.querySelector<HTMLButtonElement>('button[aria-label="测试环境登录"]')!.click()
    await settle()
    expect(login).toHaveBeenCalledWith(expect.objectContaining({ id: env.id }), expect.objectContaining({ token: 'current-token' }))
    expect(document.body.textContent).toContain('当前登录态有效')
    expect(document.querySelector('.variable-extractor')).toBeNull()
    expect(document.querySelector('.environment-session-dialog')).toBeNull()
  })

  it('imports, restores the saved token as editable plain text, and clears a session', async () => {
    const env = (await new LocalEnvironmentService(localStorage).list())[0]!
    const visible = ref(true)
    const changed = vi.fn()
    const root = document.createElement('div')
    document.body.append(root)
    app = createApp({ render: () => h(EnvironmentSessionDialog, {
      modelValue: visible.value, environment: env, onChanged: changed,
      'onUpdate:modelValue': (value: boolean) => { visible.value = value },
    }) })
    app.use(ElementPlus).mount(root)
    await settle()
    const input = document.querySelector<HTMLInputElement>('[aria-label="已有登录态 Token"]')!
    expect(input.type).toBe('text')
    input.value = 'Bearer ui-test-token'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    const save = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('保存登录态'))!
    save.click()
    await settle()
    expect(changed).toHaveBeenCalledOnce()
    expect(new LocalEnvironmentSessionService(localStorage).get(env)?.token).toBe('ui-test-token')
    visible.value = true
    await settle()
    const restored = document.querySelector<HTMLInputElement>('[aria-label="已有登录态 Token"]')!
    expect(restored.type).toBe('text')
    expect(restored.value).toBe('Bearer ui-test-token')
    const clear = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('清除登录态'))!
    clear.click()
    await settle()
    expect(new LocalEnvironmentSessionService(localStorage).get(env)).toBeNull()
  })
})
