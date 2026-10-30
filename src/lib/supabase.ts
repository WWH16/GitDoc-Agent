import { createClient } from '@supabase/supabase-js'

// Publishable key only: the browser's rows are limited by row-level security (docs/supabase-app.sql)
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)

// Several calls can need a token at once (StrictMode mounts twice): share one sign-in so a browser gets one user
let signingIn: Promise<string> | null = null

/** The current session's access token. The first visit signs in anonymously: no form, the account is this browser. */
export async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  if (data.session) return data.session.access_token
  signingIn ??= supabase.auth
    .signInAnonymously()
    .then(({ data, error }) => {
      if (error || !data.session) throw new Error('Could not start your session. Reload the page.')
      return data.session.access_token
    })
    .finally(() => (signingIn = null))
  return signingIn
}
