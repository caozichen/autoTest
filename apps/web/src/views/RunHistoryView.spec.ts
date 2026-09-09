// @vitest-environment jsdom

import {
  computed,
  createApp,
  defineComponent,
  h,
  inject,
  nextTick,
  provide,
  type App,
  type ComputedRef,
  type PropType,
} from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const serviceMocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  stopByRecordId: vi.fn(),
}))

vi.mock('@/services/container', () => ({
  services: {
    runRecords: {
      list: serviceMocks.list,
      get: serviceMocks.get,
    },
    automationPipelineExecution: {
      stopByRecordId: serviceMocks.stopByRecordId,
    },
  },
}))

vi.mock('@/components/RunRecordDetailDrawer.vue', () => ({
  default: { name: 'RunRecordDetailDrawerStub', render: () => null },
}))

import type { RunRecord, RunRecordCounts, RunRecordStatus } from '@/domain/run-record'
import RunHistoryView from './RunHistoryView.vue'

const mountedApps: App[] = []
const tableDataKey = Symbol('run-history-table-data')

const ButtonStub = defineComponent({
  inheritAttrs: false,
  props: {
    disabled: Boolean,
    loading: Boolean,
    icon: { type: [Object, Function] as PropType<unknown> },
  },
  emits: ['click'],
  setup(props, { attrs, emit, slots }) {
    return () => h('button', {
      ...attrs,
      disabled: props.disabled || props.loading,
      onClick: (event: MouseEvent) => emit('click', event),
    }, slots.default?.())
  },
})

const InputStub = defineComponent({
  inheritAttrs: false,
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue'],
  setup(props, { attrs, emit }) {
    return () => h('input', {
      ...attrs,
      value: props.modelValue,
      onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value),
    })
  },
})

const SelectStub = defineComponent({
  inheritAttrs: false,
  props: { modelValue: { type: String, required: true } },
  emits: ['update:modelValue'],
  setup(props, { attrs, emit, slots }) {
    return () => h('select', {
      ...attrs,
      value: props.modelValue,
      onChange: (event: Event) => emit('update:modelValue', (event.target as HTMLSelectElement).value),
    }, slots.default?.())
  },
})

const OptionStub = defineComponent({
  props: {
    label: { type: String, required: true },
    value: { type: String, required: true },
  },
  setup(props) {
    return () => h('option', { value: props.value }, props.label)
  },
})

const TableStub = defineComponent({
  inheritAttrs: false,
  props: { data: { type: Array as PropType<RunRecord[]>, default: () => [] } },
  setup(props, { attrs, slots }) {
    provide(tableDataKey, computed(() => props.data))
    return () => h('div', { ...attrs, 'data-testid': 'record-table' }, slots.default?.())
  },
})

const TableColumnStub = defineComponent({
  props: {
    label: { type: String, default: '' },
    prop: { type: String, default: '' },
    fixed: { type: [Boolean, String], default: false },
    width: { type: [Number, String], default: undefined },
    minWidth: { type: [Number, String], default: undefined },
  },
  setup(props, { slots }) {
    const rows = inject<ComputedRef<RunRecord[]>>(tableDataKey)
    return () => h('section', { 'data-label': props.label }, rows?.value.map((row) => (
      h('div', { 'data-row-id': row.id }, slots.default?.({ row }))
    )))
  },
})

const PaginationStub = defineComponent({
  props: {
    currentPage: { type: Number, required: true },
    pageSize: { type: Number, required: true },
    total: { type: Number, required: true },
  },
  emits: ['update:currentPage'],
  setup(props, { emit }) {
    return () => h('div', {
      'data-testid': 'pagination',
      'data-page': String(props.currentPage),
      'data-total': String(props.total),
    }, [
      h('button', { 'data-testid': 'page-2', onClick: () => emit('update:currentPage', 2) }, '2'),
    ])
  },
})

const PassThroughStub = defineComponent({
  setup(_, { slots }) {
    return () => h('span', slots.default?.())
  },
})

function counts(overrides: Partial<RunRecordCounts> = {}): RunRecordCounts {
  return { total: 1, passed: 0, partial: 0, failed: 0, skipped: 0, ...overrides }
}

