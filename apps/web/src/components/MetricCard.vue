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
  min-height: 172px;
  padding: 24px;
  border: 1px solid #e1e7ea;
  border-radius: 7px;
  background: #fff;
  box-shadow: 0 5px 18px rgb(24 45 55 / 4%);
}

.metric-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.metric-card__label {
  color: #6f7d85;
  font-size: var(--font-base);
}

.metric-card__icon {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 5px;
}

.metric-card--cyan .metric-card__icon {
  color: #087d71;
  background: #d9f7f1;
}

.metric-card--green .metric-card__icon {
  color: #16834a;
  background: #def6e8;
}

.metric-card--amber .metric-card__icon {
  color: #a66509;
  background: #fff0d5;
}

.metric-card--red .metric-card__icon {
  color: #bd3f45;
  background: #fde7e8;
}

.metric-card__value {
  margin-top: 15px;
  color: #17232a;
  font-size: var(--font-display);
  font-weight: 700;
  line-height: 1;
}

.metric-card__value small {
  margin-left: 2px;
  font-size: var(--font-xl);
}

.metric-card__value--empty {
  font-size: var(--font-xl);
}

.metric-card__delta {
  margin: 10px 0 0;
  color: #98a3aa;
  font-size: var(--font-md);
}
</style>
