export interface RuntimeVariable {
  key: string
  value: string
  secret: boolean
  authorizationScheme?: string
  sourceEnvironmentId: string
  sourceScriptId?: string
  sourcePath: string
  updatedAt: string
}

export type RuntimeVariableDraft = Omit<RuntimeVariable, 'updatedAt'>
