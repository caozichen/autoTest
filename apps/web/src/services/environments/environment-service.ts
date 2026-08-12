import type { EnvironmentDraft, TestEnvironment } from '@/domain/environment'

export interface EnvironmentService {
  list(): Promise<TestEnvironment[]>
  getActive(): Promise<TestEnvironment | null>
  create(draft: EnvironmentDraft): Promise<TestEnvironment>
  update(id: string, draft: EnvironmentDraft): Promise<TestEnvironment>
  remove(id: string): Promise<void>
  setActive(id: string): Promise<TestEnvironment>
}
