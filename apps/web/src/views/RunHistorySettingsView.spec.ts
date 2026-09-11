// @vitest-environment jsdom
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/services/container', () => ({ services: { environments: { list: mocks.list } } }))
import RunHistorySettingsView from './RunHistorySettingsView.vue'
import { readRunHistoryTabs } from '@/services/run-records/run-history-tabs'

const apps: App[] = []
const Button = defineComponent({
  props: { disabled: Boolean, icon: {} },
  emits: ['click'],
  setup(props, { slots, emit }) {
    return () => h('button', { disabled: props.disabled, onClick: () => emit('click') }, slots.default?.())
  },
})
const Select = defineComponent({
  props: ['modelValue'], emits: ['update:modelValue'],
  setup(props, { slots, emit }) {
    return () => h('select', { value: props.modelValue, onChange: (event: Event) => emit('update:modelValue', (event.target as HTMLSelectElement).value) }, slots.default?.())
  },
})
const Option = defineComponent({
  props: ['value', 'label'], setup: (props) => () => h('option', { value: props.value }, props.label),
})
async function flush() { await Promise.resolve(); await Promise.resolve(); await nextTick() }
async function mount() {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(RunHistorySettingsView)
  app.config.warnHandler = () => undefined
  app.component('el-button', Button)
  app.component('el-select', Select)
  app.component('el-option', Option)
  app.directive('loading', () => undefined)
  app.mount(root)
  apps.push(app)
  await flush()
  return root
}
beforeEach(() => {
  localStorage.clear()
  mocks.list.mockResolvedValue([
    { id: 'test', name: '测试环境', code: 'TEST' },
    { id: 'stage', name: '预发环境', code: 'STAGE' },
  ])
})
afterEach(() => { apps.splice(0).forEach((app) => app.unmount()); document.body.replaceChildren() })
it('reorders, removes and re-adds environments, then restores the saved selection on remount', async () => {
  const root = await mount()
  const order = () => [...root.querySelectorAll('[data-environment-id]')].map((row) => row.getAttribute('data-environment-id'))
  const click = async (label: string) => {
    root.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click()
    await nextTick()
  }
  await click('上移 预发环境')
  expect(order()).toEqual(['stage', 'test'])
  await click('移除 测试环境')
  expect(order()).toEqual(['stage'])
  const select = root.querySelector('select')!
  select.value = 'test'
  select.dispatchEvent(new Event('change'))
  await nextTick()
  const button = (text: string) => [...root.querySelectorAll('button')].find((item) => item.textContent === text)!
  button('添加 Tab').click()
  await nextTick()
  expect(order()).toEqual(['stage', 'test'])
  expect(readRunHistoryTabs()).toBeNull()
  button('保存配置').click()
  await nextTick()
  expect(readRunHistoryTabs()).toEqual(['stage', 'test'])
  await click('移除 预发环境')
  button('撤销更改').click()
  await nextTick()
  expect(order()).toEqual(['stage', 'test'])
  const restored = await mount()
  expect([...restored.querySelectorAll('[data-environment-id]')].map((row) => row.getAttribute('data-environment-id'))).toEqual(['stage', 'test'])
})
