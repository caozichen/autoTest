import type { RunRecordStatus } from './run-record'

export type RunStatus = RunRecordStatus

export interface DashboardMetric {
  id: string
  label: string
  value: number | null
  suffix?: string
  delta: string
  tone: 'cyan' | 'green' | 'amber' | 'red'
}

export interface TrendPoint {
  date: string
  passed: number
  failed: number
}

export interface RecentRun {
  id: string
  name: string
  environmentName: string
  status: RunStatus
  scriptCount: number
  durationMs: number | null
  startedAt: string
}

export interface DashboardSnapshot {
  metrics: DashboardMetric[]
  trend: TrendPoint[]
  recentRuns: RecentRun[]
  runner: {
    status: 'online' | 'offline'
    browser: string | null
    activeEnvironment: string | null
    endpoint: string
  }
}