function runRecord(
  id: string,
  status: RunRecordStatus,
  options: {
    counts?: RunRecordCounts
    environmentId?: string
    name?: string
  } = {},
): RunRecord {
  return {
    schemaVersion: 1,
    revision: 1,
    id,
    displayId: `RUN-${id.toUpperCase()}`,
    name: options.name ?? `${status} batch`,
    status,
    trigger: 'manual',
    browser: 'Chromium',
    environment: {
      id: options.environmentId ?? 'environment-one',
      name: options.environmentId === 'environment-two' ? '预发环境' : '测试环境',
      code: options.environmentId === 'environment-two' ? 'STAGING' : 'TEST',
      apiBaseUrl: 'https://api.example.test',
    },
    startedAt: '2026-09-08T08:00:00.000Z',
    updatedAt: '2026-09-08T08:01:00.000Z',
    finishedAt: status === 'running' ? null : '2026-09-08T08:01:00.000Z',
    durationMs: status === 'running' ? null : 60_000,
    counts: options.counts ?? counts({
      passed: status === 'passed' ? 1 : 0,
      partial: status === 'partial' ? 1 : 0,
      failed: status === 'failed' ? 1 : 0,
    }),
    scripts: [],
    logs: [],
    analysis: {
      passRate: status === 'passed' ? 100 : 0,
      averageDurationMs: 60_000,
      slowestScriptRecordId: null,
      logCounts: { info: 0, success: 0, warning: 0, error: 0 },
      failureGroups: [],
    },
  }
}

