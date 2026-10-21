# 三项测试问题的 Git 归因核查

核查日期：2026-10-20，Asia/Shanghai。下文时间均为北京时间（UTC+8）。远端分支于 11:31 前完成只读查询及 fetch，未切换或合并工作分支。

## 结论

| 问题 | 可以确认的作者／归因 | 时间与分支 |
| --- | --- | --- |
| 新建表单首次手动保存报编辑冲突 | 跨仓库令牌机制未配套。侯正春写了后端、宿主前端改造，也写了组件配套修改；当前组件 release 没有包含配套修改。不能据此确定是谁决定漏合组件 | 相关代码提交于 2026-09-29；主站前后端于 2026-10-14 从 `feature/mcp` 进入当前发布历史，组件所需提交仍留在 `feature/feature-mcp-authorization-ui` 等历史分支 |
| 复制／模板建表从设计器发布不带令牌 | 与上一项相同的组件配套缺失。设计器发布的令牌修复已经由侯正春写在 `45db3de1`，不是单凭旧发布代码的 blame 就能归给旧代码作者 | 组件配套提交时间为 2026-09-29 20:46:55；2026-09-30 10:56:45 合入过 `release/20260930`，但当前 `release/20261016` 不包含 |
| 繁体后台不修改答案直接保存，地址简体名称变繁体 | 可以直接定位到 **bill** 的 `f64037cf`：新增首次回填跨语言地址时自动写回答案模型的逻辑 | **2026-09-15 14:37:49**，来自 **`feature/ai-assistant`**；**2026-09-15 16:14:44** 合入 **`release/20260915`**，随后被当前 release 继承 |

前两项属于同一组跨仓库集成问题，不能准确表述成“侯正春没写组件修复”。第三项的 Git 身份为 `bill <313032758@qq.com>`，本次没有证据将它映射为某个中文实名。

## 核查范围与最新版本

| 仓库 | 本地工作区 HEAD | 已刷新远端 `origin/release/20261016` |
| --- | --- | --- |
| lx-global-backend | `6fd1c116dbc894c3bc3b2fc13aa50c30da40f0c7` | `8c9224869d46d712212710eccb7479c2458538e7` |
| lx-global-frontend | `fae991304ff811032d7b93fecc314ac90d1bf32d` | `19ebaf257f6e274085e0a4376340844f5c464aed` |
| form-building | `431fb9d8e5d06b00ecb7c5422edb21e141348327` | `431fb9d8e5d06b00ecb7c5422edb21e141348327` |

远端主站前后端比本地工作区更新，已额外比较相关保存、发布、令牌代码。后端最新改动没有改变“令牌非空才检查”的规则，前端最新合并也没有改变本次调用链；组件远端 release 与本地相同。因此本报告结论在上述最新远端快照下仍成立。

Git 核查原始元数据、完整父节点和祖先关系保存在 [git-evidence.json](/Users/caozichen/cursorcode/mycode/autoTest/outputs/reports/2026-10-20-three-issues-git-attribution/git-evidence.json)。TEST 场景证据沿用 [回归结果报告](/Users/caozichen/cursorcode/mycode/autoTest/docs/2026-10-20-report-adaptation-test-results.md)，本轮没有新增 TEST 业务写入。

## 问题一：新建表单首次手动保存冲突

### 引入条件及对应提交

| 仓库与作用 | 提交 | Author／Committer | AuthorDate／CommitDate |
| --- | --- | --- | --- |
| backend：新增可选编辑令牌检查 | `5ccd4442ac19ca6ca302adff6d605cecce0f233b` | 均为灵析侯正春 | 均为 2026-09-29 20:46:47 |
| frontend：手动保存开始发送期望令牌 | `e07a54fc0dcb65c3e9ff3be37c6bb14042bb903b` | 均为灵析侯正春 | 均为 2026-09-29 20:46:55 |
| form-building：为组件内部写入和宿主统一令牌会话 | `45db3de188037ad1c23d3775ee91f93843732697` | 均为灵析侯正春 | 均为 2026-09-29 20:46:55 |

当前代码的因果链：

1. 联系人预设初始化在 [useContactCollectModeConfig.js:381](/Users/caozichen/cursorcode/form-building/apps/form-designer/src/composables/useContactCollectModeConfig.js:381) 及 389 行直接调用题目、配置保存，只同步 `revision_no`，没有编辑令牌会话。
2. 后端允许未传令牌的旧入口写入；保存会改变实际编辑令牌。
3. 前端手动保存通过 [designer/index.vue:264](/Users/caozichen/cursorcode/lx-global-frontend/src/views/form-activity/form/designer/index.vue:264) 取 `designerRef.getEditToken()`，不存在时回退使用 `formDetail.edit_token`。
4. 当前组件没有宿主所需的 `getEditToken`／`setEditToken` 接口，因此回退取得初始化前读取的令牌。
5. 手动保存带旧令牌，后端拒绝并返回 `30001`。不需要第二个人同时编辑。

