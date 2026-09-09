<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { init, use, type ECharts } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'

import type { TrendPoint } from '@/domain/dashboard'

use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

const props = defineProps<{
  data: TrendPoint[]
}>()

const chartElement = ref<HTMLDivElement | null>(null)
let chart: ECharts | null = null
let resizeObserver: ResizeObserver | null = null

function renderChart(): void {
  if (!chartElement.value) return
  chart ??= init(chartElement.value)
  chart.setOption({
    animationDuration: 450,
    color: ['#2563eb', '#FFD700', '#e2555d'],
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1f2a44',
      borderWidth: 0,
      textStyle: { color: '#fff', fontSize: 12 },
    },
    legend: {
      top: 0,
      right: 0,
      itemWidth: 12,
      itemHeight: 3,
      textStyle: { color: '#64748b', fontSize: 12 },
    },
    grid: { left: 8, right: 8, top: 42, bottom: 4, containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: props.data.map((item) => item.date),
      axisLine: { lineStyle: { color: '#dfe6f0' } },
      axisTick: { show: false },
      axisLabel: { color: '#86909c', fontSize: 12 },
    },
    yAxis: {
      type: 'value',
      splitNumber: 4,
      axisLabel: { color: '#86909c', fontSize: 12 },
      splitLine: { lineStyle: { color: '#edf1f7' } },
    },
    series: [
      {
        name: '通过',
        type: 'line',
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 3 },
        areaStyle: { color: 'rgba(37, 99, 235, 0.08)' },
        data: props.data.map((item) => item.passed),
      },
      {
        name: '部分通过',
        type: 'line',
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2 },
        data: props.data.map((item) => item.partial),
      },
      {
        name: '失败',
        type: 'line',
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2 },
        data: props.data.map((item) => item.failed),
      },
    ],
  })
}

onMounted(() => {
  renderChart()
  if (chartElement.value) {
    resizeObserver = new ResizeObserver(() => chart?.resize())
    resizeObserver.observe(chartElement.value)
  }
})

watch(() => props.data, renderChart, { deep: true })

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  chart?.dispose()
  chart = null
})
</script>

<template>
  <div ref="chartElement" class="trend-chart" role="img" aria-label="近七日测试执行趋势图" />
</template>

<style scoped>
.trend-chart {
  width: 100%;
  height: 300px;
}
</style>
