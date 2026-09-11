<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  Connection,
  Delete,
  EditPen,
  Operation,
  Plus,
  RefreshRight,
  Search,
  Setting,
  VideoPause,
  VideoPlay,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import AutomationPipelineEditorDialog from '@/components/AutomationPipelineEditorDialog.vue'
import type { AutomationPipeline, AutomationPipelineDraft } from '@/domain/automation-pipeline'
import type { TestEnvironment } from '@/domain/environment'
import type { AutomationScript } from '@/domain/script'
import { services } from '@/services/container'
import type { PipelineExecutionSnapshot } from '@/services/automation-pipelines/automation-pipeline-execution-service'

const router = useRouter()
const pipelines = ref<AutomationPipeline[]>([])
const scripts = ref<AutomationScript[]>([])
const environments = ref<TestEnvironment[]>([])
const loading = ref(true)
const searchKeyword = ref('')
const selectedEnvironmentId = ref('')
const currentPage = ref(1)
const pageSize = 8
let refreshTimer: number | undefined
let refreshingExecution = false
const editorVisible = ref(false)
const editingPipeline = ref<AutomationPipeline | null>(null)
const activeExecutions = ref<PipelineExecutionSnapshot[]>([])
const runningPipelineIds = computed(() => new Set(activeExecutions.value
  .filter(execution => !execution.environment?.id || execution.environment.id === selectedEnvironmentId.value)
  .map(execution => execution.pipelineId)))
function syncExecutions(): void {
  activeExecutions.value = services.automationPipelineExecution.getActiveExecutions?.() ?? []
}
function selectedExecution(pipelineId: string): PipelineExecutionSnapshot | undefined {
  return activeExecutions.value.find(execution => execution.pipelineId === pipelineId
    && (!execution.environment?.id || execution.environment.id === selectedEnvironmentId.value))
}
const stoppingPipelineIds = ref(new Set<string>())

const scriptById = computed(() => new Map(scripts.value.map((script) => [script.id, script])))
const selectedEnvironment = computed(() => environments.value.find((environment) => environment.id === selectedEnvironmentId.value && environment.enabled) ?? null)

function issuesFor(pipeline: AutomationPipeline): string[] {
  const issues: string[] = []

  for (const step of pipeline.steps) {
    const script = scriptById.value.get(step.scriptId)
    if (!script) issues.push(`脚本 ${step.scriptId} 已不存在`)
    else if (script.status === 'disabled') issues.push(`脚本“${script.name}”已停用`)
  }
  return [...new Set(issues)]
}

const filteredPipelines = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase()
  return pipelines.value.filter((pipeline) => {
    const searchable = [
      pipeline.name,
      pipeline.description,
      ...pipeline.steps.map((step) => scriptById.value.get(step.scriptId)?.name ?? step.scriptId),
    ]
    return (!keyword || searchable.some((value) => value.toLowerCase().includes(keyword)))
  })
})

const pagedPipelines = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  return filteredPipelines.value.slice(start, start + pageSize)
})

const summary = computed(() => ({
  total: pipelines.value.length,
  ready: pipelines.value.filter((pipeline) => issuesFor(pipeline).length === 0).length,
  mappings: pipelines.value.reduce(
    (total, pipeline) => total + pipeline.steps.reduce((count, step) => count + step.parameterMappings.length, 0),
    0,
  ),
}))

watch(searchKeyword, () => {
  currentPage.value = 1
})

async function loadData(showSuccess = false): Promise<void> {
  loading.value = true
  try {
    const [nextPipelines, nextScripts, nextEnvironments] = await Promise.all([
      services.automationPipelines.list(),
      services.scripts.list(),
      services.environments.list(),
    ])
    await services.automationPipelineExecution.refresh?.()
    pipelines.value = nextPipelines
    scripts.value = nextScripts
    environments.value = nextEnvironments
    if (!selectedEnvironment.value) {
      selectedEnvironmentId.value = nextEnvironments.find((environment) => environment.active && environment.enabled)?.id ?? ''
    }
    syncExecutions()
    const lastPage = Math.max(1, Math.ceil(filteredPipelines.value.length / pageSize))
    currentPage.value = Math.min(currentPage.value, lastPage)
    if (showSuccess) ElMessage.success('自动化配置已刷新')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '自动化配置加载失败')
  } finally {
    loading.value = false
  }
}

async function selectEnvironment(environmentId: string): Promise<void> {
  try {
    await services.environments.setActive(environmentId)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '环境切换失败')
    selectedEnvironmentId.value = ''
    await loadData()
  }
}

