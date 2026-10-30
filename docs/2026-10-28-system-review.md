# 系统审查记录（不含业务脚本）

审查日期：2026-10-28。代码基线：`b0ac75a`。范围为 `apps/web`、`apps/api`、共享配置和依赖；不评价 `scripts/` 内业务脚本的操作、断言及业务正确性。Runner 的调度、取消、变量传递、存储属于系统能力，纳入本次审查。

本次使用 3 个子代理，分别从功能、性能、环境隔离角度检查，再交叉审查其他代理的结论。复现使用合成数据、临时目录和模拟执行器，没有向业务环境提交操作。未修改产品代码。现有前端 320 项测试、后端系统定向 174 项测试全部通过，`npm run typecheck` 通过；这些通过结果不能覆盖下面新增的触发条件。

优先级：P1 表示可能造成错误业务操作或敏感数据落盘，建议优先处理；P2 表示明确功能限制、性能瓶颈或有触发条件的风险。各问题按用户要求的四个类别排列。

## 1、功能问题

### F1 · P2 · 普通批量运行在刷新或关闭浏览器后无法继续调度

普通批量运行由浏览器中的 `for` 循环逐个提交 `/runs`。Runner 只收到当前步骤，没有收到完整批次队列。整页刷新或关闭后，已提交步骤仍可能完成并保存，剩余步骤不会再提交，随后恢复机制会把未完成批次标为中断。页面未提供刷新/关页提醒。

这是普通批量入口的已知功能限制；自动化配置入口一次提交完整流水线，可以在关闭页面后继续。仅切换站内路由不等于整页刷新，不能据此断言调度一定停止。

依据：[普通批量调用](/Users/caozichen/cursorcode/mycode/autoTest/apps/web/src/views/ScriptManagementView.vue:417)、[前端逐步调度](/Users/caozichen/cursorcode/mycode/autoTest/apps/web/src/services/scripts/local-script.service.ts:669)、[卸载处理](/Users/caozichen/cursorcode/mycode/autoTest/apps/web/src/views/ScriptManagementView.vue:596)。

建议：普通批量也提交服务端完整执行计划；过渡期在界面明确提示并增加刷新/关闭提醒。

### F2 · P2 · 脚本管理页面对跨环境运行施加全局锁

页面把所有环境的运行记录合并成一组 script ID，并用这组 ID 禁用普通运行。A 环境运行某脚本后，选择 B 环境仍可能被提示“正在运行”。后台流水线却支持不同环境复用同一脚本，前后端能力不一致。

这是普通运行界面的能力限制，不影响自动化配置页面已有的跨环境流水线能力。

依据：[全环境 ID 汇总](/Users/caozichen/cursorcode/mycode/autoTest/apps/web/src/views/ScriptManagementView.vue:98)、[启动阻断](/Users/caozichen/cursorcode/mycode/autoTest/apps/web/src/views/ScriptManagementView.vue:344)。

建议：展示和启动检查使用环境范围；同时修复 I2 的服务端准入，避免只放开前端锁。

### F3 · P2 · 流水线参数映射可覆盖认证变量，但请求头不随之更新

响应变量绑定和步骤参数映射允许写入环境配置的 Token 变量名，例如 `AUTH_TOKEN`；统一 `Authorization` 却一直使用最初认证的 Token。

真实 PipelineRunner 配合模拟执行器复现：第二步的 `variables.AUTH_TOKEN` 已变为替代值，`Authorization` 仍为最初认证值。使用变量的操作与使用请求头的操作因此可能出现认证不一致；没有执行真实业务脚本来断言实际身份切换后果。

依据：[映射覆盖变量](/Users/caozichen/cursorcode/mycode/autoTest/apps/api/pipeline-runner.mjs:165)、[固定认证请求头](/Users/caozichen/cursorcode/mycode/autoTest/apps/api/pipeline-runner.mjs:172)、[响应绑定覆盖变量](/Users/caozichen/cursorcode/mycode/autoTest/apps/api/pipeline-runner.mjs:188)。

