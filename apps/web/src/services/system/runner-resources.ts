import { formatDateTime } from '@/utils/date-time'

export type RunnerMetricUnit = 'bytes' | 'ms' | 'percent' | 'count' | 'number' | 'text' | 'datetime'
export interface RunnerResourceMetric {
  id: string
  label: string
  value: number | string | null
  unit: RunnerMetricUnit
  note?: string
}
export interface RunnerResourceGroup {
  id: string
  title: string
  description: string
  metrics: RunnerResourceMetric[]
  unavailableReason: string | null
}
export interface RunnerResourceSnapshot {
  schemaVersion: 1
  sampledAt: string
  collectionDurationMs: number
  groups: RunnerResourceGroup[]
}
const units = new Set(['bytes', 'ms', 'percent', 'count', 'number', 'text', 'datetime'])
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export function parseRunnerResources(value: unknown): RunnerResourceSnapshot {
  if (!object(value) || value.schemaVersion !== 1 || typeof value.sampledAt !== 'string'
    || !Number.isFinite(Date.parse(value.sampledAt)) || typeof value.collectionDurationMs !== 'number'
    || !Number.isFinite(value.collectionDurationMs) || !Array.isArray(value.groups)
    || value.groups.length > 32 || !value.groups.every(group => object(group)
      && typeof group.id === 'string' && typeof group.title === 'string' && typeof group.description === 'string'
      && (group.unavailableReason === null || typeof group.unavailableReason === 'string')
      && Array.isArray(group.metrics) && group.metrics.length <= 100 && group.metrics.every(metric => object(metric)
        && typeof metric.id === 'string' && typeof metric.label === 'string' && typeof metric.unit === 'string' && units.has(metric.unit)
        && (metric.value === null || typeof metric.value === 'string' || (typeof metric.value === 'number' && Number.isFinite(metric.value)))
        && (metric.unit !== 'datetime' || metric.value === null || Number.isFinite(Date.parse(String(metric.value))))
        && (metric.note === undefined || typeof metric.note === 'string')))) {
    throw new Error('Runner 资源接口返回格式无效，请检查 Runner 版本')
  }
  return value as unknown as RunnerResourceSnapshot
}
export function formatRunnerMetric(metric: RunnerResourceMetric): string {
  const value = metric.value
  if (value === null) return '不可用'
  if (metric.unit === 'datetime') return formatDateTime(new Date(value))
  if (typeof value === 'string') return value
  if (metric.unit === 'bytes') {
    const index = Math.min(4, Math.max(0, Math.floor(Math.log2(Math.max(1, value)) / 10)))
    return `${(value / 1024 ** index).toLocaleString('zh-CN', { maximumFractionDigits: index ? 2 : 0 })} ${['B', 'KiB', 'MiB', 'GiB', 'TiB'][index]}`
  }
  if (metric.unit === 'ms') {
    if (value < 1000) return `${value.toLocaleString('zh-CN', { maximumFractionDigits: 1 })} ms`
    if (value < 60_000) return `${(value / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 秒`
    if (value < 3_600_000) return `${(value / 60_000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 分钟`
    return `${(value / 3_600_000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 小时`
  }
  if (metric.unit === 'percent') return `${value.toLocaleString('zh-CN', { maximumFractionDigits: 1 })}%`
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}
