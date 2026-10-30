import assert from 'node:assert/strict'
import { test } from 'node:test'
import { guard, type Deps, type GuardError, type Rule } from './guard.ts'

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
