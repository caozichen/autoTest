<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'

import type { AutomationScript, ScriptDraft } from '@/domain/script'

const props = defineProps<{
  modelValue: boolean
  script: AutomationScript | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [draft: ScriptDraft]
}>()

const commonTags = ['冒烟', '回归', 'P0', 'API', '权限', '交易']
const formRef = ref<FormInstance>()
const title = computed(() => props.script ? '编辑脚本' : '新增脚本')
const form = reactive<ScriptDraft>({
  name: '',
  description: '',
  directory: '',
  entryFile: '',
  tags: [],
  enabled: true,
})

const rules: FormRules<ScriptDraft> = {
  name: [
    { required: true, message: '请输入脚本名称', trigger: 'blur' },
    { min: 2, max: 40, message: '名称长度应为 2 到 40 个字符', trigger: 'blur' },
  ],
  description: [{ required: true, message: '请输入脚本简介', trigger: 'blur' }],
  directory: [{ required: true, message: '请输入项目目录', trigger: 'blur' }],
  entryFile: [{ required: true, message: '请输入入口文件', trigger: 'blur' }],
}

watch(
  () => [props.modelValue, props.script] as const,
  ([visible, script]) => {
    if (!visible) return
    form.name = script?.name ?? ''
    form.description = script?.description ?? ''
    form.directory = script?.directory ?? ''
    form.entryFile = script?.entryFile ?? ''
    form.tags = [...(script?.tags ?? [])]
    form.enabled = script?.status !== 'disabled'
    formRef.value?.clearValidate()
  },
  { immediate: true },
)

async function submit(): Promise<void> {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  emit('save', { ...form, tags: [...form.tags] })
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="title"
    width="700px"
    class="script-dialog"
    destroy-on-close
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
      <div class="form-grid">
        <el-form-item label="脚本名称" prop="name">
          <el-input v-model="form.name" maxlength="40" show-word-limit placeholder="请输入脚本名称" />
        </el-form-item>
        <el-form-item label="运行状态">
          <div class="enable-field">
            <el-switch v-model="form.enabled" />
            <span>{{ form.enabled ? '启用' : '停用' }}</span>
          </div>
        </el-form-item>
      </div>

      <el-form-item label="脚本简介" prop="description">
        <el-input v-model="form.description" type="textarea" :rows="3" maxlength="160" show-word-limit placeholder="简要描述脚本覆盖的业务场景" />
      </el-form-item>

      <el-form-item label="项目目录" prop="directory">
        <el-input v-model="form.directory" placeholder="D:\automation-tests\project-name" />
      </el-form-item>

      <el-form-item label="入口文件" prop="entryFile">
        <el-input v-model="form.entryFile" placeholder="请输入入口文件路径" />
      </el-form-item>

      <el-form-item label="标签">
        <el-select v-model="form.tags" multiple filterable allow-create default-first-option placeholder="选择或输入标签">
          <el-option v-for="tag in commonTags" :key="tag" :label="tag" :value="tag" />
        </el-select>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" @click="submit">保存脚本</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.form-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 150px;
  gap: 18px;
}

.enable-field {
  display: flex;
  min-height: 42px;
  align-items: center;
  gap: 9px;
  color: #637078;
  font-size: var(--font-md);
}

:deep(.el-select) {
  width: 100%;
}

@media (max-width: 620px) {
  .form-grid {
    grid-template-columns: 1fr;
    gap: 0;
  }
}
</style>

<style>
.script-dialog {
  max-width: calc(100vw - 28px);
  max-height: calc(100dvh - 32px);
  display: flex;
  flex-direction: column;
  margin: 16px auto;
  border-radius: 7px;
}

.script-dialog .el-dialog__body {
  min-height: 0;
  overflow-y: auto;
}
</style>
