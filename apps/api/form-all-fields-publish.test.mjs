import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { basename } from 'node:path'
import test from 'node:test'

import {
  ADVANCED_FIELD_TYPES,
  CASCADER_LEVEL_VALUES,
  COMMON_FIELD_TYPES,
  CONTACT_FIELD_TYPES,
  DEFAULT_HEADER_IMAGE_PATH,
  DESCRIPTION_FIELD_CONTENT,
  DESCRIPTION_FIELD_TITLE,
  DIVIDER_TEXT,
  EXPECTED_FIELD_SEQUENCE,
  EXPECTED_SERVER_FIELD_SEQUENCE,
  FORM_CONTENT_HEADING,
  FORM_CONTENT_ITEMS,
  FORM_SUBTITLE,
  REQUIRED_FIELD_TYPES,
  run,
} from '../../scripts/form-all-fields-publish.ui.spec.mjs'

const IMAGE_FILE_NAME = basename(DEFAULT_HEADER_IMAGE_PATH)
const SYSTEM_ITEM_KEYS = ['duration', 'device', 'os', 'browser']
const SERVER_TYPE_BY_DESIGNER_TYPE = Object.freeze({
  idCard: 'id_card',
  landlinePhone: 'landline_phone',
  imageUpload: 'image_upload',
  fileUpload: 'file_upload',
  fieldGroup: 'field_group',
  matrixChoice: 'matrix_choice',
  ranking: 'sort',
})

