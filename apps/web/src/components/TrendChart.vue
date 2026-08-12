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
    color: ['#16b8a6', '#e2575d'],
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#172129',
      borderWidth: 0,
      textStyle: { color: '#fff', fontSize: 16 },
    },
    legend: {
      top: 0,
      right: 0,
      itemWidth: 12,
      itemHeight: 3,
      textStyle: { color: '#76838b', fontSize: 16 },
    },
    grid: { left: 8, right: 8, top: 42, bottom: 4, containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: props.data.map((item) => item.date),
      axisLine: { lineStyle: { color: '#dce3e6' } },
      axisTick: { show: false },
      axisLabel: { color: '#8b979e', fontSize: 15 },
    },
    yAxis: {
      type: 'value',
      splitNumber: 4,
      axisLabel: { color: '#9aa5ab', fontSize: 15 },
      splitLine: { lineStyle: { color: '#edf1f3' } },
    },
    series: [
      {
        name: '通过',
        type: 'line',
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 3 },
        areaStyle: { color: 'rgba(22, 184, 166, 0.08)' },
        data: props.data.map((item) => item.passed),
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
  height: 340px;
}
</style>
