<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
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
  VideoPlay,
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

import AutomationPipelineEditorDialog from '@/components/AutomationPipelineEditorDialog.vue'
import type { AutomationPipeline, AutomationPipelineDraft } from '@/domain/automation-pipeline'
import type { TestEnvironment } from '@/domain/environment'
import type { AutomationScript } from '@/domain/script'
import { services } from '@/services/container'

const router = useRouter()
const pipelines = ref<AutomationPipeline[]>([])
const scripts = ref<AutomationScript[]>([])
const environments = ref<TestEnvironment[]>([])
const loading = ref(true)
const searchKeyword = ref('')
const environmentFilter = ref('all')
const currentPage = ref(1)
const pageSize = 8
const editorVisible = ref(false)
const editingPipeline = ref<AutomationPipeline | null>(null)
const runningPipelineIds = ref(new Set<string>())

const scriptById = computed(() => new Map(scripts.value.map((script) => [script.id, script])))
const environmentById = computed(() => new Map(environments.value.map((environment) => [environment.id, environment])))

function issuesFor(pipeline: AutomationPipeline): string[] {
  const issues: string[] = []
  const environment = environmentById.value.get(pipeline.environmentId)
  if (!environment) issues.push('运行环境已不存在')
  else if (!environment.enabled) issues.push('运行环境已停用')

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
    const environment = environmentById.value.get(pipeline.environmentId)
    const matchesEnvironment = environmentFilter.value === 'all' || pipeline.environmentId === environmentFilter.value
    const searchable = [
      pipeline.name,
      pipeline.description,
      environment?.name ?? '',
      ...pipeline.steps.map((step) => scriptById.value.get(step.scriptId)?.name ?? step.scriptId),
    ]
    return matchesEnvironment && (!keyword || searchable.some((value) => value.toLowerCase().includes(keyword)))
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

watch([searchKeyword, environmentFilter], () => {
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
    pipelines.value = nextPipelines
    scripts.value = nextScripts
    environments.value = nextEnvironments
    const lastPage = Math.max(1, Math.ceil(filteredPipelines.value.length / pageSize))
    currentPage.value = Math.min(currentPage.value, lastPage)
    if (showSuccess) ElMessage.success('自动化配置已刷新')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '自动化配置加载失败')
  } finally {
    loading.value = false
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

async function runPipeline(pipeline: AutomationPipeline): Promise<void> {
  const issues = issuesFor(pipeline)
  if (issues.length > 0) {
    ElMessage.error(issues[0] ?? '自动化配置不可运行')
    return
  }
  if (runningPipelineIds.value.has(pipeline.id)) return

  runningPipelineIds.value = new Set([...runningPipelineIds.value, pipeline.id])
  try {
    const record = await services.automationPipelineExecution.run(pipeline)
    await loadData()
    if (record.status === 'passed') {
      ElMessage.success(`“${pipeline.name}”已按顺序运行完成`)
    } else {
      ElMessage.error(`“${pipeline.name}”运行未全部通过，请查看运行记录`)
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '自动化配置运行失败')
  } finally {
    const next = new Set(runningPipelineIds.value)
    next.delete(pipeline.id)
    runningPipelineIds.value = next
  }
}

function mappingCount(pipeline: AutomationPipeline): number {
  return pipeline.steps.reduce((total, step) => total + step.parameterMappings.length, 0)
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

onMounted(() => loadData())
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

    <section class="automation-panel">
      <div class="toolbar">
        <div class="toolbar__filters">
          <el-input
            v-model="searchKeyword"
            :prefix-icon="Search"
            clearable
            placeholder="搜索配置、脚本或环境"
            class="search-input"
          />
          <el-select v-model="environmentFilter" class="environment-filter" aria-label="按运行环境筛选">
            <el-option label="全部环境" value="all" />
            <el-option
              v-for="environment in environments"
              :key="environment.id"
              :label="environment.name"
              :value="environment.id"
            />
          </el-select>
        </div>
        <div class="toolbar__actions">
          <el-button :icon="Setting" @click="router.push('/environments')">管理环境</el-button>
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

        <el-table-column label="运行环境" min-width="230">
          <template #default="scope">
            <div v-if="environmentById.get(scope.row.environmentId)" class="environment-info">
              <strong>{{ environmentById.get(scope.row.environmentId)?.name }}</strong>
              <code>{{ environmentById.get(scope.row.environmentId)?.apiBaseUrl }}</code>
            </div>
            <el-tag v-else type="danger" effect="light">环境已删除</el-tag>
          </template>
        </el-table-column>

        <el-table-column label="传参" width="120" align="center">
          <template #default="scope">
            <el-tag :type="mappingCount(scope.row) > 0 ? 'success' : 'info'" effect="plain">
              {{ mappingCount(scope.row) > 0 ? `${mappingCount(scope.row)} 项` : '未配置' }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="状态" width="130">
          <template #default="scope">
            <el-tooltip v-if="issuesFor(scope.row).length" :content="issuesFor(scope.row).join('；')" placement="top">
              <el-tag type="danger" effect="light">配置异常</el-tag>
            </el-tooltip>
            <el-tag v-else type="success" effect="light">可运行</el-tag>
          </template>
        </el-table-column>

        <el-table-column label="更新时间" width="190">
          <template #default="scope">{{ formatUpdatedAt(scope.row.updatedAt) }}</template>
        </el-table-column>

        <el-table-column label="操作" width="160" fixed="right">
          <template #default="scope">
            <div class="row-actions">
              <el-tooltip :content="issuesFor(scope.row)[0] ?? '按顺序运行'" placement="top">
                <span>
                  <el-button
                    text
                    :icon="VideoPlay"
                    :loading="runningPipelineIds.has(scope.row.id)"
                    :disabled="issuesFor(scope.row).length > 0 || runningPipelineIds.has(scope.row.id)"
                    aria-label="运行自动化配置"
                    @click="runPipeline(scope.row)"
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
      :environments="environments"
      @save="savePipeline"
    />
  </div>
</template>

<style scoped>
.automation-page {
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

.summary-strip__icon.is-total { color: #087d71; background: #d9f7f1; }
.summary-strip__icon.is-ready { color: #16834a; background: #def6e8; }
.summary-strip__icon.is-mapping { color: #805e12; background: #fff0c9; }

.summary-strip p,
.summary-strip p > span,
.summary-strip p > strong {
  display: block;
  margin: 0;
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

.automation-panel {
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

.search-input { width: min(420px, 38vw); }
.environment-filter { width: 210px; }

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
  color: #108f82;
  border-radius: 5px;
  background: #e3f7f3;
}

.pipeline-info > div { min-width: 0; }
.pipeline-info strong { color: #2d3a41; font-size: var(--font-md); font-weight: 650; }
.pipeline-info p {
  display: -webkit-box;
  overflow: hidden;
  margin: 6px 0 0;
  color: #8c989f;
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
  color: #58676f;
}

.step-flow li:not(:last-child)::after { content: '›'; margin-left: 2px; color: #aeb8bd; }
.step-flow li > span {
  display: grid;
  width: 25px;
  height: 25px;
  flex: 0 0 25px;
  place-items: center;
  color: #087d71;
  border: 1px solid #bce0da;
  border-radius: 50%;
  background: #effaf8;
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
.step-flow small { color: #159c8d; font-size: var(--font-caption); white-space: nowrap; }

.environment-info strong,
.environment-info code { display: block; }
.environment-info strong { color: #4d5c63; font-size: var(--font-sm); }
.environment-info code {
  overflow: hidden;
  margin-top: 6px;
  color: #738188;
  font-size: var(--font-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-actions { gap: 1px; }
.row-actions :deep(.el-button) { width: 40px; height: 40px; margin: 0; }

.table-footer {
  display: flex;
  min-height: 76px;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 10px 16px;
  border-top: 1px solid #edf1f3;
}

.table-footer > span { color: #909ba1; font-size: var(--font-sm); }

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

:deep(.el-table td.el-table__cell) { height: 106px; }

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
  .summary-strip > div { min-height: 70px; border-right: 0; border-bottom: 1px solid #edf1f3; }
  .summary-strip > div:last-child { border-bottom: 0; }
  .toolbar__filters,
  .toolbar__actions { align-items: stretch; flex-direction: column; }
  .search-input,
  .environment-filter { width: 100%; }
  .table-footer :deep(.el-pagination__total) { display: none; }
}
</style>
