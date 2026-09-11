<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElCollapse, ElCollapseItem, ElMessage } from 'element-plus'
import type { TestEnvironment } from '@/domain/environment'
import { services } from '@/services/container'
import type { EnvironmentSession } from '@/services/environments/local-environment-session.service'

const props = defineProps<{ modelValue: boolean; environment: TestEnvironment | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; changed: [] }>()
const token = ref('')
const accountLabel = ref('')
const expiresAt = ref('')
const saved = ref<EnvironmentSession | null>(null)
const status = computed(() => !saved.value ? '尚未导入匹配的登录态'
  : saved.value.expiresAt !== null && saved.value.expiresAt <= Date.now() ? '已过期，请更新'
    : '已保存，实际有效性以服务器校验为准')

watch(() => [props.modelValue, props.environment] as const, ([visible, environment]) => {
  token.value = ''
  if (!visible || !environment) {
    saved.value = null
    return
  }
  saved.value = services.environmentSessions.get(environment)
  token.value = saved.value ? `${saved.value.scheme} ${saved.value.token}` : ''
  accountLabel.value = saved.value?.accountLabel ?? ''
  expiresAt.value = ''
}, { immediate: true })

function save(): void {
  if (!props.environment) return
  try {
    services.environmentSessions.save(props.environment, {
      token: token.value,
      accountLabel: accountLabel.value,
      expiresAt: expiresAt.value ? new Date(expiresAt.value).getTime() : null,
    })
    token.value = ''
    emit('changed')
    emit('update:modelValue', false)
    ElMessage.success('登录态已保存，后续运行将复用；未向目标网站提交登录请求')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '登录态保存失败')
  }
}

function clear(): void {
  if (!props.environment) return
  try {
    services.environmentSessions.clear(props.environment.id)
    saved.value = null
    token.value = ''
    accountLabel.value = ''
    expiresAt.value = ''
    emit('changed')
    ElMessage.success('保存的登录态已清除，下次运行需要重新导入；正在执行的任务不受影响')
  } catch {
    ElMessage.error('登录态清除失败，请检查浏览器本地存储权限')
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue" :title="`管理登录态 · ${environment?.name ?? ''}`"
    width="640px" destroy-on-close class="environment-session-dialog"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template v-if="environment">
      <el-alert :title="status" :type="saved ? 'info' : 'warning'" :closable="false" />
      <p class="session-target">绑定网站：{{ environment.baseUrl }}<br>绑定 API：{{ environment.apiBaseUrl }}</p>
      <p v-if="saved" class="session-details">
        账号备注：{{ saved.accountLabel || '未填写' }} · 保存于 {{ new Date(saved.savedAt).toLocaleString() }}<br>
        失效时间：{{ saved.expiresAt === null ? '未知，服务端可能提前使其失效' : new Date(saved.expiresAt).toLocaleString() }}
      </p>
      <el-collapse>
        <el-collapse-item title="如何从已登录的浏览器获取 Token？" name="help">
          <ol>
            <li>在上方绑定的网站手动完成登录和验证码。</li>
            <li>打开浏览器开发者工具 → Application（应用）→ Local Storage（本地存储），选择该网站，复制 token 对应的值。</li>
            <li>也可在 Network（网络）中选择一个成功的后台业务请求，复制 Request Headers 中 Authorization 的完整值。</li>
            <li>将值粘贴到下方保存。请确认是当前环境和希望运行脚本的账号。</li>
          </ol>
          <p>本功能复用 Token，不会接管已有标签页。仅依赖 Cookie 的网站暂不适用。</p>
        </el-collapse-item>
      </el-collapse>
      <el-form label-position="top" @submit.prevent="save">
        <el-form-item :label="saved ? 'Token（可直接修改）' : '已有登录态 Token'" required>
          <el-input v-model="token" type="text" autocomplete="off" :spellcheck="false" aria-label="已有登录态 Token" placeholder="Token 或 Bearer 开头的完整 Authorization 值" />
        </el-form-item>
        <el-form-item label="账号备注（用于区分账号，不参与登录）">
          <el-input v-model="accountLabel" maxlength="80" placeholder="例如：生产测试账号" />
        </el-form-item>
        <el-form-item label="失效时间（可选）">
          <el-input v-model="expiresAt" type="datetime-local" aria-label="失效时间" />
        </el-form-item>
      </el-form>
      <p class="session-details">Token 保存在当前浏览器的本地存储中，不是加密保险箱；不会明文写入运行日志。JWT 自带的过期时间优先于更晚的手动时间。</p>
      <p class="session-details">如脚本提示未登录、Token 失效或 HTTP 401，请重新手动登录并更新此处的 Token。</p>
    </template>
    <template #footer>
      <el-button v-if="saved" type="danger" plain @click="clear">清除登录态</el-button>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :disabled="!token.trim()" @click="save">保存登录态</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.session-target { overflow-wrap: anywhere; line-height: 1.7; }
.session-details { color: var(--color-text-secondary, #64748b); font-size: 13px; line-height: 1.7; }
ol { padding-left: 20px; line-height: 1.8; }
.el-collapse { margin-bottom: 18px; }
</style>