function sendJson(response, body) {
  response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

function sendHtml(response, html) {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end(html)
}

function mockApplicationHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>Mock all-fields form activity</title>
  <style>
    body { font-family: sans-serif; }
    .palette { display: flex; flex-wrap: wrap; gap: 4px; }
    .form-field { min-height: 32px; margin: 4px; padding: 4px; border: 1px solid #ddd; }
    .field-panel { min-height: 80px; padding: 8px; border: 1px dashed #999; }
    .fb-edit-aside { min-height: 80px; }
    .fb-edit-aside label { display: block; margin: 4px; }
    .property-editor-range-number { display: flex; gap: 4px; }
    .fb-form-fields { margin-top: 8px; padding: 8px; border: 1px solid #aaa; }
    [role="dialog"] { position: relative; z-index: 10; margin: 8px; padding: 12px; border: 1px solid #555; background: #fff; }
    [data-fb-date-overlay] { position: fixed; z-index: 20; left: 400px; top: 120px; padding: 8px; background: #fff; border: 1px solid #333; }
    .fb-grid-cols-7 { display: grid; grid-template-columns: repeat(7, 32px); }
    .ProseMirror, .editable-div { min-height: 24px; padding: 2px; border: 1px solid #ddd; }
  </style>
</head>
<body>
  <main id="app"></main>
  <script>
    const app = document.querySelector('#app')
    const contactPresetTypes = ${JSON.stringify(CONTACT_FIELD_TYPES.slice(0, 3))}
    const paletteTypes = ${JSON.stringify([
      'contactGroup',
      ...CONTACT_FIELD_TYPES.slice(3),
      ...COMMON_FIELD_TYPES,
      'page',
      ...new Set([...ADVANCED_FIELD_TYPES, 'description', 'divider']),
    ])}
    const formSubtitle = ${JSON.stringify(FORM_SUBTITLE)}
    const formRichTextHeading = ${JSON.stringify(FORM_CONTENT_HEADING)}
    const formRichTextItems = ${JSON.stringify(FORM_CONTENT_ITEMS)}
    const cascaderPath = ${JSON.stringify(CASCADER_LEVEL_VALUES)}
    const descriptionTitle = ${JSON.stringify(DESCRIPTION_FIELD_TITLE)}
    const descriptionContent = ${JSON.stringify(DESCRIPTION_FIELD_CONTENT)}
    const dividerText = ${JSON.stringify(DIVIDER_TEXT)}
    const serverTypeByDesignerType = ${JSON.stringify(SERVER_TYPE_BY_DESIGNER_TYPE)}
    const systemItemKeys = ${JSON.stringify(SYSTEM_ITEM_KEYS)}
    const fieldLabels = ${JSON.stringify({
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
      page: '分页',
      cascader: '级联选择',
      signature: '手写签名',
      fieldGroup: '题组',
      description: DESCRIPTION_FIELD_TITLE,
      divider: DIVIDER_TEXT,
      matrix: '矩阵题',
      matrixChoice: '矩阵选择',
      ranking: '排序题',
      rating: '评分题',
      nps: 'NPS',
    })}
    let fields = []
    let selectedKey = ''
    let sequence = 0
    let headerUpload = null
    let appliedPalette = null
    let cascaderDialogKey = ''
    let cascaderBatchLevel = null
    let activeDateTarget = null
    let calendarYear = 0
    let calendarMonth = 0

    const token = () => localStorage.getItem('token') || ''
    async function api(path, options = {}) {
      const response = await fetch('/api' + path, {
        ...options,
        headers: { 'Content-Type': 'application/json', Authorization: token(), ...(options.headers || {}) },
      })
      const body = await response.json()
      if (!response.ok || !body || body.code !== 0) {
        throw new Error(body && body.message ? body.message : 'API business request failed')
      }
      return body
    }

    function button(text, attrs = '') {
      return '<button type="button" ' + attrs + '>' + text + '</button>'
    }
    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      })[character])
    }
    function checkedSwitch(label, setting, checked) {
      return '<label>' + label + '<button type="button" role="switch" data-setting="' + setting +
        '" aria-checked="' + checked + '" data-state="' + (checked ? 'checked' : 'unchecked') + '"></button></label>'
    }
    function makeField(type, required = false, parentGroupCode = '') {
      sequence += 1
      return {
        type,
        key: type + '-' + sequence,
        label: fieldLabels[type] || type,
        required,
        parentGroupCode,
        children: type === 'fieldGroup' ? [] : undefined,
        settings: {
          collectToContact: Boolean(parentGroupCode),
          choiceMode: type === 'cascader' ? 'single' : undefined,
        },
        checkboxOptionCount: type === 'checkbox' ? 2 : undefined,
        optionUploads: type === 'radio' ? [null, null] : undefined,
        levels: type === 'cascader' ? 2 : undefined,
        cascaderOptions: type === 'cascader' ? [] : undefined,
        description: type === 'description' ? '' : undefined,
      }
    }
    function rootFieldByKey(key) {
      return fields.find((field) => field.key === key) || null
    }
    function fieldByKey(key) {
      for (const field of fields) {
        if (field.key === key) return field
        const child = Array.isArray(field.children)
          ? field.children.find((candidate) => candidate.key === key)
          : null
        if (child) return child
      }
      return null
    }
    function insertAfterSelection(nextFields) {
      const selectedIndex = fields.findIndex((field) => field.key === selectedKey)
      const insertIndex = selectedIndex >= 0 ? selectedIndex + 1 : fields.length
      fields.splice(insertIndex, 0, ...nextFields)
      selectedKey = nextFields[nextFields.length - 1]?.key || selectedKey
    }
    function addContactChildren(group) {
      if (!group || group.type !== 'fieldGroup' || group.children.length) return
      group.children.push(...contactPresetTypes.map((type) => makeField(type, true, group.key)))
      selectedKey = group.children[group.children.length - 1].key
      renderDesignerFields()
      showActivityConsentDialog()
    }
    function addType(type) {
      if (type === 'contactGroup') {
        const selected = rootFieldByKey(selectedKey)
        if (selected && selected.type === 'fieldGroup') {
          addContactChildren(selected)
          return
        }
        insertAfterSelection(contactPresetTypes.map((fieldType) => makeField(fieldType, fieldType === 'username')))
      } else if (type === 'page' && !fields.some((field) => field.type === 'page')) {
        const selectedIndex = fields.findIndex((field) => field.key === selectedKey)
        const insertIndex = selectedIndex >= 0 ? selectedIndex + 1 : fields.length
        const firstPage = makeField('page')
        const secondPage = makeField('page')
        fields.unshift(firstPage)
        fields.splice(insertIndex + 1, 0, secondPage)
        selectedKey = secondPage.key
      } else {
        insertAfterSelection([makeField(type)])
      }
      renderDesignerFields()
    }

    async function uploadImage(file, includeTheme) {
      const signature = await api('/base/file/browser-upload/signature', {
        method: 'POST',
        body: JSON.stringify({
          original_name: file.name,
          size: file.size,
          mime_type: file.type || 'image/jpeg',
          file_type: 'image',
          visibility: 'private',
        }),
      })
      const authorization = signature.data
      const storageResponse = await fetch(authorization.url, {
        method: authorization.method,
        headers: authorization.headers || {},
        body: file,
      })
      if (!storageResponse.ok) throw new Error('storage upload failed')
      let theme = null
      if (includeTheme) {
        theme = await api('/base/file/browser-upload/theme?upload_id=' + encodeURIComponent(authorization.upload_id))
      }
      const complete = await api('/base/file/browser-upload/complete', {
        method: 'POST',
        body: JSON.stringify({ upload_id: authorization.upload_id }),
      })
      return {
        ...complete.data,
        upload_id: authorization.upload_id,
        color_theme: theme && theme.data ? theme.data.color_theme : null,
      }
    }

    function renderFieldMarkup(field, containerPath = '') {
      let inner = '<div class="field-title">' + escapeHtml(field.label) + '</div>'
      if (field.type === 'fieldGroup') {
        inner = '<header class="field-group-header">' + escapeHtml(field.label) + '</header>' +
          '<div class="field-panel" data-group-key="' + field.key + '">' +
          field.children.map((child) => renderFieldMarkup(child, field.key)).join('') + '</div>'
      } else if (field.type === 'radio' && field.settings.allowImage) {
        inner += field.optionUploads.map((upload, index) =>
          '<label>选项' + (index + 1) + '<input type="file" accept="image/*" id="option-image-' +
          field.key + '-' + index + '" data-option-index="' + index + '"></label>' +
          (upload ? '<img src="' + escapeHtml(upload.full_path) + '" alt="选项图片">' : '')
        ).join('')
        inner += '<input type="file" accept="image/*" id="option-image-' + field.key + '--1">'
      } else if (field.type === 'checkbox') {
        inner += Array.from({ length: field.checkboxOptionCount }, (_, index) =>
          '<button type="button" class="checkbox-option-handle" data-option-handle="' + index + '">选项' + (index + 1) + '</button>'
        ).join('')
        inner += button('添加选项', 'data-add-checkbox-option="' + field.key + '"')
      } else if (field.type === 'cascader') {
        inner += button('添加选项', 'data-open-cascader="' + field.key + '"')
      } else if (field.type === 'description') {
        inner = '<div class="editable-div description-title" contenteditable="true">' + escapeHtml(field.label) + '</div>' +
          '<div class="description-wrapper__desc-editor"><div class="ProseMirror" contenteditable="true">' +
          escapeHtml(field.description || '') + '</div></div>'
      } else if (field.type === 'divider') {
        inner = '<div class="fb-runtime-divider-text">' + escapeHtml(field.label) + '</div>'
      }
      return '<div class="form-field" draggable="true" data-component-type="' + field.type +
        '" data-container-path="' + escapeHtml(containerPath) + '" data-field-key="' + field.key + '">' + inner + '</div>'
    }

    function renderDesignerFields() {
      const canvas = document.querySelector('#fields')
      if (!canvas) return
      canvas.innerHTML = fields.map((field) => renderFieldMarkup(field)).join('')
      canvas.querySelectorAll('.form-field').forEach((element) => {
        element.addEventListener('click', (event) => {
          if (event.target.closest('input[type="file"], button, [contenteditable="true"]')) return
          event.stopPropagation()
          selectedKey = element.dataset.fieldKey
          renderFieldEditor()
        })
      })
      canvas.querySelectorAll('.field-group-header').forEach((header) => {
        header.addEventListener('click', (event) => {
          event.stopPropagation()
          selectedKey = header.closest('.form-field').dataset.fieldKey
          renderFieldEditor()
        })
      })
      canvas.querySelectorAll('.field-panel').forEach((panel) => {
        panel.addEventListener('dragover', (event) => event.preventDefault())
        panel.addEventListener('drop', (event) => {
          event.preventDefault()
          addContactChildren(rootFieldByKey(panel.dataset.groupKey))
        })
      })
      canvas.querySelectorAll('[data-add-checkbox-option]').forEach((control) => {
        control.addEventListener('click', (event) => {
          event.stopPropagation()
          const field = fieldByKey(control.dataset.addCheckboxOption)
          field.checkboxOptionCount += 1
          renderDesignerFields()
        })
      })
      canvas.querySelectorAll('[data-open-cascader]').forEach((control) => {
        control.addEventListener('click', (event) => {
          event.stopPropagation()
          cascaderDialogKey = control.dataset.openCascader
          renderCascaderDialog()
        })
      })
      canvas.querySelectorAll('input[data-option-index]').forEach((input) => {
        input.addEventListener('change', async () => {
          const field = fieldByKey(input.closest('.form-field').dataset.fieldKey)
          const index = Number(input.dataset.optionIndex)
          field.optionUploads[index] = await uploadImage(input.files[0], false)
          renderDesignerFields()
        })
      })
      const description = fields.find((field) => field.type === 'description')
      const descriptionElement = description
        ? canvas.querySelector('.form-field[data-field-key="' + description.key + '"]')
        : null
      if (descriptionElement) {
        descriptionElement.querySelector('.description-title').addEventListener('input', (event) => {
          description.label = event.target.textContent
        })
        descriptionElement.querySelector('.description-wrapper__desc-editor .ProseMirror').addEventListener('input', (event) => {
          description.description = event.target.innerHTML
        })
      }
      renderFieldEditor()
    }

    function renderFieldEditor() {
      const editor = document.querySelector('.fb-edit-aside')
      if (!editor) return
      const field = fieldByKey(selectedKey)
      if (!field) {
        editor.innerHTML = ''
        return
      }
      const supportsRequired = field.type !== 'page' && field.type !== 'fieldGroup' &&
        field.type !== 'description' && field.type !== 'divider'
      let html = supportsRequired ? checkedSwitch('是否必填', 'required', field.required) : ''
      if (field.type === 'username') {
        html += checkedSwitch('采集称谓', 'nameTitle', Boolean(field.settings.nameTitle))
      } else if (field.type === 'idCard') {
        html += checkedSwitch('自定义证件类型', 'customDocument', Boolean(field.settings.customDocument))
      } else if (field.type === 'input') {
        html += checkedSwitch('是否字数限制', 'lengthLimit', Boolean(field.settings.lengthLimit))
        html += '<div class="property-editor-range-number"><input placeholder="最小值" value="0"><input data-range="max" placeholder="最大值" value="' +
          escapeHtml(field.settings.maxLength || '') + '"></div>'
      } else if (field.type === 'radio') {
        html += checkedSwitch('允许用户输入', 'allowCustomizedText', Boolean(field.settings.allowCustomizedText))
        html += checkedSwitch('添加选项图片', 'allowImage', Boolean(field.settings.allowImage))
      } else if (field.type === 'checkbox') {
        html += checkedSwitch('选择限制', 'selectionLimit', Boolean(field.settings.selectionLimit))
        html += '<div class="property-editor-range-number"><input data-range="min" placeholder="最小值" value="' +
          escapeHtml(field.settings.minSelection || '') + '"><input data-range="max" placeholder="最大值" value="' +
          escapeHtml(field.settings.maxSelection || '') + '"></div>'
      } else if (field.type === 'number') {
        html += checkedSwitch('设置限制', 'numberLimit', Boolean(field.settings.numberLimit))
      } else if (field.type === 'date') {
        html += checkedSwitch('日期范围限定', 'dateLimit', Boolean(field.settings.dateLimit))
        html += '<div class="date-range-limit"><div><span>开始日期</span><button type="button" data-date-target="start">' +
          escapeHtml(field.settings.dateStart || '开始日期') + '</button></div><div><span>结束日期</span><button type="button" data-date-target="end">' +
          escapeHtml(field.settings.dateEnd || '结束日期') + '</button></div></div>'
      } else if (field.type === 'cascader') {
        html += button('多选', 'data-cascader-mode="multiple" aria-pressed="' + (field.settings.choiceMode === 'multiple') + '"')
      } else if (field.type === 'divider') {
        html += '<label>分割线文案<input placeholder="请输入分割线文案" data-divider-text value="' + escapeHtml(field.label) + '"></label>'
      }
      if (field.parentGroupCode) {
        html += checkedSwitch('是否收录联系人', 'collectToContact', Boolean(field.settings.collectToContact))
      }
      editor.innerHTML = html
      editor.querySelectorAll('[role="switch"]').forEach((control) => {
        control.addEventListener('click', () => {
          const setting = control.dataset.setting
          if (setting === 'required') field.required = !field.required
          else field.settings[setting] = !field.settings[setting]
          if (setting === 'allowImage') renderDesignerFields()
          else renderFieldEditor()
        })
      })
      editor.querySelectorAll('[data-range]').forEach((input) => {
        input.addEventListener('input', () => {
          if (field.type === 'input' && input.dataset.range === 'max') field.settings.maxLength = Number(input.value)
          if (field.type === 'checkbox' && input.dataset.range === 'min') field.settings.minSelection = Number(input.value)
          if (field.type === 'checkbox' && input.dataset.range === 'max') field.settings.maxSelection = Number(input.value)
        })
      })
      editor.querySelectorAll('[data-date-target]').forEach((control) => {
        control.addEventListener('click', () => openDateOverlay(control.dataset.dateTarget))
      })
      editor.querySelectorAll('[data-cascader-mode]').forEach((control) => {
        control.addEventListener('click', () => {
          field.settings.choiceMode = control.dataset.cascaderMode
          renderFieldEditor()
        })
      })
      const dividerInput = editor.querySelector('[data-divider-text]')
      if (dividerInput) {
        dividerInput.addEventListener('input', () => {
          field.label = dividerInput.value
          const label = document.querySelector('.form-field[data-field-key="' + field.key + '"] .fb-runtime-divider-text')
          if (label) label.textContent = field.label
        })
      }
    }

    function openDateOverlay(target) {
      activeDateTarget = target
      const now = new Date()
      calendarYear = now.getFullYear()
      calendarMonth = now.getMonth()
      renderDateOverlay()
    }
    function renderDateOverlay() {
      document.querySelector('[data-fb-date-overlay]')?.remove()
      const overlay = document.createElement('div')
      overlay.setAttribute('data-fb-date-overlay', '')
      const days = new Date(calendarYear, calendarMonth + 1, 0).getDate()
      overlay.innerHTML = '<div><button type="button" data-calendar-prev><svg class="lucide-chevron-left"></svg></button>' +
        '<span>' + calendarYear + '年' + (calendarMonth + 1) + '月</span>' +
        '<button type="button" data-calendar-next><svg class="lucide-chevron-right"></svg></button></div>' +
        '<div class="fb-grid-cols-7">' + Array.from({ length: days }, (_, index) =>
          '<button type="button" data-calendar-day="' + (index + 1) + '">' + (index + 1) + '</button>'
        ).join('') + '</div>' + button('确定', 'data-calendar-confirm')
      document.body.appendChild(overlay)
      overlay.querySelector('[data-calendar-prev]').onclick = () => {
        calendarMonth -= 1
        if (calendarMonth < 0) { calendarMonth = 11; calendarYear -= 1 }
        renderDateOverlay()
      }
      overlay.querySelector('[data-calendar-next]').onclick = () => {
        calendarMonth += 1
        if (calendarMonth > 11) { calendarMonth = 0; calendarYear += 1 }
        renderDateOverlay()
      }
      overlay.querySelectorAll('[data-calendar-day]').forEach((control) => {
        control.onclick = () => {
          const day = String(control.dataset.calendarDay).padStart(2, '0')
          const value = calendarYear + '-' + String(calendarMonth + 1).padStart(2, '0') + '-' + day
          const field = fieldByKey(selectedKey)
          field.settings[activeDateTarget === 'start' ? 'dateStart' : 'dateEnd'] = value
          overlay.remove()
          renderFieldEditor()
        }
      })
    }

    function renderCascaderDialog() {
      document.querySelector('#cascader-dialog')?.remove()
      const field = fieldByKey(cascaderDialogKey)
      if (!field) return
      const dialog = document.createElement('div')
      dialog.id = 'cascader-dialog'
      dialog.setAttribute('role', 'dialog')
      dialog.innerHTML = '<h2>级联选项设置</h2><div role="tablist">' + [2, 3, 4, 5].map((level) =>
        '<button type="button" role="tab" data-cascader-level="' + level + '" aria-selected="' + (field.levels === level) + '">' + level + '级</button>'
      ).join('') + '</div><div class="cascader-level-columns">' + Array.from({ length: field.levels }, (_, index) =>
        '<section><span>第' + (index + 1) + '级</span>' + button('批量编辑', 'data-cascader-batch="' + index + '"') + '</section>'
      ).join('') + '</div>' + button('取消', 'data-cascader-cancel') + button('保存设置', 'data-cascader-save')
      document.body.appendChild(dialog)
      dialog.querySelectorAll('[data-cascader-level]').forEach((control) => {
        control.onclick = () => {
          field.levels = Number(control.dataset.cascaderLevel)
          renderCascaderDialog()
        }
      })
      dialog.querySelectorAll('[data-cascader-batch]').forEach((control) => {
        control.onclick = () => openCascaderBatch(Number(control.dataset.cascaderBatch))
      })
      dialog.querySelector('[data-cascader-cancel]').onclick = () => dialog.remove()
      dialog.querySelector('[data-cascader-save]').onclick = () => {
        dialog.remove()
        renderDesignerFields()
      }
    }
    function openCascaderBatch(level) {
      cascaderBatchLevel = level
      const field = fieldByKey(cascaderDialogKey)
      const dialog = document.createElement('div')
      dialog.id = 'cascader-batch-dialog'
      dialog.className = 'fb-fixed fb-inset-0'
      dialog.setAttribute('role', 'dialog')
      dialog.innerHTML = '<h3>批量编辑</h3><textarea placeholder="每行一个选项">' +
        escapeHtml(field.cascaderOptions[level] || '') + '</textarea>' + button('取消', 'data-batch-cancel') + button('确定', 'data-batch-confirm')
      document.body.appendChild(dialog)
      dialog.querySelector('[data-batch-cancel]').onclick = () => dialog.remove()
      dialog.querySelector('[data-batch-confirm]').onclick = () => {
        field.cascaderOptions[cascaderBatchLevel] = dialog.querySelector('textarea').value.trim()
        dialog.remove()
      }
    }

    function showActivityConsentDialog() {
      if (document.querySelector('#activity-consent')) return
      const dialog = document.createElement('div')
      dialog.id = 'activity-consent'
      dialog.setAttribute('role', 'dialog')
      dialog.innerHTML = '<h2>代为报名设置确认</h2><p>支持在题组创建姓名题型并收录联系人。</p>' + button('我已知悉', 'data-activity-consent')
      document.body.appendChild(dialog)
      dialog.querySelector('[data-activity-consent]').onclick = async () => {
        await api('/be/form/202/activity/update-props', { method: 'PUT', body: JSON.stringify({ enrollment_type: 'proxy' }) })
        await api('/be/form/202', { method: 'GET' })
        dialog.remove()
      }
    }

    function formItemsPayload(title) {
      const flattened = []
      let sort = 0
      function append(field, groupCode = '') {
        const commonConfig = {}
        if (groupCode) {
          commonConfig.collect_to_contact = {
            enabled: field.settings.collectToContact ? 1 : 2,
            anchor: '',
          }
        }
        const ruleConfig = { required: { enabled: field.required ? 1 : 2 } }
        sort += 1
        const item = {
          type_code: serverTypeByDesignerType[field.type] || field.type,
          item_key: field.key,
          label: field.label,
          description: field.type === 'description' ? field.description : '',
          customized_key: '',
          placeholder: '',
          sort,
          hidden: 2,
          private: 2,
          common_config: commonConfig,
          rule_config: ruleConfig,
          ...(groupCode ? { group_code: groupCode } : {}),
        }
        if (field.type === 'username') commonConfig.name_title = { enabled: field.settings.nameTitle ? 1 : 2 }
        if (field.type === 'idCard') commonConfig.collect_mode = { custom_enabled: field.settings.customDocument ? 1 : 2 }
        if (field.type === 'input') ruleConfig.length = { enabled: field.settings.lengthLimit ? 1 : 2, min: 0, max: field.settings.maxLength || null }
        if (field.type === 'radio') {
          commonConfig.allow_customized_text = { enabled: field.settings.allowCustomizedText ? 1 : 2 }
          commonConfig.allow_image = field.settings.allowImage ? 1 : 2
          item.option = { choices: field.optionUploads.map((upload, index) => ({
            title: '选项' + (index + 1),
            value: 'option_' + (index + 1),
            upload_id: upload?.upload_id || '',
          })) }
        }
        if (field.type === 'checkbox') {
          ruleConfig.length = {
            enabled: field.settings.selectionLimit ? 1 : 2,
            min: field.settings.minSelection || null,
            max: field.settings.maxSelection || null,
          }
          item.option = { choices: Array.from({ length: field.checkboxOptionCount }, (_, index) => ({
            title: '选项' + (index + 1), value: 'option_' + (index + 1),
          })) }
        }
        if (field.type === 'number') {
          commonConfig.decimals = 2
          ruleConfig.length = { enabled: field.settings.numberLimit ? 1 : 2, min: 0, max: 100 }
        }
        if (field.type === 'date') ruleConfig.date_range = {
          enabled: field.settings.dateLimit ? 1 : 2,
          start: field.settings.dateStart || null,
          end: field.settings.dateEnd || null,
        }
        if (field.type === 'cascader') {
          commonConfig.type_mode = field.settings.choiceMode
          commonConfig.levels = field.levels
          item.option = { choices: [{
            name: field.cascaderOptions[0] || cascaderPath[0],
            value: 'east',
            sub_choices: [{
              name: field.cascaderOptions[1] || cascaderPath[1],
              value: 'jiangsu',
              sub_choices: [{ name: field.cascaderOptions[2] || cascaderPath[2], value: 'nanjing' }],
            }],
          }] }
        }
        if (field.type === 'description') item.subtitle = ''
        flattened.push(item)
        if (field.type === 'fieldGroup') field.children.forEach((child) => append(child, field.key))
      }
      fields.forEach((field) => append(field))
      for (const itemKey of systemItemKeys) {
        sort += 1
        flattened.push({
          label: itemKey,
          item_key: itemKey,
          customized_key: '',
          type_code: itemKey === 'duration' ? 'number' : 'input',
          sort,
          hidden: 1,
          private: 2,
        })
      }
      return {
        revision_no: 1,
        title,
        subtitle: formSubtitle,
        description: '<p><strong>' + formRichTextHeading + '</strong></p><ul><li><p>' +
          formRichTextItems[0] + '</p></li><li><p>' + formRichTextItems[1] + '</p></li></ul>',
        items: flattened,
      }
    }

    function formConfigPayload() {
      const palette = appliedPalette || ['#334155', '#2563eb', '#ffffff', '#f8fafc', '#0f766e', '#14b8a6', '#e2e8f0']
      return {
        revision_no: 1,
        theme_config: {
          wallpaper: { background_color: { enabled: 1, color: palette[4] }, background_image: null },
          form_container: { background_color: palette[6] },
          form_style: { selected: 'classic' },
          header_image: {
            hidden: 2,
            type: 'image',
            image: {
              upload_id: headerUpload?.upload_id || '',
              height: { default: 240 },
              postion: { x: '50%', y: '50%' },
            },
          },
          form_title: {
            title: { hidden: 2, text_align: 'left' },
            subtitle: { hidden: 2, text_align: 'left' },
            description: { hidden: 2, text_align: 'left' },
          },
          submit_button: { background_color: palette[1], hidden: 2, text: '提交', font_size: '16px' },
          footer_logo: { hidden: 2 },
        },
        submit_config: { sequence_number: { enabled: 1, selected: '1' } },
      }
    }

    function render() {
      if (location.pathname === '/form-activity/index') {
        app.innerHTML = '<button id="blank" type="button">从空白表单开始</button>'
        document.querySelector('#blank').onclick = async () => {
          const result = await api('/be/form', { method: 'POST', body: '{}' })
          setTimeout(() => { location.href = '/form-activity/designer?id=' + result.data.id }, 100)
        }
        return
      }

      if (location.pathname === '/form-activity/designer') {
        app.innerHTML = [
          '<aside class="palette">' + paletteTypes.map((type) => button(type, 'draggable="true" data-component-type="' + type + '"')).join('') + '</aside>',
          button('预览', 'aria-label="预览" id="preview"'),
          '<h1><div class="editable-div" contenteditable="true">未命名表单</div></h1>',
          '<div class="fb-runtime-form-subtitle"><div class="editable-div" contenteditable="true"></div></div>',
          '<div class="designer-info-content-wrap"><div class="fb-richtext-editor"><div class="rich-toolbar">' +
            button('加粗', 'aria-label="加粗" data-rich-command="bold"') +
            button('无序列表', 'aria-label="无序列表" data-rich-command="insertUnorderedList"') +
            '</div><div class="ProseMirror" contenteditable="true"></div></div></div>',
          '<section id="fields"></section>',
          '<aside class="fb-edit-aside"></aside>',
          '<section id="preview-settings"></section>',
          button('保存草稿', 'aria-label="保存草稿" id="save"'),
          '<div class="form-activity-step-nav"><span class="form-activity-step" id="settings">' +
            '<span class="form-activity-step__text">基础设置</span></span></div>',
          '<header><span>基础设置</span></header>',
          '<div role="dialog" id="collect-dialog"><h2>是否收录联系人</h2>' +
            button('确认收录到联系人', 'id="confirm-collect"') + '</div>',
        ].join('')
        document.querySelectorAll('.palette [data-component-type]').forEach((element) => {
          element.onclick = () => addType(element.dataset.componentType)
          element.ondragstart = (event) => event.dataTransfer.setData('text/plain', element.dataset.componentType)
        })
        const richEditor = document.querySelector('.designer-info-content-wrap .ProseMirror')
        let richMode = 'plain'
        let richHeadingValue = ''
        let richListValues = []
        let richSelectAll = false
        const renderRichEditor = () => {
          richEditor.innerHTML = (richHeadingValue
            ? '<p><strong>' + escapeHtml(richHeadingValue) + '</strong></p>'
            : '') + (richListValues.length
            ? '<ul>' + richListValues.map((item) => '<li>' + escapeHtml(item) + '</li>').join('') + '</ul>'
            : '')
        }
        richEditor.addEventListener('keydown', (event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
            event.preventDefault()
            richSelectAll = true
            return
          }
          if (event.key === 'Backspace' && richSelectAll) {
            event.preventDefault()
            richHeadingValue = ''
            richListValues = []
            richMode = 'plain'
            richSelectAll = false
            renderRichEditor()
            return
          }
          richSelectAll = false
          if (event.key === 'Enter') {
            event.preventDefault()
            if (richMode === 'list') richListValues.push('')
          }
        })
        richEditor.addEventListener('beforeinput', (event) => {
          if (event.inputType !== 'insertText' || !event.data) return
          event.preventDefault()
          if (richMode === 'bold') {
            richHeadingValue += event.data
          } else if (richMode === 'list') {
            if (!richListValues.length) richListValues.push('')
            richListValues[richListValues.length - 1] += event.data
          }
          renderRichEditor()
        })
        document.querySelectorAll('[data-rich-command]').forEach((control) => {
          control.onmousedown = (event) => event.preventDefault()
          control.onclick = () => {
            if (control.dataset.richCommand === 'bold') {
              richMode = richMode === 'bold' ? 'plain' : 'bold'
            } else if (control.dataset.richCommand === 'insertUnorderedList') {
              richMode = 'list'
              if (!richListValues.length) richListValues.push('')
              renderRichEditor()
            }
            richEditor.focus()
          }
        })
        document.querySelector('#confirm-collect').onclick = () => {
          document.querySelector('#collect-dialog').innerHTML = [
            '<h2>联系人信息替换确认</h2>',
            '<label><input type="radio" name="initial-strategy" value="ignore">忽略，不替换</label>',
            button('确定', 'id="confirm-initial-strategy"'),
          ].join('')
          document.querySelector('#confirm-initial-strategy').onclick = async () => {
            await api('/be/form/202/config', { method: 'PUT', body: JSON.stringify({ selected: 'ignore' }) })
            addType('contactGroup')
            document.querySelector('#collect-dialog').remove()
          }
        }
        document.querySelector('#preview').onclick = () => {
          const previewSettings = document.querySelector('#preview-settings')
          previewSettings.className = 'fb-form-fields'
          previewSettings.innerHTML = '<h2>呈现设置</h2>' + button('上传头图', 'aria-label="上传头图"') +
            '<input type="file" accept="image/*" data-header-upload>'
          previewSettings.querySelector('[data-header-upload]').onchange = async (event) => {
            headerUpload = await uploadImage(event.target.files[0], true)
            const dialog = document.createElement('div')
            dialog.id = 'theme-dialog'
            dialog.setAttribute('role', 'dialog')
            dialog.innerHTML = '<h2>智能色系调色盘</h2>' + button('应用配色', 'data-apply-theme')
            document.body.appendChild(dialog)
            dialog.querySelector('[data-apply-theme]').onclick = () => {
              appliedPalette = headerUpload.color_theme.palette
              dialog.remove()
            }
          }
        }
        document.querySelector('#save').onclick = async () => {
          const id = new URL(location.href).searchParams.get('id')
          const title = document.querySelector('h1 .editable-div').textContent
          await api('/be/form/' + id + '/items', {
            method: 'PUT',
            body: JSON.stringify(formItemsPayload(title)),
          })
          await api('/be/form/' + id + '/config', {
            method: 'PUT',
            body: JSON.stringify(formConfigPayload()),
          })
          const toast = document.createElement('div')
          toast.textContent = '保存成功'
          app.appendChild(toast)
        }
        document.querySelector('#settings').onclick = () => {
          location.href = '/form-activity/settings?id=202'
        }
        renderDesignerFields()
        return
      }

      if (location.pathname === '/form-activity/settings') {
        app.innerHTML = [
          button('发布', 'aria-label="发布" id="publish"'),
          button('收录联系人设置', 'data-menu-key="collect-contact" id="contact-settings"'),
          '<section id="contact-panel"></section>',
        ].join('')
        document.querySelector('#contact-settings').onclick = () => {
          document.querySelector('#contact-panel').innerHTML = [
            button('', 'role="switch" aria-label="是否收录联系人开关" aria-checked="true" data-state="checked"'),
            button('编辑', 'aria-label="是否收录联系人" id="edit-contact"'),
            '<div id="strategy"></div>',
          ].join('')
          document.querySelector('#edit-contact').onclick = () => {
            document.querySelector('#strategy').innerHTML = [
              '<label><input type="radio" name="strategy" value="ignore">忽略，不替换</label>',
              button('确认', 'aria-label="确认" id="confirm-contact"'),
            ].join('')
            document.querySelector('#confirm-contact').onclick = async () => {
              await api('/be/form/202/config', { method: 'PUT', body: JSON.stringify({ selected: 'ignore' }) })
              document.querySelector('#strategy').innerHTML = '<span>忽略，不替换</span>'
            }
          }
        }
        document.querySelector('#publish').onclick = async () => {
          await api('/be/form/202/publish', { method: 'POST', body: '{}' })
          setTimeout(() => { location.href = '/form-activity/list' }, 100)
        }
        return
      }

      if (location.pathname === '/form-activity/list') {
        app.innerHTML = [
          '<span class="form-activity-audit-tabs"><span>已发布</span></span>',
          '<input placeholder="请输入标题">',
          button('查询', 'aria-label="查询" id="search"'),
          '<section id="results"></section>',
        ].join('')
        document.querySelector('#search').onclick = async () => {
          const title = document.querySelector('input').value
          const result = await api('/be/form/list?filter%5Btitle%5D=' + encodeURIComponent(title))
          const record = result.data.list.find((item) => item.title === title)
          document.querySelector('#results').innerHTML = record
            ? '<a class="form-activity-list__title-link">' + escapeHtml(record.title) + '</a>'
            : ''
        }
      }
    }
    render()
  </script>
</body>
</html>`
}

test('creates, configures, uploads, saves, and publishes the complete three-page form', async () => {
  const requests = []
  const signatureRequests = []
  const storageUploads = []
  const themeRequests = []
  const completeRequests = []
  let savedItemsPayload = null
  let savedConfigPayload = null
  let savedTitle = ''
  let published = false
  let strategy = ''
  let forcedBusinessFailure = ''
  let uploadSequence = 0
  const uploadIntents = new Map()

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')

    if (request.method === 'PUT' && url.pathname.startsWith('/storage/')) {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      const uploadId = url.pathname.split('/').pop()
      const bytes = Buffer.concat(chunks)
      storageUploads.push({ uploadId, size: bytes.length, contentType: request.headers['content-type'] })
      response.writeHead(200)
      response.end()
      return
    }

    if (!url.pathname.startsWith('/api/')) {
      sendHtml(response, mockApplicationHtml())
      return
    }

    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const rawBody = Buffer.concat(chunks).toString('utf8')
    const body = rawBody ? JSON.parse(rawBody) : {}
    const recorded = {
      method: request.method,
      path: url.pathname,
      authorization: request.headers.authorization,
      body,
    }
    requests.push(recorded)

    if (request.method === 'POST' && url.pathname === '/api/base/file/browser-upload/signature') {
      uploadSequence += 1
      const uploadId = '550e8400-e29b-41d4-a716-' + String(446655440000 + uploadSequence).padStart(12, '0')
      uploadIntents.set(uploadId, { ...body, uploadId })
      signatureRequests.push({ ...recorded, uploadId })
      sendJson(response, {
        code: 0,
        message: 'success',
        data: {
          upload_id: uploadId,
          method: 'PUT',
          url: 'http://' + request.headers.host + '/storage/' + uploadId,
          headers: { 'Content-Type': body.mime_type },
          form_fields: {},
          expires_at: '2026-08-14 18:00:00',
        },
      })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/base/file/browser-upload/theme') {
      const uploadId = url.searchParams.get('upload_id')
      themeRequests.push({ ...recorded, uploadId })
      sendJson(response, {
        code: 0,
        message: 'success',
        data: {
          color_theme: {
            meta: { source: 'mock-jpeg' },
            palette: ['#334155', '#2563eb', '#ffffff', '#f8fafc', '#0f766e', '#14b8a6', '#e2e8f0'],
            light: {},
            dark: {},
          },
        },
      })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/base/file/browser-upload/complete') {
      const intent = uploadIntents.get(body.upload_id)
      completeRequests.push(recorded)
      assert.ok(intent, 'complete 必须引用已签名的 upload_id')
      sendJson(response, {
        code: 0,
        message: 'success',
        data: {
          id: uploadSequence,
          disk: 'oss',
          visibility: 'private',
          name: 'mock-' + uploadSequence + '.jpeg',
          path: 'develop/team-1/mock-' + uploadSequence + '.jpeg',
          size: intent.size,
          mime_type: intent.mime_type,
          original_name: intent.original_name,
          full_path: 'https://files.example.test/develop/team-1/mock-' + uploadSequence + '.jpeg',
        },
      })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/be/form') {
      sendJson(response, { code: 0, message: 'success', data: { id: 202 } })
      return
    }
    if (request.method === 'PUT' && url.pathname === '/api/be/form/202/activity/update-props') {
      sendJson(response, { code: 0, message: 'success', data: {} })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/be/form/202') {
      sendJson(response, { code: 0, message: 'success', data: { form: { id: 202 } } })
      return
    }
    if (request.method === 'PUT' && url.pathname === '/api/be/form/202/items') {
      savedItemsPayload = body
      savedTitle = body.title
      sendJson(response, { code: 0, message: 'success', data: { revision_no: 1 } })
      return
    }
    if (request.method === 'PUT' && url.pathname === '/api/be/form/202/config') {
      if (forcedBusinessFailure === 'save-config' && body.revision_no) {
        sendJson(response, { code: 422001, message: 'mock config business failure', data: null })
        return
      }
      if (body.revision_no) savedConfigPayload = body
      strategy = body.selected || strategy
      sendJson(response, { code: 0, message: 'success', data: { revision_no: 1 } })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/be/form/202/publish') {
      if (forcedBusinessFailure === 'publish') {
        sendJson(response, { code: 403001, message: 'mock publish business failure', data: null })
        return
      }
      published = true
      sendJson(response, {
        code: 0,
        message: 'success',
        data: { form_id: 202, revision_no: 1, status: 'published' },
      })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/be/form/list') {
      sendJson(response, {
        code: 0,
        message: 'success',
        data: {
          list: [{
            id: 202,
            title: savedTitle,
            status: published ? 'published' : 'draft',
            current_revision_no: 1,
          }],
          total: 1,
        },
      })
      return
    }
    response.writeHead(404)
    response.end()
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const origin = 'http://127.0.0.1:' + address.port
    const logs = []
    const runScenario = () => run({
      siteBaseUrl: origin + '/',
      apiBaseUrl: origin + '/api',
      ignoreHTTPSErrors: false,
      extraHTTPHeaders: { Authorization: 'Bearer all-fields-token' },
      captureFailureScreenshot: false,
      logger: (level, message, details) => logs.push({ level, message, details }),
    })
    const result = await runScenario()

    assert.equal(result.formId, '202')
    assert.equal(result.status, 'published')
    assert.equal(result.browser, 'chrome')
    assert.equal(result.headless, true)
    assert.equal(result.pageCount, 3)
    assert.equal(result.totalComponentCount, EXPECTED_FIELD_SEQUENCE.length)
    assert.equal(result.requiredQuestionCount, REQUIRED_FIELD_TYPES.length)
    assert.match(result.title, /^自动化测试全题型表单-\d+$/)
    assert.equal(savedTitle, result.title)

    assert.ok(savedItemsPayload, '必须发送真实 items 保存载荷')
    assert.equal(savedItemsPayload.revision_no, 1)
    assert.equal(savedItemsPayload.subtitle, FORM_SUBTITLE)
    assert.match(savedItemsPayload.description, /<strong>填写须知<\/strong>/)
    assert.match(savedItemsPayload.description, /<ul>/)
    for (const item of FORM_CONTENT_ITEMS) assert.ok(savedItemsPayload.description.includes(item))
    assert.ok(Array.isArray(savedItemsPayload.items))

    assert.ok(savedItemsPayload.items.every((item) => Number(item.sort) >= 1))
    const businessItems = savedItemsPayload.items.filter((item) => Number(item.hidden) !== 1)
    assert.deepEqual(businessItems.map((item) => item.type_code), EXPECTED_SERVER_FIELD_SEQUENCE)
    for (const systemKey of SYSTEM_ITEM_KEYS) {
      assert.ok(savedItemsPayload.items.some((item) => item.item_key === systemKey && item.hidden === 1))
    }
    const byType = (type) => savedItemsPayload.items.find((item) => item.type_code === type && !item.group_code)
    assert.equal(byType('username').common_config.name_title.enabled, 1)
    assert.equal(byType('id_card').common_config.collect_mode.custom_enabled, 1)
    assert.deepEqual(byType('input').rule_config.length, { enabled: 1, min: 0, max: 20 })
    assert.equal(byType('radio').common_config.allow_customized_text.enabled, 1)
    assert.equal(byType('radio').common_config.allow_image, 1)
    assert.equal(byType('radio').option.choices.length, 2)
    assert.ok(byType('radio').option.choices.every((choice) => choice.upload_id))
    assert.deepEqual(byType('checkbox').rule_config.length, { enabled: 1, min: 2, max: 3 })
    assert.equal(byType('checkbox').option.choices.length, 3)
    assert.equal(byType('number').rule_config.length.enabled, 1)
    assert.equal(byType('number').common_config.decimals, 2)
    assert.equal(byType('date').rule_config.date_range.enabled, 1)
    assert.match(byType('date').rule_config.date_range.start, /^\d{4}-\d{2}-\d{2}$/)
    assert.match(byType('date').rule_config.date_range.end, /^\d{4}-\d{2}-\d{2}$/)

    const cascader = byType('cascader')
    assert.equal(cascader.common_config.type_mode, 'multiple')
    assert.equal(cascader.common_config.levels, 3)
    assert.equal(cascader.option.choices[0].name, CASCADER_LEVEL_VALUES[0])
    assert.equal(cascader.option.choices[0].sub_choices[0].name, CASCADER_LEVEL_VALUES[1])
    assert.equal(cascader.option.choices[0].sub_choices[0].sub_choices[0].name, CASCADER_LEVEL_VALUES[2])

    const group = byType('field_group')
    assert.ok(group)
    const groupChildren = savedItemsPayload.items.filter((item) => item.group_code === group.item_key)
    assert.deepEqual(groupChildren.map((item) => item.type_code), ['username', 'mobile', 'email'])
    assert.ok(groupChildren.every((item) => item.rule_config.required.enabled === 1))
    assert.ok(groupChildren.every((item) => item.common_config.collect_to_contact.enabled === 1))
    assert.equal(byType('description').label, DESCRIPTION_FIELD_TITLE)
    assert.ok(byType('description').description.includes(DESCRIPTION_FIELD_CONTENT))
    assert.equal(byType('divider').label, DIVIDER_TEXT)
    assert.equal(savedItemsPayload.items.some((item) => item.type_code === 'payment'), false)

    assert.equal(signatureRequests.length, 3, '两张选项图和一张头图应分别申请签名')
    assert.equal(storageUploads.length, 3)
    assert.equal(completeRequests.length, 3)
    assert.equal(themeRequests.length, 1, '只有头图应请求系统推荐配色')
    assert.ok(signatureRequests.every((entry) => entry.body.original_name === IMAGE_FILE_NAME))
    assert.ok(signatureRequests.every((entry) => entry.body.mime_type === 'image/jpeg'))
    assert.ok(signatureRequests.every((entry) => entry.body.file_type === 'image'))
    assert.ok(signatureRequests.every((entry) => entry.body.visibility === 'private'))
    assert.ok(storageUploads.every((entry) => entry.size > 0 && entry.contentType === 'image/jpeg'))
    assert.equal(themeRequests[0].uploadId, signatureRequests[2].uploadId)

    assert.ok(savedConfigPayload, '必须发送真实 config 保存载荷')
    assert.equal(savedConfigPayload.revision_no, 1)
    assert.equal(savedConfigPayload.theme_config.header_image.image.upload_id, themeRequests[0].uploadId)
    assert.equal(savedConfigPayload.theme_config.submit_button.background_color, '#2563eb')
    assert.equal(savedConfigPayload.theme_config.form_container.background_color, '#e2e8f0')
    assert.equal(savedConfigPayload.theme_config.wallpaper.background_color.color, '#0f766e')
    assert.equal(strategy, 'ignore')
    assert.equal(published, true)

    const businessRequests = requests.filter((entry) => entry.path.startsWith('/api/be/') || entry.path.startsWith('/api/base/'))
    assert.ok(businessRequests.length >= 12)
    assert.ok(businessRequests.every((entry) => entry.authorization === 'Bearer all-fields-token'))
    assert.ok(logs.some((log) => log.level === 'success' && log.message.includes('全题型三页 UI 自动化执行完成')))

    forcedBusinessFailure = 'save-config'
    await assert.rejects(
      runScenario,
      /保存表单配置业务码应为 0/,
      'HTTP 200 但保存业务码非 0 时必须失败',
    )

    forcedBusinessFailure = 'publish'
    await assert.rejects(
      runScenario,
      /发布表单业务码应为 0/,
      'HTTP 200 但发布业务码非 0 时必须失败',
    )
    forcedBusinessFailure = ''
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
