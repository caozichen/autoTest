import type {
  AutomationPipeline,
  AutomationPipelineDraft,
  AutomationPipelineStep,
  PipelineParameterMapping,
} from '@/domain/automation-pipeline'
import type { AutomationPipelineService } from './automation-pipeline-service'

const STORAGE_KEY = 'autotest.automation-pipelines.v1'

type IdFactory = () => string

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function normalizeMapping(value: unknown): PipelineParameterMapping | null {
  if (!isRecord(value)) return null
  if (
    typeof value.sourceScriptId !== 'string' ||
    typeof value.sourcePath !== 'string' ||
    typeof value.targetKey !== 'string'
  ) return null

  const mapping = {
    sourceScriptId: value.sourceScriptId.trim(),
    sourcePath: value.sourcePath.trim(),
    targetKey: value.targetKey.trim(),
  }
  return mapping.sourceScriptId && mapping.sourcePath && mapping.targetKey ? mapping : null
}

function normalizeStep(value: unknown): AutomationPipelineStep | null {
  if (!isRecord(value) || typeof value.scriptId !== 'string' || !Array.isArray(value.parameterMappings)) return null
  const scriptId = value.scriptId.trim()
  if (!scriptId) return null
  const parameterMappings = value.parameterMappings.map(normalizeMapping)
  if (parameterMappings.some((mapping) => mapping === null)) return null
  return { scriptId, parameterMappings: parameterMappings as PipelineParameterMapping[] }
}

function validateSteps(steps: AutomationPipelineStep[]): void {
  if (steps.length === 0) throw new Error('流水线至少需要一个脚本步骤')

  const seenScripts = new Set<string>()
  for (const step of steps) {
    if (!step.scriptId) throw new Error('流水线步骤必须选择脚本')
    if (seenScripts.has(step.scriptId)) throw new Error('同一脚本不能在流水线中重复出现')

    const targets = new Set<string>()
    for (const mapping of step.parameterMappings) {
      if (!mapping.sourceScriptId || !mapping.sourcePath || !mapping.targetKey) {
        throw new Error('参数映射的来源脚本、输出路径和目标变量不能为空')
      }
      if (!seenScripts.has(mapping.sourceScriptId)) {
        throw new Error('参数映射只能引用当前步骤之前的脚本')
      }
      if (targets.has(mapping.targetKey)) {
        throw new Error('同一步骤不能重复映射同一个目标变量')
      }
      targets.add(mapping.targetKey)
    }
    seenScripts.add(step.scriptId)
  }
}

function sanitizeDraft(draft: AutomationPipelineDraft): AutomationPipelineDraft {
  const sanitized: AutomationPipelineDraft = {
    name: draft.name.trim(),
    description: draft.description.trim(),
    environmentId: draft.environmentId.trim(),
    steps: draft.steps.map((step) => ({
      scriptId: step.scriptId.trim(),
      parameterMappings: step.parameterMappings.map((mapping) => ({
        sourceScriptId: mapping.sourceScriptId.trim(),
        sourcePath: mapping.sourcePath.trim(),
        targetKey: mapping.targetKey.trim(),
      })),
    })),
  }
  if (!sanitized.name) throw new Error('流水线名称不能为空')
  if (!sanitized.environmentId) throw new Error('流水线必须选择运行环境')
  validateSteps(sanitized.steps)
  return sanitized
}

function normalizePipeline(value: unknown): AutomationPipeline | null {
  if (!isRecord(value) || !Array.isArray(value.steps)) return null
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.description !== 'string' ||
    typeof value.environmentId !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    !Number.isFinite(new Date(value.createdAt).getTime()) ||
    !Number.isFinite(new Date(value.updatedAt).getTime())
  ) return null

  const id = value.id.trim()
  const name = value.name.trim()
  const environmentId = value.environmentId.trim()
  const steps = value.steps.map(normalizeStep)
  if (!id || !name || !environmentId || steps.some((step) => step === null)) return null

  try {
    validateSteps(steps as AutomationPipelineStep[])
  } catch {
    return null
  }

  return {
    id,
    name,
    description: value.description.trim(),
    environmentId,
    steps: steps as AutomationPipelineStep[],
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

export class LocalAutomationPipelineService implements AutomationPipelineService {
  private pipelines: AutomationPipeline[]

  constructor(
    private readonly storage: Storage = window.localStorage,
    private readonly now: () => Date = () => new Date(),
    private readonly idFactory: IdFactory = () => crypto.randomUUID(),
  ) {
    this.pipelines = this.restore()
  }

  async list(): Promise<AutomationPipeline[]> {
    return structuredClone(this.pipelines)
  }

  async get(id: string): Promise<AutomationPipeline | null> {
    const pipeline = this.pipelines.find((item) => item.id === id)
    return pipeline ? structuredClone(pipeline) : null
  }

  async create(draft: AutomationPipelineDraft): Promise<AutomationPipeline> {
    const sanitized = sanitizeDraft(draft)
    this.assertUniqueName(sanitized.name)
    const timestamp = this.now().toISOString()
    const pipeline: AutomationPipeline = {
      ...sanitized,
      id: this.idFactory(),
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    this.commit([pipeline, ...this.pipelines])
    return structuredClone(pipeline)
  }

  async update(id: string, draft: AutomationPipelineDraft): Promise<AutomationPipeline> {
    const current = this.pipelines.find((pipeline) => pipeline.id === id)
    if (!current) throw new Error('流水线不存在或已被删除')
    const sanitized = sanitizeDraft(draft)
    this.assertUniqueName(sanitized.name, id)
    const updated: AutomationPipeline = {
      ...sanitized,
      id,
      createdAt: current.createdAt,
      updatedAt: this.now().toISOString(),
    }
    this.commit(this.pipelines.map((pipeline) => pipeline.id === id ? updated : pipeline))
    return structuredClone(updated)
  }

  async remove(id: string): Promise<void> {
    const next = this.pipelines.filter((pipeline) => pipeline.id !== id)
    if (next.length === this.pipelines.length) throw new Error('流水线不存在或已被删除')
    this.commit(next)
  }

  private assertUniqueName(name: string, excludeId?: string): void {
    const normalizedName = name.toLocaleLowerCase()
    if (this.pipelines.some((pipeline) => (
      pipeline.id !== excludeId && pipeline.name.toLocaleLowerCase() === normalizedName
    ))) throw new Error('流水线名称已存在')
  }

  private restore(): AutomationPipeline[] {
    const raw = this.storage.getItem(STORAGE_KEY)
    if (!raw) return []
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed.map(normalizePipeline).filter((pipeline): pipeline is AutomationPipeline => pipeline !== null)
    } catch {
      return []
    }
  }

  private commit(pipelines: AutomationPipeline[]): void {
    const next = structuredClone(pipelines)
    this.storage.setItem(STORAGE_KEY, JSON.stringify(next))
    this.pipelines = next
  }
}
