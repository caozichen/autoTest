<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  ArrowDownBold,
  ArrowUpBold,
  CircleCheck,
  CircleClose,
  Clock,
  Close,
  Connection,
  DataAnalysis,
  Document,
  Files,
  FolderOpened,
  Loading,
  Monitor,
  Picture,
  VideoPause,
  Warning,
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

import AssertionModuleChart from '@/components/AssertionModuleChart.vue'
import AssertionOutcomeChart from '@/components/AssertionOutcomeChart.vue'
import type {
  RunRecord,
  RunRecordLogLevel,
  RunRecordLogScope,
  RunScriptRecord,
  RunRecordStatus,
  RunScriptStatus,
} from '@/domain/run-record'
import {
  buildRunAssertionAnalysis,
  inferLegacyAssertionModule,
  type RunAssertionGroup,
} from '@/services/run-records/run-assertion-analysis'
import { pendingRunScriptCount } from '@/services/run-records/run-record-progress'
import type {
  ScriptApiResponse,
  ScriptArtifact,
  ScriptNetworkCategorySummary,
  ScriptResourceResponse,
} from '@/domain/script'
import { runtimeConfig } from '@/config/runtime'

interface ApiResponseView extends ScriptApiResponse {
  key: string
  scriptName: string
}

interface ResourceResponseView extends ScriptResourceResponse {
  key: string
  scriptName: string
}

type ResponseCategory = 'api' | 'resources'
type ResourceOutcomeFilter = 'all' | 'failed' | 'passed'

const API_PAGE_SIZE = 50
const RESOURCE_PAGE_SIZE = 50
const ASSERTION_PAGE_SIZE = 100
const SCREENSHOT_REVEAL_TIMEOUT_MS = 15_000

interface ScreenshotView extends ScriptArtifact {
  key: string
  url: string
  scriptRecordId: string
  scriptName: string
  scriptEntryFile: string
  featureName: string
  assertionName: string
}

const props = withDefaults(defineProps<{
  modelValue: boolean
  record: RunRecord | null
  stopping?: boolean
}>(), {
  stopping: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'force-stop': [record: RunRecord]
}>()

const activeTab = ref('overview')
const logLevel = ref<'all' | RunRecordLogLevel>('all')
const logKeyword = ref('')
const expandedAssertionGroupIds = ref<Set<string>>(new Set())
const expandedApiResponseKeys = ref<Set<string>>(new Set())
const responseCategory = ref<ResponseCategory>('api')
const apiPage = ref(1)
const resourceOutcomeFilter = ref<ResourceOutcomeFilter>('failed')
const resourceTypeFilter = ref('all')
const resourcePage = ref(1)
const assertionGroupPages = ref<Map<string, number>>(new Map())
const revealingScreenshotKeys = ref<Set<string>>(new Set())
const screenshotRevealControllers = new Map<string, AbortController>()

const statusMap: Record<RunRecordStatus, { label: string; type: 'success' | 'warning' | 'danger' | 'info' }> = {
  running: { label: '执行中', type: 'warning' },
  passed: { label: '全部通过', type: 'success' },
  failed: { label: '执行失败', type: 'danger' },
  partial: { label: '部分通过', type: 'warning' },
  interrupted: { label: '已中断', type: 'info' },
}

const scriptStatusMap: Record<RunScriptStatus, { label: string; type: 'success' | 'warning' | 'danger' | 'info' }> = {
  queued: { label: '排队中', type: 'info' },
  running: { label: '执行中', type: 'warning' },
  passed: { label: '已通过', type: 'success' },
  partial: { label: '部分通过', type: 'warning' },
  failed: { label: '执行失败', type: 'danger' },
  skipped: { label: '未执行', type: 'info' },
}

const logTypeMap: Record<RunRecordLogLevel, 'success' | 'warning' | 'danger' | 'info'> = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  error: 'danger',
}

const scopeLabels: Record<RunRecordLogScope, string> = {
  batch: '批次',
  login: '登录',
  runner: 'Runner',
  script: '脚本',
}

const filteredLogs = computed(() => {
  const keyword = logKeyword.value.trim().toLowerCase()
  return (props.record?.logs ?? []).filter((log) => {
    const matchesLevel = logLevel.value === 'all' || log.level === logLevel.value
    const matchesKeyword = !keyword || [log.message, log.scriptName ?? '', JSON.stringify(log.details ?? {})]
      .some((value) => value.toLowerCase().includes(keyword))
    return matchesLevel && matchesKeyword
  })
})

const assertionAnalysis = computed(() => buildRunAssertionAnalysis(props.record?.scripts ?? []))
const apiResponses = computed<ApiResponseView[]>(() => (props.record?.scripts ?? [])
  .flatMap((script) => script.apiResponses.map((response) => ({
    ...response,
    key: `${script.recordId}:${response.sequence}`,
    scriptName: script.name,
  })))
  .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()))
const pagedApiResponses = computed(() => {
  const start = (apiPage.value - 1) * API_PAGE_SIZE
  return apiResponses.value.slice(start, start + API_PAGE_SIZE)
})
const resourceResponses = computed<ResourceResponseView[]>(() => (props.record?.scripts ?? [])
  .flatMap((script) => (script.resourceResponses ?? []).map((response) => ({
    ...response,
    key: `${script.recordId}:${response.sequence}`,
    scriptName: script.name,
  })))
  .sort((left, right) => {
    if (left.ok !== right.ok) return left.ok ? 1 : -1
    return new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
  }))
const resourceTypes = computed(() => [...new Set(resourceResponses.value.map((response) => response.resourceType))]
  .sort((left, right) => left.localeCompare(right)))
const filteredResourceResponses = computed(() => resourceResponses.value.filter((response) => {
  const matchesType = resourceTypeFilter.value === 'all' || response.resourceType === resourceTypeFilter.value
  if (!matchesType) return false
  if (resourceOutcomeFilter.value === 'failed') return !response.ok
  if (resourceOutcomeFilter.value === 'passed') return response.ok
  return true
}))
const pagedResourceResponses = computed(() => {
  const start = (resourcePage.value - 1) * RESOURCE_PAGE_SIZE
  return filteredResourceResponses.value.slice(start, start + RESOURCE_PAGE_SIZE)
})
const successfulResourceResponseCount = computed(() => resourceResponses.value.filter((response) => response.ok).length)
const failedResourceResponseCount = computed(() => resourceResponses.value.filter((response) => !response.ok).length)
const resourceFilterLabel = computed(() => {
  if (resourceOutcomeFilter.value === 'failed') return '失败'
  if (resourceOutcomeFilter.value === 'passed') return '通过'
  return '全部'
})
const resourceEmptyDescription = computed(() => resourceResponses.value.length === 0
  ? '该运行记录没有资源加载数据，重新运行脚本后即可采集'
  : `没有符合当前“${resourceFilterLabel.value}”筛选条件的资源`)

function aggregateNetworkCategory(category: 'api' | 'resources'): ScriptNetworkCategorySummary {
  const total: ScriptNetworkCategorySummary = {
    observed: 0,
    recorded: 0,
    dropped: 0,
    passed: 0,
    failed: 0,
    warnings: 0,
  }
  for (const script of props.record?.scripts ?? []) {
    const summary = script.networkSummary?.[category]
    if (!summary) continue
    for (const key of Object.keys(total) as Array<keyof ScriptNetworkCategorySummary>) {
      total[key] += summary[key]
    }
  }
  const responses = category === 'api' ? apiResponses.value : resourceResponses.value
  const derivedWarnings = category === 'api'
    ? responses.filter((response) => (
        response.warning === true
        || (!response.ok && response.isFirstParty === false)
      )).length
    : responses.filter((response) => response.warning === true).length
  const derivedFailures = category === 'api'
    ? responses.filter((response) => (
        response.warning !== true
        && !response.ok
        && response.isFirstParty !== false
      )).length
    : responses.filter((response) => response.warning !== true && !response.ok).length
  const derivedPassed = responses.filter((response) => response.ok && response.warning !== true).length
  total.observed = Math.max(total.observed, responses.length)
  total.recorded = Math.max(total.recorded, responses.length)
  total.passed = Math.max(total.passed, derivedPassed)
  total.failed = Math.max(total.failed, derivedFailures)
  total.warnings = Math.max(total.warnings, derivedWarnings)
  return total
}

const apiNetworkSummary = computed(() => aggregateNetworkCategory('api'))
const resourceNetworkSummary = computed(() => aggregateNetworkCategory('resources'))
const screenshots = computed<ScreenshotView[]>(() => (props.record?.scripts ?? [])
  .flatMap((script) => script.artifacts
    .filter((artifact) => (
      artifact.type === 'screenshot'
      && (artifact.mimeType === 'image/png' || artifact.mimeType === 'image/jpeg')
    ))
    .map((artifact) => {
      const assertion = screenshotAssertion(script, artifact)
      const assertionName = assertion?.name ?? script.error?.trim() ?? '脚本执行失败'
      return {
        ...artifact,
        key: `${script.recordId}:${artifact.attemptId}:${artifact.relativePath}`,
        url: screenshotUrl(artifact),
        scriptRecordId: script.recordId,
        scriptName: script.name,
        scriptEntryFile: script.entryFile,
        featureName: assertion?.module ?? inferLegacyAssertionModule(script.id, assertionName),
        assertionName,
      }
    }))
  .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt)))
const screenshotUrls = computed(() => screenshots.value.map((screenshot) => screenshot.url))

const statusIcon = computed(() => {
  if (props.record?.status === 'passed') return CircleCheck
  if (props.record?.status === 'failed') return CircleClose
  if (props.record?.status === 'partial' || props.record?.status === 'interrupted') return Warning
  return Clock
})

const drawerTitle = computed(() => props.record
  ? `运行记录详情：${props.record.name}`
  : '运行记录详情')

function screenshotAssertion(script: RunScriptRecord, artifact: ScriptArtifact) {
  const failedAssertions = script.assertions.filter((assertion) => assertion.status === 'failed')
  const screenshotTimestamp = Date.parse(artifact.createdAt)
  const precedingAssertions = failedAssertions.filter((assertion) => {
    const assertionTimestamp = Date.parse(assertion.timestamp)
    return Number.isFinite(assertionTimestamp)
      && Number.isFinite(screenshotTimestamp)
      && assertionTimestamp <= screenshotTimestamp
  })
  return precedingAssertions[precedingAssertions.length - 1]
    ?? failedAssertions[failedAssertions.length - 1]
}

