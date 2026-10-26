import { ref } from 'vue'
import { defineStore } from 'pinia'

// Keep the preference across routes, but never restore polling after a reload.
export const useRunnerResourcesStore = defineStore('runner-resources', () => {
  const autoRefreshEnabled = ref(false)
  return { autoRefreshEnabled }
})
