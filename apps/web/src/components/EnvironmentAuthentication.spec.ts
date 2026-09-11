// @vitest-environment jsdom
import { createApp, h, nextTick, ref, type App } from 'vue'
import ElementPlus from 'element-plus'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalEnvironmentSessionService } from '@/services/environments/local-environment-session.service'
import { LocalEnvironmentService } from '@/services/environments/local-environment.service'

vi.mock('@/services/container', () => ({ services: {
  environmentSessions: new LocalEnvironmentSessionService(window.localStorage),
  environments: new LocalEnvironmentService(window.localStorage),
} }))
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
    expect(dialog.textContent).not.toContain('请求体（JSON）')
    const manage = [...dialog.querySelectorAll('button')].find((button) => button.textContent?.includes('配置／更新 Token'))!
    manage.click()
    await settle()
    expect(save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ auth: env.auth }), true)
    save.mockClear()
    const button = [...dialog.querySelectorAll('button')].find((button) => button.textContent?.includes('保存环境'))!
    button.click()
    await settle()
    expect(save).toHaveBeenCalledOnce()
    expect(save.mock.calls[0]![0].auth).toEqual(env.auth)
    expect(save.mock.calls[0]![1]).toBe(false)
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
