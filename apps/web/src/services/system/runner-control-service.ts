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
  getStatus(): Promise<RunnerServiceState>
  start(): Promise<RunnerStartResult>
}
