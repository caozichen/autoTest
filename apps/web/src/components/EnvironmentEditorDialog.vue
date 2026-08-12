<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'

import type { EnvironmentDraft, TestEnvironment } from '@/domain/environment'

const props = defineProps<{
  modelValue: boolean
  environment: TestEnvironment | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [draft: EnvironmentDraft]
}>()

const formRef = ref<FormInstance>()
const activeTab = ref('basic')
const title = computed(() => props.environment ? '编辑环境' : '新增环境')

function emptyDraft(): EnvironmentDraft {
  return {
    name: '',
    code: '',
    description: '',
    baseUrl: '',
    apiBaseUrl: '',
    ignoreHTTPSErrors: false,
    enabled: true,
    auth: {
      mode: 'mobile-code',
      method: 'POST',
      timeoutMs: 30_000,
      loginPath: '/api/auth/login',
      username: '',
      password: '',
      mobile: '',
      verifyCode: '',
      successPath: 'code',
      successValue: '0',
      tokenPath: 'data.token',
      tokenVariable: 'AUTH_TOKEN',
      tokenTypePath: 'data.token_type',
      tokenTypeFallback: 'Bearer',
    },
    variables: [],
  }
}

const form = reactive<EnvironmentDraft>(emptyDraft())
const loginUrlPreview = computed(() => {
  if (!form.apiBaseUrl.trim() || !form.auth.loginPath.trim()) return '请填写 API 基址和登录路径'
  return `${form.apiBaseUrl.replace(/\/+$/, '')}/${form.auth.loginPath.replace(/^\/+/, '')}`
})
const rules: FormRules<EnvironmentDraft> = {
  name: [
    { required: true, message: '请输入环境名称', trigger: 'blur' },
    { min: 2, max: 24, message: '名称长度应为 2 到 24 个字符', trigger: 'blur' },
  ],
  code: [
    { required: true, message: '请输入环境标识', trigger: 'blur' },
    { pattern: /^[A-Za-z][A-Za-z0-9_-]*$/, message: '只能使用字母、数字、下划线和中划线', trigger: 'blur' },
  ],
  description: [{ required: true, message: '请输入环境简介', trigger: 'blur' }],
  baseUrl: [
    { required: true, message: '请输入环境访问地址', trigger: 'blur' },
    { pattern: /^https?:\/\//, message: '地址必须以 http:// 或 https:// 开头', trigger: 'blur' },
  ],
  apiBaseUrl: [
    { required: true, message: '请输入 API 基础地址', trigger: 'blur' },
    { pattern: /^https?:\/\//, message: '地址必须以 http:// 或 https:// 开头', trigger: 'blur' },
  ],
}

watch(
  () => [props.modelValue, props.environment] as const,
  ([visible, environment]) => {
    if (!visible) return
    const source: EnvironmentDraft = environment
      ? {
          name: environment.name,
          code: environment.code,
          description: environment.description,
          baseUrl: environment.baseUrl,
          apiBaseUrl: environment.apiBaseUrl,
          ignoreHTTPSErrors: environment.ignoreHTTPSErrors,
          enabled: environment.enabled,
          auth: structuredClone(environment.auth),
          variables: structuredClone(environment.variables),
        }
      : emptyDraft()
    Object.assign(form, source)
    activeTab.value = 'basic'
    formRef.value?.clearValidate()
  },
  { immediate: true },
)

function addVariable(): void {
  form.variables.push({
    id: crypto.randomUUID(),
    key: '',
    value: '',
    description: '',
    secret: false,
    enabled: true,
  })
}

function removeVariable(id: string): void {
  form.variables = form.variables.filter((variable) => variable.id !== id)
}

async function submit(): Promise<void> {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) {
    activeTab.value = 'basic'
    return
  }

  if (!form.auth.method || !form.auth.loginPath.trim()) {
    activeTab.value = 'auth'
    ElMessage.warning('请填写登录请求方法和接口路径')
    return
  }

  const credentials = form.auth.mode === 'mobile-code'
    ? [form.auth.mobile, form.auth.verifyCode]
    : [form.auth.username, form.auth.password]
  if (credentials.some((value) => !value.trim())) {
    activeTab.value = 'auth'
    ElMessage.warning(form.auth.mode === 'mobile-code' ? '请填写手机号和验证码' : '请填写登录账号和密码')
    return
  }

  if (!form.auth.tokenPath.trim() || !form.auth.tokenVariable.trim()) {
    activeTab.value = 'auth'
    ElMessage.warning('请完整填写响应变量名和响应路径')
    return
  }

  const enabledVariables = form.variables.filter((variable) => variable.enabled)
  if (enabledVariables.some((variable) => !variable.key.trim())) {
    activeTab.value = 'variables'
    ElMessage.warning('启用的环境变量必须填写变量名')
    return
  }

  const keys = enabledVariables.map((variable) => variable.key.trim().toLowerCase())
  if (new Set(keys).size !== keys.length) {
    activeTab.value = 'variables'
    ElMessage.warning('环境变量名不能重复')
    return
  }

  const draft = structuredClone(form)
  if (draft.auth.mode === 'mobile-code') {
    draft.auth.username = ''
    draft.auth.password = ''
  } else {
    draft.auth.mobile = ''
    draft.auth.verifyCode = ''
  }
  emit('save', draft)
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="title"
    width="920px"
    class="environment-dialog"
    destroy-on-close
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
      <el-tabs v-model="activeTab" class="environment-tabs">
        <el-tab-pane label="基础配置" name="basic">
          <div class="form-grid form-grid--name">
            <el-form-item label="环境名称" prop="name">
              <el-input v-model="form.name" maxlength="24" placeholder="例如：测试环境" />
            </el-form-item>
            <el-form-item label="环境标识" prop="code">
              <el-input v-model="form.code" maxlength="20" placeholder="TEST" @input="form.code = form.code.toUpperCase()" />
            </el-form-item>
            <el-form-item label="状态">
              <div class="enable-field">
                <el-switch v-model="form.enabled" />
                <span>{{ form.enabled ? '启用' : '停用' }}</span>
              </div>
            </el-form-item>
          </div>
          <div class="form-grid">
            <el-form-item label="环境访问地址" prop="baseUrl">
              <el-input v-model="form.baseUrl" placeholder="请输入环境访问地址" />
            </el-form-item>
            <el-form-item label="API 基础地址" prop="apiBaseUrl">
              <el-input v-model="form.apiBaseUrl" placeholder="请输入 API 基址" />
            </el-form-item>
          </div>
          <el-form-item label="忽略 HTTPS 证书校验">
            <div class="enable-field">
              <el-switch v-model="form.ignoreHTTPSErrors" />
              <span>{{ form.ignoreHTTPSErrors ? '已开启，仅用于测试环境' : '严格校验证书链' }}</span>
            </div>
          </el-form-item>
          <el-form-item label="环境简介" prop="description">
            <el-input v-model="form.description" type="textarea" :rows="4" maxlength="160" show-word-limit placeholder="说明环境用途和使用限制" />
          </el-form-item>
        </el-tab-pane>

        <el-tab-pane label="登录与 Token" name="auth">
          <div class="auth-hint">
            登录凭据仅保存在当前浏览器本地；测试登录的响应只在本次弹窗中展示，不会写入本地存储。
          </div>
          <div class="form-grid">
            <el-form-item label="登录方式">
              <el-select v-model="form.auth.mode">
                <el-option label="手机号验证码" value="mobile-code" />
                <el-option label="账号密码" value="password" />
              </el-select>
            </el-form-item>
            <el-form-item label="请求方法">
              <el-select v-model="form.auth.method">
                <el-option label="POST" value="POST" />
                <el-option label="PUT" value="PUT" />
                <el-option label="PATCH" value="PATCH" />
              </el-select>
            </el-form-item>
          </div>
          <el-form-item label="请求超时（毫秒）">
            <el-input-number v-model="form.auth.timeoutMs" :min="5000" :max="120000" :step="5000" controls-position="right" />
          </el-form-item>
          <el-form-item label="登录接口路径">
            <el-input v-model="form.auth.loginPath" placeholder="/be/login/mobile" />
            <code class="login-url-preview">{{ loginUrlPreview }}</code>
          </el-form-item>
          <div v-if="form.auth.mode === 'mobile-code'" class="form-grid">
            <el-form-item label="手机号">
              <el-input v-model="form.auth.mobile" autocomplete="tel" placeholder="请输入登录手机号">
                <template #prepend>mobile</template>
              </el-input>
            </el-form-item>
            <el-form-item label="验证码">
              <el-input v-model="form.auth.verifyCode" autocomplete="one-time-code" placeholder="请输入当前验证码">
                <template #prepend>verify_code</template>
              </el-input>
            </el-form-item>
          </div>
          <div v-else class="form-grid">
            <el-form-item label="登录账号">
              <el-input v-model="form.auth.username" autocomplete="off" placeholder="自动化测试账号" />
            </el-form-item>
            <el-form-item label="登录密码">
              <el-input v-model="form.auth.password" type="password" autocomplete="new-password" placeholder="测试账号密码" show-password />
            </el-form-item>
          </div>
          <div class="form-grid">
            <el-form-item label="登录成功判定路径（可选）">
              <el-input v-model="form.auth.successPath" placeholder="code" />
            </el-form-item>
            <el-form-item label="成功期望值（可选）">
              <el-input v-model="form.auth.successValue" placeholder="0" />
            </el-form-item>
          </div>
          <div class="form-grid">
            <el-form-item label="响应变量路径">
              <el-input v-model="form.auth.tokenPath" placeholder="data.token" />
            </el-form-item>
            <el-form-item label="全局变量名">
              <el-input v-model="form.auth.tokenVariable" placeholder="AUTH_TOKEN">
                <template #prepend>&#123;&#123;</template>
                <template #append>&#125;&#125;</template>
              </el-input>
            </el-form-item>
          </div>
          <div class="form-grid">
            <el-form-item label="Token 类型路径（可选）">
              <el-input v-model="form.auth.tokenTypePath" placeholder="data.token_type" />
            </el-form-item>
            <el-form-item label="默认请求头前缀">
              <el-input v-model="form.auth.tokenTypeFallback" placeholder="Bearer" />
            </el-form-item>
          </div>
        </el-tab-pane>

        <el-tab-pane :label="`环境变量（${form.variables.length}）`" name="variables">
          <div class="variable-toolbar">
            <p>变量会在脚本运行时注入当前执行上下文。</p>
            <el-button :icon="Plus" @click="addVariable">添加变量</el-button>
          </div>

          <div v-if="form.variables.length" class="variable-list">
            <div class="variable-list__head">
              <span>启用</span><span>变量名</span><span>变量值</span><span>说明</span><span>敏感</span><span />
            </div>
            <div v-for="variable in form.variables" :key="variable.id" class="variable-row">
              <el-switch v-model="variable.enabled" />
              <el-input v-model="variable.key" placeholder="VARIABLE_NAME" />
              <el-input v-model="variable.value" :type="variable.secret ? 'password' : 'text'" placeholder="变量值" show-password />
              <el-input v-model="variable.description" placeholder="用途说明" />
              <el-switch v-model="variable.secret" />
              <el-tooltip content="删除变量" placement="top">
                <el-button text type="danger" :icon="Delete" aria-label="删除变量" @click="removeVariable(variable.id)" />
              </el-tooltip>
            </div>
          </div>
          <el-empty v-else description="暂无自定义环境变量" :image-size="70" />
        </el-tab-pane>
      </el-tabs>
    </el-form>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" @click="submit">保存环境</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 18px;
}

.form-grid--name {
  grid-template-columns: minmax(0, 1fr) 220px 130px;
}

.enable-field {
  display: flex;
  min-height: 42px;
  align-items: center;
  gap: 8px;
  color: #65737a;
  font-size: var(--font-md);
}

.auth-hint {
  margin-bottom: 20px;
  padding: 11px 13px;
  color: #4f6f6a;
  border-left: 3px solid #1bb3a2;
  background: #eef8f6;
  font-size: var(--font-sm);
  line-height: 1.6;
}

.login-url-preview {
  display: block;
  max-width: 100%;
  overflow: hidden;
  margin-top: 8px;
  color: #28786f;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: var(--font-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.variable-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.variable-toolbar p {
  margin: 0;
  color: #8a969d;
  font-size: var(--font-sm);
}

.variable-list {
  overflow-x: auto;
  border: 1px solid #e3e9eb;
  border-radius: 6px;
}

.variable-list__head,
.variable-row {
  display: grid;
  min-width: 880px;
  grid-template-columns: 72px 1.1fr 1.2fr 1fr 72px 44px;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
}

.variable-list__head {
  color: #7c898f;
  border-bottom: 1px solid #e7ecee;
  background: #f7f9fa;
  font-size: var(--font-xs);
}

.variable-row {
  border-bottom: 1px solid #edf1f3;
}

.variable-row:last-child {
  border-bottom: 0;
}

.variable-row > .el-switch,
.variable-list__head span:first-child,
.variable-list__head span:nth-child(5) {
  justify-self: center;
}

:deep(.environment-tabs > .el-tabs__header) {
  margin-bottom: 22px;
}

:deep(.el-select),
:deep(.el-input-number) {
  width: 100%;
}

@media (max-width: 700px) {
  .form-grid,
  .form-grid--name {
    grid-template-columns: 1fr;
  }

  .variable-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>

<style>
.environment-dialog {
  max-width: calc(100vw - 28px);
  max-height: calc(100dvh - 32px);
  display: flex;
  flex-direction: column;
  margin: 16px auto;
  border-radius: 7px;
}

.environment-dialog .el-dialog__body {
  min-height: 0;
  overflow-y: auto;
  padding-top: 8px;
}
</style>