建议：将认证变量设为保留名称并拒绝覆盖，或提供显式、统一的认证切换协议。

### F4 · P2 · 登录路径对证书开关和网络约束的处理不一致

环境编辑提供“忽略 HTTPS 证书校验”，后台流水线登录会使用该开关；环境管理的测试登录、普通运行前登录走浏览器 `fetch`，没有使用该开关，且仍受浏览器证书与跨域规则限制。

因此，自签名证书或未允许管理端跨域的 API，可能出现后台流水线能登录、普通运行登录失败的差异。源码确认了处理差异，本次没有在真实浏览器中制造证书/CORS 故障，属于条件性兼容问题。

依据：[界面开关](/Users/caozichen/cursorcode/mycode/autoTest/apps/web/src/components/EnvironmentEditorDialog.vue:241)、[浏览器登录](/Users/caozichen/cursorcode/mycode/autoTest/apps/web/src/services/environments/fetch-environment-login.service.ts:75)、[后台登录 TLS 设置](/Users/caozichen/cursorcode/mycode/autoTest/apps/api/pipeline-login.mjs:14)。

建议：把登录和登录态校验统一放在 Runner；至少在界面说明证书开关的实际作用范围。

## 2、性能问题

### PERF1 · P2 · 历史列表每秒拉取全部摘要，分页只在前端执行

历史页和空闲时的脚本管理页每秒拉取全量历史摘要，后台标签没有可见性暂停。接口没有服务端分页或增量游标。

只读测量时有 362 条记录，列表响应约 1,670,528 字节，即约 1.59 MiB；按每秒一次持续刷新，单标签的本地 HTTP 载荷约 95.6 MiB/分钟，不含协议开销。实际频率会受请求耗时、浏览器定时器节流影响。传输内容是摘要，不包含完整日志和接口正文，但仍有全量排序、复制、序列化、解析和响应式更新成本。

依据：[列表接口](/Users/caozichen/cursorcode/mycode/autoTest/apps/api/server.mjs:832)、[全量列表构造](/Users/caozichen/cursorcode/mycode/autoTest/apps/api/run-record-store.mjs:440)、[历史页轮询](/Users/caozichen/cursorcode/mycode/autoTest/apps/web/src/views/RunHistoryView.vue:305)、[脚本页轮询](/Users/caozichen/cursorcode/mycode/autoTest/apps/web/src/views/ScriptManagementView.vue:585)。

建议：服务端分页、状态增量查询；无变化时跳过刷新，后台标签暂停轮询。

### PERF2 · P2 · 微小进度更新会重写整份运行记录

进度已做约 5 秒合并，心跳也有限频，但最终仍对完整批次执行 JSON 序列化和文件替换。前面步骤已经产生的大量证据会被反复写盘。

临时真实文件存储复现：保留 4 MiB 的已完成步骤证据，进行 3 次小进度更新，共新增写入 12,588,784 字节。规律进度刷新会同时更新心跳时间，不能把进度和独立心跳机械叠加计算为两套固定写入。

依据：[进度写入](/Users/caozichen/cursorcode/mycode/autoTest/apps/api/run-record-store.mjs:674)、[心跳写入](/Users/caozichen/cursorcode/mycode/autoTest/apps/api/run-record-store.mjs:973)、[完整序列化](/Users/caozichen/cursorcode/mycode/autoTest/apps/api/run-record-store.mjs:1043)。

建议：将进度、心跳与不可变步骤证据分开保存，采用增量日志或数据库事务。

### PERF3 · P2 · 不同环境的记录读写共用全局串行队列

列表、详情、创建、进度和终态更新经过同一条 `mutationTail`。A 环境的大结果或慢盘写入，会阻塞 B 环境的查询和保存，进而拖慢调度。特殊的活动流水线查询已绕开队列，不能据此认为全部读写均独立。

