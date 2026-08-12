import type { DashboardSnapshot } from '@/domain/dashboard'

export interface DashboardService {
  getSnapshot(): Promise<DashboardSnapshot>
}
