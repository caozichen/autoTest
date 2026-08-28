<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { Check, CopyDocument, Key, Warning } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

import type { TestEnvironment } from '@/domain/environment'
import type { EnvironmentLoginResult, ResponseVariableBinding } from '@/domain/environment-login'
import { getValueAtPath, stringifyExtractedValue } from '@/domain/object-path'
import type { RuntimeVariable } from '@/domain/runtime-variable'

const props = defineProps<{
  modelValue: boolean
  environment: TestEnvironment | null
  result: EnvironmentLoginResult | null
  appliedVariable: RuntimeVariable | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  apply: [binding: ResponseVariableBinding]
}>()

const binding = reactive<ResponseVariableBinding>({
  variableName: '',
  responsePath: '',
})

watch(
  () => [props.modelValue, props.environment] as const,
  ([visible, environment]) => {
    if (!visible || !environment) return
    binding.variableName = environment.auth.tokenVariable || 'AUTH_TOKEN'
    binding.responsePath = environment.auth.tokenPath || 'data.token'
  },
  { immediate: true },
)

const requestJson = computed(() => formatJson(props.result?.requestBody))
const responseText = computed(() => {
  if (!props.result) return ''
  return props.result.rawResponse || (typeof props.result.responseBody === 'string' ? props.result.responseBody : '')
})

const statusLabel = computed(() => {
  if (!props.result) return '等待登录结果'
  if (props.result.businessSuccess) return '业务登录成功'
  return props.result.ok ? '请求成功，业务登录未通过' : '登录请求未通过'
})

const extractedValue = computed(() => {
  return stringifyExtractedValue(getValueAtPath(props.result?.responseBody, binding.responsePath))
})

const maskedValue = computed(() => {
  const value = extractedValue.value
  if (!value) return '未提取到可用值'
  if (value.length <= 12) return '*'.repeat(value.length)
  return `${value.slice(0, 5)}${'*'.repeat(10)}${value.slice(-4)}`
})

const headerTemplate = computed(() => {
  const extractedPrefix = stringifyExtractedValue(props.result?.extractedTokenType)
  const prefix = extractedPrefix?.trim() || props.environment?.auth.tokenTypeFallback.trim() || 'Bearer'
  const name = binding.variableName.trim() || 'AUTH_TOKEN'
  return `Authorization: ${prefix} {{${name}}}`
})

const canApply = computed(() => Boolean(
  props.result?.businessSuccess &&
  binding.variableName.trim() &&
  binding.responsePath.trim() &&
  extractedValue.value,
))

const httpStatus = computed(() => {
  if (!props.result || props.result.status === null) return '未获得响应'
  return `${props.result.status}${props.result.statusText ? ` ${props.result.statusText}` : ''}`
})

