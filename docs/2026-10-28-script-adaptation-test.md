# 国际版脚本适配与 TEST 验证记录

日期：2026-10-28。依据此前的[脚本影响评估](/Users/caozichen/cursorcode/mycode/autoTest/outputs/code-change-script-audit-20261028/国际版改动-脚本功能与断言影响评估.md)，本次完成 3 项必改脚本、公开填写上下游契约联动，以及相关回归夹具适配。TEST 主链 7 步全部通过，运行记录中 17,861 条断言通过、0 失败、0 跳过；该数字包含参数化、网络和资源检查，不是独立业务场景数。

## 已修改的行为

| 评估项 | 实现与结果 |
|---|---|
| M01–M02：列表详情姓名定位及回读 | 根字段和题组字段分别定位；新 DOM 按 group_code、实际 group_index 和精确字段名匹配，API 按 item_key 与题组身份取值，不依赖遍历顺序。 |
| M03–M05：后台创建后的题组姓名、手机、邮箱 | 支持“题组 / 第 1 组 / 字段名”标题；三字段均必须找到唯一目标行并执行值匹配。 |
| M06：编辑前详情校验 | 初始化详情使用共享身份定位；保留保存、刷新后的 DOM/API 完整答案快照与持久性检查。 |
| GATE01：防止静默漏检 | 详情必须完成全部 17 项计划简单字段检查；目标缺失会记录失败，并触发完整性门禁。原有复杂字段、矩阵和附件检查继续执行。 |
| CONTRACT01：上下游契约 | 公开填写增加 fieldIdentities，使用当前表单的动态题键；列表和编辑同步解析并验证。旧 fields JSON 和无题组属性的旧版详情继续兼容。 |

核心实现为 [submission-detail-fields.mjs](/Users/caozichen/cursorcode/mycode/autoTest/scripts/support/submission-detail-fields.mjs)、[手动创建](/Users/caozichen/cursorcode/mycode/autoTest/scripts/form-submission-reply-create.ui.spec.mjs)、[列表检查](/Users/caozichen/cursorcode/mycode/autoTest/scripts/form-submission-list-check.ui.spec.mjs)、[编辑](/Users/caozichen/cursorcode/mycode/autoTest/scripts/form-submission-reply-edit.ui.spec.mjs)、[公开填写](/Users/caozichen/cursorcode/mycode/autoTest/scripts/form-lpxavn-submit.ui.spec.mjs)。DOM 当前没有 item_key 属性，因此 DOM 在指定题组内使用精确字段名；出现同名歧义时失败，列表 API 回读另核对题键。

额外增加两类覆盖：图片、文件的公开配置要求 min_file_quantity=1；成功结果页按完整公开配置独立计算绿色贡献（描述有效行、静态可回答题目数、系统系数和供应商），并检查关闭、失败、缺参数时不展示。绿色贡献校验同时接入[五邮箱共享实现](/Users/caozichen/cursorcode/mycode/autoTest/scripts/form-email-five-submit.ui.spec.mjs)，内地包装入口继承此逻辑。

本次落实的是上述现有脚本适配。此前建议的 **18 个功能域、81 项新增覆盖尚未全部实现**；上传部分也未完成 U01–U06 的完整边界矩阵，绿色贡献未完成各语言的真实提交矩阵。运营、微信授权、导出等新增链路属于后续覆盖工作。

## TEST 真实验证

- 环境：TEST，机构 API 为 `https://lx.admin.lingxi.tech/api`。
- 执行 ID：`45096ba7-1f7f-4442-a7f9-18f65863b25e`。
- 执行时间：2026-10-28 15:47:51–15:58:10（Asia/Shanghai）。
- 新建表单：`vb2DyN`；手动提报：`4oGN1g`；公开提报：`4VW0EX`。

| 流水线步骤 | 结果 | 记录断言数 | 关键证据 |
|---|---|---:|---|
| 创建完整表单 | 通过 | 873 | 动态全题型表单创建、配置与发布。 |
| 多语言翻译发布 | 通过 | 13,001 | AI 翻译、保存回读、发布、公开预览和三语言分享检查。 |
| 手动创建提报 | 通过 | 854 | 48 项详情值检查；题组姓名、手机、邮箱唯一定位和全部计划字段门禁均实际通过。 |
| 公开填写 | 通过 | 1,638 | 动态 fieldIdentities 输出；首次结果与刷新结果的绿色贡献数值、供应商均通过；第二次填写被数量上限拦截。 |
| 提报列表 | 通过 | 1,374 | 新题组身份、详情、检索项、联系人与鉴权检查。 |
| 检查并编辑提报 | 通过 | 115 | 对同一答卷执行保存，刷新核对复杂答案、矩阵与附件保持一致。本轮为默认 unchanged 编辑模式。 |
| 共享草稿编辑并发 | 通过 | 6 | 旧令牌保存、发布冲突与配置恢复检查。 |

