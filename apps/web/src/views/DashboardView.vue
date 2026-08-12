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
    <header class="page-heading">
      <div>
        <p>{{ greetingDate }}</p>
        <h1>运行概览</h1>
        <span>本地自动化测试工作区</span>
      </div>
      <el-button :icon="RefreshRight" :loading="loading" @click="loadDashboard(true)">刷新</el-button>
    </header>

    <template v-if="snapshot">
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
                <el-icon v-if="scope.row.status === 'passed'" color="#25a866"><CircleCheck /></el-icon>
                <el-icon v-else-if="scope.row.status === 'failed'" color="#d84f56"><Warning /></el-icon>
                <el-icon v-else color="#c6811a"><Clock /></el-icon>
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

.page-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 24px;
}

.page-heading p,
.page-heading h1,
.page-heading span {
  margin: 0;
}

.page-heading p {
  margin-bottom: 5px;
  color: #159c8d;
  font-size: var(--font-md);
  font-weight: 600;
}

.page-heading h1 {
  color: #17232a;
  font-size: var(--font-title);
  font-weight: 700;
}

.page-heading span {
  display: block;
  margin-top: 8px;
  color: #8a969d;
  font-size: var(--font-md);
}

.metric-grid,
.loading-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 20px;
}

.overview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.8fr) minmax(280px, 0.72fr);
  gap: 20px;
  margin-top: 20px;
}

.panel {
  min-width: 0;
  border: 1px solid #e1e7ea;
  border-radius: 7px;
  background: #fff;
  box-shadow: 0 5px 18px rgb(24 45 55 / 4%);
}

.panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 24px 26px;
  border-bottom: 1px solid #edf1f3;
}

.panel__header h2,
.panel__header p {
  margin: 0;
}

.panel__header h2 {
  color: #26333a;
  font-size: var(--font-lg);
  font-weight: 650;
}

.panel__header p {
  margin-top: 5px;
  color: #98a3a9;
  font-size: var(--font-sm);
}

.panel__badge {
  color: #178f83;
  font-size: var(--font-caption);
  font-weight: 700;
}

.trend-panel {
  padding-bottom: 8px;
}

.trend-panel :deep(.trend-chart) {
  padding: 10px 16px 0;
}

.runner-state {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #268b54;
  font-size: var(--font-sm);
}

.runner-state i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #39c877;
  box-shadow: 0 0 0 4px rgb(57 200 119 / 11%);
}

.runner-state--offline {
  color: #a14c4c;
}

.runner-state--offline i {
  background: #d65b5b;
  box-shadow: 0 0 0 4px rgb(214 91 91 / 11%);
}

.panel-empty {
  min-height: 340px;
  justify-content: center;
}

.runner-visual {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 28px 20px 22px;
}

.runner-visual__icon {
  display: grid;
  width: 78px;
  height: 78px;
  place-items: center;
  color: #0a8f81;
  border: 1px solid #ccebe5;
  border-radius: 7px;
  background: #eaf8f5;
}

.runner-visual strong {
  margin-top: 14px;
  color: #26343b;
  font-size: var(--font-lg);
}

.runner-visual p {
  margin: 5px 0 0;
  color: #95a0a6;
  font-size: var(--font-sm);
}

.runner-details {
  margin: 0 20px 20px;
  border-top: 1px solid #eef2f3;
}

.runner-details div {
  display: flex;
  min-height: 54px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid #f0f3f4;
  font-size: var(--font-sm);
}

.runner-details dt {
  color: #929ea5;
}

.runner-details dd {
  overflow: hidden;
  margin: 0;
  color: #405058;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.runs-panel {
  margin-top: 20px;
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
  color: #344149;
  font-size: var(--font-md);
  font-weight: 600;
}

.loading-grid > * {
  padding: 20px;
  border: 1px solid #e1e7ea;
  border-radius: 7px;
  background: #fff;
}

:deep(.el-table) {
  --el-table-border-color: #edf1f3;
  --el-table-header-bg-color: #fafbfb;
  --el-table-row-hover-bg-color: #f7faf9;
  color: #69777f;
  font-size: var(--font-md);
}

:deep(.el-table th.el-table__cell) {
  height: 56px;
  color: #7c898f;
  font-size: var(--font-sm);
  font-weight: 600;
}

:deep(.el-table td.el-table__cell) {
  height: 66px;
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

@media (max-width: 560px) {
  .metric-grid,
  .loading-grid {
    grid-template-columns: 1fr;
  }

  .page-heading {
    align-items: center;
  }

  .page-heading span {
    display: none;
  }

  .page-heading h1 {
    font-size: var(--font-section);
  }
}
</style>
