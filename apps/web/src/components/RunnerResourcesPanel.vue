<script setup lang="ts">
import { formatDateTime } from '@/utils/date-time'
import { formatRunnerMetric, type RunnerResourceSnapshot } from '@/services/system/runner-resources'

defineProps<{ snapshot: RunnerResourceSnapshot | null; loading: boolean; error: string | null }>()
defineEmits<{ refresh: [] }>()
</script>

<template>
  <section class="runner-resources" aria-labelledby="runner-resources-title" :aria-busy="loading">
    <header class="resources-heading">
      <div>
        <h2 id="runner-resources-title">资源与运行参数</h2>
        <p>首次打开时采集，之后请手动刷新。此页面不会自动刷新或处置任务。</p>
      </div>
      <el-button :loading="loading" :disabled="loading" @click="$emit('refresh')">{{ loading ? '正在采集' : '手动刷新' }}</el-button>
    </header>
    <p class="sample-time" aria-live="polite">
      <template v-if="snapshot">采样时间：{{ formatDateTime(new Date(snapshot.sampledAt)) }} · 采集耗时 {{ snapshot.collectionDurationMs.toFixed(1) }} ms · {{ loading ? '采集中，显示上次快照' : error ? '上次成功快照（已过期）' : '本次采样快照' }}</template>
      <template v-else>{{ loading ? '正在采集资源快照…' : '尚无可用资源快照' }}</template>
    </p>
    <p v-if="error" class="resources-error" role="alert">{{ error }}{{ snapshot ? '；下方保留上次成功数据，不代表当前状态。' : '；请检查连接后手动刷新。' }}</p>
    <div v-if="snapshot" class="resource-groups" :class="{ 'resource-groups--stale': error }">
      <article v-for="group in snapshot.groups" :key="group.id" class="resource-group" :data-group="group.id">
        <h3>{{ group.title }}</h3>
        <p class="group-description">{{ group.description }}</p>
        <p v-if="group.unavailableReason" class="group-unavailable" role="status">不可用：{{ group.unavailableReason }}</p>
        <dl v-else class="resource-metrics">
          <div v-for="metric in group.metrics" :key="metric.id" :data-metric="metric.id">
            <dt>{{ metric.label }}</dt>
            <dd :class="{ 'metric-unavailable': metric.value === null }">{{ formatRunnerMetric(metric) }}</dd>
            <small v-if="metric.value === null">{{ metric.note ?? '当前平台或采样状态不支持此指标' }}</small>
          </div>
        </dl>
      </article>
    </div>
  </section>
</template>

<style scoped>
.runner-resources { margin-top: 20px; color: var(--color-text-primary, #1f2a44); }
.resources-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
h2, h3, p { margin: 0; }
h2 { font-size: 17px; line-height: 26px; font-weight: 650; }
.resources-heading p, .sample-time, .group-description { color: var(--color-text-secondary, #64748b); font-size: 12px; line-height: 20px; }
.sample-time { margin: 10px 0 14px; }
.resources-error, .group-unavailable { padding: 12px; color: #b45309; background: #fffbeb; border: 1px solid #fde68a; border-radius: 5px; font-size: 13px; line-height: 21px; }
.resources-error { margin-bottom: 16px; }
.resource-groups { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; gap: 16px; }
.resource-group { min-width: 0; padding: 20px; border: 1px solid var(--color-border, #e5ebf3); border-radius: var(--radius-card, 6px); background: var(--color-surface, #fff); }
.resource-group[data-group="storage"] { grid-column: 1 / -1; }
.resource-group[data-group="storage"] .resource-metrics { grid-template-columns: repeat(4, minmax(0, 1fr)); }
h3 { font-size: 14px; line-height: 22px; font-weight: 650; }
.group-description { margin: 6px 0 16px; }
.resource-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 20px; margin: 0; }
.resource-metrics div { min-width: 0; }
dt { font-size: 12px; line-height: 18px; color: var(--color-text-secondary, #64748b); }
dd { margin: 4px 0 0; font-size: 17px; line-height: 25px; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.metric-unavailable { color: #94a3b8; font-size: 14px; }
small { display: block; color: #64748b; font-size: 11px; line-height: 17px; }
.resource-groups--stale { opacity: .65; }
@media (max-width: 1000px) { .resource-groups { grid-template-columns: 1fr; } .resource-group[data-group="storage"] .resource-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 600px) { .resource-group { padding: 16px; } .resources-heading { align-items: flex-start; } .resources-heading .el-button { flex-shrink: 0; } }
</style>
