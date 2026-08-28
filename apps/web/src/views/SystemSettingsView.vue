<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Connection, VideoPlay } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

import type { RunnerServiceState } from '@/services/system/runner-control-service'
import { services } from '@/services/container'

const runner = ref<RunnerServiceState | null>(null)
const checking = ref(true)
const starting = ref(false)
let refreshTimer: number | null = null

const statusLabel = computed(() => {
  if (checking.value && !runner.value) return '检查中'
  return runner.value?.status === 'online' ? '在线' : '离线'
})
const buttonLabel = computed(() => {
  if (starting.value) return '正在启动'
  return runner.value?.status === 'online' ? 'Runner 已运行' : '启动 Runner'
})
const checkedAt = computed(() => {
  if (!runner.value) return '尚未检查'
  const value = new Date(runner.value.checkedAt)
  return Number.isNaN(value.getTime()) ? '尚未检查' : value.toLocaleString('zh-CN', { hour12: false })
})

async function refreshStatus(): Promise<RunnerServiceState> {
  checking.value = true
  try {
    const latestState = await services.runnerControl.getStatus()
    runner.value = latestState
    return latestState
  } finally {
    checking.value = false
  }
}

async function startRunner(): Promise<void> {
  if (starting.value || runner.value?.status === 'online') return
  starting.value = true
  try {
    const result = await services.runnerControl.start()
    const latestState = await refreshStatus()
    if (latestState.status !== 'online') throw new Error('启动命令已完成，但 Runner 仍未通过健康检查')
    ElMessage.success(result.status === 'already-running' ? 'Runner 已经在线' : 'Runner 已启动')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : 'Runner 启动失败')
    await refreshStatus()
  } finally {
    starting.value = false
  }
}

onMounted(() => {
  void refreshStatus()
  refreshTimer = window.setInterval(() => void refreshStatus(), 5_000)
})

onBeforeUnmount(() => {
  if (refreshTimer !== null) window.clearInterval(refreshTimer)
})
</script>

<template>
  <div class="system-settings">
    <header class="page-heading">
      <div>
        <p>系统设置</p>
        <h1>Runner 管理</h1>
        <span>本地执行服务</span>
      </div>
    </header>

    <section class="runner-control" aria-labelledby="runner-control-title">
      <div class="runner-control__identity">
        <span class="runner-control__icon"><el-icon :size="27"><Connection /></el-icon></span>
        <div>
          <h2 id="runner-control-title">Playwright Runner</h2>
          <p>127.0.0.1:4310</p>
        </div>
      </div>

      <span class="runner-status" :class="`runner-status--${runner?.status ?? 'offline'}`">
        <i />{{ statusLabel }}
      </span>

      <dl class="runner-details">
        <div>
          <dt>健康检查</dt>
          <dd>{{ runner?.endpoint ?? 'http://127.0.0.1:4310/health' }}</dd>
        </div>
        <div>
          <dt>最近检查</dt>
          <dd>{{ checkedAt }}</dd>
        </div>
      </dl>

      <el-button
        type="primary"
        size="large"
        :icon="VideoPlay"
        :loading="starting"
        :disabled="checking || runner?.status === 'online'"
        @click="startRunner"
      >
        {{ buttonLabel }}
      </el-button>
    </section>
  </div>
</template>

