<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CircleCheck, Clock, DataAnalysis, RefreshRight, Search, View, Warning } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

import RunRecordDetailDrawer from '@/components/RunRecordDetailDrawer.vue'
import type { RunRecord, RunRecordStatus } from '@/domain/run-record'
import { services } from '@/services/container'

const records = ref<RunRecord[]>([])
const loading = ref(true)
const keyword = ref('')
const statusFilter = ref<'all' | RunRecordStatus>('all')
const environmentFilter = ref('all')
const currentPage = ref(1)
const pageSize = 8
const detailVisible = ref(false)
const detailRecord = ref<RunRecord | null>(null)
const detailLoadingId = ref('')
const recordsRefreshing = ref(false)
const pollIntervalMs = 3_000
let detailRequestSequence = 0
let pollTimer: number | undefined

const statusMap: Record<RunRecordStatus, { label: string; type: 'success' | 'warning' | 'danger' | 'info' }> = {
  running: { label: '执行中', type: 'warning' },
  passed: { label: '全部通过', type: 'success' },
  failed: { label: '执行失败', type: 'danger' },
  partial: { label: '部分通过', type: 'warning' },
  interrupted: { label: '已中断', type: 'info' },
}

const environments = computed(() => {
  const map = new Map(records.value.map((record) => [record.environment.id, record.environment]))
  return [...map.values()]
})

const summary = computed(() => {
  if (records.value.length === 0) {
    return { total: null, scriptCount: null, passed: null, attention: null, averagePassRate: null }
  }
  const finished = records.value.filter((record) => record.status !== 'running')
  const scriptCount = records.value.reduce((total, record) => total + record.counts.total, 0)
  const averagePassRate = finished.length
    ? Math.round(finished.reduce((total, record) => total + record.analysis.passRate, 0) / finished.length * 10) / 10
    : null
  return {
    total: records.value.length,
    scriptCount,
    passed: records.value.filter((record) => record.status === 'passed').length,
    attention: records.value.filter((record) => ['failed', 'partial', 'interrupted'].includes(record.status)).length,
    averagePassRate,
  }
})

const filteredRecords = computed(() => {
  const search = keyword.value.trim().toLowerCase()
  return records.value.filter((record) => {
    const matchesStatus = statusFilter.value === 'all' || record.status === statusFilter.value
    const matchesEnvironment = environmentFilter.value === 'all' || record.environment.id === environmentFilter.value
    const matchesSearch = !search || [
      record.displayId,
      record.name,
      record.environment.name,
      record.environment.code,
      record.error ?? '',
      ...record.scripts.flatMap((script) => [script.name, script.entryFile]),
    ].some((value) => value.toLowerCase().includes(search))
    return matchesStatus && matchesEnvironment && matchesSearch
  })
})

const pagedRecords = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  return filteredRecords.value.slice(start, start + pageSize)
})

const hasRunningRecord = computed(() => (
  records.value.some((record) => record.status === 'running') ||
  (detailVisible.value && detailRecord.value?.status === 'running')
))

watch([keyword, statusFilter, environmentFilter], () => {
  currentPage.value = 1
})

async function loadRecords(showSuccess = false, silent = false): Promise<void> {
  if (recordsRefreshing.value) return
  recordsRefreshing.value = true
  if (!silent) loading.value = true
  const openDetailId = detailVisible.value ? detailRecord.value?.id : undefined

  try {
    const [nextRecords, nextDetail] = await Promise.all([
      services.runRecords.list(),
      openDetailId ? services.runRecords.get(openDetailId) : Promise.resolve(null),
    ])
    records.value = nextRecords
    if (openDetailId && detailVisible.value && detailRecord.value?.id === openDetailId && nextDetail) {
      detailRecord.value = nextDetail
    }
    if (showSuccess) ElMessage.success('运行记录已刷新')
  } catch {
    if (!silent) ElMessage.error('运行记录加载失败')
  } finally {
    recordsRefreshing.value = false
    if (!silent) loading.value = false
  }
}

