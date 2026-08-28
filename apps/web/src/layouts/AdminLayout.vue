<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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

watch(() => route.fullPath, () => {
  mobileMenuOpen.value = false
})

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
  background: var(--color-bg-page);
}

.admin-shell__desktop-sidebar {
  position: sticky;
  z-index: 30;
  top: 0;
  height: 100dvh;
  flex: 0 0 auto;
}

.admin-shell__body {
  min-width: 0;
  flex: 1;
  min-height: 100dvh;
}

.topbar {
  position: sticky;
  z-index: 20;
  top: 0;
  display: flex;
  height: 60px;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  border-bottom: 1px solid var(--color-border-light);
  background: rgb(255 255 255 / 97%);
  box-shadow: 0 1px 0 rgb(31 42 68 / 3%);
  backdrop-filter: blur(8px);
}

.topbar__leading,
.account-button {
  display: flex;
  align-items: center;
}

.topbar__leading {
  gap: 12px;
}

.icon-button {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  color: var(--color-text-secondary);
  border: 1px solid transparent;
  border-radius: 6px;
  background: var(--color-bg-subtle);
  cursor: pointer;
  transition: 150ms ease;
}

.icon-button:hover {
  color: var(--color-primary);
  border-color: #dbe5f5;
  background: var(--color-primary-soft);
}

.icon-button--mobile {
  display: none;
}

.topbar__divider {
  width: 1px;
  height: 18px;
  background: var(--color-border);
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-md);
}

.breadcrumb span {
  color: var(--color-text-muted);
}

.breadcrumb strong {
  color: var(--color-text-primary);
  font-weight: 650;
}

.breadcrumb strong::before {
  margin-right: 8px;
  color: #c1cad8;
  content: '/';
}

.account-button {
  gap: 8px;
  min-height: 38px;
  padding: 3px 8px 3px 4px;
  color: var(--color-text-primary);
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  transition: 150ms ease;
}

.account-button:hover {
  border-color: var(--color-border);
  background: var(--color-bg-subtle);
}

.account-button__avatar {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  color: var(--color-primary);
  border-radius: 5px;
  background: var(--color-primary-soft);
  font-size: var(--font-sm);
  font-weight: 700;
}

.account-button__name {
  font-size: var(--font-md);
  font-weight: 600;
}

.admin-content {
  width: 100%;
  max-width: var(--content-max-width);
  margin: 0 auto;
  padding: 20px 20px 40px;
}

:global(.mobile-nav-drawer .el-drawer__body) {
  padding: 0;
  background: var(--color-surface);
}

@media (max-width: 1020px) {
  .admin-shell__desktop-sidebar,
  .icon-button--desktop,
  .topbar__divider {
    display: none;
  }

  .icon-button--mobile {
    display: grid;
  }

  .topbar {
    padding: 0 12px;
  }

  .admin-content {
    padding: 16px 14px 32px;
  }
}

@media (max-width: 520px) {
  .breadcrumb span,
  .breadcrumb strong::before,
  .account-button__name {
    display: none;
  }

  .breadcrumb {
    min-width: 0;
  }

  .breadcrumb strong {
    overflow: hidden;
    max-width: 42vw;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
