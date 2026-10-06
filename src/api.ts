// Browser side of doc_agent.py. Calls go through the Vite dev proxy, which adds the n8n credentials.

export const URL_PLACEHOLDER = 'https://github.com/<username>/<repo-name>'

export type Result = { markdown?: string; preview?: string }

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

export async function callWorkflow(repo: string): Promise<Result> {
  let r: Response
  try {
    r = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo }),
    })
  } catch (e) {
    throw new Error(`Could not reach the workflow: ${(e as Error).message}`)
  }
  if (r.status === 400) {
    const body = await r.json().catch(() => ({}))
    throw new Error(body.error || 'Invalid GitHub URL')
  }
  if (!r.ok) throw new Error(`Could not reach the workflow: HTTP ${r.status}`)
  return r.json()
}

// sv-SE formats as YYYY-MM-DD HH:MM:SS in local time
const localTime = (stamp?: string) => (stamp ? new Date(stamp).toLocaleString('sv-SE') : '')

export async function getHistory(): Promise<Run[]> {
  const r = await fetch('/api/executions?limit=20')
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const data: Execution[] = (await r.json()).data ?? []
  return data.map((e) => ({
    id: e.id,
    status: e.status ?? '',
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

export type Progress = { id: string; nodes: NodeRun[] }

/** Latest execution that matches `query`, as a node timeline. Default: the running one.
 *  n8n only fills runData during a run when the workflow's "Save execution progress" setting is on. */
export async function getProgress(query = 'status=running'): Promise<Progress | null> {
  const r = await fetch(`/api/executions?${query}&limit=1&includeData=true`)
  if (!r.ok) return null
  const run: Execution | undefined = (await r.json()).data?.[0]
  if (!run) return null
  const running = run.status === 'running' ? (run.data?.executionData?.nodeExecutionStack?.[0]?.node?.name ?? null) : null
  return { id: run.id, nodes: timeline(run.data?.resultData?.runData ?? {}, running) }
}
