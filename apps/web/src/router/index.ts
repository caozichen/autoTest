import { createRouter, createWebHistory } from 'vue-router'

import AdminLayout from '@/layouts/AdminLayout.vue'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { guestOnly: true },
    },
    {
      path: '/',
      component: AdminLayout,
      meta: { requiresAuth: true },
      children: [
        {
          path: '',
          name: 'dashboard',
          component: () => import('@/views/DashboardView.vue'),
          meta: { section: '工作台', title: '运行概览' },
        },
        {
          path: 'scripts',
          name: 'scripts',
          component: () => import('@/views/ScriptManagementView.vue'),
          meta: { section: '自动化资产', title: '脚本管理' },
        },
        {
          path: 'environments',
          name: 'environments',
          component: () => import('@/views/EnvironmentManagementView.vue'),
          meta: { section: '自动化资产', title: '环境管理' },
        },
        {
          path: 'automations',
          name: 'automations',
          component: () => import('@/views/AutomationPipelineView.vue'),
          meta: { section: '自动化资产', title: '自动化配置' },
        },
        {
          path: 'runs',
          name: 'runs',
          component: () => import('@/views/RunHistoryView.vue'),
          meta: { section: '自动化资产', title: '运行记录' },
        },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  await auth.restore()

  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.meta.guestOnly && auth.isAuthenticated) {
    return { name: 'dashboard' }
  }
  return true
})

export default router
