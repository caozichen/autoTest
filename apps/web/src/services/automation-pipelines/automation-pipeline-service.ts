import type { AutomationPipeline, AutomationPipelineDraft } from '@/domain/automation-pipeline'

export interface AutomationPipelineService {
  list(): Promise<AutomationPipeline[]>
  get(id: string): Promise<AutomationPipeline | null>
  create(draft: AutomationPipelineDraft): Promise<AutomationPipeline>
  update(id: string, draft: AutomationPipelineDraft): Promise<AutomationPipeline>
  remove(id: string): Promise<void>
}
