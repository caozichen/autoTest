import config from '../config/local-services.json' with { type: 'json' }

export const WEB_PORT = config.webPort
if (!Number.isInteger(WEB_PORT) || WEB_PORT < 1024 || WEB_PORT > 65535 || [4310, 4311, 4173].includes(WEB_PORT)) {
  throw new Error('config/local-services.json 的 webPort 必须为 1024–65535，且不能与 Runner、Supervisor 或预览端口重复')
}
export const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`
export const WEB_ORIGINS = [WEB_ORIGIN, `http://localhost:${WEB_PORT}`]
