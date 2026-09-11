<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  CircleCheck,
  Connection,
  Delete,
  EditPen,
  Key,
  Lock,
  Plus,
  Promotion,
  RefreshRight,
  Search,
  SwitchButton,
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

import EnvironmentSessionDialog from '@/components/EnvironmentSessionDialog.vue'
import EnvironmentEditorDialog from '@/components/EnvironmentEditorDialog.vue'
import EnvironmentLoginResultDialog from '@/components/EnvironmentLoginResultDialog.vue'
import type { EnvironmentLoginResult, ResponseVariableBinding } from '@/domain/environment-login'
import {
  cloneEnvironmentDraft,
  type EnvironmentDraft,
  type TestEnvironment,
} from '@/domain/environment'
import type { RuntimeVariable } from '@/domain/runtime-variable'
import { services } from '@/services/container'
import { applyResponseVariable as applyLoginResponseVariable } from '@/services/environments/apply-response-variable'

const environments = ref<TestEnvironment[]>([])
const loading = ref(true)
const searchKeyword = ref('')
const statusFilter = ref<'all' | 'enabled' | 'disabled'>('all')
const currentPage = ref(1)
const pageSize = 6
const editorVisible = ref(false)
const editorSaving = ref(false)
const editingEnvironment = ref<TestEnvironment | null>(null)
const sessionVisible = ref(false)
const sessionEnvironment = ref<TestEnvironment | null>(null)
const sessionRevision = ref(0)
const loginTestingId = ref('')
const loginResultVisible = ref(false)
const loginResultEnvironment = ref<TestEnvironment | null>(null)
const loginResult = ref<EnvironmentLoginResult | null>(null)
const appliedLoginVariable = ref<RuntimeVariable | null>(null)

const currentEnvironment = computed(() => environments.value.find((environment) => environment.active) ?? null)
const filteredEnvironments = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase()
  return environments.value.filter((environment) => {
    const matchesStatus = statusFilter.value === 'all' || (statusFilter.value === 'enabled' ? environment.enabled : !environment.enabled)
    const matchesKeyword = !keyword || [environment.name, environment.code, environment.baseUrl, environment.apiBaseUrl, environment.description]
      .some((value) => value.toLowerCase().includes(keyword))
    return matchesStatus && matchesKeyword
  })
})
const pagedEnvironments = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  return filteredEnvironments.value.slice(start, start + pageSize)
})
const summary = computed(() => ({
  total: environments.value.length,
  enabled: environments.value.filter((environment) => environment.enabled).length,
  variables: environments.value.reduce((total, environment) => total + environment.variables.filter((variable) => variable.enabled).length, 0),
}))

watch([searchKeyword, statusFilter], () => {
  currentPage.value = 1
})

async function loadEnvironments(showSuccess = false): Promise<void> {
  loading.value = true
  try {
    environments.value = await services.environments.list()
    if (showSuccess) ElMessage.success('环境列表已刷新')
  } catch {
    ElMessage.error('环境列表加载失败')
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  editingEnvironment.value = null
  editorVisible.value = true
}

function openEdit(environment: TestEnvironment): void {
  editingEnvironment.value = environment
  editorVisible.value = true
}

async function saveEnvironment(draft: EnvironmentDraft, manageSession = false): Promise<void> {
  if (editorSaving.value) return
  editorSaving.value = true
  try {
    let savedEnvironment: TestEnvironment
    if (editingEnvironment.value) {
      savedEnvironment = await services.environments.update(editingEnvironment.value.id, draft)
      ElMessage.success('环境配置已更新')
    } else {
      savedEnvironment = await services.environments.create(draft)
      ElMessage.success('环境已新增')
    }
    editorVisible.value = false
    await loadEnvironments()
    if (manageSession && savedEnvironment.auth.strategy === 'reuse-session') {
      sessionEnvironment.value = savedEnvironment
      sessionVisible.value = true
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '环境保存失败')
  } finally {
    editorSaving.value = false
  }
}

async function activateEnvironment(environment: TestEnvironment): Promise<void> {
  try {
    await services.environments.setActive(environment.id)
    await loadEnvironments()
    ElMessage.success(`已切换到${environment.name}`)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '环境切换失败')
  }
}

