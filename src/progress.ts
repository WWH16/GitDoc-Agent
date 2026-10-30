// n8n execution → node timeline. Shared by the browser and the /api guard, which builds it server-side so the
// browser never receives execution data (it holds the repository's files).

export type TaskData = {
  startTime: number
  executionTime?: number
  error?: { message?: string }
  data?: { main?: { json?: unknown }[][] }
}

export type Execution = {
  id: string
  status?: string
  startedAt?: string
  stoppedAt?: string
  data?: {
    resultData?: { runData?: Record<string, TaskData[]> }
    executionData?: { nodeExecutionStack?: { node?: { name?: string } }[] }
  }
}

export type NodeRun = { name: string; status: 'done' | 'running' | 'error'; runs: number; ms: number }

/** `error` is the first failed node as "Node: message", empty when none failed. */
export type Progress = { id: string; status: string; error: string; nodes: NodeRun[] }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

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

/** One execution as a node timeline. n8n only fills runData during a run when "Save execution progress" is on. */
export function toProgress(run: Execution): Progress {
  const raw = run.data?.resultData?.runData
  // Keep only nodes with at least one task so timeline() can read tasks[0]
  const runData: Record<string, TaskData[]> = isObject(raw)
    ? Object.fromEntries(Object.entries(raw).filter(([, t]) => Array.isArray(t) && t.length > 0 && isObject(t[0])))
    : {}
  const head = run.status === 'running' ? run.data?.executionData?.nodeExecutionStack?.[0]?.node?.name : undefined
  const failed = Object.entries(runData).find(([, tasks]) => tasks.some((t) => t.error))
  const error = failed ? `${failed[0]}: ${failed[1].find((t) => t.error)?.error?.message ?? 'failed'}` : ''
  const status = typeof run.status === 'string' ? run.status : ''
  return { id: String(run.id), status, error, nodes: timeline(runData, typeof head === 'string' ? head : null) }
}

/** The runId the browser sent with /api/generate, read from the Webhook node's output. */
export function runIdOf(run: Execution): string | null {
  const body = run.data?.resultData?.runData?.Webhook?.[0]?.data?.main?.[0]?.[0]?.json
  const runId = isObject(body) && isObject(body.body) ? body.body.runId : null
  return typeof runId === 'string' ? runId : null
}
