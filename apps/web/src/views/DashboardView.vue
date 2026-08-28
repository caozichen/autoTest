<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { CircleCheck, Clock, Connection, RefreshRight, Warning } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

import MetricCard from '@/components/MetricCard.vue'
import TrendChart from '@/components/TrendChart.vue'
import type { DashboardSnapshot, RunStatus } from '@/domain/dashboard'
import { services } from '@/services/container'

const snapshot = ref<DashboardSnapshot | null>(null)
const loading = ref(true)
const greetingDate = computed(() => new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
  weekday: 'long',
}).format(new Date()))

const statusMap: Record<RunStatus, { label: string; type: 'success' | 'warning' | 'danger' | 'info' }> = {
  passed: { label: '已通过', type: 'success' },
  running: { label: '执行中', type: 'warning' },
  failed: { label: '失败', type: 'danger' },
  partial: { label: '部分通过', type: 'warning' },
  interrupted: { label: '已中断', type: 'info' },
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return '暂无数据'
  if (durationMs < 1_000) return `${durationMs} ms`
  const seconds = Math.round(durationMs / 1_000)
  const minutes = Math.floor(seconds / 60)
  return minutes ? `${minutes} 分 ${seconds % 60} 秒` : `${seconds} 秒`
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '暂无数据' : date.toLocaleString('zh-CN', { hour12: false })
}

