import type { AutomationScript, ScriptDraft, ScriptRunContext } from '@/domain/script'

export interface ScriptService {
  list(): Promise<AutomationScript[]>
  create(draft: ScriptDraft): Promise<AutomationScript>
  update(id: string, draft: ScriptDraft): Promise<AutomationScript>
  remove(id: string): Promise<void>
  run(ids: string[], context: ScriptRunContext): Promise<AutomationScript[]>
}
