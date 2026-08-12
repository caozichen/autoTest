<script setup lang="ts">
import { Clock, DataAnalysis, Files, Monitor, Operation, SetUp } from '@element-plus/icons-vue'

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
  width: 260px;
  min-height: 100%;
  flex-direction: column;
  color: #dfe7ec;
  background: #111820;
  transition: width 180ms ease;
}

.app-sidebar--compact {
  width: 84px;
}

.brand {
  display: flex;
  height: 78px;
  align-items: center;
  gap: 11px;
  padding: 0 22px;
  border-bottom: 1px solid rgb(255 255 255 / 8%);
}

.brand__mark {
  display: grid;
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  place-items: center;
  color: #081513;
  border-radius: 6px;
  background: #27d6bf;
  box-shadow: 0 0 24px rgb(39 214 191 / 22%);
}

.brand__name {
  color: #fff;
  font-size: var(--font-brand);
  font-weight: 700;
}

.nav {
  flex: 1;
  padding: 22px 12px;
}

.nav__caption {
  margin: 0 10px 10px;
  color: #72808c;
  font-size: var(--font-md);
}

.nav__caption--section {
  margin-top: 24px;
}

.nav__item {
  display: flex;
  min-height: 54px;
  align-items: center;
  gap: 14px;
  padding: 0 16px;
  font-size: var(--font-base);
  color: #9eabb5;
  border-radius: 6px;
  text-decoration: none;
}

.nav__item--active {
  color: #fff;
  background: #1c2932;
  box-shadow: inset 3px 0 #27d6bf;
}

.sidebar-status {
  display: flex;
  min-height: 92px;
  align-items: center;
  gap: 11px;
  margin: 12px;
  padding: 14px;
  border: 1px solid rgb(255 255 255 / 8%);
  border-radius: 6px;
  background: #17212a;
}

.sidebar-status--compact {
  min-height: 58px;
  justify-content: center;
  padding: 0;
}

.sidebar-status__icon {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  place-items: center;
  color: #55d6c5;
  border-radius: 5px;
  background: rgb(85 214 197 / 10%);
}

.sidebar-status strong,
.sidebar-status span {
  display: block;
}

.sidebar-status strong {
  color: #edf6f3;
  font-size: var(--font-md);
  font-weight: 600;
}

.sidebar-status span {
  margin-top: 3px;
  color: #768691;
  font-size: var(--font-sm);
}
</style>
