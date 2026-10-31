import assert from 'node:assert/strict'
import { test } from 'node:test'
import { askRepo, recentTurns, callWorkflow, currentStep, historySummary, needsPassword, repoKey, setTokenSource } from './api.ts'
import { showProgressHint, timeline, toProgress } from './progress.ts'

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
  // The agent node also finishes when both models fail (error output), so it must not start "Rendering diagrams"
  assert.equal(currentStep(new Set(['Valid GitHub URL?', 'Group Files', 'Repository Analysis Agent', 'Docs Failed'])), 2)
  assert.equal(currentStep(new Set(['Valid GitHub URL?', 'Group Files', 'Repository Analysis Agent', 'Prepare Markdown'])), 3)
})

test('non-2xx shows body.error, else HTTP <status>', async () => {
  reply(503, { error: 'AI busy' })
  await assert.rejects(askRepo('r', 'q', 's'), /^Error: AI busy$/)
  reply(404, { code: 404, message: 'webhook not registered' })
  await assert.rejects(askRepo('r', 'q', 's'), /^Error: webhook not registered$/)
  reply(500, 'oops')
  await assert.rejects(callWorkflow('r', 'run1'), /^Error: HTTP 500$/)
})

test('askRepo keeps only string sources', async () => {
  reply(200, { answer: 'A', sources: ['a.ts', 3, null, 'b.ts'] })
  assert.deepEqual(await askRepo('r', 'q', 's'), { answer: 'A', sources: ['a.ts', 'b.ts'] })
  reply(200, { answer: 'A', sources: 'a.ts' })
  assert.deepEqual((await askRepo('r', 'q', 's')).sources, [])
})

test('callWorkflow requires markdown and falls back to it for preview', async () => {
  reply(200, { markdown: '# Doc' })
  assert.deepEqual(await callWorkflow('r', 'run1'), { markdown: '# Doc', preview: '# Doc', cached: false })
  reply(200, { markdown: '# Doc', preview: 'p', cached: true })
  assert.equal((await callWorkflow('r', 'run1')).cached, true)
  reply(200, { preview: 'x' })
  await assert.rejects(callWorkflow('r', 'run1'))
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

test('toProgress reports final status and the first failed node', () => {
  const p = toProgress({
    id: '448',
    status: 'error',
    data: { resultData: { runData: {
      'Return Documentation': [{ startTime: 1, executionTime: 1 }],
      'Supabase Vector Store': [{ startTime: 2, executionTime: 1, error: { message: 'fetch failed' } }],
    } } },
  })
  assert.equal(p?.status, 'error')
  assert.equal(p?.error, 'Supabase Vector Store: fetch failed')
})

test('recentTurns keeps the last 6 turns and trims each to 600 chars', () => {
  const turns = Array.from({ length: 9 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `${i}`.repeat(700) }) as const)
  const out = recentTurns([...turns])
  assert.equal(out.length, 6)
  assert.equal(out[0].text[0], '3')
  assert.ok(out.every((t) => t.text.length === 600))
})

test('a cancelled ask rejects with AbortError, not the "No response" message', async () => {
  globalThis.fetch = async (_url, init) => {
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    return new Response('{}')
  }
  const c = new AbortController()
  c.abort()
  await assert.rejects(askRepo('r', 'q', 's', [], c.signal), { name: 'AbortError' })
})

test('api calls carry the bearer token', async () => {
  setTokenSource(async () => 'tok')
  let auth = ''
  globalThis.fetch = async (_u, init) => {
    auth = new Headers(init?.headers).get('Authorization') ?? ''
    return new Response('{"answer":"a","sources":[]}')
  }
  await askRepo('r', 'q', 's')
  assert.equal(auth, 'Bearer tok')
})

test('401 maps to sign-in message', async () => {
  reply(401, { error: 'whatever' })
  await assert.rejects(askRepo('r', 'q', 's'), /^Error: Sign-in expired\. Reload the page\.$/)
})

test('repoKey normalizes like the workflows', () => {
  assert.equal(repoKey(' https://github.com/WWH16/DSS.git/ '), 'https://github.com/wwh16/dss')
})

test('historySummary counts what this browser keeps or loses', () => {
  assert.equal(historySummary({ docs: 3, chats: 1 }), '3 docs and 1 chat')
  assert.equal(historySummary({ docs: 1, chats: 0 }), '1 doc')
  assert.equal(historySummary({ docs: 0, chats: 2 }), '2 chats')
  assert.equal(historySummary({ docs: 0, chats: 0 }), '')
})

test('needsPassword only after the email is confirmed and before a password is chosen', () => {
  assert.equal(needsPassword(null), false)
  assert.equal(needsPassword({ is_anonymous: true }), false)
  assert.equal(needsPassword({ is_anonymous: false, email: 'a@b.c' }), true)
  assert.equal(needsPassword({ is_anonymous: false, email: 'a@b.c', user_metadata: { password_set: true } }), false)
})