临时文件系统门闩复现：暂停 A 的写入时，B 的创建和全局列表都等待；释放 A 后恢复。实验中的 121 ms 仅证明等待关系，不是对实际磁盘延迟的预测。这里证明的是资源竞争，没有证明数据串写。

依据：[列表/详情进入队列](/Users/caozichen/cursorcode/mycode/autoTest/apps/api/run-record-store.mjs:440)、[全局队列](/Users/caozichen/cursorcode/mycode/autoTest/apps/api/run-record-store.mjs:1024)。

建议：至少按记录 ID 串行写入，列表读取已提交快照；长期使用有事务和索引的存储。

### PERF4 · P2 · 每次运行生成新的原生 ESM 缓存条目

Runner 使用原生 `import()`，每次给入口 URL 添加唯一 `runner-attempt`。每个 URL 都成为新的 ESM 模块缓存条目，运行快照 5 分钟 TTL 不会清掉该缓存。

独立临时模块按同机制导入 200 次，即使显式 GC 也保留模块状态。该实验确认机制，不能把夹具的内存增量直接推算为真实系统每次增长量；本次未做数小时业务负载压测。

依据：[默认加载器](/Users/caozichen/cursorcode/mycode/autoTest/apps/api/script-runner.mjs:606)、[唯一入口 URL](/Users/caozichen/cursorcode/mycode/autoTest/apps/api/script-runner.mjs:831)。

建议：使用有生命周期的 Worker/子进程，在执行结束后回收；或结合发布版本管理模块加载，避免每次 attempt 都生成永久模块实例。

### PERF5 · P2 · 历史记录和制品没有保留策略或清理入口

本次只读元数据统计：历史正文 2,510,170,081 字节，约 2.34 GiB；制品 255,380,057 字节，约 243.55 MiB，共 2,931 个文件，摘要索引另计。存量持续增长，同时放大启动索引、常驻摘要和全量轮询成本。

没有自动保留期限、数量/磁盘配额或平台清理接口。若磁盘最终耗尽，结果保存会失败并重试，占用也可能持续保留；没有人为填满磁盘验证这一后果。

依据：[常驻摘要](/Users/caozichen/cursorcode/mycode/autoTest/apps/api/run-record-store.mjs:405)、[启动逐条索引](/Users/caozichen/cursorcode/mycode/autoTest/apps/api/run-record-store.mjs:814)、[现有 HTTP 路由](/Users/caozichen/cursorcode/mycode/autoTest/apps/api/server.mjs:832)。

建议：提供按时间/数量清理、导出归档和磁盘低水位保护，清理时同时处理正文、摘要和制品，并保护活动批次。

## 3、环境隔离是否正常、是否互相影响

结论：后台流水线已经具备逻辑隔离，但整个系统不能视为完整隔离。普通运行存在变量和准入缺口，所有环境仍共享进程、CPU、内存、磁盘和存储队列。

### I1 · P1 · 普通运行会混入其他环境变量，同名变量也会相互覆盖

普通运行构建上下文时合并全部 `runtimeVariables.list()`，没有按 `sourceEnvironmentId` 过滤；会话变量 Map 只以变量名为键。A 环境留下的 `FORM_ID` 可以覆盖 B 环境静态配置的 `FORM_ID`，A 的其他 Token 变量也可能被带入 B 上下文。

直接调用真实函数复现：B 配置 `FORM_ID=b-form`，A 的运行变量为 `FORM_ID=a-form`；B 最终得到 `a-form`，并包含 A 的其他变量。明确传入 B 的认证结果时，统一 `Authorization` 仍然是 B 的 Token，不能夸大为所有认证头都会串环境。

此外，每个普通批次结束都会 `runtimeVariables.clear()`，清空所有环境的临时变量。已构建上下文和已提交的后台流水线持有快照，不会因此改变当前参数；尚未构建上下文及后续运行仍受影响。

