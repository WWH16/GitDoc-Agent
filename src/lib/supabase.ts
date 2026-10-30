import { createClient } from '@supabase/supabase-js'
import { sessionToken } from './session'

// Publishable key only: the browser's rows are limited by row-level security (docs/supabase-app.sql)
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)

/** The current session's access token. The first visit signs in anonymously: no form, the account is this browser. */
export const accessToken = () => sessionToken(supabase.auth)

// Email links open the app again (the URL must be listed in Supabase → Authentication → URL Configuration)
const redirect = () => `${location.origin}/app/`

// Supabase's auth errors in plain words
function plain(error: { message: string; status?: number }) {
  const m = error.message
  if (error.status === 429 || /rate limit/i.test(m)) return 'Too many emails were sent. Wait a few minutes and try again.'
  if (/signups not allowed|user not found/i.test(m)) return 'No saved history uses this email. Save your history first.'
  if (/already (been )?registered|already exists/i.test(m)) return 'This email already has saved history. Choose "Already saved? Sign in".'
  if (/invalid/i.test(m) && /email/i.test(m)) return 'Enter a valid email address.'
  return `Could not send the link: ${m}`
}

/** Adds an email to this browser's anonymous account. The user id stays the same, so every doc and chat is kept. */
export async function saveHistory(email: string): Promise<void> {
  await accessToken()
  const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: redirect() })
  if (error) throw new Error(plain(error))
}

/** Emails a sign-in link for history saved earlier, for example on another device. Never creates an account. */
export async function signInWithEmail(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: redirect() } })
  if (error) throw new Error(plain(error))
}

/** Signs out this browser only; other devices stay signed in. The next call starts a new anonymous account. */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut({ scope: 'local' })
}
