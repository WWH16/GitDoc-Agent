import assert from 'node:assert/strict'
import { test } from 'node:test'
import { askRepo, callWorkflow, currentStep, getHistory, getProgress, showProgressHint, timeline } from './api.ts'

const reply = (status: number, body: unknown) => {
  globalThis.fetch = async () => new Response(JSON.stringify(body), { status })
}

test('orders nodes by first start time', () => {
  const t = timeline({ B: [{ startTime: 20, executionTime: 5 }], A: [{ startTime: 10, executionTime: 3 }] }, null)
  assert.deepEqual(t.map((n) => n.name), ['A', 'B'])
  assert.deepEqual(t.map((n) => n.status), ['done', 'done'])
})

test('loop node becomes one row with run count and summed time', () => {
  const t = timeline({ Loop: [{ startTime: 1, executionTime: 4 }, { startTime: 9, executionTime: 3 }] }, null)
  assert.deepEqual(t, [{ name: 'Loop', status: 'done', runs: 2, ms: 7 }])
})

test('running node not yet in runData is appended as running', () => {
  const t = timeline({ A: [{ startTime: 1, executionTime: 2 }] }, 'Get File Contents')
  assert.deepEqual(t.at(-1), { name: 'Get File Contents', status: 'running', runs: 0, ms: 0 })
})

test('running node already in runData (next loop pass) is marked running, not duplicated', () => {
  const t = timeline({ Loop: [{ startTime: 1, executionTime: 4 }] }, 'Loop')
  assert.equal(t.length, 1)
  assert.equal(t[0].status, 'running')
})

test('node with an error is marked error', () => {
  const t = timeline({ Agent: [{ startTime: 1, executionTime: 2, error: { message: 'quota' } }] }, null)
  assert.equal(t[0].status, 'error')
})

test('empty runData and no running node gives an empty list', () => {
  assert.deepEqual(timeline({}, null), [])
})

test('progress hint shows only after 10 s with no finished nodes', () => {
  const running = [{ name: 'Webhook', status: 'running' as const, runs: 0, ms: 0 }]
  assert.equal(showProgressHint(5, []), false)
  assert.equal(showProgressHint(12, []), true)
  assert.equal(showProgressHint(12, running), true)
  assert.equal(showProgressHint(12, [{ name: 'Webhook', status: 'done', runs: 1, ms: 1 }]), false)
})

test('currentStep still maps finished nodes to coarse steps', () => {
  assert.equal(currentStep(new Set()), 0)
  assert.equal(currentStep(new Set(['Valid GitHub URL?', 'Group Files'])), 2)
})

test('non-2xx shows body.error, else HTTP <status>', async () => {
  reply(503, { error: 'AI busy' })
  await assert.rejects(askRepo('r', 'q', 's'), /^Error: AI busy$/)
  reply(404, { code: 404, message: 'webhook not registered' })
  await assert.rejects(askRepo('r', 'q', 's'), /^Error: webhook not registered$/)
  reply(500, 'oops')
  await assert.rejects(callWorkflow('r'), /^Error: HTTP 500$/)
})

test('askRepo keeps only string sources', async () => {
  reply(200, { answer: 'A', sources: ['a.ts', 3, null, 'b.ts'] })
  assert.deepEqual(await askRepo('r', 'q', 's'), { answer: 'A', sources: ['a.ts', 'b.ts'] })
  reply(200, { answer: 'A', sources: 'a.ts' })
  assert.deepEqual((await askRepo('r', 'q', 's')).sources, [])
})

test('callWorkflow requires markdown and falls back to it for preview', async () => {
  reply(200, { markdown: '# Doc' })
  assert.deepEqual(await callWorkflow('r'), { markdown: '# Doc', preview: '# Doc' })
  reply(200, { preview: 'x' })
  await assert.rejects(callWorkflow('r'))
})

test('getHistory drops entries without an id and blanks bad dates', async () => {
  reply(200, { data: [{ id: 7, status: 'success', startedAt: 'nope' }, { status: 'error' }] })
  assert.deepEqual(await getHistory(), [{ id: '7', status: 'success', started: '', finished: '' }])
})

test('network failure on ask gives a fixed message', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch')
  }
  await assert.rejects(askRepo('r', 'q', 's'), /^Error: No response from n8n/)
})

test('200 with an error body is treated as an error', async () => {
  reply(200, { error: 'blocked' })
  await assert.rejects(askRepo('r', 'q', 's'), /^Error: blocked$/)
})

test('getProgress reports final status and the first failed node', async () => {
  reply(200, {
    data: [{
      id: 448,
      status: 'error',
      data: { resultData: { runData: {
        'Return Documentation': [{ startTime: 1, executionTime: 1 }],
        'Supabase Vector Store': [{ startTime: 2, executionTime: 1, error: { message: 'fetch failed' } }],
      } } },
    }],
  })
  const p = await getProgress('')
  assert.equal(p?.status, 'error')
  assert.equal(p?.error, 'Supabase Vector Store: fetch failed')
})
