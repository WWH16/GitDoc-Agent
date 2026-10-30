import { createClient } from '@supabase/supabase-js'
import { authMessage, sessionToken } from './session'

// Publishable key only: the browser's rows are limited by row-level security (docs/supabase-app.sql)
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)

/** The current session's access token. The first visit signs in anonymously: no form, the account is this browser. */
export const accessToken = () => sessionToken(supabase.auth)

// Email links open the app again (the URL must be listed in Supabase → Authentication → URL Configuration)
const redirect = () => `${location.origin}/app/`

/** Step 1 of saving the history: adds an email to this browser's anonymous account (same user id, so every doc and
 *  chat stays). Supabase emails a confirmation link; 'confirmed' when the project skips that ("Confirm email" off). */
export async function sendConfirmation(email: string): Promise<'sent' | 'confirmed'> {
  await accessToken()
  const { data, error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: redirect() })
  if (error) throw new Error(authMessage(error))
  return data.user?.email?.toLowerCase() === email.toLowerCase() ? 'confirmed' : 'sent'
}

export async function resendConfirmation(email: string): Promise<void> {
  const { error } = await supabase.auth.resend({ type: 'email_change', email, options: { emailRedirectTo: redirect() } })
  if (error) throw new Error(authMessage(error))
}

/** Step 2, once the email is confirmed (Supabase allows a password only then). Also the end of a password reset. */
export async function setPassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password, data: { password_set: true } })
  if (error) throw new Error(authMessage(error))
}

export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirect() })
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
