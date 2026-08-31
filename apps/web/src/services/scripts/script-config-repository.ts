import type {
  ScriptInputParameter,
  ScriptResponseVariableBinding,
} from '@/domain/script'

export interface ScriptConfig {
  schemaVersion: 1
  revision: number
  id: string
  name: string
  description: string
  directory: string
  entryFile: string
  timeoutMs: number
  enabled: boolean
  requestPath?: string
  inputParameters?: ScriptInputParameter[]
  responseVariableBindings?: ScriptResponseVariableBinding[]
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface ScriptConfigRepository {
  list(): Promise<ScriptConfig[]>
  get(id: string): Promise<ScriptConfig | null>
  create(config: ScriptConfig): Promise<ScriptConfig>
  update(
    config: ScriptConfig,
    expectedRevision: number,
    expectedUpdatedAt: string,
  ): Promise<ScriptConfig>
  remove(id: string, expectedRevision: number, expectedUpdatedAt: string): Promise<void>
}
