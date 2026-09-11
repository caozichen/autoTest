<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  CircleCheck,
  CircleClose,
  Clock,
  DataAnalysis,
  RefreshLeft,
  RefreshRight,
  Search,
  VideoPause,
  View,
  Warning,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import RunRecordDetailDrawer from '@/components/RunRecordDetailDrawer.vue'
import type { RunRecord, RunRecordStatus } from '@/domain/run-record'
import { services } from '@/services/container'
import { readRunHistoryTabs, resolveRunHistoryTabs, RUN_HISTORY_TABS_KEY, type RunHistoryEnvironment } from '@/services/run-records/run-history-tabs'
import { pendingRunScriptCount } from '@/services/run-records/run-record-progress'

const records = ref<RunRecord[]>([])
const configuredEnvironments = ref<RunHistoryEnvironment[]>([])
const tabIds = ref<string[] | null>(null)
const environmentTabs = computed(() => resolveRunHistoryTabs(configuredEnvironments.value, tabIds.value))
const loading = ref(true)
const keyword = ref('')
const statusFilter = ref<'all' | RunRecordStatus>('all')
const environmentFilter = ref('all')
const currentPage = ref(1)
const pageSize = 8
const detailVisible = ref(false)
const detailRecord = ref<RunRecord | null>(null)
const detailLoadingId = ref('')
const stoppingRecordIds = ref<Set<string>>(new Set())
const recordsRefreshing = ref(false)
const pollIntervalMs = 1_000
let detailRequestSequence = 0
let detailRefreshing = false
let pollTimer: number | undefined

const statusMap: Record<RunRecordStatus, { label: string; type: 'success' | 'warning' | 'danger' | 'info' }> = {
  running: { label: '执行中', type: 'warning' },
  passed: { label: '全部通过', type: 'success' },
  failed: { label: '执行失败', type: 'danger' },
  partial: { label: '部分通过', type: 'warning' },
  interrupted: { label: '已中断', type: 'info' },
}

type SummaryStatus = Extract<RunRecordStatus, 'passed' | 'partial' | 'failed'>

const environments = computed(() => {
  const map = new Map([...records.value.map((record) => record.environment), ...configuredEnvironments.value]
    .map((environment) => [environment.id, environment]))
  return [...map.values()]
})

const environmentRecords = computed(() => records.value.filter((record) => (
  environmentFilter.value === 'all' || record.environment.id === environmentFilter.value
)))

const summary = computed(() => {
  if (environmentRecords.value.length === 0) {
    return { total: null, scriptCount: null, passed: null, partial: null, failed: null }
  }
  const scriptCount = environmentRecords.value.reduce((total, record) => total + record.counts.total, 0)
  return {
    total: environmentRecords.value.length,
    scriptCount,
    passed: environmentRecords.value.filter((record) => record.status === 'passed').length,
    partial: environmentRecords.value.filter((record) => record.status === 'partial').length,
    failed: environmentRecords.value.filter((record) => record.status === 'failed').length,
  }
})

const hasActiveFilters = computed(() => (
  keyword.value !== ''
  || statusFilter.value !== 'all'
  || environmentFilter.value !== 'all'
  || currentPage.value !== 1
))

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

function selectSummaryStatus(status: SummaryStatus): void {
  statusFilter.value = statusFilter.value === status ? 'all' : status
  currentPage.value = 1
}

function resetFilters(): void {
  keyword.value = ''
  statusFilter.value = 'all'
  environmentFilter.value = 'all'
  currentPage.value = 1
}

function shouldReplaceRecord(current: RunRecord, incoming: RunRecord): boolean {
  if (incoming.revision !== current.revision) return incoming.revision > current.revision
  return Date.parse(incoming.updatedAt) >= Date.parse(current.updatedAt)
}

function applyRecord(incoming: RunRecord): void {
  const index = records.value.findIndex((record) => record.id === incoming.id)
  if (index >= 0 && shouldReplaceRecord(records.value[index]!, incoming)) {
    records.value[index] = incoming
  }
  if (
    detailRecord.value?.id === incoming.id
    && shouldReplaceRecord(detailRecord.value, incoming)
  ) {
    detailRecord.value = incoming
  }
}

function applyRecordList(incoming: RunRecord[]): void {
  const currentById = new Map(records.value.map((record) => [record.id, record]))
  records.value = incoming.map((record) => {
    const current = currentById.get(record.id)
    return current && !shouldReplaceRecord(current, record) ? current : record
  })
}

