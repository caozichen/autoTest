<script setup lang="ts">
import { computed } from 'vue'
import { CircleCheck, CircleClose, Clock, Document } from '@element-plus/icons-vue'

import type { AutomationScript, ScriptLogLevel } from '@/domain/script'

const props = defineProps<{
  modelValue: boolean
  script: AutomationScript | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const result = computed(() => props.script?.lastRunResult ?? null)

const logTypeMap: Record<ScriptLogLevel, 'success' | 'danger' | 'info'> = {
  info: 'info',
  success: 'success',
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
      <header :class="['result-summary', result.ok ? 'result-summary--passed' : 'result-summary--failed']">
        <el-icon :size="28"><CircleCheck v-if="result.ok" /><CircleClose v-else /></el-icon>
        <div>
          <strong>{{ result.ok ? '执行通过' : '执行失败' }}</strong>
          <span>{{ script.name }}</span>
        </div>
        <p><el-icon><Clock /></el-icon>{{ result.durationMs }} ms</p>
      </header>

      <section v-if="result.output" class="result-output">
        <div><span>表单名称</span><strong>{{ result.output.title ?? '-' }}</strong></div>
        <div><span>表单 ID</span><code>{{ result.output.formId ?? '-' }}</code></div>
        <div><span>Form Code</span><code>{{ result.output.formCode ?? '-' }}</code></div>
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
  gap: 12px;
  padding: 16px;
  border-left: 4px solid;
  background: #f4f7f8;
}

.result-summary--passed { color: #137466; border-color: #1aa58f; background: #eef8f5; }
.result-summary--failed { color: #b33d3d; border-color: #d95858; background: #fff3f3; }
.result-summary strong, .result-summary span { display: block; }
.result-summary strong { font-size: 17px; }
.result-summary span { margin-top: 3px; color: #65737a; }
.result-summary p { display: flex; align-items: center; gap: 6px; margin: 0; color: #65737a; }

.result-output {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(120px, 1fr);
  gap: 1px;
  margin-top: 16px;
  overflow: hidden;
  border: 1px solid #e2e9eb;
  background: #e2e9eb;
}

.result-output > div { min-width: 0; padding: 11px 13px; background: #fff; }
.result-output span, .result-output strong, .result-output code { display: block; }
.result-output span { margin-bottom: 5px; color: #849097; font-size: 12px; }
.result-output strong, .result-output code { overflow-wrap: anywhere; color: #26343a; }

.run-logs { margin-top: 18px; }
.run-logs__heading { display: flex; align-items: center; gap: 7px; margin-bottom: 9px; color: #34444b; }
.run-logs__heading span { margin-left: auto; color: #89969c; font-size: 12px; }
.run-logs__body { max-height: 390px; overflow-y: auto; border: 1px solid #dfe6e8; background: #f8fafb; }
.log-row { display: grid; grid-template-columns: 72px 66px 1fr; gap: 9px; padding: 10px 12px; border-bottom: 1px solid #e7ecee; }
.log-row:last-child { border-bottom: 0; }
.log-row time { color: #7e8b91; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; }
.log-row p { margin: 0; color: #34444b; line-height: 1.5; }
.log-row pre { overflow-x: auto; margin: 6px 0 0; padding: 7px 9px; color: #526169; background: #eef2f3; font-size: 12px; white-space: pre-wrap; }

@media (max-width: 640px) {
  .result-summary { grid-template-columns: 32px 1fr; }
  .result-summary p { grid-column: 2; }
  .result-output { grid-template-columns: 1fr; }
  .log-row { grid-template-columns: 64px 1fr; }
  .log-row > div { grid-column: 1 / -1; }
}
</style>

<style>
.script-result-dialog { max-width: calc(100vw - 28px); margin: 16px auto; }
</style>