前端 `e07a54fc^` 不发送此字段，`e07a54fc` 首次新增。后端 `5ccd4442^` 没有这套校验，`5ccd4442` 首次新增。由此确认是新增令牌机制与旧组件组合产生的回归，不应归因于早先正常工作的联系人初始化代码作者。

### 进入当前发布历史的时间

- 前端：`fae991304ff811032d7b93fecc314ac90d1bf32d`，**2026-10-14 11:49:23**，Author／Committer 均为 `release-bot`，消息为 `merge: feature/mcp into release/20261016`。第二父节点正好是 `e07a54fc`，第一父节点不包含它。
- 后端：`6fd1c116dbc894c3bc3b2fc13aa50c30da40f0c7`，**2026-10-14 12:10:11**，Author／Committer 均为灵析侯正春，消息为 `merge: feature/mcp into resolve/20261016/feature-mcp-1`。第二父节点包含 `5ccd4442`，第一父节点不包含。此提交位于当前 release 第一父历史中；消息的目标是 resolve 分支，不能改写为“消息明确写着合入 release”。

因此，**9 月 29 日是相关代码提交时间，10 月 14 日是当前发布历史形成不完整组合的接入点**。这些不是 TEST 部署时间。

### 已存在但未进入当前组件 release 的配套修改

组件 `45db3de1` 明确实现：独立 `formEditSession`、宿主可读写令牌接口、内部 `createFormEditApi` 包装器、每次成功写入后推进令牌。联系人预设保存也改用该包装器。

`584725d3ecf727642410693b533e525c105f05c8` 于 **2026-09-30 10:56:45**，由 `release-bot` 合并，消息为 `merge: feature/feature-mcp-authorization-ui into release/20260930`，第二父节点正好是 `45db3de1`。

| 组件仓库分支／版本 | 是否包含 `45db3de1` |
| --- | --- |
| 本地历史分支 `release/20260930` | 是 |
| 远端 `origin/feature/feature-mcp-authorization-ui` | 是，当前直接指向该提交 |
| 远端 `origin/release/20261016` | **否** |
| 远端 `origin/master` | **否** |
| 远端 `origin/feature/mcp` | **否** |

同时检查当前实现，相关路径没有等价修复。因此可以确认组件配套未进入当前发布组合；**不能仅凭这些提交确定谁决定漏合、谁负责部署**。

TEST 对应记录：`5615f5ac-ff0f-4a4c-8ab5-60ee7e78d986`、`5c7d14a8-eef3-4ab0-b9a6-a6c1666cf3a6`。后者中初始化两次写入无令牌且成功，之后手动题目保存带令牌并返回 `30001`，与代码链一致。

## 问题二：设计器发布没有编辑令牌

复制后建表、由模板建表都走设计器发布入口，属于同一条调用链：

1. 主站 [designer/index.vue:776](/Users/caozichen/cursorcode/lx-global-frontend/src/views/form-activity/form/designer/index.vue:776) 调用组件 `requestPublish()`；保存后发布的另一入口同样委托给组件。
2. 组件 [TopBar.vue:95](/Users/caozichen/cursorcode/form-building/apps/form-designer/src/components/layout/TopBar.vue:95) 执行 `formApi.publishForm(formId, {})`，没有令牌。
3. 后端 [FormEditConcurrencyService.php:68](/Users/caozichen/cursorcode/lx-global-backend/app/Services/Form/FormEditConcurrencyService.php:68) 只在令牌非空时比较，无令牌按照兼容契约放行。最新远端实现相同。

侯正春的组件 `45db3de1` 已经将 TopBar 的 API 换成 `createFormEditApi(baseFormApi, formEditSession)`，包装器会给发布请求附加 `expected_edit_token`。提交说明也明确写着“修复设计器顶部发布入口遗漏版本校验的问题”，并加入发布令牌测试。

所以此项不能准确归为“前端 `e07a54fc` 忘记了设计器发布”：宿主在传递令牌并依赖组件发布，组件配套改动实际上已写在另一个仓库、另一个开发线上，只是没有进入当前 release。作者、时间、分支及进入当前发布历史的节点与问题一相同。

作为排除：裸 `publishForm(formId, {})` 行早在 `de623fc1f5aa965e2f6823a8d2d46d9a2de322e4`（heweibang，2026-04-11 18:35:16）就存在，当时尚无 9 月 29 日新增的令牌契约，不能凭该行 blame 将此次问题归给他。

TEST 记录：`2b7aee72-46c6-436d-b6c8-a44316a06155`、`6db75bdf-4e6d-4900-90bd-aedfb206a220`。已观察到的是**发布绕过令牌保护**，没有证据证明这些运行真的覆盖了他人修改。独立双会话测试证明后端在明确传旧令牌时会拒绝保存和发布。

## 问题三：繁体后台保存原答案改写地址

### 直接引入提交

