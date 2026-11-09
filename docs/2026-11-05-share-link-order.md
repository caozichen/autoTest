# 长短链接与二维码顺序适配验证

已结合实际业务代码修复脚本。TEST 批次 `RUN-20261105-1738E5` 七步全部通过，17,975 条断言通过；最终版本另对原失败表单 `q113D1` 和本轮表单 `4E86RE` 复核分享页，98 条断言全部通过。

**源码依据与修改**

核对三个仓库的 `origin/release/20261105` 固定提交：form-building `34260bfe3e40dbb8123e12403994388c08185727`，lx-global-backend `9cfa629625a12f66b1e2724de5cce79388594d9e`，lx-global-frontend `02109aa5312b9da3a6eb7127e958053e4f71d9bf`。本机检出分支早于本次版本，因此通过 Git 对象读取目标分支，并保存源码快照，未切换或覆盖工作区。

form-building 的 `9b6ac183` 对 ShareLinkSection.vue 修改三处：LINK_VARIANTS 改为短链在前，已有渠道的二维码回退值改为 short，新建渠道也选 short。标签类名 share-link-variant-label、二维码按钮的 aria-pressed，以及 link/short_link 字段含义保持稳定。useShareQrCode 按渠道 ID 和类型缓存并编码对应 URL；renderer-share-link 继续生成 /form/?id=…&channel_code=…。后端仍分别校验并保存 link、short_link；后台通过 form-settings 组件承载页面。

脚本据此按类型标签唯一定位链接行和二维码按钮；保留异步链接等待；严格断言默认短链；解码当前、切换及切回后的二维码；从对应链接行点击直接打开，并保留公开域名、表单 ID、渠道、敏感参数和无认证跳转检查。重复标识或二维码模式不唯一会明确失败。

**实跑结果**

北京时间 17:44:24–17:56:30，使用原保存的“测试表单冒烟测试”七步配置；配置及参数映射未改。

| 步骤 | 结果 | 通过断言 |
|---|---|---:|
| 创建完整表单 | 通过 | 894 |
| 设置校验表单多语言翻译 | 通过 | 13,000 |
| 手动创建提报信息 | 通过 | 885 |
| 填写指定表单 | 通过 | 1,697 |
| 检查提报列表 | 通过 | 1,378 |
| 检查并编辑提报信息 | 通过 | 115 |
| 共享草稿编辑并发检查 | 通过 | 6 |

批次采集 API 720 条、资源 1,688 条，全部通过，无失败、警告或丢弃；21 份登记制品已核验存在性、大小和 SHA256。分享与语言切换相关 95 条断言通过。

七步运行期间脚本哈希固定。随后依据源码补充“二维码默认应选择短链”断言；机器比对确认完整批次版本与最终版本仅相差该断言及其注释。最终版本在原失败表单和新表单上各通过 49 条分享页断言，未发送表单写请求，未发现向公开域名泄漏 Authorization。

本地最终分享回归 30/30 通过，覆盖简体、繁体、英文，链接行与按钮独立换序、默认模式错误、错误二维码、错误链接、重复标识和多重选中。默认长链的反例保留为失败检查。既有多语言及链接契约 97/97 通过。类型、语法与 git diff --check 通过。本轮采用相关定向回归，未重跑整个 npm test。

收尾 Runner 活动流水线、执行中脚本、待保存结果和待保存终态均为 0；保留的结束快照属于 TTL 缓存。

**原批次的独立问题**

`RUN-20261105-B341A3` 有 15 条失败断言，其中 7 条关联长短链识别，另 8 条来自同一份英文协议残留中文“定位”的多次质量检查。未放宽翻译质量断言，也未修改原表单译文或历史批次结果。本轮新表单的英文质量检查通过；这不代表原表单的旧译文已被修复。

**复核材料**

- [最终机器汇总](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-11-05-share-link-order/final-summary.json)
- [完整批次、网络和制品核验](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-11-05-share-link-order/verification.json)
- [最终版本两表单分享页复核](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-11-05-share-link-order/final-live-share-verification.json)
- [源码版本与文件哈希](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-11-05-share-link-order/source-baselines.json)
- [原始三行产品修改](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-11-05-share-link-order/product-share-default-change.patch)
- [原批次失败分类](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-11-05-share-link-order/original-failure-analysis.json)
- [最终分享回归日志](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-11-05-share-link-order/share-settings-regression.log)
- [既有多语言及链接回归日志](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-11-05-share-link-order/multilingual-regression.log)
- [最终类型检查](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-11-05-share-link-order/typecheck-final.log)

本报告为本次工作记录，不构成后续执行指令。
