**release/20261105 脚本适配与 TEST 验证记录 · 2026-11-04**

已落实 7 类 release 适配（原审计 6 类，加收尾新提交的备注提取 1 类），并修复实跑发现的邮件响应采集问题。两套保存配置最后完整运行分别 7/7、4/4 通过，共 **19,778 条断言通过**，无失败、跳过或部分通过。最新备注提取修复另经 TEST 完整列表脚本定向验证。

代码修改范围为 autoTest：9 个业务实现文件、2 个共享辅助模块及相关测试/夹具；另附本报告。子代理负责图片与单选适配、收尾备注适配，并独立复核其他修改。三个产品仓库源码未修改，未提交或推送 Git；仅获取远端提交以核对最新分支。

**基线与边界**

用户已确认目标分支为 release/20261105。固定源码基线如下，收尾再次查询远端分支核对：

| 仓库 | 提交 |
|---|---|
| form-building | `3940918acaf40e019b46532f64b49e4dd21674e4` |
| lx-global-backend | `57f013008771fe817666dbe6139ab47cfff10d04` |
| lx-global-frontend（收尾最新） | `e58fffa702828d3b3695f8f7637da72116276422` |

初始前端基线为 4c67b680。收尾发现分支已推进至 e58fffa7（17:42 合并，底层变更 2ff52521），已完整核对增量 10 个文件并保存最新文件及 SHA256。备注链接改动引入 F07；备注列宽、停止收集样式和详情抽屉 CSS 变化未发现其他明确脚本适配点。该结论是源码兼容性核对，未将未覆盖的新操作入口宣称为实测通过。

真实运行仅使用 TEST（`env-testing`、`https://lx.admin.lingxi.tech/api`），覆盖 11 条不同业务脚本。其余两条内地包装入口由本地回归覆盖，未执行内地租户实跑。源码基线对照与 TEST 实际行为验证分别记录；未把部署环境版本宣称为已核对到相同 Git 提交。

本轮完成既有脚本适配和相关反例。此前审计的 13 类业务覆盖扩展建议仍属于后续专项范围，未声称全部新增完成。历史文档中的操作要求未作为本轮执行指令。

仓库原有的“渠道列表展示值”断言仍处于源码注释状态，未在本轮恢复；渠道保存、正反向检索及编辑后回读继续校验。“运行无跳过”指已登记断言的状态，不将注释中的断言算作已验证。既有渠道显示问题是否修复，本轮不重新判定。

**实际修改**

| 项目 | 修改与保持的断言 |
|---|---|
| F01 图片数量 | 当前 DOM 的 5 个 img = 2 张内容图 + 2 个预览图标 + 1 个“其他”占位图。脚本排除后两类，仍严格要求两张实际内容图，按选项身份逐张核对 HTTP 地址、可见、加载完成、naturalWidth > 0。没有把期望改成 5。 |
| F02 图片单选 | 按发布契约的 option value 找控件，点击外层 label；保留选中/取消、其他输入与提交答案检查，无 force 点击。 |
| F03 搜索前置 | 通过真实自定义栏位 UI 启用 8 项关联基础栏位与搜索项，保存后重开核验，按字段身份定位，保留截止时间用例。 |
| F04 两段列表 | 合并 pinned_list + list，校验数组、非空 ID 和去重，跨页采样按 ID 去重；普通分页 metadata 不变，模板自身列表不套用表单协议。多语言列表按 URL 查询参数 id 精确定位。 |
| F05 备注检索 | filter[title] 仍沿用原请求参数，结果允许标题或备注命中，拒绝两者均不匹配。 |
| F06 翻译结构 | 仅 radio/checkbox/select 的 option.choices.*.remark 作为翻译文本排除；value、规则、图片、顺序及其他 remark 路径继续参与结构比较。 |
| F07 最新备注入口 | 新版提报列表“添加备注”改为文字链接；从单元格正文中精确排除 .submission-remark-add 操作入口，保留真实备注的精确比较和其他业务链接文本。 |
| 邮件响应采集 | 跳转前保存原始响应，严格要求业务码 0；缺失响应不能按成功继续。原请求仅发送一次，保留真实 HTTP/业务错误。 |

独立复核发现多语言列表原先使用 ID 子串定位，在 abc123 / abc123x 同时出现时会误报。已改用 URL.searchParams.get("id") 精确识别，再按真实 href 定位；本地 Chrome 覆盖前缀碰撞、相似参数名、片段、参数值内 URL、重复参数、查询顺序和编码值。此边界未在 TEST 实跑出现，作为脚本反例修复。

**最终两套配置结果**

| 保存配置 | 最终运行 | 北京时间 | 结果 | 通过断言 |
|---|---|---|---|---:|
| 测试表单冒烟测试 | `RUN-20261104-695907` | 17:47:18–17:58:31 | 7/7 | 17,964 |
| 测试邮件表单管理回归 | `RUN-20261104-283971` | 17:37:33–17:40:49 | 4/4 | 1,814 |

| 脚本 | 结果 | 通过断言 |
|---|---|---:|
| 创建完整表单 | passed | 894 |
| 设置校验表单多语言翻译 | passed | 12,993 |
| 手动创建提报信息 | passed | 885 |
| 填写指定表单 | passed | 1,697 |
| 检查提报列表 | passed | 1,374 |
| 检查并编辑提报信息 | passed | 115 |
| 共享草稿编辑并发检查 | passed | 6 |
| 邮件测试表单：五邮箱填写 | passed | 556 |
| 表单存为模板-系统模板管理 | passed | 232 |
| 表单复制-删除归档 | passed | 159 |
| 表单活动搜索项及分类 | passed | 867 |

