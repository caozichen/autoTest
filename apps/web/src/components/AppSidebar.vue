<script setup lang="ts">
import { Clock, DataAnalysis, Files, Monitor, Operation, Setting, SetUp } from '@element-plus/icons-vue'

defineProps<{
  compact?: boolean
}>()
</script>

<template>
  <aside class="app-sidebar" :class="{ 'app-sidebar--compact': compact }">
    <div class="brand">
      <span class="brand__mark"><el-icon :size="21"><Monitor /></el-icon></span>
      <span v-if="!compact" class="brand__name">AutoTest</span>
    </div>

    <nav class="nav" aria-label="主导航">
      <p v-if="!compact" class="nav__caption">工作台</p>
      <RouterLink class="nav__item" active-class="nav__item--active" exact-active-class="nav__item--active" to="/">
        <el-icon :size="19"><DataAnalysis /></el-icon>
        <span v-if="!compact">运行概览</span>
      </RouterLink>
      <p v-if="!compact" class="nav__caption nav__caption--section">自动化资产</p>
      <RouterLink class="nav__item" active-class="nav__item--active" to="/scripts">
        <el-icon :size="19"><Files /></el-icon>
        <span v-if="!compact">脚本管理</span>
      </RouterLink>
      <RouterLink class="nav__item" active-class="nav__item--active" to="/environments">
        <el-icon :size="19"><SetUp /></el-icon>
        <span v-if="!compact">环境管理</span>
      </RouterLink>
      <RouterLink class="nav__item" active-class="nav__item--active" to="/automations">
        <el-icon :size="19"><Operation /></el-icon>
        <span v-if="!compact">自动化配置</span>
      </RouterLink>
      <RouterLink class="nav__item" active-class="nav__item--active" to="/runs">
        <el-icon :size="19"><Clock /></el-icon>
        <span v-if="!compact">运行记录</span>
      </RouterLink>
      <p v-if="!compact" class="nav__caption nav__caption--section">系统设置</p>
      <RouterLink class="nav__item" active-class="nav__item--active" to="/settings">
        <el-icon :size="19"><Setting /></el-icon>
        <span v-if="!compact">Runner 管理</span>
      </RouterLink>
    </nav>

    <div class="sidebar-status" :class="{ 'sidebar-status--compact': compact }">
      <span class="sidebar-status__icon"><el-icon :size="18"><Monitor /></el-icon></span>
      <div v-if="!compact">
        <strong>本地 Runner</strong>
        <span>Chromium 执行器</span>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.app-sidebar {
  display: flex;
  width: 220px;
  min-height: 100%;
  flex-direction: column;
  color: var(--color-text-secondary);
  border-right: 1px solid var(--color-border-light);
  background: var(--color-surface);
  box-shadow: 2px 0 8px rgb(31 42 68 / 3%);
  transition: width 180ms ease;
}

.app-sidebar--compact {
  width: 68px;
}

.brand {
  display: flex;
  height: 60px;
  align-items: center;
  gap: 9px;
  padding: 0 14px;
  border-bottom: 1px solid var(--color-border-light);
}

.brand__mark {
  display: grid;
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  place-items: center;
  color: #fff;
  border-radius: 6px;
  background: var(--color-primary);
}

.brand__name {
  color: var(--color-text-primary);
  font-size: var(--font-brand);
  font-weight: 750;
}

.nav {
  flex: 1;
  padding: 14px 8px;
}

.nav__caption {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 8px 8px;
  color: var(--color-text-secondary);
  font-size: var(--font-xs);
  font-weight: 650;
}

.nav__caption::after {
  height: 1px;
  flex: 1;
  background: var(--color-border-light);
  content: '';
}

.nav__caption--section {
  margin-top: 18px;
}

.nav__item {
  display: flex;
  min-height: 40px;
  align-items: center;
  gap: 11px;
  margin-bottom: 4px;
  padding: 0 14px;
  color: var(--color-text-secondary);
  border-radius: 4px;
  font-size: var(--font-md);
  text-decoration: none;
  transition: color 150ms ease, background 150ms ease;
}

.nav__item:hover {
  color: var(--color-primary);
  background: #f7f9fd;
}

.nav__item--active {
  color: var(--color-primary);
  background: rgb(37 99 235 / 8%);
  font-weight: 600;
}

.sidebar-status {
  display: flex;
  min-height: 64px;
  align-items: center;
  gap: 10px;
  margin: 8px;
  padding: 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-subtle);
}

.sidebar-status--compact {
  min-height: 52px;
  justify-content: center;
  padding: 0;
}

.sidebar-status__icon {
  display: grid;
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  place-items: center;
  color: var(--color-primary);
  border-radius: 5px;
  background: var(--color-primary-soft);
}

.sidebar-status strong,
.sidebar-status span {
  display: block;
}

.sidebar-status strong {
  color: var(--color-text-primary);
  font-size: var(--font-sm);
  font-weight: 600;
}

.sidebar-status span {
  margin-top: 2px;
  color: var(--color-text-muted);
  font-size: var(--font-caption);
}
</style>
