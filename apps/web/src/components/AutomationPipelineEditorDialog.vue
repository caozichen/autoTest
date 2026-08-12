<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { ArrowDown, ArrowUp, Delete, Plus } from '@element-plus/icons-vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'

import type {
  AutomationPipeline,
  AutomationPipelineDraft,
  AutomationPipelineStep,
  PipelineParameterMapping,
} from '@/domain/automation-pipeline'
import type { TestEnvironment } from '@/domain/environment'
import type { AutomationScript } from '@/domain/script'

interface EditablePipelineStep extends AutomationPipelineStep {
  key: string
}

interface EditablePipelineDraft {
  name: string
  description: string
  environmentId: string
  steps: EditablePipelineStep[]
}

const props = defineProps<{
  modelValue: boolean
  pipeline: AutomationPipeline | null
  scripts: AutomationScript[]
  environments: TestEnvironment[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [draft: AutomationPipelineDraft]
}>()

const formRef = ref<FormInstance>()
const selectedScriptIds = ref<string[]>([])
const title = computed(() => props.pipeline ? '编辑自动化配置' : '新增自动化配置')

function createStepKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `step-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function emptyDraft(): EditablePipelineDraft {
  return {
    name: '',
    description: '',
    environmentId: '',
    steps: [],
  }
}

function toEditableStep(step: AutomationPipelineStep): EditablePipelineStep {
  return {
    key: createStepKey(),
    scriptId: step.scriptId,
    parameterMappings: step.parameterMappings.map((mapping) => ({ ...mapping })),
  }
}

const form = reactive<EditablePipelineDraft>(emptyDraft())

const rules: FormRules<EditablePipelineDraft> = {
  name: [
    { required: true, message: '请输入配置名称', trigger: 'blur' },
    { min: 2, max: 40, message: '名称长度应为 2 到 40 个字符', trigger: 'blur' },
  ],
  description: [
    { required: true, message: '请输入配置简介', trigger: 'blur' },
    { max: 200, message: '简介不能超过 200 个字符', trigger: 'blur' },
  ],
  environmentId: [{ required: true, message: '请选择运行环境', trigger: 'change' }],
}

const selectedIds = computed(() => new Set(form.steps.map((step) => step.scriptId)))
const selectableScripts = computed(() => props.scripts.filter((script) => !selectedIds.value.has(script.id)))

watch(
  () => [props.modelValue, props.pipeline] as const,
  ([visible, pipeline]) => {
    if (!visible) return

    form.name = pipeline?.name ?? ''
    form.description = pipeline?.description ?? ''
    form.environmentId = pipeline?.environmentId ?? ''
    form.steps = (pipeline?.steps ?? []).map(toEditableStep)
    selectedScriptIds.value = []

    void nextTick(() => formRef.value?.clearValidate())
  },
  { immediate: true },
)

function scriptName(scriptId: string): string {
  return props.scripts.find((script) => script.id === scriptId)?.name ?? '脚本已不存在'
}

function isScriptUnavailable(scriptId: string, currentIndex: number): boolean {
  return form.steps.some((step, index) => index !== currentIndex && step.scriptId === scriptId)
}

function precedingSteps(stepIndex: number): EditablePipelineStep[] {
  return form.steps.slice(0, stepIndex).filter((step) => step.scriptId)
}

function sanitizeMappings(): number {
  let removed = 0

  form.steps.forEach((step, index) => {
    const allowedSources = new Set(form.steps.slice(0, index).map((candidate) => candidate.scriptId))
    const mappings = index === 0
      ? []
      : step.parameterMappings.filter((mapping) => allowedSources.has(mapping.sourceScriptId))
    removed += step.parameterMappings.length - mappings.length
    step.parameterMappings = mappings
  })

  return removed
}

function notifyRemovedMappings(removed: number): void {
  if (removed > 0) {
    ElMessage.info(`已清理 ${removed} 条失效的参数映射`)
  }
}

function addSelectedScripts(): void {
  const availableIds = new Set(selectableScripts.value.map((script) => script.id))
  const scriptIds = selectedScriptIds.value.filter((scriptId) => availableIds.has(scriptId))

  if (!scriptIds.length) {
    ElMessage.warning('请先选择要添加的脚本')
    return
  }

  form.steps.push(...scriptIds.map((scriptId) => ({
    key: createStepKey(),
    scriptId,
    parameterMappings: [],
  })))
  selectedScriptIds.value = []
}

function changeStepScript(): void {
  notifyRemovedMappings(sanitizeMappings())
}

function moveStep(index: number, offset: -1 | 1): void {
  const targetIndex = index + offset
  if (targetIndex < 0 || targetIndex >= form.steps.length) return

  const [step] = form.steps.splice(index, 1)
  if (!step) return
  form.steps.splice(targetIndex, 0, step)
  notifyRemovedMappings(sanitizeMappings())
}

function removeStep(index: number): void {
  form.steps.splice(index, 1)
  notifyRemovedMappings(sanitizeMappings())
}

function addMapping(stepIndex: number): void {
  const sources = precedingSteps(stepIndex)
  const defaultSource = sources[sources.length - 1]
  if (!defaultSource) return

  form.steps[stepIndex]?.parameterMappings.push({
    sourceScriptId: defaultSource.scriptId,
    sourcePath: '',
    targetKey: '',
  })
}

function removeMapping(stepIndex: number, mappingIndex: number): void {
  form.steps[stepIndex]?.parameterMappings.splice(mappingIndex, 1)
}

function validateSteps(): boolean {
  if (!form.steps.length) {
    ElMessage.warning('请至少添加一个脚本步骤')
    return false
  }

  const knownScriptIds = new Set(props.scripts.map((script) => script.id))
  const scriptIds = form.steps.map((step) => step.scriptId)
  if (scriptIds.some((scriptId) => !scriptId || !knownScriptIds.has(scriptId))) {
    ElMessage.warning('流水线中存在未选择或已不存在的脚本')
    return false
  }
  if (new Set(scriptIds).size !== scriptIds.length) {
    ElMessage.warning('同一流水线不能重复添加相同脚本')
    return false
  }

  for (let stepIndex = 0; stepIndex < form.steps.length; stepIndex += 1) {
    const step = form.steps[stepIndex]
    if (!step) continue
    const precedingScriptIds = new Set(form.steps.slice(0, stepIndex).map((candidate) => candidate.scriptId))
    const targetKeys = new Set<string>()

    for (const mapping of step.parameterMappings) {
      const sourcePath = mapping.sourcePath.trim()
      const targetKey = mapping.targetKey.trim()
      if (!mapping.sourceScriptId || !sourcePath || !targetKey) {
        ElMessage.warning(`请完整填写步骤 ${stepIndex + 1} 的参数映射`)
        return false
      }
      if (!precedingScriptIds.has(mapping.sourceScriptId)) {
        ElMessage.warning(`步骤 ${stepIndex + 1} 的映射来源必须是前置脚本`)
        return false
      }

      const normalizedTargetKey = targetKey.toLowerCase()
      if (targetKeys.has(normalizedTargetKey)) {
        ElMessage.warning(`步骤 ${stepIndex + 1} 的目标参数名不能重复`)
        return false
      }
      targetKeys.add(normalizedTargetKey)
    }
  }

  return true
}

async function submit(): Promise<void> {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid || !validateSteps()) return

  const draft: AutomationPipelineDraft = {
    name: form.name.trim(),
    description: form.description.trim(),
    environmentId: form.environmentId,
    steps: form.steps.map((step) => ({
      scriptId: step.scriptId,
      parameterMappings: step.parameterMappings.map<PipelineParameterMapping>((mapping) => ({
        sourceScriptId: mapping.sourceScriptId,
        sourcePath: mapping.sourcePath.trim(),
        targetKey: mapping.targetKey.trim(),
      })),
    })),
  }
  emit('save', draft)
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="title"
    width="1120px"
    class="automation-pipeline-dialog"
    destroy-on-close
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
      <div class="basic-grid">
        <el-form-item label="配置名称" prop="name">
          <el-input v-model="form.name" maxlength="40" show-word-limit placeholder="请输入自动化配置名称" />
        </el-form-item>
        <el-form-item label="运行环境" prop="environmentId">
          <el-select v-model="form.environmentId" filterable placeholder="请选择运行环境">
            <el-option
              v-for="environment in environments"
              :key="environment.id"
              :label="environment.name"
              :value="environment.id"
              :disabled="!environment.enabled"
            >
              <div class="option-row">
                <span>{{ environment.name }}</span>
                <code>{{ environment.code }}</code>
              </div>
            </el-option>
            <template #empty>
              <span class="select-empty">暂无可用环境</span>
            </template>
          </el-select>
        </el-form-item>
      </div>

      <el-form-item label="配置简介" prop="description">
        <el-input
          v-model="form.description"
          type="textarea"
          :rows="3"
          maxlength="200"
          show-word-limit
          placeholder="请输入本次自动化流程覆盖的业务范围"
        />
      </el-form-item>

      <section class="pipeline-section">
        <div class="section-heading">
          <div>
            <h3>脚本步骤</h3>
            <span>{{ form.steps.length }} 个步骤</span>
          </div>
        </div>

        <div class="batch-toolbar">
          <el-select
            v-model="selectedScriptIds"
            multiple
            filterable
            collapse-tags
            collapse-tags-tooltip
            placeholder="批量选择脚本"
            :disabled="selectableScripts.length === 0"
          >
            <el-option
              v-for="script in selectableScripts"
              :key="script.id"
              :label="script.name"
              :value="script.id"
              :disabled="script.status === 'disabled'"
            >
              <div class="option-row option-row--script">
                <span>{{ script.name }}</span>
                <code>{{ script.entryFile }}</code>
              </div>
            </el-option>
            <template #empty>
              <span class="select-empty">暂无可添加脚本</span>
            </template>
          </el-select>
          <el-button type="primary" :icon="Plus" :disabled="!selectedScriptIds.length" @click="addSelectedScripts">
            添加所选
          </el-button>
        </div>

        <div v-if="form.steps.length" class="step-list">
          <article v-for="(step, stepIndex) in form.steps" :key="step.key" class="step-card">
            <div class="step-card__main">
              <div class="step-order" aria-hidden="true">{{ String(stepIndex + 1).padStart(2, '0') }}</div>
              <div class="step-script">
                <span class="field-label">执行脚本</span>
                <el-select
                  v-model="step.scriptId"
                  filterable
                  placeholder="请选择脚本"
                  @change="changeStepScript"
                >
                  <el-option
                    v-if="step.scriptId && !scripts.some((script) => script.id === step.scriptId)"
                    :label="`脚本已不存在（${step.scriptId}）`"
                    :value="step.scriptId"
                    disabled
                  />
                  <el-option
                    v-for="script in scripts"
                    :key="script.id"
                    :label="script.name"
                    :value="script.id"
                    :disabled="script.status === 'disabled' || isScriptUnavailable(script.id, stepIndex)"
                  >
                    <div class="option-row option-row--script">
                      <span>{{ script.name }}</span>
                      <code>{{ script.entryFile }}</code>
                    </div>
                  </el-option>
                </el-select>
                <small v-if="step.scriptId">{{ scriptName(step.scriptId) }}</small>
              </div>
              <div class="step-actions">
                <el-tooltip content="上移步骤" placement="top">
                  <el-button
                    :icon="ArrowUp"
                    :disabled="stepIndex === 0"
                    :aria-label="`上移步骤 ${stepIndex + 1}`"
                    @click="moveStep(stepIndex, -1)"
                  />
                </el-tooltip>
                <el-tooltip content="下移步骤" placement="top">
                  <el-button
                    :icon="ArrowDown"
                    :disabled="stepIndex === form.steps.length - 1"
                    :aria-label="`下移步骤 ${stepIndex + 1}`"
                    @click="moveStep(stepIndex, 1)"
                  />
                </el-tooltip>
                <el-tooltip content="删除步骤" placement="top">
                  <el-button
                    type="danger"
                    plain
                    :icon="Delete"
                    :aria-label="`删除步骤 ${stepIndex + 1}`"
                    @click="removeStep(stepIndex)"
                  />
                </el-tooltip>
              </div>
            </div>

            <div v-if="stepIndex > 0" class="mapping-section">
              <div class="mapping-heading">
                <div>
                  <strong>参数映射</strong>
                  <span>可选 · {{ step.parameterMappings.length }} 条</span>
                </div>
                <el-button text type="primary" :icon="Plus" @click="addMapping(stepIndex)">添加映射</el-button>
              </div>

              <div v-if="step.parameterMappings.length" class="mapping-list">
                <div class="mapping-list__head" aria-hidden="true">
                  <span>来源脚本</span>
                  <span>响应数据路径</span>
                  <span>目标参数名</span>
                  <span />
                </div>
                <div
                  v-for="(mapping, mappingIndex) in step.parameterMappings"
                  :key="`${step.key}-mapping-${mappingIndex}`"
                  class="mapping-row"
                >
                  <el-select v-model="mapping.sourceScriptId" filterable placeholder="选择前置脚本">
                    <el-option
                      v-for="(sourceStep, sourceIndex) in precedingSteps(stepIndex)"
                      :key="sourceStep.key"
                      :label="`步骤 ${sourceIndex + 1} · ${scriptName(sourceStep.scriptId)}`"
                      :value="sourceStep.scriptId"
                    />
                  </el-select>
                  <el-input v-model="mapping.sourcePath" placeholder="例如 data.token" />
                  <el-input v-model="mapping.targetKey" placeholder="例如 AUTH_TOKEN">
                    <template #prepend>&#123;&#123;</template>
                    <template #append>&#125;&#125;</template>
                  </el-input>
                  <el-tooltip content="删除映射" placement="top">
                    <el-button
                      text
                      type="danger"
                      :icon="Delete"
                      :aria-label="`删除步骤 ${stepIndex + 1} 的映射 ${mappingIndex + 1}`"
                      @click="removeMapping(stepIndex, mappingIndex)"
                    />
                  </el-tooltip>
                </div>
              </div>
            </div>
          </article>
        </div>

        <el-empty v-else description="暂无脚本步骤" :image-size="76" />
      </section>
    </el-form>

    <template #footer>
      <div class="dialog-footer">
        <span>共 {{ form.steps.length }} 个脚本步骤</span>
        <div>
          <el-button @click="emit('update:modelValue', false)">取消</el-button>
          <el-button type="primary" @click="submit">保存配置</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.basic-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(260px, 0.65fr);
  gap: 0 20px;
}

:deep(.el-select) {
  width: 100%;
}

.option-row {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

.option-row span,
.option-row code {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.option-row code {
  color: #7a898f;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: var(--font-caption);
}

.option-row--script span {
  flex: 0 1 46%;
}

.option-row--script code {
  flex: 1;
  text-align: right;
}

.select-empty {
  display: block;
  padding: 10px;
  color: #849198;
  font-size: var(--font-sm);
  text-align: center;
}

.pipeline-section {
  margin-top: 4px;
  padding-top: 22px;
  border-top: 1px solid #e4eaec;
}

.section-heading,
.section-heading > div,
.mapping-heading,
.mapping-heading > div,
.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.section-heading h3 {
  margin: 0;
  color: #26343b;
  font-size: var(--font-lg);
  font-weight: 700;
}

.section-heading span {
  color: #78868d;
  font-size: var(--font-sm);
}

.batch-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  margin-top: 14px;
  padding: 13px;
  border: 1px solid #dfe8e8;
  border-left: 3px solid #1aa898;
  background: #f7faf9;
}

.step-list {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}

.step-card {
  overflow: hidden;
  border: 1px solid #dfe6e8;
  border-radius: 6px;
  background: #fff;
}

.step-card__main {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 15px 16px;
}

.step-order {
  display: grid;
  width: 46px;
  height: 46px;
  place-items: center;
  color: #b9dcd7;
  border: 1px solid #34535a;
  border-radius: 5px;
  background: #1b2c33;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: var(--font-md);
  font-weight: 700;
}

.step-script {
  display: grid;
  min-width: 0;
  grid-template-columns: 110px minmax(0, 1fr);
  align-items: center;
  gap: 8px 12px;
}

.step-script .field-label {
  color: #526168;
  font-size: var(--font-sm);
  font-weight: 650;
}

.step-script small {
  grid-column: 2;
  overflow: hidden;
  color: #829097;
  font-size: var(--font-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.step-actions {
  display: grid;
  grid-template-columns: repeat(3, 40px);
  gap: 7px;
}

.step-actions :deep(.el-button) {
  width: 40px;
  height: 40px;
  margin: 0;
  padding: 0;
}

.mapping-section {
  padding: 13px 16px 15px 88px;
  border-top: 1px solid #edf1f2;
  background: #fafcfc;
}

.mapping-heading {
  min-height: 32px;
}

.mapping-heading strong {
  color: #45545b;
  font-size: var(--font-sm);
}

.mapping-heading span {
  color: #87949a;
  font-size: var(--font-caption);
}

.mapping-list {
  margin-top: 9px;
  overflow-x: auto;
}

.mapping-list__head,
.mapping-row {
  display: grid;
  min-width: 760px;
  grid-template-columns: minmax(190px, 0.9fr) minmax(190px, 1fr) minmax(200px, 1fr) 40px;
  align-items: center;
  gap: 10px;
}

.mapping-list__head {
  padding: 0 0 7px;
  color: #75838a;
  font-size: var(--font-caption);
}

.mapping-row + .mapping-row {
  margin-top: 9px;
}

.mapping-row :deep(.el-button) {
  width: 40px;
  height: 40px;
  padding: 0;
}

.dialog-footer > span {
  color: #76848b;
  font-size: var(--font-sm);
}

@media (max-width: 820px) {
  .basic-grid {
    grid-template-columns: 1fr;
    gap: 0;
  }

  .step-card__main {
    grid-template-columns: 48px minmax(0, 1fr);
  }

  .step-actions {
    grid-column: 2;
    justify-content: end;
  }

  .mapping-section {
    padding-left: 16px;
  }
}

@media (max-width: 620px) {
  .batch-toolbar {
    grid-template-columns: 1fr;
  }

  .step-card__main {
    align-items: start;
    padding: 13px;
  }

  .step-script {
    grid-template-columns: 1fr;
  }

  .step-script small {
    grid-column: 1;
  }

  .mapping-section {
    padding: 12px 13px 14px;
  }

  .mapping-heading {
    align-items: flex-start;
  }

  .dialog-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .dialog-footer > div {
    display: flex;
  }

  .dialog-footer > div .el-button {
    flex: 1;
  }
}
</style>

<style>
.automation-pipeline-dialog {
  display: flex;
  width: min(1120px, calc(100vw - 32px));
  max-width: 1280px;
  max-height: calc(100dvh - 32px);
  flex-direction: column;
  margin: 16px auto;
  border-radius: 7px;
}

.automation-pipeline-dialog .el-dialog__body {
  min-height: 0;
  overflow-y: auto;
  padding-top: 10px;
}

@media (min-width: 1920px) {
  .automation-pipeline-dialog {
    width: min(1280px, calc(100vw - 64px));
  }
}
</style>
