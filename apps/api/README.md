# Playwright Runner

本地 Runner 只接受脚本注册表中的脚本 ID，不接受任意文件路径。它通过 Playwright
Runner 执行已登记的 Playwright 脚本。五个内置表单脚本都会启动 Google Chrome 无头浏览器，访问目标页面并模拟真实用户操作。

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
- `form-lpxavn-submit`
- `form-submission-reply-edit`
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
| `GET /run-records` | 查询轻量运行记录列表，不返回日志和接口正文。 |
| `GET /run-records/:id` | 查询一条完整运行记录。 |
| `POST /run-records` | 创建运行记录。 |
| `PATCH /run-records/:id` | 通过 revision 和 updatedAt 并发校验更新运行记录。 |
| `POST /run-records/migrations/local-storage-v1` | 幂等导入旧版浏览器运行记录。 |

运行状态包括 `running`、`passed`、`failed` 和 `interrupted`。完成后的运行快照保留约 5 分钟，用于页面获取最终状态。取消接口可接收 `{ "reason": "停止原因" }`，原因最多 200 个字符。

## 停止语义与安全

- 取消请求会等待协作式 Playwright 清理；超过等待期限时接口会返回清理超时信息，但任务状态仍会标记为 `interrupted`。
- 关闭发起请求的页面或断开客户端连接不会自动取消任务，必须调用取消接口。
- Runner 只执行注册表中的脚本 ID，校验 API 与授权来源同源，并在保存日志前脱敏 Token、Authorization 和环境密钥。
- Runner 只允许本地 `5174`、`4173` 端口的管理端 Origin 调用。

## 运行记录存储

运行记录默认持久化到仓库根目录的 `data/run-records/`，每个批次使用一个经过校验的
`<id>.json` 文件。更新会先写入同目录临时文件，再原子替换正式文件；Runner 不会自动
删除已结束的记录。该目录已加入 `.gitignore`，不会随代码提交。

`PATCH /run-records/:id` 请求体格式为
`{ "record": { ... }, "expectedRevision": 0, "expectedUpdatedAt": "..." }`。
当前磁盘版本与两个期望值任一不符时返回 HTTP 409，避免其它页面的旧数据覆盖新记录。
运行记录创建、更新和旧数据迁移请求允许最大 64 MB 请求体。
