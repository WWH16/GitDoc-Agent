// Browser side of doc_agent.py. Calls go through the Vite dev proxy, which adds the n8n credentials.

export const URL_PLACEHOLDER = 'https://github.com/<username>/<repo-name>'

export type Result = { markdown: string; preview: string }

export type Answer = { answer: string; sources: string[] }

export type Run = { id: string; status: string; started: string; finished: string }

type TaskData = { startTime: number; executionTime?: number; error?: { message?: string } }

type Execution = {
  id: string
  status?: string
  startedAt?: string
  stoppedAt?: string
  data?: {
    resultData?: { runData?: Record<string, TaskData[]> }
    executionData?: { nodeExecutionStack?: { node?: { name?: string } }[] }
  }
}

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

/** POST JSON through the dev proxy. A non-2xx response throws body.error or body.message if present, otherwise "HTTP <status>". */
async function post(path: string, body: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
  let r: Response
  try {
    r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  if (!r.ok) throw new Error(error || message || `HTTP ${r.status}`)
  // n8n "Respond to Webhook" nodes answer 200 unless a response code is set, so an error body counts as an error too
  if (error) throw new Error(error)
  if (!isObject(data)) throw new Error('The workflow returned an invalid response.')
  return data
}

export async function callWorkflow(repo: string): Promise<Result> {
  const data = await post('/api/generate', { repo })
  if (typeof data.markdown !== 'string') throw new Error('The workflow returned no documentation.')
  // Without a preview, fall back to the raw markdown (diagrams stay as code blocks)
  return { markdown: data.markdown, preview: typeof data.preview === 'string' ? data.preview : data.markdown }
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

/** n8n executions for this workflow; the proxy adds workflowId and the API key. Entries without an id are dropped. */
async function executions(query: string): Promise<Execution[]> {
  const r = await fetch(`/api/executions?${query}`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const body: unknown = await r.json().catch(() => null)
  if (!isObject(body) || !Array.isArray(body.data)) throw new Error('Invalid response from n8n.')
  return body.data
    .filter((e): e is Execution => isObject(e) && (typeof e.id === 'string' || typeof e.id === 'number'))
    .map((e) => ({ ...e, id: String(e.id) }))
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

// sv-SE formats as YYYY-MM-DD HH:MM:SS in local time
function localTime(stamp: unknown) {
  const s = str(stamp), d = new Date(s)
  return s && !isNaN(+d) ? d.toLocaleString('sv-SE') : ''
}

export async function getHistory(): Promise<Run[]> {
  return (await executions('limit=20')).map((e) => ({
    id: e.id,
    status: str(e.status),
    started: localTime(e.startedAt),
    finished: localTime(e.stoppedAt),
  }))
}

export type NodeRun = { name: string; status: 'done' | 'running' | 'error'; runs: number; ms: number }

/** n8n runData as one row per node in start order. A loop node has one row, with its runs counted and times summed.
 *  `running` is the node at the head of nodeExecutionStack. It is marked running even if it already ran (next loop pass). */
export function timeline(runData: Record<string, TaskData[]>, running: string | null): NodeRun[] {
  const rows = Object.entries(runData)
    .sort(([, a], [, b]) => a[0].startTime - b[0].startTime)
    .map(([name, tasks]): NodeRun => ({
      name,
      status: name === running ? 'running' : tasks.some((t) => t.error) ? 'error' : 'done',
      runs: tasks.length,
      ms: tasks.reduce((sum, t) => sum + (t.executionTime ?? 0), 0),
    }))
  if (running && !(running in runData)) rows.push({ name: running, status: 'running', runs: 0, ms: 0 })
  return rows
}

// No finished node after 10 s means n8n is not saving execution progress (workflow setting is off)
export const showProgressHint = (elapsed: number, nodes: NodeRun[]) =>
  elapsed >= 10 && !nodes.some((n) => n.status !== 'running')

/** `error` is the first failed node as "Node: message", empty when none failed. */
export type Progress = { id: string; status: string; error: string; nodes: NodeRun[] }

/** Latest execution that matches `query`, as a node timeline. Default: the running one.
 *  n8n only fills runData during a run when the workflow's "Save execution progress" setting is on. */
export async function getProgress(query = 'status=running'): Promise<Progress | null> {
  const run = (await executions(`${query}&limit=1&includeData=true`))[0]
  if (!run) return null
  const raw = run.data?.resultData?.runData
  // Keep only nodes with at least one task so timeline() can read tasks[0]
  const runData: Record<string, TaskData[]> = isObject(raw)
    ? Object.fromEntries(Object.entries(raw).filter(([, t]) => Array.isArray(t) && t.length > 0 && isObject(t[0])))
    : {}
  const head = run.status === 'running' ? run.data?.executionData?.nodeExecutionStack?.[0]?.node?.name : undefined
  const failed = Object.entries(runData).find(([, tasks]) => tasks.some((t) => t.error))
  const error = failed ? `${failed[0]}: ${failed[1].find((t) => t.error)?.error?.message ?? 'failed'}` : ''
  return { id: run.id, status: str(run.status), error, nodes: timeline(runData, typeof head === 'string' ? head : null) }
}
