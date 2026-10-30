import assert from 'node:assert/strict'
import { test } from 'node:test'
import { authMessage, sessionToken, type Auth } from './lib/session.ts'

const auth = (getSession: Auth['getSession'], signIns: string[]): Auth => ({
  getSession,
  signInAnonymously: async () => {
    signIns.push('new')
    return { data: { session: { access_token: 'anon' } }, error: null }
  },
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

test('authMessage puts Supabase sign-in errors in plain words', () => {
  assert.equal(authMessage({ code: 'invalid_credentials', message: 'Invalid login credentials' }), 'Wrong email or password.')
  assert.equal(
    authMessage({ code: 'email_exists', message: 'A user with this email address has already been registered' }),
    'This email already has saved history. Choose "Already saved? Sign in".',
  )
  assert.equal(authMessage({ code: 'weak_password', message: 'Password should be at least 6 characters.' }), 'Use a password of at least 6 characters.')
  assert.equal(authMessage({ status: 429, message: 'Request rate limit reached' }), 'Too many tries. Wait a few minutes and try again.')
  assert.equal(authMessage({ message: 'Something odd' }), 'Something odd')
})
