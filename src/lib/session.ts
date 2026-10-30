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
