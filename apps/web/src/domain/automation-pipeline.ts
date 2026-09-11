export interface PipelineParameterMapping {
  sourceScriptId: string
  sourcePath: string
  targetKey: string
}

export interface AutomationPipelineStep {
  scriptId: string
  parameterMappings: PipelineParameterMapping[]
}

export interface AutomationPipeline {
  id: string
  name: string
  description: string
  /** Legacy binding; new configurations choose their environment at execution time. */
  environmentId?: string
  steps: AutomationPipelineStep[]
  createdAt: string
  updatedAt: string
}

export type AutomationPipelineDraft = Omit<AutomationPipeline, 'id' | 'createdAt' | 'updatedAt'>
