import {
  EXPECTED_FORM_TITLE,
  FIELD_KEYS,
  FORM_ID,
  PUBLISHED_FIELD_TYPES,
  REQUIRED_ROOT_FIELD_KEYS,
} from '../../../scripts/form-lpxavn-submit.ui.spec.mjs'

export const NAME_TITLES = Object.freeze([
  'Mr.（先生）',
  'Ms.（女士）',
  'Mrs.（太太）',
  'Dr.（医生/博士）',
])

function option(name, value) {
  return { name, value }
}

export function createPublishedFormFixture() {
  const requiredKeys = new Set(REQUIRED_ROOT_FIELD_KEYS)
  const items = Object.entries(PUBLISHED_FIELD_TYPES).map(([itemKey, typeCode]) => ({
    item_key: itemKey,
    type_code: typeCode,
    group_code: '',
    hidden: 2,
    label: itemKey,
    description: '',
    rule_config: { required: { enabled: requiredKeys.has(itemKey) ? 1 : 2 } },
    common_config: {},
  }))
  const byKey = new Map(items.map((item) => [item.item_key, item]))
  const field = (key) => byKey.get(key)

  Object.assign(field(FIELD_KEYS.username).common_config, {
    name_title: {
      enabled: 1,
      choices: NAME_TITLES.map((title, index) => ({ code: `title_${index + 1}`, title })),
    },
  })
  field(FIELD_KEYS.email).rule_config.regex_format = { enabled: 1 }
  const documentTypes = Array.from({ length: 10 }, (_, index) => ({
    code: `document_${index + 1}`,
    title: `证件${index + 1}`,
  }))
  Object.assign(field(FIELD_KEYS.idCard).common_config, {
    collect_mode: {
      custom_enabled: 1,
      choices: documentTypes,
      selected: documentTypes.map(({ code }) => code),
    },
  })
  field(FIELD_KEYS.input).rule_config.length = { enabled: 1, min: 0, max: 20 }

  Object.assign(field(FIELD_KEYS.radio), {
    common_config: { allow_image: 1, allow_customized_text: { enabled: 1 } },
    option: {
      choices: [
        { ...option('选项1', 'option_1'), image_id: 'image-1', image_url: 'https://files.example.test/1.png' },
        { ...option('选项2', 'option_2'), image_id: 'image-2', image_url: 'https://files.example.test/2.png' },
        option('其他', 'option_other'),
      ],
    },
  })
  Object.assign(field(FIELD_KEYS.checkbox), {
    rule_config: {
      required: { enabled: 1 },
      length: { enabled: 1, min: 2, max: 3 },
    },
    option: { choices: [option('选项1', 'option_1'), option('选项2', 'option_2'), option('选项3', 'option_3')] },
  })
  field(FIELD_KEYS.select).option = {
    choices: [option('选项1', 'option_1'), option('选项2', 'option_2')],
  }
  Object.assign(field(FIELD_KEYS.number), {
    rule_config: {
      required: { enabled: 1 },
      length: { enabled: 1, min: 0, max: 100 },
    },
    common_config: { decimals: 2 },
  })
  field(FIELD_KEYS.date).rule_config.date_range = {
    enabled: 1,
    start: '2026-08-18',
    end: '2026-09-17',
  }
  field(FIELD_KEYS.imageUpload).common_config = {
    max_size: 20,
    max_file_quantity: 1,
    media_type: [{
      type: 'image',
      extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'psd', 'tif', 'heic', 'heif'],
    }],
  }
  field(FIELD_KEYS.fileUpload).common_config = {
    max_size: 20,
    max_file_quantity: 1,
    media_type: [{ type: 'unlimited', extensions: [] }],
  }
  Object.assign(field(FIELD_KEYS.cascader), {
    common_config: { levels: 3, type_mode: 'multiple' },
    option: {
      choices: [{
        ...option('华东区', 'east'),
        sub_choices: [{
          ...option('江苏省', 'jiangsu'),
          sub_choices: [option('南京市', 'nanjing')],
        }],
      }],
    },
  })
  field(FIELD_KEYS.fieldGroup).common_config = {
    allow_add_item: { enabled: 1, min: 1, max: 5 },
  }
  for (const [key, anchor, required] of [
    [FIELD_KEYS.groupUsername, 'username', 1],
    [FIELD_KEYS.groupMobile, 'mobile', 1],
    [FIELD_KEYS.groupEmail, 'email', 2],
  ]) {
    Object.assign(field(key), {
      group_code: FIELD_KEYS.fieldGroup,
      rule_config: { required: { enabled: required } },
      common_config: { collect_to_contact: { enabled: 1, anchor } },
    })
  }
  Object.assign(field(FIELD_KEYS.description), {
    label: '报名与联系人说明',
    description: '<p>请确认联系人信息准确无误，提交后将用于活动报名及相关通知。</p>',
  })
  field(FIELD_KEYS.divider).label = '补充信息'
  field(FIELD_KEYS.matrix).option = {
    statements: ['题目1', '题目2', '题目3'].map((label, index) => ({
      label,
      item_key: `row_${index + 1}`,
    })),
    dimensions: ['项目1', '项目2', '项目3'].map((name, index) => ({
      name,
      value: `col_${index + 1}`,
    })),
  }
  field(FIELD_KEYS.matrixChoice).option = {
    choice_style: 'single',
    statements: Array.from({ length: 3 }, (_, index) => ({
      label: `题目${index + 1}`,
      item_key: `row_${index + 1}`,
    })),
    choices: Array.from({ length: 3 }, (_, index) => option(`选项${index + 1}`, `col_${index + 1}`)),
  }
  field(FIELD_KEYS.ranking).option = {
    choices: Array.from({ length: 3 }, (_, index) => option(`选项${index + 1}`, `option_${index + 1}`)),
  }
  field(FIELD_KEYS.rating).common_config.rating_max = 5
  field(FIELD_KEYS.nps).common_config.rating_max = 10

  return {
    code: 0,
    data: {
      revision_no: 1,
      form: {
        form_id: FORM_ID,
        status: 'published',
        title: EXPECTED_FORM_TITLE,
        subtitle: '本表单用于活动报名与信息登记，请按实际情况完整填写。',
        description: '<p><strong>填写须知</strong></p><ul><li>请确保姓名、证件及联系方式真实有效。</li><li>提交前请仔细核对，带星号项目为必填。</li></ul>',
        submitted_config: { contact_collect_mode: { enabled: 1, selected: 'ignore' } },
        theme_config: {
          header_image: { image: { id: 'header-image', url: 'https://files.example.test/header.png' } },
          submit_button: { background_color: '#123456' },
          form_container: { background_color: '#abcdef' },
          wallpaper: { background_color: { color: '#fedcba' } },
        },
      },
      items: [
        { type_code: 'page', item_key: 'page_1', group_code: '', hidden: 2 },
        { type_code: 'page', item_key: 'page_2', group_code: '', hidden: 2 },
        { type_code: 'page', item_key: 'page_3', group_code: '', hidden: 2 },
        ...items,
      ],
    },
  }
}

