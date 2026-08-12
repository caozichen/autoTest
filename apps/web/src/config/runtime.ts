export const runtimeConfig = Object.freeze({
  appName: 'AutoTest',
  authMode: 'local' as const,
  localCredentials: {
    username: 'admin',
    password: 'admin123',
  },
  sessionStorageKey: 'autotest.session.v1',
})
