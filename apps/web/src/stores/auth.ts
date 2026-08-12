import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import type { AuthSession, LoginCredentials } from '@/domain/auth'
import { services } from '@/services/container'

export const useAuthStore = defineStore('auth', () => {
  const session = ref<AuthSession | null>(null)
  const initialized = ref(false)
  const isAuthenticated = computed(() => Boolean(session.value))
  const user = computed(() => session.value?.user ?? null)

  async function restore(): Promise<void> {
    if (initialized.value) return
    session.value = await services.auth.restore()
    initialized.value = true
  }

  async function login(credentials: LoginCredentials): Promise<void> {
    session.value = await services.auth.login(credentials)
    initialized.value = true
  }

  async function logout(): Promise<void> {
    await services.auth.logout()
    session.value = null
  }

  return { session, initialized, isAuthenticated, user, restore, login, logout }
})
