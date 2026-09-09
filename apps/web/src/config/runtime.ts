export const runtimeConfig = Object.freeze({
  appName: '自动化测试平台',
  authMode: 'local' as const,
  localCredentials: {
    username: 'admin',
    password: 'admin123',
  },
  sessionStorageKey: 'autotest.session.v1',
  runnerBaseUrl: 'http://127.0.0.1:4310',
})
