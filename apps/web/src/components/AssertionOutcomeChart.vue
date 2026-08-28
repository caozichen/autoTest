<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { PieChart } from 'echarts/charts'
import { GraphicComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { init, use, type ECharts } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'

use([PieChart, GraphicComponent, LegendComponent, TooltipComponent, CanvasRenderer])

const props = defineProps<{
  passed: number
  failed: number
  passRate: number
}>()

const chartElement = ref<HTMLDivElement | null>(null)
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
      trigger: 'item',
      backgroundColor: '#1f2a44',
      borderWidth: 0,
      textStyle: { color: '#fff', fontSize: 13 },
    },
    legend: {
      bottom: 4,
      left: 'center',
      itemWidth: 11,
      itemHeight: 7,
      textStyle: { color: '#64748b', fontSize: 12 },
    },
    graphic: [
      {
        type: 'text',
        left: 'center',
        top: '40%',
        style: {
          text: `${props.passRate}%`,
          fill: '#1f2a44',
          fontSize: 24,
          fontWeight: 700,
          textAlign: 'center',
        },
      },
      {
        type: 'text',
        left: 'center',
        top: '52%',
        style: {
          text: '小断言通过率',
          fill: '#86909c',
          fontSize: 11,
          textAlign: 'center',
        },
      },
    ],
    series: [{
      name: '小断言结果',
      type: 'pie',
      radius: ['54%', '72%'],
      center: ['50%', '45%'],
      avoidLabelOverlap: true,
      label: { show: false },
      itemStyle: { borderColor: '#fff', borderWidth: 3, borderRadius: 3 },
      data: [
        { name: '通过', value: props.passed },
        { name: '失败', value: props.failed },
      ],
    }],
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

watch(() => [props.passed, props.failed, props.passRate], renderChart)

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  chart?.dispose()
  chart = null
})
</script>

<template>
  <div ref="chartElement" class="assertion-outcome-chart" role="img" aria-label="小断言通过与失败比例" />
</template>

<style scoped>
.assertion-outcome-chart {
  width: 100%;
  height: 300px;
}
</style>
