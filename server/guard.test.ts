import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Execution } from '../src/progress.ts'
import { Readable } from 'node:stream'
import { clientIp, generate, guard, progressFor, readJson, userFrom, type Deps, type GenerateDeps, type GuardError, type Rule } from './guard.ts'

const req = (path: string) => ({ path, ip: '1.2.3.4', authorization: 'Bearer t' })
const deps = (over: Partial<Deps> = {}): Deps => ({ verify: async () => 'u1', hit: async () => null, ...over })
const status = async (p: Promise<GuardError | { user: string }>) => ((await p) as GuardError).status

test('no token is 401', async () => assert.equal(await status(guard({ path: '/api/ask', ip: 'i', authorization: null }, deps())), 401))

test('invalid token is 401', async () => assert.equal(await status(guard(req('/api/ask'), deps({ verify: async () => null }))), 401))

test('allowed call passes with the user id', async () => assert.deepEqual(await guard(req('/api/ask'), deps()), { user: 'u1' }))

test('over the user limit is 429 with Retry-After', async () => {
  const r = (await guard(req('/api/generate'), deps({ hit: async () => '1 hour' }))) as GuardError
  assert.equal(r.status, 429)
  assert.equal(r.retryAfter, 3600)
})

test('denies by ip across users', async () => {
  let rules: Rule[] = []
  await guard(req('/api/generate'), deps({ hit: async (_u, _i, _k, r) => ((rules = r), null) }))
  assert.ok(rules.some((x) => x.scope === 'ip' && x.limit === 10))
})

test('limiter error is 503', async () => {
  const fail = async () => {
    throw new Error('down')
  }
  assert.equal(await status(guard(req('/api/ask'), deps({ hit: fail }))), 503)
})

test('unknown api path is 404', async () => assert.equal(await status(guard(req('/api/other'), deps())), 404))

// The old passthrough returned every user's n8n executions
test('/api/executions is gone', async () => assert.equal(await status(guard(req('/api/executions'), deps())), 404))

// An execution started by run `runId`, with a node that carries file contents (which must never reach the browser)
const exec = (id: string, runId: string): Execution => ({
  id,
  status: 'success',
  data: { resultData: { runData: {
    Webhook: [{ startTime: 1, executionTime: 1, data: { main: [[{ json: { body: { repo: 'r', runId } } }]] } }],
    'Get File Contents': [{ startTime: 2, executionTime: 5, data: { main: [[{ json: { content: 'secret file' } }]] } }],
  } } },
})

test('progress returns only the matching run timeline', async () => {
  const p = await progressFor('r1', async () => [exec('7', 'r2'), exec('8', 'r1')])
  assert.equal(p?.id, '8')
  assert.ok(!JSON.stringify(p).includes('content'))
})

test('unknown runId is 404', async () => assert.equal(await progressFor('nope', async () => [exec('7', 'r2')]), null))

const gdeps = (over: Partial<GenerateDeps> = {}): GenerateDeps => ({
  tree: async () => 'sha1',
  cacheGet: async () => null,
  cachePut: async () => {},
  limit: async () => null,
  n8n: async () => new Response('{"markdown":"m","preview":"p"}'),
  indexed: async () => true,
  lookup: async () => null,
  ...over,
})

test('cache hit skips the limit and n8n', async () => {
  let called = 0
  const r = await generate(
    { repo: 'https://github.com/a/b', runId: 'r' },
    gdeps({
      cacheGet: async () => ({ markdown: 'm', preview: 'p' }),
      limit: async () => {
        called++
        return null
      },
      n8n: async () => {
        called++
        return new Response('{}')
      },
    }),
  )
  assert.deepEqual(r.body, { markdown: 'm', preview: 'p', cached: true })
  assert.equal(called, 0)
})

test('fresh bypasses the cache and stores the new docs', async () => {
  let stored = ''
  await generate(
    { repo: 'https://github.com/a/b', runId: 'r', fresh: true },
    gdeps({
      cacheGet: async () => ({ markdown: 'old', preview: '' }),
      cachePut: async (_r, _s, d) => {
        stored = d.markdown
      },
      n8n: async () => new Response('{"markdown":"new","preview":"p"}'),
    }),
  )
  assert.equal(stored, 'new')
})

test('no tree sha means no cache, normal run', async () => {
  const r = await generate(
    { repo: 'https://github.com/a/b', runId: 'r' },
    gdeps({ tree: async () => null, n8n: async () => new Response('{"markdown":"m"}') }),
  )
  assert.equal((r.body as { markdown: string }).markdown, 'm')
})

test('cache miss over the limit is 429 and never reaches n8n', async () => {
  let ran = false
  const r = await generate(
    { repo: 'https://github.com/a/b', runId: 'r' },
    gdeps({
      limit: async () => ({ status: 429, body: { error: 'Too many requests. Try again in an hour.' }, retryAfter: 3600 }),
      n8n: async () => {
        ran = true
        return new Response('{}')
      },
    }),
  )
  assert.equal(r.status, 429)
  assert.equal(ran, false)
})

test('cache hit for a repo Ask has not indexed runs the workflow', async () => {
  let ran = false
  const r = await generate(
    { repo: 'https://github.com/a/b', runId: 'r' },
    gdeps({
      cacheGet: async () => ({ markdown: 'old', preview: '' }),
      indexed: async () => false,
      n8n: async () => {
        ran = true
        return new Response('{"markdown":"new"}')
      },
    }),
  )
  assert.equal(ran, true)
  assert.equal((r.body as { markdown: string }).markdown, 'new')
})

test('lookup limit denies before GitHub is called', async () => {
  let looked = false
  const r = await generate(
    { repo: 'https://github.com/a/b', runId: 'r' },
    gdeps({
      lookup: async () => ({ status: 429, body: { error: 'Too many requests. Try again in an hour.' }, retryAfter: 3600 }),
      tree: async () => {
        looked = true
        return 'sha1'
      },
    }),
  )
  assert.equal(r.status, 429)
  assert.equal(looked, false)
})

test('the IP limit ignores a client-set X-Forwarded-For', () => {
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '9.9.9.9' }, socket: { remoteAddress: '1.2.3.4' } }), '1.2.3.4')
})

test('Supabase unreachable is not an expired session', () => {
  const failed = (status?: number) => ({ data: { user: null }, error: { message: 'x', status } })
  assert.throws(() => userFrom(failed(0)))
  assert.throws(() => userFrom(failed(undefined)))
  assert.throws(() => userFrom(failed(503)))
  assert.equal(userFrom(failed(401)), null)
  assert.equal(userFrom({ data: { user: { id: 'u1' } }, error: null }), 'u1')
})

test('a request body that fails mid-upload reads as empty instead of throwing', async () => {
  const broken = new Readable({
    read() {
      this.destroy(new Error('aborted'))
    },
  })
  assert.deepEqual(await readJson(broken as never), {})
})
