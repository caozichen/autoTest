<script setup lang="ts">
import { computed } from 'vue'
import { CircleCheck, CircleClose, Clock, Document, VideoPause } from '@element-plus/icons-vue'

import type { AutomationScript, ScriptLogLevel } from '@/domain/script'

const props = defineProps<{
  modelValue: boolean
  script: AutomationScript | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const result = computed(() => props.script?.lastRunResult ?? null)
const isRunning = computed(() => props.script?.status === 'running')
const isInterrupted = computed(() => props.script?.status === 'interrupted' || result.value?.cancelled === true)

const logTypeMap: Record<ScriptLogLevel, 'success' | 'warning' | 'danger' | 'info'> = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  error: 'danger',
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime())
    ? timestamp
    : date.toLocaleTimeString('zh-CN', { hour12: false })
}

function formatDetails(details?: Record<string, unknown>): string {
  return details ? JSON.stringify(details, null, 2) : ''
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="脚本运行结果"
    width="820px"
    class="script-result-dialog"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="script && result" class="run-result">
      <header :class="['result-summary', isRunning ? 'result-summary--running' : isInterrupted ? 'result-summary--interrupted' : result.ok ? 'result-summary--passed' : 'result-summary--failed']">
        <el-icon :size="28"><Clock v-if="isRunning" /><VideoPause v-else-if="isInterrupted" /><CircleCheck v-else-if="result.ok" /><CircleClose v-else /></el-icon>
        <div>
          <strong>{{ isRunning ? '执行中' : isInterrupted ? '已强制停止' : result.ok ? '执行通过' : '执行失败' }}</strong>
          <span>{{ script.name }}</span>
        </div>
        <p><el-icon><Clock /></el-icon>{{ result.durationMs }} ms</p>
      </header>

      <section v-if="result.output" class="result-output">
        <div><span>表单名称</span><strong>{{ result.output.title ?? '-' }}</strong></div>
        <div><span>表单 ID</span><code>{{ result.output.formId ?? '-' }}</code></div>
        <div v-if="result.output.formCode && result.output.formCode !== result.output.formId">
          <span>旧版 Form Code（仅记录）</span><code>{{ result.output.formCode }}</code>
        </div>
        <div><span>最终状态</span><el-tag type="success" size="small">{{ result.output.status ?? '-' }}</el-tag></div>
      </section>

      <section class="run-logs">
        <div class="run-logs__heading"><el-icon><Document /></el-icon><strong>执行日志</strong><span>{{ result.logs.length }} 条</span></div>
        <div class="run-logs__body">
          <div v-for="(log, index) in result.logs" :key="`${log.timestamp}-${index}`" class="log-row">
            <time>{{ formatTime(log.timestamp) }}</time>
            <el-tag :type="logTypeMap[log.level]" size="small" effect="plain">{{ log.level.toUpperCase() }}</el-tag>
            <div>
              <p>{{ log.message }}</p>
              <pre v-if="log.details">{{ formatDetails(log.details) }}</pre>
            </div>
          </div>
        </div>
      </section>
    </div>
    <el-empty v-else description="该脚本暂无运行结果" />

    <template #footer>
      <el-button type="primary" @click="emit('update:modelValue', false)">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.result-summary {
  display: grid;
  grid-template-columns: 38px 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 13px 14px;
  border: 1px solid var(--color-border, #e5ebf3);
  border-left: 4px solid;
  border-radius: 5px;
  background: var(--color-bg-subtle, #f8fafc);
}

.result-summary--passed { color: var(--color-success, #16a34a); border-left-color: var(--color-success, #16a34a); background: #f0fdf4; }
.result-summary--running { color: var(--color-warning, #d97706); border-left-color: var(--color-warning, #d97706); background: #fffbeb; }
.result-summary--interrupted { color: var(--color-text-secondary, #64748b); border-left-color: var(--color-text-muted, #94a3b8); background: var(--color-bg-subtle, #f8fafc); }
.result-summary--failed { color: var(--color-danger, #dc2626); border-left-color: var(--color-danger, #dc2626); background: #fef2f2; }
.result-summary strong, .result-summary span { display: block; }
.result-summary strong { color: var(--color-text-primary, #1f2a44); font-size: var(--font-md); }
.result-summary span { margin-top: 3px; color: var(--color-text-secondary, #64748b); font-size: var(--font-sm); }
.result-summary p { display: flex; align-items: center; gap: 6px; margin: 0; color: var(--color-text-secondary, #64748b); font-size: var(--font-sm); }

.result-output {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(120px, 1fr);
  gap: 1px;
  margin-top: 14px;
  overflow: hidden;
  border: 1px solid var(--color-border, #e5ebf3);
  border-radius: 5px;
  background: var(--color-border, #e5ebf3);
}

.result-output > div { min-width: 0; padding: 9px 11px; background: var(--color-surface, #fff); }
.result-output span, .result-output strong, .result-output code { display: block; }
.result-output span { margin-bottom: 4px; color: var(--color-text-muted, #94a3b8); font-size: var(--font-caption); }
.result-output strong, .result-output code { overflow-wrap: anywhere; color: var(--color-text-primary, #1f2a44); font-size: var(--font-sm); }

.run-logs { margin-top: 16px; }
.run-logs__heading { display: flex; align-items: center; gap: 7px; margin-bottom: 8px; color: var(--color-text-primary, #1f2a44); }
.run-logs__heading .el-icon { color: var(--color-primary, #2563eb); }
.run-logs__heading span { margin-left: auto; color: var(--color-text-muted, #94a3b8); font-size: var(--font-caption); }
.run-logs__body { overflow-y: auto; border: 1px solid var(--color-border, #e5ebf3); border-radius: 5px; background: var(--color-bg-subtle, #f8fafc); }
.log-row { display: grid; grid-template-columns: 72px 66px 1fr; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--color-border-light, #eef2f7); }
.log-row:last-child { border-bottom: 0; }
.log-row time { color: var(--color-text-muted, #94a3b8); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: var(--font-caption); }
.log-row p { margin: 0; color: var(--color-text-primary, #1f2a44); font-size: var(--font-sm); line-height: 1.5; }
.log-row pre { overflow-x: auto; margin: 6px 0 0; padding: 7px 9px; color: var(--color-text-secondary, #64748b); border-radius: 4px; background: var(--color-bg-page, #f6f8fc); font-size: var(--font-caption); white-space: pre-wrap; }

@media (max-width: 640px) {
  .result-summary { grid-template-columns: 32px 1fr; }
  .result-summary p { grid-column: 2; }
  .result-output { grid-template-columns: 1fr; }
  .log-row { grid-template-columns: 64px 1fr; }
  .log-row > div { grid-column: 1 / -1; }
}
</style>

<style>
.script-result-dialog {
  --el-color-primary: var(--color-primary, #2563eb);
  display: flex;
  max-width: calc(100vw - 28px);
  max-height: calc(100vh - 32px);
  max-height: calc(100dvh - 32px);
  flex-direction: column;
  margin: 16px auto;
  overflow: hidden;
  border: 1px solid var(--color-border, #e5ebf3);
  border-radius: min(var(--radius-card, 6px), 8px);
  background: var(--color-surface, #fff);
  box-shadow: var(--shadow-card, 0 10px 30px rgb(15 23 42 / 10%));
}

.script-result-dialog .el-dialog__body {
  min-height: 0;
  overflow-y: auto;
}

.script-result-dialog .el-dialog__header,
.script-result-dialog .el-dialog__footer {
  flex: 0 0 auto;
}

.script-result-dialog .el-dialog__header {
  margin: 0;
  padding: 16px 20px 14px;
  border-bottom: 1px solid var(--color-border-light, #eef2f7);
}

.script-result-dialog .el-dialog__title {
  color: var(--color-text-primary, #1f2a44);
}

.script-result-dialog .el-dialog__body {
  padding: 16px 20px;
}

.script-result-dialog .el-dialog__footer {
  padding: 12px 20px;
  border-top: 1px solid var(--color-border-light, #eef2f7);
  background: var(--color-bg-subtle, #f8fafc);
}
</style>
