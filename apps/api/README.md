# Playwright Runner

本地 Runner 只接受脚本注册表中的脚本 ID，不接受任意文件路径。它通过 Playwright
`APIRequestContext` 执行接口自动化，不启动浏览器。

- 健康检查：`GET http://127.0.0.1:4310/health`
- 运行脚本：`POST http://127.0.0.1:4310/runs`

Runner 会校验 API 基址与授权来源同源，且不会把 Token 写入日志。
