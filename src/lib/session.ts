// The session logic behind accessToken (src/lib/supabase.ts), apart from the client so tests can run it.

type Result = { data: { session: { access_token: string } | null }; error: unknown }
export type Auth = { getSession(): Promise<Result>; signInAnonymously(): Promise<Result> }

// Several calls can need a token at once (StrictMode mounts twice): share one sign-in so a browser gets one user
let signingIn: Promise<string> | null = null

/** The current session's access token. The first visit signs in anonymously: no form, the account is this browser. */
export async function sessionToken(auth: Auth): Promise<string> {
  const { data, error } = await auth.getSession()
  if (data.session) return data.session.access_token
  // A refresh that failed (offline, Supabase down) still has an account behind it: a new anonymous one would
  // orphan its history, or quietly sign a saved user out
  if (error) throw new Error('Sign-in expired. Reload the page.')
  signingIn ??= auth
    .signInAnonymously()
    .then(({ data, error }) => {
      if (error || !data.session) throw new Error('Could not start your session. Reload the page.')
      return data.session.access_token
    })
    .finally(() => (signingIn = null))
  return signingIn
}

/** Supabase's sign-in errors in plain words; anything else keeps Supabase's own message. */
export function authMessage(error: { code?: string; status?: number; message: string }): string {
  const { code, message: m } = error
  if (error.status === 429 || /rate limit/i.test(m)) return 'Too many tries. Wait a few minutes and try again.'
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(m)) return 'Wrong email or password.'
  if (code === 'email_exists' || /already (been )?registered/i.test(m)) return 'This email already has saved history. Choose "Already saved? Sign in".'
  if (code === 'weak_password' || /password should be/i.test(m)) return 'Use a password of at least 6 characters.'
  return m
}