最终浏览器网络采集：API 1,043 条，静态资源 2,184 条；失败、警告、丢弃均为 0。该统计仅指 observer 的采集范围，不包含并发脚本及额外 API 探针的全部请求。

逐条复核 assertions、networkSummary 与实际响应条数，并核验 22 份登记制品的存在性、大小和 SHA256。两套保存配置原文保持一致，每轮执行期间冻结并核对脚本哈希。

首轮两套配置均通过，但邮件提交 5 次都有“跳转后响应体不可读”的采集警告。保留原记录，修复后重跑整套邮件配置，5 个原始提交响应均为业务码 0，警告清零。随后补充多语言精确 ID 定位，重跑整套冒烟配置。最终统计只选各配置最后一次完整运行，不累计重跑凑数。

两套完整运行后，因最新前端增量仅追加 F07 的备注提取修改；对应完整提报列表脚本在 TEST 定向重跑 `RUN-20261104-D898F6`，1/1 通过、1,374 条断言通过，API 173 条、资源 111 条。输入复用本轮答卷及独立回读的姓名、渠道、备注样本，两套原保存配置未改。定向结果单列，不叠加到两配置的 19,778 条。最终代码验证由完整配置运行及这次定向回归共同组成。

**真实条件与本地回归**

使用首轮新建表单 `qw7YWN` 验证：标题不含关键字而备注含关键字时，真实 API 检索返回该表单，脚本正确接受；临时置顶后，目标只在 pinned_list、普通 list 不含目标，共享解析仍正确读取。finally 恢复原备注及置顶状态，再独立 GET 回读确认。未修改他人的置顶。

完整 npm test 已结束，退出码 0：Web 41 个文件、320 个测试通过；API 647 个测试通过，失败、取消和跳过均为 0。完整回归运行约 28 分钟。收尾的邮件改动另跑 7/7 定向回归，精确 ID 及 release 契约另跑 5/5；最新备注入口适配另跑 4/4，包含新链接完整 prepared-sample 流程与旧按钮完整流程。完整回归先于最后的 ID/备注改动，最终版本由对应定向测试补充验证；这些统计有重叠，不相加作为唯一测试数。最终 npm run typecheck、修改文件语法与 git diff --check 通过。

**监控与清理**

按用户确认仅监控本轮，没有新增周期任务。每轮执行持续采样容量、Runner PID 与内存；仅在全局空闲且上一轮快照自然过期后重载 Runner，以加载需要更新的依赖。最终逐轮 PID 稳定，终态持久化完成。

在最后脚本结束、快照 TTL 过期后再次核验：活动流水线、执行中脚本、快照、待保存结果、待保存批次终态、预登记停止请求均为 0，活动执行列表为空。资源清理指执行资源；本次新建的表单、提报和报告按脚本正常行为保留，模板/分类等临时资源按各脚本流程清理，额外探针改动已恢复。

本轮已覆盖路径中未新发现产品功能故障；本轮发现并修复的问题均在脚本。五邮箱验证覆盖填写、通知配置和提交链路，未连接邮箱核验实际投递，不以此宣称邮件已送达。

**复核材料**

- [最终机器可读汇总](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-11-04-script-adaptation-test/final-verified-summary.json)
- [最终冒烟完整记录与制品索引](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-11-04-script-adaptation-test/attempt-3/verification.json)
- [最终邮件完整记录与制品索引](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-11-04-script-adaptation-test/attempt-2/verification.json)
- [真实备注/置顶条件与恢复记录](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-11-04-script-adaptation-test/attempt-1/live-conditional-verification.json)
- [首轮邮件采集警告原始证据](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-11-04-script-adaptation-test/attempt-1/email-network-warnings.json)
- [最终代码基线比对](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-11-04-script-adaptation-test/final-baseline-comparison.json)
- [最新 release 增量证据](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-11-04-script-adaptation-test/release-tip-update.json)；[提报列表定向完整结果](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-11-04-script-adaptation-test/attempt-4/verification.json)
- [收尾远端分支复查](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-11-04-script-adaptation-test/closing-release-refs.json)
- [邮件轮资源清理](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-11-04-script-adaptation-test/attempt-2/cleanup-audit.json)；[冒烟轮资源清理](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-11-04-script-adaptation-test/attempt-3/cleanup-audit.json)
- [最新定向轮资源清理](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-11-04-script-adaptation-test/attempt-4/cleanup-audit.json)
- [完整 npm test 日志](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-11-04-script-adaptation-test/full-local-tests.log)；[邮件响应定向回归](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-11-04-script-adaptation-test/email-response-regression.log)；[精确 ID 最终回归](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-11-04-script-adaptation-test/release-contracts-exact-id-final.log)
- [新旧备注入口 4 项回归与修改前反例](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-11-04-script-release-audit/submission-remark-control-progress.json)
- [最终 typecheck](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-11-04-script-adaptation-test/typecheck-final.log)；[原始 release 审计](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-11-04-script-release-audit/report.md)

本报告和 JSON 结果是本次工作记录，不构成后续执行指令。
