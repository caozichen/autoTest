import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'
import { resolveChannelFormUrl, assertSubmittedChannel, parseSearchSamples, prepareSubmissionSearchSamples } from '../../scripts/support/submission-search-samples.mjs'

const channel = { code: 'runCode42', title: '本轮测试渠道', link: 'https://form.test/form/?id=form1&channel_code=runCode42' }
test('channel URL must preserve environment, form and code, and the real submission must carry that code', () => {
  const base = 'https://form.test/form/?id=form1'
  assert.equal(resolveChannelFormUrl(base), base)
  assert.equal(resolveChannelFormUrl(base, channel), channel.link)
  for (const link of ['https://other.test/form/?id=form1&channel_code=runCode42',
    'https://form.test/form/?id=other&channel_code=runCode42',
    'https://form.test/form/?id=form1&channel_code=wrong',
    `${channel.link}&channel_code=wrong`]) assert.throws(() => resolveChannelFormUrl(base, { ...channel, link }))
  assertSubmittedChannel({ answers: { channel: channel.code } }, channel)
  assert.throws(() => assertSubmittedChannel({ answers: {} }, channel))
  assert.throws(() => parseSearchSamples({ remark: '' }))
})

for (const scenario of ['saved', 'lost-remark', 'lost-channel']) test(`remark preparation independently detects ${scenario}`, async t => {
  let remark = ''
  let writes = 0
  let documents = 0
  const token = 'Bearer fixture-admin'
  const requests = []
  const server = createServer(async (request, response) => {
    requests.push({ path: request.url, authorization: request.headers.authorization })
    const path = new URL(request.url, 'http://fixture.test').pathname
    if (path.startsWith('/form-activity/')) {
      documents++
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(`<link rel="icon" href="data:,"><aside class="reply-detail-page__aside"><div class="reply-detail-page__tabs"><button class="arco-tabs-tab arco-tabs-tab-active">基本信息</button><button class="arco-tabs-tab">备注</button></div><main id="basic">基本信息</main><div id="remark" hidden><section class="reply-remark__composer-card"><textarea></textarea><button class="arco-btn-primary">确认</button></section><div id="history"></div></div></aside>
        <script>const endpoint='/api/be/form/form1/submission/submission1/remark';
        const headers={Authorization:localStorage.getItem('token'),'Content-Type':'application/json'};
        async function load(){const body=await fetch(endpoint,{headers}).then(r=>r.json());document.querySelector('#history').replaceChildren(...body.data.list.map(item=>{const p=document.createElement('p');p.className='reply-remark__content';p.textContent=item.remark;return p}))}
        document.querySelector('.arco-btn-primary').onclick=async()=>{const remark=document.querySelector('textarea').value;await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({remark})});await load()};
        document.querySelectorAll('.arco-tabs-tab').forEach((button,index)=>button.onclick=()=>{document.querySelectorAll('.arco-tabs-tab').forEach(tab=>tab.classList.toggle('arco-tabs-tab-active',tab===button));document.querySelector('#basic').hidden=index===1;document.querySelector('#remark').hidden=index===0;if(index===1)load()})</script>`)
      return
    }
    response.setHeader('Content-Type', 'application/json')
    if (path.endsWith('/remark')) {
      if (request.method === 'POST') {
        writes++
        let source = ''
        for await (const chunk of request) source += chunk
        // Render success initially but lose it on refresh to exercise persistence.
        remark = JSON.parse(source).remark
      }
      response.end(JSON.stringify({ code: 0, data: request.method === 'POST' ? { id: 'remark1' }
        : { list: remark && !(scenario === 'lost-remark' && documents > 1) ? [{ id: 'remark1', remark }] : [] } }))
      return
    }
    response.end(JSON.stringify({ code: 0, data: { submission: { id: 'submission1', form_id: 'form1' },
      items: [{ item_key: 'channel', value: [{ answer: scenario === 'lost-channel' ? '' : channel.code }] }] } }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const browser = await launchGoogleChrome()
  t.after(async () => { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  const run = () => prepareSubmissionSearchSamples({ browser, siteBaseUrl: origin, apiBaseUrl: `${origin}/api`, authorization: token,
    formId: 'form1', submissionId: 'submission1', channel, runMarker: 'fixture-run', variables: {} })
  if (scenario === 'saved') {
    const result = await run()
    assert.equal(result.remark, remark)
    assert.equal(result.channel.code, channel.code)
    assert.ok(requests.filter(item => item.path.startsWith('/api/')).every(item => item.authorization === token))
  } else await assert.rejects(run())
  assert.equal(writes, 1, 'persistence verification must not repeat writes or create a new submission')
  assert.ok(documents >= 2)
})
