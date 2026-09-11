import {
  ONE_PIXEL_PNG as BASE_ONE_PIXEL_PNG,
  createFullRunFormHtml,
} from './form-all-fields-submit-full-run-fixture.mjs'

function replaceOnce(source, target, replacement, label) {
  const first = source.indexOf(target)
  if (first < 0 || source.indexOf(target, first + target.length) >= 0) {
    throw new Error(`手动创建 fixture 无法唯一替换${label}`)
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + target.length)}`
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function removeStructuralCard(html, key, label) {
  const pattern = new RegExp(
    `\\n\\s*<article class="fb-runtime-structural-field-card" data-item-key="${escapeRegExp(key)}">[\\s\\S]*?</article>`,
  )
  if (!pattern.test(html)) throw new Error(`手动创建 fixture 未找到${label}`)
  return html.replace(pattern, '')
}

const FIELD_LABELS = Object.freeze({
  username: '姓名',
  mobile: '手机号',
  email: '邮箱',
  idCard: '身份证件',
  landlinePhone: '固定电话',
  address: '地址',
  birthday: '生日',
  input: '单行文本',
  textarea: '多行文本',
  radio: '单项选择',
  checkbox: '多项选择',
  select: '下拉选择',
  number: '数字',
  date: '日期',
  time: '时间',
  imageUpload: '图片上传',
  fileUpload: '文件上传',
  cascader: '级联选择',
  signature: '手写签名',
  fieldGroup: '题组',
  description: '描述说明',
  divider: '分割线',
  matrix: '矩阵题',
  matrixChoice: '矩阵选择',
  ranking: '排序题',
  rating: '评分题',
  nps: 'NPS',
})

export const ONE_PIXEL_PNG = BASE_ONE_PIXEL_PNG

export function createManualSubmissionFormHtml({
  origin,
  formId,
  title,
  fieldKeys,
  fieldTitleOverrides = {},
  omitSidePanelText = '',
  simulateEmptyValidationPost = false,
  simulateRapidSecondSubmit = false,
}) {
  let html = createFullRunFormHtml({ origin, formId, title, fieldKeys })

  html = removeStructuralCard(html, fieldKeys.description, '描述说明结构题')
  html = removeStructuralCard(html, fieldKeys.divider, '分割线结构题')

  html = html
    .replace('<section data-page="2" hidden>', '<section data-page="2">')
    .replace('<section data-page="3" hidden>', '<section data-page="3">')
    .replace(
      /<article class="fb-runtime-field-card" data-item-key="([^"]+)">/g,
      '<article class="fb-runtime-field-card" data-item-key="$1" data-field-key="$1">',
    )
    .replaceAll('<h2>', '<div class="fb-runtime-field-heading">')
    .replaceAll('</h2>', '</div>')
    .replace(
      '<input id="group-username-input" type="text" aria-label="题组姓名">',
      `<div data-item-key="${escapeHtml(fieldKeys.groupUsername)}" data-field-key="${escapeHtml(fieldKeys.groupUsername)}"><div class="fb-runtime-field-heading">姓名</div><input id="group-username-input" type="text" aria-label="题组姓名"></div>`,
    )
    .replace(
      '<button type="button" role="combobox">+86</button>\n          <input id="group-mobile-input" type="tel" aria-label="题组手机号">',
      `<div data-item-key="${escapeHtml(fieldKeys.groupMobile)}" data-field-key="${escapeHtml(fieldKeys.groupMobile)}"><div class="fb-runtime-field-heading">手机号</div><button type="button" role="combobox">+86</button><input id="group-mobile-input" type="tel" aria-label="题组手机号"></div>`,
    )
    .replace(
      '<input id="group-email-input" type="email" aria-label="题组邮箱">',
      `<div data-item-key="${escapeHtml(fieldKeys.groupEmail)}" data-field-key="${escapeHtml(fieldKeys.groupEmail)}"><div class="fb-runtime-field-heading">邮箱</div><input id="group-email-input" type="email" aria-label="题组邮箱"></div>`,
    )

  const sidePanelHtml = ['基本信息', '变更详情', '核准记录', '备注', '特殊编号']
    .filter((text) => text !== omitSidePanelText)
    .map((text) => `<span>${text}</span>`)
    .join('')
  html = replaceOnce(
    html,
    `<h1>${escapeHtml(title)}</h1>`,
    `<header><h2>${escapeHtml(title)}</h2><p>创建后记录提交时间</p><span>编辑中</span><h3>提报信息</h3></header><aside>${sidePanelHtml}</aside>`,
    '后台创建页标题区',
  )
  html = replaceOnce(
    html,
    '    <main>',
    '    <main>\n      <button type="button">取消创建</button>\n      <form-renderer admin-create-submission>',
    '后台表单渲染器开始标签',
  )
  html = replaceOnce(
    html,
    '    </main>\n    <script>',
    '      </form-renderer>\n    </main>\n    <script>',
    '后台表单渲染器结束标签',
  )

  html = replaceOnce(
    html,
    '<div class="fb-runtime-pagination-buttons"></div>',
    '<div class="fb-runtime-pagination-buttons" hidden></div>',
    '分页操作区',
  )
  html = replaceOnce(
    html,
    '<div class="fb-runtime-submit-button-wrap" hidden>',
    '<div class="fb-runtime-submit-button-wrap">',
    '提交操作区',
  )
  html = replaceOnce(
    html,
    '<button class="fb-runtime-submit-button" type="button">提交</button>',
    '<button class="fb-runtime-submit-button" type="button">创建提报</button>',
    '创建提报按钮',
  )
  html = replaceOnce(
    html,
    "const clearErrors = () => document.querySelectorAll('.fb-runtime-field-error').forEach((error) => error.remove())",
    `const clearErrors = () => document.querySelectorAll('.fb-runtime-field-error').forEach((error) => error.remove())
      const clearFieldErrors = (target) => {
        const currentCard = target instanceof Element
          ? target.closest('.fb-runtime-field-card, .fb-runtime-structural-field-card')
          : null
        currentCard?.querySelectorAll('.fb-runtime-field-error').forEach((error) => error.remove())
      }
      document.addEventListener('input', (event) => clearFieldErrors(event.target), { capture: true })
      document.addEventListener('click', (event) => clearFieldErrors(event.target), { capture: true })
      document.querySelector('#mobile-input').addEventListener('blur', (event) => {
        clearFieldErrors(event.target)
        if (event.target.value.trim() && !/^1\\d{10}$/.test(event.target.value.trim())) {
          addError(cardFor('mobile'), '请输入正确的手机号')
        }
      })
      document.querySelector('#number-input').addEventListener('blur', (event) => {
        clearFieldErrors(event.target)
        const rawValue = event.target.value.trim()
        const numericValue = Number(rawValue)
        if (!rawValue || !Number.isFinite(numericValue) || numericValue < 0 || numericValue > 100) {
          addError(cardFor('number'), '数字必须在 0 到 100 之间')
        }
      })`,
    '字段错误交互更新',
  )
  html = replaceOnce(
    html,
    "control.dataset.state = control.dataset.state === 'checked' ? 'unchecked' : 'checked'",
    `control.dataset.state = control.dataset.state === 'checked' ? 'unchecked' : 'checked'
          const checkedCount = document.querySelectorAll('.fb-ui-checkbox-root[data-state="checked"]').length
          if (checkedCount < 2) addError(cardFor('checkbox'), '请选择 2-3 项')`,
    '多项选择边界校验',
  )
  html = replaceOnce(
    html,
    "addError(cardFor('mobile'), '请输入有效手机号')",
    "addError(cardFor('mobile'), '请输入正确的手机号')",
    '手机号错误文本',
  )
  html = replaceOnce(
    html,
    "addError(cardFor('checkbox'), '至少选择两项')",
    "addError(cardFor('checkbox'), '请选择 2-3 项')",
    '多项选择错误文本',
  )
  html = replaceOnce(
    html,
    "if (!Number.isFinite(number) || number < 0 || number > 100) {",
    "if (!valueOf('#number-input') || !Number.isFinite(number) || number < 0 || number > 100) {",
    '数字空值必填校验',
  )
  html = replaceOnce(
    html,
    'if (!validatePageThree()) return',
    `if (state.submitting) return
        state.submitting = true
        const submitButton = document.querySelector('.fb-runtime-submit-button-wrap button')
        submitButton.disabled = true
        if (![validatePageOne(), validatePageTwo(), validatePageThree()].every(Boolean)) {
          state.submitting = false
          submitButton.disabled = false
          return
        }`,
    '单页完整校验',
  )
  html = replaceOnce(
    html,
    "fetch('/f/form/' + encodeURIComponent(formId) + '/submission', {",
    "fetch('/api/be/form/' + encodeURIComponent(formId) + '/submission', {",
    '创建提报接口',
  )

  const submitHeaders = "headers: { 'Content-Type': 'application/json' },\n          body: JSON.stringify(submissionPayload()),"
  html = replaceOnce(
    html,
    submitHeaders,
    "headers: { 'Content-Type': 'application/json', Authorization: localStorage.getItem('token') || '' },\n          body: JSON.stringify(submissionPayload()),",
    '创建提报 Token',
  )
  html = replaceOnce(
    html,
    'revision_no: 1,\n          answers:',
    "revision_no: 1,\n          updater_name: '自动化测试操作人',\n          answers:",
    '后台操作人字段',
  )

  html = replaceOnce(
    html,
    `const submissionId = String(body.data && body.data.submission_id || '')
        history.pushState({}, '', '/form/submission-result/')
        document.body.innerHTML = '<form-submission-result form-id="' + formId + '" submission-id="' + submissionId + '"></form-submission-result><main><h1>提交成功</h1></main>'`,
    `const submissionId = String(body.data && body.data.submission_id || '')
        if (response.ok && Number(body.code) === 0 && submissionId) {
          const escapeDetail = (value) => String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
          const replyRow = (label, value) => '<div class="reply-kv__row"><span class="reply-kv__label">' + escapeDetail(label) + '</span><div class="reply-kv__value">' + escapeDetail(value) + '</div></div>'
          const checkedLabels = [...document.querySelectorAll('.fb-ui-checkbox-root[data-state="checked"]')]
            .map((control) => control.textContent.trim()).join(' ')
          const matrixAnswers = [...document.querySelectorAll('[data-matrix-cell]')]
            .map((input) => input.value.trim())
          const matrixRows = Array.from({ length: 3 }, (_, row) => '<tr>' + matrixAnswers
            .slice(row * 3, row * 3 + 3)
            .map((value) => '<td>' + escapeDetail(value) + '</td>').join('') + '</tr>').join('')
          const matrixChoiceRows = Array.from({ length: 3 }, (_, row) => '<tr>' + Array.from({ length: 3 }, (_, column) => {
            const checked = row === column ? '<span class="submission-matrix-choice-check">✓</span>' : ''
            return '<td class="submission-matrix-choice-cell">' + checked + '</td>'
          }).join('') + '</tr>').join('')
          const rows = [
            replyRow('姓名', valueOf('#username-input')),
            replyRow('手机号', valueOf('#mobile-input')),
            replyRow('邮箱', valueOf('#email-input')),
            replyRow('身份证件', valueOf('#id-card-input')),
            replyRow('固定电话', valueOf('#landline-input')),
            replyRow('地址', [textOf('#address-province'), textOf('#address-city'), textOf('#address-district'), valueOf('#address-street-input')].join(' ')),
            replyRow('生日', [textOf('#birthday-year'), textOf('#birthday-month'), textOf('#birthday-day')].join('-')),
            replyRow('单行文本', valueOf('#single-line-input')),
            replyRow('多行文本', valueOf('#textarea-input')),
            replyRow('单项选择', '选项1'),
            replyRow('多项选择', checkedLabels),
            replyRow('下拉选择', textOf('#select-input')),
            replyRow('数字', valueOf('#number-input')),
            replyRow('日期', state.date),
            replyRow('时间', state.time),
            '<div class="reply-kv__row"><span class="reply-kv__label">图片上传</span><div class="reply-kv__value"><img src="/fixture-assets/radio-option.png" alt="' + escapeDetail(state.imageName) + '"></div></div>',
            replyRow('文件上传', state.fileName),
            replyRow('级联选择', '华东区 江苏省 南京市'),
            '<div class="reply-kv__row"><span class="reply-kv__label">手写签名</span><div class="reply-kv__value"><img src="/fixture-assets/radio-option.png" alt="手写签名"></div></div>',
            replyRow('姓名', valueOf('#group-username-input')),
            replyRow('手机号', valueOf('#group-mobile-input')),
            replyRow('邮箱', valueOf('#group-email-input')),
            '<div class="reply-kv__row"><span class="reply-kv__label">矩阵题</span><div class="reply-kv__value"><button class="reply-kv__matrix-view" type="button" data-modal-id="matrix-detail-modal">点击查看</button></div></div>',
            '<div class="reply-kv__row"><span class="reply-kv__label">矩阵选择</span><div class="reply-kv__value"><button class="reply-kv__matrix-view" type="button" data-modal-id="matrix-choice-detail-modal">点击查看</button></div></div>',
            replyRow('排序题', state.ranking.join(' ')),
            replyRow('评分题', state.rating),
            replyRow('NPS', state.nps),
          ]
          const modals = '<div id="matrix-detail-modal" class="arco-modal-container" hidden><div class="arco-modal-title">矩阵题</div><button type="button" role="button" aria-label="Close">关闭</button><table class="submission-matrix-table"><tbody>' + matrixRows + '</tbody></table></div>'
            + '<div id="matrix-choice-detail-modal" class="arco-modal-container" hidden><div class="arco-modal-title">矩阵选择</div><button type="button" role="button" aria-label="Close">关闭</button><table><tbody>' + matrixChoiceRows + '</tbody></table></div>'
          history.pushState({}, '', '/form-activity/submission/preview/reply/' + encodeURIComponent(submissionId) + '?fid=' + encodeURIComponent(formId))
          document.body.innerHTML = '<main><h2>' + escapeDetail(${JSON.stringify(title)}) + '</h2><span class="reply-detail-page__summary-status">已提交</span><h3>提报信息</h3><button type="button">编辑</button>' + rows.join('') + modals + '</main>'
          document.querySelectorAll('.reply-kv__matrix-view').forEach((button) => {
            button.addEventListener('click', () => {
              document.getElementById(button.dataset.modalId).hidden = false
            })
          })
          document.querySelectorAll('.arco-modal-container [aria-label="Close"]').forEach((button) => {
            button.addEventListener('click', () => {
              button.closest('.arco-modal-container').hidden = true
            })
          })
          fetch('/api/be/form/' + encodeURIComponent(formId) + '/submission/' + encodeURIComponent(submissionId), {
            headers: { Authorization: localStorage.getItem('token') || '' },
          })
          return
        }
        state.submitting = false
        submitButton.disabled = false
        addError(document.querySelector('main'), String(body.message || '创建失败'))`,
    '创建成功详情页',
  )

  html = replaceOnce(
    html,
    `showPage(1)
      fetch('/f/form/' + encodeURIComponent(formId))`,
    `document.querySelectorAll('[data-page]').forEach((section) => { section.hidden = false })
      document.querySelector('.fb-runtime-pagination-buttons').hidden = true
      document.querySelector('.fb-runtime-submit-button-wrap').hidden = false
      if (${JSON.stringify(simulateEmptyValidationPost)}) {
        const submitControl = document.querySelector('.fb-runtime-submit-button-wrap button')
        submitControl.addEventListener('click', () => {
          if (state.syntheticEmptyValidationPostSent) return
          state.syntheticEmptyValidationPostSent = true
          const errors = [...document.querySelectorAll('.fb-runtime-field-error')]
          const heldError = errors.at(-1)
          const heldErrorParent = heldError?.parentElement
          heldError?.remove()
          const restoreHeldError = () => heldErrorParent?.append(heldError)
          fetch('/api/be/form/' + encodeURIComponent(formId) + '/submission', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: localStorage.getItem('token') || '' },
            body: JSON.stringify({ revision_no: 1, answers: {}, synthetic_empty_validation: true }),
          }).then(restoreHeldError, restoreHeldError)
        })
        document.addEventListener('input', (event) => {
          if (!state.syntheticEmptyValidationPostSent || state.syntheticFieldInputReported) return
          if (!String(event.target?.value || '').trim()) return
          state.syntheticFieldInputReported = true
          fetch('/fixture-events/manual-create-field-input', { method: 'POST' }).catch(() => undefined)
        }, { capture: true })
      }
      if (${JSON.stringify(simulateRapidSecondSubmit)}) {
        const submitControl = document.querySelector('.fb-runtime-submit-button-wrap button')
        submitControl.addEventListener('click', () => {
          if (state.syntheticSecondSubmitScheduled) return
          state.syntheticSecondSubmitScheduled = true
          queueMicrotask(() => submitControl.click())
        }, { capture: true })
      }
      fetch('/api/be/form/' + encodeURIComponent(formId), {
        headers: { Authorization: localStorage.getItem('token') || '' },
      })`,
    '手动创建页初始化',
  )

  for (const [fieldName, override] of Object.entries(fieldTitleOverrides)) {
    const expected = FIELD_LABELS[fieldName]
    if (!expected || typeof override !== 'string') continue
    const key = fieldKeys[fieldName]
    const pattern = new RegExp(
      `(<article[^>]*data-item-key="${escapeRegExp(key)}"[^>]*>[\\s\\S]*?<div class="fb-runtime-field-heading">)${escapeRegExp(expected)}(</div>)`,
    )
    if (!pattern.test(html)) throw new Error(`手动创建 fixture 未找到字段标题：${fieldName}`)
    html = html.replace(pattern, `$1${override}$2`)
  }

  return html
}
