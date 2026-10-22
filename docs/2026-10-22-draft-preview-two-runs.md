# 草稿结果页预览优化与两轮 TEST 监控

本地前后端已完成设计器草稿预览接口拆分，前端 15 项定向测试及设计器构建通过；PHP 检查未执行，改动未部署。两轮远端 TEST 完整七步均已执行结束，合计 11 步通过、3 步部分通过，无整步失败或跳过。原草稿预览 `40004` 在远端旧版本仍出现，不能用这两轮宣称本地修复已在 TEST 生效。

| 轮次 | 批次 | 北京时间 | 结果 | 断言通过 / 失败 |
| --- | --- | --- | --- | --- |
| 1 | RUN-20261022-5AE5B0 | 15:37:22–15:47:20 | 5 通过、2 部分通过 | 17852 / 13 |
| 2 | RUN-20261022-C7592F | 15:47:23–15:57:29 | 6 通过、1 部分通过 | 17886 / 8 |

两轮均出现英文 AI 译文残留中文（每轮 8 条失败）。第一轮另外出现选择题筛选脚本的就绪等待及下拉层选择器问题（5 条失败），第二轮该问题未复现，全部 20 类提报筛选通过。第二轮另有两条 Sentry 上报采集未完成警告。详细分类与证据如下。

## 本地改动

设计器预览改为调用 `GET /be/form/{form_id}/submission-result-preview`，与翻译工作台的 `/translation/submission-prompts` 分开。新接口沿用机构身份、表单数据范围和编辑权限校验，不要求翻译能力或发布版本；活动摘要使用当前可编辑草稿，无草稿时沿用发布数据。普通表单、审核和支付结果文案沿用后端统一语言来源，不在前端硬编码成功文案。

旧翻译工作台接口保留翻译能力与最后发布版本限制，活动摘要仍读取发布态。预览只读取展示数据，不发布表单、不创建答卷，也不保存翻译。预览提交仍等待结果资料，权限或网络错误仍阻止展示成功页。

涉及产品源码：

- `form-building/packages/form-api/modules/form-api.js`：新增独立设计器预览 API。
- `form-building/packages/form-runtime/src/composables/use-submission-result-preview.js`：改用独立 API，保留缓存、语言切换、过期响应丢弃和错误行为。
- `lx-global-backend/routes/project/form.php`、`FormSubmissionResultPreviewController.php`：新增设计器只读入口。
- `lx-global-backend/app/Services/Form/Translation/SubmissionResultPreviewService.php`：分开草稿与翻译发布态调用，共享语言、提示和支付展示数据。
- `lx-global-backend/docs/form/form_translation.md`：补充接口边界。

## 验证范围

前端 15 项定向测试通过，包括 API 路径/ID 编码/语言、四种结果态、等待结果资料后模拟提交、权限失败、预加载重试和语言响应乱序。测试使用真实运行时与提交 composable，网络使用测试适配器，不代表真实后端或部署后 UI 已验证。

`pnpm --filter form-designer build:lib` 构建通过，日志仅有 Browserslist 数据过期提醒；输出保留于 `designer-build.log`。新接口与前端调用需要配套部署。

运行时测试通过临时 Node resolve hook 复用设计器已安装的 Vue，未新增或替换项目依赖。证据在 `outputs/reports/2026-10-22-draft-preview-two-runs/local-tests.tap`。

后端已补充草稿预览无需翻译能力、无答卷/翻译副作用、旧接口拒绝草稿、三语言输出、活动草稿与发布态隔离、编辑权限拒绝等 Feature 检查。当前仓库没有 `vendor`，机器没有 PHP，也没有测试环境配置，因此 PHP Feature、Pint 和 PHPStan **未执行**。前后端修改尚未部署；需先完成这些后端检查并部署双方，再验证真实草稿预览提交。

## 两轮远端 TEST

按用户授权连续运行 TEST“测试表单冒烟测试”完整七步，两轮顺序执行，不改自动化脚本或配置、不重启 Runner。两轮使用远端 `https://lx.admin.lingxi.tech/` 现有部署，不能作为本地产品修复已上线的证据。监控每步终态、断言、接口业务码、资源、详情身份、渠道匹配、原答案保存回读和并发保护。

执行清单与原始记录摘要：`outputs/reports/2026-10-22-draft-preview-two-runs/sequence.json`、`round-*-summary.json`、`round-*-verification.json`。本次上限两轮，不追加第三轮。

两轮第六步均为 `appliedEditFields=[]`，只验证原答案保存与回读，未验证字段改写。接口 HTTP 200 和采集通过不代表业务码全为零，非零业务码已在各轮核验中另行分类。

