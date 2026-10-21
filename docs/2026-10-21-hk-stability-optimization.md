# 香港批次间歇性失败对比与导航采集优化

## 对比结论

`RUN-20261021-968489` 已于北京时间 **18:32:59** 完成，7 步全部通过；`RUN-20261021-F48AED` 于 **18:06:07** 失败，1 步通过、1 步失败、5 步跳过。两批均为 HK_PROD，流水线配置 fingerprint 相同，已记录的管理端入口脚本路径集合相同。这不等于已经核实所有运行源码哈希完全一致。

成功与失败的主要差异在翻译页跳转分享页时的请求重叠，不能简单归因为整批网络快慢。正常管理端 HTTP 200 接口的耗时中位数为 272ms（成功）与 260ms（失败）。

以下以分享页 document 请求开始为 0ms，完成时间由请求时间与采集耗时估算：

| 对照点 | 成功 968489 | 失败 F48AED |
| --- | --- | --- |
| 最后一次英文工作区 GET | 耗时 365ms，在 −93ms 完整结束 | 耗时 1570ms，在 −201ms 完整结束 |
| 导航附近的 AI status | 未记录到这一轮询 | −209ms 发出，+103ms 正文读取失败；HTTP 200 |
| 导航开始后旧页追加工作区 GET | 未记录到 | +10ms 发出，始终没有终态；175,581ms 后封账为 timeout |
| 正文采集告警 | 公开表单接口正文于 +91ms 丢失 | AI status 正文于 +103ms 丢失 |
| 多语言 API 汇总 | 233 正常、0 失败、1 告警 | 227 正常、1 失败、1 告警 |

成功批次仍存在采集缺口。其 API sequence 189 为管理翻译页发起的公开域名 `/api/f/form/vrYYel?only_form=1`，响应 HTTP 200，但跳转后 `Network.getResponseBody` 无法读取正文。成功批次还在 18:27:31.225 记录过一次跳转前等待 **135,000ms** 超时；当时记录没有保存具体阻塞候选，无法追溯究竟哪个请求阻塞了这次等待。

失败批次的 API sequence 229 为旧英文页在分享导航开始后追加的 GET。`status=0` 是观察器对未完成请求封账的记录，不能解释为服务器返回 HTTP 0。其分享、预览和三语言切换已有成功证据，最终阻断点是关闭前必要响应完整性检查。

因此，证据支持**香港请求时序与导航采集边界共同导致间歇性失败**。成功一次不能证明采集缺口已消失，当前证据也不足以确认香港后端功能故障。

## 本次修改

只在香港多语言管理页启用以下策略：

1. 跳转前等待已发出的 AI status 请求，即使还没有响应头；相关响应完整结束后，保留 **500ms** 稳定窗口，接住页面处理响应后追加的工作区刷新。
2. 管理页等待来源包括管理 API 与已配置的公开表单域名，覆盖成功批次暴露的跨域正文缺口；其他页面和不相关来源不纳入这个等待。
3. 在新文档真正提交时更新请求归属，避免把导航开始后、旧文档结束前追加的 GET 当成新文档请求。只有被新文档替代的 GET/HEAD 可以退出当前页等待；未完成的写请求继续参与检查。

TEST 与 CN_PROD 保持原来的响应头前提、0ms 稳定窗口、管理 API 来源集合和导航请求开始时的代次策略。香港沿用已有三倍超时，本次没有再增加总体超时。

没有拦截、改写或重放业务请求。HTTP 500、HTTP 200 业务拒绝、未完成写请求、网络取消及正文读取失败的原始证据仍保留原有校验；没有统一忽略错误或放宽业务断言。已终态的导航取消仍按现有完整性检查处理，本次没有给所有 aborted/ignored 记录新增豁免。

135 秒等待的具体阻塞对象在历史记录中缺失，本次不能证明已定位或消除这一停顿，也不能承诺消除香港所有网络波动。

## 验证与应用

- 相关回归与新增用例合计 **173 项通过**：多语言脚本 90 项；原导航、页面完成检查及正文回归 15 项；记录器回归 47 项；新增香港观察器 13 项；新增真实 Chrome 慢网络用例 8 项。
- 新增 Chrome 用例使用本地 HTTP 服务，覆盖无响应头 AI 请求、延迟刷新、跨域公开接口、旧文档 GET、HTTP/业务错误仍阻断关闭、等待上限及取消；记录器用例补充未完成写请求不能被旧文档过滤。
- TEST、CN_PROD 与 HK_PROD 并行等待验证通过；typecheck、语法检查及 diff 检查通过。
- 先在隔离 worktree 实现并验证，确认 Runner 无活动批次且原文件哈希未变化后，已同步回主工作目录；保留此前 Identification 与静态 JSON 分类修改。
- 没有重跑、取消或修改任何生产批次；968489 成功发生在本次修改应用之前，不能作为新策略的线上验证。效果需要由后续真实批次观察确认。

## 证据与文件

- [两批对比数据](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-10-21-hk-stability/comparison.json)
- [成功批次原始快照](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-10-21-hk-stability/968489-record.json)
- [失败批次原始快照](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-10-21-hk-stability/f48aed-record.json)
- 实现：`scripts/support/api-response-recorder.mjs`、`scripts/support/page-response-completion.mjs`、`scripts/form-multilingual-translation-publish.ui.spec.mjs`。
- 新增验证：`apps/api/hong-kong-network-observer.test.mjs`、`apps/api/hong-kong-navigation-response.test.mjs`。