export function createSubmissionPayload(data) {
  const entry = (itemKey, answer) => ({ item_key: itemKey, answer })
  return {
    form_id: FORM_ID,
    revision_no: 1,
    answers: [
      entry(FIELD_KEYS.username, { name_title: data.nameTitle, value: data.username }),
      entry(FIELD_KEYS.mobile, { area_code: '+86', value: data.mobile }),
      entry(FIELD_KEYS.email, data.email),
      entry(FIELD_KEYS.idCard, { document_type: 'id_card', value: data.idCard }),
      entry(FIELD_KEYS.landlinePhone, data.landlinePhone),
      entry(FIELD_KEYS.address, {
        province: data.province,
        city: data.city,
        district: data.district,
        street: data.street,
      }),
      entry(FIELD_KEYS.birthday, '1990-08-18'),
      entry(FIELD_KEYS.input, data.singleLine),
      entry(FIELD_KEYS.textarea, data.multiLine),
      entry(FIELD_KEYS.radio, { name: data.radio, value: 'option_1' }),
      entry(FIELD_KEYS.checkbox, data.checkbox.map((name, index) => ({
        name,
        value: `option_${index + 1}`,
      }))),
      entry(FIELD_KEYS.select, { name: data.select, value: 'option_2' }),
      entry(FIELD_KEYS.number, Number(data.number)),
      entry(FIELD_KEYS.date, { value: '2026-08-21' }),
      entry(FIELD_KEYS.time, { value: '12:34:56' }),
      entry(FIELD_KEYS.imageUpload, { upload_id: 'image-upload-id' }),
      entry(FIELD_KEYS.fileUpload, { upload_id: 'file-upload-id' }),
      entry(FIELD_KEYS.cascader, [{ name: '南京市', value: 'u6oPXf' }]),
      entry(FIELD_KEYS.signature, { upload_id: 'signature-upload-id' }),
      entry(FIELD_KEYS.groupUsername, data.groupUsername),
      entry(FIELD_KEYS.groupMobile, { area_code: '+86', value: data.groupMobile }),
      entry(FIELD_KEYS.groupEmail, data.groupEmail),
      entry(FIELD_KEYS.matrix, data.matrix),
      entry(FIELD_KEYS.matrixChoice, ['col_1', 'col_2', 'col_3']),
      entry(FIELD_KEYS.ranking, data.ranking.map((name) => ({
        name,
        value: `option_${name.at(-1)}`,
      }))),
      entry(FIELD_KEYS.rating, data.rating),
      entry(FIELD_KEYS.nps, data.nps),
      entry(FIELD_KEYS.description, { value: [], _customized: '' }),
      entry(FIELD_KEYS.divider, { value: [], _customized: '' }),
    ],
  }
}

export function remapFixtureKeys(fixture) {
  const keyMap = new Map(fixture.data.items.map((item, index) => [
    item.item_key,
    `linked_${String(index + 1).padStart(2, '0')}`,
  ]))
  for (const item of fixture.data.items) {
    item.item_key = keyMap.get(item.item_key)
    if (item.group_code) item.group_code = keyMap.get(item.group_code) || item.group_code
  }
  return keyMap
}
