import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { executeRegisteredScript } from './script-runner.mjs'
import { SCRIPT_ID, run, resolveEditValues } from '../../scripts/form-all-fields-submit.ui.spec.mjs'
import { resolvePipelinePath } from './pipeline-values.mjs'

test('registered editor requires an existing submission and rejects public or creation paths', async () => {
  await assert.rejects(() => run(), /必须通过 FORM_ID 和 SUBMISSION_ID/)
  for (const requestPath of [
    '/form/?id=linked-form',
    '/form-activity/submission/preview/reply/create?fid=linked-form',
    '/form-activity/submission/preview/reply/{{SUBMISSION_ID}}?fid=linked-form',
    '/form-activity/submission/preview/reply/linked-submission?fid={{FORM_ID}}',
    '/form-activity/submission/preview/reply/linked-submission',
  ]) await assert.rejects(() => run({ requestPath }), /提报编辑 URL|提报详情 URL/)
  await assert.rejects(() => run({
    requestPath: '/form-activity/submission/preview/reply/linked-submission?fid=linked-form',
    variables: { SUBMISSION_ID: 'another-submission' },
  }), /SUBMISSION_ID.*不一致/)
})

test('keeps unchanged saves as baseline and permits explicitly configured real edits', () => {
  assert.equal(resolveEditValues({ SUBMISSION_EDIT_VALUES: '{"单行输入":"旧会话值"}' }), '{}')
  assert.equal(resolveEditValues({ SUBMISSION_EDIT_MODE: 'configured', SUBMISSION_EDIT_VALUES: '{"单行输入":"本次修改"}' }), '{"单行输入":"本次修改"}')
  assert.throws(() => resolveEditValues({ SUBMISSION_EDIT_MODE: 'unknown' }), /仅支持/)
  assert.throws(() => resolveEditValues({ SUBMISSION_EDIT_MODE: 'configured' }), /非空/)
})

