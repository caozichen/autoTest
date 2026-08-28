<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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
  Monitor,
  Warning,
} from '@element-plus/icons-vue'

import AssertionModuleChart from '@/components/AssertionModuleChart.vue'
import AssertionOutcomeChart from '@/components/AssertionOutcomeChart.vue'
import type {
  RunRecord,
  RunRecordLogLevel,
  RunRecordLogScope,
  RunRecordStatus,
  RunScriptStatus,
} from '@/domain/run-record'
import { buildRunAssertionAnalysis } from '@/services/run-records/run-assertion-analysis'
import type { ScriptApiResponse } from '@/domain/script'

interface ApiResponseView extends ScriptApiResponse {
  key: string
  scriptName: string
}

const props = defineProps<{
  modelValue: boolean
  record: RunRecord | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const activeTab = ref('overview')
const logLevel = ref<'all' | RunRecordLogLevel>('all')
const logKeyword = ref('')
const expandedAssertionGroupIds = ref<Set<string>>(new Set())
const expandedApiResponseKeys = ref<Set<string>>(new Set())

const statusMap: Record<RunRecordStatus, { label: string; type: 'success' | 'warning' | 'danger' | 'info' }> = {
  running: { label: '执行中', type: 'warning' },
  passed: { label: '全部通过', type: 'success' },
  failed: { label: '执行失败', type: 'danger' },
  partial: { label: '部分通过', type: 'warning' },
  interrupted: { label: '已中断', type: 'info' },
}

const scriptStatusMap: Record<RunScriptStatus, { label: string; type: 'success' | 'warning' | 'danger' | 'info' }> = {
  queued: { label: '排队中', type: 'info' },
  passed: { label: '已通过', type: 'success' },
  failed: { label: '失败', type: 'danger' },
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
const successfulApiResponseCount = computed(() => apiResponses.value.filter((response) => response.ok).length)
const failedApiResponseCount = computed(() => apiResponses.value.length - successfulApiResponseCount.value)

const statusIcon = computed(() => {
  if (props.record?.status === 'passed') return CircleCheck
  if (props.record?.status === 'failed') return CircleClose
  if (props.record?.status === 'partial' || props.record?.status === 'interrupted') return Warning
  return Clock
})

const drawerTitle = computed(() => props.record
  ? `运行记录详情：${props.record.name}`
  : '运行记录详情')

watch(
  () => [props.modelValue, props.record?.id] as const,
  ([visible]) => {
    if (!visible) return
    activeTab.value = 'overview'
    logLevel.value = 'all'
    logKeyword.value = ''
    expandedAssertionGroupIds.value = new Set(assertionAnalysis.value.groups.map((group) => group.id))
    expandedApiResponseKeys.value = new Set(apiResponses.value.slice(0, 1).map((response) => response.key))
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
  return apiResponses.value.length > 0
    && apiResponses.value.every((response) => expandedApiResponseKeys.value.has(response.key))
}

function toggleApiResponses(): void {
  expandedApiResponseKeys.value = allApiResponsesExpanded()
    ? new Set()
    : new Set(apiResponses.value.map((response) => response.key))
}

function syncApiResponseState(key: string, event: Event): void {
  const details = event.currentTarget
  if (!(details instanceof HTMLDetailsElement)) return
  const next = new Set(expandedApiResponseKeys.value)
  if (details.open) next.add(key)
  else next.delete(key)
  expandedApiResponseKeys.value = next
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

function hasPayload(response: ApiResponseView, key: 'requestBody' | 'responseBody'): boolean {
  return Object.prototype.hasOwnProperty.call(response, key) && response[key] !== null
}

function apiStatusType(response: ApiResponseView): 'success' | 'danger' | 'info' {
  if (response.status === 0) return 'info'
  return response.ok ? 'success' : 'danger'
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
          <el-tag :type="statusMap[record.status].type" effect="light" size="large">
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
            共执行 {{ record.counts.total }} 个脚本，通过 {{ record.counts.passed }} 个，失败 {{ record.counts.failed }} 个。
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
              <span>{{ record.counts.passed + record.counts.failed + record.counts.skipped }} / {{ record.counts.total }}</span>
            </header>
            <div class="result-distribution" role="img" :aria-label="`通过 ${record.counts.passed}，失败 ${record.counts.failed}，未执行 ${record.counts.skipped}`">
              <span v-if="record.counts.passed" aria-hidden="true" class="result-distribution__passed" :style="{ flex: record.counts.passed }" />
              <span v-if="record.counts.failed" aria-hidden="true" class="result-distribution__failed" :style="{ flex: record.counts.failed }" />
              <span v-if="record.counts.skipped" aria-hidden="true" class="result-distribution__skipped" :style="{ flex: record.counts.skipped }" />
            </div>
            <div class="distribution-legend">
              <span><i class="is-passed" />通过 {{ record.counts.passed }}</span>
              <span><i class="is-failed" />失败 {{ record.counts.failed }}</span>
              <span><i class="is-skipped" />未执行 {{ record.counts.skipped }}</span>
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

        <el-tab-pane name="responses">
          <template #label><span class="tab-label"><el-icon><Connection /></el-icon>响应结果</span></template>

          <section class="api-metrics" aria-label="接口响应统计">
            <div><span>接口调用</span><strong>{{ apiResponses.length }}</strong></div>
            <div><span>成功响应</span><strong>{{ successfulApiResponseCount }}</strong></div>
            <div><span>失败响应</span><strong>{{ failedApiResponseCount }}</strong></div>
          </section>

          <section class="api-response-section">
            <header class="api-response-heading">
              <div>
                <h3>业务接口调用明细</h3>
                <p>按实际响应时间排序，共 {{ apiResponses.length }} 条。</p>
              </div>
              <el-button
                v-if="apiResponses.length"
                text
                :icon="allApiResponsesExpanded() ? ArrowUpBold : ArrowDownBold"
                @click="toggleApiResponses"
              >
                {{ allApiResponsesExpanded() ? '全部收起' : '全部展开' }}
              </el-button>
            </header>

            <div v-if="apiResponses.length" class="api-response-list">
              <details
                v-for="response in apiResponses"
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
                    <small>{{ response.scriptName }}</small>
                  </span>
                  <el-tag :type="apiStatusType(response)" size="small" effect="plain">
                    {{ response.status || 'NO RESPONSE' }}
                  </el-tag>
                  <span class="api-response-item__duration">{{ formatDuration(response.durationMs) }}</span>
                </summary>

                <div class="api-response-detail">
                  <section class="api-response-url">
                    <strong>{{ response.method === 'GET' ? '请求地址（含 GET 参数）' : '请求地址' }}</strong>
                    <code>{{ response.url }}</code>
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
                      <p v-else>{{ response.error || '接口未返回响应体' }}</p>
                    </section>
                  </div>
                </div>
              </details>
            </div>
            <el-empty v-else description="该运行记录没有接口响应数据，重新运行脚本后即可采集" />
          </section>
        </el-tab-pane>

        <el-tab-pane name="scripts">
          <template #label><span class="tab-label"><el-icon><Files /></el-icon>脚本结果</span></template>
          <section class="table-section">
            <el-table :data="record.scripts" row-key="recordId" class="detail-table">
              <el-table-column type="expand">
                <template #default="scope">
                  <div class="script-expanded">
                    <div v-if="scope.row.error" class="script-error"><strong>失败原因</strong><p>{{ scope.row.error }}</p></div>
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
                <template #default="scope"><el-tag :type="scriptStatusMap[scope.row.status as RunScriptStatus].type" effect="light">{{ scriptStatusMap[scope.row.status as RunScriptStatus].label }}</el-tag></template>
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

        <el-tab-pane name="logs">
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

        <el-tab-pane name="analysis">
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
                <div><h3>断言执行详情</h3><p>大断言默认全部展开，点击模块标题可折叠；子断言保持实际执行顺序。</p></div>
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
                      <div class="assertion-children">
                        <div v-for="assertion in group.assertions" :key="assertion.id" class="assertion-child" :class="`is-${assertion.status}`">
                          <span class="assertion-child__sequence">{{ assertion.order + 1 }}</span>
                          <el-icon><component :is="assertion.status === 'passed' ? CircleCheck : CircleClose" /></el-icon>
                          <div><p>{{ assertion.name }}</p><small>{{ assertion.matcher }} · {{ assertion.durationMs }} ms</small><pre v-if="assertion.error">{{ assertion.error }}</pre></div>
                        </div>
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
                      <div class="assertion-children">
                        <div v-for="assertion in group.assertions" :key="assertion.id" class="assertion-child" :class="`is-${assertion.status}`">
                          <span class="assertion-child__sequence">{{ assertion.order + 1 }}</span>
                          <el-icon><component :is="assertion.status === 'passed' ? CircleCheck : CircleClose" /></el-icon>
                          <div><p>{{ assertion.name }}</p><small>{{ assertion.matcher }} · {{ assertion.durationMs }} ms</small><pre v-if="assertion.error">{{ assertion.error }}</pre></div>
                        </div>
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
.detail-status--partial { color: #92400e; border-color: #fde68a; border-left-color: var(--color-warning, #d97706); background: #fffbeb; }
.detail-status--interrupted { color: var(--color-text-secondary, #64748b); border-color: var(--color-border, #e5ebf3); border-left-color: var(--color-text-muted, #94a3b8); background: var(--color-bg-subtle, #f8fafc); }
.detail-status--running { color: #92400e; border-color: #fde68a; border-left-color: var(--color-warning, #d97706); background: #fffbeb; }
.detail-status__icon { display: grid; width: 44px; height: 44px; place-items: center; color: #fff; background: var(--color-success, #16a34a); border-radius: 5px; }
.detail-status--failed .detail-status__icon { background: var(--color-danger, #dc2626); }
.detail-status--partial .detail-status__icon, .detail-status--running .detail-status__icon { background: var(--color-warning, #d97706); }
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
.result-distribution__failed { background: var(--color-danger, #dc2626); }
.result-distribution__skipped { background: var(--color-text-muted, #94a3b8); }
.distribution-legend { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 9px; color: var(--color-text-secondary, #64748b); font-size: var(--font-sm); }
.distribution-legend span { display: flex; align-items: center; gap: 7px; }
.distribution-legend i { width: 8px; height: 8px; border-radius: 2px; }
.distribution-legend .is-passed { background: var(--color-success, #16a34a); }
.distribution-legend .is-failed { background: var(--color-danger, #dc2626); }
.distribution-legend .is-skipped { background: var(--color-text-muted, #94a3b8); }

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

.api-metrics { display: grid; border: 1px solid var(--color-border, #e5ebf3); border-radius: min(var(--radius-card, 6px), 8px); grid-template-columns: repeat(3, minmax(0, 1fr)); background: var(--color-surface, #fff); }
.api-metrics > div { min-width: 0; min-height: 74px; padding: 12px 14px; border-right: 1px solid var(--color-border-light, #eef2f7); }
.api-metrics > div:last-child { border-right: 0; }
.api-metrics span, .api-metrics strong { display: block; }
.api-metrics span { color: var(--color-text-muted, #94a3b8); font-size: var(--font-xs); }
.api-metrics strong { margin-top: 6px; color: var(--color-text-primary, #1f2a44); font-size: var(--font-lg); }
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
.api-response-payloads { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 14px; }
.api-response-payloads > section { min-width: 0; }
.api-response-payloads pre { max-height: 360px; min-height: 88px; overflow: auto; margin: 0; padding: 11px 12px; color: #dbeafe; border-radius: 4px; background: #172033; font-size: var(--font-xs); line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.api-response-payloads p { min-height: 88px; margin: 0; padding: 11px 12px; color: var(--color-text-secondary, #64748b); border-radius: 4px; background: var(--color-bg-page, #f6f8fc); font-size: var(--font-xs); }

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
  .api-response-payloads { grid-template-columns: 1fr; }
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
  .api-metrics { grid-template-columns: 1fr; }
  .api-metrics > div { min-height: 70px; border-right: 0; border-bottom: 1px solid var(--color-border-light, #eef2f7); }
  .api-metrics > div:last-child { border-bottom: 0; }
  .api-response-item summary { grid-template-columns: 12px 58px minmax(0, 1fr) 80px; }
  .api-response-item__method { width: 54px; }
  .api-response-item__duration { display: none; }
  .api-response-detail { padding-left: 14px; }
  .log-toolbar { grid-template-columns: 1fr 130px; }
  .log-toolbar > span { grid-column: 1 / -1; }
  .log-line { grid-template-columns: 76px 76px 1fr; }
  .log-line__scope { display: none; }
  .script-expanded { padding-left: 12px; }
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