<style scoped>
.system-settings {
  min-width: 0;
  color: var(--color-text-primary, #1f2a44);
  background: var(--color-bg-page, #f3f6fb);
}

.page-heading {
  margin-bottom: 18px;
}

.page-heading p,
.page-heading h1,
.page-heading span {
  margin: 0;
}

.page-heading p {
  margin-bottom: 4px;
  color: var(--color-primary, #2563eb);
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
}

.page-heading h1 {
  color: var(--color-text-primary, #1f2a44);
  font-size: 22px;
  font-weight: 650;
  line-height: 30px;
}

.page-heading span {
  display: block;
  margin-top: 4px;
  color: var(--color-text-secondary, #64748b);
  font-size: 13px;
  line-height: 20px;
}

.runner-control {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) auto minmax(380px, 1.45fr) auto;
  align-items: center;
  gap: 24px;
  min-height: 108px;
  padding: 20px;
  border: 1px solid var(--color-border, #e5ebf3);
  border-radius: var(--radius-card, 6px);
  background: var(--color-surface, #fff);
  box-shadow: var(--shadow-card, 0 2px 10px rgb(31 42 68 / 5%));
}

.runner-control__identity {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
}

.runner-control__icon {
  display: grid;
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  place-items: center;
  color: var(--color-primary, #2563eb);
  border-radius: 6px;
  background: var(--color-primary-soft, #eff6ff);
}

.runner-control__icon :deep(.el-icon) {
  font-size: 22px !important;
}

.runner-control h2,
.runner-control p {
  margin: 0;
}

.runner-control h2 {
  color: var(--color-text-primary, #1f2a44);
  font-size: 15px;
  font-weight: 650;
  line-height: 22px;
}

.runner-control p {
  margin-top: 2px;
  color: var(--color-text-muted, #94a3b8);
  font-size: 12px;
  line-height: 18px;
}

.runner-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  justify-self: start;
  padding: 4px 8px;
  color: var(--color-danger, #dc2626);
  border: 1px solid #fecaca;
  border-radius: 4px;
  background: #fef2f2;
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
  white-space: nowrap;
}

.runner-status i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
}

.runner-status--online {
  color: var(--color-success, #16a34a);
  border-color: #bbf7d0;
  background: #f0fdf4;
}

.runner-details {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(220px, 1fr) minmax(170px, auto);
  gap: 18px;
  margin: 0;
}

.runner-details div {
  min-width: 0;
  padding-left: 18px;
  border-left: 1px solid var(--color-border-light, #eef2f7);
}

.runner-details dt {
  margin-bottom: 3px;
  color: var(--color-text-muted, #94a3b8);
  font-size: 11px;
  line-height: 16px;
}

.runner-details dd {
  overflow: hidden;
  margin: 0;
  color: var(--color-text-secondary, #64748b);
  font-size: 12px;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.runner-control :deep(.el-button) {
  min-width: 136px;
  height: 36px;
  padding: 0 16px;
  border-radius: 5px;
  font-size: 13px;
}

.runner-control :deep(.el-button--primary) {
  border-color: var(--color-primary, #2563eb);
  background: var(--color-primary, #2563eb);
}

.runner-control :deep(.el-button--primary:not(.is-disabled):hover) {
  border-color: var(--color-primary-hover, #1d4ed8);
  background: var(--color-primary-hover, #1d4ed8);
}

.runner-control :deep(.el-button.is-disabled) {
  color: var(--color-text-muted, #94a3b8);
  border-color: var(--color-border, #e5ebf3);
  background: var(--color-bg-subtle, #f8fafc);
}

@media (max-width: 1280px) {
  .runner-control {
    grid-template-columns: minmax(240px, 1fr) auto;
    gap: 18px 24px;
  }

  .runner-details {
    grid-column: 1;
    grid-row: 2;
  }

  .runner-control :deep(.el-button) {
    grid-column: 2;
    grid-row: 2;
    align-self: end;
  }
}

@media (max-width: 700px) {
  .runner-control {
    grid-template-columns: 1fr;
    gap: 16px;
    padding: 18px 16px;
  }

  .runner-details {
    grid-column: auto;
    grid-row: auto;
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .runner-details div {
    padding-top: 10px;
    padding-left: 0;
    border-top: 1px solid var(--color-border-light, #eef2f7);
    border-left: 0;
  }

  .runner-control :deep(.el-button) {
    grid-column: auto;
    grid-row: auto;
    width: 100%;
  }
}
</style>
