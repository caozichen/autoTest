// @vitest-environment jsdom

import {
  computed,
  createApp,
  defineComponent,
  h,
  inject,
  nextTick,
  provide,
  ref,
  watch,
  type App,
  type ComputedRef,
  type PropType,
  type Ref,
} from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./AssertionModuleChart.vue', () => ({
  default: { name: 'AssertionModuleChartStub', render: () => null },
}))
vi.mock('./AssertionOutcomeChart.vue', () => ({
  default: { name: 'AssertionOutcomeChartStub', render: () => null },
}))

import type { RunRecord } from '@/domain/run-record'
import type { ScriptArtifact } from '@/domain/script'
import RunRecordDetailDrawer from './RunRecordDetailDrawer.vue'

const mountedApps: App[] = []
const ACTIVE_TAB_KEY = Symbol('active-tab')

function emptyNetworkSummary() {
  return {
    api: { observed: 0, recorded: 0, dropped: 0, passed: 0, failed: 0, warnings: 0 },
    resources: { observed: 0, recorded: 0, dropped: 0, passed: 0, failed: 0, warnings: 0 },
  }
}

function runRecord(updatedAt = '2026-09-04T00:00:00.000Z'): RunRecord {
  return {
    schemaVersion: 1,
    revision: 0,
    id: 'run-record-001',
    displayId: 'RUN-20260904-000001',
    name: '自动化配置 · 创建填写',
    status: 'running',
    trigger: 'manual',
    browser: 'Chromium',
    environment: {
      id: 'environment-001',
      name: '测试环境',
      code: 'TEST',
      apiBaseUrl: 'https://api.example.test',
    },
    startedAt: '2026-09-04T00:00:00.000Z',
    updatedAt,
    finishedAt: null,
    durationMs: null,
    counts: { total: 1, passed: 0, failed: 0, skipped: 0 },
    scripts: [],
    logs: [],
    analysis: {
      passRate: 0,
      averageDurationMs: 0,
      slowestScriptRecordId: null,
      logCounts: { info: 0, success: 0, warning: 0, error: 0 },
      failureGroups: [],
    },
  }
}

function artifact(overrides: Partial<ScriptArtifact> = {}): ScriptArtifact {
  return {
    executionId: 'run-record-001',
    stepId: 'form-submit',
    attemptId: 'attempt-001',
    absolutePath: '/workspace/outputs/artifacts/run-record-001/form-submit/attempt-001/screenshots/failure.png',
    relativePath: 'screenshots/failure.png',
    type: 'screenshot',
    mimeType: 'image/png',
    sizeBytes: 1_024,
    createdAt: '2026-09-04T00:00:03.000Z',
    ...overrides,
  }
}

