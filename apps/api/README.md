# Playwright Runner

本地 Runner 只接受 `config/scripts/` 中已经持久化的脚本 ID，不接受运行请求传入任意
文件路径。它通过 Playwright Runner 执行已登记的 Playwright 脚本。五个内置表单脚本
都会启动 Google Chrome 无头浏览器，访问目标页面并模拟真实用户操作。

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

## 初始脚本

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
| `POST /executions/:executionId/cancel` | 停止同一批次的全部活动任务，并阻止该批次后续步骤启动。 |
| `POST /scripts/:scriptId/cancel` | 停止该脚本当前全部活动任务。 |
| `GET /script-configs` | 查询全部脚本配置。 |
| `GET /script-configs/:id` | 查询一条脚本配置。 |
| `POST /script-configs` | 创建一条脚本配置。 |
| `PATCH /script-configs/:id` | 通过 revision 和 updatedAt 并发校验更新脚本配置。 |
| `DELETE /script-configs/:id` | 通过 revision 和 updatedAt 并发校验删除脚本配置。 |
| `GET /run-records` | 查询轻量运行记录列表，不返回日志和接口正文。 |
| `GET /run-records/:id` | 查询一条完整运行记录。 |
| `POST /run-records` | 创建运行记录。 |
| `PATCH /run-records/:id` | 通过 revision 和 updatedAt 并发校验更新运行记录。 |
| `POST /run-records/migrations/local-storage-v1` | 幂等导入旧版浏览器运行记录。 |

运行状态包括 `running`、`passed`、`failed` 和 `interrupted`。完成后的运行快照保留约 5 分钟，用于页面获取最终状态。取消接口可接收 `{ "reason": "停止原因" }`，原因最多 200 个字符。

`POST /runs` 可在顶层携带 `executionId`。管理端使用运行记录 ID 作为 `executionId`；Runner
使用注册脚本 ID 作为 `stepId`，并使用本次 `runId` 作为 `attemptId`。Runner 向脚本注入
`artifactWriter`；已接入的脚本通过它将制品写入
`outputs/artifacts/<executionId>/<stepId>/<attemptId>/`。未提供 `executionId` 时回退为本次
`runId`；运行结果和实时快照中的 `artifacts` 返回已成功落盘的制品描述。若 `executionId`
对应已有运行记录，Runner 会在最终运行结果可见前原子合并对应脚本的制品描述；合并时会
校验运行记录 ID、脚本 ID 和三级目录后缀，浏览器断开也不会留下无法从运行历史定位的制品。

## 停止语义与安全

- 取消请求会等待协作式 Playwright 清理；超过等待期限时接口会返回清理超时信息，但任务状态仍会标记为 `interrupted`。
- 关闭发起请求的页面或断开客户端连接不会自动取消任务，必须调用取消接口。
- Runner 只执行持久配置中的已启用脚本 ID。入口必须是真实存在的 `.mjs` 文件，且在解析
  符号链接后的真实路径仍位于仓库 `scripts/` 目录。Runner 同时校验 API 与授权来源同源，
  并在保存日志前脱敏 Token、Authorization 和环境密钥。
- Runner 只允许本地 `5174`、`4173` 端口的管理端 Origin 调用。

## 运行记录存储

运行记录默认持久化到仓库根目录的 `data/run-records/`，每个批次使用一个经过校验的
`<id>.json` 文件。更新会先写入同目录临时文件，再原子替换正式文件；Runner 不会自动
删除已结束的记录。该目录已加入 `.gitignore`，不会随代码提交。

`PATCH /run-records/:id` 请求体格式为
`{ "record": { ... }, "expectedRevision": 0, "expectedUpdatedAt": "..." }`。
当前磁盘版本与两个期望值任一不符时返回 HTTP 409，避免其它页面的旧数据覆盖新记录。
运行记录创建、更新和旧数据迁移请求允许最大 64 MB 请求体。

## 脚本配置存储

脚本配置默认持久化到仓库根目录的 `config/scripts/`，每个脚本对应一个
`<script-id>.json` 文件。这个目录是 Runner、Web 管理页面和脚本执行入口的唯一配置来源，
应随 Git 提交；实际 `.mjs` 代码仍存放在仓库 `scripts/` 目录。

配置包含 `schemaVersion`、`revision`、脚本 ID、名称、描述、入口文件、超时、启用状态、
URL 路径、输入参数、响应变量绑定、标签以及创建和更新时间。写入先落到同目录临时文件，
再原子替换正式文件。`PATCH` 请求体格式为
`{ "script": { ... }, "expectedRevision": 0, "expectedUpdatedAt": "..." }`；`DELETE`
请求体只需要后两个并发字段。当前磁盘版本不匹配时返回 HTTP 409。
运行时的入口、启用状态和超时时间始终以当前持久配置为准，`POST /runs` 不能覆盖这些值。

文件仓储按本项目的单 Runner 本地部署设计；不要让多个 Runner 进程同时写同一个
`config/scripts/` 目录。需要多进程或多节点并发写入时，应切换到提供事务和条件更新的
数据库仓储。

API 和 Runner 只依赖 `list/get/create/update/remove` 仓储契约。目前实现为
`FileScriptConfigRepository`；后续可以增加 MySQL 实现并在服务启动时替换仓储，而不需要
改变 Web 接口和脚本运行协议。
