# 未保存修改保护：自动化兼容范围核查

核查日期：2026-10-22。起点为 `RUN-20261022-B7F49A`，核对 autoTest、form-building、lx-global-frontend 和 lx-global-backend 当前本地源码。下文缺口表保留修复前的核查结论及行号；末尾记录本次自动化脚本更新。没有重跑真实业务流水线，没有修改三个产品仓库。静态适配缺口不等于每条路径都已在环境中复现失败。

## 数量与统计口径

按 `config/scripts/*.json` 的注册入口统计，共 13 个启用脚本：

| 分类 | 数量 | 脚本 ID |
| --- | ---: | --- |
| 存在未覆盖的导航保护路径 | 5 | `form-all-fields-publish`、`form-all-fields-publish-mainland`、`form-email-five-submit`、`form-email-five-submit-mainland`、`form-save-template-management` |
| 已有发布前保存弹窗处理，等待方式需要加固 | 1 | `form-copy-delete-archive` |
| 使用独立的翻译离开保护，本次未发现同一弹窗的直接接入点 | 1 | `form-multilingual-translation-publish` |
| 当前流程没有进入受此次保护约束的设计器或设置编辑导航 | 6 | `form-activity-search-category`、`form-all-fields-submit`、`form-edit-concurrency`、`form-lpxavn-submit`、`form-submission-list-check`、`form-submission-reply-create` |

因此，连同本次失败的全题型入口，有 **5 个已注册入口存在新增适配缺口，另 1 个入口有已有适配的加固点**。5 个中的模板脚本同时有一个发布弹窗等待加固点，不能重复算作新增入口。

此外，未出现在当前注册目录中的旧脚本 `scripts/form-contact-publish.ui.spec.mjs` 也有同类缺口，单独记录，不计入 13 个注册入口。

## 当前产品契约

### 导航保护并非每次切换都弹窗

- `lx-global-frontend/src/utils/form-activity/confirm-navigation.ts:12`：无改动直接放行；选择保存后，必须保存成功且再次判断无改动才放行；取消或保存失败保留原页。
- `lx-global-frontend/src/composables/form-activity/use-form-navigation-confirm.ts:25`：宿主 Arco 弹窗提供“保存并切换”“不保存并切换”，关闭等于取消；同一时间只允许一项确认。
- `lx-global-frontend/src/views/form-activity/form/designer/index.vue:921`：设计器路由离开、换表单 ID 共用保护；进入基础设置还会验证可采集题目。
- `lx-global-frontend/src/views/form-activity/form/settings/index.vue:327`：设置页路由离开、同一路由的步骤/hash 变化以及组件内部栏目切换共用保护。
- `form-building/apps/form-settings/src/views/settings/Index.vue:412`：内部菜单要等宿主 `beforeNavigate` 放行才更新栏目；当前栏目重复点击直接返回。

文案有三种：简体“保存并切换”、香港繁体“儲存並切換”、英文“Save and switch”。定位时应限定目标弹窗，不能匹配页面任意“保存”或“确认”按钮。

### 保存成功后的状态仍需检查

- `form-building/apps/form-designer/src/composables/use-designer-draft-state.js:24` 按业务载荷与保存基线比较；保存中的后来修改应保留，一次性上传标识、版本号等不计入业务改动。
- `lx-global-frontend/src/views/form-activity/form/designer/index.vue:1007` 顺序保存 items 和 config，接受每一步的新 edit token；两步成功后在 `:1032` 用实际提交 schema 更新保存基线。
- `form-building/apps/form-settings/src/App.vue:185` 汇总当前视图业务改动与未完成富文本上传；`saveBeforeLeave` 等待上传并保存当前视图。
- `lx-global-frontend/src/views/form-activity/form/settings/index.vue:452` 保存后重新检查设置页未保存状态。

所以“已经保存、期间没有新修改，离开时仍弹窗”应保留为异常证据，不能一律自动补存后视为全部通过。本次记录只有保存响应与最终弹窗，没有保存前后完整的内存 schema 差异，仍不能据此确定具体哪个前端字段导致了未保存判断。

### 后端与发布边界

