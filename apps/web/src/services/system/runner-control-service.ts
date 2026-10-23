import type { RunnerResourceSnapshot } from './runner-resources'

export type RunnerServiceStatus = 'online' | 'offline'

export interface RunnerServiceState {
  status: RunnerServiceStatus
  endpoint: string
  checkedAt: string
}

export interface RunnerStartResult {
  status: 'already-running' | 'started'
  pid?: number
}

export interface RunnerControlService {
  getResources(): Promise<RunnerResourceSnapshot>
  getStatus(): Promise<RunnerServiceState>
  start(): Promise<RunnerStartResult>
}
