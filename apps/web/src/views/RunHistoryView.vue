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
const pollIntervalMs = 1_000
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

watch([keyword, statusFilter, environmentFilter], () => {
  currentPage.value = 1
})

async function loadRecords(showSuccess = false, silent = false): Promise<void> {
  if (recordsRefreshing.value) return
  recordsRefreshing.value = true
  if (!silent) loading.value = true
  const openDetailId = detailVisible.value && detailRecord.value?.status === 'running'
    ? detailRecord.value.id
    : undefined

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
    if (recordsRefreshing.value) return
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
.run-history-page {
  min-width: 0;
  color: var(--color-text-primary, #1f2a44);
  background: var(--color-bg-page, #f3f6fb);
}

.page-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 18px;
}

.page-heading p,
.page-heading h1,
.page-heading span {
  margin: 0;
}

.page-heading p {
  margin-bottom: 4px;
  color: var(--color-primary, #2563eb);
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
}

.page-heading h1 {
  color: var(--color-text-primary, #1f2a44);
  font-size: 22px;
  font-weight: 650;
  line-height: 30px;
}

.page-heading span {
  display: block;
  margin-top: 4px;
  color: var(--color-text-secondary, #64748b);
  font-size: 13px;
  line-height: 20px;
}

.page-heading :deep(.el-button) {
  min-width: 96px;
  height: 34px;
  color: var(--color-text-secondary, #64748b);
  border-color: var(--color-border, #e5ebf3);
  border-radius: 5px;
  background: var(--color-surface, #fff);
  font-size: 13px;
}

.page-heading :deep(.el-button:hover) {
  color: var(--color-primary, #2563eb);
  border-color: var(--color-primary, #2563eb);
  background: var(--color-primary-soft, #eff6ff);
}

.metric-strip {
  display: grid;
  margin-bottom: 16px;
  overflow: hidden;
  border: 1px solid var(--color-border, #e5ebf3);
  border-radius: var(--radius-card, 6px);
  grid-template-columns: repeat(4, minmax(0, 1fr));
  background: var(--color-surface, #fff);
  box-shadow: var(--shadow-card, 0 2px 10px rgb(31 42 68 / 5%));
}

.metric-strip > div {
  display: flex;
  min-width: 0;
  min-height: 88px;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  border-right: 1px solid var(--color-border-light, #eef2f7);
}

.metric-strip > div:last-child {
  border-right: 0;
}

.metric-strip__icon {
  display: grid;
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
  place-items: center;
  border-radius: 6px;
  font-size: 18px;
}

.metric-strip__icon.is-total {
  color: var(--color-primary, #2563eb);
  background: var(--color-primary-soft, #eff6ff);
}

.metric-strip__icon.is-script {
  color: #0891b2;
  background: #ecfeff;
}

.metric-strip__icon.is-passed {
  color: var(--color-success, #16a34a);
  background: #f0fdf4;
}

.metric-strip__icon.is-attention {
  color: var(--color-warning, #d97706);
  background: #fffbeb;
}

.metric-strip p,
.metric-strip span,
.metric-strip strong,
.metric-strip small {
  margin: 0;
}

.metric-strip p {
  min-width: 0;
}

.metric-strip p > span {
  display: block;
  color: var(--color-text-secondary, #64748b);
  font-size: 12px;
  line-height: 18px;
}

.metric-strip strong {
  display: inline-block;
  margin-top: 1px;
  color: var(--color-text-primary, #1f2a44);
  font-size: 22px;
  font-weight: 650;
  line-height: 28px;
}

.metric-strip small {
  display: block;
  color: var(--color-text-muted, #94a3b8);
  font-size: 11px;
  line-height: 16px;
}

.record-panel {
  overflow: hidden;
  border: 1px solid var(--color-border, #e5ebf3);
  border-radius: var(--radius-card, 6px);
  background: var(--color-surface, #fff);
  box-shadow: var(--shadow-card, 0 2px 10px rgb(31 42 68 / 5%));
}

.toolbar,
.toolbar__filters,
.table-footer {
  display: flex;
  align-items: center;
}

.toolbar {
  min-height: 62px;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border-light, #eef2f7);
}

.toolbar__filters {
  min-width: 0;
  flex: 1 1 720px;
  flex-wrap: wrap;
  gap: 8px;
}

.search-input {
  min-width: 240px;
  flex: 1 1 340px;
}

.status-select {
  width: 150px;
}

.environment-select {
  width: 210px;
}

.toolbar__result {
  color: var(--color-text-muted, #94a3b8);
  font-size: 12px;
  white-space: nowrap;
}

.toolbar :deep(.el-input__wrapper),
.toolbar :deep(.el-select__wrapper) {
  min-height: 34px;
  border-radius: 5px;
  box-shadow: 0 0 0 1px var(--color-border, #e5ebf3) inset;
}

.toolbar :deep(.el-input__wrapper:hover),
.toolbar :deep(.el-select__wrapper:hover) {
  box-shadow: 0 0 0 1px var(--color-primary, #2563eb) inset;
}

.toolbar :deep(.el-input__inner),
.toolbar :deep(.el-select__placeholder),
.toolbar :deep(.el-select__selected-item) {
  color: var(--color-text-secondary, #64748b);
  font-size: 13px;
}

.record-table {
  width: 100%;
}

.record-identity {
  display: block;
  width: 100%;
  min-width: 0;
  padding: 0;
  text-align: left;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.record-identity code,
.record-identity strong,
.record-identity span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.record-identity code {
  color: var(--color-primary, #2563eb);
  font-size: 11px;
  font-weight: 650;
}

.record-identity strong {
  margin-top: 3px;
  color: var(--color-text-primary, #1f2a44);
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
}

.record-identity span {
  margin-top: 2px;
  color: var(--color-text-muted, #94a3b8);
  font-size: 11px;
  line-height: 18px;
}

.record-identity:hover strong {
  color: var(--color-primary-hover, #1d4ed8);
}

.record-identity:disabled {
  opacity: 0.7;
  cursor: wait;
}

.environment-cell strong,
.environment-cell code {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.environment-cell strong {
  color: var(--color-text-primary, #1f2a44);
  font-size: 13px;
  font-weight: 600;
}

.environment-cell code {
  margin-top: 4px;
  color: var(--color-text-muted, #94a3b8);
  font-size: 11px;
}

.result-cell {
  display: grid;
  min-width: 0;
  grid-template-columns: auto minmax(70px, 1fr);
  align-items: center;
  gap: 5px 10px;
}

.result-cell strong {
  color: var(--color-text-primary, #1f2a44);
  font-size: 13px;
  font-weight: 600;
}

.result-cell > span {
  grid-column: 1 / -1;
  color: var(--color-text-muted, #94a3b8);
  font-size: 11px;
}

.mini-distribution {
  display: flex;
  height: 6px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--color-bg-subtle, #f8fafc);
}

.mini-distribution .is-passed {
  background: var(--color-success, #16a34a);
}

.mini-distribution .is-failed {
  background: var(--color-danger, #dc2626);
}

.mini-distribution .is-skipped {
  background: var(--color-text-muted, #94a3b8);
}

.duration-cell,
.date-cell {
  color: var(--color-text-secondary, #64748b);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11px;
  white-space: nowrap;
}

.table-footer {
  min-height: 58px;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-top: 1px solid var(--color-border-light, #eef2f7);
}

.table-footer > span {
  color: var(--color-text-muted, #94a3b8);
  font-size: 11px;
}

:deep(.el-table) {
  --el-table-border-color: var(--color-border-light, #eef2f7);
  --el-table-header-bg-color: var(--color-bg-subtle, #f8fafc);
  --el-table-row-hover-bg-color: var(--color-primary-soft, #eff6ff);
  color: var(--color-text-secondary, #64748b);
  font-size: 13px;
}

:deep(.el-table::before) {
  display: none;
}

:deep(.el-table th.el-table__cell) {
  height: 44px;
  padding: 0;
  color: var(--color-text-secondary, #64748b);
  font-size: 12px;
  font-weight: 600;
}

:deep(.el-table td.el-table__cell) {
  height: 72px;
  padding: 8px 0;
}

:deep(.el-table .cell) {
  line-height: 20px;
}

:deep(.el-table .el-button--text) {
  height: 30px;
  padding: 5px 8px;
  color: var(--color-primary, #2563eb);
  border-radius: 4px;
  font-size: 12px;
}

:deep(.el-table .el-button--text:hover) {
  color: var(--color-primary-hover, #1d4ed8);
  background: var(--color-primary-soft, #eff6ff);
}

:deep(.el-tag) {
  height: 24px;
  padding: 0 8px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 22px;
}

:deep(.el-pagination) {
  --el-pagination-button-bg-color: var(--color-bg-subtle, #f8fafc);
  --el-pagination-hover-color: var(--color-primary, #2563eb);
  font-size: 12px;
}

:deep(.el-pagination.is-background .el-pager li.is-active) {
  background: var(--color-primary, #2563eb);
}

@media (max-width: 1180px) {
  .metric-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .metric-strip > div { border-bottom: 1px solid var(--color-border-light, #eef2f7); }
  .metric-strip > div:nth-child(2n) { border-right: 0; }
  .metric-strip > div:nth-last-child(-n + 2) { border-bottom: 0; }
}

@media (max-width: 900px) {
  .table-footer { align-items: flex-start; flex-direction: column; }
}

@media (max-width: 640px) {
  .page-heading { align-items: stretch; flex-direction: column; gap: 12px; }
  .page-heading .el-button { width: 100%; }
  .metric-strip { grid-template-columns: 1fr; }
  .metric-strip > div, .metric-strip > div:nth-child(2n), .metric-strip > div:nth-last-child(-n + 2) { border-right: 0; border-bottom: 1px solid var(--color-border-light, #eef2f7); }
  .metric-strip > div:last-child { border-bottom: 0; }
  .toolbar__filters { flex-basis: auto; }
  .search-input, .status-select, .environment-select { width: 100%; min-width: 0; flex: 1 1 100%; }
}
</style>