- `lx-global-backend/app/Services/Form/FormItemService.php:77`、`app/Services/Form/Config/FormConfigService.php:109` 是现有保存入口，继续使用 items/config，保存响应包含 `revision_no`、`edit_token`。
- `lx-global-backend/docs/form/form_lifecycle.md:68` 规定共享草稿、编辑令牌连续推进及冲突后重新读取核对。导航兼容应复用页面正常保存链路；冲突不能通过自动刷新令牌并重复覆盖来消除。
- `lx-global-frontend/src/views/form-activity/form/settings/index.vue:593` 设置页发布会先调用离开前保存，再执行发布，并在成功跳转时使用重定向状态放行。当前无需把每一个设置页发布按钮都算成缺失“保存并切换”弹窗处理。
- 翻译页 `src/views/form-activity/form/translation/index.vue:1179` 使用独立的放弃译文确认；完成发布的主动跳转有单独放行标志，不能套用设计器的按钮文案。

## 自动化接入位置

### 直接缺少弹窗分支的三处导航实现

| 位置 | 当前操作 | 影响 |
| --- | --- | --- |
| `scripts/form-all-fields-publish.ui.spec.mjs:1099` | 点击基础设置后直接 `waitForURL` | 本次失败点；内地全题型、国际版邮件、内地版邮件均复用该实现，共影响 4 个注册入口 |
| `scripts/form-save-template-management.ui.spec.mjs:369` | 保存模板后点击 `.designer-back-btn`，直接等列表 URL | 影响模板管理注册入口；保存后仍有改动时会停在保护弹窗 |
| `scripts/form-contact-publish.ui.spec.mjs:226` | 旧联系人脚本独立实现基础设置跳转 | 未注册旧脚本；不随共享全题型函数自动修复 |

前两处覆盖 5 个注册入口。内地 wrapper 和邮件 wrapper 应沿共享函数修复，避免重复实现。

### 设置页内部栏目与顶部步骤

以下位置经过相同的保护入口，但当前只等待可点击或目标内容，没有等待“目标已到达 / 导航确认已出现”的明确结果。正常保存后应直接切换；仍有改动时应明确识别并按该测试的保存策略处理。

| 位置 | 操作与适用入口 |
| --- | --- |
| `scripts/form-all-fields-publish.ui.spec.mjs:1112` | 切到收录联系人栏目；国际版全题型、邮件复用 |
| `scripts/support/form-post-collection-settings.mjs:130` | 切到填报设定，随后配置数量限制；全题型及内地版复用 |
| `scripts/support/form-post-collection-settings.mjs:279` | 从分类标签切到权限设定；全题型及内地版复用 |
| `scripts/support/form-post-collection-settings.mjs:283` | 从基础设置切到消息及触达；全题型及内地版复用 |
| `scripts/support/form-submission-period.mjs:64` | 切到填报设定，随后配置时间段；邮件及内地版复用 |
| `scripts/form-email-five-submit.ui.spec.mjs:363` | 保存时间段后切到消息及触达；两个邮件入口复用 |
| `scripts/form-contact-publish.ui.spec.mjs:235` | 旧脚本切到收录联系人栏目 |

`scripts/form-all-fields-publish-mainland.ui.spec.mjs:59` 与 `scripts/support/form-post-collection-settings.mjs:163` 也点击填报菜单，但当前常规调用顺序下可能已是同一栏目。组件对同栏目点击直接返回，不能把这两个点击直接认定为额外的必现失败点；统一菜单导航封装可以一并覆盖。

### 整页跳转和刷新：验证保存边界

| 位置 | 现状 | 建议 |
| --- | --- | --- |
| `scripts/support/form-settings-channels.mjs:86` | `page.goto` 直接进入分类标签 | 该路径更换文档，不验证 Vue 栏目切换守卫。若要覆盖栏目导航，应点击菜单并等待结果；保留整页进入时，进入前应确认保存完成 |
| `scripts/support/form-settings-channels.mjs:170` | `page.goto` 直接进入分享页 | 同上；此处从消息配置切换，应保证先前反馈和推广等均已保存 |
| `scripts/support/form-post-collection-settings.mjs:153` | 保存数量限制后刷新 | 保留独立回读用途，确认保存结束后再刷新 |
| `scripts/support/form-settings-channels.mjs:58` | 分类、渠道保存后共用 `reloadDetail` | 同上；刷新验证不能替代正常 UI 切换保护测试 |

这些路径不应被报告为已复现同一个 Arco 弹窗。整页离开使用原生 `beforeunload` 保护，与宿主 Arco 导航确认是两套机制；整页跳转和刷新不能替代正常 UI 导航验证。

### 已有的两处发布确认处理需要加固

| 位置 | 问题 |
| --- | --- |
| `scripts/form-copy-delete-archive.ui.spec.mjs:257` | 点击发布后仅执行一次 `unsavedDialog.isVisible()`；弹窗晚出现会漏掉，之后一直等发布接口 |
| `scripts/form-save-template-management.ui.spec.mjs:460` | 同样的一次性可见判断；该脚本还具有前述返回列表缺口 |

