// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardSnapshot } from '@/domain/dashboard'

const serviceMocks = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/services/container', () => ({
  services: { dashboard: { getSnapshot: serviceMocks.getSnapshot } },
}))
vi.mock('element-plus', () => ({
  ElMessage: { success: serviceMocks.success, warning: serviceMocks.warning, error: serviceMocks.error },
}))
vi.mock('@/components/TrendChart.vue', () => ({ default: { render: () => null } }))

import DashboardView from './DashboardView.vue'

const mountedApps: App[] = []

function snapshot(offline = false): DashboardSnapshot {
  return {
    unavailableSources: offline ? ['scripts', 'runRecords'] : [],
    metrics: [{
      id: 'scripts', label: '自动化脚本', value: offline ? null : 7,
      delta: offline ? '脚本配置加载失败' : '7 个已启用', tone: 'cyan',
    }],
    trend: [],
    recentRuns: [],
    runner: {
      status: offline ? 'offline' : 'online', browser: null,
      activeEnvironment: '测试环境', endpoint: 'http://127.0.0.1:4310/health',
    },
  }
}

async function flushView(): Promise<void> {
  await Promise.resolve()
  await nextTick()
}

async function mountView() {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(DashboardView)
  app.config.warnHandler = () => undefined
  app.component('el-button', defineComponent({
    props: { loading: Boolean },
    emits: ['click'],
    setup(props, { emit, slots }) {
      return () => h('button', { disabled: props.loading, onClick: () => emit('click') }, slots.default?.())
    },
  }))
  app.component('el-alert', defineComponent({
    props: { title: String },
    setup(props) { return () => h('div', { role: 'alert' }, props.title) },
  }))
  app.component('el-empty', defineComponent({
    props: { description: String },
    setup(props) { return () => h('div', { class: 'empty-state' }, props.description) },
  }))
  app.component('el-table', defineComponent({
    props: { emptyText: String },
    setup(props) { return () => h('div', { class: 'table-empty-state' }, props.emptyText) },
  }))
  app.component('el-icon', defineComponent({
    setup(_, { slots }) { return () => h('span', slots.default?.()) },
  }))
  app.mount(root)
  mountedApps.push(app)
  await flushView()
  return root
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.replaceChildren()
})

describe('DashboardView', () => {
  it('shows an offline node on first load and distinguishes unavailable records from empty history', async () => {
    serviceMocks.getSnapshot.mockResolvedValue(snapshot(true))
    const root = await mountView()

    expect(root.querySelector('.runner-state')?.textContent).toBe('离线')
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('脚本配置、运行记录加载失败')
    expect(root.querySelector('.metric-card__value')?.textContent).toBe('暂无数据')
    expect(root.querySelector('.metric-card__delta')?.textContent).toBe('脚本配置加载失败')
    expect(root.querySelector('.trend-panel .empty-state')?.textContent).toBe('运行记录加载失败，请重试')
    expect(root.querySelector('.table-empty-state')?.textContent).toBe('运行记录加载失败，请重试')
  })

  it('replaces a stale online snapshot after disconnection and only confirms a fully successful refresh', async () => {
    serviceMocks.getSnapshot.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot(true))
    const root = await mountView()
    expect(root.querySelector('.runner-state')?.textContent).toBe('在线')
    expect(root.querySelector('.metric-card__value')?.textContent).toBe('7')

    root.querySelector<HTMLButtonElement>('button')!.click()
    await flushView()

    expect(root.querySelector('.runner-state')?.textContent).toBe('离线')
    expect(root.querySelector('.metric-card__value')?.textContent).toBe('暂无数据')
    expect(serviceMocks.warning).toHaveBeenCalledWith(expect.stringContaining('加载失败'))
    expect(serviceMocks.success).not.toHaveBeenCalled()

    serviceMocks.getSnapshot.mockResolvedValue(snapshot())
    root.querySelector<HTMLButtonElement>('button')!.click()
    await flushView()

    expect(root.querySelector('.runner-state')?.textContent).toBe('在线')
    expect(root.querySelector('[role="alert"]')).toBeNull()
    expect(root.querySelector('.metric-card__value')?.textContent).toBe('7')
    expect(serviceMocks.success).toHaveBeenCalledWith('数据已刷新')
  })

  it('does not retain an old online snapshot when an unexpected snapshot error occurs', async () => {
    serviceMocks.getSnapshot.mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new Error('invalid response'))
    const root = await mountView()

    root.querySelector<HTMLButtonElement>('button')!.click()
    await flushView()

    expect(root.querySelector('.runner-state')).toBeNull()
    expect(root.querySelector('.empty-state')?.textContent).toBe('主页数据加载失败，请重试')
    expect(serviceMocks.error).toHaveBeenCalledWith('主页数据加载失败')
    expect(serviceMocks.success).not.toHaveBeenCalled()
  })
})