async function loadRecords(showSuccess = false, silent = false): Promise<void> {
  if (recordsRefreshing.value) return
  recordsRefreshing.value = true
  if (!silent) loading.value = true
  void refreshOpenDetail()

  try {
    applyRecordList(await services.runRecords.list())
    if (showSuccess) ElMessage.success('运行记录已刷新')
  } catch {
    if (!silent) ElMessage.error('运行记录加载失败')
  } finally {
    recordsRefreshing.value = false
    if (!silent) loading.value = false
  }
}

async function refreshOpenDetail(): Promise<void> {
  if (detailRefreshing || !detailVisible.value || detailRecord.value?.status !== 'running') return
  const id = detailRecord.value.id
  const requestSequence = detailRequestSequence
  detailRefreshing = true
  try {
    const detail = await services.runRecords.get(id)
    if (detail && detailVisible.value && detailRecord.value?.id === id
      && requestSequence === detailRequestSequence) {
      applyRecord(detail)
    }
  } catch {
    // A failed detail request must not block the list's live counters; retry on the next poll.
  } finally {
    detailRefreshing = false
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
    applyRecord(detail)
    detailRecord.value = records.value.find((item) => item.id === detail.id) ?? detail
    detailVisible.value = true
  } catch {
    if (requestSequence === detailRequestSequence) ElMessage.error('运行记录详情加载失败')
  } finally {
    if (requestSequence === detailRequestSequence) detailLoadingId.value = ''
  }
}

async function forceStopRecord(record: RunRecord): Promise<void> {
  if (record.status !== 'running') return
  try {
    const result = await services.automationPipelineExecution.stopByRecordId(record.id)
    const latest = await services.runRecords.get(record.id).catch(() => null)
    if (latest) applyRecord(latest)

    if (result.stopped) {
      if (result.cleanupTimedOutRunIds?.length) {
        ElMessage.warning(
          `批次 ${record.displayId} 已中断，但 ${result.cleanupTimedOutRunIds.length} 个任务的浏览器清理超时，请检查 Runner 日志`,
        )
      } else {
        ElMessage.success(result.runnerFound
          ? `批次 ${record.displayId} 已强制停止`
          : `批次 ${record.displayId} 已解除运行锁定`)
      }
    } else {
      ElMessage.warning(`批次 ${record.displayId} 已经结束或不存在`)
    }
    void loadRecords(false, true)
  } catch (error) {
    const latest = await services.runRecords.get(record.id).catch(() => null)
    if (latest) applyRecord(latest)
    if (latest?.status === 'interrupted') {
      ElMessage.success(`批次 ${record.displayId} 已强制停止`)
    } else if (latest && latest.status !== 'running') {
      ElMessage.warning(
        `批次 ${record.displayId} 在停止请求处理期间已结束，当前状态：${statusMap[latest.status].label}`,
      )
    } else {
      const message = error instanceof Error ? error.message : '未知错误'
      const stateHint = latest ? '批次仍保持运行状态' : '未能确认批次当前状态'
      ElMessage.error(`强制停止失败：${message}；${stateHint}`)
    }
    void loadRecords(false, true)
  }
}