async function loadDashboard(showSuccess = false): Promise<void> {
  loading.value = true
  try {
    snapshot.value = await services.dashboard.getSnapshot()
    if (showSuccess) ElMessage.success('数据已刷新')
  } catch {
    ElMessage.error('主页数据加载失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => loadDashboard())
</script>

<template>
  <div class="dashboard">
    <section class="welcome-panel">
      <header class="page-heading">
        <div>
          <p>{{ greetingDate }}</p>
          <h1>运行概览</h1>
          <span>本地自动化测试工作区</span>
        </div>
      </header>
      <div class="welcome-panel__actions">
        <div v-if="snapshot" class="welcome-panel__node">
          <span class="welcome-panel__node-icon"><el-icon :size="18"><Connection /></el-icon></span>
          <div>
            <small>本地执行节点</small>
            <strong>{{ snapshot.runner.browser ?? '暂无数据' }}</strong>
          </div>
          <span class="runner-state" :class="{ 'runner-state--offline': snapshot.runner.status === 'offline' }">
            <i />{{ snapshot.runner.status === 'online' ? '在线' : '离线' }}
          </span>
        </div>
        <el-button :icon="RefreshRight" :loading="loading" @click="loadDashboard(true)">刷新数据</el-button>
      </div>
    </section>

    <template v-if="snapshot">
      <div class="section-heading">
        <h2>统计指标</h2>
        <span>当前工作区概况</span>
      </div>
      <section class="metric-grid" aria-label="核心指标">
        <MetricCard v-for="metric in snapshot.metrics" :key="metric.id" :metric="metric" />
      </section>

      <section class="overview-grid">
        <article class="panel trend-panel">
          <header class="panel__header">
            <div>
              <h2>执行趋势</h2>
              <p>近 7 日脚本结果</p>
            </div>
            <span class="panel__badge">7 DAYS</span>
          </header>
          <TrendChart v-if="snapshot.trend.length" :data="snapshot.trend" />
          <el-empty v-else description="暂无数据" :image-size="72" class="panel-empty" />
        </article>

        <article class="panel runner-panel">
          <header class="panel__header">
            <div>
              <h2>运行节点</h2>
              <p>本地执行环境</p>
            </div>
            <span class="runner-state" :class="{ 'runner-state--offline': snapshot.runner.status === 'offline' }">
              <i />{{ snapshot.runner.status === 'online' ? '在线' : '离线' }}
            </span>
          </header>
          <div class="runner-visual">
            <span class="runner-visual__icon"><el-icon :size="30"><Connection /></el-icon></span>
            <strong>{{ snapshot.runner.browser ?? '暂无数据' }}</strong>
            <p>{{ snapshot.runner.status === 'online' ? 'Runner 健康检查通过' : 'Runner 健康检查未通过' }}</p>
          </div>
          <dl class="runner-details">
            <div><dt>当前环境</dt><dd>{{ snapshot.runner.activeEnvironment ?? '暂无数据' }}</dd></div>
            <div><dt>健康检查</dt><dd>{{ snapshot.runner.endpoint }}</dd></div>
            <div><dt>执行浏览器</dt><dd>{{ snapshot.runner.browser ?? '暂无数据' }}</dd></div>
          </dl>
        </article>
      </section>

      <section class="panel runs-panel">
        <header class="panel__header">
          <div>
            <h2>最近运行</h2>
            <p>最新测试执行记录</p>
          </div>
        </header>
        <el-table :data="snapshot.recentRuns" class="runs-table" empty-text="暂无数据">
          <el-table-column prop="id" label="任务编号" min-width="160" />
          <el-table-column label="任务名称" min-width="240">
            <template #default="scope">
              <div class="run-name">
                <el-icon v-if="scope.row.status === 'passed'" color="var(--color-success)"><CircleCheck /></el-icon>
                <el-icon v-else-if="scope.row.status === 'failed'" color="var(--color-danger)"><Warning /></el-icon>
                <el-icon v-else color="var(--color-warning)"><Clock /></el-icon>
                <strong>{{ scope.row.name }}</strong>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="environmentName" label="运行环境" min-width="160" />
          <el-table-column prop="scriptCount" label="脚本数" width="112" />
          <el-table-column label="状态" width="126">
            <template #default="scope">
              <el-tag :type="statusMap[scope.row.status as RunStatus].type" effect="light" size="small">
                {{ statusMap[scope.row.status as RunStatus].label }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="耗时" width="150">
            <template #default="scope">{{ formatDuration(scope.row.durationMs) }}</template>
          </el-table-column>
          <el-table-column label="开始时间" width="205">
            <template #default="scope">{{ formatDateTime(scope.row.startedAt) }}</template>
          </el-table-column>
        </el-table>
      </section>
    </template>

    <div v-else-if="loading" class="loading-grid">
      <el-skeleton v-for="index in 4" :key="index" :rows="3" animated />
    </div>

    <el-empty v-else description="暂无主页数据" />
  </div>
</template>

<style scoped>
.dashboard {
  min-width: 0;
}

.welcome-panel {
  display: grid;
  align-items: center;
  gap: 24px;
  margin-bottom: 18px;
  padding: 26px 30px;
  border: 1px solid #dde6f3;
  border-radius: var(--radius-card);
  grid-template-columns: minmax(0, 1fr) auto;
  background: #f7faff;
  box-shadow: 0 8px 24px rgb(31 42 68 / 3%);
}

.page-heading {
  display: flex;
  min-width: 0;
  align-items: center;
}

.page-heading p,
.page-heading h1,
.page-heading span {
  margin: 0;
}

.page-heading p {
  margin-bottom: 7px;
  color: #6f7f99;
  font-size: var(--font-sm);
  font-weight: 600;
}

.page-heading h1 {
  color: var(--color-text-primary);
  font-size: var(--font-title);
  font-weight: 780;
}

.page-heading span {
  display: block;
  margin-top: 7px;
  color: var(--color-text-secondary);
  font-size: var(--font-md);
}

.welcome-panel__actions,
.welcome-panel__node {
  display: flex;
  align-items: center;
}

.welcome-panel__actions {
  gap: 12px;
}

.welcome-panel__node {
  min-height: 50px;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
}

.welcome-panel__node-icon {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  color: var(--color-primary);
  border-radius: 5px;
  background: var(--color-primary-soft);
}

.welcome-panel__node small,
.welcome-panel__node strong {
  display: block;
}

.welcome-panel__node small {
  color: var(--color-text-muted);
  font-size: var(--font-caption);
}

.welcome-panel__node strong {
  margin-top: 1px;
  color: var(--color-text-primary);
  font-size: var(--font-sm);
}

.section-heading {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 0 2px 10px;
}

.section-heading h2,
.section-heading span {
  margin: 0;
}

.section-heading h2 {
  color: var(--color-text-primary);
  font-size: var(--font-lg);
  font-weight: 750;
}

.section-heading span {
  color: var(--color-text-muted);
  font-size: var(--font-xs);
}

.metric-grid,
.loading-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.overview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.72fr) minmax(280px, 0.58fr);
  gap: 16px;
  margin-top: 16px;
}

.panel {
  min-width: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  box-shadow: var(--shadow-card);
}

.panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  border-bottom: 1px solid var(--color-border-light);
}

.panel__header h2,
.panel__header p {
  margin: 0;
}

.panel__header h2 {
  color: var(--color-text-primary);
  font-size: var(--font-lg);
  font-weight: 720;
}

.panel__header p {
  margin-top: 3px;
  color: var(--color-text-muted);
  font-size: var(--font-sm);
}

.panel__badge {
  color: var(--color-primary);
  font-size: var(--font-caption);
  font-weight: 700;
}

.trend-panel {
  padding-bottom: 8px;
}

.trend-panel :deep(.trend-chart) {
  padding: 8px 12px 0;
}

.runner-state {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--color-success);
  font-size: var(--font-xs);
}

