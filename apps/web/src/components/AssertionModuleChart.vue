<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { BarChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { init, use, type ECharts } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'

import type { RunAssertionGroup } from '@/services/run-records/run-assertion-analysis'

use([BarChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

const props = defineProps<{
  groups: RunAssertionGroup[]
}>()

const chartElement = ref<HTMLDivElement | null>(null)
const chartHeight = computed(() => `${Math.max(280, props.groups.length * 34 + 92)}px`)
let chart: ECharts | null = null
let resizeObserver: ResizeObserver | null = null

function renderChart(): void {
  const element = chartElement.value
  if (!element || element.clientWidth <= 0 || element.clientHeight <= 0) return
  chart ??= init(element)
  chart.setOption({
    animationDuration: 420,
    color: ['#2563eb', '#e2555d'],
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: '#1f2a44',
      borderWidth: 0,
      textStyle: { color: '#fff', fontSize: 13 },
    },
    legend: {
      top: 0,
      right: 6,
      itemWidth: 11,
      itemHeight: 7,
      textStyle: { color: '#64748b', fontSize: 12 },
    },
    grid: {
      left: 8,
      right: 14,
      top: 40,
      bottom: 4,
      outerBoundsMode: 'same',
      outerBoundsContain: 'axisLabel',
    },
    xAxis: {
      type: 'value',
      minInterval: 1,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: '#86909c', fontSize: 11 },
      splitLine: { lineStyle: { color: '#edf1f7' } },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: props.groups.map((group) => group.name),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        width: 112,
        overflow: 'truncate',
        color: '#4e5969',
        fontSize: 12,
      },
    },
    series: [
      {
        name: '通过',
        type: 'bar',
        stack: 'assertions',
        barMaxWidth: 15,
        itemStyle: { borderRadius: [3, 0, 0, 3] },
        emphasis: { focus: 'series' },
        data: props.groups.map((group) => group.passed),
      },
      {
        name: '失败',
        type: 'bar',
        stack: 'assertions',
        barMaxWidth: 15,
        itemStyle: { borderRadius: [0, 3, 3, 0] },
        emphasis: { focus: 'series' },
        data: props.groups.map((group) => group.failed),
      },
    ],
  }, true)
}

onMounted(() => {
  renderChart()
  if (chartElement.value) {
    resizeObserver = new ResizeObserver(() => {
      if (!chart) renderChart()
      else chart.resize()
    })
    resizeObserver.observe(chartElement.value)
  }
})

watch(() => props.groups, renderChart, { deep: true })

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  chart?.dispose()
  chart = null
})
</script>

<template>
  <div class="assertion-module-chart__viewport">
    <div
      ref="chartElement"
      class="assertion-module-chart"
      :style="{ height: chartHeight }"
      role="img"
      aria-label="各大断言模块通过与失败的小断言数量"
    />
  </div>
</template>

<style scoped>
.assertion-module-chart__viewport {
  max-height: 602px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.assertion-module-chart {
  width: 100%;
  min-height: 280px;
}
</style>