function screenshotRecord(updatedAt = '2026-09-04T00:00:04.000Z'): RunRecord {
  const record = runRecord(updatedAt)
  record.scripts = [
    {
      id: 'form-fill',
      recordId: 'script-record-fill',
      name: '公开表单填写',
      directory: 'scripts',
      entryFile: 'form-fill.ui.spec.mjs',
      tags: ['表单'],
      status: 'failed',
      durationMs: 3_000,
      logs: [],
      assertions: [
        {
          sequence: 1,
          timestamp: '2026-09-04T00:00:01.000Z',
          name: '页面中应显示表单名称',
          module: '公开表单契约',
          matcher: 'toBeVisible',
          status: 'failed',
          durationMs: 20,
          error: '表单名称未显示',
        },
        {
          sequence: 2,
          timestamp: '2026-09-04T00:00:02.500Z',
          name: '邮箱格式应通过边界校验',
          module: '邮箱',
          matcher: 'toBeTruthy',
          status: 'failed',
          durationMs: 12,
          error: '邮箱格式错误',
        },
      ],
      apiResponses: [],
      resourceResponses: [],
      networkSummary: emptyNetworkSummary(),
      artifacts: [
        artifact({
          stepId: 'form-fill',
          attemptId: 'attempt-fill',
          relativePath: 'screenshots/填写失败 空格.png',
          absolutePath: '/workspace/outputs/artifacts/run-record-001/form-fill/attempt-fill/screenshots/填写失败 空格.png',
        }),
        artifact({
          stepId: 'form-fill',
          attemptId: 'attempt-fill',
          relativePath: 'fixtures/input.png',
          absolutePath: '/workspace/outputs/artifacts/run-record-001/form-fill/attempt-fill/fixtures/input.png',
          type: 'fixture',
        }),
        artifact({
          stepId: 'form-fill',
          attemptId: 'attempt-fill',
          relativePath: 'screenshots/not-an-image.txt',
          absolutePath: '/workspace/outputs/artifacts/run-record-001/form-fill/attempt-fill/screenshots/not-an-image.txt',
          mimeType: 'text/plain',
        }),
        artifact({
          stepId: 'form-fill',
          attemptId: 'attempt-fill',
          relativePath: 'screenshots/unsupported.svg',
          absolutePath: '/workspace/outputs/artifacts/run-record-001/form-fill/attempt-fill/screenshots/unsupported.svg',
          mimeType: 'image/svg+xml',
        }),
      ],
      error: '邮箱格式错误',
    },
    {
      id: 'form-publish',
      recordId: 'script-record-publish',
      name: '表单发布',
      directory: 'scripts',
      entryFile: 'form-publish.ui.spec.mjs',
      tags: ['发布'],
      status: 'failed',
      durationMs: 2_000,
      logs: [],
      assertions: [{
        sequence: 1,
        timestamp: '2026-09-04T00:00:01.000Z',
        name: '发布响应应返回成功业务码',
        module: '表单创建与发布',
        matcher: 'toBe',
        status: 'failed',
        durationMs: 18,
        error: '业务码不匹配',
      }],
      apiResponses: [],
      resourceResponses: [],
      networkSummary: emptyNetworkSummary(),
      artifacts: [artifact({
        stepId: 'form-publish',
        attemptId: 'attempt-publish',
        relativePath: 'screenshots/publish-failure.png',
        absolutePath: '/workspace/outputs/artifacts/run-record-001/form-publish/attempt-publish/screenshots/publish-failure.png',
        createdAt: '2026-09-04T00:00:02.000Z',
      })],
      error: '发布失败',
    },
  ]
  return record
}

