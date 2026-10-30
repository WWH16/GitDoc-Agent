// Server-side gate in front of the /api proxy: every call needs a valid Supabase session and stays within the
// rate limits below. Written as plain functions so the same checks can move to Vercel Functions at deployment.
import { createClient } from '@supabase/supabase-js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

export type Rule = { scope: 'user' | 'ip'; limit: number; window: string }
type Kind = 'generate' | 'ask' | 'progress'

export const RULES: Record<Kind, Rule[]> = {
  generate: [
    { scope: 'user', limit: 5, window: '1 hour' },
    { scope: 'user', limit: 15, window: '1 day' },
    { scope: 'ip', limit: 10, window: '1 hour' },
  ],
  ask: [
    { scope: 'user', limit: 30, window: '1 hour' },
    { scope: 'ip', limit: 60, window: '1 hour' },
  ],
  progress: [{ scope: 'user', limit: 40, window: '1 minute' }],
}

// /api/executions is the old progress passthrough; it goes once Run history reads Supabase instead
const KINDS: Record<string, Kind> = {
  '/api/generate': 'generate',
  '/api/ask': 'ask',
  '/api/progress': 'progress',
  '/api/executions': 'progress',
}

const RETRY_AFTER: Record<string, [seconds: number, phrase: string]> = {
  '1 minute': [60, 'a minute'],
  '1 hour': [3600, 'an hour'],
  '1 day': [86400, 'a day'],
}

export type GuardError = { status: number; body: { error: string }; retryAfter?: number }
export type Deps = {
  /** The user id for a valid access token, null for an invalid one; throws when it cannot check. */
  verify(token: string): Promise<string | null>
  /** Records the call and returns null, or returns the window of a limit already reached (see rate_limit_hit). */
  hit(user: string, ip: string, kind: string, rules: Rule[]): Promise<string | null>
}

const UNAVAILABLE: GuardError = { status: 503, body: { error: 'Rate limiter unavailable. Try again shortly.' } }

export async function guard(
  req: { path: string; ip: string; authorization: string | null },
  deps: Deps,
): Promise<GuardError | { user: string }> {
  const kind = KINDS[req.path]
  if (!kind) return { status: 404, body: { error: 'Not found.' } }

  const token = req.authorization?.match(/^Bearer (.+)$/)?.[1]
  let user: string | null = null
  try {
    user = token ? await deps.verify(token) : null
  } catch {
    return UNAVAILABLE
  }
  if (!user) return { status: 401, body: { error: 'Sign-in expired. Reload the page.' } }

  // Fail closed: if the limiter cannot be reached, nothing that costs money goes through unchecked
  let reached: string | null
  try {
    reached = await deps.hit(user, req.ip, kind, RULES[kind])
  } catch {
    return UNAVAILABLE
  }
  if (reached) {
    const [seconds, phrase] = RETRY_AFTER[reached] ?? [60, 'a minute']
    return { status: 429, body: { error: `Too many requests. Try again in ${phrase}.` }, retryAfter: seconds }
  }
  return { user }
}

/** Vite dev-server middleware that runs `guard` before the /api proxy forwards anything to n8n. */
export function guardPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'gitdoc-api-guard',
    // Dev server only: a build has no proxy, and its environment may not hold the service key
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api', apiGuard(env))
    },
  }
}

function apiGuard(env: Record<string, string>) {
  const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const deps: Deps = {
    async verify(token) {
      const { data, error } = await admin.auth.getUser(token)
      if (error) {
        if ((error.status ?? 500) < 500) return null
        throw error
      }
      return data.user?.id ?? null
    },
    async hit(user, ip, kind, rules) {
      const { data, error } = await admin.rpc('rate_limit_hit', { p_user: user, p_ip: ip, p_kind: kind, p_rules: rules })
      if (error) throw error
      return (data as string | null) ?? null
    },
  }

  return async (req: IncomingMessage & { originalUrl?: string }, res: ServerResponse, next: () => void) => {
    const path = new URL(req.originalUrl ?? req.url ?? '', 'http://localhost').pathname
    const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || ''
    const result = await guard({ path, ip, authorization: req.headers.authorization ?? null }, deps)
    if ('user' in result) {
      // n8n has its own token; the user's session stays here
      delete req.headers.authorization
      return next()
    }
    res.statusCode = result.status
    res.setHeader('Content-Type', 'application/json')
    if (result.retryAfter) res.setHeader('Retry-After', String(result.retryAfter))
    res.end(JSON.stringify(result.body))
  }
}
