<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  Delete,
  Document,
  EditPen,
  Files,
  FolderOpened,
  Plus,
  RefreshRight,
  Search,
  Setting,
  VideoPlay,
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

import ScriptEditorDialog from '@/components/ScriptEditorDialog.vue'
import ScriptRunResultDialog from '@/components/ScriptRunResultDialog.vue'
import type { TestEnvironment } from '@/domain/environment'
import type { RunFailureStage, RunRecord } from '@/domain/run-record'
import type { AutomationScript, ScriptDraft, ScriptStatus } from '@/domain/script'
import { services } from '@/services/container'
import { applyResponseVariable } from '@/services/environments/apply-response-variable'
import { buildScriptRunContext } from '@/services/scripts/script-run-context'

const scripts = ref<AutomationScript[]>([])
const environments = ref<TestEnvironment[]>([])
const selectedEnvironmentId = ref('')
const selectedScripts = ref<AutomationScript[]>([])
const loading = ref(true)
const searchKeyword = ref('')
const statusFilter = ref<'all' | ScriptStatus>('all')
const currentPage = ref(1)
const pageSize = 6
const editorVisible = ref(false)
const editingScript = ref<AutomationScript | null>(null)
const resultVisible = ref(false)
const resultScript = ref<AutomationScript | null>(null)
const runningScriptIds = ref<Set<string>>(new Set())
const router = useRouter()

const statusOptions: Array<{ label: string; value: 'all' | ScriptStatus }> = [
  { label: '全部状态', value: 'all' },
  { label: '可运行', value: 'ready' },
  { label: '执行中', value: 'running' },
  { label: '最近通过', value: 'passed' },
  { label: '最近失败', value: 'failed' },
  { label: '已停用', value: 'disabled' },
]

const statusMap: Record<ScriptStatus, { label: string; type: 'success' | 'warning' | 'danger' | 'info' }> = {
  ready: { label: '可运行', type: 'info' },
  running: { label: '执行中', type: 'warning' },
  passed: { label: '已通过', type: 'success' },
  failed: { label: '失败', type: 'danger' },
  disabled: { label: '已停用', type: 'info' },
}

const filteredScripts = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase()
  return scripts.value.filter((script) => {
    const matchesStatus = statusFilter.value === 'all' || script.status === statusFilter.value
    const matchesKeyword = !keyword || [script.name, script.description, script.directory, script.entryFile, ...script.tags]
      .some((value) => value.toLowerCase().includes(keyword))
    return matchesStatus && matchesKeyword
  })
})

const pagedScripts = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  return filteredScripts.value.slice(start, start + pageSize)
})

const summary = computed(() => ({
  total: scripts.value.length,
  enabled: scripts.value.filter((script) => script.status !== 'disabled').length,
  failed: scripts.value.filter((script) => script.status === 'failed').length,
}))
const availableEnvironments = computed(() => environments.value.filter((environment) => environment.enabled))
const selectedEnvironment = computed(() => environments.value.find((environment) => environment.id === selectedEnvironmentId.value) ?? null)
const selectedRunLocked = computed(() => selectedScripts.value.some((script) => runningScriptIds.value.has(script.id)))

watch([searchKeyword, statusFilter], () => {
  currentPage.value = 1
})

async function loadScripts(showSuccess = false): Promise<void> {
  loading.value = true
  try {
    scripts.value = await services.scripts.list()
    if (showSuccess) ElMessage.success('脚本列表已刷新')
  } catch {
    ElMessage.error('脚本列表加载失败')
  } finally {
    loading.value = false
  }
}

async function loadEnvironments(): Promise<void> {
  environments.value = await services.environments.list()
  const active = environments.value.find((environment) => environment.active && environment.enabled)
  selectedEnvironmentId.value = active?.id ?? ''
}

async function selectEnvironment(environmentId: string): Promise<void> {
  try {
    await services.environments.setActive(environmentId)
    await loadEnvironments()
    ElMessage.success(`已切换到${selectedEnvironment.value?.name ?? '所选环境'}`)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '环境切换失败')
    await loadEnvironments()
  }
}

