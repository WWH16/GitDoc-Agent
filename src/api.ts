// Browser side of doc_agent.py. Calls go through the Vite dev proxy, which adds the n8n credentials.

export const URL_PLACEHOLDER = 'https://github.com/<username>/<repo-name>'

/** No session yet, the anonymous account this browser got, or an account saved with an email (usable on any device). */
export const accountState = (user: { is_anonymous?: boolean; email?: string } | null): 'none' | 'anonymous' | 'saved' =>
  !user ? 'none' : user.is_anonymous ? 'anonymous' : 'saved'

/** The repo URL normalized like the n8n workflows do, so each repository has one key however it was typed. */
export const repoKey = (url: string) => url.trim().toLowerCase().replace(/\/+$/, '').replace(/\.git$/, '')

export type Result = { markdown: string; preview: string }

export type Answer = { answer: string; sources: string[] }

import type { Progress } from './progress.ts'

// (label, n8n node whose completion starts the step)
export const STEPS: [string, string | null][] = [
  ['Checking repository URL', null],
  ['Reading repository files', 'Valid GitHub URL?'],
  ['Writing documentation', 'Group Files'],
  ['Rendering diagrams', 'Repository Analysis Agent'],
  ['Finishing up', 'Combine Diagrams'],
]

// Step 0 always matches, so this never returns -1
export const currentStep = (doneNodes: Set<string>) =>
  STEPS.findLastIndex(([, start]) => start === null || doneNodes.has(start))

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

// The session token every /api call carries. main.tsx sets the anonymous Supabase session; tests set their own.
let tokenSource: () => Promise<string> = async () => ''
export const setTokenSource = (source: () => Promise<string>) => {
  tokenSource = source
}
const authHeader = async () => ({ Authorization: `Bearer ${await tokenSource()}` })

const SIGNED_OUT = 'Sign-in expired. Reload the page.'

/** POST JSON through the dev proxy. A non-2xx response throws body.error or body.message if present, otherwise "HTTP <status>". */
async function post(path: string, body: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const headers = { 'Content-Type': 'application/json', ...(await authHeader()) }
  let r: Response
  try {
    r = await fetch(path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    })
  } catch (e) {
    // A cancel by the caller stays an AbortError so it can be told apart from a failure
    if (signal?.aborted) throw e
    // Also hit when the dev proxy gives up on a slow run (vite.config.ts timeouts)
    throw new Error('No response from n8n. It may be stopped, or the run took too long.')
  }
  const data: unknown = await r.json().catch(() => null)
  const error = isObject(data) && typeof data.error === 'string' ? data.error : ''
  // n8n's own failures (e.g. unregistered webhook) send { message } instead of { error }
  const message = isObject(data) && typeof data.message === 'string' ? data.message : ''
  if (r.status === 401) throw new Error(SIGNED_OUT)
  if (!r.ok) throw new Error(error || message || `HTTP ${r.status}`)
  // n8n "Respond to Webhook" nodes answer 200 unless a response code is set, so an error body counts as an error too
  if (error) throw new Error(error)
  if (!isObject(data)) throw new Error('The workflow returned an invalid response.')
  return data
}

/** `runId` is a random id the browser makes; only it can later read this run's progress. `cached` docs come from an
 *  earlier run on the same repository files, so no run happened. `fresh` skips that cache. */
export async function callWorkflow(repo: string, runId: string, fresh = false): Promise<Result & { cached: boolean }> {
  const data = await post('/api/generate', { repo, runId, fresh })
  if (typeof data.markdown !== 'string') throw new Error('The workflow returned no documentation.')
  // Without a preview, fall back to the raw markdown (diagrams stay as code blocks)
  const preview = typeof data.preview === 'string' ? data.preview : data.markdown
  return { markdown: data.markdown, preview, cached: data.cached === true }
}

export const MAX_QUESTION = 1000

export type Turn = { role: 'user' | 'assistant'; text: string }

// 3 question/answer pairs, trimmed, so follow-ups keep context without blowing the model's token budget
export const MAX_TURNS = 6
export const MAX_TURN_CHARS = 600

/** The last few turns of the chat, trimmed, sent with each question so follow-ups like "where is that used?" work. */
export const recentTurns = (turns: Turn[]): Turn[] =>
  turns.slice(-MAX_TURNS).map((t) => ({ role: t.role, text: t.text.slice(0, MAX_TURN_CHARS) }))

/** `signal` cancels the wait in the browser; the n8n run itself keeps going. */
export async function askRepo(
  repo: string,
  question: string,
  sessionId: string,
  history: Turn[] = [],
  signal?: AbortSignal,
): Promise<Answer> {
  const data = await post('/api/ask', { repo, question, sessionId, history: recentTurns(history) }, signal)
  if (typeof data.answer !== 'string') throw new Error('The assistant returned no answer.')
  const sources = Array.isArray(data.sources) ? data.sources.filter((s): s is string => typeof s === 'string') : []
  return { answer: data.answer, sources }
}

/** The timeline of the run this browser started with `runId`, or null while the server cannot find it yet.
 *  The server builds it from n8n, so no execution data (repository files) reaches the browser. */
export async function getProgress(runId: string): Promise<Progress | null> {
  const r = await fetch(`/api/progress?runId=${encodeURIComponent(runId)}`, { headers: await authHeader() })
  if (r.status === 401) throw new Error(SIGNED_OUT)
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return (await r.json()) as Progress
}
