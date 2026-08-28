<script setup lang="ts">
import { reactive, ref } from 'vue'
import { Lock, Monitor, User } from '@element-plus/icons-vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { useRoute, useRouter } from 'vue-router'

import { AuthenticationError } from '@/domain/auth'
import { useAuthStore } from '@/stores/auth'

interface LoginForm {
  username: string
  password: string
}

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const formRef = ref<FormInstance>()
const submitting = ref(false)
const form = reactive<LoginForm>({ username: 'admin', password: '' })
const rules: FormRules<LoginForm> = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码至少 6 位', trigger: 'blur' },
  ],
}

async function submit(): Promise<void> {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid || submitting.value) return

  submitting.value = true
  try {
    await auth.login(form)
    const redirect = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/')
      ? route.query.redirect
      : '/'
    await router.replace(redirect)
  } catch (error) {
    const message = error instanceof AuthenticationError ? error.message : '登录失败，请稍后重试'
    ElMessage.error(message)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="login-page">
    <section class="login-card" aria-labelledby="login-title">
      <div class="login-brand">
        <div class="login-brand__identity">
          <span class="login-brand__mark"><el-icon :size="22"><Monitor /></el-icon></span>
          <div>
            <strong>AutoTest</strong>
            <span>自动化测试平台</span>
          </div>
        </div>
        <span class="login-brand__mode">本地模式</span>
      </div>

      <header class="login-header">
        <h1 id="login-title">登录系统</h1>
        <p>请输入管理员账号和密码进入工作台</p>
      </header>

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" size="large" @submit.prevent="submit">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" :prefix-icon="User" autocomplete="username" placeholder="请输入用户名" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="form.password" type="password" :prefix-icon="Lock" autocomplete="current-password" placeholder="请输入密码" show-password @keyup.enter="submit" />
        </el-form-item>
        <el-button class="login-button" type="primary" native-type="submit" :loading="submitting">登录平台</el-button>
      </el-form>

      <div class="local-account" aria-label="本地默认账号">
        <span>本地默认账号</span>
        <div>
          <span>用户名 <code>admin</code></span>
          <i />
          <span>密码 <code>admin123</code></span>
        </div>
      </div>
    </section>

    <footer>AutoTest Platform · Local Workspace</footer>
  </main>
</template>

<style scoped>
.login-page {
  --login-primary: var(--color-primary, #2563eb);
  --login-primary-hover: var(--color-primary-hover, #1d4ed8);
  --login-primary-soft: var(--color-primary-soft, #eff6ff);
  --login-text: var(--color-text-primary, #1f2a44);
  --login-text-secondary: var(--color-text-secondary, #64748b);
  --login-text-muted: var(--color-text-muted, #94a3b8);
  --login-border: var(--color-border, #e5ebf3);
  --login-border-light: var(--color-border-light, #edf1f7);
  --login-surface: var(--color-surface, #fff);
  --login-bg: var(--color-bg-page, #f5f7fb);
  --login-bg-subtle: var(--color-bg-subtle, #f8fafc);

  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  min-height: 100dvh;
  padding: clamp(32px, 7vh, 72px) 20px 24px;
  color: var(--login-text);
  background-color: #091423;
  background-image: url('/assets/login-cityscape.png');
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
}

.login-card {
  width: min(100%, 440px);
  place-self: center;
  padding: 32px 36px 30px;
  border: 1px solid var(--login-border);
  border-top: 3px solid var(--login-primary);
  border-radius: var(--radius-card, 8px);
  background: var(--login-surface);
  box-shadow: 0 18px 52px rgb(0 0 0 / 32%);
}

.login-brand,
.login-brand__identity {
  display: flex;
  align-items: center;
}

.login-brand {
  justify-content: space-between;
  gap: 18px;
}

.login-brand__identity {
  min-width: 0;
  gap: 11px;
}

.login-brand__mark {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  flex: 0 0 auto;
  color: #fff;
  border-radius: 6px;
  background: var(--login-primary);
}

.login-brand__identity > div {
  min-width: 0;
}

.login-brand__identity strong,
.login-brand__identity span {
  display: block;
}

.login-brand__identity strong {
  color: var(--login-text);
  font-size: var(--font-lg);
  font-weight: 700;
  line-height: 1.3;
}

.login-brand__identity span {
  margin-top: 2px;
  color: var(--login-text-muted);
  font-size: var(--font-xs);
}

.login-brand__mode {
  flex: 0 0 auto;
  padding: 3px 7px;
  color: var(--login-primary);
  border: 1px solid #bfdbfe;
  border-radius: 4px;
  background: var(--login-primary-soft);
  font-size: var(--font-xs);
  font-weight: 600;
}

.login-header {
  margin: 30px 0 26px;
}

.login-header h1 {
  margin: 0;
  color: var(--login-text);
  font-size: var(--font-subtitle);
  font-weight: 700;
  line-height: 1.35;
}

.login-header p {
  margin: 8px 0 0;
  color: var(--login-text-secondary);
  font-size: var(--font-sm);
}

.login-button {
  width: 100%;
  height: 44px;
  margin-top: 4px;
  border-color: var(--login-primary);
  border-radius: 5px;
  background: var(--login-primary);
  font-weight: 600;
}

.login-button:hover,
.login-button:focus {
  border-color: var(--login-primary-hover);
  background: var(--login-primary-hover);
}

.local-account {
  margin-top: 22px;
  padding-top: 18px;
  color: var(--login-text-muted);
  border-top: 1px solid var(--login-border-light);
  font-size: var(--font-xs);
}

.local-account > span {
  display: block;
  margin-bottom: 8px;
}

.local-account > div {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--login-text-secondary);
}

.local-account code {
  margin-left: 3px;
  color: var(--login-text);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: var(--font-sm);
  font-weight: 600;
}

.local-account i {
  width: 1px;
  height: 12px;
  background: var(--login-border);
}

.login-page > footer {
  justify-self: center;
  margin-top: 28px;
  color: rgb(255 255 255 / 74%);
  font-size: var(--font-xs);
  text-align: center;
  text-shadow: 0 1px 2px rgb(0 0 0 / 45%);
}

:deep(.el-form-item) {
  margin-bottom: 20px;
}

:deep(.el-form-item__label) {
  height: auto;
  padding-bottom: 7px;
  color: var(--login-text);
  font-size: var(--font-sm);
  font-weight: 600;
  line-height: 1.4;
}

:deep(.el-input__wrapper) {
  min-height: 44px;
  padding-inline: 13px;
  border-radius: 5px;
  background: var(--login-surface);
  box-shadow: 0 0 0 1px var(--login-border) inset;
}

:deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px #cbd5e1 inset;
}

:deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px var(--login-primary) inset;
}

:deep(.el-input__inner) {
  color: var(--login-text);
  font-size: var(--font-sm);
}

:deep(.el-input__inner::placeholder) {
  color: var(--login-text-muted);
}

:deep(.el-input__prefix),
:deep(.el-input__password) {
  color: var(--login-text-muted);
}

@media (max-height: 650px) and (min-width: 481px) {
  .login-page {
    padding-block: 16px;
  }

  .login-card {
    padding-block: 24px;
  }

  .login-header {
    margin: 22px 0 20px;
  }

  .local-account {
    margin-top: 16px;
    padding-top: 14px;
  }

  :deep(.el-form-item) {
    margin-bottom: 16px;
  }
}

@media (max-width: 480px) {
  .login-page {
    padding: 20px 0 18px;
  }

  .login-card {
    width: 100%;
    padding: 28px 24px;
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }

  .login-header {
    margin-top: 28px;
  }

  .login-page > footer {
    margin: 12px 24px 0;
  }
}
</style>