function networkRecord(): RunRecord {
  const record = runRecord('2026-09-04T00:00:10.000Z')
  const successfulResources = Array.from({ length: 73 }, (_, index) => ({
    sequence: index + 1,
    timestamp: `2026-09-04T00:01:${String(index % 60).padStart(2, '0')}.000Z`,
    name: `asset-${index + 1}.js`,
    method: 'GET',
    url: `https://app.example.test/assets/asset-${index + 1}.js`,
    resourceType: index % 2 === 0 ? 'script' : 'image',
    status: 200,
    ok: true,
    durationMs: 10 + index,
    phase: '页面初始化',
    pageUrl: 'https://app.example.test/forms/1',
    mimeType: index % 2 === 0 ? 'application/javascript' : 'image/png',
    isFirstParty: true,
  }))
  record.scripts = [{
    id: 'form-fill',
    recordId: 'script-record-fill',
    name: '公开表单填写',
    directory: 'scripts',
    entryFile: 'form-fill.ui.spec.mjs',
    tags: ['表单'],
    status: 'failed',
    durationMs: 3_000,
    logs: [],
    assertions: [{
      sequence: 1,
      timestamp: '2026-09-04T00:00:03.000Z',
      name: '失败资源应生成健康断言',
      module: '资源加载健康',
      matcher: 'networkHealth',
      status: 'failed',
      durationMs: 0,
      error: 'resource-assertion-detail',
    }],
    apiResponses: [
      {
        sequence: 1,
        timestamp: '2026-09-04T00:00:00.000Z',
        name: '/api/forms/1',
        method: 'GET',
        url: 'https://api.example.test/api/forms/1',
        status: 200,
        ok: true,
        durationMs: 12,
        phase: '页面初始化',
        isFirstParty: true,
        responseBody: { marker: 'first-response-body' },
      },
      {
        sequence: 2,
        timestamp: '2026-09-04T00:00:00.100Z',
        name: '/api/forms/2',
        method: 'POST',
        url: 'https://api.example.test/api/forms/2',
        status: 200,
        ok: true,
        durationMs: 18,
        phase: '创建表单',
        isFirstParty: true,
        requestBody: { title: 'second-request-body' },
        responseBody: { marker: 'second-response-body' },
      },
    ],
    resourceResponses: [
      ...successfulResources,
      {
        sequence: 74,
        timestamp: '2026-09-04T00:00:01.000Z',
        name: 'missing-logo.png',
        method: 'GET',
        url: 'https://app.example.test/assets/missing-logo.png',
        resourceType: 'image',
        status: 404,
        ok: false,
        durationMs: 86,
        phase: '第 2 页填写与翻页',
        pageUrl: 'https://app.example.test/forms/1?page=2',
        mimeType: 'text/html',
        error: 'HTTP 404 Not Found',
        failureKind: 'http',
        isFirstParty: true,
      },
      {
        sequence: 75,
        timestamp: '2026-09-04T00:00:02.000Z',
        name: 'map.js',
        method: 'GET',
        url: 'https://cdn.example.test/map.js',
        resourceType: 'script',
        status: 0,
        ok: false,
        durationMs: 5_000,
        phase: '最终提交',
        pageUrl: 'https://app.example.test/forms/1?page=3',
        error: 'net::ERR_FAILED (CORS policy)',
        failureKind: 'network',
        isFirstParty: false,
        diagnostics: ['Access to script has been blocked by CORS policy'],
      },
    ],
    networkSummary: {
      api: { observed: 2, recorded: 2, dropped: 0, passed: 2, failed: 0, warnings: 0 },
      resources: { observed: 80, recorded: 75, dropped: 5, passed: 73, failed: 2, warnings: 0 },
    },
    artifacts: [],
    error: '资源加载健康断言失败',
  }]
  return record
}

function scaleRecord(): RunRecord {
  const record = runRecord('2026-09-04T00:02:00.000Z')
  record.status = 'failed'
  record.finishedAt = '2026-09-04T00:02:00.000Z'
  record.durationMs = 120_000
  record.counts = { total: 5, passed: 0, failed: 5, skipped: 0 }
  record.scripts = Array.from({ length: 5 }, (_, scriptIndex) => ({
    id: `network-script-${scriptIndex + 1}`,
    recordId: `network-script-record-${scriptIndex + 1}`,
    name: `网络规模脚本 ${scriptIndex + 1}`,
    directory: 'scripts',
    entryFile: `network-script-${scriptIndex + 1}.mjs`,
    tags: ['网络'],
    status: 'failed' as const,
    durationMs: 20_000,
    logs: [],
    assertions: Array.from({ length: 2_500 }, (_, assertionIndex) => ({
      sequence: assertionIndex + 1,
      timestamp: '2026-09-04T00:01:00.000Z',
      name: `网络失败断言 ${scriptIndex + 1}-${assertionIndex + 1}`,
      module: '资源加载健康',
      matcher: 'networkHealth',
      status: 'failed' as const,
      durationMs: 0,
      error: `network-failure-detail-${scriptIndex + 1}-${assertionIndex + 1}`,
    })),
    apiResponses: Array.from({ length: 500 }, (_, responseIndex) => ({
      sequence: responseIndex + 1,
      timestamp: '2026-09-04T00:00:30.000Z',
      name: `/api/scale/${scriptIndex + 1}/${responseIndex + 1}`,
      method: 'GET',
      url: `https://api.example.test/api/scale/${scriptIndex + 1}/${responseIndex + 1}`,
      status: 200,
      ok: true,
      durationMs: 10,
      phase: '规模验证',
      isFirstParty: true,
      responseBody: { marker: `scale-response-${scriptIndex + 1}-${responseIndex + 1}` },
    })),
    resourceResponses: [],
    networkSummary: {
      api: { observed: 500, recorded: 500, dropped: 0, passed: 500, failed: 0, warnings: 0 },
      resources: { observed: 2_500, recorded: 2_000, dropped: 500, passed: 0, failed: 2_500, warnings: 0 },
    },
    artifacts: [],
    error: '网络健康断言失败',
  }))
  return record
}