真实五邮箱邮件流水线未另行执行；它的变更通过本地五邮箱回归和真实公开填写的共享绿色贡献检查验证。本次未将该结果表述为 13 个注册脚本均已在 TEST 重跑。

## 本地回归与最终源码复核

| 检查批次 | 结果 | 日志 |
|---|---|---|
| 公开填写契约、完整运行、五邮箱、编辑包装、字段身份、绿色贡献 | 58/58 通过 | [final-contract-tests.log](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-10-28-script-adaptation/final-contract-tests.log) |
| 创建与编辑完整回归（修正夹具后） | 16/16 通过 | [final-create-edit-tests.log](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-10-28-script-adaptation/final-create-edit-tests.log) |
| 列表契约与完整检索，输入新身份 | 2/2 通过 | [final-list-identity-tests.log](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-10-28-script-adaptation/final-list-identity-tests.log) |
| 注册契约与配置回归 | 8/8 通过 | [config-tests.log](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-10-28-script-adaptation/config-tests.log) |
| 最终身份 helper：多题组、乱序、缺失、旧页面、英文姓名 | 4/4 通过 | [identity-tests-final.log](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-10-28-script-adaptation/identity-tests-final.log) |
| 类型与语法检查 | 通过 | [typecheck-final.log](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-10-28-script-adaptation/typecheck-final.log) |
| git diff --check | 通过 | 最终工作区检查。 |

这些批次包含重复用例，不相加为独立用例总数。未运行整个仓库的 npm test。首轮 88 项定向回归曾有 3 项测试夹具失败：新加入的题组行误用了浏览器脚本中不存在的 fieldKeys 变量；编辑反例仍假设有两条裸“姓名”。已分别改为正确的 keys 变量、显式错误值反例，并将所在创建/编辑 16 项全部重跑通过。生产断言没有因此被放宽。

源码时序说明：流水线启动后，helper 的旧输入映射修正为第 N 个引用对应实际第 N-1 组；当时尚未进入受影响步骤。随后 15:54:41 增加英文 Name 标签兼容时，手动创建已开始，Runner 已缓存前一版本。故本轮不能声称所有步骤全程使用最终 helper。最终于 **16:00:39** 用独立 Node/Chrome 进程在同一 TEST 答卷执行只读检查，验证最终 helper 的根级、题组姓名与前序输出一致，题组姓名实际值匹配，手机与邮箱行唯一且有值；8 条记录断言通过。校验期间 helper SHA-256 保持 `51e5cb40842a52d0c31de9905c42ae6f07955b980180c913a64cad48a17b9098`，并另通过英文和旧输入本地反例。

独立复核最初把带称谓的姓名显示当成纯姓名做全等比较；根据测试数据中已选择的 `Mr.（先生）` 修正补充检查的完整预期后通过。该预检问题未改动业务脚本。早期 GET /be/form 的 405 也源于预检方法不支持；已使用实际表单与答卷详情 GET 验证 HTTP 200、业务码 0，不计为系统缺陷。

## 结果与证据

本次验证范围内未发现需要修改五个产品仓库的系统缺陷。修改均落在 autoTest；没有删除失败断言或放宽业务预期，没有提交或推送。本轮创建的测试表单及两份答卷保留用于复核；并发脚本按自身流程恢复头图开关，并保留生成的未发布草稿。

- [流水线原始记录](/Users/caozichen/cursorcode/mycode/autoTest/data/run-records/45096ba7-1f7f-4442-a7f9-18f65863b25e.json)
- [流水线摘要](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-10-28-script-adaptation/45096ba7-1f7f-4442-a7f9-18f65863b25e-summary.json)
- [执行源码与最终复核清单](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-10-28-script-adaptation/environment-runs.json)
- [最终源码 TEST 只读复核](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-10-28-script-adaptation/final-detail-verification.json)
- [详情截图](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-10-28-script-adaptation/final-test-detail.png)
