import {
  CONTACT_DIALOG_TEXT,
  CONTACT_PRESET_TYPES,
  chooseContactCollectionInDesigner,
  enterBasicSettings,
  ensureIgnoreStrategyInSettings,
  hasPresetContactFields,
  run as runCompleteForm,
  waitForContactPageReady,
} from './form-all-fields-publish.ui.spec.mjs'
import { expect, scaleTimeout } from './support/environment-timeouts.mjs'
import { clickWhenReady } from './support/ui-readiness.mjs'

// Mainland production adds the three contact fields directly. Do not wait for
// the international collection/replacement dialogs as a required success signal.
export async function initializeMainlandContactFields(page, logger, timeoutMs = scaleTimeout(45_000)) {
  const deadline = Date.now() + timeoutMs
  const remaining = () => Math.max(1, deadline - Date.now())
  const dialogs = page.locator('[role="dialog"]:visible').filter({ hasText: CONTACT_DIALOG_TEXT })
  await waitForContactPageReady(page, remaining)

  if (await dialogs.count()) {
    await chooseContactCollectionInDesigner(page, logger, remaining())
  }
  if (!await hasPresetContactFields(page)) {
    // Partial initialization must not cause another click and duplicate fields.
    for (const type of CONTACT_PRESET_TYPES) {
      await expect(page.locator(`.form-field[data-container-path=""][data-component-type="${type}"]`),
        `添加联系人前不应残留不完整的 ${type} 预设题`).toHaveCount(0, { timeout: remaining() })
    }
    await expect(page.locator('.fb-dialog-overlay[data-state="open"]'),
      '添加联系人前页面不应存在遮罩弹窗').toHaveCount(0, { timeout: remaining() })
    await clickWhenReady(page.locator('button[data-component-type="contactGroup"]'), { timeout: remaining() })
    await expect.poll(async () => (await dialogs.count()) > 0 || await hasPresetContactFields(page), {
      timeout: remaining(),
      intervals: [100, 200, 300],
      message: '内地联系人快捷项应生成姓名、手机号、邮箱，或显示需处理的收录弹窗',
    }).toBe(true)
    await waitForContactPageReady(page, remaining)
    if (await dialogs.count()) {
      await chooseContactCollectionInDesigner(page, logger, remaining())
    }
  }

  await expect.poll(() => hasPresetContactFields(page), {
    timeout: remaining(),
    message: '内地设计器应各有一道姓名、手机号和邮箱预设题',
  }).toBe(true)
  await expect(dialogs, '配置题目前联系人弹窗应全部关闭').toHaveCount(0, { timeout: remaining() })
  logger('success', '内地联系人题初始化完成：姓名、手机号、邮箱已生成')
}

export async function configureMainlandContactSettings(page, logger) {
  await enterBasicSettings(page)
  const formMenu = page.locator('[data-menu-key="form"]')
  await expect(formMenu, '内地基础设置应加载填报设定菜单').toBeVisible()
  await clickWhenReady(formMenu)
  await expect(page.getByRole('switch', { name: '填报开始结束时间开关', exact: true }),
    '内地填报设定面板应完成加载').toBeVisible()

  const deadline = Date.now() + scaleTimeout(30_000)
  await waitForContactPageReady(page, () => Math.max(1, deadline - Date.now()))
  const contactMenu = page.locator('[data-menu-key="collect-contact"]')
  if (await contactMenu.isVisible()) {
    // Keep the original setting if a mainland deployment later exposes it.
    await ensureIgnoreStrategyInSettings(page, logger)
    return
  }
  await expect(contactMenu, '当前内地版不提供全局收录联系人设置入口').toHaveCount(0)
  logger('info', '内地基础设置没有全局收录联系人及冲突策略入口；联系人收录使用已配置的题级开关')
}

// The two entries share every field, upload, save, publish and contract check.
// Only the creation entry and contact workflow differ between deployments.
export async function run(options) {
  return runCompleteForm(options, {
    createPath: '/form-activity/index?type=form',
    prepareContactFields: initializeMainlandContactFields,
    configureContactSettings: configureMainlandContactSettings,
  })
}
