# RUN-20261022-BF9445：Runner 热重启中断公开填写

## 批次结果

TEST“测试表单冒烟测试”，执行 ID `7a9a0cae-a3f4-4386-a0fe-fcad51bf9445`。北京时间 2026-10-22 13:59:23 开始，14:06:00 结束。最终 3 通过、1 失败、3 跳过，无部分通过。

| 步骤 | 结果 | 通过断言 | 失败断言 |
| --- | --- | ---: | ---: |
| 创建完整表单 | 通过 | 873 | 0 |
| 设置校验表单多语言翻译 | 通过 | 12989 | 0 |
| 手动创建提报信息 | 通过 | 851 | 0 |
| 公开填写指定表单 | 失败 | 494 | 0 |
| 检查提报列表 | 跳过 | 0 | 0 |
| 检查并编辑提报信息 | 跳过 | 0 | 0 |
| 共享草稿编辑并发检查 | 跳过 | 0 | 0 |

第四步失败为执行异常，而非失败断言：`page.waitForRequest: Target page, context or browser has been closed` 成为未处理的 Promise rejection。运行到此为止观察到的 435 条 API 和 1233 条资源记录全部通过，无采集警告或丢弃；这不代表第四步后续业务或跳过的步骤已验证。

本轮表单 `qDG7Lo`、后台代填答卷 `lKD6LP`。前三步完成，第四步图片和文件上传完成并通过回显断言，尚未发出最终公开提交请求。此前完整通过的 `RUN-20261022-4E0A16` 保留独立记录，不合并计数。

## 原因和证据

证据链指向本地 Runner 的源码热重启：Supervisor 使用 `node --watch server.mjs` 启动 Runner，Node 也会监听运行期间动态导入的脚本依赖。已加载脚本发生变化时，watch 向 Runner 发送 SIGTERM；Playwright 默认处理该信号并关闭其 Chrome。Runner HTTP 服务仍可能存活，watch 因而停在 `Waiting for graceful termination...`，健康检查成功不能证明测试浏览器仍在运行。

- 14:05:59.910，第四步填完第二页，开始点击“下一页”。第一轮分页校验此前已返回 HTTP 200、业务码 0。
- 14:06:00，`scripts/form-copy-delete-archive.ui.spec.mjs` 修改时间与 `outputs/local-supervisor.log` 最后写入时间重合；该日志末尾为 `Restarting 'server.mjs'` 和 `Waiting for graceful termination...`。
- macOS 系统日志记录本轮自动化 Chrome PID 30798 于 14:06:00.422–.423 退出。
- 14:06:00.494，Runner 捕获未处理的 `waitForRequest` 页面关闭错误并终止第四步；没有采集到第二页的分页校验请求或业务失败响应。
- 当时 Runner PID 22316 及其父 watch PID 90712 仍存在，符合 watch 等待终止的状态。

历史系统日志没有直接记录该 SIGTERM 的发送者，因此进一步使用独立临时目录、独立 Node 进程和已安装 Google Chrome 复现，不访问业务环境：修改一个已导入依赖后，watch 版本依次出现 `Restarting`、`RUNNER_SIGTERM`、相同的未处理页面关闭错误、浏览器断开和 `Waiting for graceful termination...`；普通 Node 启动的对照组修改同样依赖后，未收到终止信号，浏览器保持连接。该复现与本轮日志、文件时间及进程状态一致。

同时确认了脚本自身的错误处理缺口：`waitForPublicMutation` 在执行 action 前启动请求等待，但到 action 完成后才处理请求 Promise 的拒绝。页面提前关闭或请求先超时会触发 Runner 的全局拒绝保护，掩盖 action 的原始错误。日志中“已响应强制停止”为异常后的清理分支，不能据此认定用户点击了停止。原 catch 还把所有请求等待失败都解释为本地校验拦截，可能误导定位。

此次证据支持自动化执行环境问题，未发现失败的表单业务接口；没有据此修改产品仓库或放宽业务断言。

## 修正及验证

1. Supervisor 直接使用 `node server.mjs` 启动 Runner；`apps/api/package.json` 的 `dev` 入口同步取消 `--watch`，使 `npm run dev:api` 也采用稳定进程。README 补充共享模块更新后等待活动任务结束再重启的说明。
2. `waitForPublicMutation` 立即处理请求等待的成功与失败，保留 action 原始错误。页面关闭单独报告；仅请求超时且存在可见字段错误时判断为本地校验拦截，无可见错误时报告未观察到匹配请求。不增加点击、提交或自动重试次数，不忽略实际失败。
3. 新增 5 个本地 Chrome 回归用例：等待期间页面关闭、action 先失败后的延迟拒绝、页面关闭归因、action 完成前请求超时，以及无字段错误时的超时提示。修复前新增 5 项全部失败，修复后与原有正常提交／业务失败用例共 7 项全部通过，无未处理拒绝警告。
4. Supervisor 启动和 Runner 异步拒绝隔离的既有 5 项测试全部通过；本次共 12 项定向测试通过。脚本语法及 `git diff --check` 通过。

```sh
node --test --test-concurrency=1 --test-name-pattern='public mutation|final submission' apps/api/form-lpxavn-submit.test.mjs
node --test --test-concurrency=1 apps/api/local-service-supervisor.test.mjs apps/api/script-rejection-boundary.test.mjs
```

确认活动批次列表为空、磁盘无运行中记录后，仅重启已有本地 Supervisor LaunchAgent，使启动方式生效。14:18:36 新 Supervisor PID 45441、Runner PID 45443，Runner 命令为 `node server.mjs`，旧 watch 进程已退出；Runner 健康检查及活动批次查询正常，Web 正常启动。重启后的首次活动列表查询超过 3 秒，延长只读查询等待后成功；未因此再次重启服务。

本次未重新执行业务七步、未另建业务数据、未改写 BF9445 历史结果；既有监控保持暂停。用户下次手动启动将使用新的稳定 Runner 和修正后的脚本。真实完整七步尚需后续批次验证。

证据目录：`outputs/reports/2026-10-22-bf9445-runner-interruption/`，包括原始记录摘要与 SHA-256、故障时 Supervisor 日志尾部、Chrome 退出系统日志、watch／普通启动隔离对照、修复前后测试日志及服务重启核验。原始记录：`data/run-records/7a9a0cae-a3f4-4386-a0fe-fcad51bf9445.json`。