async function flushView(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

async function mountView(fixture: RunRecord[]) {
  serviceMocks.list.mockResolvedValue(fixture)
  serviceMocks.get.mockResolvedValue(null)
  serviceMocks.stopByRecordId.mockResolvedValue({ stopped: false })

  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(RunHistoryView)
  app.config.warnHandler = () => undefined
  app.component('el-button', ButtonStub)
  app.component('el-input', InputStub)
  app.component('el-select', SelectStub)
  app.component('el-option', OptionStub)
  app.component('el-table', TableStub)
  app.component('el-table-column', TableColumnStub)
  app.component('el-pagination', PaginationStub)
  app.component('el-icon', PassThroughStub)
  app.component('el-tag', PassThroughStub)
  app.component('el-tooltip', PassThroughStub)
  app.directive('loading', () => undefined)
  app.mount(root)
  mountedApps.push(app)
  await flushView()
  return root
}

function changeValue(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  element.value = value
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.replaceChildren()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('RunHistoryView', () => {
  it('shows the five summary metrics and filters from each outcome metric', async () => {
    const root = await mountView([
      runRecord('passed', 'passed'),
      runRecord('partial', 'partial'),
      runRecord('failed', 'failed'),
      runRecord('running', 'running'),
      runRecord('interrupted', 'interrupted'),
    ])

    const metricStrip = root.querySelector<HTMLElement>('.metric-strip')
    expect(metricStrip?.textContent).toContain('运行批次5')
    expect(metricStrip?.textContent).toContain('累计脚本5')
    expect(metricStrip?.textContent).toContain('全部通过1')
    expect(metricStrip?.textContent).toContain('部分通过1')
    expect(metricStrip?.textContent).toContain('执行失败1')
    expect(metricStrip?.textContent).not.toContain('需关注')

    const outcomeMetrics = [...root.querySelectorAll<HTMLButtonElement>('.metric-strip__item--interactive')]
    const statusSelect = root.querySelector<HTMLSelectElement>('[aria-label="筛选运行状态"]')
    const partialMetric = outcomeMetrics
      .find((button) => button.textContent?.includes('部分通过'))
    expect(statusSelect?.value).toBe('all')
    expect(outcomeMetrics.every((button) => button.getAttribute('aria-pressed') === 'false')).toBe(true)
    expect(outcomeMetrics.every((button) => !button.classList.contains('is-active'))).toBe(true)
    expect(root.querySelector('.toolbar__result')?.textContent).toBe('5 个批次')

    partialMetric?.click()
    await nextTick()

    expect(statusSelect?.value).toBe('partial')
    expect(partialMetric?.classList.contains('is-active')).toBe(true)
    expect(partialMetric?.getAttribute('aria-pressed')).toBe('true')
    expect(root.querySelector('.toolbar__result')?.textContent).toBe('1 个批次')

    partialMetric?.click()
    await nextTick()

    expect(statusSelect?.value).toBe('all')
    expect(partialMetric?.classList.contains('is-active')).toBe(false)
    expect(partialMetric?.getAttribute('aria-pressed')).toBe('false')
    expect(root.querySelector('.toolbar__result')?.textContent).toBe('5 个批次')

    partialMetric?.click()
    await nextTick()
    const failedMetric = outcomeMetrics
      .find((button) => button.textContent?.includes('执行失败'))
    failedMetric?.click()
    await nextTick()

    expect(statusSelect?.value).toBe('failed')
    expect(failedMetric?.getAttribute('aria-pressed')).toBe('true')
    expect(partialMetric?.getAttribute('aria-pressed')).toBe('false')

    failedMetric?.click()
    await nextTick()

    expect(statusSelect?.value).toBe('all')
    expect(failedMetric?.classList.contains('is-active')).toBe(false)
    expect(failedMetric?.getAttribute('aria-pressed')).toBe('false')
    expect(root.querySelector('.toolbar__result')?.textContent).toBe('5 个批次')
  })

  it('resets keyword, status, environment and pagination together', async () => {
    const records = Array.from({ length: 10 }, (_, index) => runRecord(
      `failed-${index}`,
      'failed',
      {
        environmentId: index % 2 ? 'environment-two' : 'environment-one',
        name: `failure batch ${index}`,
      },
    ))
    const root = await mountView(records)
    const keywordInput = root.querySelector<HTMLInputElement>('[aria-label="搜索运行记录"]')!
    const statusSelect = root.querySelector<HTMLSelectElement>('[aria-label="筛选运行状态"]')!
    const environmentSelect = root.querySelector<HTMLSelectElement>('[aria-label="筛选运行环境"]')!

    changeValue(keywordInput, 'failure')
    changeValue(statusSelect, 'failed')
    changeValue(environmentSelect, 'environment-two')
    await nextTick()
    root.querySelector<HTMLButtonElement>('[data-testid="page-2"]')?.click()
    await nextTick()
    expect(root.querySelector('[data-testid="pagination"]')?.getAttribute('data-page')).toBe('2')

    const resetButton = root.querySelector<HTMLButtonElement>('[aria-label="重置筛选条件"]')!
    expect(resetButton.disabled).toBe(false)
    resetButton.click()
    await nextTick()

    expect(keywordInput.value).toBe('')
    expect(statusSelect.value).toBe('all')
    expect(environmentSelect.value).toBe('all')
    expect(root.querySelector('[data-testid="pagination"]')?.getAttribute('data-page')).toBe('1')
    expect(resetButton.disabled).toBe(true)
  })

  it('renders passed, partial, failed and skipped script outcomes in the distribution', async () => {
    const root = await mountView([
      runRecord('mixed', 'partial', {
        counts: counts({ total: 4, passed: 1, partial: 1, failed: 1, skipped: 1 }),
      }),
    ])
    const result = root.querySelector<HTMLElement>('[data-label="脚本结果"] [data-row-id="mixed"]')
    const distribution = result?.querySelector<HTMLElement>('.mini-distribution')

    expect(distribution?.getAttribute('aria-label')).toBe('通过 1，部分通过 1，执行失败 1，未执行 1，待完成 0')
    expect(distribution?.querySelector<HTMLElement>('.is-passed')?.style.flexGrow).toBe('1')
    expect(distribution?.querySelector<HTMLElement>('.is-partial')?.style.flexGrow).toBe('1')
    expect(distribution?.querySelector<HTMLElement>('.is-failed')?.style.flexGrow).toBe('1')
    expect(distribution?.querySelector<HTMLElement>('.is-skipped')?.style.flexGrow).toBe('1')
    expect(result?.textContent).toContain('部分通过 1 · 执行失败 1 · 未执行 1 · 通过率 0%')
    expect(root.querySelector('[data-label="状态"] [data-row-id="mixed"] .status-tag--partial')).not.toBeNull()
  })
})
