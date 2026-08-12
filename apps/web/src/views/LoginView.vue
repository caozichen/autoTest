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
    <section class="login-visual" aria-label="AutoTest 本地工作区">
      <div class="login-visual__grid" />
      <div class="visual-content">
        <div class="visual-brand">
          <span class="visual-brand__mark"><el-icon :size="24"><Monitor /></el-icon></span>
          <span>AutoTest</span>
        </div>
        <div class="visual-copy">
          <p class="visual-copy__eyebrow">PLAYWRIGHT CONTROL CENTER</p>
          <h1>稳定运行每一次测试</h1>
          <p>统一管理本地脚本、运行状态与断言结果。</p>
        </div>
        <div class="system-board">
          <div class="system-board__head">
            <strong>本地工作区</strong>
            <span>LOCAL</span>
          </div>
          <div class="system-board__metrics">
            <div><span>浏览器</span><strong>Chromium</strong></div>
            <div><span>脚本来源</span><strong>本地文件</strong></div>
            <div><span>数据存储</span><strong>浏览器本地</strong></div>
          </div>
        </div>
      </div>
      <p class="visual-footer">LOCAL AUTOMATION WORKSPACE</p>
    </section>

    <section class="login-form-panel">
      <div class="login-form-wrap">
        <div class="mobile-brand">
          <span><el-icon :size="20"><Monitor /></el-icon></span>
          AutoTest
        </div>
        <header class="login-header">
          <p>欢迎回来</p>
          <h2>登录测试平台</h2>
          <span>使用管理员账号进入工作台</span>
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

        <div class="local-account">
          <span>本地账号</span>
          <code>admin</code>
          <i>/</i>
          <code>admin123</code>
        </div>
      </div>
      <footer>AutoTest Platform · Local Mode</footer>
    </section>
  </main>
</template>

<style scoped>
.login-page {
  display: grid;
  min-height: 100dvh;
  grid-template-columns: minmax(430px, 0.92fr) minmax(520px, 1.08fr);
  background: #fff;
}

.login-visual {
  position: relative;
  display: flex;
  min-height: 100dvh;
  overflow: hidden;
  align-items: center;
  padding: 64px clamp(42px, 5vw, 86px);
  color: #fff;
  background: #101820;
}