async function removeEnvironment(environment: TestEnvironment): Promise<void> {
  try {
    await services.environments.remove(environment.id)
    try {
      services.environmentSessions.clear(environment.id)
    } catch {
      ElMessage.warning('环境已删除，但本地登录态清理失败，请检查浏览器存储权限')
    }
    await loadEnvironments()
    ElMessage.success('环境已删除')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '环境删除失败')
  }
}

async function testLogin(environment: TestEnvironment): Promise<void> {
  if (environment.auth.strategy === 'reuse-session') {
    sessionEnvironment.value = environment
    sessionVisible.value = true
    return
  }
  if (loginTestingId.value) return
  loginTestingId.value = environment.id
  loginResultEnvironment.value = environment
  appliedLoginVariable.value = null
  try {
    const result = await services.environmentLogin.login(environment)
    loginResult.value = result
    if (result.businessSuccess) {
      appliedLoginVariable.value = applyRuntimeVariable({
        variableName: environment.auth.tokenVariable,
        responsePath: environment.auth.tokenPath,
      }, environment, result)
    }
    loginResultVisible.value = true
    if (result.businessSuccess && appliedLoginVariable.value) {
      ElMessage.success(`登录成功，已更新全局变量 ${appliedLoginVariable.value.key}`)
    } else if (result.businessSuccess) {
      ElMessage.warning('登录成功，但响应变量提取失败，原变量未覆盖')
    } else if (result.ok) {
      ElMessage.warning('HTTP 请求成功，但响应未满足业务成功规则')
    } else if (result.status) {
      ElMessage.warning(`登录接口返回 HTTP ${result.status}`)
    } else {
      ElMessage.error(result.error ?? '登录请求未完成')
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '登录测试失败')
  } finally {
    loginTestingId.value = ''
  }
}

function applyRuntimeVariable(
  binding: ResponseVariableBinding,
  environment: TestEnvironment,
  result: EnvironmentLoginResult,
): RuntimeVariable | null {
  return applyLoginResponseVariable(binding, environment, result, services.runtimeVariables)
}

async function applyResponseVariable(binding: ResponseVariableBinding): Promise<void> {
  const environment = loginResultEnvironment.value
  const result = loginResult.value
  if (!environment || !result) return

  if (!result.businessSuccess) {
    ElMessage.warning('当前响应未能提取到可用变量，原变量未覆盖')
    return
  }

  const draft = cloneEnvironmentDraft(environment)
  draft.auth.tokenVariable = binding.variableName.trim()
  draft.auth.tokenPath = binding.responsePath.trim()

  try {
    const updated = await services.environments.update(environment.id, draft)
    const variable = applyRuntimeVariable(binding, environment, result)
    if (!variable) {
      ElMessage.warning('变量规则已保存，但当前响应未能提取到可用值，原变量未覆盖')
      return
    }
    loginResultEnvironment.value = updated
    appliedLoginVariable.value = variable
    await loadEnvironments()
    ElMessage.success(`全局变量 ${variable.key} 已保存并应用`)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '响应变量规则保存失败')
  }
}

function enabledVariableCount(environment: TestEnvironment): number {
  return environment.variables.filter((variable) => variable.enabled).length
}

function sessionStatus(environment: TestEnvironment): string {
  void sessionRevision.value
  const session = services.environmentSessions.get(environment)
  if (!session) return '未导入匹配的登录态'
  if (session.expiresAt !== null && session.expiresAt <= Date.now()) return '已过期，请更新'
  return session.accountLabel ? `已保存 · ${session.accountLabel}` : '已保存登录态'
}

function loginModeLabel(environment: TestEnvironment): string {
  if (environment.auth.strategy === 'reuse-session') return '复用已有登录态'
  return environment.auth.mode === 'mobile-code' ? '手机号验证码' : '账号密码'
}

function loginAccountLabel(environment: TestEnvironment): string {
  if (environment.auth.strategy === 'reuse-session') return sessionStatus(environment)
  return environment.auth.mode === 'mobile-code' ? environment.auth.mobile : environment.auth.username
}

onMounted(() => loadEnvironments())
</script>