for (const editMode of ['unchanged', 'configured']) {
test(`registered editor waits for original answers and persists ${editMode} values on the same submission`, async (t) => {
  const formId = 'linked-form'
  const submissionId = 'existing-submission'
  const original = { username: '原提报姓名', groupUsername: '原题组姓名' }
  const expectedSaved = editMode === 'configured' ? { ...original, username: '本次修改后的姓名' } : original
  let saved = { ...original }
  const requests = []
  const mutations = []
  let answersLoaded = false
  const answerDetail = () => ({ code: 0, data: {
    submission: { id: submissionId, form_id: formId, revision_no: 1 },
    items: Object.entries(saved).map(([item_key, answer], index) => ({ item_key, revision_no: 1, sort: index + 1, type_code: 'username', label: '姓名', value: [{ answer_item_key: item_key, answer }] })),
  } })
  const artifactRootDirectory = await mkdtemp(join(tmpdir(), 'autotest-existing-reply-'))
  const detailPath = `/form-activity/submission/preview/reply/${submissionId}?fid=${formId}`
  const apiPath = `/api/be/form/${formId}/submission/${submissionId}`
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://fixture.local')
    requests.push({ method: request.method, path: url.pathname })
    const json = (body) => {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(body))
    }
    if (request.method === 'GET' && url.pathname === apiPath) {
      if (url.searchParams.has('editing')) {
        // An enabled submit button and empty inputs appear before the answer body finishes.
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.flushHeaders()
        setTimeout(() => {
          answersLoaded = true
          response.end(JSON.stringify({ code: 0, data: saved }))
        }, 900)
      } else json(answerDetail())
      return
    }
    if (request.method === 'PUT' && url.pathname === apiPath) {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      mutations.push({ body, answersLoaded, authorization: request.headers.authorization })
      saved = body.answers
      json({ code: 0, data: { submission_id: submissionId } })
      return
    }
    if (url.pathname === new URL(detailPath, 'http://fixture.local').pathname) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(`<!doctype html><html><head><link rel="icon" href="data:,"></head><body><main></main><script>
        const main = document.querySelector('main')
        const apiPath = ${JSON.stringify(apiPath)}
        const headers = { 'Content-Type': 'application/json', Authorization: localStorage.getItem('token') }
        const labels = ['username', 'groupUsername']
        const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
        const shell = body => { main.innerHTML = '<h2>联动表单</h2><span><span aria-hidden="true"></span> 已提交 </span><h3>提报信息</h3>' + body }
        async function detail() {
          const result = await fetch(apiPath, { headers }).then(r => r.json())
          shell(labels.map(key => '<div class="reply-kv__row"><span class="reply-kv__label">姓名</span><span class="reply-kv__value">' + escape(result.data.items.find(item => item.item_key === key).value[0].answer) + '</span></div>').join('') + '<button id="edit">编辑</button>')
          document.querySelector('#edit').onclick = edit
        }
        async function edit() {
          shell('<button id="cancel">取消编辑</button><button id="submit">提交</button>' + labels.map(key => '<section class="fb-p-4 fb-px-6"><div class="fb-runtime-field-heading">姓名</div><input name="' + key + '" value=""></section>').join(''))
          document.querySelector('#cancel').onclick = detail
          document.querySelector('#submit').onclick = async () => {
            const answers = Object.fromEntries(labels.map(key => [key, document.querySelector('[name="' + key + '"]').value]))
            await fetch(apiPath, { method: 'PUT', headers, body: JSON.stringify({ answers }) }).then(r => r.json())
            await detail()
          }
          const result = await fetch(apiPath + '?editing=1', { headers }).then(r => r.json())
          labels.forEach(key => { document.querySelector('[name="' + key + '"]').value = result.data[key] })
        }
        detail()
      </script></body></html>`)
      return
    }
    response.writeHead(404)
    response.end('not found')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    await rm(artifactRootDirectory, { recursive: true, force: true })
  })
  const origin = `http://127.0.0.1:${server.address().port}`
  const config = JSON.parse(await readFile(new URL('../../config/scripts/form-all-fields-submit.json', import.meta.url), 'utf8'))
  const submissionAssertions = {
    title: '联动表单', primaryContactName: original.username, groupContactName: original.groupUsername,
    fields: { '姓名[1]': original.username, '姓名[2]': original.groupUsername },
  }
  const variables = {
    FORM_ID: formId, SUBMISSION_ID: submissionId, SUBMISSION_ASSERTIONS: JSON.stringify(submissionAssertions),
    SUBMISSION_EDIT_VALUES: JSON.stringify({ '姓名[1]': '不应应用的会话旧值' }),
    ...(editMode === 'configured' ? { SUBMISSION_EDIT_MODE: 'configured', SUBMISSION_EDIT_VALUES: JSON.stringify({ '姓名[1]': expectedSaved.username }) } : {}),
  }
  const result = await executeRegisteredScript({
    runId: 'edit-attempt-001', executionId: 'edit-execution-001', scriptId: SCRIPT_ID,
    context: {
      siteBaseUrl: origin, apiBaseUrl: `${origin}/api`, authorizationOrigin: origin,
      requestPath: resolvePipelinePath(config.requestPath, variables), variables,
      extraHTTPHeaders: { Authorization: 'Bearer registered-edit-token' },
    },
  }, { artifactRootDirectory })
  assert.equal(result.ok, true, [result.error, ...result.assertions.filter(a => a.status === 'failed').map(a => `${a.name}: ${a.error}`)].filter(Boolean).join('\n'))
  assert.deepEqual(saved, expectedSaved)
  assert.deepEqual(mutations, [{ body: { answers: expectedSaved }, answersLoaded: true, authorization: 'Bearer registered-edit-token' }])
  assert.equal(requests.filter(r => r.method === 'POST').length, 0)
  assert.ok(requests.filter(r => r.method === 'GET' && r.path === apiPath).length >= 4)
  assert.equal(result.result.scriptId, SCRIPT_ID)
  assert.equal(result.result.formId, formId)
  assert.equal(result.result.submissionId, submissionId)
  assert.equal(result.result.updateRequestCount, 1)
  assert.equal(result.result.createRequestCount, 0)
  assert.equal(result.result.reloaded, true)
  assert.deepEqual(result.result.appliedEditFields, editMode === 'configured' ? ['姓名[1]'] : [])
  assert.deepEqual(result.result.submissionAssertions, submissionAssertions)
  assert.equal(result.artifacts.length, 2)
  assert.ok(result.artifacts.every(artifact => artifact.stepId === SCRIPT_ID && artifact.type === 'screenshot'))
  assert.doesNotMatch(JSON.stringify(result), /registered-edit-token/)
})
}
