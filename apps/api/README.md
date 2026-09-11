# Playwright Runner

本地 Runner 只接受 `config/scripts/` 中已经持久化的脚本 ID，不接受运行请求传入任意
文件路径。它通过 Playwright Runner 执行已登记的 Playwright 脚本。内置表单脚本
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

## 当前注册脚本（v1.1）

- `form-all-fields-publish`
- `form-all-fields-publish-mainland`（创建完整表单（内地版））
- `form-all-fields-submit`
- `form-lpxavn-submit`
- `form-submission-list-check`
- `form-submission-reply-create`
- `form-multilingual-translation-publish`

脚本行为、运行依赖和真实数据副作用见根目录 README 的“已注册脚本”。

## HTTP 接口

| 方法与路径 | 用途 |
| --- | --- |
| `GET /health` | Runner 健康检查。 |
| `POST /pipeline-executions` | 提交完整流水线，接收后立即返回，Runner 独立执行全部步骤。 |
| `GET /pipeline-executions` | 查询后台流水线及重启后待恢复批次，用于刷新页面后恢复状态。 |
| `POST /runs` | 校验并执行已注册脚本；连接会保持到执行完成。 |
| `GET /runs/:runId` | 查询实时状态、耗时和增量日志。 |
| `POST /runs/:runId/cancel` | 按运行 ID 精确停止一个任务。 |
| `POST /executions/:executionId/cancel` | 停止同一批次的全部活动任务，并阻止该批次后续步骤启动。 |
| `POST /scripts/:scriptId/cancel` | 停止该脚本的唯一活动批次；存在多个批次时返回 409，需通过请求体 executionId 或批次取消接口明确目标。 |
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
| `GET /run-records/:id/screenshots/:stepId/:attemptId?path=...` | 读取运行记录中已登记的截图。 |
| `POST /run-records/:id/screenshots/:stepId/:attemptId/reveal?path=...` | 在系统文件管理器中定位并选中已登记的截图。 |

运行状态包括 `running`、`passed`、`partial`、`failed` 和 `interrupted`。`partial` 表示脚本正常完成但存在失败断言；超时或运行异常才记为 `failed`。完成后的运行快照保留约 5 分钟，用于页面获取最终状态。取消接口可接收 `{ "reason": "停止原因" }`，原因最多 200 个字符。

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

### 执行结果补写与失联恢复

Runner 接收关联批次的脚本后登记执行状态，每 10 秒独立维护心跳，并在脚本结束时保存
脱敏后的结果、断言、日志、接口证据和输出。关闭或刷新页面不影响当前脚本的结果回写；
临时保存失败只重试持久化，不重新执行脚本。正在执行或等待结果写入的任务不会因没有日志
而被标记中断，脚本自身的超时和手动停止规则不变。

流水线调度、登录与变量提取由 Runner 负责，前端只提交和查询。Runner 不再持有任务时保留 2 分钟恢复宽限期。宽限期后，全部步骤已有结果的批次按结果补写终态；
仍有未确认步骤的批次标记为中断，保留已成功或部分通过的结果，并提示人工核对业务结果。
Runner 重启后同样先保留宽限期，再恢复遗留状态，不自动继续或重跑任务。尚未登记任何
Runner 执行且所有步骤仍排队的旧版前端登录记录继续使用原有 4 小时兜底；Runner 接管的流水线登录记录使用 2 分钟恢复宽限期。

服务端保留内部 `runnerTracking` 元数据。前端旧版本省略该字段不会将其清除，旧的运行中
进度也不能覆盖 Runner 已保存的步骤结果。第二阶段记录还包含 `execution.kind = pipeline`、`pipelineId` 与请求指纹；此类记录的外部 PATCH 返回 409，变量校验及终态写入仅由 Runner 完成。

## 后台流水线协议

`POST /pipeline-executions` 请求体包含 `executionId`（前端生成的 UUID）、`pipeline`（ID、名称、有序 steps 和 parameterMappings）、`environment`（本次环境与认证配置），以及可选 `session`、`runtimeVariables`。默认请求上限为 1 MB。首次接收返回 HTTP 202 `{ accepted: true, record }`；相同 ID 和流水线/环境指纹重复提交返回原记录，不重新执行，冲突返回 409。提交响应丢失时前端通过原 ID 查询记录，不生成新任务重试。

单个 Runner 最多同时接受三个流水线批次，超出返回 429（不排队）。不同环境可以复用同一个配置和脚本；同一环境内的相同配置或共用脚本仍互斥，冲突返回 409，指向相同 API origin 的别名按同一环境处理。缺少环境信息的旧执行按保守互斥处理。流水线和普通 `/runs` 入口共享启动临界区，防止检查占用与登记之间的竞争；临界区只串行化启动登记，业务步骤可并发执行。登录中、执行中、保存未完成和重启待恢复批次均占用流水线名额。

| 启动或停止情形 | HTTP 结果 | 执行行为 |
| --- | --- | --- |
| 新批次符合环境锁与容量条件 | 202，`accepted: true` | 后台执行，批次内步骤有序 |
| 相同执行 ID 和指纹再次提交 | 200，`accepted: false` | 返回已有记录，不重新执行 |
| 执行 ID 指纹冲突，或同环境配置/脚本被占用 | 409 | 不创建新批次 |
| 已占用三个流水线名额 | 429 | 不排队，不自动重试 |
| 按脚本取消但命中多个批次 | 409 | 不取消任何批次，调用方需指定 `executionId` |

`GET /pipeline-executions` 返回 `{ executions, maxConcurrentPipelines: 3 }`。每个 execution 含 `id`、`pipelineId`、`pipelineName`、`environment`（id/name/code/apiBaseUrl）、`phase`、`currentScriptId`、`scriptIds`，不包含认证凭据。前端以 execution ID 区分批次，以 pipeline ID + environment ID 判断当前环境的运行状态。`POST /executions/:executionId/cancel` 始终只取消该批次。共享脚本的取消请求无法唯一确定目标时，返回 409 且不取消任何批次。

Runner 验证已启用的脚本和前向依赖，在登录、步骤切换和保存结果期间均持有批次及脚本占用。整批只认证一次；复用登录态要求环境 ID、Web/API 地址、有效期一致。API 登录有总响应超时，不跟随跳转；香港环境超时乘以 3。运行参数优先级为脚本默认值、环境变量、同环境会话变量、当前批次输出及显式映射，认证 Token 使用本次认证结果。

响应变量先提取并检查，再脱敏保存；部分通过继续后续步骤，执行失败、超时或必需变量缺失则跳过余下步骤。保存失败只重试持久化，不重复业务操作。进度维护每秒检查一次，有新日志或累计 5 秒耗时时写入；心跳约 10 秒更新一次。

停止接口在登录、执行及保存阶段均可使用，并保留提交前的停止请求，防止迟到的启动请求继续执行。Runner 重启后只恢复历史状态，不重新登录或重跑。环境凭据、会话 Token 和完整请求载荷只驻留执行进程内存，不写入任务队列或运行记录。

并发接口、取消隔离、保存重试和 Chrome 页面恢复已包含在全量回归中。使用方法见[根目录 README](../../README.md)，最新结果见[三环境并发回归记录](../../docs/concurrency-regression-2026-09-11.md)。

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