<template>
  <div class="environment-page">
    <header class="page-heading">
      <div>
        <p>EXECUTION ENVIRONMENTS</p>
        <h1>环境管理</h1>
        <span>配置登录凭据、Token 提取规则和运行变量</span>
      </div>
      <el-button type="primary" :icon="Plus" aria-haspopup="dialog" :aria-expanded="editorVisible" @click="openCreate">新增环境</el-button>
    </header>

    <section v-if="currentEnvironment" class="current-environment">
      <span class="current-environment__icon"><el-icon :size="23"><Connection /></el-icon></span>
      <div class="current-environment__main">
        <p><span>当前运行环境</span><strong>{{ currentEnvironment.name }}</strong><code>{{ currentEnvironment.code }}</code></p>
        <span>{{ currentEnvironment.baseUrl }} · API {{ currentEnvironment.apiBaseUrl }}</span>
      </div>
      <div class="current-environment__auth">
        <span><el-icon><Lock /></el-icon>{{ loginAccountLabel(currentEnvironment) }}</span>
        <span><el-icon><Key /></el-icon>{{ currentEnvironment.auth.tokenVariable || '未配置 Token' }}</span>
      </div>
    </section>

    <section class="summary-strip" aria-label="环境统计">
      <div><span>环境总数</span><strong>{{ summary.total }}</strong></div>
      <div><span>启用环境</span><strong>{{ summary.enabled }}</strong></div>
      <div><span>有效变量</span><strong>{{ summary.variables }}</strong></div>
    </section>

    <section class="environment-panel">
      <div class="toolbar">
        <div class="toolbar__filters">
          <el-input v-model="searchKeyword" :prefix-icon="Search" clearable placeholder="搜索名称、标识或地址" class="search-input" />
          <el-select v-model="statusFilter" class="status-select">
            <el-option label="全部状态" value="all" />
            <el-option label="已启用" value="enabled" />
            <el-option label="已停用" value="disabled" />
          </el-select>
        </div>
        <el-tooltip content="刷新列表" placement="top">
          <el-button circle :icon="RefreshRight" :loading="loading" aria-label="刷新列表" @click="loadEnvironments(true)" />
        </el-tooltip>
      </div>

      <el-table v-loading="loading" :data="pagedEnvironments" row-key="id" class="environment-table" empty-text="暂无数据">
        <el-table-column label="环境信息" min-width="300">
          <template #default="scope">
            <div class="environment-info">
              <span class="environment-info__mark" :class="{ 'environment-info__mark--active': scope.row.active }">{{ scope.row.code.slice(0, 2) }}</span>
              <div>
                <p><strong>{{ scope.row.name }}</strong><el-tag v-if="scope.row.active" type="success" size="small" effect="light">当前</el-tag></p>
                <span>{{ scope.row.description }}</span>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="服务与登录" min-width="350">
          <template #default="scope">
            <div class="endpoint-info">
              <code>{{ scope.row.apiBaseUrl }}</code>
              <span v-if="scope.row.auth.strategy === 'reuse-session'">运行时跳过登录接口</span>
              <span v-else>{{ scope.row.auth.method }} {{ scope.row.auth.loginPath }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="登录与 Token" min-width="230">
          <template #default="scope">
            <div class="token-info">
              <strong>{{ loginModeLabel(scope.row) }} · {{ loginAccountLabel(scope.row) }}</strong>
              <span>{{ scope.row.auth.strategy === 'reuse-session' ? '有效性以业务服务校验为准' : scope.row.auth.tokenPath || '暂未配置 Token 提取路径' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="变量" width="100" align="center">
          <template #default="scope">
            <span class="variable-count">{{ enabledVariableCount(scope.row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="scope">
            <el-tag :type="scope.row.enabled ? 'success' : 'info'" size="small" effect="light">{{ scope.row.enabled ? '启用' : '停用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="更新时间" prop="updatedAt" width="180" />
        <el-table-column label="操作" width="202" fixed="right">
          <template #default="scope">
            <div class="row-actions">
              <el-tooltip :content="scope.row.active ? '当前环境' : '切换到此环境'" placement="top">
                <el-button
                  text
                  :type="scope.row.active ? 'success' : 'primary'"
                  :icon="scope.row.active ? CircleCheck : SwitchButton"
                  aria-label="切换环境"
                  :disabled="scope.row.active || !scope.row.enabled"
                  @click="activateEnvironment(scope.row)"
                />
              </el-tooltip>
              <el-tooltip :content="scope.row.auth.strategy === 'reuse-session' ? '管理登录态' : '测试登录'" placement="top">
                <el-button
                  text
                  type="primary"
                  :icon="scope.row.auth.strategy === 'reuse-session' ? Key : Promotion"
                  :loading="loginTestingId === scope.row.id"
                  :aria-label="scope.row.auth.strategy === 'reuse-session' ? '管理登录态' : '测试环境登录'"
                  :disabled="!scope.row.enabled || Boolean(loginTestingId)"
                  @click="testLogin(scope.row)"
                />
              </el-tooltip>
              <el-tooltip content="编辑" placement="top">
                <el-button text :icon="EditPen" aria-label="编辑环境" @click="openEdit(scope.row)" />
              </el-tooltip>
              <el-popconfirm
                title="确定删除这个环境吗？"
                confirm-button-text="删除"
                cancel-button-text="取消"
                :disabled="scope.row.active"
                @confirm="removeEnvironment(scope.row)"
              >
                <template #reference>
                  <el-button text type="danger" :icon="Delete" aria-label="删除环境" :disabled="scope.row.active" />
                </template>
              </el-popconfirm>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <footer class="table-footer">
        <span>当前使用：{{ currentEnvironment?.name ?? '未选择' }}</span>
        <el-pagination
          v-model:current-page="currentPage"
          background
          layout="total, prev, pager, next"
          :page-size="pageSize"
          :total="filteredEnvironments.length"
        />
      </footer>
    </section>

    <EnvironmentEditorDialog
      v-model="editorVisible"
      :environment="editingEnvironment"
      :saving="editorSaving"
      @save="saveEnvironment"
    />
    <EnvironmentSessionDialog
      v-model="sessionVisible"
      :environment="sessionEnvironment"
      @changed="sessionRevision++"
    />
    <EnvironmentLoginResultDialog
      v-model="loginResultVisible"
      :environment="loginResultEnvironment"
      :result="loginResult"
      :applied-variable="appliedLoginVariable"
      @apply="applyResponseVariable"
    />
  </div>
</template>

<style scoped>
.environment-page {
  min-width: 0;
}

.page-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 18px;
}

.page-heading p,
.page-heading h1,
.page-heading span {
  margin: 0;
}

.page-heading p {
  margin-bottom: 4px;
  color: var(--color-primary);
  font-size: var(--font-xs);
  font-weight: 700;
}

.page-heading h1 {
  color: var(--color-text-primary);
  font-size: var(--font-title);
  font-weight: 700;
}

.page-heading span {
  display: block;
  margin-top: 8px;
  color: var(--color-text-muted);
  font-size: var(--font-md);
}

.current-environment {
  display: flex;
  min-height: 96px;
  align-items: center;
  gap: 15px;
  margin-bottom: 16px;
  padding: 16px 20px;
  color: var(--color-text-primary);
  border: 1px solid #d9e4f5;
  border-radius: var(--radius-card);
  background: #f7faff;
  box-shadow: 0 8px 24px rgb(31 42 68 / 3%);
}

.current-environment__icon {
  display: grid;
  width: 48px;
  height: 48px;
  flex: 0 0 48px;
  place-items: center;
  color: var(--color-primary);
  border-radius: 6px;
  background: var(--color-primary-soft);
}

.current-environment__main {
  min-width: 0;
  flex: 1;
}

.current-environment__main p {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 0;
}

.current-environment__main p span {
  color: var(--color-text-muted);
  font-size: var(--font-xs);
}

.current-environment__main strong {
  color: var(--color-text-primary);
  font-size: var(--font-lg);
}

.current-environment__main code {
  padding: 3px 6px;
  color: var(--color-primary);
  border: 1px solid #d4e1fa;
  border-radius: 3px;
  font-size: var(--font-caption);
}

.current-environment__main > span {
  display: block;
  overflow: hidden;
  margin-top: 7px;
  color: var(--color-text-muted);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: var(--font-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.current-environment__auth {
  display: flex;
  gap: 10px;
}

.current-environment__auth span {
  display: flex;
  min-width: 172px;
  align-items: center;
  gap: 7px;
  padding: 9px 10px;
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
  border-radius: 5px;
  background: var(--color-surface);
  font-size: var(--font-xs);
}

.summary-strip {
  display: grid;
  margin-bottom: 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  grid-template-columns: repeat(3, minmax(0, 1fr));
  background: var(--color-surface);
  box-shadow: var(--shadow-card);
}

.summary-strip div {
  min-height: 78px;
  padding: 16px 22px;
  border-right: 1px solid var(--color-border-light);
}

.summary-strip div:last-child {
  border-right: 0;
}

.summary-strip span,
.summary-strip strong {
  display: block;
}

.summary-strip span {
  color: var(--color-text-muted);
  font-size: var(--font-xs);
}

.summary-strip strong {
  margin-top: 4px;
  color: var(--color-text-primary);
  font-size: var(--font-subtitle);
}

.environment-panel {
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  box-shadow: var(--shadow-card);
}

.toolbar,
.toolbar__filters,
.row-actions,
.table-footer {
  display: flex;
  align-items: center;
}

.toolbar {
  min-height: 64px;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border-light);
}

.toolbar__filters {
  gap: 10px;
}

.search-input {
  width: min(380px, 38vw);
}

.status-select {
  width: 150px;
}

.environment-table {
  width: 100%;
}

.environment-info {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: 11px;
}

.environment-info__mark {
  display: grid;
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  place-items: center;
  color: var(--color-text-secondary);
  border-radius: 5px;
  background: var(--color-bg-subtle);
  font-size: var(--font-xs);
  font-weight: 700;
}

.environment-info__mark--active {
  color: var(--color-primary);
  background: var(--color-primary-soft);
}

.environment-info > div {
  min-width: 0;
}

.environment-info p {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
}

.environment-info strong {
  color: var(--color-text-primary);
  font-size: var(--font-md);
}

.environment-info > div > span {
  display: block;
  overflow: hidden;
  margin-top: 6px;
  color: var(--color-text-muted);
  font-size: var(--font-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.endpoint-info code,
.endpoint-info span,
.token-info strong,
.token-info span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.endpoint-info code {
  color: #315fbd;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: var(--font-xs);
}

.endpoint-info span,
.token-info span {
  margin-top: 6px;
  color: var(--color-text-muted);
  font-size: var(--font-xs);
}

.token-info strong {
  color: var(--color-text-secondary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: var(--font-xs);
}

.variable-count {
  display: inline-grid;
  width: 36px;
  height: 30px;
  place-items: center;
  color: var(--color-text-secondary);
  border-radius: 4px;
  background: var(--color-bg-subtle);
  font-size: var(--font-xs);
  font-weight: 600;
}

.row-actions {
  gap: 1px;
}

.row-actions :deep(.el-button) {
  width: 38px;
  height: 38px;
  margin: 0;
}

.table-footer {
  min-height: 60px;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 16px;
  border-top: 1px solid var(--color-border-light);
}

.table-footer > span {
  color: var(--color-text-muted);
  font-size: var(--font-sm);
}

:deep(.el-table) {
  --el-table-border-color: var(--color-border-light);
  --el-table-header-bg-color: #f8faff;
  --el-table-row-hover-bg-color: #f7f9fd;
  color: var(--color-text-secondary);
  font-size: var(--font-sm);
}

:deep(.el-table th.el-table__cell) {
  height: 46px;
  color: #6b778c;
  font-size: var(--font-xs);
  font-weight: 650;
}

:deep(.el-table td.el-table__cell) {
  height: 82px;
}

@media (max-width: 1350px) {
  .current-environment__auth {
    display: none;
  }

  .toolbar__filters {
    min-width: 0;
    flex: 1 1 520px;
    flex-wrap: wrap;
  }

  .search-input {
    width: auto;
    min-width: 260px;
    flex: 1 1 320px;
  }

  .toolbar > .el-button {
    margin-left: auto;
  }
}

@media (max-width: 660px) {
  .page-heading,
  .toolbar,
  .table-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .page-heading .el-button,
  .search-input {
    width: 100%;
  }

  .summary-strip {
    grid-template-columns: 1fr;
  }

  .summary-strip div {
    border-right: 0;
    border-bottom: 1px solid var(--color-border-light);
  }

  .summary-strip div:last-child {
    border-bottom: 0;
  }

  .toolbar__filters {
    width: 100%;
    flex-basis: auto;
  }

  .search-input {
    min-width: 0;
  }

  .toolbar > .el-button {
    margin-left: 0;
  }

  .status-select {
    width: 112px;
    flex: 0 0 112px;
  }
}
</style>
