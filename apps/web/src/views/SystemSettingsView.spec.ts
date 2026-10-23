// @vitest-environment jsdom
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getStatus: vi.fn(), getResources: vi.fn(), start: vi.fn() }))
vi.mock('@/services/container', () => ({ services: { runnerControl: mocks } }))
vi.mock('element-plus', () => ({ ElMessage: { success: vi.fn(), error: vi.fn() } }))
import SystemSettingsView from './SystemSettingsView.vue'

const snapshot = () => ({ schemaVersion: 1, sampledAt: '2026-10-22T12:00:00.000Z', collectionDurationMs: 2.5,
  groups: [
    { id: 'process', title: 'Runner 进程', description: '仅 Node 进程', unavailableReason: null,
      metrics: [{ id: 'rss', label: '常驻内存 RSS', value: 1048576, unit: 'bytes' }, { id: 'unsupported', label: '不可用指标', value: null, unit: 'count', note: '当前平台不支持' }] },
    { id: 'disk', title: '磁盘', description: '容量', metrics: [], unavailableReason: '当前运行环境无法采集此组指标' },
  ] })
let app: App | null = null
async function flush() { for (let i = 0; i < 8; i++) { await Promise.resolve(); await nextTick() } }
async function mount() {
  const root = document.createElement('div'); document.body.append(root)
  app = createApp(SystemSettingsView)
  app.component('el-button', defineComponent({ props: { loading: Boolean, disabled: Boolean }, emits: ['click'],
    setup(props, { slots, emit }) { return () => h('button', { disabled: props.loading || props.disabled, onClick: () => emit('click') }, slots.default?.()) } }))
  app.component('el-icon', defineComponent({ setup(_, { slots }) { return () => h('span', slots.default?.()) } }))
  app.mount(root); await flush(); return root
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks()
  mocks.getStatus.mockResolvedValue({ status: 'online', endpoint: 'http://127.0.0.1:4310/health', checkedAt: '2026-10-22T12:00:00Z' })
  mocks.getResources.mockResolvedValue(snapshot())
})
afterEach(() => { app?.unmount(); app = null; document.body.replaceChildren(); vi.useRealTimers() })

describe('Runner resource management', () => {
  it('loads once, has no polling, and samples health/resources again only on manual refresh', async () => {
    const root = await mount()
    expect(root.textContent).toContain('1 MiB')
    expect(root.textContent).toContain('当前平台不支持')
    expect(root.textContent).toContain('不可用：当前运行环境无法采集此组指标')
    expect(root.textContent).toContain('2026-10-22')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mocks.getStatus).toHaveBeenCalledTimes(1)
    expect(mocks.getResources).toHaveBeenCalledTimes(1)
    const button = Array.from(root.querySelectorAll('button')).find(button => button.textContent === '手动刷新')!
    button.click(); await flush()
    expect(mocks.getStatus).toHaveBeenCalledTimes(2)
    expect(mocks.getResources).toHaveBeenCalledTimes(2)
  })
  it('marks failed refreshes stale, shows offline health, and recovers on the next manual refresh', async () => {
    const root = await mount()
    mocks.getStatus.mockResolvedValue({ status: 'offline', endpoint: '/health', checkedAt: '2026-10-22T12:01:00Z' })
    mocks.getResources.mockRejectedValueOnce(new Error('无法连接 Runner，资源数据不可用'))
    const button = Array.from(root.querySelectorAll('button')).find(button => button.textContent === '手动刷新')!
    button.click(); await flush()
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('不代表当前状态')
    expect(root.textContent).toContain('上次成功快照（已过期）')
    expect(root.textContent).toContain('离线')
    expect(root.textContent).toContain('1 MiB')
    button.click(); await flush()
    expect(root.querySelector('[role="alert"]')).toBeNull()
    expect(root.textContent).toContain('本次采样快照')
  })
  it('distinguishes first-load failure from zero usage and prevents overlapping refreshes', async () => {
    let reject!: (error: Error) => void
    mocks.getResources.mockReturnValueOnce(new Promise((_, failure) => { reject = failure }))
    const root = await mount()
    const button = Array.from(root.querySelectorAll('button')).find(button => button.textContent === '正在采集')!
    expect(button.disabled).toBe(true); button.click()
    expect(mocks.getResources).toHaveBeenCalledTimes(1)
    reject(new Error('资源采集超时')); await flush()
    expect(root.textContent).toContain('尚无可用资源快照')
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('资源采集超时')
    expect(root.querySelector('.resource-groups')).toBeNull()
  })
})
