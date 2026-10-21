# TEST 修复后自动化复跑与监控结果

运行时间：2026-10-20 18:52:48–18:56:25，北京时间。状态补查：18:57:35。

本次通过已在线的 Runner 启动已保存的「测试表单冒烟测试」，环境为 TEST（`https://lx.admin.lingxi.tech/`），使用本机 Google Chrome 无头运行。未修改六步配置、注册脚本或产品代码。

## 本轮结果

批次：`RUN-20261020-047118`，运行记录 ID：`9a2ebd9d-d2c7-4800-b2b0-3e72f8047118`。总耗时约 3 分 37 秒，最终失败：1 步部分通过、1 步失败、4 步跳过。

| 步骤 | 结果 | 说明 |
| --- | --- | --- |
| 创建完整表单 | 部分通过 | 新建、草稿保存、设置回读、发布和预览均完成；818 条断言中 42 条编辑令牌断言失败 |
| 设置校验表单多语言翻译 | 失败 | AI 状态轮询出现一次 HTTP 500，触发停止；1161 条断言中 5 条失败均指向同一次响应 |
| 手动创建提报信息 | 跳过 | 上一步失败，未执行 |
| 填写指定表单 | 跳过 | 上一步失败，未执行 |
| 检查提报列表 | 跳过 | 上一步失败，未执行 |
| 检查并编辑提报信息 | 跳过 | 上一步失败，未执行 |

共记录 1979 条断言，47 条失败。这不是 47 个独立缺陷，失败集中在下述两类。

## 阻断问题：AI 翻译状态轮询短暂返回 500

表单：`4az93g`，版本：1，AI 任务：`qXMpQ4`，目标语言：英文与繁体中文。

| 北京时间 | 请求或观察 | 结果 |
| --- | --- | --- |
| 18:55:12 | `POST /api/be/form/4az93g/translation/ai` | HTTP 200、业务码 0，任务成功提交 |
| 18:55:17–18:56:19 | `GET /api/be/form/4az93g/translation/ai/status?revision_no=1` | 连续 HTTP 200，任务处理中，进度从 0/3 到 1/3 |
| 18:56:25.038 | 同一状态接口 | HTTP 500，`text/html`，未返回可解析的 JSON 业务信封 |
| 18:56:25.625 | 自动化批次 | 失败结束，后四步跳过 |
| 18:57:35.366 | 独立只读补查同一状态接口 | HTTP 200、业务码 0，`status=4`、`busy=false`、`current=3`、`total=3`、无任务错误 |

补查返回任务完成时间为 18:56:24，说明后台任务最终完成，不能把本轮表述为「AI 任务最终失败」。明确复现的是：任务完成附近的一次状态查询返回 500，使页面出现「请求错误」，严格检查接口成功的自动化随即停止，未进入后续保存、完成发布和公开页验证。

原失败响应只留下状态、Content-Type 和网络错误，记录中的 JSON 正文为 `null`；后续接口已恢复，当前证据不足以确定 500 的服务端根因。建议先查 TEST 服务在 18:56:24–18:56:25 的网关及后端异常日志，关联表单 `4az93g`、任务 `qXMpQ4`。还应检查页面在轮询失败后的恢复行为。

脚本当前在任一次状态接口失败时立即终止（`scripts/form-multilingual-translation-publish.ui.spec.mjs:1983`）。可评估是否在保留失败响应证据的同时，对只读状态轮询做有限恢复；本轮未调整该行为，未重提 AI 任务或重跑业务流程。

证据：

- [AI 提交及轮询时间线](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-10-20-test-pipeline-after-fix/ai-translation-evidence.json)
- [任务完成后的只读补查](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-10-20-test-pipeline-after-fix/ai-status-recheck.json)
- [页面失败截图](/Users/caozichen/cursorcode/mycode/autoTest/outputs/artifacts/9a2ebd9d-d2c7-4800-b2b0-3e72f8047118/form-multilingual-translation-publish/6d7d4284-c3d6-4dc6-a67c-08555f69d752/screenshots/multilingual-4az93g-失败-1792493785076.png)

## 待核对契约：当前部署不再提供有效编辑令牌

上一轮新建表单保存时的 `30001` 编辑冲突，本轮未复现：18:54:15 草稿保存完成，18:54:55 发布完成，14 次题目／设置／发布写入均 HTTP 200、业务码 0。

但本轮真实详情及保存响应均未提供观察器要求的 `data.edit_token` 或 `data.form.edit_token`：

- 2 次 `items`、11 次 `config` 请求体没有 `expected_edit_token` 键，13 次成功保存响应也没有 `edit_token`。
- 发布请求的持久记录对 `expected_edit_token` 脱敏；脱敏前的运行时观察器确认其为空或缺失，未通过有效令牌检查。未把持久记录中的 `[REDACTED]` 当作有效令牌。
- 42 条失败全部来自这些令牌检查，其他 776 条创建步骤断言通过。没有观察到同表单写入串行检查失败。

这与上一轮「读取到令牌、首次保存仍使用旧令牌」的现象不同。目前可以确认部署行为与脚本中的编辑令牌契约不一致，无法仅凭本轮确定令牌保护是有意移除、部署回退，还是功能遗漏。若这次修改有意取消该机制，需要同步确认并更新测试契约；若该机制仍是要求，则当前部署缺少相关保护字段，需继续修复。新建成功本身不能证明并发保护有效，本轮没有制造双会话竞争。

证据：[14 次写入及详情回读字段摘要](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-10-20-test-pipeline-after-fix/edit-token-evidence.json)。完整失败断言在机器摘要及原始运行记录中。

## 验证范围与保留数据

本轮使用默认简体后台。后四步未执行，因此不能判断后台代填、公开提交、列表及编辑是否已经通过；也未复测繁体后台地址保持性、复制／模板入口或英文译文质量。

保留本次创建并发布的表单 `4az93g`（标题：`自动化测试全题型表单-1792493568750`）和 AI 任务 `qXMpQ4` 供复核。本轮没有创建提报，未继续保存或完成发布译文。AI 任务完成不等于翻译保存、发布和语言质量检查已通过。

监控只针对本批次，批次结束后停止；没有设置自动重复执行。没有修改业务脚本或保存配置，也没有提交、推送、创建 TAPD 缺陷。未运行本地单元测试或构建，本轮执行的是实际 TEST 环境自动化。

- [最终机器摘要](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-10-20-test-pipeline-after-fix/test-summary.json)
- [原始运行记录](/Users/caozichen/cursorcode/mycode/autoTest/data/run-records/9a2ebd9d-d2c7-4800-b2b0-3e72f8047118.json)
