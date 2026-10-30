// Server-side gate in front of the /api proxy: every call needs a valid Supabase session and stays within the
// rate limits below. Written as plain functions so the same checks can move to Vercel Functions at deployment.
import { createClient } from '@supabase/supabase-js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { repoKey } from '../src/api.ts'
import { runIdOf, toProgress, type Execution, type Progress } from '../src/progress.ts'

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

const KINDS: Record<string, Kind> = {
  '/api/generate': 'generate',
  '/api/ask': 'ask',
  '/api/progress': 'progress',
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

/** `limit: false` only checks the session; /api/generate applies its limit later, on a cache miss. */
export async function guard(
  req: { path: string; ip: string; authorization: string | null },
  deps: Deps,
  limit = true,
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

  const denied = limit ? await limitFor(user, req.ip, kind, deps) : null
  return denied ?? { user }
}

/** Records one call of `kind`; returns the 429 (or 503) to send when a limit is reached. */
async function limitFor(user: string, ip: string, kind: Kind, deps: Deps): Promise<GuardError | null> {
  // Fail closed: if the limiter cannot be reached, nothing that costs money goes through unchecked
  let reached: string | null
  try {
    reached = await deps.hit(user, ip, kind, RULES[kind])
  } catch {
    return UNAVAILABLE
  }
  if (!reached) return null
  const [seconds, phrase] = RETRY_AFTER[reached] ?? [60, 'a minute']
  return { status: 429, body: { error: `Too many requests. Try again in ${phrase}.` }, retryAfter: seconds }
}

type Doc = { markdown: string; preview: string }
export type GenerateDeps = {
  /** The repository's root tree sha (same files, same sha), null when it cannot be read. */
  tree(repo: string): Promise<string | null>
  cacheGet(repo: string, sha: string): Promise<Doc | null>
  cachePut(repo: string, sha: string, doc: Doc): Promise<void>
  /** The generate limit, checked only when n8n has to run. */
  limit(): Promise<GuardError | null>
  n8n(body: object): Promise<Response>
}

/** /api/generate: docs for a repository whose files did not change since anyone generated them come from the shared
 *  cache, free and without using the limit. `fresh` always runs the workflow and replaces the cached docs. */
export async function generate(
  body: { repo: string; runId: string; fresh?: boolean },
  deps: GenerateDeps,
): Promise<{ status: number; body: object; retryAfter?: number }> {
  const repo = repoKey(body.repo)
  const sha = await deps.tree(body.repo)
  if (sha && !body.fresh) {
    const doc = await deps.cacheGet(repo, sha).catch(() => null)
    if (doc) return { status: 200, body: { ...doc, cached: true } }
  }
  const denied = await deps.limit()
  if (denied) return denied

  const r = await deps.n8n({ repo: body.repo, runId: body.runId })
  const out: unknown = await r.json().catch(() => null)
  if (!out || typeof out !== 'object') return { status: r.ok ? 502 : r.status, body: { error: `HTTP ${r.status}` } }
  const { markdown, preview, error } = out as Record<string, unknown>
  if (r.ok && sha && typeof markdown === 'string' && !error) {
    await deps.cachePut(repo, sha, { markdown, preview: typeof preview === 'string' ? preview : markdown }).catch(() => {})
  }
  return { status: r.status, body: out }
}

/** The root tree sha of a GitHub repository's default branch, or null on any error. */
export async function treeSha(owner: string, repo: string, token = ''): Promise<string | null> {
  try {
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD`, {
      // A token raises GitHub's limit of 60 calls an hour per IP
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'gitdoc-agent', ...(token && { Authorization: `Bearer ${token}` }) },
    })
    if (!r.ok) return null
    const { sha } = (await r.json()) as { sha?: unknown }
    return typeof sha === 'string' ? sha : null
  } catch {
    return null
  }
}

/** Timeline of the run started with `runId`: running executions first, then the 5 newest finished ones.
 *  Only the timeline leaves the server, never the execution data (it holds repository files). The runId is a random
 *  id only its browser knows, so nobody else can ask for that run. */
export async function progressFor(runId: string, list: (query: string) => Promise<Execution[]>): Promise<Progress | null> {
  for (const query of ['status=running&limit=5&includeData=true', 'limit=5&includeData=true']) {
    const run = (await list(query)).find((e) => runIdOf(e) === runId)
    if (run) return toProgress(run)
  }
  return null
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

  // Service role only: browsers have no access to docs_cache (docs/supabase-app.sql)
  const cache: Pick<GenerateDeps, 'cacheGet' | 'cachePut'> = {
    async cacheGet(repo, sha) {
      const { data, error } = await admin.from('docs_cache').select('markdown, preview').eq('repo', repo).eq('tree_sha', sha).maybeSingle()
      if (error) throw error
      return data && { markdown: data.markdown, preview: data.preview ?? data.markdown }
    },
    async cachePut(repo, sha, doc) {
      // Same limit as the check on docs_cache.preview; a bigger preview is not kept
      const preview = doc.preview.length <= 3_000_000 ? doc.preview : null
      const { error } = await admin.from('docs_cache').upsert({ repo, tree_sha: sha, markdown: doc.markdown, preview })
      if (error) throw error
    },
  }

  return async (req: IncomingMessage & { originalUrl?: string }, res: ServerResponse, next: () => void) => {
    const path = new URL(req.originalUrl ?? req.url ?? '', 'http://localhost').pathname
    const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || ''
    const isGenerate = path === '/api/generate'
    const result = await guard({ path, ip, authorization: req.headers.authorization ?? null }, deps, !isGenerate)
    if (!('user' in result)) {
      if (result.retryAfter) res.setHeader('Retry-After', String(result.retryAfter))
      return send(res, result.status, result.body)
    }
    if (isGenerate) {
      const body = await readJson(req)
      if (typeof body.repo !== 'string' || typeof body.runId !== 'string') return send(res, 400, { error: 'Invalid request.' })
      const out = await generate(
        { repo: body.repo, runId: body.runId, fresh: body.fresh === true },
        {
          ...cache,
          tree(url) {
            const m = repoKey(url).match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)$/)
            return m ? treeSha(m[1], m[2], env.GITHUB_TOKEN) : Promise.resolve(null)
          },
          limit: () => limitFor(result.user, ip, 'generate', deps),
          // Node's fetch waits up to 300 s for the response, like the old proxy
          n8n: (b) =>
            fetch(`${env.N8N_URL}${env.N8N_WEBHOOK_PATH}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Webhook-Token': env.N8N_WEBHOOK_TOKEN ?? '' },
              body: JSON.stringify(b),
            }),
        },
      ).catch(() => ({ status: 502, body: { error: 'No response from n8n. It may be stopped, or the run took too long.' }, retryAfter: 0 }))
      if (out.retryAfter) res.setHeader('Retry-After', String(out.retryAfter))
      return send(res, out.status, out.body)
    }
    if (path === '/api/progress') {
      const runId = new URL(req.originalUrl ?? req.url ?? '', 'http://localhost').searchParams.get('runId') ?? ''
      const progress = await progressFor(runId, listExecutions).catch(() => null)
      return progress ? send(res, 200, progress) : send(res, 404, { error: 'Run not found.' })
    }
    // n8n has its own token; the user's session stays here
    delete req.headers.authorization
    next()
  }

  async function listExecutions(query: string): Promise<Execution[]> {
    const r = await fetch(`${env.N8N_URL}/api/v1/executions?workflowId=${env.N8N_WORKFLOW_ID}&${query}`, {
      headers: { 'X-N8N-API-KEY': env.N8N_API_KEY ?? '' },
    })
    if (!r.ok) throw new Error(`n8n executions: HTTP ${r.status}`)
    const body = (await r.json()) as { data?: Execution[] }
    return body.data ?? []
  }
}

// The request body as an object; anything over 10 KB or not JSON counts as empty
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 10_000) return {}
  }
  try {
    const v: unknown = JSON.parse(raw)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}