function openCreate(): void {
  editingPipeline.value = null
  editorVisible.value = true
}

function openEdit(pipeline: AutomationPipeline): void {
  editingPipeline.value = pipeline
  editorVisible.value = true
}

async function savePipeline(draft: AutomationPipelineDraft): Promise<void> {
  try {
    if (editingPipeline.value) {
      await services.automationPipelines.update(editingPipeline.value.id, draft)
      ElMessage.success('自动化配置已更新')
    } else {
      await services.automationPipelines.create(draft)
      ElMessage.success('自动化配置已新增')
    }
    editorVisible.value = false
    await loadData()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '自动化配置保存失败')
  }
}

async function removePipeline(pipeline: AutomationPipeline): Promise<void> {
  try {
    await services.automationPipelines.remove(pipeline.id)
    ElMessage.success('自动化配置已删除')
    await loadData()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '自动化配置删除失败')
  }
}

function runPipeline(pipeline: AutomationPipeline): void {
  if (!selectedEnvironment.value) {
    ElMessage.error('请选择可用的运行环境')
    return
  }
  const issues = issuesFor(pipeline)
  if (issues.length > 0) {
    ElMessage.error(issues[0] ?? '自动化配置不可运行')
    return
  }
  if (runningPipelineIds.value.has(pipeline.id)) return

  const executionLabel = `${pipeline.name} · ${selectedEnvironment.value.name}`
  let task: ReturnType<typeof services.automationPipelineExecution.run>
  try {
    task = services.automationPipelineExecution.run(pipeline, selectedEnvironment.value.id)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '自动化配置运行失败')
    return
  }

  syncExecutions()
  ElMessage.success(`“${executionLabel}”已开始运行`)
  void task
    .then(async (record) => {
      await loadData()
      if (record.status === 'passed') {
        ElMessage.success(`“${executionLabel}”已按顺序运行完成`)
      } else if (record.status === 'partial') {
        ElMessage({
          type: 'warning',
          message: `“${executionLabel}”部分通过，请查看未通过断言`,
          customClass: 'status-message--partial',
        })
      } else if (record.status === 'interrupted') {
        ElMessage.warning(`“${executionLabel}”已停止`)
      } else {
        ElMessage.error(`“${executionLabel}”执行失败，请查看运行记录`)
      }
    })
    .catch((error) => {
      ElMessage.error(error instanceof Error ? error.message : '自动化配置运行失败')
    })
    .finally(syncExecutions)
}

