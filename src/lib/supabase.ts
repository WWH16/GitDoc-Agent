import { createClient } from '@supabase/supabase-js'
import { authMessage, sessionToken } from './session'

// Publishable key only: the browser's rows are limited by row-level security (docs/supabase-app.sql)
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)

/** The current session's access token. The first visit signs in anonymously: no form, the account is this browser. */
export const accessToken = () => sessionToken(supabase.auth)

/** Gives this browser's anonymous account an email and password. The user id stays the same, so every doc and chat
 *  is kept. Needs "Confirm email" off in Supabase; otherwise Supabase emails a confirmation link first. */
export async function saveHistory(email: string, password: string): Promise<void> {
  await accessToken()
  const added = await supabase.auth.updateUser({ email })
  if (added.error) throw new Error(authMessage(added.error))
  if (added.data.user?.email?.toLowerCase() !== email.toLowerCase()) {
    throw new Error('Confirm your email from the link Supabase sent, then sign in.')
  }
  // A second call: Supabase only sets a password once the account has an email. Retrying after a failure here is safe.
  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw new Error(authMessage(error))
}

/** Signs in to history saved earlier, e.g. on another device; this browser's anonymous history stays behind. */
export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(authMessage(error))
}

/** Signs out this browser only; other devices stay signed in. The next call starts a new anonymous account. */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut({ scope: 'local' })
}
