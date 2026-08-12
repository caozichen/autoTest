<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowDown, Fold, Menu, SwitchButton } from '@element-plus/icons-vue'
import { useRoute, useRouter } from 'vue-router'

import AppSidebar from '@/components/AppSidebar.vue'
import { services } from '@/services/container'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const sidebarCollapsed = ref(false)
const mobileMenuOpen = ref(false)
const displayName = computed(() => auth.user?.displayName ?? '管理员')
const breadcrumbSection = computed(() => String(route.meta.section ?? '工作台'))
const breadcrumbTitle = computed(() => String(route.meta.title ?? '运行概览'))

async function handleCommand(command: string): Promise<void> {
  if (command !== 'logout') return
  services.runtimeVariables.clear()
  await auth.logout()
  await router.replace({ name: 'login' })
}
</script>

<template>
  <div class="admin-shell">
    <div class="admin-shell__desktop-sidebar">
      <AppSidebar :compact="sidebarCollapsed" />
    </div>

    <el-drawer v-model="mobileMenuOpen" direction="ltr" size="260px" :with-header="false" class="mobile-nav-drawer">
      <AppSidebar />
    </el-drawer>

    <div class="admin-shell__body">
      <header class="topbar">
        <div class="topbar__leading">
          <el-tooltip content="展开导航" placement="bottom">
            <button class="icon-button icon-button--mobile" type="button" aria-label="展开导航" @click="mobileMenuOpen = true">
              <el-icon :size="20"><Menu /></el-icon>
            </button>
          </el-tooltip>
          <el-tooltip :content="sidebarCollapsed ? '展开侧栏' : '收起侧栏'" placement="bottom">
            <button class="icon-button icon-button--desktop" type="button" :aria-label="sidebarCollapsed ? '展开侧栏' : '收起侧栏'" @click="sidebarCollapsed = !sidebarCollapsed">
              <el-icon :size="20"><Fold /></el-icon>
            </button>
          </el-tooltip>
          <span class="topbar__divider" />
          <div class="breadcrumb">
            <span>{{ breadcrumbSection }}</span>
            <strong>{{ breadcrumbTitle }}</strong>
          </div>
        </div>

        <el-dropdown trigger="click" @command="handleCommand">
          <button class="account-button" type="button">
            <span class="account-button__avatar">管</span>
            <span class="account-button__name">{{ displayName }}</span>
            <el-icon><ArrowDown /></el-icon>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="logout" :icon="SwitchButton">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </header>

      <main class="admin-content">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<style scoped>
.admin-shell {
  display: flex;
  min-height: 100dvh;
  background: #f2f5f7;
}

.admin-shell__desktop-sidebar {
  position: sticky;
  top: 0;
  height: 100dvh;
  flex: 0 0 auto;
}

.admin-shell__body {
  min-width: 0;
  flex: 1;
}

.topbar {
  position: sticky;
  z-index: 20;
  top: 0;
  display: flex;
  height: 78px;
  align-items: center;
  justify-content: space-between;
  padding: 0 34px 0 24px;
  border-bottom: 1px solid #e4e9ed;
  background: rgb(255 255 255 / 96%);
  backdrop-filter: blur(10px);
}

.topbar__leading,
.account-button {
  display: flex;
  align-items: center;
}

.topbar__leading {
  gap: 16px;
}

.icon-button {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  color: #5d6a72;
  border: 0;
  border-radius: 5px;
  background: transparent;
  cursor: pointer;
}

.icon-button:hover {
  color: #111820;
  background: #edf2f3;
}

.icon-button--mobile {
  display: none;
}

.topbar__divider {
  width: 1px;
  height: 24px;
  background: #e2e7ea;
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: var(--font-base);
}

.breadcrumb span {
  color: #8a969e;
}

.breadcrumb strong {
  color: #27333a;
  font-weight: 600;
}

.breadcrumb strong::before {
  margin-right: 9px;
  color: #c1c9ce;
  content: '/';
}

.account-button {
  gap: 9px;
  padding: 5px 8px 5px 5px;
  color: #344149;
  border: 0;
  border-radius: 5px;
  background: transparent;
  cursor: pointer;
}

.account-button:hover {
  background: #f0f4f5;
}

.account-button__avatar {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  color: #06362f;
  border-radius: 5px;
  background: #bff2e8;
  font-size: var(--font-base);
  font-weight: 700;
}

.account-button__name {
  font-size: var(--font-base);
  font-weight: 600;
}

.admin-content {
  width: 100%;
  max-width: var(--content-max-width);
  margin: 0 auto;
  padding: 32px 36px 48px;
}

@media (min-width: 2560px) {
  .admin-content {
    padding: 40px 48px 60px;
  }
}

:global(.mobile-nav-drawer .el-drawer__body) {
  padding: 0;
  background: #111820;
}

@media (max-width: 1100px) {
  .admin-shell__desktop-sidebar,
  .icon-button--desktop,
  .topbar__divider {
    display: none;
  }

  .icon-button--mobile {
    display: grid;
  }

  .topbar {
    padding: 0 14px;
  }

  .admin-content {
    padding: 24px 20px 36px;
  }
}

@media (max-width: 520px) {
  .breadcrumb span,
  .breadcrumb strong::before,
  .account-button__name {
    display: none;
  }
}
</style>
