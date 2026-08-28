<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'

import type { TestEnvironment } from '@/domain/environment'
import { getValueAtPath, stringifyRuntimeVariableValue } from '@/domain/object-path'
import type {
  AutomationScript,
  ScriptDraft,
  ScriptInputParameter,
  ScriptResponseVariableBinding,
} from '@/domain/script'
import {
  DEFAULT_SCRIPT_TIMEOUT_MS,
  MAX_SCRIPT_TIMEOUT_MS,
  MIN_SCRIPT_TIMEOUT_MS,
} from '@/domain/script'
import {
  buildScriptRequestUrl,
  defaultRequestPathForScript,
  normalizeScriptRequestPath,
  requestOriginForScript,
  requestOriginModeForScript,
  supportsScriptRequestPath,
} from '@/domain/script-request-url'
import {
  cloneScriptInputParameters,
  normalizeScriptInputParameters,
  scriptInputParameterDefaults,
} from '@/services/scripts/script-input-parameters'
import { normalizeScriptResponseVariableBindings } from '@/services/scripts/script-response-variables'

interface ScriptVariableOption {
  key: string
  value: string
  secret: boolean
}

const props = defineProps<{
  modelValue: boolean
  script: AutomationScript | null
  environment: TestEnvironment | null
  variables: ScriptVariableOption[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [draft: ScriptDraft]
}>()

const commonTags = ['冒烟', '回归', 'P0', 'API', '权限', '交易']
const formRef = ref<FormInstance>()
const selectedRequestVariable = ref('')
const title = computed(() => props.script ? '编辑脚本' : '新增脚本')
const supportsRequestPathConfig = computed(() => supportsScriptRequestPath(props.script?.id))
const requestOriginMode = computed(() => requestOriginModeForScript(props.script?.id))
const requestOriginLabel = computed(() => requestOriginMode.value === 'admin' ? '管理端域名' : '公开域名')
const requestOrigin = computed(() => {
  if (!props.environment) return ''
  try {
    return requestOriginForScript(props.script?.id, props.environment.baseUrl)
  } catch {
    return ''
  }
})
const requestVariableOptions = computed<ScriptVariableOption[]>(() => {
  const byKey = new Map<string, ScriptVariableOption>()
  for (const parameter of form.inputParameters ?? []) {
    const key = parameter.key.trim()
    if (key) byKey.set(key, { key, value: parameter.value, secret: false })
  }
  for (const variable of props.variables) byKey.set(variable.key, variable)
  return [...byKey.values()]
})
const finalRequestUrl = computed(() => {
  if (!props.environment || !supportsRequestPathConfig.value) return ''
  try {
    const runtimeVariables = Object.fromEntries(props.variables.map((variable) => [
      variable.key,
      variable.secret ? '******' : variable.value,
    ]))
    const previewVariables = {
      ...scriptInputParameterDefaults(form.inputParameters),
      ...runtimeVariables,
    }
    return buildScriptRequestUrl(
      props.script?.id,
      props.environment.baseUrl,
      form.requestPath ?? '',
      previewVariables,
    )
  } catch {
    return ''
  }
})
const lastOutput = computed(() => props.script?.lastRunResult?.output ?? null)
const lastOutputJson = computed(() => {
  if (!lastOutput.value) return ''
  try {
    return JSON.stringify(lastOutput.value, null, 2)
  } catch {
    return String(lastOutput.value)
  }
})
const form = reactive<ScriptDraft>({
  name: '',
  description: '',
  directory: '',
  entryFile: '',
  timeoutMs: DEFAULT_SCRIPT_TIMEOUT_MS,
  requestPath: '',
  inputParameters: [],
  responseVariableBindings: [],
  tags: [],
  enabled: true,
})

const rules: FormRules<ScriptDraft> = {
  name: [
    { required: true, message: '请输入脚本名称', trigger: 'blur' },
    { min: 2, max: 40, message: '名称长度应为 2 到 40 个字符', trigger: 'blur' },
  ],
  description: [{ required: true, message: '请输入脚本简介', trigger: 'blur' }],
  directory: [{ required: true, message: '请输入项目目录', trigger: 'blur' }],
  entryFile: [{ required: true, message: '请输入入口文件', trigger: 'blur' }],
  timeoutMs: [{
    validator: (_rule, value, callback) => {
      if (!Number.isInteger(value)
        || value < MIN_SCRIPT_TIMEOUT_MS
        || value > MAX_SCRIPT_TIMEOUT_MS) {
        callback(new Error(`请输入 ${MIN_SCRIPT_TIMEOUT_MS} 到 ${MAX_SCRIPT_TIMEOUT_MS} 之间的整数毫秒值`))
        return
      }
      callback()
    },
    trigger: ['blur', 'change'],
  }],
  requestPath: [{
    validator: (_rule, value, callback) => {
      if (!supportsRequestPathConfig.value) return callback()
      try {
        normalizeScriptRequestPath(String(value ?? ''))
        callback()
      } catch (error) {
        callback(error instanceof Error ? error : new Error('URL 路径无效'))
      }
    },
    trigger: ['blur', 'change'],
  }],
}

watch(
  () => [props.modelValue, props.script] as const,
  ([visible, script]) => {
    if (!visible) return
    form.name = script?.name ?? ''
    form.description = script?.description ?? ''
    form.directory = script?.directory ?? ''
    form.entryFile = script?.entryFile ?? ''
    form.timeoutMs = script?.timeoutMs ?? DEFAULT_SCRIPT_TIMEOUT_MS
    form.requestPath = script?.requestPath
      ?? defaultRequestPathForScript(script?.id)
    form.inputParameters = cloneScriptInputParameters(script?.inputParameters)
    form.responseVariableBindings = (script?.responseVariableBindings ?? [])
      .map((binding) => ({ ...binding }))
    form.tags = [...(script?.tags ?? [])]
    form.enabled = script?.status !== 'disabled'
    selectedRequestVariable.value = ''
    formRef.value?.clearValidate()
  },
  { immediate: true },
)

async function submit(): Promise<void> {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  let inputParameters: ScriptInputParameter[]
  let responseVariableBindings: ScriptResponseVariableBinding[]
  try {
    inputParameters = normalizeScriptInputParameters(form.inputParameters)
  } catch (error) {
    ElMessage.warning(error instanceof Error ? error.message : '输入参数无效')
    return
  }
  try {
    responseVariableBindings = normalizeScriptResponseVariableBindings(form.responseVariableBindings)
  } catch (error) {
    ElMessage.warning(error instanceof Error ? error.message : '响应变量规则无效')
    return
  }
  emit('save', {
    ...form,
    requestPath: supportsRequestPathConfig.value
      ? normalizeScriptRequestPath(form.requestPath ?? '')
      : undefined,
    inputParameters,
    responseVariableBindings,
    tags: [...form.tags],
  })
}

function insertRequestVariable(variableName: string): void {
  if (!variableName) return
  form.requestPath = `${form.requestPath ?? ''}{{${variableName}}}`
  selectedRequestVariable.value = ''
}

function addInputParameter(): void {
  form.inputParameters ??= []
  form.inputParameters.push({
    id: crypto.randomUUID(),
    key: '',
    value: '',
    description: '',
  })
}

function removeInputParameter(id: string): void {
  form.inputParameters = (form.inputParameters ?? [])
    .filter((parameter) => parameter.id !== id)
}

function addResponseVariableBinding(): void {
  form.responseVariableBindings ??= []
  form.responseVariableBindings.push({
    id: crypto.randomUUID(),
    variableName: '',
    responsePath: '',
    secret: false,
  })
}

function removeResponseVariableBinding(id: string): void {
  form.responseVariableBindings = (form.responseVariableBindings ?? [])
    .filter((binding) => binding.id !== id)
}

function extractedPreview(binding: ScriptResponseVariableBinding): string {
  const value = stringifyRuntimeVariableValue(getValueAtPath(lastOutput.value, binding.responsePath))
  if (value === null || !value.trim()) return '未匹配'
  if (!binding.secret) return value
  return value.length <= 8 ? '*'.repeat(value.length) : `${value.slice(0, 3)}******${value.slice(-3)}`
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="title"
    width="800px"
    class="script-dialog"
    destroy-on-close
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
      <div class="form-grid">
        <el-form-item label="脚本名称" prop="name">
          <el-input v-model="form.name" maxlength="40" show-word-limit placeholder="请输入脚本名称" />
        </el-form-item>
        <el-form-item label="运行状态">
          <div class="enable-field">
            <el-switch v-model="form.enabled" />
            <span>{{ form.enabled ? '启用' : '停用' }}</span>
          </div>
        </el-form-item>
      </div>

      <el-form-item label="脚本简介" prop="description">
        <el-input v-model="form.description" type="textarea" :rows="3" maxlength="160" show-word-limit placeholder="简要描述脚本覆盖的业务场景" />
      </el-form-item>

      <el-form-item label="项目目录" prop="directory">
        <el-input v-model="form.directory" placeholder="D:\automation-tests\project-name" />
      </el-form-item>

      <el-form-item label="入口文件" prop="entryFile">
        <el-input v-model="form.entryFile" placeholder="请输入入口文件路径" />
      </el-form-item>

      <el-form-item label="脚本执行超时（毫秒）" prop="timeoutMs">
        <el-input-number
          v-model="form.timeoutMs"
          :min="MIN_SCRIPT_TIMEOUT_MS"
          :max="MAX_SCRIPT_TIMEOUT_MS"
          :step="1000"
          controls-position="right"
        />
      </el-form-item>

      <section class="input-parameter-config" aria-label="输入参数配置">
        <div class="input-parameter-config__heading">
          <strong>输入参数</strong>
          <el-button :icon="Plus" @click="addInputParameter">添加参数</el-button>
        </div>

        <div v-if="form.inputParameters?.length" class="input-parameter-list">
          <div class="input-parameter-list__head" aria-hidden="true">
            <span>参数名</span>
            <span>默认值</span>
            <span>说明</span>
            <span />
          </div>
          <div
            v-for="parameter in form.inputParameters"
            :key="parameter.id"
            class="input-parameter-row"
          >
            <el-input v-model="parameter.key" placeholder="SUBMISSION_ID" />
            <el-input v-model="parameter.value" placeholder="默认值可留空" />
            <el-input v-model="parameter.description" placeholder="参数说明" />
            <el-tooltip content="删除输入参数" placement="top">
              <el-button
                text
                type="danger"
                :icon="Delete"
                aria-label="删除输入参数"
                @click="removeInputParameter(parameter.id)"
              />
            </el-tooltip>
          </div>
        </div>
        <el-empty v-else description="暂无输入参数" :image-size="56" />
      </section>

      <section v-if="supportsRequestPathConfig" class="request-config" aria-label="请求地址配置">
        <div class="request-config__heading">
          <strong>请求地址配置</strong>
          <span>运行时自动拼接所选环境的{{ requestOriginLabel }}</span>
        </div>

        <div v-if="environment" class="request-config__environment">
          <div>
            <span>当前环境</span>
            <strong>{{ environment.name }} · {{ environment.code }}</strong>
          </div>
          <div>
            <span>{{ requestOriginLabel }}</span>
            <code>{{ requestOrigin || '环境域名无效' }}</code>
          </div>
        </div>
        <el-alert v-else title="当前未选择运行环境，请先在脚本列表选择环境" type="warning" :closable="false" show-icon />

        <el-form-item label="URL 路径" prop="requestPath" class="request-config__path">
          <el-input v-model="form.requestPath" placeholder="/form/?id=lpXAVN" clearable>
            <template #prepend>{{ requestOrigin || `环境${requestOriginLabel}` }}</template>
          </el-input>
        </el-form-item>

        <div class="request-config__variables">
          <span>插入运行变量</span>
          <el-select
            v-model="selectedRequestVariable"
            filterable
            clearable
            :disabled="requestVariableOptions.length === 0"
            :placeholder="requestVariableOptions.length ? '选择变量' : '暂无可用变量，可直接输入 {{变量名}}'"
            @change="insertRequestVariable"
          >
            <el-option
              v-for="variable in requestVariableOptions"
              :key="variable.key"
              :label="`{{${variable.key}}}${variable.secret ? ' · 敏感' : ''}`"
              :value="variable.key"
            />
          </el-select>
        </div>

        <div class="request-config__preview" :class="{ 'request-config__preview--invalid': !finalRequestUrl }">
          <span>最终请求地址</span>
          <code>{{ finalRequestUrl || '请输入有效的 URL 路径后预览' }}</code>
        </div>
      </section>

      <section class="response-variable-config" aria-label="响应变量配置">
        <div class="response-variable-config__heading">
          <div>
            <strong>响应变量</strong>
            <span>从脚本运行结果中提取值并写入全局运行变量；对象和数组会保存为 JSON</span>
          </div>
          <el-button :icon="Plus" @click="addResponseVariableBinding">添加规则</el-button>
        </div>

        <details v-if="lastOutputJson" class="response-output">
          <summary>上次运行输出 JSON</summary>
          <pre>{{ lastOutputJson }}</pre>
        </details>
        <div v-else class="response-output response-output--empty">暂无可预览的运行输出</div>

        <div v-if="form.responseVariableBindings?.length" class="response-binding-list">
          <div class="response-binding-list__head" aria-hidden="true">
            <span>结果路径</span>
            <span>全局变量名</span>
            <span>提取预览</span>
            <span>敏感</span>
            <span />
          </div>
          <div
            v-for="binding in form.responseVariableBindings"
            :key="binding.id"
            class="response-binding-row"
          >
            <el-input v-model="binding.responsePath" placeholder="例如 formId 或 data.id" />
            <el-input v-model="binding.variableName" placeholder="FORM_ID">
              <template #prepend>&#123;&#123;</template>
              <template #append>&#125;&#125;</template>
            </el-input>
            <code :class="{ 'is-empty': extractedPreview(binding) === '未匹配' }">
              {{ extractedPreview(binding) }}
            </code>
            <el-switch v-model="binding.secret" aria-label="敏感变量" />
            <el-tooltip content="删除提取规则" placement="top">
              <el-button
                text
                type="danger"
                :icon="Delete"
                aria-label="删除提取规则"
                @click="removeResponseVariableBinding(binding.id)"
              />
            </el-tooltip>
          </div>
        </div>
        <el-empty v-else description="暂无响应变量规则" :image-size="56" />
      </section>

      <el-form-item label="标签">
        <el-select v-model="form.tags" multiple filterable allow-create default-first-option placeholder="选择或输入标签">
          <el-option v-for="tag in commonTags" :key="tag" :label="tag" :value="tag" />
        </el-select>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" @click="submit">保存脚本</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.form-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 150px;
  gap: 14px;
}

.enable-field {
  display: flex;
  min-height: 36px;
  align-items: center;
  gap: 9px;
  color: var(--color-text-secondary, #64748b);
  font-size: var(--font-sm);
}

.request-config {
  margin-bottom: 14px;
  padding: 14px;
  border: 1px solid var(--color-border, #e5ebf3);
  border-left: 3px solid var(--color-primary, #2563eb);
  border-radius: min(var(--radius-card, 6px), 8px);
  background: var(--color-bg-subtle, #f8fafc);
}

.request-config__heading,
.request-config__environment {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.request-config__heading {
  align-items: baseline;
  margin-bottom: 12px;
}

.request-config__heading strong {
  color: var(--color-text-primary, #1f2a44);
  font-size: var(--font-md);
}

.request-config__heading span,
.request-config__environment span,
.request-config__preview span {
  color: var(--color-text-muted, #94a3b8);
  font-size: var(--font-xs);
}

.request-config__environment {
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--color-border-light, #eef2f7);
}

.request-config__environment > div {
  min-width: 0;
  flex: 1;
}

.request-config__environment span,
.request-config__environment strong,
.request-config__environment code,
.request-config__preview span,
.request-config__preview code {
  display: block;
}

.request-config__environment strong,
.request-config__environment code {
  margin-top: 4px;
  overflow-wrap: anywhere;
  color: var(--color-text-primary, #1f2a44);
  font-size: var(--font-sm);
}

.request-config__environment code,
.request-config__preview code {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.request-config__path {
  margin-bottom: 12px;
}

.request-config__variables {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.request-config__variables > span {
  color: var(--color-text-secondary, #64748b);
  font-size: var(--font-sm);
}

.request-config__preview {
  padding: 9px 11px;
  border: 1px solid var(--color-border, #e5ebf3);
  border-radius: 5px;
  background: var(--color-surface, #fff);
}

.request-config__preview code {
  margin-top: 4px;
  overflow-wrap: anywhere;
  color: var(--color-primary, #2563eb);
  font-size: var(--font-xs);
}

.request-config__preview--invalid code {
  color: var(--color-warning, #d97706);
}

.input-parameter-config,
.response-variable-config {
  margin-bottom: 14px;
  padding: 14px;
  border: 1px solid var(--color-border, #e5ebf3);
  border-radius: min(var(--radius-card, 6px), 8px);
  background: var(--color-bg-subtle, #f8fafc);
}

.input-parameter-config__heading,
.response-variable-config__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.input-parameter-config__heading strong,
.response-variable-config__heading strong,
.response-variable-config__heading span {
  display: block;
}

.input-parameter-config__heading strong,
.response-variable-config__heading strong {
  color: var(--color-text-primary, #1f2a44);
  font-size: var(--font-md);
}

.response-variable-config__heading span {
  margin-top: 3px;
  color: var(--color-text-muted, #94a3b8);
  font-size: var(--font-xs);
}

.response-output {
  margin-bottom: 12px;
  border: 1px solid var(--color-border, #e5ebf3);
  border-radius: 5px;
  background: var(--color-surface, #fff);
}

.response-output summary {
  padding: 9px 11px;
  color: var(--color-text-secondary, #64748b);
  cursor: pointer;
  font-size: var(--font-sm);
}

.response-output pre {
  max-height: 190px;
  overflow: auto;
  margin: 0;
  padding: 10px 11px;
  border-top: 1px solid var(--color-border-light, #eef2f7);
  color: var(--color-text-primary, #1f2a44);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: var(--font-xs);
  white-space: pre-wrap;
}

.response-output--empty {
  padding: 11px 12px;
  color: var(--color-text-muted, #94a3b8);
  font-size: var(--font-sm);
}

.input-parameter-list__head,
.input-parameter-row {
  display: grid;
  grid-template-columns: minmax(240px, 1.1fr) minmax(130px, 0.8fr) minmax(190px, 1fr) 40px;
  align-items: center;
  gap: 10px;
}

.input-parameter-list__head {
  margin-bottom: 7px;
  padding: 0 4px;
  color: var(--color-text-secondary, #64748b);
  font-size: var(--font-xs);
}

.input-parameter-row + .input-parameter-row {
  margin-top: 8px;
}

.response-binding-list__head,
.response-binding-row {
  display: grid;
  grid-template-columns: minmax(150px, 1fr) minmax(190px, 1fr) minmax(110px, 0.75fr) 52px 40px;
  align-items: center;
  gap: 10px;
}

.response-binding-list__head {
  margin-bottom: 7px;
  padding: 0 4px;
  color: var(--color-text-secondary, #64748b);
  font-size: var(--font-xs);
}

.response-binding-row + .response-binding-row {
  margin-top: 8px;
}

.response-binding-row > code {
  overflow: hidden;
  padding: 0 4px;
  color: var(--color-primary, #2563eb);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: var(--font-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.response-binding-row > code.is-empty {
  color: var(--color-warning, #d97706);
}

:deep(.el-select) {
  width: 100%;
}

@media (max-width: 700px) {
  .form-grid {
    grid-template-columns: 1fr;
    gap: 0;
  }

  .request-config__heading,
  .request-config__environment,
  .input-parameter-config__heading,
  .response-variable-config__heading {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  :deep(.request-config .el-input-group__prepend) {
    display: none;
  }

  .request-config__variables,
  .input-parameter-row,
  .response-binding-row {
    grid-template-columns: 1fr;
  }

  .input-parameter-list__head,
  .response-binding-list__head {
    display: none;
  }

  .input-parameter-row,
  .response-binding-row {
    padding-top: 12px;
    border-top: 1px solid var(--color-border-light, #eef2f7);
  }

  .response-binding-row > code {
    padding: 8px 10px;
    border: 1px solid var(--color-border, #e5ebf3);
    border-radius: 4px;
    background: var(--color-surface, #fff);
  }
}
</style>

<style>
.script-dialog {
  --el-color-primary: var(--color-primary, #2563eb);
  max-width: calc(100vw - 28px);
  max-height: calc(100dvh - 32px);
  display: flex;
  flex-direction: column;
  margin: 16px auto;
  overflow: hidden;
  border: 1px solid var(--color-border, #e5ebf3);
  border-radius: min(var(--radius-card, 6px), 8px);
  background: var(--color-surface, #fff);
  box-shadow: var(--shadow-card, 0 10px 30px rgb(15 23 42 / 10%));
}

.script-dialog .el-dialog__header {
  margin: 0;
  padding: 16px 20px 14px;
  border-bottom: 1px solid var(--color-border-light, #eef2f7);
}

.script-dialog .el-dialog__title {
  color: var(--color-text-primary, #1f2a44);
  font-weight: 650;
}

.script-dialog .el-dialog__body {
  min-height: 0;
  overflow-y: auto;
  padding: 14px 20px 16px;
  color: var(--color-text-primary, #1f2a44);
}

.script-dialog .el-dialog__footer {
  padding: 12px 20px;
  border-top: 1px solid var(--color-border-light, #eef2f7);
  background: var(--color-bg-subtle, #f8fafc);
}
</style>