依据：[无环境过滤的变量合并](/Users/caozichen/cursorcode/mycode/autoTest/apps/web/src/services/scripts/script-run-context.ts:14)、[按变量名存储](/Users/caozichen/cursorcode/mycode/autoTest/apps/web/src/services/runtime-variables/session-runtime-variable.service.ts:75)、[全局清理](/Users/caozichen/cursorcode/mycode/autoTest/apps/web/src/views/ScriptManagementView.vue:520)。

建议：以环境 ID 和变量名共同索引，读取、覆盖、清理都限定范围；批次使用独立变量快照。

### I2 · P1 · 普通 `/runs` 没有同环境同脚本互斥和总并发上限

准入只检查流水线占用和重复 runId，没有检查其他普通任务。前端当前页面的锁不能替代服务端锁，两个标签页或两个客户端可以同时启动同环境同脚本。

临时 Server 和执行器复现：同环境、同脚本、不同 runId 的 6 个请求全部进入执行器并最终返回 HTTP 200。流水线“最多 3 个”的限制不保护此入口。这可能造成业务数据的重复写入/清理竞争，并使 Chrome 与内存负载超过预期；本次没有对业务数据制造冲突。

依据：[普通运行准入](/Users/caozichen/cursorcode/mycode/autoTest/apps/api/server.mjs:1143)。

建议：所有启动入口统一使用服务端环境/脚本锁和容量池，锁覆盖登记、执行、清理及结果保存。

### I3 · P2 · 强制停止属于协作式取消，清理超时后不保证旧任务已终止

Runner 发出 AbortSignal，等待任务清理。默认等待 15 秒，超时只记录警告并返回终态，没有独立进程/Worker 可强制销毁。随后运行被标为 settled，相关占用可释放；不响应取消的原 Promise 仍可能继续运行。

独立夹具复现：缩短清理等待后先返回 `interrupted`，再释放旧任务门闩，旧任务仍产生后续测试副作用。只有不响应 AbortSignal、清理失败或游离异步任务等条件才触发，不代表现有每条业务脚本都会继续执行；已发出的远端请求也不能靠本地停止回滚。

依据：[清理超时分支](/Users/caozichen/cursorcode/mycode/autoTest/apps/api/script-runner.mjs:918)、[标记 settled](/Users/caozichen/cursorcode/mycode/autoTest/apps/api/server.mjs:655)、[释放流水线占用](/Users/caozichen/cursorcode/mycode/autoTest/apps/api/pipeline-runner.mjs:228)。

建议：执行任务放进独立 Worker/进程并提供硬终止，清理未确认时保留占用并提示人工核对。

已有保护机制：后台流水线按环境过滤运行变量，Token 和输出保存在每个批次的局部对象/Map；相同环境 ID 或相同 API origin 的别名会共享锁；不同 origin 可并发；取消按 execution ID 定位，脚本名命中多个批次时拒绝模糊取消。现有定向回归包含三环境并发、取消、保存重试与恢复，均通过。资源竞争方面仍存在 PERF3 所述的跨环境存储等待。

## 4、其他问题

### O1 · P1 · 普通运行的自定义敏感变量可能明文落盘

界面允许环境变量和响应变量标记 `secret`，但普通 `/runs` 只发送变量键值，丢失敏感标记。后端主要按变量名猜测敏感性。像 `CUSTOM_VALUE` 这样的普通名称，即使前端标记敏感，其值进入日志或普通输出字段后仍可能被原样保存。

使用真实临时 RunRecordFileStore 复现：合成变量值被执行器复制到日志和 `echo` 字段，服务端完成 `/runs` 后，历史记录仍包含原值。前端正常结束有机会再次脱敏并覆盖，但服务端已经先落盘；页面关闭、刷新或后续 PATCH 失败时可能长期保留。后台流水线会收集敏感变量值，不应把此缺陷泛化到所有流水线。

