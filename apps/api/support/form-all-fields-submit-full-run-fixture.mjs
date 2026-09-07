function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function card(key, label, content, { structural = false } = {}) {
  const className = structural
    ? 'fb-runtime-structural-field-card'
    : 'fb-runtime-field-card'
  return `
    <article class="${className}" data-item-key="${escapeHtml(key)}">
      <h2>${escapeHtml(label)}</h2>
      ${content}
    </article>`
}

function combobox(id, placeholder, options) {
  return `
    <button
      id="${escapeHtml(id)}"
      type="button"
      role="combobox"
      aria-controls="${escapeHtml(id)}-listbox"
      aria-expanded="false"
    >${escapeHtml(placeholder)}</button>
    <div id="${escapeHtml(id)}-listbox" role="listbox" hidden>
      ${options.map((option) => `<div role="option">${escapeHtml(option)}</div>`).join('')}
    </div>`
}

function pageSection(pageNumber, cards) {
  return `
    <section data-page="${pageNumber}"${pageNumber === 1 ? '' : ' hidden'}>
      ${cards.join('')}
    </section>`
}

export const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

export function createFullRunFormHtml({
  origin,
  formId,
  title,
  fieldKeys,
}) {
  const imageUrl = `${origin}/fixture-assets/radio-option.png`
  const pageOne = pageSection(1, [
    card(fieldKeys.username, '姓名', `
      ${combobox('name-title', '请选择称谓', ['Mr.（先生）', 'Ms.（女士）', 'Mrs.（太太）', 'Dr.（医生/博士）'])}
      <input id="username-input" type="text">`),
    card(fieldKeys.mobile, '手机号', `
      <button type="button" role="combobox">+86</button>
      <input id="mobile-input" type="tel">`),
    card(fieldKeys.email, '邮箱', '<input id="email-input" type="email">'),
    card(fieldKeys.idCard, '身份证件', `
      <button type="button" role="combobox">身份证</button>
      <input id="id-card-input" type="text">`),
    card(fieldKeys.landlinePhone, '固定电话', '<input id="landline-input" type="text">'),
    card(fieldKeys.address, '地址', `
      ${combobox('address-province', '请选择省份', ['广东省'])}
      ${combobox('address-city', '请选择城市', ['深圳市'])}
      ${combobox('address-district', '请选择区县', ['南山区'])}
      <input id="address-street-input" type="text">`),
    card(fieldKeys.birthday, '生日', `
      ${combobox('birthday-year', '请选择年份', ['1990'])}
      ${combobox('birthday-month', '请选择月份', ['8'])}
      ${combobox('birthday-day', '请选择日期', ['18'])}`),
  ])

  const pageTwo = pageSection(2, [
    card(fieldKeys.input, '单行文本', '<input id="single-line-input" type="text" maxlength="20">'),
    card(fieldKeys.textarea, '多行文本', '<textarea id="textarea-input"></textarea>'),
    card(fieldKeys.radio, '单项选择', `
      <button class="fb-ui-radio-group-item" type="button" data-state="unchecked" data-value="option_1">
        <img src="${escapeHtml(imageUrl)}" alt="选项1">选项1
      </button>
      <button class="fb-ui-radio-group-item" type="button" data-state="unchecked" data-value="option_2">
        <img src="${escapeHtml(imageUrl)}" alt="选项2">选项2
      </button>
      <button class="fb-ui-radio-group-item" type="button" data-state="unchecked" data-value="option_other">其他</button>
      <input id="custom-radio-input" type="text" hidden>`),
    card(fieldKeys.checkbox, '多项选择', [1, 2, 3].map((index) => `
      <button class="fb-ui-checkbox-root" type="button" data-state="unchecked" data-value="option_${index}">选项${index}</button>`).join('')),
    card(fieldKeys.select, '下拉选择', combobox('select-input', '请选择', ['选项1', '选项2'])),
    card(fieldKeys.number, '数字', '<input id="number-input" type="number" step="0.01">'),
    card(fieldKeys.date, '日期', `
      <button id="date-trigger" type="button">请选择日期</button>
      <div data-fb-date-overlay hidden>
        <button type="button" disabled>2026-08-17</button>
        <button type="button" class="fb-ring-1">2026-08-21</button>
      </div>`),
    card(fieldKeys.time, '时间', `
      <button id="time-trigger" type="button">请选择时间</button>
      <div class="fb-timepicker-container" hidden>
        <button class="fb-h-7 fb-min-w-14" type="button">当前时间</button>
        <button class="fb-h-7 fb-min-w-14" type="button">确认</button>
      </div>`),
    card(fieldKeys.imageUpload, '图片上传', `
      <input id="image-upload-input" type="file" accept="image/*">
      <span class="fb-runtime-upload-status" hidden></span>
      <div class="fb-runtime-upload-image-preview"></div>`),
    card(fieldKeys.fileUpload, '文件上传', `
      <input id="file-upload-input" type="file">
      <span class="fb-runtime-upload-status" hidden></span>`),
  ])

  const matrixInputs = Array.from({ length: 9 }, (_, index) => (
    `<td><input type="text" data-matrix-cell="${index}"></td>`
  ))
  const matrixRows = Array.from({ length: 3 }, (_, row) => (
    `<tr>${matrixInputs.slice(row * 3, row * 3 + 3).join('')}</tr>`
  )).join('')
  const matrixChoiceRows = Array.from({ length: 3 }, (_, row) => `
    <tr>${Array.from({ length: 3 }, (_, column) => `
      <td><input type="radio" name="matrix-row-${row}" value="col_${column + 1}" aria-label="题目${row + 1}选项${column + 1}"></td>`).join('')}</tr>`).join('')

  const pageThree = pageSection(3, [
    card(fieldKeys.cascader, '级联选择', `
      <button class="fb-runtime-cascader-trigger" type="button" data-state="closed">请选择</button>
      <div id="cascader-panel" hidden>
        <button type="button">华东区</button>
        <button type="button">江苏省</button>
        <button id="cascader-leaf" type="button">南京市<span class="fb-runtime-cascader-checkbox"></span></button>
      </div>`),
    card(fieldKeys.signature, '手写签名', `
      <button class="fb-signature-empty-trigger" type="button">点击签名</button>
      <div class="fb-signature-filled-surface" hidden>签名已完成</div>
      <div id="signature-dialog" role="dialog" hidden>
        <canvas width="500" height="220"></canvas>
        <button class="fb-text-white" type="button">确认</button>
      </div>`),
    card(fieldKeys.fieldGroup, '题组', `
      <div class="fb-runtime-field-group-instance">
        <div class="fb-runtime-field-group-instance-content">
          <input id="group-username-input" type="text" aria-label="题组姓名">
          <button type="button" role="combobox">+86</button>
          <input id="group-mobile-input" type="tel" aria-label="题组手机号">
          <input id="group-email-input" type="email" aria-label="题组邮箱">
        </div>
      </div>`, { structural: true }),
    card(fieldKeys.description, '描述说明', '<p>请确认联系人信息准确无误，提交后将用于活动报名及相关通知。</p>', { structural: true }),
    card(fieldKeys.divider, '分割线', '<hr><p>补充信息</p>', { structural: true }),
    card(fieldKeys.matrix, '矩阵题', `<table><tbody>${matrixRows}</tbody></table>`),
    card(fieldKeys.matrixChoice, '矩阵选择', `<table><tbody>${matrixChoiceRows}</tbody></table>`),
    card(fieldKeys.ranking, '排序题', `
      <div class="fb-runtime-ranking-ranked-list"></div>
      ${['选项1', '选项2', '选项3'].map((option) => `
        <button class="fb-runtime-ranking-item" type="button">${option}</button>`).join('')}`),
    card(fieldKeys.rating, '评分题', Array.from({ length: 5 }, (_, index) => `
      <button class="rating-item" type="button" data-score="${index + 1}"><span>★</span></button>`).join('')),
    card(fieldKeys.nps, 'NPS', Array.from({ length: 10 }, (_, index) => `
      <button class="nps-scale__score-btn" type="button" data-score="${index + 1}">${index + 1}</button>`).join('')),
  ])

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(title)}</title>
    <style>
      [hidden] { display: none !important; }
      body { font-family: sans-serif; margin: 0 auto; max-width: 960px; padding: 24px; }
      .fb-runtime-field-card,
      .fb-runtime-structural-field-card { border-bottom: 1px solid #ddd; padding: 12px 0; }
      h2 { font-size: 16px; }
      input, textarea, button { margin: 3px; min-height: 28px; }
      [role="listbox"] { background: white; border: 1px solid #777; padding: 4px; position: absolute; z-index: 2; }
      [role="option"] { cursor: pointer; padding: 6px 12px; }
      .fb-runtime-field-error { color: #b42318; }
      .fb-runtime-upload-image-preview img { height: 32px; width: 32px; }
      #signature-dialog { background: white; border: 1px solid #333; left: 25%; padding: 16px; position: fixed; top: 20%; z-index: 4; }
      #signature-dialog canvas { border: 1px solid #555; display: block; height: 220px; width: 500px; }
      .fb-runtime-cascader-checkbox { border: 1px solid #555; display: inline-block; height: 12px; margin-left: 6px; width: 12px; }
      .fb-text-white { background: #1769aa; color: white; }
      .rating-icon--accent { color: #d97706; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    <p>本表单用于活动报名与信息登记，请按实际情况完整填写。</p>
    <strong>填写须知</strong>
    <ul>
      <li>请确保姓名、证件及联系方式真实有效。</li>
      <li>提交前请仔细核对，带星号项目为必填。</li>
    </ul>
    <main>
      ${pageOne}
      ${pageTwo}
      ${pageThree}
      <div class="fb-runtime-pagination-buttons"></div>
      <div class="fb-runtime-submit-button-wrap" hidden>
        <button class="fb-runtime-submit-button" type="button">提交</button>
      </div>
    </main>
    <script>
      const formId = ${JSON.stringify(formId)}
      const keys = ${JSON.stringify(fieldKeys)}
      const state = {
        page: 1,
        radioIndex: -1,
        date: '',
        time: '',
        imageName: '',
        fileName: '',
        cascaderSelected: false,
        signature: false,
        ranking: [],
        rating: 0,
        nps: 0,
      }

      const cardFor = (name) => document.querySelector('[data-item-key="' + CSS.escape(keys[name]) + '"]')
      const valueOf = (selector) => document.querySelector(selector).value.trim()
      const textOf = (selector) => document.querySelector(selector).textContent.trim()
      const addError = (target, message) => {
        const error = document.createElement('p')
        error.className = 'fb-runtime-field-error'
        error.textContent = message
        target.append(error)
      }
      const clearErrors = () => document.querySelectorAll('.fb-runtime-field-error').forEach((error) => error.remove())

      function showPage(pageNumber) {
        state.page = pageNumber
        document.querySelectorAll('[data-page]').forEach((section) => {
          section.hidden = Number(section.dataset.page) !== pageNumber
        })
        const pagination = document.querySelector('.fb-runtime-pagination-buttons')
        const submitWrap = document.querySelector('.fb-runtime-submit-button-wrap')
        if (pageNumber === 1) {
          pagination.innerHTML = '<button class="fb-runtime-submit-button" type="button" data-nav="next">下一页</button>'
        } else if (pageNumber === 2) {
          pagination.innerHTML = '<button class="fb-runtime-submit-button" type="button" data-nav="previous">上一页</button><button class="fb-runtime-submit-button" type="button" data-nav="next">下一页</button>'
        } else {
          pagination.innerHTML = '<button class="fb-runtime-submit-button" type="button" data-nav="previous">上一页</button>'
        }
        submitWrap.hidden = pageNumber !== 3
      }

      document.addEventListener('click', (event) => {
        const option = event.target.closest('[role="option"]')
        if (option) {
          const listbox = option.closest('[role="listbox"]')
          const trigger = document.querySelector('[aria-controls="' + CSS.escape(listbox.id) + '"]')
          trigger.textContent = option.textContent.trim()
          trigger.setAttribute('aria-expanded', 'false')
          listbox.hidden = true
          return
        }
        const trigger = event.target.closest('[role="combobox"][aria-controls]')
        if (trigger) {
          const listbox = document.getElementById(trigger.getAttribute('aria-controls'))
          trigger.setAttribute('aria-expanded', 'true')
          listbox.hidden = false
        }
      })

      document.querySelectorAll('.fb-ui-radio-group-item').forEach((control, index, controls) => {
        control.addEventListener('click', () => {
          controls.forEach((candidate) => candidate.dataset.state = 'unchecked')
          control.dataset.state = 'checked'
          state.radioIndex = index
          document.querySelector('#custom-radio-input').hidden = index !== 2
        })
      })
      document.querySelectorAll('.fb-ui-checkbox-root').forEach((control) => {
        control.addEventListener('click', () => {
          control.dataset.state = control.dataset.state === 'checked' ? 'unchecked' : 'checked'
        })
      })

      const dateOverlay = document.querySelector('[data-fb-date-overlay]')
      document.querySelector('#date-trigger').addEventListener('click', () => dateOverlay.hidden = false)
      dateOverlay.querySelector('button.fb-ring-1').addEventListener('click', () => {
        state.date = '2026-08-21'
        document.querySelector('#date-trigger').textContent = state.date
        dateOverlay.hidden = true
      })
      const timePanel = document.querySelector('.fb-timepicker-container')
      const timeActions = timePanel.querySelectorAll('button')
      document.querySelector('#time-trigger').addEventListener('click', () => timePanel.hidden = false)
      timeActions[0].addEventListener('click', () => state.time = '12:34:56')
      timeActions[1].addEventListener('click', () => {
        state.time = state.time || '12:34:56'
        document.querySelector('#time-trigger').textContent = state.time
        timePanel.hidden = true
      })

      function configureUpload(inputSelector, isImage) {
        const input = document.querySelector(inputSelector)
        input.addEventListener('change', () => {
          const file = input.files[0]
          if (!file) return
          const currentCard = input.closest('[data-item-key]')
          const status = currentCard.querySelector('.fb-runtime-upload-status')
          status.hidden = false
          status.textContent = file.name
          if (isImage) {
            state.imageName = file.name
            const preview = currentCard.querySelector('.fb-runtime-upload-image-preview')
            preview.innerHTML = ''
            const image = document.createElement('img')
            image.alt = file.name
            image.src = URL.createObjectURL(file)
            preview.append(image)
          } else {
            state.fileName = file.name
          }
        })
      }
      configureUpload('#image-upload-input', true)
      configureUpload('#file-upload-input', false)

      const cascaderTrigger = document.querySelector('.fb-runtime-cascader-trigger')
      const cascaderPanel = document.querySelector('#cascader-panel')
      cascaderTrigger.addEventListener('click', () => {
        cascaderPanel.hidden = false
        cascaderTrigger.dataset.state = 'open'
      })
      document.querySelector('#cascader-leaf').addEventListener('click', () => {
        state.cascaderSelected = true
        document.querySelector('#cascader-leaf .fb-runtime-cascader-checkbox').classList.add('fb-text-white')
        cascaderTrigger.textContent = '华东区 江苏省 南京市'
      })
      document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return
        cascaderPanel.hidden = true
        cascaderTrigger.dataset.state = 'closed'
        document.querySelectorAll('[role="listbox"]').forEach((listbox) => listbox.hidden = true)
        document.querySelectorAll('[role="combobox"][aria-expanded]').forEach((trigger) => trigger.setAttribute('aria-expanded', 'false'))
      })

      const signatureDialog = document.querySelector('#signature-dialog')
      document.querySelector('.fb-signature-empty-trigger').addEventListener('click', () => signatureDialog.hidden = false)
      signatureDialog.querySelector('button.fb-text-white').addEventListener('click', () => {
        state.signature = true
        signatureDialog.hidden = true
        document.querySelector('.fb-signature-filled-surface').hidden = false
      })

      document.querySelectorAll('.fb-runtime-ranking-item').forEach((item) => {
        item.addEventListener('click', () => {
          const label = item.textContent.trim()
          if (state.ranking.includes(label)) return
          state.ranking.push(label)
          const rendered = document.createElement('span')
          rendered.className = 'fb-runtime-ranking-label'
          rendered.textContent = label
          document.querySelector('.fb-runtime-ranking-ranked-list').append(rendered)
        })
      })
      document.querySelectorAll('button.rating-item').forEach((button) => {
        button.addEventListener('click', () => {
          document.querySelectorAll('button.rating-item span').forEach((icon) => icon.classList.remove('rating-icon--accent'))
          button.querySelector('span').classList.add('rating-icon--accent')
          state.rating = Number(button.dataset.score)
        })
      })
      document.querySelectorAll('button.nps-scale__score-btn').forEach((button) => {
        button.addEventListener('click', () => {
          document.querySelectorAll('button.nps-scale__score-btn').forEach((candidate) => candidate.classList.remove('fb-text-white'))
          button.classList.add('fb-text-white')
          state.nps = Number(button.dataset.score)
        })
      })

      function validatePageOne() {
        const checks = [
          ['username', valueOf('#username-input') && textOf('#name-title') !== '请选择称谓'],
          ['mobile', valueOf('#mobile-input')],
          ['email', valueOf('#email-input')],
          ['idCard', valueOf('#id-card-input')],
          ['landlinePhone', valueOf('#landline-input')],
          ['address', valueOf('#address-street-input') && textOf('#address-province') === '广东省' && textOf('#address-city') === '深圳市' && textOf('#address-district') === '南山区'],
          ['birthday', textOf('#birthday-year') === '1990' && textOf('#birthday-month') === '8' && textOf('#birthday-day') === '18'],
        ]
        let valid = true
        for (const [name, answered] of checks) {
          if (answered) continue
          addError(cardFor(name), '此题为必填项')
          valid = false
        }
        if (valid && !/^1\\d{10}$/.test(valueOf('#mobile-input'))) {
          addError(cardFor('mobile'), '请输入有效手机号')
          valid = false
        }
        return valid
      }

      function validatePageTwo() {
        const checked = [...document.querySelectorAll('.fb-ui-checkbox-root[data-state="checked"]')]
        const checks = [
          ['input', valueOf('#single-line-input')],
          ['textarea', valueOf('#textarea-input')],
          ['radio', state.radioIndex === 0],
          ['select', textOf('#select-input') === '选项2'],
          ['date', state.date],
          ['time', state.time],
          ['imageUpload', state.imageName],
          ['fileUpload', state.fileName],
        ]
        let valid = true
        for (const [name, answered] of checks) {
          if (answered) continue
          addError(cardFor(name), '此题为必填项')
          valid = false
        }
        if (checked.length < 2) {
          addError(cardFor('checkbox'), '至少选择两项')
          valid = false
        }
        const number = Number(valueOf('#number-input'))
        if (!Number.isFinite(number) || number < 0 || number > 100) {
          addError(cardFor('number'), '数字必须在 0 到 100 之间')
          valid = false
        }
        return valid
      }

      function validatePageThree() {
        const matrixComplete = [...document.querySelectorAll('[data-matrix-cell]')].every((input) => input.value.trim())
        const matrixChoiceComplete = [0, 1, 2].every((row) => document.querySelector('input[name="matrix-row-' + row + '"]:checked'))
        const checks = [
          ['cascader', state.cascaderSelected],
          ['signature', state.signature],
          ['matrix', matrixComplete],
          ['matrixChoice', matrixChoiceComplete],
          ['ranking', state.ranking.length === 3],
          ['rating', state.rating > 0],
          ['nps', state.nps > 0],
        ]
        let valid = true
        for (const [name, answered] of checks) {
          if (answered) continue
          addError(cardFor(name), '此题为必填项')
          valid = false
        }
        const groupContent = document.querySelector('.fb-runtime-field-group-instance-content')
        if (!valueOf('#group-username-input')) {
          addError(groupContent, '题组姓名为必填项')
          valid = false
        }
        if (!/^1\\d{10}$/.test(valueOf('#group-mobile-input'))) {
          addError(groupContent, '题组手机号为必填项')
          valid = false
        }
        return valid
      }

      async function validateAndAdvance() {
        clearErrors()
        const valid = state.page === 1 ? validatePageOne() : validatePageTwo()
        if (!valid) return
        const response = await fetch('/f/form/' + encodeURIComponent(formId) + '/submission/validate-page', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ page: state.page }),
        })
        const body = await response.json()
        if (Number(body.code) === 0) showPage(state.page + 1)
      }

      function submissionPayload() {
        const answer = (name, value) => ({ item_key: keys[name], answer: value })
        const checkedChoices = [...document.querySelectorAll('.fb-ui-checkbox-root[data-state="checked"]')]
          .map((control) => ({ name: control.textContent.trim(), value: control.dataset.value }))
        const matrix = Array.from({ length: 3 }, (_, row) => (
          [...document.querySelectorAll('[data-matrix-cell]')]
            .slice(row * 3, row * 3 + 3)
            .map((input) => input.value)
        ))
        const matrixChoices = [0, 1, 2].map((row) => {
          const selected = document.querySelector('input[name="matrix-row-' + row + '"]:checked')
          return { name: '选项' + (Number(selected.value.slice(-1))), value: selected.value }
        })
        return {
          form_id: formId,
          revision_no: 1,
          answers: [
            answer('username', { name_title: textOf('#name-title'), value: valueOf('#username-input') }),
            answer('mobile', { area_code: '+86', value: valueOf('#mobile-input') }),
            answer('email', valueOf('#email-input')),
            answer('idCard', { document_type: 'id_card', value: valueOf('#id-card-input') }),
            answer('landlinePhone', valueOf('#landline-input')),
            answer('address', {
              province: textOf('#address-province'),
              city: textOf('#address-city'),
              district: textOf('#address-district'),
              street: valueOf('#address-street-input'),
            }),
            answer('birthday', textOf('#birthday-year') + '-' + textOf('#birthday-month').padStart(2, '0') + '-' + textOf('#birthday-day').padStart(2, '0')),
            answer('input', valueOf('#single-line-input')),
            answer('textarea', valueOf('#textarea-input')),
            answer('radio', { name: '选项1', value: 'option_1' }),
            answer('checkbox', checkedChoices),
            answer('select', { name: textOf('#select-input'), value: 'option_2' }),
            answer('number', Number(valueOf('#number-input'))),
            answer('date', { value: state.date }),
            answer('time', { value: state.time }),
            answer('imageUpload', { upload_id: 'image-fixture', name: state.imageName }),
            answer('fileUpload', { upload_id: 'file-fixture', name: state.fileName }),
            answer('cascader', [{ name: '南京市', value: 'nanjing' }]),
            answer('signature', { upload_id: 'signature-fixture' }),
            answer('groupUsername', valueOf('#group-username-input')),
            answer('groupMobile', { area_code: '+86', value: valueOf('#group-mobile-input') }),
            answer('groupEmail', valueOf('#group-email-input')),
            answer('matrix', matrix),
            answer('matrixChoice', matrixChoices),
            answer('ranking', state.ranking.map((name) => ({ name, value: 'option_' + name.slice(-1) }))),
            answer('rating', state.rating),
            answer('nps', state.nps),
          ],
        }
      }

      document.querySelector('.fb-runtime-pagination-buttons').addEventListener('click', (event) => {
        const action = event.target.closest('[data-nav]')
        if (!action) return
        if (action.dataset.nav === 'previous') {
          clearErrors()
          showPage(state.page - 1)
          return
        }
        validateAndAdvance()
      })

      document.querySelector('.fb-runtime-submit-button-wrap button').addEventListener('click', async () => {
        clearErrors()
        if (!validatePageThree()) return
        const response = await fetch('/f/form/' + encodeURIComponent(formId) + '/submission', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(submissionPayload()),
        })
        const body = await response.json()
        const submissionId = String(body.data && body.data.submission_id || '')
        history.pushState({}, '', '/form/submission-result/')
        document.body.innerHTML = '<form-submission-result form-id="' + formId + '" submission-id="' + submissionId + '"></form-submission-result><main><h1>提交成功</h1></main>'
      })

      showPage(1)
      fetch('/f/form/' + encodeURIComponent(formId))
    </script>
  </body>
</html>`
}
