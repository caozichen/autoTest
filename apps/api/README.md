# Playwright Runner

本地 Runner 只接受脚本注册表中的脚本 ID，不接受任意文件路径。它通过 Playwright
Runner 执行已登记的 Playwright 脚本。三个内置表单脚本都会启动 Google Chrome 无头浏览器，访问目标页面并模拟真实用户操作。

## 启动

在仓库根目录执行：

```powershell
# 仅启动 Runner
npm.cmd run dev:api

# 同时启动 Web 和 Runner
npm.cmd run dev
```

健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:4310/health
```

正常响应为 `{ "ok": true, "service": "autotest-playwright-runner" }`。

## 已注册脚本

- `form-all-fields-publish`
- `form-all-fields-submit`
- `form-contact-publish`

脚本行为、运行依赖和真实数据副作用见根目录 README 的“已注册脚本”。

## HTTP 接口

| 方法与路径 | 用途 |
| --- | --- |
| `GET /health` | Runner 健康检查。 |
| `POST /runs` | 校验并执行已注册脚本；连接会保持到执行完成。 |
| `GET /runs/:runId` | 查询实时状态、耗时和增量日志。 |
| `POST /runs/:runId/cancel` | 按运行 ID 精确停止一个任务。 |
| `POST /scripts/:scriptId/cancel` | 停止该脚本当前全部活动任务。 |

运行状态包括 `running`、`passed`、`failed` 和 `interrupted`。完成后的运行快照保留约 5 分钟，用于页面获取最终状态。取消接口可接收 `{ "reason": "停止原因" }`，原因最多 200 个字符。

## 停止语义与安全

- 取消请求会等待协作式 Playwright 清理；超过等待期限时接口会返回清理超时信息，但任务状态仍会标记为 `interrupted`。
- 关闭发起请求的页面或断开客户端连接不会自动取消任务，必须调用取消接口。
- Runner 只执行注册表中的脚本 ID，校验 API 与授权来源同源，并在保存日志前脱敏 Token、Authorization 和环境密钥。
- Runner 只允许本地 `5174`、`4173` 端口的管理端 Origin 调用。
