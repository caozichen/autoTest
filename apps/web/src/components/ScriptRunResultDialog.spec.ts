// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, ref, type PropType } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'

import type { AutomationScript } from '@/domain/script'
import ScriptRunResultDialog from './ScriptRunResultDialog.vue'

const PaginationStub = defineComponent({
  props: {
    currentPage: { type: Number, required: true },
    pageSize: { type: Number, required: true },
    pageSizes: { type: Array as PropType<number[]>, required: true },
    total: { type: Number, required: true },
  },
  emits: ['update:currentPage', 'update:pageSize'],
  setup(props, { emit }) {
    return () => h('div', {
      'data-testid': 'pagination',
      'data-page': String(props.currentPage),
      'data-size': String(props.pageSize),
      'data-sizes': JSON.stringify(props.pageSizes),
      'data-total': String(props.total),
    }, [
      h('button', { 'data-testid': 'page-2', onClick: () => emit('update:currentPage', 2) }, '2'),
      ...props.pageSizes.map((size) => h('button', {
        'data-testid': `size-${size}`,
        onClick: () => emit('update:pageSize', size),
      }, String(size))),
    ])
  },
})

const script: AutomationScript = {
  id: 'script-1',
  name: '表单测试',
  description: '',
  directory: 'scripts',
  entryFile: 'form.ui.spec.mjs',
  timeoutMs: 300_000,
  tags: [],
  status: 'passed',
  createdAt: '2026-09-24T00:00:00.000Z',
  updatedAt: '2026-09-24T00:00:00.000Z',
  lastRunAt: '2026-09-24T00:00:00.000Z',
  lastDuration: '1s',
  lastRunResult: {
    ok: true,
    durationMs: 1_000,
    logs: Array.from({ length: 25 }, (_, index) => ({
      timestamp: '2026-09-24T00:00:00.000Z',
      level: 'info' as const,
      message: `日志 ${index}`,
    })),
  },
}

let unmount: (() => void) | undefined

afterEach(() => {
  unmount?.()
  unmount = undefined
  document.body.replaceChildren()
})

describe('ScriptRunResultDialog', () => {
  it('uses 20 logs by default and supports 10, 20 and 50 per page', async () => {
    const visible = ref(true)
    const Host = defineComponent(() => () => h(ScriptRunResultDialog, {
      modelValue: visible.value,
      script,
      'onUpdate:modelValue': (value: boolean) => { visible.value = value },
    }))
    const root = document.createElement('div')
    document.body.append(root)
    const app = createApp(Host)
    app.component('el-dialog', defineComponent({ setup(_, { slots }) { return () => h('div', slots.default?.()) } }))
    app.component('el-pagination', PaginationStub)
    app.config.warnHandler = () => undefined
    app.mount(root)
    unmount = () => app.unmount()
    await nextTick()

    const pagination = root.querySelector<HTMLElement>('[data-testid="pagination"]')!
    expect(pagination.dataset.size).toBe('20')
    expect(pagination.dataset.sizes).toBe('[10,20,50]')
    expect(root.querySelectorAll('.log-row')).toHaveLength(20)

    root.querySelector<HTMLButtonElement>('[data-testid="page-2"]')?.click()
    await nextTick()
    expect(root.querySelectorAll('.log-row')).toHaveLength(5)

    root.querySelector<HTMLButtonElement>('[data-testid="size-10"]')?.click()
    await nextTick()
    expect(pagination.dataset.page).toBe('1')
    expect(root.querySelectorAll('.log-row')).toHaveLength(10)

    root.querySelector<HTMLButtonElement>('[data-testid="size-50"]')?.click()
    await nextTick()
    expect(root.querySelectorAll('.log-row')).toHaveLength(25)
  })
})