这两处已经处理“保存后发布”，不同于完全没有处理“保存并切换”。建议等待“发布响应 / 保存后发布弹窗 / 明确业务错误”之一，再进入对应分支，继续验证保存业务码与最终发布结果。

## 推荐实现与验收范围

1. 增加专用表单导航辅助函数：触发操作一次，在同一超时预算内等待目标页面/栏目或指定确认弹窗，按明确策略保存，最终验证目的地。保留错误消息和失败截图；不要重复点击导航或重复保存。
2. 页面或栏目点击接入该辅助函数；`clickWhenReady` 继续只负责加载状态和可点击性，它目前不会处理业务弹窗，也不适合全局自动确认。
3. 保存草稿场景增加“已保存内容应直接离开”的断言；对于确实允许尚未保存的流程，才执行保存并切换，并核对真实 items/config 响应、版本和 token。选择保存后仍不能离开时立即报告原因。
4. 整页跳转和刷新验证保存边界；两处发布确认改为等待分支结果。三种管理端文案均要能识别。
5. 最小回归覆盖：无弹窗直接到达、延迟弹窗、保存成功后到达、保存/校验失败留在原页、保存过程中发生新修改、取消/放弃、同页栏目与顶部步骤、后端编辑冲突、发布确认延迟，以及实际 wrapper 的共享调用。

## 审计阶段已执行验证（不包含本次脚本修改）

- `form-building`：`node --test packages/form-core/test/designer-unsaved-changes.test.js`，9/9 通过。
- `lx-global-frontend`：`./node_modules/.bin/tsx --test test/form-navigation.test.ts`，28/28 通过。
- 核对当前注册目录、脚本实际导入关系、设计器/设置/翻译导航调用链及后端保存契约。
- 未运行真实流水线或 PHP 数据库测试；本次未改业务代码。上述 37 项单元测试证明当前局部规则，不能替代完整表单真实页面回归，也不能证明目标环境部署与本地源码完全一致。

## 本次脚本修复

- 新增 `scripts/support/form-navigation.mjs`，在同一超时预算内等待实际目标、保存确认或保存失败。每次导航、确认各只点击一次；识别简体、香港繁体、英文文案，允许原弹窗在保存及关闭动画期间继续显示，避免误报为再次弹窗。
- 通过页面正常保存链路处理“保存并切换”，校验真实 items/config 业务响应、草稿版本及连续保存的编辑令牌；保存失败、冲突、缺失保存步骤或目标未到达时停止，不自动覆盖或反复保存。
- 已保存后意外出现未保存确认时，Runner 保留失败断言，并在页面保存成功后继续。这类运行仍是“部分通过”；离开前的确允许未保存时可显式设置 `expectSaved: false`。
- 全题型及内地版、五邮箱及内地版共享基础设置入口；收录联系人、填报设定、分类标签、权限通知、消息和分享均接入专用导航函数。分类与分享移除整页 `goto`，通过正常菜单或顶部步骤切换。旧的未注册联系人脚本同步更新。
- 模板修改后返回列表接入保存保护；模板生成和复制表单发布共用等待“真实发布响应 / 延迟保存后发布确认 / 接口失败”的实现，并保留标题、发布 ID、状态和列表回读断言。发布响应正文在网络响应到达时读取，避免跳转后的正文读取竞争。
- 数量限制、分类标签和分享渠道刷新回读前只读检查公开的未保存状态；原生 `beforeunload` 出现时取消刷新并失败，保留页面内容。空白设计器初始化失败时的现有一次性重载保持原流程。
- 增加 `apps/api/form-navigation.test.mjs`，覆盖直接导航、三种语言的延迟弹窗、保留失败断言并继续、真实保存及 token 链、冲突、缺失 config、校验失败、新修改、重复弹窗、同栏目、顶部步骤、直接/延迟发布和刷新保护。按用户要求，本次不执行这些用例，也不运行原有测试、业务脚本或流水线。

验证结果：11 个新增或修改的 `.mjs` 文件均通过 `node --check` 语法检查，`git diff --check` 通过。这些静态检查不代表浏览器或目标环境回归已通过。未重启本地服务。手动运行前需等待活动任务结束并重启 Runner：入口按 attempt 动态导入，但共享依赖仍使用 Node 模块缓存，正在运行的 Runner 可能保留旧版共享函数。
