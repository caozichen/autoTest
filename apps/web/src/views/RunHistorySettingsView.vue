<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArrowDown, ArrowUp, Delete, Plus } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { services } from '@/services/container'
import {
  readRunHistoryTabs,
  resolveRunHistoryTabs,
  saveRunHistoryTabs,
  type RunHistoryEnvironment,
} from '@/services/run-records/run-history-tabs'

const environments = ref<RunHistoryEnvironment[]>([])
const selectedIds = ref<string[]>([])
const savedIds = ref<string[]>([])
const addId = ref('')
const loading = ref(true)
const loadFailed = ref(false)
const selected = computed(() => resolveRunHistoryTabs(environments.value, selectedIds.value))
const available = computed(() => environments.value.filter((environment) => !selectedIds.value.includes(environment.id)))
const dirty = computed(() => JSON.stringify(selectedIds.value) !== JSON.stringify(savedIds.value))

async function load(): Promise<void> {
  loading.value = true
  loadFailed.value = false
  try {
    environments.value = await services.environments.list()
    selectedIds.value = resolveRunHistoryTabs(environments.value, readRunHistoryTabs()).map(({ id }) => id)
    savedIds.value = [...selectedIds.value]
  } catch {
    loadFailed.value = true
    ElMessage.error('环境 Tab 配置加载失败，请重试')
  } finally {
    loading.value = false
  }
}

function add(): void {
  if (!available.value.some(({ id }) => id === addId.value)) return
  selectedIds.value.push(addId.value)
  addId.value = ''
}

function move(index: number, offset: number): void {
  const target = index + offset
  if (target < 0 || target >= selectedIds.value.length) return
  const next = [...selectedIds.value]
  const [id] = next.splice(index, 1)
  next.splice(target, 0, id!)
  selectedIds.value = next
}

function save(): void {
  try {
    saveRunHistoryTabs(selectedIds.value)
    savedIds.value = [...selectedIds.value]
    ElMessage.success('运行记录 Tab 配置已保存')
  } catch {
    ElMessage.error('保存失败，请检查浏览器存储权限后重试')
  }
}

onMounted(() => void load())
</script>

<template>
  <div class="tab-settings">
    <header class="page-heading">
      <div><p>系统设置</p><h1>运行记录 Tab 配置</h1><span>选择列表显示的环境，并调整从左到右的顺序</span></div>
      <RouterLink to="/runs"><el-button>查看运行记录</el-button></RouterLink>
    </header>
    <section v-loading="loading" class="settings-panel" aria-label="环境 Tab 配置">
      <el-alert v-if="loadFailed" title="配置加载失败" type="error" :closable="false" />
      <el-button v-if="loadFailed" @click="load">重新加载</el-button>
      <template v-else-if="!loading">
        <h2>显示的环境</h2>
        <p class="hint">“全部环境”固定在最左侧。移除 Tab 不会删除环境或运行记录。</p>
        <div class="add-environment">
          <el-select v-model="addId" filterable clearable placeholder="选择要添加的环境" aria-label="选择要添加的环境" :disabled="available.length === 0">
            <el-option v-for="environment in available" :key="environment.id" :value="environment.id" :label="`${environment.name}（${environment.code}）`" />
          </el-select>
          <el-button :icon="Plus" :disabled="!addId" @click="add">添加 Tab</el-button>
        </div>
        <p v-if="environments.length === 0" class="hint">还没有环境，请先前往 <RouterLink to="/environments">环境管理</RouterLink> 创建。</p>
        <ol class="environment-order" aria-label="Tab 显示顺序">
          <li class="fixed-tab"><span class="order-number">1</span><strong>全部环境</strong><span class="hint">固定显示</span></li>
          <li v-for="(environment, index) in selected" :key="environment.id" :data-environment-id="environment.id">
            <span class="order-number">{{ index + 2 }}</span>
            <div class="environment-name"><strong>{{ environment.name }}</strong><span>{{ environment.code }}</span></div>
            <div class="order-actions">
              <el-button :icon="ArrowUp" :disabled="index === 0" :aria-label="`上移 ${environment.name}`" @click="move(index, -1)">上移</el-button>
              <el-button :icon="ArrowDown" :disabled="index === selected.length - 1" :aria-label="`下移 ${environment.name}`" @click="move(index, 1)">下移</el-button>
              <el-button :icon="Delete" type="danger" plain :aria-label="`移除 ${environment.name}`" @click="selectedIds = selectedIds.filter((id) => id !== environment.id)">移除</el-button>
            </div>
          </li>
        </ol>
        <p v-if="selected.length === 0" class="hint">当前仅显示“全部环境”，可以在上方添加环境 Tab。</p>
        <div class="preview"><h2>Tab 预览</h2><div><span class="preview-all">全部环境</span><span v-for="environment in selected" :key="environment.id">{{ environment.name }}</span></div></div>
        <footer>
          <span class="hint">{{ dirty ? '有未保存的更改' : '配置已保存于当前浏览器' }}</span>
          <el-button :disabled="!dirty" @click="selectedIds = [...savedIds]; addId = ''">撤销更改</el-button>
          <el-button type="primary" @click="save">保存配置</el-button>
        </footer>
      </template>
    </section>
  </div>
</template>

<style scoped>
.tab-settings { max-width: 980px; color: var(--color-text-primary); }
.page-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
.page-heading p { margin: 0 0 4px; color: var(--color-primary); font-size: 12px; }
h1 { margin: 0 0 8px; font-size: 22px; }
.page-heading span, .hint { color: var(--color-text-secondary); font-size: 13px; line-height: 1.7; }
.settings-panel { min-height: 260px; padding: 24px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-surface); }
h2 { margin: 0 0 8px; font-size: 16px; }
.add-environment { display: flex; gap: 12px; margin: 20px 0; }
.add-environment .el-select { width: 320px; max-width: 100%; }
.environment-order { padding: 0; list-style: none; }
.environment-order li { display: flex; align-items: center; gap: 14px; padding: 16px 0; border-bottom: 1px solid var(--color-border-light); }
.order-number { display: grid; place-items: center; flex: 0 0 28px; height: 28px; border-radius: 5px; color: var(--color-text-secondary); background: var(--color-bg-page); font-size: 13px; }
.environment-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.environment-name span { display: block; margin-top: 4px; font-size: 12px; color: var(--color-text-secondary); }
.fixed-tab strong { flex: 1; }
.preview { margin-top: 28px; }
.preview > div { display: flex; gap: 24px; overflow-x: auto; border-bottom: 1px solid var(--color-border); }
.preview span { flex-shrink: 0; padding: 14px 0; font-size: 14px; }
.preview-all { color: var(--color-primary); border-bottom: 2px solid var(--color-primary); }
footer { display: flex; align-items: center; gap: 12px; margin-top: 28px; }
footer .hint { flex: 1; }
a { color: var(--color-primary); text-decoration: none; }
@media (max-width: 640px) { .settings-panel { padding: 16px; } .environment-order li { flex-wrap: wrap; } .order-actions { width: 100%; padding-left: 42px; } footer { flex-wrap: wrap; } footer .hint { flex-basis: 100%; } }
</style>