.login-visual__grid {
  position: absolute;
  inset: 0;
  opacity: 0.14;
  background-image:
    linear-gradient(rgb(131 241 222 / 28%) 1px, transparent 1px),
    linear-gradient(90deg, rgb(131 241 222 / 28%) 1px, transparent 1px);
  background-size: 42px 42px;
  mask-image: linear-gradient(to bottom, #000, transparent 88%);
}

.visual-content {
  position: relative;
  z-index: 1;
  width: min(100%, 720px);
}

.visual-brand,
.mobile-brand {
  display: flex;
  align-items: center;
  gap: 11px;
  font-size: var(--font-brand);
  font-weight: 700;
}

.visual-brand {
  position: static;
  margin-bottom: 72px;
}

.visual-brand__mark,
.mobile-brand span {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  color: #09201c;
  border-radius: 6px;
  background: #2ed8c0;
}

.visual-copy__eyebrow {
  margin: 0 0 14px;
  color: #5be0cd;
  font-size: var(--font-sm);
  font-weight: 700;
}

.visual-copy h1 {
  max-width: 480px;
  margin: 0;
  font-size: var(--font-hero);
  font-weight: 650;
  line-height: 1.18;
}

.visual-copy > p:last-child {
  margin: 20px 0 0;
  color: #9dabb4;
  font-size: var(--font-lg);
  line-height: 1.8;
}

.system-board {
  margin-top: 42px;
  padding: 22px;
  border: 1px solid rgb(125 237 218 / 18%);
  border-radius: 7px;
  background: rgb(25 38 48 / 88%);
  box-shadow: 0 22px 60px rgb(0 0 0 / 18%);
}

.system-board__head,
.system-board__metrics {
  display: flex;
  align-items: center;
}

.system-board__head {
  justify-content: space-between;
  padding-bottom: 18px;
  border-bottom: 1px solid rgb(255 255 255 / 8%);
}

.system-board__head strong {
  font-size: var(--font-md);
}

.system-board__head > span {
  padding: 4px 7px;
  color: #68decf;
  border: 1px solid rgb(104 222 207 / 24%);
  border-radius: 3px;
  font-size: var(--font-caption);
}

.system-board__metrics {
  justify-content: space-between;
  gap: 24px;
  padding-top: 22px;
}

.system-board__metrics div {
  min-width: 0;
}

.system-board__metrics span,
.system-board__metrics strong {
  display: block;
}

.system-board__metrics span {
  color: #74848e;
  font-size: var(--font-xs);
}

.system-board__metrics strong {
  margin-top: 7px;
  color: #edf8f6;
  font-size: var(--font-lg);
}

.visual-footer {
  position: absolute;
  bottom: 32px;
  left: clamp(42px, 5vw, 86px);
  margin: 0;
  color: #566671;
  font-size: var(--font-caption);
}

.login-form-panel {
  display: flex;
  min-height: 100dvh;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 40px 28px;
  background: #fbfcfc;
}

.login-form-wrap {
  width: min(100%, 520px);
}

.mobile-brand {
  display: none;
  margin-bottom: 46px;
  color: #172229;
}

.mobile-brand span {
  width: 34px;
  height: 34px;
}

.login-header {
  margin-bottom: 32px;
}

.login-header p {
  margin: 0 0 8px;
  color: #159f8f;
  font-size: var(--font-base);
  font-weight: 600;
}

.login-header h2 {
  margin: 0;
  color: #172229;
  font-size: var(--font-display);
  font-weight: 700;
}

.login-header span {
  display: block;
  margin-top: 12px;
  color: #89959c;
  font-size: var(--font-base);
}

.login-button {
  width: 100%;
  height: 52px;
  margin-top: 8px;
  border-color: #149f90;
  border-radius: 5px;
  background: #149f90;
  font-weight: 600;
}

.login-button:hover,
.login-button:focus {
  border-color: #118a7d;
  background: #118a7d;
}

.local-account {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 24px;
  padding: 10px;
  color: #8a969c;
  border: 1px dashed #d9e1e4;
  border-radius: 5px;
  background: #f6f9f9;
  font-size: var(--font-sm);
}

.local-account code {
  color: #425159;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.local-account i {
  color: #c0c8cc;
  font-style: normal;
}

.login-form-panel footer {
  margin-top: auto;
  padding-top: 50px;
  color: #b0b9be;
  font-size: var(--font-xs);
}

:deep(.el-form-item) {
  margin-bottom: 22px;
}

:deep(.el-form-item__label) {
  color: #445159;
  font-size: var(--font-md);
  font-weight: 600;
}

:deep(.el-input__wrapper) {
  min-height: 50px;
  border-radius: 5px;
  box-shadow: 0 0 0 1px #dce3e6 inset;
}

:deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px #16a796 inset;
}

@media (max-width: 1200px) {
  .login-page {
    grid-template-columns: minmax(360px, 0.8fr) minmax(440px, 1fr);
  }

  .login-visual {
    padding-inline: 38px;
  }

  .visual-brand {
    margin-bottom: 52px;
  }
}

@media (min-width: 761px) and (max-height: 800px) {
  .login-visual {
    align-items: flex-start;
    padding-block: 28px;
  }

  .visual-brand {
    margin-bottom: 26px;
  }

  .visual-copy > p:last-child {
    margin-top: 14px;
    line-height: 1.6;
  }

  .system-board {
    margin-top: 24px;
    padding: 16px;
  }

  .system-board__head {
    padding-bottom: 12px;
  }

  .system-board__metrics {
    padding: 14px 0;
  }

  .visual-footer,
  .login-form-panel footer {
    display: none;
  }

  .login-form-panel {
    padding-block: 28px;
  }

  .login-header {
    margin-bottom: 20px;
  }

  .local-account {
    margin-top: 14px;
  }

  :deep(.el-form-item) {
    margin-bottom: 16px;
  }
}

@media (max-width: 760px) {
  .login-page {
    display: block;
  }

  .login-visual {
    display: none;
  }

  .login-form-panel {
    padding: 36px 24px 24px;
  }

  .mobile-brand {
    display: flex;
  }
}
</style>