function formatJson(value: unknown): string {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

async function copyResponse(): Promise<void> {
  if (!responseText.value) return

  try {
    await navigator.clipboard.writeText(responseText.value)
    ElMessage.success('响应内容已复制')
  } catch {
    ElMessage.error('复制失败，请手动选择响应内容')
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    width="900px"
    class="environment-login-result-dialog"
    destroy-on-close
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #header>
      <div class="dialog-heading">
        <span class="dialog-heading__eyebrow">ENVIRONMENT AUTHENTICATION</span>
        <strong>登录调用结果</strong>
        <span v-if="environment" class="dialog-heading__environment">
          {{ environment.name }} / {{ environment.code }}
        </span>
      </div>
    </template>

    <div v-if="result" class="result-content">
      <section class="status-banner" :class="{ 'status-banner--failed': !result.businessSuccess }">
        <span class="status-banner__icon">
          <el-icon :size="25"><Check v-if="result.businessSuccess" /><Warning v-else /></el-icon>
        </span>
        <div class="status-banner__content">
          <strong>{{ statusLabel }}</strong>
          <span v-if="result.error">{{ result.error }}</span>
          <span v-else-if="result.businessSuccess && appliedVariable">响应满足成功规则，已按当前配置更新全局运行变量。</span>
          <span v-else-if="result.businessSuccess">业务登录成功，但当前路径没有提取到可用变量，旧变量未覆盖。</span>
          <span v-else>{{ result.ok ? 'HTTP 请求成功，但响应未满足业务成功规则，旧变量不会被覆盖。' : '请求未获得 HTTP 成功状态，旧变量不会被覆盖。' }}</span>
        </div>
      </section>

      <dl class="result-metadata">
        <div>
          <dt>HTTP 状态</dt>
          <dd :class="{ 'is-success': result.ok, 'is-error': !result.ok }">{{ httpStatus }}</dd>
        </div>
        <div>
          <dt>请求耗时</dt>
          <dd>{{ result.durationMs }} ms</dd>
        </div>
        <div>
          <dt>接收时间</dt>
          <dd>{{ result.receivedAt }}</dd>
        </div>
        <div>
          <dt>业务结果</dt>
          <dd :class="{ 'is-success': result.businessSuccess, 'is-error': !result.businessSuccess }">
            {{ result.businessSuccess ? '成功' : '未通过' }}
          </dd>
        </div>
      </dl>

      <section class="detail-section">
        <h3>目标 URL</h3>
        <code class="endpoint-value">{{ result.targetUrl }}</code>
      </section>

      <section class="detail-section">
        <h3>请求 JSON</h3>
        <pre class="code-block">{{ requestJson }}</pre>
      </section>

      <section class="detail-section">
        <div class="detail-section__heading">
          <h3>原始响应</h3>
          <el-tooltip content="复制原始响应" placement="top">
            <el-button
              text
              :icon="CopyDocument"
              :disabled="!responseText"
              aria-label="复制原始响应"
              @click="copyResponse"
            >
              复制响应
            </el-button>
          </el-tooltip>
        </div>
        <pre class="code-block code-block--response">{{ responseText || '响应体为空' }}</pre>
      </section>

      <section class="variable-extractor">
        <div class="variable-extractor__heading">
          <div>
            <span class="variable-extractor__icon"><el-icon><Key /></el-icon></span>
            <div>
              <h3>响应变量</h3>
              <p>登录成功后写入全局运行变量；同名变量自动覆盖。</p>
            </div>
          </div>
          <el-tag type="success" effect="light">全局</el-tag>
        </div>

        <div class="variable-extractor__fields">
          <label>
            <span>变量名</span>
            <el-input v-model="binding.variableName" placeholder="AUTH_TOKEN">
              <template #prepend>&#123;&#123;</template>
              <template #append>&#125;&#125;</template>
            </el-input>
          </label>
          <label>
            <span>响应路径</span>
            <el-input v-model="binding.responsePath" placeholder="data.token" />
          </label>
        </div>

        <div class="variable-extractor__preview">
          <div>
            <span>提取预览</span>
            <code :class="{ 'is-empty': !extractedValue }">{{ maskedValue }}</code>
          </div>
          <div>
            <span>后续请求头</span>
            <code>{{ headerTemplate }}</code>
          </div>
        </div>

        <div class="variable-extractor__footer">
          <span v-if="appliedVariable">
            已写入 {{ appliedVariable.key }} · {{ appliedVariable.updatedAt }}
          </span>
          <span v-else>尚未写入运行时变量</span>
          <el-button type="primary" :disabled="!canApply" @click="emit('apply', { ...binding })">
            保存并应用
          </el-button>
        </div>
      </section>
    </div>

    <el-empty v-else description="暂无登录调用结果" :image-size="72" />

    <template #footer>
      <el-button type="primary" @click="emit('update:modelValue', false)">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.dialog-heading {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 5px 12px;
}

.dialog-heading__eyebrow {
  width: 100%;
  color: var(--color-primary, #2563eb);
  font-size: var(--font-caption);
  font-weight: 700;
}

.dialog-heading strong {
  color: var(--color-text-primary, #1f2a44);
  font-size: var(--font-lg);
  font-weight: 700;
}

.dialog-heading__environment {
  overflow: hidden;
  color: var(--color-text-muted, #94a3b8);
  font-size: var(--font-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-content {
  display: grid;
  gap: 14px;
}

.status-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 72px;
  padding: 12px 14px;
  color: #166534;
  border: 1px solid #bbf7d0;
  border-left: 4px solid var(--color-success, #16a34a);
  border-radius: 5px;
  background: #f0fdf4;
}

.status-banner--failed {
  color: #991b1b;
  border-color: #fecaca;
  border-left-color: var(--color-danger, #dc2626);
  background: #fef2f2;
}

.status-banner__icon {
  display: grid;
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  place-items: center;
  color: #fff;
  border-radius: 5px;
  background: var(--color-success, #16a34a);
}

.status-banner--failed .status-banner__icon {
  background: var(--color-danger, #dc2626);
}

.status-banner__content {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.status-banner__content strong {
  font-size: var(--font-md);
}

.status-banner__content span {
  overflow-wrap: anywhere;
  font-size: var(--font-sm);
  line-height: 1.55;
}

.result-metadata {
  display: grid;
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--color-border, #e5ebf3);
  border-radius: min(var(--radius-card, 6px), 8px);
  grid-template-columns: repeat(4, minmax(0, 1fr));
  background: var(--color-bg-subtle, #f8fafc);
}

.result-metadata > div {
  min-width: 0;
  padding: 11px 13px;
  border-right: 1px solid var(--color-border-light, #eef2f7);
}

.result-metadata > div:last-child {
  border-right: 0;
}

.result-metadata dt {
  margin-bottom: 5px;
  color: var(--color-text-muted, #94a3b8);
  font-size: var(--font-xs);
}

.result-metadata dd {
  overflow: hidden;
  margin: 0;
  color: var(--color-text-primary, #1f2a44);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: var(--font-sm);
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-metadata dd.is-success {
  color: var(--color-success, #16a34a);
}

.result-metadata dd.is-error {
  color: var(--color-danger, #dc2626);
}

.detail-section {
  min-width: 0;
}

.detail-section h3 {
  margin: 0 0 9px;
  color: var(--color-text-primary, #1f2a44);
  font-size: var(--font-md);
  font-weight: 650;
}

.detail-section__heading {
  display: flex;
  min-height: 42px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.detail-section__heading h3 {
  margin-bottom: 0;
}

.endpoint-value,
.code-block {
  display: block;
  width: 100%;
  overflow: auto;
  color: #dbeafe;
  border: 1px solid #334155;
  border-radius: 5px;
  background: #172033;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: var(--font-sm);
  line-height: 1.65;
}

.endpoint-value {
  padding: 11px 13px;
  overflow-wrap: anywhere;
}

.code-block {
  max-height: 210px;
  margin: 0;
  padding: 13px 15px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.code-block--response {
  min-height: 110px;
  max-height: 300px;
  color: #e2e8f0;
}

.variable-extractor {
  overflow: hidden;
  border: 1px solid var(--color-border, #e5ebf3);
  border-radius: min(var(--radius-card, 6px), 8px);
  background: var(--color-surface, #fff);
  box-shadow: 0 1px 2px rgb(15 23 42 / 4%);
}

.variable-extractor__heading,
.variable-extractor__heading > div,
.variable-extractor__footer {
  display: flex;
  align-items: center;
}

.variable-extractor__heading {
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--color-border-light, #eef2f7);
  background: var(--color-bg-subtle, #f8fafc);
}

.variable-extractor__heading > div {
  min-width: 0;
  gap: 12px;
}

.variable-extractor__icon {
  display: grid;
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  place-items: center;
  color: var(--color-primary, #2563eb);
  border-radius: 5px;
  background: var(--color-primary-soft, #eff6ff);
}

.variable-extractor h3,
.variable-extractor p {
  margin: 0;
}

.variable-extractor h3 {
  color: var(--color-text-primary, #1f2a44);
  font-size: var(--font-md);
}

.variable-extractor p {
  margin-top: 3px;
  color: var(--color-text-muted, #94a3b8);
  font-size: var(--font-sm);
}

.variable-extractor__fields {
  display: grid;
  gap: 12px;
  padding: 14px 14px 10px;
  grid-template-columns: minmax(220px, 0.8fr) minmax(280px, 1.2fr);
}

.variable-extractor__fields label > span,
.variable-extractor__preview span {
  display: block;
  margin-bottom: 7px;
  color: var(--color-text-secondary, #64748b);
  font-size: var(--font-sm);
  font-weight: 600;
}

.variable-extractor__preview {
  display: grid;
  gap: 12px;
  padding: 0 14px 14px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.variable-extractor__preview > div {
  min-width: 0;
  padding: 9px 11px;
  border: 1px solid var(--color-border, #e5ebf3);
  border-radius: 5px;
  background: var(--color-bg-subtle, #f8fafc);
}

.variable-extractor__preview code {
  display: block;
  overflow: hidden;
  color: var(--color-primary, #2563eb);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: var(--font-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.variable-extractor__preview code.is-empty {
  color: var(--color-warning, #d97706);
}

.variable-extractor__footer {
  min-height: 56px;
  justify-content: space-between;
  gap: 14px;
  padding: 10px 14px;
  border-top: 1px solid var(--color-border-light, #eef2f7);
  background: var(--color-bg-subtle, #f8fafc);
}

.variable-extractor__footer > span {
  overflow: hidden;
  color: var(--color-text-secondary, #64748b);
  font-size: var(--font-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 680px) {
  .result-metadata {
    grid-template-columns: 1fr;
  }

  .result-metadata > div {
    border-right: 0;
    border-bottom: 1px solid var(--color-border-light, #eef2f7);
  }

  .result-metadata > div:last-child {
    border-bottom: 0;
  }

  .status-banner {
    align-items: flex-start;
  }

  .variable-extractor__fields,
  .variable-extractor__preview {
    grid-template-columns: 1fr;
  }

  .variable-extractor__footer {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>

<style>
.environment-login-result-dialog {
  --el-color-primary: var(--color-primary, #2563eb);
  display: flex;
  max-width: calc(100vw - 28px);
  max-height: calc(100dvh - 32px);
  flex-direction: column;
  margin: 16px auto;
  overflow: hidden;
  border: 1px solid var(--color-border, #e5ebf3);
  border-radius: min(var(--radius-card, 6px), 8px);
  background: var(--color-surface, #fff);
  box-shadow: var(--shadow-card, 0 10px 30px rgb(15 23 42 / 10%));
}

.environment-login-result-dialog .el-dialog__header {
  margin: 0;
  padding: 15px 20px 13px;
  border-bottom: 1px solid var(--color-border-light, #eef2f7);
}

.environment-login-result-dialog .el-dialog__body {
  min-height: 0;
  overflow-y: auto;
  padding: 14px 20px 16px;
  color: var(--color-text-primary, #1f2a44);
}

.environment-login-result-dialog .el-dialog__footer {
  flex: 0 0 auto;
  padding: 12px 20px;
  border-top: 1px solid var(--color-border-light, #eef2f7);
  background: var(--color-bg-subtle, #f8fafc);
}
</style>