const DrawerStub = defineComponent({
  props: { modelValue: Boolean },
  setup(props, { slots }) {
    return () => props.modelValue
      ? h('div', { 'data-testid': 'drawer' }, slots.default?.())
      : null
  },
})

const TabsStub = defineComponent({
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue'],
  setup(props, { emit, slots }) {
    provide(ACTIVE_TAB_KEY, computed(() => props.modelValue))
    return () => h('div', [
      h('span', { 'data-testid': 'active-tab' }, props.modelValue),
      h('button', {
        'data-testid': 'select-responses',
        onClick: () => emit('update:modelValue', 'responses'),
      }, '响应结果'),
      h('button', {
        'data-testid': 'select-logs',
        onClick: () => emit('update:modelValue', 'logs'),
      }, '执行日志'),
      h('button', {
        'data-testid': 'select-screenshots',
        onClick: () => emit('update:modelValue', 'screenshots'),
      }, '选择'),
      h('button', {
        'data-testid': 'select-analysis',
        onClick: () => emit('update:modelValue', 'analysis'),
      }, '数据分析'),
      slots.default?.(),
    ])
  },
})

const TabPaneStub = defineComponent({
  props: {
    name: { type: String, required: true },
    lazy: Boolean,
  },
  setup(props, { slots }) {
    const activeTab = inject<ComputedRef<string>>(ACTIVE_TAB_KEY)
    const loaded = ref(!props.lazy || activeTab?.value === props.name)
    watch(activeTab ?? computed(() => ''), (value) => {
      if (value === props.name) loaded.value = true
    }, { immediate: true })
    return () => h('section', {
      'data-tab-name': props.name,
      'data-lazy': String(props.lazy),
    }, [
      h('div', { 'data-tab-label': props.name }, slots.label?.()),
      loaded.value ? slots.default?.() : null,
    ])
  },
})

const ImageStub = defineComponent({
  inheritAttrs: false,
  props: {
    src: { type: String, required: true },
    alt: { type: String, default: '' },
    previewSrcList: { type: Array as PropType<string[]>, default: () => [] },
    initialIndex: { type: Number, default: 0 },
    previewTeleported: Boolean,
    hideOnClickModal: Boolean,
  },
  setup(props, { attrs }) {
    return () => h('img', {
      class: attrs.class,
      'data-testid': 'screenshot-thumbnail',
      'data-src': props.src,
      'data-alt': props.alt,
      'data-preview-src-list': JSON.stringify(props.previewSrcList),
      'data-initial-index': String(props.initialIndex),
      'data-preview-teleported': String(props.previewTeleported),
      'data-hide-on-click-modal': String(props.hideOnClickModal),
    })
  },
})

const TooltipStub = defineComponent({
  props: { content: { type: String, required: true } },
  setup(props, { slots }) {
    return () => h('span', {
      'data-testid': 'path-tooltip',
      'data-content': props.content,
    }, slots.default?.())
  },
})

function mountDrawer(
  record: Ref<RunRecord | null>,
  visible = ref(true),
  options: {
    stopping?: Ref<boolean>
    onForceStop?: (record: RunRecord) => void
  } = {},
) {
  const Host = defineComponent(() => () => h(RunRecordDetailDrawer, {
    modelValue: visible.value,
    record: record.value,
    stopping: options.stopping?.value ?? false,
    'onUpdate:modelValue': (value: boolean) => { visible.value = value },
    onForceStop: options.onForceStop,
  }))
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(Host)
  app.config.warnHandler = () => undefined
  app.component('el-drawer', DrawerStub)
  app.component('el-tabs', TabsStub)
  app.component('el-tab-pane', TabPaneStub)
  app.component('el-image', ImageStub)
  app.component('el-tooltip', TooltipStub)
  mountedApps.push(app)
  app.mount(root)
  return { root, visible }
}

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.replaceChildren()
})