## 运行中新增发现

第一轮 `RUN-20261022-5AE5B0` 第二步为部分通过：英文 `notification_config.customized_feedback.body` 的 AI 译文含普通可见文本 `与`、`用于验证富文本样式`。同一单元 `8522c0ce35ad045c0a84ea38d7c0655a` 在 AI 保存回读、独立回读、完成发布响应及发布后回读四阶段均触发逐项和汇总断言，共 8 条失败；是同一处译文内容问题，并非 8 个独立缺陷。

原始响应正文确认 `<span>Blue Tip</span>与<mark>Background Highlight</mark>用于验证富文本样式。` 中中文位于普通文本节点，不是模板变量、属性或脚本解析误报；发布后工作区仍有该内容。后端保存与发布均返回 `code=0`。当前产品规范允许 AI 译文人工审阅后发布，不能将此进一步扩大为权限、网络或保存失败，也尚未专门验证真实用户英文提交结果页。第二轮同一单元再次保留这些中文，且发布后回读仍存在，亦为 8 条失败。证据：`round-1-translation-issue.json`、`round-2-translation-issue.json`（仅提取相关单元的源文和译文）。本次没有改写译文、放宽断言或增加第三轮。

第一轮第五步另有 5 条失败断言，提报检索实际成功 17/20，联系人检索 3/3。最早单项选择在 `clickWhenReady(option, {timeout:5000})` 的就绪门禁超时，最后状态为 `pending=[] / busy=0 / settled=false`；这些信息不足以判定产品业务故障。脚本捕获后继续，没有关闭遗留下拉层；多项选择与下拉选择均使用全局 `.arco-select-dropdown:visible`，匹配两个元素而触发 Playwright 严格模式错误。这是明确的脚本选择器范围和失败后清理不足，需与最早就绪超时的具体触发原因区分。详情抽屉身份、渠道完整/片段/无关 code、无意外写请求均通过；该时段列表接口均 `HTTP 200 / code=0`。证据：`round-1-list-filter-issue.json`。

第一轮最终为 5 步通过、2 步部分通过，无失败步骤或跳过；17852 条断言通过、13 条失败；650 条 API、1651 条资源采集无失败、警告或丢弃。第六、七步均通过。第二轮按同一脚本与配置启动，批次 `RUN-20261022-C7592F`，执行 ID `058f2d36-1953-4525-8dac-0c900dc7592f`。

## 第二轮终态与最终核验

第二轮最终为 6 步通过、1 步部分通过，失败 8 条断言全部属于上述英文残留。提报筛选 20/20、联系人检索 3/3，未复现第一轮下拉层冲突；完整渠道匹配与排除、详情抽屉精确答卷/表单 ID、姓名及图片、一次提报更新且无新增、保存回读、旧令牌保存/发布 `30001` 冲突和恢复均通过。两轮上传与浏览器意外关闭均未复现。

第二轮第一步业务断言通过，但有两条第三方 Sentry `/api/44/envelope/` 请求在网络采集封账等待 2000ms 后仍未完成，记为 `status=0 / incomplete=true` 的采集警告。没有实际 HTTP 响应可判断服务端结果，不将其当作业务接口失败，也不声称上报成功。证据：`round-2-network-observation.json`。

合计 35738 条断言通过、21 条失败（两轮 AI 翻译各 8 条，第一轮列表脚本 5 条）；1307 条 API 记录，其中 1305 条按采集规则通过、2 条上述警告，失败与丢弃为零；3300 条资源记录通过。四条非零业务码分别为两轮草稿误用翻译预览接口的 `40004` 和两轮脚本预期的第二次公开提交满额 `40004`，没有未归类的非零业务码。并发检查的 `30001` 由独立 API 客户端断言验证，不重复计入浏览器网络数组。

两轮表单分别为 `lp6ARa`、`lgpbMk`，公开答卷分别为 `lpXORN`、`lm7NRB`，无跨轮复用。前轮终态后才提交后轮；自动化脚本哈希和本地产品源码哈希一致，原始运行记录 SHA-256 已核对。最终 Runner 健康，活动批次为空，进程仍是 14:18:36 启动的普通 `node server.mjs`（PID 45443）；期间未重启服务，未启动第三轮。

完整终态证据：`outputs/reports/2026-10-22-draft-preview-two-runs/final-verification.json`。本地后端仍需在具备 PHP/vendor 和测试数据库配置的环境运行 Feature、Pint、PHPStan，前后端配套部署后再验证真实草稿预览提交。
