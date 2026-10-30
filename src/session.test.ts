import assert from 'node:assert/strict'
import { test } from 'node:test'
import { authMessage, sessionToken, type Auth } from './lib/session.ts'

const USER_GONE = { code: 'user_not_found', status: 403, message: 'User from sub claim in JWT does not exist' }

const auth = (getSession: Auth['getSession'], signIns: string[], over: Partial<Auth> = {}): Auth => ({
  getSession,
  signInAnonymously: async () => {
    signIns.push('new')
    return { data: { session: { access_token: 'anon' } }, error: null }
  },
  getUser: async () => ({ error: null }),
  signOut: async () => ({ error: null }),
  ...over,
})

test('a failed session refresh never swaps in a new anonymous account', async () => {
  const signIns: string[] = []
  const refreshFailed = async () => ({ data: { session: null }, error: new Error('network') })
  await assert.rejects(sessionToken(auth(refreshFailed, signIns)), /^Error: Sign-in expired\. Reload the page\.$/)
  assert.deepEqual(signIns, [])
})

test('no session at all signs in anonymously once', async () => {
  const signIns: string[] = []
  const none = async () => ({ data: { session: null }, error: null })
  assert.equal(await sessionToken(auth(none, signIns)), 'anon')
  assert.deepEqual(signIns, ['new'])
})

test('a stored session whose user was deleted in Supabase is replaced by a new anonymous one', async () => {
  const signIns: string[] = []
  let stored: string | null = 'old'
  const a = auth(async () => ({ data: { session: stored ? { access_token: stored } : null }, error: null }), signIns, {
    getUser: async () => ({ error: USER_GONE }),
    signOut: async () => {
      stored = null
      return { error: null }
    },
  })
  assert.equal(await sessionToken(a), 'anon')
  assert.deepEqual(signIns, ['new'])
})

test('a user that still exists keeps its session', async () => {
  const signIns: string[] = []
  assert.equal(await sessionToken(auth(async () => ({ data: { session: { access_token: 'mine' } }, error: null }), signIns)), 'mine')
  assert.deepEqual(signIns, [])
})

test('authMessage puts Supabase sign-in errors in plain words', () => {
  assert.equal(authMessage({ code: 'invalid_credentials', message: 'Invalid login credentials' }), 'Wrong email or password.')
  assert.equal(
    authMessage({ code: 'email_exists', message: 'A user with this email address has already been registered' }),
    'This email already has saved history. Choose "Already saved? Sign in".',
  )
  assert.equal(authMessage({ code: 'weak_password', message: 'Password should be at least 6 characters.' }), 'Use a password of at least 6 characters.')
  assert.equal(authMessage({ status: 429, message: 'Request rate limit reached' }), 'Too many tries. Wait a few minutes and try again.')
  assert.equal(authMessage(USER_GONE), 'Your session ended. Reload the page.')
  assert.equal(authMessage({ message: 'Something odd' }), 'Something odd')
})