describe('RunRecordDetailDrawer', () => {
  it('only offers force stop for a running record and emits the selected record', async () => {
    const record = ref<RunRecord | null>(runRecord())
    const stopping = ref(false)
    const onForceStop = vi.fn()
    const { root } = mountDrawer(record, ref(true), { stopping, onForceStop })
    await nextTick()

    const stopButton = root.querySelector<HTMLElement>('[aria-label="强制停止运行批次"]')
    expect(stopButton).not.toBeNull()
    stopButton?.click()
    expect(onForceStop).toHaveBeenCalledWith(record.value)

    stopping.value = true
    await nextTick()
    expect(root.querySelector('[aria-label="强制停止运行批次"]')?.hasAttribute('disabled')).toBe(true)

    record.value = { ...runRecord(), status: 'interrupted' }
    await nextTick()
    expect(root.querySelector('[aria-label="强制停止运行批次"]')).toBeNull()
  })

  it('reserves the unfinished share of an in-progress batch as a pending segment', async () => {
    const record = runRecord()
    record.counts = { total: 3, passed: 1, failed: 0, skipped: 0 }
    const { root } = mountDrawer(ref(record))
    await nextTick()

    const distribution = root.querySelector<HTMLElement>('.result-distribution')
    const passed = distribution?.querySelector<HTMLElement>('.result-distribution__passed')
    const pending = distribution?.querySelector<HTMLElement>('.result-distribution__pending')

    expect(distribution?.getAttribute('aria-label')).toContain('待完成 2')
    expect(passed?.style.flexGrow).toBe('1')
    expect(pending?.style.flexGrow).toBe('2')
    expect(root.textContent).toContain('待完成 2')
  })

  it('keeps the selected tab when polling replaces the same run record', async () => {
    const visible = ref(true)
    const record = ref<RunRecord | null>(runRecord())
    const { root } = mountDrawer(record, visible)
    await nextTick()

    root.querySelector<HTMLButtonElement>('[data-testid="select-logs"]')?.click()
    await nextTick()
    expect(root.querySelector('[data-testid="active-tab"]')?.textContent).toBe('logs')

    record.value = screenshotRecord('2026-09-04T00:00:01.000Z')
    await nextTick()
    expect(root.querySelector('[data-testid="active-tab"]')?.textContent).toBe('logs')
    expect(root.querySelector('[data-tab-name="screenshots"]')).not.toBeNull()

    visible.value = false
    await nextTick()
    visible.value = true
    await nextTick()
    expect(root.querySelector('[data-testid="active-tab"]')?.textContent).toBe('overview')
  })

  it('only shows the screenshot tab when the record contains image screenshot artifacts', async () => {
    const withoutScreenshots = runRecord()
    withoutScreenshots.scripts = [{
      id: 'fixture-only',
      recordId: 'script-record-fixture',
      name: '仅生成附件',
      directory: 'scripts',
      entryFile: 'fixture-only.mjs',
      tags: [],
      status: 'passed',
      durationMs: 10,
      logs: [],
      assertions: [],
      apiResponses: [],
      resourceResponses: [],
      networkSummary: emptyNetworkSummary(),
      artifacts: [artifact({ type: 'fixture' })],
    }]
    const { root } = mountDrawer(ref(withoutScreenshots))
    await nextTick()

    expect(root.querySelector('[data-tab-name="screenshots"]')).toBeNull()
    expect(root.textContent).not.toContain('截图查看')
  })

  it('keeps the screenshot tab during same-record polling and falls back only if it disappears', async () => {
    const record = ref<RunRecord | null>(screenshotRecord())
    const { root } = mountDrawer(record)
    await nextTick()

    root.querySelector<HTMLButtonElement>('[data-testid="select-screenshots"]')?.click()
    await nextTick()
    expect(root.querySelector('[data-testid="active-tab"]')?.textContent).toBe('screenshots')

    record.value = screenshotRecord('2026-09-04T00:00:05.000Z')
    record.value.revision = 1
    await nextTick()
    expect(root.querySelector('[data-testid="active-tab"]')?.textContent).toBe('screenshots')

    record.value = runRecord('2026-09-04T00:00:06.000Z')
    record.value.revision = 2
    await nextTick()
    expect(root.querySelector('[data-testid="active-tab"]')?.textContent).toBe('overview')
  })

  it('lists screenshots chronologically with script, assertion, path tooltip and paged previews', async () => {
    const { root } = mountDrawer(ref(screenshotRecord()))
    await nextTick()

    const tabNames = [...root.querySelectorAll<HTMLElement>('[data-tab-name]')]
      .map((element) => element.dataset.tabName)
    expect(tabNames.indexOf('screenshots')).toBe(tabNames.indexOf('logs') + 1)
    expect(tabNames.indexOf('analysis')).toBe(tabNames.indexOf('screenshots') + 1)

    root.querySelector<HTMLButtonElement>('[data-testid="select-screenshots"]')?.click()
    await nextTick()

    const rows = [...root.querySelectorAll<HTMLElement>('.screenshot-row')]
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('表单发布')
    expect(rows[0]?.textContent).toContain('表单创建与发布')
    expect(rows[0]?.textContent).toContain('发布响应应返回成功业务码')
    expect(rows[1]?.textContent).toContain('公开表单填写')
    expect(rows[1]?.textContent).toContain('邮箱')
    expect(rows[1]?.textContent).toContain('邮箱格式应通过边界校验')
    expect(root.textContent).not.toContain('fixtures/input.png')
    expect(root.textContent).not.toContain('not-an-image.txt')
    expect(root.textContent).not.toContain('unsupported.svg')

    const tooltips = [...root.querySelectorAll<HTMLElement>(
      '.screenshot-cell--path [data-testid="path-tooltip"]',
    )]
    expect(tooltips.map((tooltip) => tooltip.dataset.content)).toEqual([
      '/workspace/outputs/artifacts/run-record-001/form-publish/attempt-publish/screenshots/publish-failure.png',
      '/workspace/outputs/artifacts/run-record-001/form-fill/attempt-fill/screenshots/填写失败 空格.png',
    ])

    const thumbnails = [...root.querySelectorAll<HTMLElement>('[data-testid="screenshot-thumbnail"]')]
    const sources = thumbnails.map((thumbnail) => thumbnail.dataset.src ?? '')
    expect(sources).toHaveLength(2)
    expect(new URL(sources[0] ?? '').pathname).toBe(
      '/run-records/run-record-001/screenshots/form-publish/attempt-publish',
    )
    expect(new URL(sources[0] ?? '').searchParams.get('path')).toBe('screenshots/publish-failure.png')
    expect(new URL(sources[1] ?? '').searchParams.get('path')).toBe('screenshots/填写失败 空格.png')
    expect(thumbnails.map((thumbnail) => JSON.parse(
      thumbnail.dataset.previewSrcList ?? '[]',
    ))).toEqual([sources, sources])
    expect(thumbnails.map((thumbnail) => thumbnail.dataset.initialIndex)).toEqual(['0', '1'])
    expect(thumbnails.every((thumbnail) => thumbnail.dataset.previewTeleported === 'true')).toBe(true)
    expect(thumbnails.every((thumbnail) => thumbnail.dataset.hideOnClickModal === 'true')).toBe(true)
  })

  it('separates resources from APIs, prioritizes failures and caps each rendered page', async () => {
    const { root } = mountDrawer(ref(networkRecord()))
    await nextTick()

    root.querySelector<HTMLButtonElement>('[data-testid="select-responses"]')?.click()
    await nextTick()

    const categoryButtons = root.querySelectorAll<HTMLButtonElement>('.network-category-switch button')
    expect(categoryButtons).toHaveLength(2)
    expect(categoryButtons[0]?.textContent).toContain('接口')
    expect(categoryButtons[1]?.textContent).toContain('资源')

    categoryButtons[1]?.click()
    await nextTick()

    const metrics = root.querySelector('.network-metrics')?.textContent ?? ''
    expect(metrics).toContain('观察到80')
    expect(metrics).toContain('已记录75')
    expect(metrics).toContain('失败2')
    expect(metrics).toContain('已截断5')
    expect(root.textContent).toContain('5 条资源记录因容量限制未保存')

    let rows = [...root.querySelectorAll<HTMLElement>('.resource-response-row')]
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('第 2 页填写与翻页')
    expect(rows[0]?.textContent).toContain('image')
    expect(rows[0]?.textContent).toContain('missing-logo.png')
    expect(rows[0]?.textContent).toContain('404')
    expect(rows[0]?.textContent).toContain('86 ms')
    expect(rows[0]?.textContent).toContain('HTTP 404 Not Found')
    expect(rows[1]?.textContent).toContain('最终提交')
    expect(rows[1]?.textContent).toContain('net::ERR_FAILED (CORS policy)')
    expect(rows[1]?.textContent).toContain('Access to script has been blocked by CORS policy')

    const resultFilter = root.querySelector<HTMLSelectElement>('select[aria-label="筛选资源加载结果"]')
    expect(resultFilter?.value).toBe('failed')
    if (resultFilter) {
      resultFilter.value = 'all'
      resultFilter.dispatchEvent(new Event('change', { bubbles: true }))
    }
    await nextTick()

    rows = [...root.querySelectorAll<HTMLElement>('.resource-response-row')]
    expect(rows).toHaveLength(50)
    expect(root.textContent).toContain('当前显示 75 / 75 条，每页最多 50 条')
  })

  it('does not repeat diagnostics already included in API or resource errors', async () => {
    const record = networkRecord()
    const script = record.scripts[0]!
    const repeatedDiagnostic = 'Access to script has been blocked by CORS policy'
    const independentDiagnostic = 'Independent diagnostic detail'
    const apiResponse = script.apiResponses[0]!
    delete apiResponse.responseBody
    Object.assign(apiResponse, {
      status: 0,
      ok: false,
      error: `net::ERR_FAILED\n${repeatedDiagnostic}`,
      diagnostics: [repeatedDiagnostic, repeatedDiagnostic, independentDiagnostic],
    })
    const resourceResponse = script.resourceResponses[script.resourceResponses.length - 1]!
    Object.assign(resourceResponse, {
      error: `net::ERR_FAILED\n${repeatedDiagnostic}`,
      diagnostics: [repeatedDiagnostic, repeatedDiagnostic, independentDiagnostic],
    })

    const visible = ref(false)
    const { root } = mountDrawer(ref(record), visible)
    await nextTick()
    visible.value = true
    await nextTick()
    root.querySelector<HTMLButtonElement>('[data-testid="select-responses"]')?.click()
    await nextTick()

    const apiDetailText = root.querySelector('.api-response-detail')?.textContent ?? ''
    expect(apiDetailText.split(repeatedDiagnostic)).toHaveLength(2)
    expect(apiDetailText.split(independentDiagnostic)).toHaveLength(2)

    const resourceButton = root.querySelectorAll<HTMLButtonElement>('.network-category-switch button')[1]
    resourceButton?.click()
    await nextTick()

    const resourceRows = [...root.querySelectorAll<HTMLElement>('.resource-response-row')]
    const resourceText = resourceRows.find((row) => row.textContent?.includes('map.js'))?.textContent ?? ''
    expect(resourceText.split(repeatedDiagnostic)).toHaveLength(2)
    expect(resourceText.split(independentDiagnostic)).toHaveLength(2)
  })

  it('shows successful API body capture errors without classifying the request as failed', async () => {
    const record = networkRecord()
    const apiResponse = record.scripts[0]!.apiResponses[0]!
    delete apiResponse.responseBody
    apiResponse.bodyReadError = 'Network.getResponseBody: body released after navigation'
    apiResponse.warning = true
    apiResponse.incomplete = true
    record.scripts[0]!.networkSummary.api = {
      observed: 2,
      recorded: 2,
      dropped: 0,
      passed: 1,
      failed: 0,
      warnings: 1,
    }

    const visible = ref(false)
    const { root } = mountDrawer(ref(record), visible)
    await nextTick()
    visible.value = true
    await nextTick()
    root.querySelector<HTMLButtonElement>('[data-testid="select-responses"]')?.click()
    await nextTick()

    const detail = root.querySelector('.api-response-detail')?.textContent ?? ''
    expect(detail).toContain('响应正文采集失败')
    expect(detail).toContain('body released after navigation')
    expect(root.querySelector('.api-response-item summary')?.textContent).toContain('200 · 采集警告')
    expect(root.querySelector('.network-metrics')?.textContent).toContain('警告1')
  })

  it('lazily mounts heavy tabs and only renders expanded API and assertion details', async () => {
    const visible = ref(false)
    const { root } = mountDrawer(ref(networkRecord()), visible)
    await nextTick()

    visible.value = true
    await nextTick()

    const heavyTabNames = ['responses', 'scripts', 'logs', 'analysis']
    for (const name of heavyTabNames) {
      expect(root.querySelector(`[data-tab-name="${name}"]`)?.getAttribute('data-lazy')).toBe('true')
    }
    expect(root.querySelector('.network-category-switch')).toBeNull()
    expect(root.querySelector('.assertion-group')).toBeNull()

    root.querySelector<HTMLButtonElement>('[data-testid="select-responses"]')?.click()
    await nextTick()

    const apiItems = root.querySelectorAll<HTMLDetailsElement>('.api-response-item')
    expect(apiItems).toHaveLength(2)
    expect(root.textContent).toContain('first-response-body')
    expect(root.textContent).not.toContain('second-response-body')
    expect(root.textContent).not.toContain('second-request-body')

    apiItems[1]!.open = true
    apiItems[1]!.dispatchEvent(new Event('toggle'))
    await nextTick()
    expect(root.textContent).toContain('second-response-body')
    expect(root.textContent).toContain('second-request-body')

    root.querySelector<HTMLButtonElement>('[data-testid="select-analysis"]')?.click()
    await nextTick()

    const assertionGroup = root.querySelector<HTMLDetailsElement>('.assertion-group')
    expect(assertionGroup).not.toBeNull()
    expect(root.querySelector('.assertion-child')).toBeNull()
    expect(root.textContent).not.toContain('resource-assertion-detail')

    assertionGroup!.open = true
    assertionGroup!.dispatchEvent(new Event('toggle'))
    await nextTick()
    expect(root.querySelectorAll('.assertion-child')).toHaveLength(1)
    expect(root.textContent).toContain('resource-assertion-detail')
  })

  it('caps mounted API and assertion nodes for a five-script worst-case batch', async () => {
    const visible = ref(false)
    const { root } = mountDrawer(ref(scaleRecord()), visible)
    await nextTick()

    visible.value = true
    await nextTick()
    expect(root.querySelector('.api-response-item')).toBeNull()
    expect(root.querySelector('.assertion-child')).toBeNull()

    root.querySelector<HTMLButtonElement>('[data-testid="select-responses"]')?.click()
    await nextTick()
    expect(root.querySelectorAll('.api-response-item')).toHaveLength(50)

    const expandCurrentApiPage = [...root.querySelectorAll<HTMLElement>('.api-response-heading el-button')]
      .find((button) => button.textContent?.includes('展开本页'))
    expandCurrentApiPage?.click()
    await nextTick()
    expect(root.querySelectorAll('.api-response-detail')).toHaveLength(50)

    root.querySelector<HTMLButtonElement>('[data-testid="select-analysis"]')?.click()
    await nextTick()
    expect(root.querySelectorAll('.assertion-group')).toHaveLength(5)
    expect(root.querySelector('.assertion-child')).toBeNull()

    const firstAssertionGroup = root.querySelector<HTMLDetailsElement>('.assertion-group')
    firstAssertionGroup!.open = true
    firstAssertionGroup!.dispatchEvent(new Event('toggle'))
    await nextTick()
    expect(root.querySelectorAll('.assertion-child')).toHaveLength(100)
  })
})
