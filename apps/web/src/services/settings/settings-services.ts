import type { EnvironmentService } from '../environments/environment-service'
import { LocalEnvironmentService } from '../environments/local-environment.service'
import { LocalEnvironmentSessionService, type EnvironmentSessionService } from '../environments/local-environment-session.service'
import type { AutomationPipelineService } from '../automation-pipelines/automation-pipeline-service'
import { LocalAutomationPipelineService } from '../automation-pipelines/local-automation-pipeline.service'
import { readRunHistoryTabs, saveRunHistoryTabs } from '../run-records/run-history-tabs'
import { HttpAppSettings, SESSION_PREFIX } from './http-app-settings'

export interface RunHistoryTabsService {
  read(): Promise<string[] | null>
  save(ids: string[]): Promise<void>
}

export function createSettingsServices(settings = new HttpAppSettings()): {
  environments: EnvironmentService
  automationPipelines: AutomationPipelineService
  environmentSessions: EnvironmentSessionService
  runHistoryTabs: RunHistoryTabsService
} {
  return {
    environments: {
      list: () => settings.read(storage => new LocalEnvironmentService(storage).list()),
      getActive: () => settings.read(storage => new LocalEnvironmentService(storage).getActive()),
      create: draft => settings.mutate(storage => new LocalEnvironmentService(storage).create(draft)),
      update: (id, draft) => settings.mutate(storage => new LocalEnvironmentService(storage).update(id, draft)),
      setActive: id => settings.mutate(storage => new LocalEnvironmentService(storage).setActive(id)),
      remove: id => settings.mutate(async storage => {
        await new LocalEnvironmentService(storage).remove(id)
        storage.removeItem(SESSION_PREFIX + id)
      }),
    },
    automationPipelines: {
      list: () => settings.read(storage => new LocalAutomationPipelineService(storage).list()),
      get: id => settings.read(storage => new LocalAutomationPipelineService(storage).get(id)),
      create: draft => settings.mutate(storage => new LocalAutomationPipelineService(storage).create(draft)),
      update: (id, draft) => settings.mutate(storage => new LocalAutomationPipelineService(storage).update(id, draft)),
      remove: id => settings.mutate(storage => new LocalAutomationPipelineService(storage).remove(id)),
    },
    environmentSessions: {
      get: environment => settings.read(storage => new LocalEnvironmentSessionService(storage).get(environment)),
      save: (environment, draft) => settings.mutate(storage => new LocalEnvironmentSessionService(storage).save(environment, draft)),
      clear: id => settings.mutate(storage => new LocalEnvironmentSessionService(storage).clear(id)),
    },
    runHistoryTabs: {
      read: () => settings.read(readRunHistoryTabs),
      save: ids => settings.mutate(storage => saveRunHistoryTabs(ids, storage)),
    },
  }
}
