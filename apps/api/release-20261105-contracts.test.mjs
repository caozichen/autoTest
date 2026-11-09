import assert from 'node:assert/strict'
import test from 'node:test'
import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'
import { assertFilteredRecords, openAllSearchFields } from '../../scripts/form-activity-search-category.ui.spec.mjs'
import { assertPublishedListRecord, assertPublishedListUi, structuralSignature } from '../../scripts/form-multilingual-translation-publish.ui.spec.mjs'

test('title search accepts remark-only hits and rejects records matching neither field', () => {
  assert.doesNotThrow(() => assertFilteredRecords([{ id: 'remark', title: '其他标题', remark: '目标关键字' }],
    'filter[title]', '关键字', '备注命中'))
  assert.throws(() => assertFilteredRecords([{ id: 'invalid', title: '其他标题', remark: '无关备注' }],
    'filter[title]', '关键字', '不应命中'))
})

test('choice hint translations leave structure stable while values, rules and unrelated metadata stay protected', () => {
  const payload = { data: { form: { id: 'form', current_revision_no: 1 }, items: [{ item_key: 'radio',
    type_code: 'radio', common_config: { remark: 'structural metadata' },
    rule_config: { required: { enabled: 1 } }, option: { choices: [{ value: 'a', name: '甲', remark: '携带资料' }] } }] } }
  const translated = structuredClone(payload)
  translated.data.items[0].option.choices[0].name = 'A'
  translated.data.items[0].option.choices[0].remark = 'Bring documents'
  assert.deepEqual(structuralSignature(translated), structuralSignature(payload))
  for (const change of [
    item => { item.option.choices[0].value = 'b' },
    item => { item.rule_config.required.enabled = 2 },
    item => { item.common_config.remark = 'changed metadata' },
  ]) {
    const changed = structuredClone(translated)
    change(changed.data.items[0])
    assert.notDeepEqual(structuralSignature(changed), structuralSignature(payload))
  }
  const ranking = structuredClone(payload)
  ranking.data.items[0].type_code = 'ranking'
  const changedRanking = structuredClone(ranking)
  changedRanking.data.items[0].option.choices[0].remark = 'not a translatable choice hint'
  assert.notDeepEqual(structuralSignature(changedRanking), structuralSignature(ranking))
})

test('publication checks find a pinned target using the same display rows as the product', () => {
  const pinned = { id: 'target', title: '目标表单', status: 'published', current_revision_no: 1,
    translation_progress: { total: 2, completed: 2, published_languages: 2 } }
  const match = assertPublishedListRecord({ data: { pinned_list: [pinned], list: [{ id: 'ordinary' }] } },
    'target', '目标表单', 1)
  assert.equal(match.record.id, 'target')
  assert.equal(match.recordIndex, 0)
})

test('published list targets an exact id query parameter despite prefix collisions and reordered rows', async () => {
  const browser = await launchGoogleChrome()
  try {
    const page = await browser.newPage()
    const operations = ['?id=abc123', '?id=abc123&tab=1', '?id=abc123#section',
      '?tab=1&id=abc123', '?tab=1&id=abc123&other=2', '?tab=1&id=abc123#section', '?id=%61bc123']
    let table = ''
    await page.route('http://list.local/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: table }))
    const row = (title, operation) => `<tr class="arco-table-tr"><td><a class="form-activity-list__title-link">${title}</a>
      <div class="form-activity-list-operation-bar"><a href="/settings${operation}">设置</a></div></td>
      <td><a class="arco-link" href="/form-activity/translation?id=abc123">2/2</a><span>已发布</span></td></tr>`
    for (const operation of operations) {
      table = `<table><tbody>${row('前缀碰撞', '?id=abc123x')}${row('相似参数名', '?otherid=abc123')}
        ${row('片段参数', '#?id=abc123')}${row('参数值内的URL', '?next=/settings?id=abc123')}
        ${row('重复参数', '?id=other&id=abc123')}${row('目标表单', operation)}</tbody></table>`
      await page.goto('http://list.local/list')
      await assertPublishedListUi(page, '目标表单', 'abc123')
      assert.equal(new URL(page.url()).searchParams.get('id'), 'abc123')
    }
  } finally { await browser.close() }
})

test('search setup explicitly enables the hidden linked column and maps reordered fields by identity', async () => {
  const definitions = [
    ['filter[created_at_between]', 'created_at', '创建时间'], ['filter[title]', 'title', '标题或备注'],
    ['filter[form_type]', 'is_activity', '类型'], ['filter[creator_name]', 'creator_name', '创建人'],
    ['filter[time_range]', 'submission_status', '填报状态'], ['filter[end_time_between]', 'end_time', '填报结束时间'],
    ['filter[status]', 'status_text', '发布状态'], ['filter[updated_at_between]', 'updated_at', '更新时间'],
  ]
  const browser = await launchGoogleChrome()
  try {
    const page = await browser.newPage()
    const checkboxes = (column, valueIndex) => definitions.map(d => `<label><input type="checkbox" value="${d[valueIndex]}" ${d[1] === 'end_time' ? '' : 'checked'}>${d[2]}</label>`).join('')
    await page.setContent(`<div class="table-toolbar"><button onclick="document.querySelector('.arco-modal').style.display='block'">自定义列表字段</button></div>
      <div class="arco-modal" style="display:none"><div class="fields-modal-content">
      <div class="basic-setting-list">${checkboxes('basic', 1)}</div>
      <div class="search-setting-list">${checkboxes('search', 0)}</div></div>
      <button id="confirm">确认</button><button onclick="document.querySelector('.arco-modal').style.display='none'">取消</button></div>
      <div class="custom-filter"><div class="comp-filter-card"></div></div>`)
    await page.evaluate(defs => {
      window.settingsSaveCount = 0
      const render = () => {
        document.querySelector('.comp-filter-card').innerHTML = [...defs].reverse()
          .filter(d => document.querySelector(`.basic-setting-list input[value="${d[1]}"]`).checked
            && document.querySelector(`.search-setting-list input[value="${d[0]}"]`).checked)
          .map(d => `<div class="filter-card-field" data-key="${d[0]}"><label class="filter-card-label">${d[2]}</label><div class="filter-card-control"><input></div></div>`).join('')
      }
      document.querySelector('#confirm').onclick = () => {
        window.settingsSaveCount++
        render()
        document.querySelector('.arco-modal').style.display = 'none'
      }
      render()
    }, definitions)
    assert.equal(await page.locator('.filter-card-field').count(), 7)
    const fields = await openAllSearchFields(page)
    assert.equal(fields.size, 8)
    for (const [key] of definitions) assert.equal(await fields.get(key).getAttribute('data-key'), key)
    assert.equal(await page.evaluate(() => window.settingsSaveCount), 1)
    await page.close()
  } finally { await browser.close() }
})
