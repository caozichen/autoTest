// Shared copy for both creation entries. Per-run values are saved in FORM_CONTRACT.settings.
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character])

export function createFormSettingsContent({ title, formId, siteBaseUrl }) {
  const environment = new URL(siteBaseUrl).hostname
  const environmentLabel = environment.endsWith('lingxi360.com') ? '内地环境'
    : environment.endsWith('lxi.hk') ? '香港环境' : '测试环境'
  const runMarker = `${formId}-${Date.now()}`
  const context = `表单：${title}；环境：${environmentLabel}；运行标识：${runMarker}`
  const escapedContext = escapeHtml(context)
  const mail = (audience, purpose) => ({
    subject: `【自动化测试·${audience}】${formId} 提交成功 ${runMarker}`,
    body: `<h2>自动化测试：${purpose}</h2><p>${escapedContext}</p><p>这是一封本次表单自动化验证使用的测试通知，用于检查提交成功后的邮件配置与内容保存。</p><p><strong>验证范围：</strong>通知触发条件、邮件标题、邮件正文和本次运行的关联信息。</p><p>请根据上述表单及运行标识核对记录。此内容由自动化脚本生成。</p>`,
  })
  return {
    runMarker,
    environment,
    agreement: {
      name: '自动化测试用户协议',
      body: `<h2>自动化测试用户协议</h2><p>${escapedContext}</p><p>本协议用于验证表单用户协议的创建、保存和展示功能。请仅使用自动化测试数据填写本表单。</p><ol><li>测试范围包括采集项、分类标签、通知和提交反馈。</li><li>本次填写内容仅用于测试结果核对与问题定位。</li><li>填写前请确认数据属于本次测试，不包含真实敏感信息。</li></ol><p>阅读后可继续填写；本次配置不强制在填写前打开协议。</p>`,
    },
    managerNotification: mail('管理者通知', '管理者收到提交成功通知'),
    automationNotification: mail('用户通知', '用户收到提交成功反馈'),
    feedback: {
      body: `<h2 style="text-align: center;">自动化测试提交成功</h2><p>${escapedContext}</p><p><strong>加粗确认：</strong><em>斜体说明</em>、<u>下划线重点</u>、<s>删除线示例</s>。</p><p><span style="color: #2563eb;">蓝色提示</span>与<mark data-color="#fef08a" style="background-color: #fef08a; color: inherit;">背景高亮</mark>用于验证富文本样式。</p><ul><li>已验证表单基础设置。</li><li>已保存通知、分类和标签配置。</li></ul><ol><li>核对本次运行标识。</li><li>查看后续自动化验证记录。</li></ol><p style="text-align: right;">测试完成后请按运行记录追踪结果。</p><p>外部链接示例：<a href="https://www.baidu.com/" target="_blank" rel="noopener noreferrer">百度官网</a></p>`,
    },
    promotion: { buttonText: '自动化测试·访问百度', type: 'href', link: 'https://www.baidu.com/' },
    channelName: `自动化测试-${runMarker}`,
  }
}