async function openDetail(record: RunRecord): Promise<void> {
  const requestSequence = ++detailRequestSequence
  detailLoadingId.value = record.id

  try {
    const detail = await services.runRecords.get(record.id)
    if (requestSequence !== detailRequestSequence) return
    if (!detail) {
      ElMessage.warning('运行记录不存在或已被清理')
      await loadRecords()
      return
    }
    detailRecord.value = detail
    detailVisible.value = true
  } catch {
    if (requestSequence === detailRequestSequence) ElMessage.error('运行记录详情加载失败')
  } finally {
    if (requestSequence === detailRequestSequence) detailLoadingId.value = ''
  }
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return '执行中'
  if (durationMs < 1_000) return `${durationMs} ms`
  const totalSeconds = Math.round(durationMs / 1_000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes ? `${minutes}分 ${seconds}秒` : `${seconds}秒`
}

onMounted(() => {
  void loadRecords()
  pollTimer = window.setInterval(() => {
    if (!hasRunningRecord.value || recordsRefreshing.value) return
    void loadRecords(false, true)
  }, pollIntervalMs)
})

onBeforeUnmount(() => {
  if (pollTimer !== undefined) window.clearInterval(pollTimer)
  detailRequestSequence += 1
})
</script>

<template>
  <div class="run-history-page">
    <header class="page-heading">
      <div>
        <p>TEST EXECUTION HISTORY</p>
        <h1>运行记录</h1>
        <span>按批次追踪脚本日志、执行结果与质量分析</span>
      </div>
      <el-button :icon="RefreshRight" :loading="loading" @click="loadRecords(true)">刷新记录</el-button>
    </header>

    <section class="metric-strip" aria-label="运行记录统计">
      <div><span class="metric-strip__icon is-total"><el-icon><Clock /></el-icon></span><p><span>运行批次</span><strong>{{ summary.total ?? '暂无数据' }}</strong></p></div>
      <div><span class="metric-strip__icon is-script"><el-icon><DataAnalysis /></el-icon></span><p><span>累计脚本</span><strong>{{ summary.scriptCount ?? '暂无数据' }}</strong></p></div>
      <div><span class="metric-strip__icon is-passed"><el-icon><CircleCheck /></el-icon></span><p><span>全部通过</span><strong>{{ summary.passed ?? '暂无数据' }}</strong></p></div>
      <div><span class="metric-strip__icon is-attention"><el-icon><Warning /></el-icon></span><p><span>需关注</span><strong>{{ summary.attention ?? '暂无数据' }}</strong><small>{{ summary.averagePassRate === null ? '平均通过率 暂无数据' : `平均通过率 ${summary.averagePassRate}%` }}</small></p></div>
    </section>

    <section class="record-panel">
      <div class="toolbar">
        <div class="toolbar__filters">
          <el-input v-model="keyword" :prefix-icon="Search" clearable aria-label="搜索运行记录" placeholder="搜索批次号、脚本或错误" class="search-input" />
          <el-select v-model="statusFilter" aria-label="筛选运行状态" class="status-select">
            <el-option label="全部状态" value="all" />
            <el-option v-for="(status, key) in statusMap" :key="key" :label="status.label" :value="key" />
          </el-select>
          <el-select v-model="environmentFilter" aria-label="筛选运行环境" class="environment-select">
            <el-option label="全部环境" value="all" />
            <el-option v-for="environment in environments" :key="environment.id" :label="`${environment.name} · ${environment.code}`" :value="environment.id" />
          </el-select>
        </div>
        <span class="toolbar__result" aria-live="polite">{{ filteredRecords.length }} 个批次</span>
      </div>

      <el-table v-loading="loading" :data="pagedRecords" row-key="id" class="record-table" empty-text="暂无数据">
        <el-table-column label="批次" min-width="310">
          <template #default="scope">
            <button
              class="record-identity"
              type="button"
              :disabled="Boolean(detailLoadingId)"
              :aria-busy="detailLoadingId === scope.row.id"
              @click="openDetail(scope.row)"
            >
              <code>{{ scope.row.displayId }}</code>
              <strong>{{ scope.row.name }}</strong>
              <span v-if="scope.row.error">{{ scope.row.error }}</span>
              <span v-else>{{ scope.row.browser }} · 手动触发</span>
            </button>
          </template>
        </el-table-column>
        <el-table-column label="运行环境" min-width="210">
          <template #default="scope">
            <div class="environment-cell"><strong>{{ scope.row.environment.name }}</strong><code>{{ scope.row.environment.code }} · {{ scope.row.environment.apiBaseUrl }}</code></div>
          </template>
        </el-table-column>
        <el-table-column label="脚本结果" min-width="220">
          <template #default="scope">
            <div class="result-cell">
              <strong>{{ scope.row.counts.passed }} / {{ scope.row.counts.total }}</strong>
              <div
                class="mini-distribution"
                role="img"
                :aria-label="`通过 ${scope.row.counts.passed}，失败 ${scope.row.counts.failed}，未执行 ${scope.row.counts.skipped}`"
              >
                <span v-if="scope.row.counts.passed" aria-hidden="true" class="is-passed" :style="{ flex: scope.row.counts.passed }" />
                <span v-if="scope.row.counts.failed" aria-hidden="true" class="is-failed" :style="{ flex: scope.row.counts.failed }" />
                <span v-if="scope.row.counts.skipped" aria-hidden="true" class="is-skipped" :style="{ flex: scope.row.counts.skipped }" />
              </div>
              <span>失败 {{ scope.row.counts.failed }} · 未执行 {{ scope.row.counts.skipped }} · 通过率 {{ scope.row.analysis.passRate }}%</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="132">
          <template #default="scope"><el-tag :type="statusMap[scope.row.status as RunRecordStatus].type" effect="light">{{ statusMap[scope.row.status as RunRecordStatus].label }}</el-tag></template>
        </el-table-column>
        <el-table-column label="耗时" width="130">
          <template #default="scope"><span class="duration-cell">{{ formatDuration(scope.row.durationMs) }}</span></template>
        </el-table-column>
        <el-table-column label="开始时间" width="205">
          <template #default="scope"><time class="date-cell">{{ formatDateTime(scope.row.startedAt) }}</time></template>
        </el-table-column>
        <el-table-column label="操作" width="116" fixed="right">
          <template #default="scope">
            <el-button
              text
              type="primary"
              :icon="View"
              :loading="detailLoadingId === scope.row.id"
              :disabled="Boolean(detailLoadingId) && detailLoadingId !== scope.row.id"
              @click="openDetail(scope.row)"
            >详情</el-button>
          </template>
        </el-table-column>
      </el-table>

      <footer class="table-footer">
        <span>运行记录仅保存脱敏后的环境、脚本、日志与结果快照</span>
        <el-pagination v-model:current-page="currentPage" background layout="total, prev, pager, next" :page-size="pageSize" :total="filteredRecords.length" />
      </footer>
    </section>

    <RunRecordDetailDrawer v-model="detailVisible" :record="detailRecord" />
  </div>
</template>

<style scoped>
.run-history-page { min-width: 0; }
.page-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 24px; }
.page-heading p, .page-heading h1, .page-heading span { margin: 0; }
.page-heading p { margin-bottom: 5px; color: #159c8d; font-size: var(--font-sm); font-weight: 700; }
.page-heading h1 { color: #17232a; font-size: var(--font-title); font-weight: 700; }
.page-heading span { display: block; margin-top: 8px; color: #65737a; font-size: var(--font-md); }

.metric-strip { display: grid; margin-bottom: 18px; overflow: hidden; border: 1px solid #e1e7ea; border-radius: 7px; grid-template-columns: repeat(4, minmax(0, 1fr)); background: #fff; box-shadow: 0 5px 18px rgb(24 45 55 / 4%); }
.metric-strip > div { display: flex; min-width: 0; min-height: 104px; align-items: center; gap: 13px; padding: 16px 20px; border-right: 1px solid #edf1f3; }
.metric-strip > div:last-child { border-right: 0; }
.metric-strip__icon { display: grid; width: 48px; height: 48px; flex: 0 0 48px; place-items: center; border-radius: 5px; }
.metric-strip__icon.is-total { color: #27766d; background: #e6f5f2; }
.metric-strip__icon.is-script { color: #3d6994; background: #edf4fa; }
.metric-strip__icon.is-passed { color: #228153; background: #eaf7ef; }
.metric-strip__icon.is-attention { color: #a9574e; background: #fff0ed; }
.metric-strip p, .metric-strip span, .metric-strip strong, .metric-strip small { margin: 0; }
.metric-strip p { min-width: 0; }
.metric-strip p > span { display: block; color: #66747c; font-size: var(--font-xs); }
.metric-strip strong { display: inline-block; margin-top: 3px; color: #26343b; font-size: var(--font-subtitle); }
.metric-strip small { display: block; margin-top: 2px; color: #66747c; font-size: var(--font-caption); }

.record-panel { overflow: hidden; border: 1px solid #e1e7ea; border-radius: 7px; background: #fff; box-shadow: 0 5px 18px rgb(24 45 55 / 4%); }
.toolbar, .toolbar__filters, .table-footer { display: flex; align-items: center; }
.toolbar { min-height: 80px; flex-wrap: wrap; justify-content: space-between; gap: 14px; padding: 12px 16px; border-bottom: 1px solid #edf1f3; }
.toolbar__filters { min-width: 0; flex: 1 1 760px; flex-wrap: wrap; gap: 10px; }
.search-input { min-width: 260px; flex: 1 1 360px; }
.status-select { width: 160px; }
.environment-select { width: 220px; }
.toolbar__result { color: #65737a; font-size: var(--font-sm); white-space: nowrap; }
.record-table { width: 100%; }
.record-identity { display: block; width: 100%; min-width: 0; padding: 0; text-align: left; border: 0; background: transparent; cursor: pointer; }
.record-identity code, .record-identity strong, .record-identity span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.record-identity code { color: #178f83; font-size: var(--font-xs); font-weight: 700; }
.record-identity strong { margin-top: 5px; color: #2e3c43; font-size: var(--font-md); }
.record-identity span { margin-top: 5px; color: #66747c; font-size: var(--font-xs); }
.record-identity:hover strong { color: #0d8175; }
.record-identity:disabled { opacity: 0.7; cursor: wait; }
.environment-cell strong, .environment-cell code { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.environment-cell strong { color: #46545b; font-size: var(--font-sm); }
.environment-cell code { margin-top: 7px; color: #66747c; font-size: var(--font-xs); }
.result-cell { display: grid; min-width: 0; grid-template-columns: auto minmax(70px, 1fr); align-items: center; gap: 7px 10px; }
.result-cell strong { color: #344149; font-size: var(--font-md); }
.result-cell > span { grid-column: 1 / -1; color: #66747c; font-size: var(--font-xs); }
.mini-distribution { display: flex; height: 8px; overflow: hidden; border-radius: 2px; background: #edf1f3; }
.mini-distribution .is-passed { background: #1aaa8f; }
.mini-distribution .is-failed { background: #d95858; }
.mini-distribution .is-skipped { background: #a3afb5; }
.duration-cell, .date-cell { color: #65737a; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: var(--font-xs); white-space: nowrap; }
.table-footer { min-height: 76px; flex-wrap: wrap; justify-content: space-between; gap: 14px; padding: 10px 16px; border-top: 1px solid #edf1f3; }
.table-footer > span { color: #65737a; font-size: var(--font-xs); }

:deep(.el-table) { --el-table-border-color: #edf1f3; --el-table-header-bg-color: #fafbfb; --el-table-row-hover-bg-color: #f7faf9; color: #69777f; font-size: var(--font-sm); }
:deep(.el-table th.el-table__cell) { height: 58px; color: #65737a; font-size: var(--font-xs); font-weight: 650; }
:deep(.el-table td.el-table__cell) { height: 88px; }

@media (max-width: 1180px) {
  .metric-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .metric-strip > div { border-bottom: 1px solid #edf1f3; }
  .metric-strip > div:nth-child(2n) { border-right: 0; }
  .metric-strip > div:nth-last-child(-n + 2) { border-bottom: 0; }
}

@media (max-width: 900px) {
  .table-footer { align-items: flex-start; flex-direction: column; }
}

@media (max-width: 640px) {
  .page-heading { align-items: stretch; flex-direction: column; }
  .page-heading .el-button { width: 100%; }
  .metric-strip { grid-template-columns: 1fr; }
  .metric-strip > div, .metric-strip > div:nth-child(2n), .metric-strip > div:nth-last-child(-n + 2) { border-right: 0; border-bottom: 1px solid #edf1f3; }
  .metric-strip > div:last-child { border-bottom: 0; }
  .toolbar__filters { flex-basis: auto; }
  .search-input, .status-select, .environment-select { width: 100%; min-width: 0; flex: 1 1 100%; }
}
</style>