依据：[普通请求丢失敏感标记](/Users/caozichen/cursorcode/mycode/autoTest/apps/web/src/services/scripts/local-script.service.ts:730)、[按字段名收集敏感值](/Users/caozichen/cursorcode/mycode/autoTest/apps/api/run-record-result.mjs:7)、[后台结果落盘](/Users/caozichen/cursorcode/mycode/autoTest/apps/api/server.mjs:652)。

建议：所有入口都传递可信的敏感变量元数据，由 Runner 在实时快照和任何落盘前统一按值脱敏。

### O2 · P2 · 页面登录没有形成后台 API 的认证边界

登录只在前端本地校验固定账号。Runner 主要检查 Origin，不验证平台登录会话；无 Origin 的本机请求可以读取配置、保存的登录态及调用控制接口。

临时服务器复现：无 Origin、无登录的 `GET /app-settings` 返回 200 并包含合成保存 Token；不受信任的 Origin 返回 403。默认服务绑定 127.0.0.1，因此这是本机 API 权限和使用范围限制，不能描述为默认公网暴露或任意恶意网站均可读取。README 已说明当前没有生产认证方案。

依据：[前端固定账号](/Users/caozichen/cursorcode/mycode/autoTest/apps/web/src/config/runtime.ts:4)、[后台 Origin 检查](/Users/caozichen/cursorcode/mycode/autoTest/apps/api/server.mjs:686)。

建议：若需要区分本机用户/客户端或多人使用，应为 Runner 引入真实会话/访问令牌和服务端授权。

### O3 · P2 · 依赖审计存在已知安全公告，需安排升级

本次 `npm audit --json` 对当前锁文件报告 10 个受影响包条目：4 critical、5 high、1 moderate。代表项包括 `shell-quote/concurrently`、`tinypool/vitest`、`vite`、`vue/@vue/server-renderer`、`source-map-js`。这不是 10 条已证实可利用的系统漏洞：条目可能包含传递依赖重复归因，部分仅涉及开发/测试服务、SSR 或特定平台，本项目是否满足各公告利用条件尚未逐项验证。

当前安装版本示例：Vite 6.4.3、Vitest 3.2.7、Vue 3.5.41、concurrently 10.0.4。审计均给出了修复路径，其中部分涉及主版本升级，未执行自动修复或更改锁文件。

依据：[锁文件](/Users/caozichen/cursorcode/mycode/autoTest/package-lock.json)、[Web 依赖声明](/Users/caozichen/cursorcode/mycode/autoTest/apps/web/package.json:1)、[shell-quote 公告](https://github.com/advisories/GHSA-pqg4-j6r4-53mv)、[tinypool 公告](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3)、[Vite 公告详情](https://github.com/advisories/GHSA-rq7h-c2jc-7f22)。

建议：按实际使用路径核实公告影响，升级后运行本次系统测试及必要的浏览器回归，避免直接强制升级。

## 验证记录与适用范围

三轮流程为：第一轮各代理独立检查；第二轮交换候选问题并寻找反证、修正影响范围；第三轮对核心问题进行重复复现、检查已有保护机制，并复核最终表述。交叉复核后特别收窄了以下结论：变量串用主要限于普通运行；历史轮询传输摘要；取消风险有触发条件；本机 API 缺认证不等于公网暴露；证书差异未做真实浏览器故障复现。

执行检查：

- `npm run test --workspace @autotest/web`：41 个文件、320 项通过。
- `node --test --test-concurrency=1` 指定 server、pipeline-runner、pipeline-login、run-record-store、app-settings-store、script-config-repository、artifact-writer、runner-resources、run-record-result、script-rejection-boundary、script-runner 测试：174 项通过。
- `npm run typecheck`：通过。
- `npm audit --json`：返回上述依赖公告条目。
- 新增复现均为合成数据和临时存储，未运行真实业务脚本。存量容量仅只读统计，不代表压力测试；没有实测生产业务冲突、磁盘耗尽、数小时内存增长或所有浏览器网络情形。

优先修复 I1、I2、O1，再统一取消隔离与执行入口；随后处理全量轮询、存储写放大和历史清理。
