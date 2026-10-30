import { createClient } from '@supabase/supabase-js'
import { sessionToken } from './session'

// Publishable key only: the browser's rows are limited by row-level security (docs/supabase-app.sql)
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)

/** The current session's access token. The first visit signs in anonymously: no form, the account is this browser. */
export const accessToken = () => sessionToken(supabase.auth)

// Google sends the browser back here (the URL must be listed in Supabase → Authentication → URL Configuration)
const redirect = () => `${location.origin}/app/`

/** Links a Google account to this browser's anonymous account and leaves for Google. The user id stays the same,
 *  so every doc and chat is kept. A Google account already used elsewhere comes back as identity_already_exists. */
export async function saveWithGoogle(): Promise<void> {
  await accessToken()
  const { error } = await supabase.auth.linkIdentity({ provider: 'google', options: { redirectTo: redirect() } })
  if (error) throw new Error(`Could not open Google sign-in: ${error.message}`)
}

/** Signs in to the account a Google login saved earlier (e.g. on another device); this browser's history stays behind. */
export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirect() } })
  if (error) throw new Error(`Could not open Google sign-in: ${error.message}`)
}

/** Signs out this browser only; other devices stay signed in. The next call starts a new anonymous account. */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut({ scope: 'local' })
}