function openCreate(): void {
  editingScript.value = null
  editorVisible.value = true
}

function openEdit(script: AutomationScript): void {
  editingScript.value = script
  editorVisible.value = true
}

async function saveScript(draft: ScriptDraft): Promise<void> {
  try {
    if (editingScript.value) {
      await services.scripts.update(editingScript.value.id, draft)
      ElMessage.success('脚本信息已更新')
    } else {
      await services.scripts.create(draft)
      ElMessage.success('脚本已新增')
    }
    editorVisible.value = false
    await loadScripts()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  }
}

async function removeScript(script: AutomationScript): Promise<void> {
  try {
    await services.scripts.remove(script.id)
    ElMessage.success('脚本已删除')
    await loadScripts()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '删除失败')
  }
}

async function runScripts(targets: AutomationScript[]): Promise<void> {
  if (!selectedEnvironmentId.value) {
    ElMessage.warning('运行脚本前必须选择环境')
    return
  }

  const uniqueTargets = [...new Map(targets.map((script) => [script.id, script])).values()]
  const lockedTargets = uniqueTargets.filter((script) => runningScriptIds.value.has(script.id))
  if (lockedTargets.length > 0) {
    ElMessage.warning(`${lockedTargets.map((script) => script.name).join('、')}正在运行，请等待当前批次结束`)
    return
  }

  const runnable = uniqueTargets.filter((script) => script.status !== 'disabled' && script.status !== 'running')
  if (runnable.length === 0) {
    ElMessage.warning('请选择可运行的脚本')
    return
  }

  const environment = selectedEnvironment.value
  if (!environment) {
    ElMessage.error('运行环境不存在或已被删除')
    return
  }

  const lockedIds = runnable.map((script) => script.id)
  runningScriptIds.value = new Set([...runningScriptIds.value, ...lockedIds])

  let runRecord: RunRecord | null = null
  let failureStage: RunFailureStage = 'login'
  let recordFinalized = false
  let runSecretValues = [
    environment.auth.password,
    environment.auth.verifyCode,
    environment.auth.mobile,
    ...environment.variables
      .filter((variable) => variable.secret)
      .map((variable) => variable.value),
  ].filter(Boolean)
  try {
    runRecord = await services.runRecords.start({
      environment: {
        id: environment.id,
        name: environment.name,
        code: environment.code,
        apiBaseUrl: environment.apiBaseUrl,
      },
      scripts: runnable.map((script) => ({
        id: script.id,
        name: script.name,
        directory: script.directory,
        entryFile: script.entryFile,
        tags: [...script.tags],
      })),
    })

    ElMessage.info(`正在登录${environment.name}并刷新 Token`)
    const loginResult = await services.environmentLogin.login(environment)
    if (!loginResult.businessSuccess) {
      const status = loginResult.status ? `HTTP ${loginResult.status}` : '未收到 HTTP 响应'
      throw new Error(loginResult.error || `环境登录失败（${status}），请检查登录配置和业务成功规则`)
    }
    const runtimeToken = applyResponseVariable({
      variableName: environment.auth.tokenVariable,
      responsePath: environment.auth.tokenPath,
    }, environment, loginResult, services.runtimeVariables)
    if (!runtimeToken) throw new Error(`登录成功，但无法从 ${environment.auth.tokenPath} 提取 Token`)
    runSecretValues = [
      runtimeToken.value,
      ...runSecretValues,
    ].filter(Boolean)
    failureStage = 'runner'
    await services.runRecords.appendLog(runRecord.id, {
      level: 'success',
      scope: 'login',
      message: `${environment.name}登录成功，运行时 Token 已刷新`,
      secretValues: runSecretValues,
    })

    const runTask = services.scripts.run(
      runnable.map((script) => script.id),
      buildScriptRunContext(environment, services.runtimeVariables),
    )
    scripts.value = await services.scripts.list()
    const completed = await runTask
    runRecord = await services.runRecords.complete(runRecord.id, {
      scripts: completed.map((script) => ({
        scriptId: script.id,
        ok: script.lastRunResult?.ok ?? script.status === 'passed',
        durationMs: script.lastRunResult?.durationMs ?? 0,
        logs: script.lastRunResult?.logs ?? [],
        ...(script.lastRunResult?.output ? { output: script.lastRunResult.output } : {}),
        ...(script.lastRunResult?.error ? { error: script.lastRunResult.error } : {}),
      })),
      secretValues: runSecretValues,
    })
    recordFinalized = true
    scripts.value = await services.scripts.list()
    const firstResult = completed[0]
    if (firstResult) openResult(firstResult)
    const failedCount = completed.filter((script) => script.status === 'failed').length
    if (failedCount > 0) {
      ElMessage.error(`${failedCount} 个脚本执行失败，请查看运行日志`)
    } else {
      ElMessage.success(`${runnable.length} 个脚本已在${environment.name}运行完成`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '运行失败'
    if (runRecord && !recordFinalized) {
      const currentRecord = await services.runRecords.get(runRecord.id).catch(() => null)
      if (currentRecord?.status === 'running') {
        await services.runRecords.fail(runRecord.id, {
          stage: failureStage,
          error: message,
          secretValues: runSecretValues,
        }).catch(() => undefined)
      }
    }
    ElMessage.error(message)
  } finally {
    const nextRunningIds = new Set(runningScriptIds.value)
    for (const id of lockedIds) nextRunningIds.delete(id)
    runningScriptIds.value = nextRunningIds
  }
}

function openResult(script: AutomationScript): void {
  resultScript.value = script
  resultVisible.value = true
}

function handleSelectionChange(rows: AutomationScript[]): void {
  selectedScripts.value = rows
}

onMounted(async () => {
  await Promise.all([loadScripts(), loadEnvironments()])
})
</script>

<template>
  <div class="script-page">
    <header class="page-heading">
      <div>
        <p>PLAYWRIGHT SCRIPTS</p>
        <h1>脚本管理</h1>
        <span>管理本地项目目录、入口文件和运行状态</span>
      </div>
      <el-button type="primary" :icon="Plus" @click="openCreate">新增脚本</el-button>
    </header>

    <section class="summary-strip" aria-label="脚本统计">
      <div>
        <span class="summary-strip__icon summary-strip__icon--cyan"><el-icon :size="20"><Files /></el-icon></span>
        <p><span>脚本总数</span><strong>{{ summary.total }}</strong></p>
      </div>
      <div>
        <span class="summary-strip__icon summary-strip__icon--green"><el-icon :size="20"><VideoPlay /></el-icon></span>
        <p><span>当前启用</span><strong>{{ summary.enabled }}</strong></p>
      </div>
      <div>
        <span class="summary-strip__icon summary-strip__icon--red"><el-icon :size="20"><RefreshRight /></el-icon></span>
        <p><span>待处理失败</span><strong>{{ summary.failed }}</strong></p>
      </div>
    </section>

    <section class="execution-environment" :class="{ 'execution-environment--missing': !selectedEnvironment }">
      <span class="execution-environment__icon"><el-icon :size="20"><Setting /></el-icon></span>
      <div class="execution-environment__label">
        <strong>运行环境</strong>
        <span>执行前登录并注入 Token</span>
      </div>
      <el-select
        v-model="selectedEnvironmentId"
        class="environment-select"
        placeholder="请选择运行环境"
        @change="selectEnvironment"
      >
        <el-option
          v-for="environment in availableEnvironments"
          :key="environment.id"
          :label="`${environment.name} · ${environment.code}`"
          :value="environment.id"
        />
      </el-select>
      <div v-if="selectedEnvironment" class="execution-environment__endpoint">
        <code>{{ selectedEnvironment.apiBaseUrl }}</code>
        <span>Token → {{ selectedEnvironment.auth.tokenVariable || '未配置' }}</span>
      </div>
      <span v-else class="execution-environment__warning">未选择环境，暂不能运行脚本</span>
      <el-button text :icon="Setting" @click="router.push('/environments')">管理环境</el-button>
    </section>

    <section class="script-panel">
      <div class="toolbar">
        <div class="toolbar__filters">
          <el-input v-model="searchKeyword" :prefix-icon="Search" clearable placeholder="搜索名称、目录或标签" class="search-input" />
          <el-select v-model="statusFilter" class="status-select">
            <el-option v-for="option in statusOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
        </div>
        <div class="toolbar__actions">
          <el-button
            :icon="VideoPlay"
            :disabled="selectedScripts.length === 0 || !selectedEnvironmentId || selectedRunLocked"
            @click="runScripts(selectedScripts)"
          >
            运行所选<span v-if="selectedScripts.length">（{{ selectedScripts.length }}）</span>
          </el-button>
          <el-tooltip content="刷新列表" placement="top">
            <el-button circle :icon="RefreshRight" :loading="loading" aria-label="刷新列表" @click="loadScripts(true)" />
          </el-tooltip>
        </div>
      </div>

      <el-table
        v-loading="loading"
        :data="pagedScripts"
        row-key="id"
        class="script-table"
        empty-text="暂无数据"
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="56" />
        <el-table-column label="脚本信息" min-width="350">
          <template #default="scope">
            <div class="script-info">
              <span class="script-info__icon"><el-icon :size="18"><Files /></el-icon></span>
              <div>
                <strong>{{ scope.row.name }}</strong>
                <p>{{ scope.row.description }}</p>
                <div class="script-tags">
                  <span v-for="tag in scope.row.tags" :key="tag">{{ tag }}</span>
                </div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="目录与入口" min-width="390">
          <template #default="scope">
            <div class="path-info">
              <p><el-icon><FolderOpened /></el-icon><code>{{ scope.row.directory }}</code></p>
              <span>{{ scope.row.entryFile }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="最近运行" min-width="170">
          <template #default="scope">
            <div class="last-run">
              <strong>{{ scope.row.lastRunAt ?? '暂无数据' }}</strong>
              <span>{{ scope.row.lastDuration ? `耗时 ${scope.row.lastDuration}` : '暂无数据' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="132">
          <template #default="scope">
            <el-tag :type="statusMap[scope.row.status as ScriptStatus].type" size="small" effect="light">
              {{ statusMap[scope.row.status as ScriptStatus].label }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="更新时间" prop="updatedAt" width="180" />
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="scope">
            <div class="row-actions">
              <el-tooltip content="运行" placement="top">
                <el-button
                  text
                  :icon="VideoPlay"
                  aria-label="运行脚本"
                  :disabled="!selectedEnvironmentId || scope.row.status === 'disabled' || scope.row.status === 'running' || runningScriptIds.has(scope.row.id)"
                  @click="runScripts([scope.row])"
                />
              </el-tooltip>
              <el-tooltip content="运行日志" placement="top">
                <el-button
                  text
                  :icon="Document"
                  aria-label="查看运行日志"
                  :disabled="!scope.row.lastRunResult"
                  @click="openResult(scope.row)"
                />
              </el-tooltip>
              <el-tooltip content="编辑" placement="top">
                <el-button text :icon="EditPen" aria-label="编辑脚本" @click="openEdit(scope.row)" />
              </el-tooltip>
              <el-popconfirm title="确定删除这个脚本吗？" confirm-button-text="删除" cancel-button-text="取消" @confirm="removeScript(scope.row)">
                <template #reference>
                  <el-button text type="danger" :icon="Delete" aria-label="删除脚本" />
                </template>
              </el-popconfirm>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <footer class="table-footer">
        <span>已选择 {{ selectedScripts.length }} 项</span>
        <el-pagination
          v-model:current-page="currentPage"
          background
          layout="total, prev, pager, next"
          :page-size="pageSize"
          :total="filteredScripts.length"
        />
      </footer>
    </section>

    <ScriptEditorDialog v-model="editorVisible" :script="editingScript" @save="saveScript" />
    <ScriptRunResultDialog v-model="resultVisible" :script="resultScript" />
  </div>
</template>

<style scoped>
.script-page {
  min-width: 0;
}

.page-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 24px;
}

.page-heading p,
.page-heading h1,
.page-heading span {
  margin: 0;
}

.page-heading p {
  margin-bottom: 5px;
  color: #159c8d;
  font-size: var(--font-sm);
  font-weight: 700;
}

.page-heading h1 {
  color: #17232a;
  font-size: var(--font-title);
  font-weight: 700;
}

.page-heading span {
  display: block;
  margin-top: 8px;
  color: #8a969d;
  font-size: var(--font-md);
}

.summary-strip {
  display: grid;
  margin-bottom: 16px;
  border: 1px solid #e1e7ea;
  border-radius: 7px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  background: #fff;
  box-shadow: 0 5px 18px rgb(24 45 55 / 4%);
}

.summary-strip > div {
  display: flex;
  min-height: 104px;
  align-items: center;
  gap: 13px;
  padding: 16px 20px;
  border-right: 1px solid #edf1f3;
}

.summary-strip > div:last-child {
  border-right: 0;
}

.summary-strip__icon {
  display: grid;
  width: 46px;
  height: 46px;
  flex: 0 0 46px;
  place-items: center;
  border-radius: 5px;
}

.summary-strip__icon--cyan {
  color: #087d71;
  background: #d9f7f1;
}

.summary-strip__icon--green {
  color: #16834a;
  background: #def6e8;
}

.summary-strip__icon--red {
  color: #bd3f45;
  background: #fde7e8;
}

.summary-strip p,
.summary-strip span,
.summary-strip strong {
  margin: 0;
}

.summary-strip p > span,
.summary-strip p > strong {
  display: block;
}

.execution-environment {
  display: flex;
  min-height: 84px;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding: 12px 16px;
  border: 1px solid #cce8e3;
  border-radius: 7px;
  background: #f7fbfa;
}

.execution-environment--missing {
  border-color: #f0d9b5;
  background: #fffaf2;
}

.execution-environment__icon {
  display: grid;
  width: 46px;
  height: 46px;
  flex: 0 0 46px;
  place-items: center;
  color: #087d71;
  border-radius: 5px;
  background: #d9f7f1;
}

.execution-environment__label {
  min-width: 166px;
}

.execution-environment__label strong,
.execution-environment__label span,
.execution-environment__endpoint code,
.execution-environment__endpoint span {
  display: block;
}

.execution-environment__label strong {
  color: #344149;
  font-size: var(--font-md);
}

.execution-environment__label span,
.execution-environment__endpoint span {
  margin-top: 4px;
  color: #8a969c;
  font-size: var(--font-caption);
}

.environment-select {
  width: 280px;
  flex: 0 0 280px;
}

.execution-environment__endpoint {
  min-width: 0;
  flex: 1;
}

.execution-environment__endpoint code {
  overflow: hidden;
  color: #277c72;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: var(--font-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.execution-environment__warning {
  flex: 1;
  color: #ad6a12;
  font-size: var(--font-sm);
}

.summary-strip p > span {
  color: #8b979e;
  font-size: var(--font-sm);
}

.summary-strip p > strong {
  margin-top: 4px;
  color: #26343b;
  font-size: var(--font-subtitle);
}

.script-panel {
  overflow: hidden;
  border: 1px solid #e1e7ea;
  border-radius: 7px;
  background: #fff;
  box-shadow: 0 5px 18px rgb(24 45 55 / 4%);
}

.toolbar {
  display: flex;
  min-height: 80px;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  border-bottom: 1px solid #edf1f3;
}

.toolbar__filters,
.toolbar__actions,
.row-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.search-input {
  width: min(380px, 38vw);
}

.status-select {
  width: 162px;
}

.script-table {
  width: 100%;
}

.script-info {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: 11px;
  padding: 4px 0;
}

.script-info__icon {
  display: grid;
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  place-items: center;
  color: #108f82;
  border-radius: 5px;
  background: #e3f7f3;
}

.script-info > div {
  min-width: 0;
}

.script-info strong {
  color: #2d3a41;
  font-size: var(--font-md);
  font-weight: 650;
}

.script-info p {
  display: -webkit-box;
  overflow: hidden;
  margin: 5px 0 7px;
  color: #8c989f;
  font-size: var(--font-sm);
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
}

.script-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.script-tags span {
  padding: 2px 6px;
  color: #66757d;
  border: 1px solid #e2e8ea;
  border-radius: 3px;
  background: #f7f9fa;
  font-size: var(--font-caption);
}

.path-info p {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: #64727a;
}

.path-info code {
  overflow: hidden;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: var(--font-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.path-info > span {
  display: block;
  overflow: hidden;
  margin-top: 7px;
  color: #1c8e82;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: var(--font-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.last-run strong,
.last-run span {
  display: block;
}

.last-run strong {
  color: #5d6b73;
  font-size: var(--font-sm);
  font-weight: 600;
}

.last-run span {
  margin-top: 5px;
  color: #9ba5aa;
  font-size: var(--font-xs);
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
  display: flex;
  min-height: 76px;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 10px 16px;
  border-top: 1px solid #edf1f3;
}

.table-footer > span {
  color: #909ba1;
  font-size: var(--font-sm);
}

:deep(.el-table) {
  --el-table-border-color: #edf1f3;
  --el-table-header-bg-color: #fafbfb;
  --el-table-row-hover-bg-color: #f7faf9;
  color: #69777f;
  font-size: var(--font-sm);
}

:deep(.el-table th.el-table__cell) {
  height: 58px;
  color: #7c898f;
  font-size: var(--font-xs);
  font-weight: 650;
}

:deep(.el-table td.el-table__cell) {
  height: 100px;
}

@media (max-width: 1350px) {
  .execution-environment__endpoint,
  .execution-environment__warning {
    flex: 1 1 500px;
    margin-left: 58px;
  }

  .execution-environment > .el-button {
    margin-left: auto;
  }

  .toolbar__filters,
  .toolbar__actions {
    width: 100%;
  }

  .toolbar__filters {
    min-width: 0;
  }

  .toolbar__actions {
    justify-content: flex-end;
  }

  .search-input {
    width: auto;
    min-width: 0;
    flex: 1 1 280px;
  }
}

@media (max-width: 760px) {
  .page-heading,
  .toolbar,
  .table-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .page-heading {
    gap: 16px;
  }

  .page-heading .el-button {
    width: 100%;
  }

  .execution-environment {
    align-items: stretch;
    flex-direction: column;
  }

  .execution-environment__icon {
    display: none;
  }

  .execution-environment__endpoint,
  .execution-environment__warning {
    flex-basis: auto;
    margin-left: 0;
  }

  .execution-environment > .el-button {
    margin-left: 0;
  }

  .environment-select {
    width: 100%;
  }

  .summary-strip {
    grid-template-columns: 1fr;
  }

  .summary-strip > div {
    min-height: 70px;
    border-right: 0;
    border-bottom: 1px solid #edf1f3;
  }

  .summary-strip > div:last-child {
    border-bottom: 0;
  }

  .toolbar__filters,
  .toolbar__actions {
    width: 100%;
  }

  .search-input {
    width: 100%;
  }

  .status-select {
    width: 116px;
    flex: 0 0 116px;
  }

  .toolbar__actions .el-button:first-child {
    flex: 1;
  }

  .table-footer :deep(.el-pagination__total) {
    display: none;
  }
}
</style>