```text
仓库：form-building
SHA：f64037cf0ae7a7ff2deb9dc3a0a46df4978b3f98
父提交：9ec25a548e8c4ba56666235f2ee69c7ff03f14ff
Author／Committer：bill <313032758@qq.com>
AuthorDate／CommitDate：2026-09-15 14:37:49 +08:00
标题：fix(form-settings): 修改图片上传为公共桶
```

标题只提到图片上传，但真实 diff 同时修改了地址回填，归因以实际差异为准。

该提交在 [FormAddressPure.vue:139](/Users/caozichen/cursorcode/form-building/packages/form-ui/src/components/form-canvas/fields/FormAddressPure.vue:139) 向 `useAddressRegionOptions` 新增传递当前答案模型 `normalizedValue`；并在 [useAddressRegionOptions.js:85](/Users/caozichen/cursorcode/form-building/packages/form-ui/src/components/region/useAddressRegionOptions.js:85) 新增模型监听器，发现地址不属于当前语言时加载其他语言的地区树、按 ID 映射，再于 [129 行](/Users/caozichen/cursorcode/form-building/packages/form-ui/src/components/region/useAddressRegionOptions.js:129) 执行：

```js
addressValue.value = { ...addressValue.value, region: translated };
```

这会触发答案模型更新。提交转换器 [address.js:20](/Users/caozichen/cursorcode/form-building/packages/form-api/utils/transformers/address.js:20) 从模型直接取省市区名称，正常提交随后保存这些新文本。因此并非仅改变展示标签。

后台通过 [reply-shared-renderer-section.vue:37](/Users/caozichen/cursorcode/lx-global-frontend/src/views/form-activity/form/submission/preview/components/reply-detail/section/reply-shared-renderer-section.vue:37) 向渲染器传递后台语言，繁体后台打开简体旧答案即可触发；无需主动编辑地址。

### 分支与合入证据

`8266d580bbf37ec469480a3eff801fdc8220aa6d`，**2026-09-15 16:14:44**，Author／Committer 为 `release-bot`，消息为：

```text
merge: feature/ai-assistant into release/20260915
第一父：007eb53495a7cae7bd9a568e662735063e35c517
第二父：f64037cf0ae7a7ff2deb9dc3a0a46df4978b3f98
```

第二父正好就是问题提交，明确证明来源开发线为 `feature/ai-assistant`。随后 `544fe468125ffb009d054a7970720c52664092c5` 于 **2026-09-15 19:36:11** 记录 `release: publish release/20260915`。

当前组件 release 的既有基线 `d8b75be3` 已包含此提交，不是 10 月 19 日 `431fb9d8` 合并 master 时才引入。

### 为什么不是 9 月 10 日的地址翻译改动

`e750978f` 是初步候选，但其机制主要在地区选项树由旧语言切换为新语言时映射。父版本首次加载时没有旧语言树，保留原地址。`f64037cf` 新增其他语言树加载和模型监听，才让“首次打开跨语言旧答案、不编辑”也会转换；这与此次 TEST 场景相符。

该提交还增加了地址跨语言回填测试，说明模型转换原本是有意加入的本地化行为。此次保持性问题在于，这一行为也用于编辑已经提交的答案，导致未编辑字段的文本被持久化改写。Git 可以确定行为来源，不能据此推断当时产品需求或个人主观责任。

TEST 记录 `36b454d1-b295-4bfc-aff4-63813fe8030e`：form `vL78Pn`、submission `qYjVGk`；`appliedEditFields: []`。同一读取方式下，编辑前 3 次 GET 返回“广东省／深圳市／南山区”，编辑后 3 次返回“廣東省／深圳市／南山區”。

## 验证与结论边界

除检查实际 diff、完整提交元数据、第一父链、合并第二父和分支祖先关系，还对 Git 源码做了离线对照：

| 对照 | 结果 |
| --- | --- |
| 前端 `e07a54fc^` 与 `e07a54fc` 的保存 payload 构造，模拟当前无令牌接口的组件 | 父版不发令牌；新版回退发旧令牌；有配套接口时可取到新令牌 |
| 当前组件与 `45db3de1` 的真实 TopBar 发布方法，模拟同一编辑会话 | 当前 payload 为 `{}`；配套版为 `{"expected_edit_token":"reviewed-draft"}`，成功响应后推进会话令牌 |
| `f64037cf^` 与 `f64037cf` 的实际地址逻辑，使用真实 Vue 响应机制，只模拟地区树 API | 父版保留简体；新版首次打开即变繁体，详细地址和坐标保留 |

未执行 Laravel／数据库测试，本轮 shell 没有可用的 PHP；没有新跑浏览器自动化或写入 TEST，真实场景结果引用既有测试记录。本轮未修改产品代码、未提交、未推送；只更新远端跟踪引用并在自动化项目保存本核查结果。

Git 提交对象不保存“落笔时 checkout 的分支名”。本报告的来源分支依据明确的合并消息、父节点和引用共同确认，不能把所有包含该提交的分支都称为原始开发分支。Git 记录也不等于部署记录；缺少 CI／部署清单时，不能推断首次部署时间或将漏合决定归给某个自然人。
