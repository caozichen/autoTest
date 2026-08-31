<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { CircleClose } from '@element-plus/icons-vue'

import { segmentScriptRequestPath } from '@/domain/script-request-url'

const props = withDefaults(defineProps<{
  modelValue?: string
  prepend?: string
  placeholder?: string
  ariaLabel?: string
  clearable?: boolean
}>(), {
  modelValue: '',
  prepend: '',
  placeholder: '',
  ariaLabel: '输入内容',
  clearable: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  blur: [event: FocusEvent]
  focus: [event: FocusEvent]
}>()

const inputRef = ref<HTMLInputElement>()
const focused = ref(false)
const scrollLeft = ref(0)
const segments = computed(() => segmentScriptRequestPath(props.modelValue))

watch(() => props.modelValue, async () => {
  await nextTick()
  scrollLeft.value = inputRef.value?.scrollLeft ?? 0
})

function updateValue(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}

function syncScroll(event: Event): void {
  scrollLeft.value = (event.target as HTMLInputElement).scrollLeft
}

function handleFocus(event: FocusEvent): void {
  focused.value = true
  emit('focus', event)
}

function handleBlur(event: FocusEvent): void {
  focused.value = false
  emit('blur', event)
}

function clearValue(): void {
  emit('update:modelValue', '')
  scrollLeft.value = 0
  requestAnimationFrame(() => inputRef.value?.focus())
}
</script>

<template>
  <div class="template-variable-input" :class="{ 'is-focused': focused }">
    <span v-if="prepend" class="template-variable-input__prepend" :title="prepend">
      {{ prepend }}
    </span>
    <div class="template-variable-input__editor">
      <div class="template-variable-input__viewport" aria-hidden="true">
        <div
          class="template-variable-input__highlight"
          :style="{ transform: `translateX(${-scrollLeft}px)` }"
        >
          <span
            v-for="(segment, index) in segments"
            :key="`${index}-${segment.text}`"
            :class="{ 'is-variable': segment.variable }"
          >{{ segment.text }}</span>
        </div>
      </div>
      <input
        ref="inputRef"
        class="template-variable-input__control"
        type="text"
        :value="modelValue"
        :placeholder="placeholder"
        :aria-label="ariaLabel"
        autocomplete="off"
        spellcheck="false"
        @input="updateValue"
        @scroll="syncScroll"
        @focus="handleFocus"
        @blur="handleBlur"
      >
      <button
        v-if="clearable && modelValue"
        class="template-variable-input__clear"
        type="button"
        aria-label="清空 URL 路径"
        title="清空 URL 路径"
        @mousedown.prevent
        @click="clearValue"
      >
        <el-icon><CircleClose /></el-icon>
      </button>
    </div>
  </div>
</template>

<style scoped>
.template-variable-input {
  --template-input-border: var(--color-border, #dcdfe6);
  display: flex;
  width: 100%;
  min-width: 0;
  color: var(--color-text-primary, #1f2a44);
  font-size: var(--font-md, 14px);
}

.template-variable-input__prepend {
  display: inline-flex;
  max-width: 48%;
  min-height: 32px;
  align-items: center;
  flex: 0 1 auto;
  overflow: hidden;
  padding: 0 20px;
  border-radius: 6px 0 0 6px;
  background: var(--el-fill-color-light, #f5f7fa);
  box-shadow: 1px 0 0 0 var(--template-input-border) inset,
    0 1px 0 0 var(--template-input-border) inset,
    0 -1px 0 0 var(--template-input-border) inset;
  color: var(--el-text-color-regular, #606266);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-variable-input__editor {
  position: relative;
  min-width: 0;
  min-height: 32px;
  flex: 1;
  overflow: hidden;
  border-radius: 0 6px 6px 0;
  background: var(--color-surface, #fff);
  box-shadow: 0 0 0 1px var(--template-input-border) inset;
  transition: box-shadow var(--el-transition-duration-fast, 0.2s) cubic-bezier(0.645, 0.045, 0.355, 1);
}

.template-variable-input:hover .template-variable-input__editor {
  box-shadow: 0 0 0 1px #bac7da inset;
}

.template-variable-input.is-focused .template-variable-input__editor {
  box-shadow: 0 0 0 1px var(--color-primary, #2563eb) inset;
}

.template-variable-input__viewport {
  position: absolute;
  z-index: 0;
  inset: 0 30px 0 11px;
  display: flex;
  align-items: center;
  overflow: hidden;
  pointer-events: none;
}

.template-variable-input__highlight {
  flex: none;
  color: var(--color-text-primary, #1f2a44);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: inherit;
  line-height: 1;
  white-space: pre;
  will-change: transform;
}

.template-variable-input__highlight .is-variable {
  color: var(--color-primary, #2563eb);
  font-weight: 700;
}

.template-variable-input__control {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 32px;
  margin: 0;
  padding: 1px 30px 1px 11px;
  border: 0;
  outline: 0;
  background: transparent;
  caret-color: var(--color-text-primary, #1f2a44);
  color: transparent;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: inherit;
  font-weight: 700;
  line-height: 30px;
  -webkit-text-fill-color: transparent;
}

.template-variable-input__control::placeholder {
  color: var(--color-text-muted, #a8abb2);
  font-family: inherit;
  font-weight: 400;
  -webkit-text-fill-color: var(--color-text-muted, #a8abb2);
}

.template-variable-input__control::selection {
  background: rgb(37 99 235 / 20%);
}

.template-variable-input__clear {
  position: absolute;
  z-index: 2;
  top: 0;
  right: 5px;
  display: inline-flex;
  width: 24px;
  height: 32px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-text-muted, #a8abb2);
  cursor: pointer;
}

.template-variable-input__clear:hover,
.template-variable-input__clear:focus-visible {
  color: var(--color-text-secondary, #64748b);
}

:global(.el-form-item.is-error) .template-variable-input__editor {
  box-shadow: 0 0 0 1px var(--el-color-danger, #f56c6c) inset;
}

@media (max-width: 700px) {
  .template-variable-input__prepend {
    display: none;
  }

  .template-variable-input__editor {
    border-radius: 6px;
  }
}
</style>