async function confirmForceStop(record: RunRecord): Promise<void> {
  if (record.status !== 'running' || stoppingRecordIds.value.has(record.id)) return
  stoppingRecordIds.value = new Set([...stoppingRecordIds.value, record.id])
  try {
    await ElMessageBox.confirm(
      `批次 ${record.displayId} 将立即中断，未执行步骤不会继续运行。确定强制停止吗？`,
      '强制停止运行批次',
      {
        confirmButtonText: '强制停止',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
        type: 'warning',
      },
    )
    await forceStopRecord(record)
  } catch {
    // 用户取消确认时不发送停止请求。
  } finally {
    const next = new Set(stoppingRecordIds.value)
    next.delete(record.id)
    stoppingRecordIds.value = next
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

async function loadEnvironmentTabs(): Promise<void> {
  try {
    configuredEnvironments.value = await services.environments.list()
    tabIds.value = readRunHistoryTabs()
  } catch {
    ElMessage.error('环境 Tab 加载失败，请刷新页面重试')
  }
}

function syncTabSettings(event: StorageEvent): void {
  if (event.key === RUN_HISTORY_TABS_KEY || event.key === null) {
    void loadEnvironmentTabs()
  }
}

onMounted(() => {
  void loadEnvironmentTabs()
  window.addEventListener('storage', syncTabSettings)
  void loadRecords()
  pollTimer = window.setInterval(() => {
    if (recordsRefreshing.value) return
    void loadRecords(false, true)
  }, pollIntervalMs)
})

onBeforeUnmount(() => {
  window.removeEventListener('storage', syncTabSettings)
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
      <div class="metric-strip__item is-total">
        <span class="metric-strip__icon"><el-icon><Clock /></el-icon></span>
        <span class="metric-strip__copy"><span>运行批次</span><strong>{{ summary.total ?? '暂无数据' }}</strong></span>
      </div>
      <div class="metric-strip__item is-script">
        <span class="metric-strip__icon"><el-icon><DataAnalysis /></el-icon></span>
        <span class="metric-strip__copy"><span>累计脚本</span><strong>{{ summary.scriptCount ?? '暂无数据' }}</strong></span>
      </div>
      <button
        class="metric-strip__item metric-strip__item--interactive is-passed"
        :class="{ 'is-active': statusFilter === 'passed' }"
        type="button"
        :aria-pressed="statusFilter === 'passed'"
        @click="selectSummaryStatus('passed')"
      >
        <span class="metric-strip__icon"><el-icon><CircleCheck /></el-icon></span>
        <span class="metric-strip__copy"><span>全部通过</span><strong>{{ summary.passed ?? '暂无数据' }}</strong></span>
      </button>
      <button
        class="metric-strip__item metric-strip__item--interactive is-partial"
        :class="{ 'is-active': statusFilter === 'partial' }"
        type="button"
        :aria-pressed="statusFilter === 'partial'"
        @click="selectSummaryStatus('partial')"
      >
        <span class="metric-strip__icon"><el-icon><Warning /></el-icon></span>
        <span class="metric-strip__copy"><span>部分通过</span><strong>{{ summary.partial ?? '暂无数据' }}</strong></span>
      </button>
      <button
        class="metric-strip__item metric-strip__item--interactive is-failed"
        :class="{ 'is-active': statusFilter === 'failed' }"
        type="button"
        :aria-pressed="statusFilter === 'failed'"
        @click="selectSummaryStatus('failed')"
      >
        <span class="metric-strip__icon"><el-icon><CircleClose /></el-icon></span>
        <span class="metric-strip__copy"><span>执行失败</span><strong>{{ summary.failed ?? '暂无数据' }}</strong></span>
      </button>
    </section>

    <section class="record-panel">
      <div class="environment-tabs-bar">
        <nav class="environment-tabs" aria-label="按环境筛选运行记录">
          <button type="button" :class="{ 'is-active': environmentFilter === 'all' }" :aria-pressed="environmentFilter === 'all'" @click="environmentFilter = 'all'">全部环境</button>
          <button v-for="environment in environmentTabs" :key="environment.id" type="button" :title="`${environment.name} · ${environment.code}`" :class="{ 'is-active': environmentFilter === environment.id }" :aria-pressed="environmentFilter === environment.id" :data-environment-id="environment.id" @click="environmentFilter = environment.id">{{ environment.name }}</button>
        </nav>
        <RouterLink class="configure-tabs" to="/settings/run-history">配置 Tab</RouterLink>
      </div>
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
        <div class="toolbar__actions">
          <span class="toolbar__result" aria-live="polite">{{ filteredRecords.length }} 个批次</span>
          <el-button
            class="reset-button"
            :icon="RefreshLeft"
            :disabled="!hasActiveFilters"
            aria-label="重置筛选条件"
            @click="resetFilters"
          >重置</el-button>
        </div>
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
        <el-table-column label="脚本结果" min-width="360">
          <template #default="scope">
            <div class="result-cell">
              <strong>{{ scope.row.counts.passed }} / {{ scope.row.counts.total }}</strong>
              <div
                class="mini-distribution"
                role="img"
                :aria-label="`执行成功 ${scope.row.counts.passed}，部分通过 ${scope.row.counts.partial}，执行失败 ${scope.row.counts.failed}，未执行 ${scope.row.counts.skipped}，待完成 ${pendingRunScriptCount(scope.row.counts)}`"
              >
                <span v-if="scope.row.counts.passed" aria-hidden="true" class="is-passed" :style="{ flex: scope.row.counts.passed }" />
                <span v-if="scope.row.counts.partial" aria-hidden="true" class="is-partial" :style="{ flex: scope.row.counts.partial }" />
                <span v-if="scope.row.counts.failed" aria-hidden="true" class="is-failed" :style="{ flex: scope.row.counts.failed }" />
                <span v-if="scope.row.counts.skipped" aria-hidden="true" class="is-skipped" :style="{ flex: scope.row.counts.skipped }" />
                <span v-if="pendingRunScriptCount(scope.row.counts)" aria-hidden="true" class="is-pending" :style="{ flex: pendingRunScriptCount(scope.row.counts) }" />
              </div>
              <span aria-live="polite">执行成功 {{ scope.row.counts.passed }} · 部分通过 {{ scope.row.counts.partial }} · 执行失败 {{ scope.row.counts.failed }} · 未执行 {{ scope.row.counts.skipped }} · 通过率 {{ scope.row.analysis.passRate }}%</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="132">
          <template #default="scope"><el-tag :type="statusMap[scope.row.status as RunRecordStatus].type" :class="{ 'status-tag--partial': scope.row.status === 'partial' }" effect="light">{{ statusMap[scope.row.status as RunRecordStatus].label }}</el-tag></template>
        </el-table-column>
        <el-table-column label="耗时" width="130">
          <template #default="scope"><span class="duration-cell">{{ formatDuration(scope.row.durationMs) }}</span></template>
        </el-table-column>
        <el-table-column label="开始时间" width="205">
          <template #default="scope"><time class="date-cell">{{ formatDateTime(scope.row.startedAt) }}</time></template>
        </el-table-column>
        <el-table-column label="操作" width="152" fixed="right">
          <template #default="scope">
            <div class="row-actions">
              <el-tooltip v-if="scope.row.status === 'running'" content="强制停止" placement="top">
                <el-button
                  text
                  type="danger"
                  :icon="VideoPause"
                  :loading="stoppingRecordIds.has(scope.row.id)"
                  :disabled="stoppingRecordIds.has(scope.row.id)"
                  aria-label="强制停止运行批次"
                  @click="confirmForceStop(scope.row)"
                />
              </el-tooltip>
              <el-button
                text
                type="primary"
                :icon="View"
                :loading="detailLoadingId === scope.row.id"
                :disabled="Boolean(detailLoadingId) && detailLoadingId !== scope.row.id"
                @click="openDetail(scope.row)"
              >详情</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <footer class="table-footer">
        <span>运行记录仅保存脱敏后的环境、脚本、日志与结果快照</span>
        <el-pagination v-model:current-page="currentPage" background layout="total, prev, pager, next" :page-size="pageSize" :total="filteredRecords.length" />
      </footer>
    </section>

    <RunRecordDetailDrawer
      v-model="detailVisible"
      :record="detailRecord"
      :stopping="Boolean(detailRecord && stoppingRecordIds.has(detailRecord.id))"
      @force-stop="confirmForceStop"
    />
  </div>
</template>

<style scoped>
.environment-tabs-bar { display: flex; align-items: center; gap: 16px; padding: 0 20px; border-bottom: 1px solid var(--color-border-light); }
.environment-tabs { display: flex; flex: 1; min-width: 0; gap: 24px; overflow-x: auto; }
.environment-tabs button { flex-shrink: 0; padding: 16px 0; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--color-text-secondary); font: inherit; font-size: 14px; cursor: pointer; }
.environment-tabs button.is-active { color: var(--color-primary); border-bottom-color: var(--color-primary); font-weight: 600; }
.environment-tabs button:hover { color: var(--color-primary); }
.environment-tabs button:focus-visible { outline: 2px solid var(--color-primary); outline-offset: -2px; }
.configure-tabs { flex-shrink: 0; color: var(--color-primary); font-size: 13px; text-decoration: none; }

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
  gap: 1px;
  margin-bottom: 16px;
  overflow: hidden;
  border: 1px solid var(--color-border, #e5ebf3);
  border-radius: var(--radius-card, 6px);
  grid-template-columns: repeat(5, minmax(0, 1fr));
  background: var(--color-border-light, #eef2f7);
  box-shadow: var(--shadow-card, 0 2px 10px rgb(31 42 68 / 5%));
}

.metric-strip__item {
  display: flex;
  min-width: 0;
  min-height: 88px;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  color: inherit;
  border: 0;
  background: var(--color-surface, #fff);
  font: inherit;
  text-align: left;
}

.metric-strip__icon {
  display: grid;
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
  place-items: center;
  border-radius: 6px;
  color: var(--metric-color);
  background: var(--metric-soft);
  font-size: 18px;
}

.metric-strip__item.is-total {
  --metric-color: var(--color-primary, #2563eb);
  --metric-soft: var(--color-primary-soft, #eff6ff);
}

.metric-strip__item.is-script {
  --metric-color: #0891b2;
  --metric-soft: #ecfeff;
}

.metric-strip__item.is-passed {
  --metric-color: var(--color-success, #16a34a);
  --metric-soft: #f0fdf4;
}

.metric-strip__item.is-partial {
  --metric-color: var(--color-partial-ink, #1f2a44);
  --metric-soft: var(--color-partial-soft, #fffbe6);
}

.metric-strip__item.is-partial .metric-strip__icon {
  color: var(--color-partial-ink, #1f2a44);
  background: var(--color-partial, #FFD700);
}

.metric-strip__item.is-failed {
  --metric-color: var(--color-danger, #dc2626);
  --metric-soft: #fef2f2;
}

.metric-strip__item--interactive {
  cursor: pointer;
  transition: color 150ms ease, background 150ms ease;
}

.metric-strip__item--interactive.is-active {
  color: var(--metric-color);
  background: var(--metric-soft);
}

@media (hover: hover) and (pointer: fine) {
  .metric-strip__item--interactive:not(.is-active):hover {
    background: var(--color-bg-subtle, #f8fafc);
  }
}

.metric-strip__item--interactive:focus-visible {
  position: relative;
  z-index: 1;
  outline: 2px solid var(--metric-color);
  outline-offset: -3px;
}

.metric-strip span,
.metric-strip strong {
  margin: 0;
}

.metric-strip__copy {
  display: block;
  min-width: 0;
}

.metric-strip__copy > span {
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

.record-panel {
  overflow: hidden;
  border: 1px solid var(--color-border, #e5ebf3);
  border-radius: var(--radius-card, 6px);
  background: var(--color-surface, #fff);
  box-shadow: var(--shadow-card, 0 2px 10px rgb(31 42 68 / 5%));
}

.toolbar,
.toolbar__filters,
.toolbar__actions,
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

.toolbar__actions {
  flex: 0 0 auto;
  gap: 12px;
}

.toolbar__result {
  color: var(--color-text-muted, #94a3b8);
  font-size: 12px;
  white-space: nowrap;
}

.reset-button {
  min-width: 76px;
}

.toolbar :deep(.reset-button.el-button) {
  height: 34px;
  border-radius: 5px;
  font-size: 13px;
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

.row-actions {
  display: flex;
  align-items: center;
  gap: 2px;
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
  line-height: 17px;
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

.mini-distribution .is-partial {
  background: var(--color-partial, #FFD700);
}

.mini-distribution .is-failed {
  background: var(--color-danger, #dc2626);
}

.mini-distribution .is-skipped {
  background: var(--color-text-muted, #94a3b8);
}

.mini-distribution .is-pending {
  background: var(--color-border, #e5ebf3);
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

:deep(.el-table .el-button--text.el-button--danger) {
  color: var(--color-danger, #dc2626);
}

:deep(.el-table .el-button--text.el-button--danger:hover) {
  color: #b91c1c;
  background: #fef2f2;
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
  .metric-strip { grid-template-columns: repeat(6, minmax(0, 1fr)); }
  .metric-strip__item { grid-column: span 2; }
  .metric-strip__item:nth-last-child(-n + 2) { grid-column: span 3; }
}

@media (max-width: 900px) {
  .table-footer { align-items: flex-start; flex-direction: column; }
}

@media (max-width: 640px) {
  .page-heading { align-items: stretch; flex-direction: column; gap: 12px; }
  .page-heading .el-button { width: 100%; }
  .metric-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .metric-strip__item, .metric-strip__item:nth-last-child(-n + 2) { grid-column: span 1; }
  .metric-strip__item:last-child { grid-column: 1 / -1; }
  .metric-strip__item { min-height: 78px; padding: 12px; }
  .metric-strip__icon { width: 36px; height: 36px; flex-basis: 36px; }
  .toolbar__filters { flex-basis: auto; }
  .search-input, .status-select, .environment-select { width: 100%; min-width: 0; flex: 1 1 100%; }
  .toolbar__actions { width: 100%; justify-content: space-between; }
}
</style>