async function confirmStopExecution(execution: PipelineExecutionSnapshot): Promise<void> {
  if (stoppingPipelineIds.value.has(execution.id)) return
  const label = `${execution.pipelineName ?? execution.pipelineId} · ${execution.environment?.name ?? '未知环境'}`
  try {
    await ElMessageBox.confirm(
      `将停止“${label}”批次，未执行步骤不会继续运行。确定强制停止吗？`,
      '强制停止自动化配置',
      { confirmButtonText: '强制停止', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger', type: 'warning' },
    )
  } catch { return }
  stoppingPipelineIds.value = new Set([...stoppingPipelineIds.value, execution.id])
  try {
    const result = await services.automationPipelineExecution.stopByRecordId(execution.id)
    if (result.cleanupTimedOutRunIds?.length) ElMessage.warning(`“${label}”已提交停止请求，部分浏览器仍在清理`)
    else if (result.stopped) ElMessage.success(`“${label}”已提交强制停止请求`)
    else ElMessage.warning(`“${label}”当前没有正在运行的任务`)
    await services.automationPipelineExecution.refresh?.()
    syncExecutions()
  } catch (error) {
    ElMessage.error(error instanceof Error ? `强制停止失败：${error.message}` : '强制停止失败')
  } finally {
    const next = new Set(stoppingPipelineIds.value)
    next.delete(execution.id)
    stoppingPipelineIds.value = next
  }
}
function confirmForceStop(pipeline: AutomationPipeline): void {
  const execution = selectedExecution(pipeline.id)
  if (execution) void confirmStopExecution(execution)
}

function mappingCount(pipeline: AutomationPipeline): number {
  return pipeline.steps.reduce((total, step) => total + step.parameterMappings.length, 0)
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

onMounted(() => {
  void loadData()
  refreshTimer = window.setInterval(async () => {
    if (refreshingExecution) return
    refreshingExecution = true
    try {
      await services.automationPipelineExecution.refresh?.()
      syncExecutions()
    } catch { /* Keep the last known locks during a temporary connection failure. */ }
    finally { refreshingExecution = false }
  }, 1_000)
})
onBeforeUnmount(() => { if (refreshTimer !== undefined) window.clearInterval(refreshTimer) })
</script>

<template>
  <div class="automation-page">
    <header class="page-heading">
      <div>
        <p>AUTOMATION PIPELINES</p>
        <h1>自动化配置</h1>
        <span>组合本地脚本、设置执行顺序，并按需传递前序步骤的输出参数</span>
      </div>
      <el-button type="primary" :icon="Plus" @click="openCreate">新增自动化配置</el-button>
    </header>

    <section class="summary-strip" aria-label="自动化配置统计">
      <div>
        <span class="summary-strip__icon is-total"><el-icon :size="21"><Operation /></el-icon></span>
        <p><span>配置总数</span><strong>{{ summary.total }}</strong></p>
      </div>
      <div>
        <span class="summary-strip__icon is-ready"><el-icon :size="21"><VideoPlay /></el-icon></span>
        <p><span>可运行</span><strong>{{ summary.ready }}</strong></p>
      </div>
      <div>
        <span class="summary-strip__icon is-mapping"><el-icon :size="21"><Connection /></el-icon></span>
        <p><span>参数映射</span><strong>{{ summary.mappings }}</strong></p>
      </div>
    </section>

    <section class="execution-environment" :class="{ 'execution-environment--missing': !selectedEnvironment }">
      <span class="execution-environment__icon"><el-icon :size="20"><Setting /></el-icon></span>
      <div class="execution-environment__label">
        <strong>运行环境</strong>
        <span>不同环境可同时运行，最多三个批次；每个批次内按顺序执行</span>
      </div>
      <el-select
        v-model="selectedEnvironmentId"
        class="environment-select"
        placeholder="请选择运行环境"
        @change="selectEnvironment"
      >
        <el-option
          v-for="environment in environments.filter((environment) => environment.enabled)"
          :key="environment.id"
          :label="`${environment.name} · ${environment.code}`"
          :value="environment.id"
        />
      </el-select>
      <div v-if="selectedEnvironment" class="execution-environment__endpoint">
        <code>{{ selectedEnvironment.apiBaseUrl }}</code>
        <span>Token → {{ selectedEnvironment.auth.tokenVariable || '未配置' }}</span>
      </div>
      <span v-else class="execution-environment__warning">未选择环境，暂不能运行配置</span>
      <el-button text :icon="Setting" @click="router.push('/environments')">管理环境</el-button>
    </section>

    <section v-if="activeExecutions.length" class="active-executions" aria-label="后台运行批次">
      <strong>后台运行批次（{{ activeExecutions.length }} / 3）</strong>
      <div v-for="execution in activeExecutions" :key="execution.id" class="active-execution">
        <span>{{ execution.pipelineName ?? execution.pipelineId }}</span>
        <el-tag>{{ execution.environment?.name || '环境加载中' }} · {{ execution.environment?.code }}</el-tag>
        <span>{{ execution.currentScriptId ? (scriptById.get(execution.currentScriptId)?.name ?? execution.currentScriptId) : ({ login: '登录中', saving: '保存结果中', recovering: '恢复状态中', submitting: '提交中' }[execution.phase ?? ''] ?? '执行中') }}</span>
        <el-button text @click="router.push('/runs')">运行记录</el-button>
        <el-button text type="danger" :loading="stoppingPipelineIds.has(execution.id)" @click="confirmStopExecution(execution)">停止此批次</el-button>
      </div>
    </section>

    <section class="automation-panel">
      <div class="toolbar">
        <div class="toolbar__filters">
          <el-input
            v-model="searchKeyword"
            :prefix-icon="Search"
            clearable
            placeholder="搜索配置或脚本"
            class="search-input"
          />
        </div>
        <div class="toolbar__actions">
          <el-tooltip content="刷新列表" placement="top">
            <el-button
              circle
              :icon="RefreshRight"
              :loading="loading"
              aria-label="刷新自动化配置"
              @click="loadData(true)"
            />
          </el-tooltip>
        </div>
      </div>

      <el-table
        v-loading="loading"
        :data="pagedPipelines"
        row-key="id"
        class="automation-table"
        empty-text="暂无数据"
      >
        <el-table-column label="配置信息" min-width="300">
          <template #default="scope">
            <div class="pipeline-info">
              <span class="pipeline-info__icon"><el-icon :size="19"><Operation /></el-icon></span>
              <div>
                <strong>{{ scope.row.name }}</strong>
                <p>{{ scope.row.description || '暂无简介' }}</p>
              </div>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="执行顺序" min-width="330">
          <template #default="scope">
            <ol class="step-flow">
              <li v-for="(step, index) in scope.row.steps" :key="`${scope.row.id}-${index}-${step.scriptId}`">
                <span>{{ index + 1 }}</span>
                <strong>{{ scriptById.get(step.scriptId)?.name ?? `已删除脚本（${step.scriptId}）` }}</strong>
                <small v-if="step.parameterMappings.length">{{ step.parameterMappings.length }} 个传入参数</small>
              </li>
            </ol>
          </template>
        </el-table-column>


        <el-table-column label="传参" width="120" align="center">
          <template #default="scope">
            <el-tag :type="mappingCount(scope.row) > 0 ? 'success' : 'info'" effect="plain">
              {{ mappingCount(scope.row) > 0 ? `${mappingCount(scope.row)} 项` : '未配置' }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="当前环境状态" width="130">
          <template #default="scope">
            <el-tooltip v-if="issuesFor(scope.row).length" :content="issuesFor(scope.row).join('；')" placement="top">
              <el-tag type="danger" effect="light">配置异常</el-tag>
            </el-tooltip>
            <el-tag v-else-if="runningPipelineIds.has(scope.row.id)" type="warning" effect="light">运行中</el-tag>
            <el-tag v-else type="success" effect="light">可运行</el-tag>
          </template>
        </el-table-column>

        <el-table-column label="更新时间" width="190">
          <template #default="scope">{{ formatUpdatedAt(scope.row.updatedAt) }}</template>
        </el-table-column>

        <el-table-column label="操作" width="200" fixed="right">
          <template #default="scope">
            <div class="row-actions">
              <el-tooltip :content="runningPipelineIds.has(scope.row.id) ? '正在运行' : (issuesFor(scope.row)[0] ?? (selectedEnvironment ? '按顺序运行' : '请选择运行环境'))" placement="top">
                <span>
                  <el-button
                    text
                    :icon="VideoPlay"
                    :disabled="!selectedEnvironment || issuesFor(scope.row).length > 0 || runningPipelineIds.has(scope.row.id)"
                    aria-label="运行自动化配置"
                    @click="runPipeline(scope.row)"
                  />
                </span>
              </el-tooltip>
              <el-tooltip content="强制停止" placement="top">
                <span>
                  <el-button
                    text
                    type="danger"
                    :icon="VideoPause"
                    :loading="stoppingPipelineIds.has(selectedExecution(scope.row.id)?.id ?? '')"
                    :disabled="!runningPipelineIds.has(scope.row.id) || stoppingPipelineIds.has(selectedExecution(scope.row.id)?.id ?? '')"
                    aria-label="强制停止自动化配置"
                    @click="confirmForceStop(scope.row)"
                  />
                </span>
              </el-tooltip>
              <el-tooltip content="编辑" placement="top">
                <el-button text :icon="EditPen" aria-label="编辑自动化配置" @click="openEdit(scope.row)" />
              </el-tooltip>
              <el-popconfirm
                title="确定删除这个自动化配置吗？"
                confirm-button-text="删除"
                cancel-button-text="取消"
                @confirm="removePipeline(scope.row)"
              >
                <template #reference>
                  <el-button text type="danger" :icon="Delete" aria-label="删除自动化配置" />
                </template>
              </el-popconfirm>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <footer class="table-footer">
        <span>共 {{ filteredPipelines.length }} 个自动化配置</span>
        <el-pagination
          v-model:current-page="currentPage"
          background
          layout="total, prev, pager, next"
          :page-size="pageSize"
          :total="filteredPipelines.length"
        />
      </footer>
    </section>

    <AutomationPipelineEditorDialog
      v-model="editorVisible"
      :pipeline="editingPipeline"
      :scripts="scripts"
      @save="savePipeline"
    />
  </div>
</template>

<style scoped>
.active-executions { margin: 16px 0; padding: 16px; background: var(--color-bg-card, white); border-radius: 12px; }
.active-execution { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 10px; }

.execution-environment {
  display: flex;
  min-height: 84px;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding: 12px 16px;
  border: 1px solid #d9e4f5;
  border-radius: var(--radius-card);
  background: #f7faff;
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
  color: var(--color-primary);
  border-radius: 5px;
  background: var(--color-primary-soft);
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
  color: var(--color-text-primary);
  font-size: var(--font-md);
}

.execution-environment__label span,
.execution-environment__endpoint span {
  margin-top: 4px;
  color: var(--color-text-muted);
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
  color: #315fbd;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: var(--font-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.execution-environment__warning {
  flex: 1;
  color: var(--color-warning);
  font-size: var(--font-sm);
}
.execution-environment { flex-wrap: wrap; }

.automation-page {
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

.summary-strip {
  display: grid;
  margin-bottom: 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  grid-template-columns: repeat(3, minmax(0, 1fr));
  background: var(--color-surface);
  box-shadow: var(--shadow-card);
}

.summary-strip > div {
  display: flex;
  min-height: 88px;
  align-items: center;
  gap: 13px;
  padding: 16px 20px;
  border-right: 1px solid var(--color-border-light);
}

.summary-strip > div:last-child {
  border-right: 0;
}

.summary-strip__icon {
  display: grid;
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
  place-items: center;
  border-radius: 5px;
}

.summary-strip__icon.is-total { color: var(--color-primary); background: var(--color-primary-soft); }
.summary-strip__icon.is-ready { color: var(--color-success); background: #eaf7f0; }
.summary-strip__icon.is-mapping { color: #bd7217; background: #fff5e7; }

.summary-strip p,
.summary-strip p > span,
.summary-strip p > strong {
  display: block;
  margin: 0;
}

.summary-strip p > span {
  color: var(--color-text-muted);
  font-size: var(--font-sm);
}

.summary-strip p > strong {
  margin-top: 4px;
  color: var(--color-text-primary);
  font-size: var(--font-subtitle);
}

.automation-panel {
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  box-shadow: var(--shadow-card);
}

.toolbar {
  display: flex;
  min-height: 64px;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border-light);
}

.toolbar__filters,
.toolbar__actions,
.row-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.search-input { width: min(420px, 38vw); }

.automation-table { width: 100%; }

.pipeline-info {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: 12px;
  padding: 4px 0;
}

.pipeline-info__icon {
  display: grid;
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  place-items: center;
  color: var(--color-primary);
  border-radius: 5px;
  background: var(--color-primary-soft);
}

.pipeline-info > div { min-width: 0; }
.pipeline-info strong { color: var(--color-text-primary); font-size: var(--font-md); font-weight: 650; }
.pipeline-info p {
  display: -webkit-box;
  overflow: hidden;
  margin: 6px 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-sm);
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.step-flow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.step-flow li {
  display: flex;
  max-width: 100%;
  align-items: center;
  gap: 6px;
  color: var(--color-text-secondary);
}

.step-flow li:not(:last-child)::after { content: '›'; margin-left: 2px; color: var(--color-text-muted); }
.step-flow li > span {
  display: grid;
  width: 25px;
  height: 25px;
  flex: 0 0 25px;
  place-items: center;
  color: var(--color-primary);
  border: 1px solid #d3e0f8;
  border-radius: 50%;
  background: var(--color-primary-soft);
  font-size: var(--font-caption);
  font-weight: 700;
}
.step-flow strong {
  overflow: hidden;
  max-width: 210px;
  font-size: var(--font-sm);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.step-flow small { color: var(--color-primary); font-size: var(--font-caption); white-space: nowrap; }

.row-actions { gap: 1px; }
.row-actions :deep(.el-button) { width: 40px; height: 40px; margin: 0; }

.table-footer {
  display: flex;
  min-height: 60px;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 10px 16px;
  border-top: 1px solid var(--color-border-light);
}

.table-footer > span { color: var(--color-text-muted); font-size: var(--font-sm); }

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

:deep(.el-table td.el-table__cell) { height: 92px; }

@media (max-width: 1350px) {
  .toolbar__filters,
  .toolbar__actions { width: 100%; }
  .toolbar__filters { min-width: 0; }
  .toolbar__actions { justify-content: flex-end; }
  .search-input { width: auto; min-width: 0; flex: 1 1 280px; }
}

@media (max-width: 760px) {
  .page-heading,
  .toolbar,
  .table-footer { align-items: stretch; flex-direction: column; }
  .page-heading { gap: 16px; }
  .page-heading .el-button { width: 100%; }
  .summary-strip { grid-template-columns: 1fr; }
  .summary-strip > div { min-height: 70px; border-right: 0; border-bottom: 1px solid var(--color-border-light); }
  .summary-strip > div:last-child { border-bottom: 0; }
  .toolbar__filters,
  .toolbar__actions { align-items: stretch; flex-direction: column; }
  .search-input { width: 100%; }
  .environment-select { width: 100%; flex: 1 1 100%; }
  .execution-environment__endpoint { flex: 1 1 100%; }
  .table-footer :deep(.el-pagination__total) { display: none; }
}
</style>