function screenshotUrl(artifact: ScriptArtifact): string {
  const baseUrl = runtimeConfig.runnerBaseUrl.replace(/\/+$/, '')
  return `${baseUrl}/run-records/${encodeURIComponent(artifact.executionId)}`
    + `/screenshots/${encodeURIComponent(artifact.stepId)}/${encodeURIComponent(artifact.attemptId)}`
    + `?path=${encodeURIComponent(artifact.relativePath)}`
}

function screenshotRevealUrl(artifact: ScriptArtifact): string {
  const [endpoint, query = ''] = screenshotUrl(artifact).split('?')
  return `${endpoint}/reveal?${query}`
}

function setScreenshotRevealing(key: string, revealing: boolean): void {
  const next = new Set(revealingScreenshotKeys.value)
  if (revealing) next.add(key)
  else next.delete(key)
  revealingScreenshotKeys.value = next
}

function cancelScreenshotRevealRequests(): void {
  for (const controller of screenshotRevealControllers.values()) controller.abort()
  screenshotRevealControllers.clear()
  revealingScreenshotKeys.value = new Set()
}

async function revealScreenshot(screenshot: ScreenshotView): Promise<void> {
  if (screenshotRevealControllers.has(screenshot.key)) return
  const controller = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  screenshotRevealControllers.set(screenshot.key, controller)
  setScreenshotRevealing(screenshot.key, true)
  try {
    const request = (async () => {
      const response = await fetch(screenshotRevealUrl(screenshot), {
        method: 'POST',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })
      const payload = await response.json().catch(() => null) as {
        ok?: unknown
        error?: unknown
      } | null
      return { payload, response }
    })()
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true
        controller.abort()
        reject(new Error(`Runner 截图定位请求超时（${SCREENSHOT_REVEAL_TIMEOUT_MS}ms）`))
      }, SCREENSHOT_REVEAL_TIMEOUT_MS)
    })
    const cancellation = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => {
        reject(new Error('截图定位请求已取消'))
      }, { once: true })
    })

    const { payload, response } = await Promise.race([request, timeout, cancellation])
    if (controller.signal.aborted && !timedOut) return
    if (!response.ok || payload?.ok !== true) {
      const message = typeof payload?.error === 'string'
        ? payload.error
        : `Runner 返回 HTTP ${response.status}`
      throw new Error(message)
    }
  } catch (error) {
    if (controller.signal.aborted && !timedOut) return
    const message = timedOut
      ? `Runner 截图定位请求超时（${SCREENSHOT_REVEAL_TIMEOUT_MS}ms）`
      : error instanceof Error && error.message.trim()
        ? error.message
        : '未知错误'
    ElMessage.error(`定位截图失败：${message}`)
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
    if (screenshotRevealControllers.get(screenshot.key) === controller) {
      screenshotRevealControllers.delete(screenshot.key)
      setScreenshotRevealing(screenshot.key, false)
    }
  }
}

watch(
  () => props.modelValue ? props.record?.id : undefined,
  (visibleRecordId, previousVisibleRecordId) => {
    if (visibleRecordId !== previousVisibleRecordId) cancelScreenshotRevealRequests()
    if (!visibleRecordId) return
    activeTab.value = 'overview'
    logLevel.value = 'all'
    logKeyword.value = ''
    responseCategory.value = 'api'
    resourceOutcomeFilter.value = failedResourceResponseCount.value > 0
      ? 'failed'
      : 'all'
    resourceTypeFilter.value = 'all'
    apiPage.value = 1
    resourcePage.value = 1
    assertionGroupPages.value = new Map()
    expandedAssertionGroupIds.value = new Set()
    expandedApiResponseKeys.value = new Set(apiResponses.value.slice(0, 1).map((response) => response.key))
  },
)

onBeforeUnmount(cancelScreenshotRevealRequests)

watch(
  () => apiResponses.value.length,
  (total) => {
    const lastPage = Math.max(1, Math.ceil(total / API_PAGE_SIZE))
    if (apiPage.value > lastPage) apiPage.value = lastPage
  },
)

watch(
  [resourceOutcomeFilter, resourceTypeFilter],
  () => { resourcePage.value = 1 },
)

watch(
  () => filteredResourceResponses.value.length,
  (total) => {
    const lastPage = Math.max(1, Math.ceil(total / RESOURCE_PAGE_SIZE))
    if (resourcePage.value > lastPage) resourcePage.value = lastPage
  },
)

watch(
  () => screenshots.value.length,
  (screenshotCount) => {
    if (screenshotCount === 0 && activeTab.value === 'screenshots') activeTab.value = 'overview'
  },
)

function assertionGroupsAreExpanded(groups: typeof assertionAnalysis.value.groups): boolean {
  return groups.length > 0 && groups.every((group) => expandedAssertionGroupIds.value.has(group.id))
}

function toggleAssertionGroups(groups: typeof assertionAnalysis.value.groups): void {
  const next = new Set(expandedAssertionGroupIds.value)
  const expand = !assertionGroupsAreExpanded(groups)
  for (const group of groups) {
    if (expand) next.add(group.id)
    else next.delete(group.id)
  }
  expandedAssertionGroupIds.value = next
}

function isAssertionGroupExpanded(groupId: string): boolean {
  return expandedAssertionGroupIds.value.has(groupId)
}

function syncAssertionGroupState(groupId: string, event: Event): void {
  const details = event.currentTarget
  if (!(details instanceof HTMLDetailsElement)) return
  const next = new Set(expandedAssertionGroupIds.value)
  if (details.open) next.add(groupId)
  else next.delete(groupId)
  expandedAssertionGroupIds.value = next
}

function allApiResponsesExpanded(): boolean {
  return pagedApiResponses.value.length > 0
    && pagedApiResponses.value.every((response) => expandedApiResponseKeys.value.has(response.key))
}

function toggleApiResponses(): void {
  const next = new Set(expandedApiResponseKeys.value)
  const expand = !allApiResponsesExpanded()
  for (const response of pagedApiResponses.value) {
    if (expand) next.add(response.key)
    else next.delete(response.key)
  }
  expandedApiResponseKeys.value = next
}

function syncApiResponseState(key: string, event: Event): void {
  const details = event.currentTarget
  if (!(details instanceof HTMLDetailsElement)) return
  const next = new Set(expandedApiResponseKeys.value)
  if (details.open) next.add(key)
  else next.delete(key)
  expandedApiResponseKeys.value = next
}

function assertionGroupPage(group: RunAssertionGroup): number {
  const lastPage = Math.max(1, Math.ceil(group.assertions.length / ASSERTION_PAGE_SIZE))
  return Math.min(assertionGroupPages.value.get(group.id) ?? 1, lastPage)
}

function pagedAssertions(group: RunAssertionGroup) {
  const start = (assertionGroupPage(group) - 1) * ASSERTION_PAGE_SIZE
  return group.assertions.slice(start, start + ASSERTION_PAGE_SIZE)
}

function setAssertionGroupPage(group: RunAssertionGroup, page: number): void {
  const lastPage = Math.max(1, Math.ceil(group.assertions.length / ASSERTION_PAGE_SIZE))
  const next = new Map(assertionGroupPages.value)
  next.set(group.id, Math.min(Math.max(1, page), lastPage))
  assertionGroupPages.value = next
}

