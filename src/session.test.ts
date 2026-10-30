import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sessionToken, type Auth } from './lib/session.ts'

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
