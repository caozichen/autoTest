<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  CircleCheck,
  CircleClose,
  Clock,
  Close,
  DataAnalysis,
  Document,
  Files,
  Monitor,
  Warning,
} from '@element-plus/icons-vue'

import type {
  RunRecord,
  RunRecordLogLevel,
  RunRecordLogScope,
  RunRecordStatus,
  RunScriptStatus,
} from '@/domain/run-record'

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

const slowestScript = computed(() => {
  const id = props.record?.analysis.slowestScriptRecordId
  return props.record?.scripts.find((script) => script.recordId === id) ?? null
})

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
  },
)

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

function formatJson(value: Record<string, unknown> | undefined): string {
  return value ? JSON.stringify(value, null, 2) : ''
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
            <div><span>批次通过率</span><strong>{{ record.analysis.passRate }}%</strong><el-progress :percentage="record.analysis.passRate" :stroke-width="7" :show-text="false" /></div>
            <div><span>平均脚本耗时</span><strong>{{ formatDuration(record.analysis.averageDurationMs) }}</strong><p>仅统计已返回结果的脚本</p></div>
            <div><span>最慢脚本</span><strong>{{ slowestScript?.name ?? '-' }}</strong><p>{{ formatDuration(slowestScript?.durationMs ?? null) }}</p></div>
            <div><span>错误日志</span><strong>{{ record.analysis.logCounts.error }}</strong><p>警告 {{ record.analysis.logCounts.warning }} 条</p></div>
          </section>

          <section class="analysis-grid">
            <div class="analysis-section">
              <header class="section-heading"><div><h3>脚本耗时对比</h3><p>定位批次中的慢脚本。</p></div></header>
              <div class="duration-ranking">
                <div v-for="script in [...record.scripts].filter((item) => item.durationMs !== null).sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))" :key="script.recordId">
                  <div><span>{{ script.name }}</span><strong>{{ formatDuration(script.durationMs) }}</strong></div>
                  <el-progress
                    :percentage="slowestScript?.durationMs ? Math.round(((script.durationMs ?? 0) / slowestScript.durationMs) * 100) : 0"
                    :stroke-width="6"
                    :show-text="false"
                    :color="script.status === 'failed' ? '#d95858' : '#1aa58f'"
                  />
                </div>
              </div>
            </div>

            <div class="analysis-section">
              <header class="section-heading"><div><h3>失败归因</h3><p>按错误信息聚合失败脚本。</p></div></header>
              <div v-if="record.analysis.failureGroups.length" class="failure-groups">
                <div v-for="group in record.analysis.failureGroups" :key="group.reason">
                  <span>{{ group.count }}</span><p>{{ group.reason }}</p>
                </div>
              </div>
              <div v-else-if="record.failureStage === 'login' || record.failureStage === 'runner'" class="analysis-empty analysis-empty--failure">
                <el-icon :size="28"><Warning /></el-icon>
                <strong>{{ failureStageLabel(record.failureStage) }}失败</strong>
                <p>{{ record.error ?? '批次在脚本执行前终止，没有脚本失败数据可供聚合。' }}</p>
              </div>
              <div v-else class="analysis-empty"><el-icon :size="28"><CircleCheck /></el-icon><strong>未发现脚本失败</strong><p>当前批次没有可聚合的失败原因。</p></div>
            </div>
          </section>
        </el-tab-pane>
      </el-tabs>
    </div>
    <el-empty v-else description="运行记录不存在" />
  </el-drawer>
</template>

<style scoped>
.record-detail { min-width: 0; }
.detail-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; padding: 2px 0 22px; border-bottom: 1px solid #e5eaed; }
.detail-header__identity { min-width: 0; }
.detail-header__eyebrow { color: #159c8d; font-size: var(--font-caption); font-weight: 700; }
.detail-header h2 { margin: 7px 0 0; color: #1d2a31; font-size: var(--font-subtitle); overflow-wrap: anywhere; }
.detail-header p { margin: 7px 0 0; color: #65737a; font-size: var(--font-sm); }
.detail-header__actions { display: flex; flex: 0 0 auto; align-items: center; gap: 10px; }

.detail-status { display: grid; grid-template-columns: 52px 1fr auto; align-items: center; gap: 15px; margin: 20px 0 4px; padding: 16px 18px; color: #256b61; border: 1px solid #cde7e2; border-left: 4px solid #1aa58f; background: #f0f8f6; }
.detail-status--failed { color: #9b4141; border-color: #efd2d2; border-left-color: #d95858; background: #fff5f5; }
.detail-status--partial { color: #8c611b; border-color: #ead9b7; border-left-color: #d69a32; background: #fffaf0; }
.detail-status--interrupted { color: #5f6e76; border-color: #dbe2e5; border-left-color: #89969c; background: #f6f8f9; }
.detail-status--running { color: #8c611b; border-color: #ead9b7; border-left-color: #d69a32; background: #fffaf0; }
.detail-status__icon { display: grid; width: 48px; height: 48px; place-items: center; color: #fff; background: #1aa58f; border-radius: 5px; }
.detail-status--failed .detail-status__icon { background: #d95858; }
.detail-status--partial .detail-status__icon, .detail-status--running .detail-status__icon { background: #d69a32; }
.detail-status--interrupted .detail-status__icon { background: #89969c; }
.detail-status strong, .detail-status p { margin: 0; }
.detail-status > div strong { font-size: var(--font-lg); }
.detail-status p { margin-top: 4px; font-size: var(--font-sm); line-height: 1.5; }
.detail-status__rate { font-size: var(--font-subtitle); }

.detail-tabs { margin-top: 10px; }
.tab-label { display: inline-flex; align-items: center; gap: 7px; font-size: var(--font-md); }
.metadata-grid { display: grid; overflow: hidden; border: 1px solid #e2e8ea; grid-template-columns: repeat(3, minmax(0, 1fr)); background: #fff; }
.metadata-grid > div { min-width: 0; min-height: 86px; padding: 15px 17px; border-right: 1px solid #edf1f3; border-bottom: 1px solid #edf1f3; }
.metadata-grid > div:nth-child(3n) { border-right: 0; }
.metadata-grid > div:nth-last-child(-n + 3) { border-bottom: 0; }
.metadata-grid span, .metadata-grid strong, .metadata-grid code { display: block; }
.metadata-grid span { margin-bottom: 7px; color: #66747c; font-size: var(--font-xs); }
.metadata-grid strong, .metadata-grid code { overflow: hidden; color: #334149; font-size: var(--font-sm); text-overflow: ellipsis; white-space: nowrap; }
.metadata-grid code { color: #1d746a; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }

.section-block { margin-top: 22px; }
.section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
.section-heading h3, .section-heading p { margin: 0; }
.section-heading h3 { color: #35434a; font-size: var(--font-lg); }
.section-heading p { margin-top: 4px; color: #65737a; font-size: var(--font-sm); }
.section-heading > span { color: #65737a; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: var(--font-sm); }
.result-distribution { display: flex; height: 13px; overflow: hidden; border-radius: 3px; background: #edf1f3; }
.result-distribution__passed { background: #1aaa8f; }
.result-distribution__failed { background: #d95858; }
.result-distribution__skipped { background: #a3afb5; }
.distribution-legend { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 11px; color: #65737a; font-size: var(--font-sm); }
.distribution-legend span { display: flex; align-items: center; gap: 7px; }
.distribution-legend i { width: 8px; height: 8px; border-radius: 2px; }
.distribution-legend .is-passed { background: #1aaa8f; }
.distribution-legend .is-failed { background: #d95858; }
.distribution-legend .is-skipped { background: #a3afb5; }

.event-timeline { border-top: 1px solid #e4e9eb; }
.event-row { display: grid; grid-template-columns: 88px 92px 80px 1fr; align-items: start; gap: 9px; min-height: 52px; padding: 11px 4px; border-bottom: 1px solid #edf1f3; }
.event-row__level { display: inline-flex; align-items: center; gap: 6px; margin-top: 3px; color: #5f6d74; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: var(--font-caption); font-weight: 700; }
.event-row__level i { width: 9px; height: 9px; flex: 0 0 9px; border-radius: 50%; background: #7b898f; }
.event-row__level.is-success { color: #14745f; }
.event-row__level.is-success i { background: #1aaa8f; }
.event-row__level.is-warning { color: #805b1e; }
.event-row__level.is-warning i { background: #d69a32; }
.event-row__level.is-error { color: #9b4141; }
.event-row__level.is-error i { background: #d95858; }
.event-row time { margin-top: 3px; color: #65737a; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: var(--font-xs); }
.event-row p { margin: 2px 0 0; color: #435159; font-size: var(--font-sm); line-height: 1.55; overflow-wrap: anywhere; }

.table-section { overflow: hidden; border: 1px solid #e1e7ea; }
.detail-table { width: 100%; }
.script-cell { min-width: 0; }
.script-cell strong, .script-cell code { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.script-cell strong { color: #334149; font-size: var(--font-md); }
.script-cell code { margin-top: 6px; color: #65737a; font-size: var(--font-xs); }
.tag-list { display: flex; flex-wrap: wrap; gap: 5px; }
.script-expanded { padding: 4px 20px 16px 58px; }
.script-error { padding: 12px 14px; color: #9f4141; border-left: 3px solid #d95858; background: #fff4f4; }
.script-error strong, .script-error p { margin: 0; }
.script-error p { margin-top: 5px; line-height: 1.55; }
.script-output { margin-top: 12px; }
.script-output > strong { color: #56656c; font-size: var(--font-sm); }
.script-output pre { max-height: 260px; overflow: auto; margin: 8px 0 0; padding: 13px 15px; color: #d3e7e3; background: #17252d; font-size: var(--font-sm); line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }

.log-panel { min-width: 0; }
.log-toolbar { display: grid; grid-template-columns: minmax(240px, 1fr) 160px auto; align-items: center; gap: 10px; margin-bottom: 12px; }
.log-toolbar > span { color: #65737a; font-size: var(--font-sm); }
.log-stream { max-height: calc(100dvh - 330px); min-height: 380px; overflow: auto; border: 1px solid #2b3c44; background: #152229; }
.log-line { display: grid; grid-template-columns: 92px 84px 76px 1fr; gap: 10px; padding: 10px 13px; color: #b8cbc7; border-bottom: 1px solid rgb(255 255 255 / 6%); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: var(--font-xs); line-height: 1.55; }
.log-line:last-child { border-bottom: 0; }
.log-line time { color: #82979d; }
.log-line__level { font-weight: 700; }
.log-line__level.is-success { color: #55d2a1; }
.log-line__level.is-warning { color: #e1b35f; }
.log-line__level.is-error { color: #f17a7a; }
.log-line__scope { color: #6bc9bb; }
.log-line p { margin: 0; overflow-wrap: anywhere; }
.log-line p strong { margin-right: 7px; color: #88a6ad; }
.log-line pre { margin: 7px 0 0; padding: 9px 11px; color: #bdd0cc; border-left: 2px solid #3b5b63; background: rgb(255 255 255 / 4%); white-space: pre-wrap; overflow-wrap: anywhere; }

.analysis-metrics { display: grid; border: 1px solid #e2e8ea; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.analysis-metrics > div { min-width: 0; min-height: 126px; padding: 17px 18px; border-right: 1px solid #edf1f3; }
.analysis-metrics > div:last-child { border-right: 0; }
.analysis-metrics span, .analysis-metrics strong, .analysis-metrics p { display: block; margin: 0; }
.analysis-metrics span { color: #65737a; font-size: var(--font-xs); }
.analysis-metrics strong { overflow: hidden; margin-top: 9px; color: #29373e; font-size: var(--font-lg); text-overflow: ellipsis; white-space: nowrap; }
.analysis-metrics p { margin-top: 7px; color: #65737a; font-size: var(--font-xs); }
.analysis-metrics .el-progress { margin-top: 12px; }
.analysis-grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(300px, 0.85fr); gap: 24px; margin-top: 24px; }
.analysis-section { min-width: 0; }
.duration-ranking { border-top: 1px solid #e4e9eb; }
.duration-ranking > div { padding: 12px 2px; border-bottom: 1px solid #edf1f3; }
.duration-ranking > div > div { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 8px; color: #536169; font-size: var(--font-sm); }
.duration-ranking strong { color: #344149; }
.failure-groups { border-top: 1px solid #e4e9eb; }
.failure-groups > div { display: grid; grid-template-columns: 36px 1fr; gap: 10px; padding: 12px 0; border-bottom: 1px solid #edf1f3; }
.failure-groups span { display: grid; width: 32px; height: 32px; place-items: center; color: #a24343; background: #fff0f0; font-weight: 700; }
.failure-groups p { margin: 5px 0 0; color: #59676e; font-size: var(--font-sm); line-height: 1.5; overflow-wrap: anywhere; }
.analysis-empty { display: grid; min-height: 190px; place-items: center; align-content: center; color: #18836f; border-top: 1px solid #e4e9eb; }
.analysis-empty strong { margin-top: 9px; color: #405058; }
.analysis-empty p { margin: 5px 0 0; color: #65737a; font-size: var(--font-sm); text-align: center; overflow-wrap: anywhere; }
.analysis-empty--failure { color: #a24343; }
.analysis-empty--failure strong { color: #8e3636; }

:deep(.detail-tabs > .el-tabs__header) { margin-bottom: 20px; }
:deep(.detail-table) { --el-table-border-color: #edf1f3; --el-table-header-bg-color: #fafbfb; font-size: var(--font-sm); }
:deep(.detail-table th.el-table__cell) { height: 54px; color: #65737a; font-size: var(--font-sm); }
:deep(.detail-table td.el-table__cell) { height: 72px; }

@media (max-width: 900px) {
  .metadata-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .metadata-grid > div, .metadata-grid > div:nth-child(3n), .metadata-grid > div:nth-last-child(-n + 3) { border-right: 1px solid #edf1f3; border-bottom: 1px solid #edf1f3; }
  .metadata-grid > div:nth-child(2n) { border-right: 0; }
  .metadata-grid > div:nth-last-child(-n + 2) { border-bottom: 0; }
  .analysis-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .analysis-metrics > div { border-bottom: 1px solid #edf1f3; }
  .analysis-metrics > div:nth-child(2n) { border-right: 0; }
  .analysis-metrics > div:nth-last-child(-n + 2) { border-bottom: 0; }
  .analysis-grid { grid-template-columns: 1fr; }
  .event-row { grid-template-columns: 82px 82px 72px 1fr; }
}

@media (max-width: 620px) {
  .detail-header { flex-direction: column; }
  .detail-header__actions { width: 100%; justify-content: space-between; }
  .detail-status { grid-template-columns: 44px 1fr; }
  .detail-status__icon { width: 42px; height: 42px; }
  .detail-status__rate { grid-column: 2; }
  .metadata-grid, .analysis-metrics { grid-template-columns: 1fr; }
  .metadata-grid > div, .metadata-grid > div:nth-child(2n), .metadata-grid > div:nth-last-child(-n + 2), .analysis-metrics > div, .analysis-metrics > div:nth-child(2n), .analysis-metrics > div:nth-last-child(-n + 2) { border-right: 0; border-bottom: 1px solid #edf1f3; }
  .metadata-grid > div:last-child, .analysis-metrics > div:last-child { border-bottom: 0; }
  .event-row { grid-template-columns: 82px 80px 1fr; }
  .event-row .el-tag { display: none; }
  .log-toolbar { grid-template-columns: 1fr 130px; }
  .log-toolbar > span { grid-column: 1 / -1; }
  .log-line { grid-template-columns: 76px 76px 1fr; }
  .log-line__scope { display: none; }
  .script-expanded { padding-left: 12px; }
}
</style>

<style>
.run-record-detail-drawer .el-drawer__body { padding: 22px 26px 30px; overflow-y: auto; }
@media (max-width: 620px) { .run-record-detail-drawer .el-drawer__body { padding: 16px 14px 24px; } }
</style>