function formatDateTime(value: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString('zh-CN', { hour12: false })
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return '-'
  if (durationMs < 1_000) return `${durationMs} ms`
  const totalSeconds = Math.round(durationMs / 1_000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`
}

function formatJson(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

function standaloneNetworkDiagnostics(response: { error?: string; diagnostics?: string[] }): string[] {
  const error = response.error ?? ''
  const seen = new Set<string>()
  return (response.diagnostics ?? []).flatMap((diagnostic) => {
    const message = diagnostic.trim()
    if (!message || error.includes(message) || seen.has(message)) return []
    seen.add(message)
    return [message]
  })
}

function formatNetworkError(response: { error?: string; diagnostics?: string[] }): string {
  return [response.error, ...standaloneNetworkDiagnostics(response)]
    .filter((item): item is string => Boolean(item))
    .join('\n')
}

function hasPayload(response: ApiResponseView, key: 'requestBody' | 'responseBody'): boolean {
  return Object.prototype.hasOwnProperty.call(response, key) && response[key] !== null
}

function apiStatusType(response: ApiResponseView): 'success' | 'warning' | 'danger' | 'info' {
  if (response.status === 0 && response.ok) return 'info'
  if (response.warning) return 'warning'
  if (!response.ok && response.isFirstParty === false) return 'warning'
  return response.ok ? 'success' : 'danger'
}

function apiStatusLabel(response: ApiResponseView): string {
  const status = response.status ? String(response.status) : 'NO RESPONSE'
  return response.warning ? `${status} · 采集警告` : status
}

function resourceStatusType(response: ResourceResponseView): 'success' | 'warning' | 'danger' | 'info' {
  if (response.status === 0 && response.ok) return 'info'
  if (response.ok) return 'success'
  return 'danger'
}

function failureStageLabel(stage: RunRecord['failureStage']): string {
  if (stage === 'login') return '环境登录'
  if (stage === 'runner') return 'Runner 调度'
  return stage === 'script' ? '脚本执行' : '-'
}
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    direction="rtl"
    size="min(1180px, 96vw)"
    :title="drawerTitle"
    :with-header="false"
    class="run-record-detail-drawer"
    destroy-on-close
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="record" class="record-detail">
      <header class="detail-header">
        <div class="detail-header__identity">
          <span class="detail-header__eyebrow">RUN DETAIL / {{ record.displayId }}</span>
          <h2>{{ record.name }}</h2>
          <p>{{ record.environment.name }} · {{ record.browser }} · 手动触发</p>
        </div>
        <div class="detail-header__actions">
          <el-button
            v-if="record.status === 'running'"
            type="danger"
            plain
            :icon="VideoPause"
            :loading="stopping"
            :disabled="stopping"
            aria-label="强制停止运行批次"
            @click="emit('force-stop', record)"
          >强制停止</el-button>
          <el-tag :type="statusMap[record.status].type" :class="{ 'status-tag--partial': record.status === 'partial' }" effect="light" size="large">
            {{ statusMap[record.status].label }}
          </el-tag>
          <el-tooltip content="关闭详情" placement="bottom">
            <el-button circle :icon="Close" aria-label="关闭详情" @click="emit('update:modelValue', false)" />
          </el-tooltip>
        </div>
      </header>

      <section class="detail-status" :class="`detail-status--${record.status}`" aria-live="polite">
        <span class="detail-status__icon"><el-icon :size="28"><component :is="statusIcon" /></el-icon></span>
        <div>
          <strong>{{ statusMap[record.status].label }}</strong>
          <p v-if="record.error">{{ record.error }}</p>
          <p v-else>
            共执行 {{ record.counts.total }} 个脚本，通过 {{ record.counts.passed }} 个，部分通过 {{ record.counts.partial }} 个，执行失败 {{ record.counts.failed }} 个。
          </p>
        </div>
        <strong class="detail-status__rate">{{ record.analysis.passRate }}%</strong>
      </section>

      <el-tabs v-model="activeTab" class="detail-tabs">
        <el-tab-pane name="overview">
          <template #label><span class="tab-label"><el-icon><Monitor /></el-icon>运行概览</span></template>

          <section class="metadata-grid" aria-label="运行元数据">
            <div><span>开始时间</span><strong>{{ formatDateTime(record.startedAt) }}</strong></div>
            <div><span>完成时间</span><strong>{{ formatDateTime(record.finishedAt) }}</strong></div>
            <div><span>批次耗时</span><strong>{{ formatDuration(record.durationMs) }}</strong></div>
            <div><span>失败阶段</span><strong>{{ failureStageLabel(record.failureStage) }}</strong></div>
            <div><span>运行环境</span><strong>{{ record.environment.name }} / {{ record.environment.code }}</strong></div>
            <div><span>API 地址</span><code>{{ record.environment.apiBaseUrl }}</code></div>
          </section>

          <section class="section-block">
            <header class="section-heading">
              <div><h3>批次进度</h3><p>按脚本结果汇总当前批次。</p></div>
              <span>{{ record.counts.passed + record.counts.partial + record.counts.failed + record.counts.skipped }} / {{ record.counts.total }}</span>
            </header>
            <div class="result-distribution" role="img" :aria-label="`通过 ${record.counts.passed}，部分通过 ${record.counts.partial}，执行失败 ${record.counts.failed}，未执行 ${record.counts.skipped}，待完成 ${pendingRunScriptCount(record.counts)}`">
              <span v-if="record.counts.passed" aria-hidden="true" class="result-distribution__passed" :style="{ flex: record.counts.passed }" />
              <span v-if="record.counts.partial" aria-hidden="true" class="result-distribution__partial" :style="{ flex: record.counts.partial }" />
              <span v-if="record.counts.failed" aria-hidden="true" class="result-distribution__failed" :style="{ flex: record.counts.failed }" />
              <span v-if="record.counts.skipped" aria-hidden="true" class="result-distribution__skipped" :style="{ flex: record.counts.skipped }" />
              <span v-if="pendingRunScriptCount(record.counts)" aria-hidden="true" class="result-distribution__pending" :style="{ flex: pendingRunScriptCount(record.counts) }" />
            </div>
            <div class="distribution-legend">
              <span><i class="is-passed" />通过 {{ record.counts.passed }}</span>
              <span><i class="is-partial" />部分通过 {{ record.counts.partial }}</span>
              <span><i class="is-failed" />执行失败 {{ record.counts.failed }}</span>
              <span><i class="is-skipped" />未执行 {{ record.counts.skipped }}</span>
              <span v-if="pendingRunScriptCount(record.counts)"><i class="is-pending" />待完成 {{ pendingRunScriptCount(record.counts) }}</span>
            </div>
          </section>

          <section class="section-block">
            <header class="section-heading">
              <div><h3>执行轨迹</h3><p>批次、登录、Runner 与脚本的关键事件。</p></div>
            </header>
            <div class="event-timeline">
              <div v-for="log in record.logs.slice(0, 8)" :key="log.id" class="event-row">
                <span class="event-row__level" :class="`is-${log.level}`"><i aria-hidden="true" />{{ log.level.toUpperCase() }}</span>
                <time>{{ formatTime(log.timestamp) }}</time>
                <el-tag :type="logTypeMap[log.level]" size="small" effect="plain">{{ scopeLabels[log.scope] }}</el-tag>
                <p>{{ log.message }}</p>
              </div>
            </div>
          </section>
        </el-tab-pane>

        <el-tab-pane name="responses" lazy>
          <template #label><span class="tab-label"><el-icon><Connection /></el-icon>响应结果</span></template>

          <section class="network-category-switch" aria-label="网络记录分类">
            <button
              type="button"
              :class="{ 'is-active': responseCategory === 'api' }"
              :aria-pressed="responseCategory === 'api'"
              @click="responseCategory = 'api'"
            >
              接口
              <span>{{ apiNetworkSummary.recorded }}</span>
            </button>
            <button
              type="button"
              :class="{ 'is-active': responseCategory === 'resources' }"
              :aria-pressed="responseCategory === 'resources'"
              @click="responseCategory = 'resources'"
            >
              资源
              <span>{{ resourceNetworkSummary.recorded }}</span>
            </button>
          </section>

          <template v-if="responseCategory === 'api'">
            <section class="network-metrics" aria-label="接口响应统计">
              <div><span>观察到</span><strong>{{ apiNetworkSummary.observed }}</strong></div>
              <div><span>已记录</span><strong>{{ apiNetworkSummary.recorded }}</strong></div>
              <div><span>通过</span><strong>{{ apiNetworkSummary.passed }}</strong></div>
              <div><span>失败</span><strong class="is-danger">{{ apiNetworkSummary.failed }}</strong></div>
              <div><span>警告</span><strong class="is-warning">{{ apiNetworkSummary.warnings }}</strong></div>
              <div><span>已截断</span><strong>{{ apiNetworkSummary.dropped }}</strong></div>
            </section>

            <p v-if="apiNetworkSummary.dropped" class="network-drop-warning">
              有 {{ apiNetworkSummary.dropped }} 条接口记录因容量限制未保存，失败记录已优先保留。
            </p>

            <section class="api-response-section">
              <header class="api-response-heading">
                <div>
                  <h3>业务接口调用明细</h3>
                  <p>按实际响应时间排序，共 {{ apiResponses.length }} 条，每页最多 {{ API_PAGE_SIZE }} 条。</p>
                </div>
                <el-button
                  v-if="pagedApiResponses.length"
                  text
                  :icon="allApiResponsesExpanded() ? ArrowUpBold : ArrowDownBold"
                  @click="toggleApiResponses"
                >
                  {{ allApiResponsesExpanded() ? '收起本页' : '展开本页' }}
                </el-button>
              </header>

              <div v-if="apiResponses.length" class="api-response-list">
                <details
                  v-for="response in pagedApiResponses"
                  :key="response.key"
                  class="api-response-item"
                  :open="expandedApiResponseKeys.has(response.key)"
                  @toggle="syncApiResponseState(response.key, $event)"
                >
                  <summary>
                    <span class="api-response-item__caret" aria-hidden="true" />
                    <span class="api-response-item__method" :class="`is-${response.method.toLowerCase()}`">{{ response.method }}</span>
                    <span class="api-response-item__identity">
                      <code>{{ response.name }}</code>
                      <small>{{ response.phase || response.scriptName }}<template v-if="response.phase"> · {{ response.scriptName }}</template></small>
                    </span>
                    <el-tag :type="apiStatusType(response)" size="small" effect="plain">
                      {{ apiStatusLabel(response) }}
                    </el-tag>
                    <span class="api-response-item__duration">{{ formatDuration(response.durationMs) }}</span>
                  </summary>

                  <div v-if="expandedApiResponseKeys.has(response.key)" class="api-response-detail">
                    <section class="api-response-url">
                      <strong>{{ response.method === 'GET' ? '请求地址（含 GET 参数）' : '请求地址' }}</strong>
                      <code>{{ response.url }}</code>
                      <small v-if="response.pageUrl">页面：{{ response.pageUrl }}</small>
                      <small v-if="response.frameUrl && response.frameUrl !== response.pageUrl">Frame：{{ response.frameUrl }}</small>
                    </section>
                    <div class="api-response-payloads">
                      <section v-if="!['GET', 'HEAD'].includes(response.method)">
                        <strong>请求参数</strong>
                        <pre v-if="hasPayload(response, 'requestBody')">{{ formatJson(response.requestBody) }}</pre>
                        <p v-else>该请求没有请求体</p>
                      </section>
                      <section>
                        <strong>响应结果</strong>
                        <pre v-if="hasPayload(response, 'responseBody')">{{ formatJson(response.responseBody) }}</pre>
                        <pre v-else-if="formatNetworkError(response)">{{ formatNetworkError(response) }}</pre>
                        <pre v-else-if="response.bodyReadError">响应正文采集失败：{{ response.bodyReadError }}</pre>
                        <p v-else>接口未返回响应体</p>
                      </section>
                    </div>
                  </div>
                </details>
              </div>
              <el-empty v-else description="该运行记录没有接口响应明细" />
              <el-pagination
                v-if="apiResponses.length > API_PAGE_SIZE"
                v-model:current-page="apiPage"
                class="resource-pagination"
                :page-size="API_PAGE_SIZE"
                :total="apiResponses.length"
                layout="prev, pager, next"
                background
              />
            </section>
          </template>

          <template v-else>
            <section class="network-metrics" aria-label="资源加载统计">
              <div><span>观察到</span><strong>{{ resourceNetworkSummary.observed }}</strong></div>
              <div><span>已记录</span><strong>{{ resourceNetworkSummary.recorded }}</strong></div>
              <div><span>通过</span><strong>{{ resourceNetworkSummary.passed }}</strong></div>
              <div><span>失败</span><strong class="is-danger">{{ resourceNetworkSummary.failed }}</strong></div>
              <div><span>警告</span><strong class="is-warning">{{ resourceNetworkSummary.warnings }}</strong></div>
              <div><span>已截断</span><strong>{{ resourceNetworkSummary.dropped }}</strong></div>
            </section>

            <p v-if="resourceNetworkSummary.dropped" class="network-drop-warning">
              有 {{ resourceNetworkSummary.dropped }} 条资源记录因容量限制未保存，失败记录已优先保留。
            </p>

            <section class="resource-response-section">
              <header class="resource-response-heading">
                <div>
                  <h3>页面资源加载明细</h3>
                  <p>当前显示 {{ filteredResourceResponses.length }} / {{ resourceResponses.length }} 条，每页最多 {{ RESOURCE_PAGE_SIZE }} 条。</p>
                </div>
                <div class="resource-filters">
                  <label>
                    <span>结果</span>
                    <select v-model="resourceOutcomeFilter" aria-label="筛选资源加载结果">
                      <option value="failed">失败（{{ failedResourceResponseCount }}）</option>
                      <option value="passed">通过（{{ successfulResourceResponseCount }}）</option>
                      <option value="all">全部（{{ resourceResponses.length }}）</option>
                    </select>
                  </label>
                  <label>
                    <span>类型</span>
                    <select v-model="resourceTypeFilter" aria-label="筛选资源类型">
                      <option value="all">全部类型</option>
                      <option v-for="resourceType in resourceTypes" :key="resourceType" :value="resourceType">
                        {{ resourceType }}
                      </option>
                    </select>
                  </label>
                </div>
              </header>

              <div v-if="pagedResourceResponses.length" class="resource-response-list" role="table" aria-label="资源加载明细">
                <div class="resource-response-columns" role="row">
                  <span role="columnheader">脚本 / 阶段</span>
                  <span role="columnheader">类型</span>
                  <span role="columnheader">资源与错误</span>
                  <span role="columnheader">状态</span>
                  <span role="columnheader">耗时</span>
                </div>
                <article
                  v-for="response in pagedResourceResponses"
                  :key="response.key"
                  class="resource-response-row"
                  :class="{ 'is-failed': !response.ok }"
                  role="row"
                >
                  <div role="cell">
                    <strong>{{ response.phase || '未标记阶段' }}</strong>
                    <small>{{ response.scriptName }}</small>
                  </div>
                  <div role="cell">
                    <code>{{ response.resourceType }}</code>
                    <small>{{ response.mimeType || '-' }}</small>
                    <small v-if="response.failureKind">{{ response.failureKind }}</small>
                    <small v-if="response.fromCache">浏览器缓存</small>
                    <small v-else-if="response.fromServiceWorker">Service Worker</small>
                  </div>
                  <div class="resource-response-row__identity" role="cell">
                    <code :title="response.url">{{ response.url }}</code>
                    <small v-if="response.pageUrl" :title="response.pageUrl">页面：{{ response.pageUrl }}</small>
                    <small v-if="response.frameUrl && response.frameUrl !== response.pageUrl" :title="response.frameUrl">Frame：{{ response.frameUrl }}</small>
                    <p v-if="response.error">{{ response.error }}</p>
                    <ul v-if="standaloneNetworkDiagnostics(response).length" class="resource-response-row__diagnostics">
                      <li v-for="diagnostic in standaloneNetworkDiagnostics(response)" :key="diagnostic">{{ diagnostic }}</li>
                    </ul>
                  </div>
                  <div role="cell">
                    <el-tag :type="resourceStatusType(response)" size="small" effect="plain">
                      {{ response.status || 'NO RESPONSE' }}
                    </el-tag>
                  </div>
                  <div class="resource-response-row__duration" role="cell">
                    {{ formatDuration(response.durationMs) }}
                  </div>
                </article>
              </div>
              <el-empty v-else :description="resourceEmptyDescription" />

              <el-pagination
                v-if="filteredResourceResponses.length > RESOURCE_PAGE_SIZE"
                v-model:current-page="resourcePage"
                class="resource-pagination"
                :page-size="RESOURCE_PAGE_SIZE"
                :total="filteredResourceResponses.length"
                layout="prev, pager, next"
                background
              />
            </section>
          </template>
        </el-tab-pane>

        <el-tab-pane name="scripts" lazy>
          <template #label><span class="tab-label"><el-icon><Files /></el-icon>脚本结果</span></template>
          <section class="table-section">
            <el-table :data="record.scripts" row-key="recordId" class="detail-table">
              <el-table-column type="expand">
                <template #default="scope">
                  <div class="script-expanded">
                    <div v-if="scope.row.error" class="script-error"><strong>{{ scope.row.status === 'partial' ? '未通过断言' : '失败原因' }}</strong><p>{{ scope.row.error }}</p></div>
                    <div v-if="scope.row.output" class="script-output"><strong>结果数据</strong><pre>{{ formatJson(scope.row.output) }}</pre></div>
                    <el-empty v-if="!scope.row.error && !scope.row.output" description="该脚本没有额外结果数据" :image-size="52" />
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="脚本" min-width="300">
                <template #default="scope">
                  <div class="script-cell"><strong>{{ scope.row.name }}</strong><code>{{ scope.row.entryFile }}</code></div>
                </template>
              </el-table-column>
              <el-table-column label="标签" min-width="190">
                <template #default="scope">
                  <div class="tag-list"><el-tag v-for="tag in scope.row.tags" :key="tag" size="small" effect="plain">{{ tag }}</el-tag></div>
                </template>
              </el-table-column>
              <el-table-column label="状态" width="124">
                <template #default="scope"><el-tag :type="scriptStatusMap[scope.row.status as RunScriptStatus].type" :class="{ 'status-tag--partial': scope.row.status === 'partial' }" effect="light">{{ scriptStatusMap[scope.row.status as RunScriptStatus].label }}</el-tag></template>
              </el-table-column>
              <el-table-column label="日志" width="90" align="center">
                <template #default="scope">{{ scope.row.logs.length }}</template>
              </el-table-column>
              <el-table-column label="耗时" width="132">
                <template #default="scope">{{ formatDuration(scope.row.durationMs) }}</template>
              </el-table-column>
            </el-table>
          </section>
        </el-tab-pane>

        <el-tab-pane name="logs" lazy>
          <template #label><span class="tab-label"><el-icon><Document /></el-icon>执行日志</span></template>
          <section class="log-panel">
            <div class="log-toolbar">
              <el-input v-model="logKeyword" clearable aria-label="搜索执行日志" placeholder="搜索日志内容或脚本" />
              <el-select v-model="logLevel" aria-label="筛选日志级别">
                <el-option label="全部级别" value="all" />
                <el-option label="INFO" value="info" />
                <el-option label="SUCCESS" value="success" />
                <el-option label="WARNING" value="warning" />
                <el-option label="ERROR" value="error" />
              </el-select>
              <span>{{ filteredLogs.length }} / {{ record.logs.length }} 条</span>
            </div>
            <div v-if="filteredLogs.length" class="log-stream">
              <div v-for="log in filteredLogs" :key="log.id" class="log-line">
                <time>{{ formatTime(log.timestamp) }}</time>
                <span class="log-line__level" :class="`is-${log.level}`">{{ log.level.toUpperCase() }}</span>
                <span class="log-line__scope">{{ scopeLabels[log.scope] }}</span>
                <div>
                  <p><strong v-if="log.scriptName">[{{ log.scriptName }}]</strong>{{ log.message }}</p>
                  <pre v-if="log.details">{{ formatJson(log.details) }}</pre>
                </div>
              </div>
            </div>
            <el-empty v-else description="没有符合条件的日志" />
          </section>
        </el-tab-pane>

        <el-tab-pane v-if="screenshots.length" name="screenshots" lazy>
          <template #label><span class="tab-label"><el-icon><Picture /></el-icon>截图查看</span></template>
          <section class="screenshot-section" aria-label="本次执行截图">
            <header class="section-heading">
              <div><h3>截图列表</h3></div>
              <span>{{ screenshots.length }} 张</span>
            </header>
            <div class="screenshot-list" role="list">
              <article
                v-for="(screenshot, index) in screenshots"
                :key="screenshot.key"
                class="screenshot-row"
                role="listitem"
              >
                <el-image
                  class="screenshot-thumbnail"
                  :src="screenshot.url"
                  :alt="`${screenshot.scriptName}执行截图`"
                  fit="cover"
                  :preview-src-list="screenshotUrls"
                  :initial-index="index"
                  preview-teleported
                  hide-on-click-modal
                >
                  <template #error>
                    <span class="screenshot-thumbnail__error"><el-icon><Picture /></el-icon></span>
                  </template>
                </el-image>
                <div class="screenshot-cell screenshot-cell--script">
                  <span>所属脚本</span>
                  <strong>{{ screenshot.scriptName }}</strong>
                  <code>{{ screenshot.scriptEntryFile }}</code>
                </div>
                <div class="screenshot-cell">
                  <span>功能</span>
                  <strong>{{ screenshot.featureName }}</strong>
                </div>
                <div class="screenshot-cell screenshot-cell--assertion">
                  <span>触发断言</span>
                  <p>{{ screenshot.assertionName }}</p>
                </div>
                <div class="screenshot-cell screenshot-cell--path">
                  <span>本地路径</span>
                  <el-tooltip :content="screenshot.absolutePath" placement="top" :show-after="300">
                    <button
                      type="button"
                      class="screenshot-path-button"
                      :disabled="revealingScreenshotKeys.has(screenshot.key)"
                      :aria-busy="revealingScreenshotKeys.has(screenshot.key)"
                      :aria-label="`在文件夹中显示并选中：${screenshot.absolutePath}`"
                      @click="revealScreenshot(screenshot)"
                    >
                      <code>{{ screenshot.absolutePath }}</code>
                      <el-icon
                        aria-hidden="true"
                        :class="{ 'is-loading': revealingScreenshotKeys.has(screenshot.key) }"
                      >
                        <Loading v-if="revealingScreenshotKeys.has(screenshot.key)" />
                        <FolderOpened v-else />
                      </el-icon>
                    </button>
                  </el-tooltip>
                </div>
              </article>
            </div>
          </section>
        </el-tab-pane>

        <el-tab-pane name="analysis" lazy>
          <template #label><span class="tab-label"><el-icon><DataAnalysis /></el-icon>数据分析</span></template>
          <section class="analysis-metrics">
            <div><span>小断言通过率</span><strong>{{ assertionAnalysis.passRate }}%</strong><el-progress :percentage="assertionAnalysis.passRate" :stroke-width="7" :show-text="false" /></div>
            <div><span>大断言</span><strong>{{ assertionAnalysis.passedModules }} / {{ assertionAnalysis.moduleTotal }}</strong><p>失败 {{ assertionAnalysis.failedModules }} 个模块</p></div>
            <div><span>小断言</span><strong>{{ assertionAnalysis.passed }} / {{ assertionAnalysis.total }}</strong><p>按实际执行顺序采集</p></div>
            <div><span>失败小断言</span><strong>{{ assertionAnalysis.failed }}</strong><p>任一失败会使所属大断言失败</p></div>
          </section>

          <div v-if="assertionAnalysis.total">
            <p v-if="assertionAnalysis.legacy" class="legacy-analysis-note">
              该历史记录创建于结构化断言功能上线前，当前结果由原执行日志兼容还原；重新运行脚本后可查看完整 expect 小断言。
            </p>

            <section class="assertion-charts" aria-label="断言统计图">
              <div class="assertion-chart-section">
                <header class="section-heading"><div><h3>大断言健康度</h3><p>每个模块内通过与失败的小断言数量，红色越多越需要优先处理。</p></div></header>
                <AssertionModuleChart :groups="assertionAnalysis.groups" />
              </div>
              <div class="assertion-chart-section assertion-chart-section--outcome">
                <header class="section-heading"><div><h3>小断言结果分布</h3><p>本批次所有已执行断言的通过与失败占比。</p></div></header>
                <AssertionOutcomeChart
                  :passed="assertionAnalysis.passed"
                  :failed="assertionAnalysis.failed"
                  :pass-rate="assertionAnalysis.passRate"
                />
              </div>
            </section>

            <section class="assertion-detail-section">
              <header class="section-heading">
                <div><h3>断言执行详情</h3><p>按大断言分组展示，子断言保持实际执行顺序。</p></div>
              </header>
              <div class="assertion-columns">
                <div class="assertion-column assertion-column--passed">
                  <header>
                    <div><el-icon><CircleCheck /></el-icon><strong>成功</strong></div>
                    <div class="assertion-column__heading-meta">
                      <el-button
                        text
                        size="small"
                        class="assertion-column__toggle"
                        :disabled="!assertionAnalysis.successGroups.length"
                        :icon="assertionGroupsAreExpanded(assertionAnalysis.successGroups) ? ArrowUpBold : ArrowDownBold"
                        @click="toggleAssertionGroups(assertionAnalysis.successGroups)"
                      >
                        {{ assertionGroupsAreExpanded(assertionAnalysis.successGroups) ? '收起全部' : '展开全部' }}
                      </el-button>
                      <span>{{ assertionAnalysis.successGroups.length }} 个大断言</span>
                    </div>
                  </header>
                  <div v-if="assertionAnalysis.successGroups.length" class="assertion-group-list">
                    <details
                      v-for="group in assertionAnalysis.successGroups"
                      :key="group.id"
                      :open="isAssertionGroupExpanded(group.id)"
                      class="assertion-group"
                      @toggle="syncAssertionGroupState(group.id, $event)"
                    >
                      <summary>
                        <span class="assertion-group__caret" aria-hidden="true" />
                        <span><strong>{{ group.name }}</strong><small>{{ group.scriptName }}</small></span>
                        <em>{{ group.passed }} / {{ group.assertions.length }}</em>
                      </summary>
                      <div v-if="isAssertionGroupExpanded(group.id)" class="assertion-children">
                        <div v-for="assertion in pagedAssertions(group)" :key="assertion.id" class="assertion-child" :class="`is-${assertion.status}`">
                          <span class="assertion-child__sequence">{{ assertion.order + 1 }}</span>
                          <el-icon><component :is="assertion.status === 'passed' ? CircleCheck : CircleClose" /></el-icon>
                          <div><p>{{ assertion.name }}</p><small>{{ assertion.matcher }} · {{ assertion.durationMs }} ms</small><pre v-if="assertion.error">{{ assertion.error }}</pre></div>
                        </div>
                        <el-pagination
                          v-if="group.assertions.length > ASSERTION_PAGE_SIZE"
                          :current-page="assertionGroupPage(group)"
                          class="resource-pagination"
                          :page-size="ASSERTION_PAGE_SIZE"
                          :total="group.assertions.length"
                          layout="prev, pager, next"
                          background
                          @update:current-page="setAssertionGroupPage(group, $event)"
                        />
                      </div>
                    </details>
                  </div>
                  <div v-else class="assertion-column__empty">暂无成功的大断言</div>
                </div>

                <div class="assertion-column assertion-column--failed">
                  <header>
                    <div><el-icon><CircleClose /></el-icon><strong>失败</strong></div>
                    <div class="assertion-column__heading-meta">
                      <el-button
                        text
                        size="small"
                        class="assertion-column__toggle"
                        :disabled="!assertionAnalysis.failedGroups.length"
                        :icon="assertionGroupsAreExpanded(assertionAnalysis.failedGroups) ? ArrowUpBold : ArrowDownBold"
                        @click="toggleAssertionGroups(assertionAnalysis.failedGroups)"
                      >
                        {{ assertionGroupsAreExpanded(assertionAnalysis.failedGroups) ? '收起全部' : '展开全部' }}
                      </el-button>
                      <span>{{ assertionAnalysis.failedGroups.length }} 个大断言</span>
                    </div>
                  </header>
                  <div v-if="assertionAnalysis.failedGroups.length" class="assertion-group-list">
                    <details
                      v-for="group in assertionAnalysis.failedGroups"
                      :key="group.id"
                      :open="isAssertionGroupExpanded(group.id)"
                      class="assertion-group"
                      @toggle="syncAssertionGroupState(group.id, $event)"
                    >
                      <summary>
                        <span class="assertion-group__caret" aria-hidden="true" />
                        <span><strong>{{ group.name }}</strong><small>{{ group.scriptName }}</small></span>
                        <em>{{ group.failed }} 条失败</em>
                      </summary>
                      <div v-if="isAssertionGroupExpanded(group.id)" class="assertion-children">
                        <div v-for="assertion in pagedAssertions(group)" :key="assertion.id" class="assertion-child" :class="`is-${assertion.status}`">
                          <span class="assertion-child__sequence">{{ assertion.order + 1 }}</span>
                          <el-icon><component :is="assertion.status === 'passed' ? CircleCheck : CircleClose" /></el-icon>
                          <div><p>{{ assertion.name }}</p><small>{{ assertion.matcher }} · {{ assertion.durationMs }} ms</small><pre v-if="assertion.error">{{ assertion.error }}</pre></div>
                        </div>
                        <el-pagination
                          v-if="group.assertions.length > ASSERTION_PAGE_SIZE"
                          :current-page="assertionGroupPage(group)"
                          class="resource-pagination"
                          :page-size="ASSERTION_PAGE_SIZE"
                          :total="group.assertions.length"
                          layout="prev, pager, next"
                          background
                          @update:current-page="setAssertionGroupPage(group, $event)"
                        />
                      </div>
                    </details>
                  </div>
                  <div v-else class="assertion-column__empty">本批次没有失败的大断言</div>
                </div>
              </div>
            </section>
          </div>

          <div v-else class="analysis-empty">
            <el-icon :size="28"><Warning /></el-icon>
            <strong>暂无可分析的断言</strong>
            <p>{{ record.error ?? '当前批次尚未执行到脚本断言。' }}</p>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
    <el-empty v-else description="运行记录不存在" />
  </el-drawer>
</template>

<style scoped>
.record-detail { min-width: 0; color: var(--color-text-primary, #1f2a44); }
.detail-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding: 0 0 16px; border-bottom: 1px solid var(--color-border, #e5ebf3); }
.detail-header__identity { min-width: 0; }
.detail-header__eyebrow { color: var(--color-primary, #2563eb); font-size: var(--font-caption); font-weight: 700; }
.detail-header h2 { margin: 5px 0 0; color: var(--color-text-primary, #1f2a44); font-size: var(--font-subtitle); overflow-wrap: anywhere; }
.detail-header p { margin: 5px 0 0; color: var(--color-text-secondary, #64748b); font-size: var(--font-sm); }
.detail-header__actions { display: flex; flex: 0 0 auto; align-items: center; gap: 10px; }

.detail-status { display: grid; grid-template-columns: 48px 1fr auto; align-items: center; gap: 13px; margin: 16px 0 4px; padding: 13px 15px; color: #166534; border: 1px solid #bbf7d0; border-left: 4px solid var(--color-success, #16a34a); border-radius: 5px; background: #f0fdf4; }
.detail-status--failed { color: #991b1b; border-color: #fecaca; border-left-color: var(--color-danger, #dc2626); background: #fef2f2; }
.detail-status--partial { color: var(--color-partial-ink, #1f2a44); border-color: #ffe97a; border-left-color: var(--color-partial, #FFD700); background: var(--color-partial-soft, #fffbe6); }
.detail-status--interrupted { color: var(--color-text-secondary, #64748b); border-color: var(--color-border, #e5ebf3); border-left-color: var(--color-text-muted, #94a3b8); background: var(--color-bg-subtle, #f8fafc); }
.detail-status--running { color: #92400e; border-color: #fde68a; border-left-color: var(--color-warning, #d97706); background: #fffbeb; }
.detail-status__icon { display: grid; width: 44px; height: 44px; place-items: center; color: #fff; background: var(--color-success, #16a34a); border-radius: 5px; }
.detail-status--failed .detail-status__icon { background: var(--color-danger, #dc2626); }
.detail-status--partial .detail-status__icon { color: var(--color-partial-ink, #1f2a44); background: var(--color-partial, #FFD700); }
.detail-status--running .detail-status__icon { background: var(--color-warning, #d97706); }
.detail-status--interrupted .detail-status__icon { background: var(--color-text-muted, #94a3b8); }
.detail-status strong, .detail-status p { margin: 0; }
.detail-status > div strong { font-size: var(--font-lg); }
.detail-status p { margin-top: 4px; font-size: var(--font-sm); line-height: 1.5; }
.detail-status__rate { font-size: var(--font-subtitle); }

.detail-tabs { margin-top: 8px; }
.tab-label { display: inline-flex; align-items: center; gap: 7px; font-size: var(--font-md); }
.metadata-grid { display: grid; overflow: hidden; border: 1px solid var(--color-border, #e5ebf3); border-radius: min(var(--radius-card, 6px), 8px); grid-template-columns: repeat(3, minmax(0, 1fr)); background: var(--color-surface, #fff); }
.metadata-grid > div { min-width: 0; min-height: 74px; padding: 12px 14px; border-right: 1px solid var(--color-border-light, #eef2f7); border-bottom: 1px solid var(--color-border-light, #eef2f7); }
.metadata-grid > div:nth-child(3n) { border-right: 0; }
.metadata-grid > div:nth-last-child(-n + 3) { border-bottom: 0; }
.metadata-grid span, .metadata-grid strong, .metadata-grid code { display: block; }
.metadata-grid span { margin-bottom: 6px; color: var(--color-text-muted, #94a3b8); font-size: var(--font-xs); }
.metadata-grid strong, .metadata-grid code { overflow: hidden; color: var(--color-text-primary, #1f2a44); font-size: var(--font-sm); text-overflow: ellipsis; white-space: nowrap; }
.metadata-grid code { color: var(--color-primary, #2563eb); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }

.section-block { margin-top: 18px; }
.section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
.section-heading h3, .section-heading p { margin: 0; }
.section-heading h3 { color: var(--color-text-primary, #1f2a44); font-size: var(--font-lg); }
.section-heading p { margin-top: 4px; color: var(--color-text-secondary, #64748b); font-size: var(--font-sm); }
.section-heading > span { color: var(--color-text-secondary, #64748b); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: var(--font-sm); }
.result-distribution { display: flex; height: 10px; overflow: hidden; border-radius: 3px; background: var(--color-border-light, #eef2f7); }
.result-distribution__passed { background: var(--color-success, #16a34a); }
.result-distribution__partial { background: var(--color-partial, #FFD700); }
.result-distribution__failed { background: var(--color-danger, #dc2626); }
.result-distribution__skipped { background: var(--color-text-muted, #94a3b8); }
.result-distribution__pending { background: var(--color-border, #e5ebf3); }
.distribution-legend { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 9px; color: var(--color-text-secondary, #64748b); font-size: var(--font-sm); }
.distribution-legend span { display: flex; align-items: center; gap: 7px; }
.distribution-legend i { width: 8px; height: 8px; border-radius: 2px; }
.distribution-legend .is-passed { background: var(--color-success, #16a34a); }
.distribution-legend .is-partial { background: var(--color-partial, #FFD700); }
.distribution-legend .is-failed { background: var(--color-danger, #dc2626); }
.distribution-legend .is-skipped { background: var(--color-text-muted, #94a3b8); }
.distribution-legend .is-pending { background: var(--color-border, #e5ebf3); }

.event-timeline { border-top: 1px solid var(--color-border, #e5ebf3); }
.event-row { display: grid; grid-template-columns: 88px 92px 80px 1fr; align-items: start; gap: 9px; min-height: 48px; padding: 9px 4px; border-bottom: 1px solid var(--color-border-light, #eef2f7); }
.event-row__level { display: inline-flex; align-items: center; gap: 6px; margin-top: 3px; color: var(--color-text-secondary, #64748b); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: var(--font-caption); font-weight: 700; }
.event-row__level i { width: 8px; height: 8px; flex: 0 0 8px; border-radius: 50%; background: var(--color-text-muted, #94a3b8); }
.event-row__level.is-success { color: var(--color-success, #16a34a); }
.event-row__level.is-success i { background: var(--color-success, #16a34a); }
.event-row__level.is-warning { color: var(--color-warning, #d97706); }
.event-row__level.is-warning i { background: var(--color-warning, #d97706); }
.event-row__level.is-error { color: var(--color-danger, #dc2626); }
.event-row__level.is-error i { background: var(--color-danger, #dc2626); }
.event-row time { margin-top: 3px; color: var(--color-text-muted, #94a3b8); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: var(--font-xs); }
.event-row p { margin: 2px 0 0; color: var(--color-text-primary, #1f2a44); font-size: var(--font-sm); line-height: 1.5; overflow-wrap: anywhere; }

.network-category-switch { display: inline-grid; grid-template-columns: repeat(2, minmax(110px, 1fr)); gap: 2px; padding: 3px; border: 1px solid var(--color-border, #e5ebf3); border-radius: 6px; background: var(--color-bg-subtle, #f8fafc); }
.network-category-switch button { display: inline-flex; min-height: 34px; align-items: center; justify-content: center; gap: 8px; padding: 6px 14px; color: var(--color-text-secondary, #64748b); border: 0; border-radius: 4px; background: transparent; cursor: pointer; font: inherit; font-size: var(--font-sm); }
.network-category-switch button:hover { color: var(--color-primary, #2563eb); }
.network-category-switch button.is-active { color: var(--color-primary, #2563eb); background: var(--color-surface, #fff); box-shadow: 0 1px 3px rgb(15 23 42 / 10%); font-weight: 600; }
.network-category-switch button span { min-width: 22px; padding: 1px 5px; color: inherit; border-radius: 4px; background: var(--color-border-light, #eef2f7); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: var(--font-caption); }
.network-metrics { display: grid; overflow: hidden; margin-top: 14px; border: 1px solid var(--color-border, #e5ebf3); border-radius: min(var(--radius-card, 6px), 8px); grid-template-columns: repeat(6, minmax(0, 1fr)); background: var(--color-surface, #fff); }
.network-metrics > div { min-width: 0; min-height: 70px; padding: 11px 13px; border-right: 1px solid var(--color-border-light, #eef2f7); }
.network-metrics > div:last-child { border-right: 0; }
.network-metrics span, .network-metrics strong { display: block; }
.network-metrics span { color: var(--color-text-muted, #94a3b8); font-size: var(--font-xs); }
.network-metrics strong { margin-top: 5px; color: var(--color-text-primary, #1f2a44); font-size: var(--font-lg); }
.network-metrics strong.is-danger { color: var(--color-danger, #dc2626); }
.network-metrics strong.is-warning { color: var(--color-warning, #d97706); }
.network-drop-warning { margin: 12px 0 0; padding: 9px 11px; color: #92400e; border-left: 3px solid var(--color-warning, #d97706); border-radius: 3px; background: #fffbeb; font-size: var(--font-xs); line-height: 1.5; }
.api-response-section { margin-top: 18px; }
.api-response-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
.api-response-heading h3, .api-response-heading p { margin: 0; }
.api-response-heading h3 { color: var(--color-text-primary, #1f2a44); font-size: var(--font-lg); }
.api-response-heading p { margin-top: 4px; color: var(--color-text-secondary, #64748b); font-size: var(--font-sm); }
.api-response-list { overflow: hidden; border: 1px solid var(--color-border, #e5ebf3); border-radius: min(var(--radius-card, 6px), 8px); background: var(--color-surface, #fff); }
.api-response-item { border-bottom: 1px solid var(--color-border-light, #eef2f7); }
.api-response-item:last-child { border-bottom: 0; }
.api-response-item summary { display: grid; min-height: 58px; grid-template-columns: 12px 66px minmax(0, 1fr) 104px 86px; align-items: center; gap: 10px; padding: 8px 12px; cursor: pointer; list-style: none; }
.api-response-item summary::-webkit-details-marker { display: none; }
.api-response-item summary:hover { background: var(--color-bg-subtle, #f8fafc); }
.api-response-item__caret { width: 7px; height: 7px; border-right: 1.5px solid var(--color-text-muted, #94a3b8); border-bottom: 1.5px solid var(--color-text-muted, #94a3b8); transform: rotate(-45deg); transition: transform 160ms ease; }
.api-response-item[open] .api-response-item__caret { transform: rotate(45deg) translate(-1px, -1px); }
.api-response-item__method { display: inline-flex; width: 62px; min-height: 24px; align-items: center; justify-content: center; color: var(--color-primary, #2563eb); border: 1px solid #bfdbfe; border-radius: 4px; background: var(--color-primary-soft, #eff6ff); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: var(--font-caption); font-weight: 700; }
.api-response-item__method.is-post { color: #1d4ed8; border-color: #bfdbfe; background: #eff6ff; }
.api-response-item__method.is-put, .api-response-item__method.is-patch { color: #92400e; border-color: #fde68a; background: #fffbeb; }
.api-response-item__method.is-delete { color: #991b1b; border-color: #fecaca; background: #fef2f2; }
.api-response-item__identity { min-width: 0; }
.api-response-item__identity code, .api-response-item__identity small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.api-response-item__identity code { color: var(--color-text-primary, #1f2a44); font-size: var(--font-sm); }
.api-response-item__identity small { margin-top: 3px; color: var(--color-text-muted, #94a3b8); font-size: var(--font-caption); }
.api-response-item__duration { color: var(--color-text-secondary, #64748b); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: var(--font-xs); text-align: right; }
.api-response-detail { padding: 13px 16px 16px 96px; border-top: 1px solid var(--color-border-light, #eef2f7); background: var(--color-bg-subtle, #f8fafc); }
.api-response-url strong, .api-response-payloads strong { display: block; margin-bottom: 6px; color: var(--color-text-secondary, #64748b); font-size: var(--font-xs); }
.api-response-url code { display: block; padding: 9px 11px; color: var(--color-primary, #2563eb); border-left: 3px solid var(--color-primary, #2563eb); border-radius: 3px; background: var(--color-primary-soft, #eff6ff); font-size: var(--font-xs); line-height: 1.5; overflow-wrap: anywhere; }
.api-response-url small { display: block; overflow: hidden; margin-top: 6px; color: var(--color-text-muted, #94a3b8); font-size: var(--font-caption); text-overflow: ellipsis; white-space: nowrap; }
.api-response-payloads { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 14px; }
.api-response-payloads > section { min-width: 0; }
.api-response-payloads pre { max-height: 360px; min-height: 88px; overflow: auto; margin: 0; padding: 11px 12px; color: #dbeafe; border-radius: 4px; background: #172033; font-size: var(--font-xs); line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.api-response-payloads p { min-height: 88px; margin: 0; padding: 11px 12px; color: var(--color-text-secondary, #64748b); border-radius: 4px; background: var(--color-bg-page, #f6f8fc); font-size: var(--font-xs); }

.resource-response-section { margin-top: 18px; }
.resource-response-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
.resource-response-heading h3, .resource-response-heading p { margin: 0; }
.resource-response-heading h3 { color: var(--color-text-primary, #1f2a44); font-size: var(--font-lg); }
.resource-response-heading p { margin-top: 4px; color: var(--color-text-secondary, #64748b); font-size: var(--font-sm); }
.resource-filters { display: flex; flex: 0 0 auto; align-items: flex-end; gap: 8px; }
.resource-filters label { display: grid; gap: 4px; }
.resource-filters label > span { color: var(--color-text-muted, #94a3b8); font-size: var(--font-caption); }
.resource-filters select { min-width: 128px; height: 34px; padding: 0 28px 0 9px; color: var(--color-text-primary, #1f2a44); border: 1px solid var(--color-border, #e5ebf3); border-radius: 4px; outline: none; background: var(--color-surface, #fff); font-size: var(--font-xs); }
.resource-filters select:focus { border-color: var(--color-primary, #2563eb); box-shadow: 0 0 0 2px rgb(37 99 235 / 12%); }
.resource-response-list { overflow: hidden; border: 1px solid var(--color-border, #e5ebf3); border-radius: min(var(--radius-card, 6px), 8px); background: var(--color-surface, #fff); }
.resource-response-columns, .resource-response-row { display: grid; min-width: 0; grid-template-columns: minmax(130px, 0.8fr) minmax(94px, 0.55fr) minmax(260px, 2.4fr) 108px 84px; align-items: center; gap: 12px; }
.resource-response-columns { min-height: 38px; padding: 7px 12px; color: var(--color-text-muted, #94a3b8); border-bottom: 1px solid var(--color-border-light, #eef2f7); background: var(--color-bg-subtle, #f8fafc); font-size: var(--font-caption); font-weight: 600; }
.resource-response-row { min-height: 70px; padding: 10px 12px; border-bottom: 1px solid var(--color-border-light, #eef2f7); }
.resource-response-row:last-child { border-bottom: 0; }
.resource-response-row:hover { background: var(--color-bg-subtle, #f8fafc); }
.resource-response-row.is-failed { box-shadow: inset 3px 0 0 var(--color-danger, #dc2626); }
.resource-response-row > div { min-width: 0; }
.resource-response-row strong, .resource-response-row small, .resource-response-row code { display: block; min-width: 0; }
.resource-response-row strong { overflow-wrap: anywhere; color: var(--color-text-primary, #1f2a44); font-size: var(--font-xs); }
.resource-response-row small { overflow: hidden; margin-top: 4px; color: var(--color-text-muted, #94a3b8); font-size: var(--font-caption); text-overflow: ellipsis; white-space: nowrap; }
.resource-response-row code { overflow: hidden; color: var(--color-primary, #2563eb); font-size: var(--font-xs); text-overflow: ellipsis; white-space: nowrap; }
.resource-response-row__identity > code { color: var(--color-text-primary, #1f2a44); }
.resource-response-row__identity p { margin: 5px 0 0; color: var(--color-danger, #dc2626); font-size: var(--font-caption); line-height: 1.45; overflow-wrap: anywhere; }
.resource-response-row__diagnostics { margin: 5px 0 0; padding-left: 16px; color: var(--color-danger, #dc2626); font-size: var(--font-caption); line-height: 1.45; overflow-wrap: anywhere; }
.resource-response-row__duration { color: var(--color-text-secondary, #64748b); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: var(--font-xs); text-align: right; }
.resource-pagination { display: flex; justify-content: flex-end; margin-top: 14px; }

.table-section { overflow: hidden; border: 1px solid var(--color-border, #e5ebf3); border-radius: min(var(--radius-card, 6px), 8px); background: var(--color-surface, #fff); }
.detail-table { width: 100%; }
.script-cell { min-width: 0; }
.script-cell strong, .script-cell code { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.script-cell strong { color: var(--color-text-primary, #1f2a44); font-size: var(--font-md); }
.script-cell code { margin-top: 5px; color: var(--color-text-secondary, #64748b); font-size: var(--font-xs); }
.tag-list { display: flex; flex-wrap: wrap; gap: 5px; }
.script-expanded { padding: 4px 20px 16px 58px; }
.script-error { padding: 10px 12px; color: #991b1b; border-left: 3px solid var(--color-danger, #dc2626); border-radius: 3px; background: #fef2f2; }
.script-error strong, .script-error p { margin: 0; }
.script-error p { margin-top: 5px; line-height: 1.55; }
.script-output { margin-top: 12px; }
.script-output > strong { color: var(--color-text-secondary, #64748b); font-size: var(--font-sm); }
.script-output pre { max-height: 260px; overflow: auto; margin: 8px 0 0; padding: 12px 14px; color: #dbeafe; border-radius: 4px; background: #172033; font-size: var(--font-sm); line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }

.log-panel { min-width: 0; }
.log-toolbar { display: grid; grid-template-columns: minmax(240px, 1fr) 160px auto; align-items: center; gap: 10px; margin-bottom: 12px; }
.log-toolbar > span { color: var(--color-text-secondary, #64748b); font-size: var(--font-sm); }
.log-stream { max-height: calc(100dvh - 330px); min-height: 380px; overflow: auto; border: 1px solid #334155; border-radius: 5px; background: #172033; }
.log-line { display: grid; grid-template-columns: 92px 84px 76px 1fr; gap: 10px; padding: 9px 12px; color: #cbd5e1; border-bottom: 1px solid rgb(255 255 255 / 7%); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: var(--font-xs); line-height: 1.5; }
.log-line:last-child { border-bottom: 0; }
.log-line time { color: #94a3b8; }
.log-line__level { font-weight: 700; }
.log-line__level.is-success { color: #4ade80; }
.log-line__level.is-warning { color: #fbbf24; }
.log-line__level.is-error { color: #f87171; }
.log-line__scope { color: #60a5fa; }
.log-line p { margin: 0; overflow-wrap: anywhere; }
.log-line p strong { margin-right: 7px; color: #94a3b8; }
.log-line pre { margin: 7px 0 0; padding: 8px 10px; color: #cbd5e1; border-left: 2px solid #3b82f6; background: rgb(255 255 255 / 4%); white-space: pre-wrap; overflow-wrap: anywhere; }

.screenshot-section { min-width: 0; }
.screenshot-list { overflow: hidden; border: 1px solid var(--color-border, #e5ebf3); border-radius: min(var(--radius-card, 6px), 8px); background: var(--color-surface, #fff); }
.screenshot-row { display: grid; min-width: 0; grid-template-columns: 124px minmax(150px, 0.75fr) minmax(120px, 0.55fr) minmax(210px, 1fr) minmax(220px, 1.25fr); align-items: center; gap: 14px; padding: 12px 14px; border-bottom: 1px solid var(--color-border-light, #eef2f7); }
.screenshot-row:last-child { border-bottom: 0; }
.screenshot-row:hover { background: var(--color-bg-subtle, #f8fafc); }
.screenshot-thumbnail { width: 120px; height: 76px; cursor: zoom-in; border: 1px solid var(--color-border, #e5ebf3); border-radius: 4px; background: var(--color-bg-subtle, #f8fafc); }
.screenshot-thumbnail__error { display: grid; width: 100%; height: 100%; place-items: center; color: var(--color-text-muted, #94a3b8); }
.screenshot-cell { min-width: 0; }
.screenshot-cell > span, .screenshot-cell > strong, .screenshot-cell > p, .screenshot-cell > code { display: block; min-width: 0; }
.screenshot-cell > span { margin-bottom: 5px; color: var(--color-text-muted, #94a3b8); font-size: var(--font-caption); }
.screenshot-cell > strong, .screenshot-cell > p { margin: 0; color: var(--color-text-primary, #1f2a44); font-size: var(--font-sm); line-height: 1.5; overflow-wrap: anywhere; }
.screenshot-cell--script > code { overflow: hidden; margin-top: 4px; color: var(--color-text-secondary, #64748b); font-size: var(--font-caption); text-overflow: ellipsis; white-space: nowrap; }
.screenshot-cell--path .el-tooltip__trigger { display: block; min-width: 0; }
.screenshot-cell--path code { display: block; overflow: hidden; color: var(--color-primary, #2563eb); font-size: var(--font-xs); text-overflow: ellipsis; white-space: nowrap; }
.screenshot-cell--path .screenshot-path-button { display: flex; width: 100%; min-width: 0; align-items: center; gap: 6px; padding: 2px 0; border: 0; outline: none; background: transparent; cursor: pointer; text-align: left; }
.screenshot-path-button code { flex: 1; }
.screenshot-path-button .el-icon { flex: 0 0 auto; color: var(--color-primary, #2563eb); font-size: 15px; }
.screenshot-path-button:hover code { text-decoration: underline; }
.screenshot-path-button:focus-visible { border-radius: 3px; box-shadow: 0 0 0 2px rgb(37 99 235 / 25%); }
.screenshot-path-button:disabled { cursor: wait; opacity: 0.65; }
.screenshot-path-button .is-loading { animation: screenshot-path-loading 1s linear infinite; }
@keyframes screenshot-path-loading { to { transform: rotate(360deg); } }

.analysis-metrics { display: grid; overflow: hidden; border: 1px solid var(--color-border, #e5ebf3); border-radius: min(var(--radius-card, 6px), 8px); grid-template-columns: repeat(4, minmax(0, 1fr)); background: var(--color-surface, #fff); }
.analysis-metrics > div { min-width: 0; min-height: 108px; padding: 14px 15px; border-right: 1px solid var(--color-border-light, #eef2f7); }
.analysis-metrics > div:last-child { border-right: 0; }
.analysis-metrics span, .analysis-metrics strong, .analysis-metrics p { display: block; margin: 0; }
.analysis-metrics span { color: var(--color-text-muted, #94a3b8); font-size: var(--font-xs); }
.analysis-metrics strong { overflow: hidden; margin-top: 7px; color: var(--color-text-primary, #1f2a44); font-size: var(--font-lg); text-overflow: ellipsis; white-space: nowrap; }
.analysis-metrics p { margin-top: 5px; color: var(--color-text-secondary, #64748b); font-size: var(--font-xs); }
.analysis-metrics .el-progress { margin-top: 12px; }
.analysis-empty { display: grid; min-height: 180px; place-items: center; align-content: center; color: var(--color-primary, #2563eb); border-top: 1px solid var(--color-border, #e5ebf3); }
.analysis-empty strong { margin-top: 8px; color: var(--color-text-primary, #1f2a44); }
.analysis-empty p { margin: 5px 0 0; color: var(--color-text-secondary, #64748b); font-size: var(--font-sm); text-align: center; overflow-wrap: anywhere; }
.legacy-analysis-note { margin: 16px 0 0; padding: 9px 11px; color: #92400e; border-left: 3px solid var(--color-warning, #d97706); border-radius: 3px; background: #fffbeb; font-size: var(--font-xs); line-height: 1.5; }
.assertion-charts { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(280px, 0.55fr); gap: 24px; margin-top: 24px; }
.assertion-chart-section { min-width: 0; padding-bottom: 8px; border-bottom: 1px solid var(--color-border, #e5ebf3); }
.assertion-chart-section--outcome { border-left: 1px solid var(--color-border-light, #eef2f7); padding-left: 24px; }
.assertion-detail-section { margin-top: 28px; }
.assertion-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.assertion-column { min-width: 0; overflow: hidden; border: 1px solid var(--color-border, #e5ebf3); border-radius: min(var(--radius-card, 6px), 8px); background: var(--color-surface, #fff); }
.assertion-column > header { display: flex; min-height: 48px; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 12px; border-bottom: 1px solid var(--color-border-light, #eef2f7); }
.assertion-column > header > div { display: flex; align-items: center; gap: 8px; }
.assertion-column > header strong { color: var(--color-text-primary, #1f2a44); font-size: var(--font-md); }
.assertion-column > header span { color: var(--color-text-secondary, #64748b); font-size: var(--font-xs); }
.assertion-column__heading-meta { justify-content: flex-end; }
.assertion-column__toggle { min-width: 82px; padding-inline: 7px; }
.assertion-column--passed > header { color: var(--color-success, #16a34a); background: #f0fdf4; }
.assertion-column--failed > header { color: var(--color-danger, #dc2626); background: #fef2f2; }
.assertion-group-list { max-height: 680px; overflow-y: auto; }
.assertion-group { border-bottom: 1px solid var(--color-border-light, #eef2f7); }
.assertion-group:last-child { border-bottom: 0; }
.assertion-group summary { display: grid; min-height: 54px; grid-template-columns: 12px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 8px 12px; cursor: pointer; list-style: none; }
.assertion-group summary::-webkit-details-marker { display: none; }
.assertion-group summary:hover { background: var(--color-bg-subtle, #f8fafc); }
.assertion-group__caret { width: 7px; height: 7px; border-right: 1.5px solid var(--color-text-muted, #94a3b8); border-bottom: 1.5px solid var(--color-text-muted, #94a3b8); transform: rotate(-45deg); transition: transform 160ms ease; }
.assertion-group[open] .assertion-group__caret { transform: rotate(45deg) translate(-1px, -1px); }
.assertion-group summary > span:nth-child(2) { min-width: 0; }
.assertion-group summary strong, .assertion-group summary small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.assertion-group summary strong { color: var(--color-text-primary, #1f2a44); font-size: var(--font-sm); }
.assertion-group summary small { margin-top: 3px; color: var(--color-text-muted, #94a3b8); font-size: var(--font-caption); }
.assertion-group summary em { color: var(--color-text-secondary, #64748b); font-size: var(--font-xs); font-style: normal; white-space: nowrap; }
.assertion-column--failed .assertion-group summary em { color: var(--color-danger, #dc2626); }
.assertion-children { border-top: 1px solid var(--color-border-light, #eef2f7); background: var(--color-bg-subtle, #f8fafc); }
.assertion-child { display: grid; grid-template-columns: 25px 18px minmax(0, 1fr); gap: 7px; padding: 9px 11px; border-bottom: 1px solid var(--color-border-light, #eef2f7); }
.assertion-child:last-child { border-bottom: 0; }
.assertion-child__sequence { color: var(--color-text-muted, #94a3b8); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: var(--font-caption); }
.assertion-child > .el-icon { margin-top: 2px; color: var(--color-success, #16a34a); }
.assertion-child.is-failed > .el-icon { color: var(--color-danger, #dc2626); }
.assertion-child p, .assertion-child small { margin: 0; }
.assertion-child p { color: var(--color-text-primary, #1f2a44); font-size: var(--font-xs); line-height: 1.5; overflow-wrap: anywhere; }
.assertion-child small { display: block; margin-top: 3px; color: var(--color-text-muted, #94a3b8); font-size: var(--font-caption); }
.assertion-child pre { max-height: 120px; overflow: auto; margin: 7px 0 0; padding: 8px 9px; color: #991b1b; border-left: 2px solid var(--color-danger, #dc2626); border-radius: 3px; background: #fef2f2; font-size: var(--font-caption); line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
.assertion-column__empty { display: grid; min-height: 120px; place-items: center; padding: 14px; color: var(--color-text-muted, #94a3b8); font-size: var(--font-sm); text-align: center; }

:deep(.detail-tabs > .el-tabs__header) { margin-bottom: 16px; }
:deep(.detail-tabs .el-tabs__item) { color: var(--color-text-secondary, #64748b); font-size: var(--font-sm); }
:deep(.detail-tabs .el-tabs__item.is-active) { color: var(--color-primary, #2563eb); font-weight: 600; }
:deep(.detail-tabs .el-tabs__active-bar) { background: var(--color-primary, #2563eb); }
:deep(.detail-tabs .el-tabs__nav-wrap::after) { background: var(--color-border-light, #eef2f7); }
:deep(.detail-table) { --el-table-border-color: var(--color-border-light, #eef2f7); --el-table-header-bg-color: var(--color-bg-subtle, #f8fafc); --el-table-row-hover-bg-color: var(--color-primary-soft, #eff6ff); font-size: var(--font-sm); }
:deep(.detail-table th.el-table__cell) { height: 46px; color: var(--color-text-secondary, #64748b); font-size: var(--font-sm); }
:deep(.detail-table td.el-table__cell) { height: 62px; }

@media (max-width: 900px) {
  .metadata-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .metadata-grid > div, .metadata-grid > div:nth-child(3n), .metadata-grid > div:nth-last-child(-n + 3) { border-right: 1px solid var(--color-border-light, #eef2f7); border-bottom: 1px solid var(--color-border-light, #eef2f7); }
  .metadata-grid > div:nth-child(2n) { border-right: 0; }
  .metadata-grid > div:nth-last-child(-n + 2) { border-bottom: 0; }
  .analysis-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .analysis-metrics > div { border-bottom: 1px solid var(--color-border-light, #eef2f7); }
  .analysis-metrics > div:nth-child(2n) { border-right: 0; }
  .analysis-metrics > div:nth-last-child(-n + 2) { border-bottom: 0; }
  .assertion-charts, .assertion-columns { grid-template-columns: 1fr; }
  .assertion-chart-section--outcome { border-left: 0; padding-left: 0; }
  .event-row { grid-template-columns: 82px 82px 72px 1fr; }
  .network-metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .network-metrics > div:nth-child(3n) { border-right: 0; }
  .network-metrics > div:nth-child(-n + 3) { border-bottom: 1px solid var(--color-border-light, #eef2f7); }
  .api-response-payloads { grid-template-columns: 1fr; }
  .resource-response-heading { align-items: flex-start; flex-direction: column; }
  .resource-response-columns, .resource-response-row { grid-template-columns: minmax(120px, 0.75fr) minmax(84px, 0.5fr) minmax(220px, 2fr) 86px; }
  .resource-response-columns > :last-child { display: none; }
  .resource-response-row__duration { display: none; }
  .screenshot-row { grid-template-columns: 120px repeat(2, minmax(0, 1fr)); align-items: start; }
  .screenshot-thumbnail { grid-row: 1 / span 2; }
  .screenshot-cell--assertion, .screenshot-cell--path { grid-column: span 1; }
}

@media (max-width: 620px) {
  .detail-header { flex-direction: column; }
  .detail-header__actions { width: 100%; justify-content: space-between; }
  .detail-status { grid-template-columns: 44px 1fr; }
  .detail-status__icon { width: 42px; height: 42px; }
  .detail-status__rate { grid-column: 2; }
  .metadata-grid, .analysis-metrics { grid-template-columns: 1fr; }
  .metadata-grid > div, .metadata-grid > div:nth-child(2n), .metadata-grid > div:nth-last-child(-n + 2), .analysis-metrics > div, .analysis-metrics > div:nth-child(2n), .analysis-metrics > div:nth-last-child(-n + 2) { border-right: 0; border-bottom: 1px solid var(--color-border-light, #eef2f7); }
  .metadata-grid > div:last-child, .analysis-metrics > div:last-child { border-bottom: 0; }
  .event-row { grid-template-columns: 82px 80px 1fr; }
  .event-row .el-tag { display: none; }
  .network-category-switch { display: grid; width: 100%; }
  .network-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .network-metrics > div, .network-metrics > div:nth-child(3n) { min-height: 64px; border-right: 1px solid var(--color-border-light, #eef2f7); border-bottom: 1px solid var(--color-border-light, #eef2f7); }
  .network-metrics > div:nth-child(2n) { border-right: 0; }
  .network-metrics > div:nth-last-child(-n + 2) { border-bottom: 0; }
  .api-response-item summary { grid-template-columns: 12px 58px minmax(0, 1fr) 80px; }
  .api-response-item__method { width: 54px; }
  .api-response-item__duration { display: none; }
  .api-response-detail { padding-left: 14px; }
  .resource-filters { width: 100%; }
  .resource-filters label { min-width: 0; flex: 1; }
  .resource-filters select { width: 100%; min-width: 0; }
  .resource-response-list { overflow-x: auto; }
  .resource-response-columns, .resource-response-row { width: 680px; }
  .log-toolbar { grid-template-columns: 1fr 130px; }
  .log-toolbar > span { grid-column: 1 / -1; }
  .log-line { grid-template-columns: 76px 76px 1fr; }
  .log-line__scope { display: none; }
  .script-expanded { padding-left: 12px; }
  .screenshot-row { grid-template-columns: 96px minmax(0, 1fr); gap: 10px; padding: 10px; }
  .screenshot-thumbnail { width: 92px; height: 68px; grid-row: 1 / span 4; }
  .screenshot-cell--assertion, .screenshot-cell--path { grid-column: 2; }
  .assertion-group-list { max-height: none; }
  .assertion-column > header { align-items: flex-start; }
  .assertion-column__heading-meta { flex-wrap: wrap; }
}
</style>

<style>
.run-record-detail-drawer {
  --el-color-primary: var(--color-primary, #2563eb);
  border-left: 1px solid var(--color-border, #e5ebf3);
  background: var(--color-surface, #fff);
  box-shadow: -10px 0 30px rgb(15 23 42 / 10%);
}

.run-record-detail-drawer .el-drawer__body {
  padding: 18px 22px 26px;
  overflow-y: auto;
  background: var(--color-surface, #fff);
}
@media (max-width: 620px) { .run-record-detail-drawer .el-drawer__body { padding: 16px 14px 24px; } }
</style>
