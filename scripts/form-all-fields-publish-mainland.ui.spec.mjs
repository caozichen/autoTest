import {
  chooseContactCollectionInDesigner,
  enterBasicSettings,
  ensureIgnoreStrategyInSettings,
  hasPresetContactFields,
  run as runCompleteForm,
  waitForContactPageReady,
} from './form-all-fields-publish.ui.spec.mjs'
import { expect as flowExpect, scaleTimeout } from './support/environment-timeouts.mjs'
import { openFormSettingsMenu } from './support/form-navigation.mjs'
import { configurePostCollectionSettings } from './support/form-post-collection-settings.mjs'
import { assertClassificationTagOptionsAvailable } from './support/form-settings-channels.mjs'

// Both mainland entry points create a new, unconfigured ordinary form. The
// restored onboarding dialog must finish even if preset fields render first.
export async function initializeMainlandContactFields(page, logger, timeoutMs = scaleTimeout(45_000)) {
  const deadline = Date.now() + timeoutMs
  const remaining = () => Math.max(1, deadline - Date.now())
  logger('info', '内地新建表单等待首次联系人收录弹窗，完成“确认收录 → 忽略，不替换”')
  await chooseContactCollectionInDesigner(page, logger, remaining())
  // Keep this a flow blocker even when the shared helper records soft assertions.
  await flowExpect.poll(() => hasPresetContactFields(page), {
    timeout: remaining(),
    message: '内地设计器应各有一道姓名、手机号和邮箱预设题',
  }).toBe(true)
  logger('success', '内地联系人题初始化完成：收录及“忽略，不替换”已确认，姓名、手机号、邮箱各一道')
}

export async function configureMainlandContactSettings(page, logger) {
  await enterBasicSettings(page, logger)
  await openFormSettingsMenu(page, 'form', {
    ready: page.getByRole('switch', { name: '填报开始结束时间开关', exact: true }),
    logger, label: '打开内地填报设定',
  })

  const deadline = Date.now() + scaleTimeout(30_000)
  await waitForContactPageReady(page, () => Math.max(1, deadline - Date.now()))
  const contactMenu = page.locator('[data-menu-key="collect-contact"]')
  if (await contactMenu.isVisible()) {
    // Keep the original setting if a mainland deployment later exposes it.
    await ensureIgnoreStrategyInSettings(page, logger)
    return
  }
  await flowExpect(contactMenu, '当前内地版不提供全局收录联系人设置入口').toHaveCount(0)
  logger('info', '内地基础设置没有全局收录联系人及冲突策略入口；收录及“忽略，不替换”已在设计器确认')
}

export function assertMainlandClassificationTagOptionsAvailable(selectedCategory, selectedTag) {
  return assertClassificationTagOptionsAvailable(selectedCategory, selectedTag)
}

export async function configureMainlandAdditionalSettings(options) {
  return configurePostCollectionSettings(options, {
    assertClassificationTagOptionsAvailable: assertMainlandClassificationTagOptionsAvailable,
  })
}

// Share field, upload, save, publish and contract checks. Mainland customizes
// contact initialization while retaining the category/tag availability assertion.
export async function run(options, workflowOverrides = {}) {
  return runCompleteForm(options, {
    createPath: '/form-activity/index?type=form',
    prepareContactFields: initializeMainlandContactFields,
    configureContactSettings: configureMainlandContactSettings,
    configureAdditionalSettings: configureMainlandAdditionalSettings,
    ...workflowOverrides,
  })
}
