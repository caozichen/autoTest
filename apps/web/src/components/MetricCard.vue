<script setup lang="ts">
import { CircleCheck, Clock, Document, Warning } from '@element-plus/icons-vue'
import { computed, type Component } from 'vue'

import type { DashboardMetric } from '@/domain/dashboard'

const props = defineProps<{
  metric: DashboardMetric
}>()

const icons: Record<DashboardMetric['tone'], Component> = {
  cyan: Document,
  green: CircleCheck,
  amber: Clock,
  red: Warning,
}

const icon = computed(() => icons[props.metric.tone])
</script>

<template>
  <article class="metric-card" :class="`metric-card--${metric.tone}`">
    <div class="metric-card__top">
      <span class="metric-card__label">{{ metric.label }}</span>
      <span class="metric-card__icon"><el-icon :size="19"><component :is="icon" /></el-icon></span>
    </div>
    <div class="metric-card__value" :class="{ 'metric-card__value--empty': metric.value === null }">
      <template v-if="metric.value !== null">{{ metric.value }}<small v-if="metric.suffix">{{ metric.suffix }}</small></template>
      <template v-else>暂无数据</template>
    </div>
    <p class="metric-card__delta">{{ metric.delta }}</p>
  </article>
</template>

<style scoped>
.metric-card {
  min-width: 0;
  min-height: 118px;
  padding: 14px 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  box-shadow: var(--shadow-card);
  transition: border-color 150ms ease, box-shadow 150ms ease;
}

.metric-card:hover {
  border-color: #ccd8ea;
  box-shadow: 0 10px 26px rgb(31 42 68 / 8%);
}

.metric-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.metric-card__label {
  color: var(--color-text-secondary);
  font-size: var(--font-sm);
}

.metric-card__icon {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 5px;
}

.metric-card--cyan .metric-card__icon {
  color: var(--color-primary);
  background: var(--color-primary-soft);
}

.metric-card--green .metric-card__icon {
  color: #21865a;
  background: #eaf7f0;
}

.metric-card--amber .metric-card__icon {
  color: #bd7217;
  background: #fff5e7;
}

.metric-card--red .metric-card__icon {
  color: #cf4852;
  background: #fff0f1;
}

.metric-card__value {
  margin-top: 8px;
  color: var(--color-text-primary);
  font-size: var(--font-subtitle);
  font-weight: 750;
  line-height: 1;
}

.metric-card__value small {
  margin-left: 2px;
  font-size: var(--font-md);
}

.metric-card__value--empty {
  font-size: var(--font-md);
}

.metric-card__delta {
  margin: 5px 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-xs);
}
</style>