.runner-state i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-success);
  box-shadow: 0 0 0 3px rgb(46 159 107 / 12%);
}

.runner-state--offline {
  color: var(--color-danger);
}

.runner-state--offline i {
  background: var(--color-danger);
  box-shadow: 0 0 0 3px rgb(226 85 93 / 12%);
}

.panel-empty {
  min-height: 340px;
  justify-content: center;
}

.runner-visual {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 18px 18px;
}

.runner-visual__icon {
  display: grid;
  width: 64px;
  height: 64px;
  place-items: center;
  color: var(--color-primary);
  border: 1px solid #d8e4fb;
  border-radius: 7px;
  background: var(--color-primary-soft);
}

.runner-visual strong {
  margin-top: 14px;
  color: var(--color-text-primary);
  font-size: var(--font-lg);
}

.runner-visual p {
  margin: 5px 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-sm);
}

.runner-details {
  margin: 0 18px 18px;
  border-top: 1px solid var(--color-border-light);
}

.runner-details div {
  display: flex;
  min-height: 48px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--color-border-light);
  font-size: var(--font-sm);
}

.runner-details dt {
  color: var(--color-text-muted);
}

.runner-details dd {
  overflow: hidden;
  margin: 0;
  color: var(--color-text-secondary);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.runs-panel {
  margin-top: 16px;
  overflow: hidden;
}

.runs-table {
  width: 100%;
}

.run-name {
  display: flex;
  align-items: center;
  gap: 8px;
}

.run-name strong {
  color: var(--color-text-primary);
  font-size: var(--font-md);
  font-weight: 600;
}

.loading-grid > * {
  padding: 20px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
}

:deep(.el-table) {
  --el-table-border-color: var(--color-border-light);
  --el-table-header-bg-color: #f8faff;
  --el-table-row-hover-bg-color: #f7f9fd;
  color: var(--color-text-secondary);
  font-size: var(--font-md);
}

:deep(.el-table th.el-table__cell) {
  height: 46px;
  color: #6b778c;
  font-size: var(--font-sm);
  font-weight: 600;
}

:deep(.el-table td.el-table__cell) {
  height: 58px;
}

@media (max-width: 1180px) {
  .metric-grid,
  .loading-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 1280px) {
  .overview-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 860px) {
  .welcome-panel {
    align-items: stretch;
    grid-template-columns: 1fr;
  }

  .welcome-panel__actions {
    justify-content: space-between;
  }
}

@media (max-width: 560px) {
  .metric-grid,
  .loading-grid {
    grid-template-columns: 1fr;
  }

  .welcome-panel {
    padding: 20px;
  }

  .welcome-panel__actions {
    align-items: stretch;
    flex-direction: column;
  }

  .welcome-panel__node {
    justify-content: flex-start;
  }

  .welcome-panel__node .runner-state {
    margin-left: auto;
  }

  .page-heading h1 {
    font-size: var(--font-subtitle);
  }

  .section-heading span {
    display: none;
  }
}
</style>
