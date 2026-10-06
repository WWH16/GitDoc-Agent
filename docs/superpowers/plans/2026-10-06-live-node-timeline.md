# Live n8n Node Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the exact n8n nodes a generation run executes, live and in order, so the Run card keeps moving instead of freezing on "Reading repository files".

**Architecture:** The cause has two parts. First, the workflow does not save execution progress, so n8n's API returns stale node data while a run is in progress. Second, the UI collapses about 30 nodes into 5 coarse steps, so long loops look frozen. Task 1 turns on progress saving and proves the API now returns live data. Task 2 adds a pure `timeline()` function in `src/api.ts`. The function turns n8n `runData` into an ordered node list with status, run count and duration. Task 3 renders that list in the Run card, fetches the final list once the run ends, and shows a hint when n8n is not saving progress.

**Tech Stack:** React 19, Vite 8, Tailwind v4, shadcn/ui (Radix), lucide-react, n8n public REST API v1, Node 24 built-in test runner (`node --test`, native TypeScript type stripping).

**Spec:** User request in chat, 2026-10-06: "render the exact steps are executing cause right now its not moving and staying still on Reading repository files". Root cause evidence is in "Background" below.

## Global Constraints

- No new npm dependencies. Use `node:test` and `node:assert/strict` for tests.
- UI uses the existing shadcn components in `src/components/ui/` and lucide icons. Do not add new shadcn components.
- Keep the Vite proxy as the only path to n8n. The browser never sees `N8N_API_KEY`.
- `src/api.ts` must stay free of DOM-only and Vite-only imports, so `node --test` can import it directly.
- Code must pass `npm run build` (`tsc -b && vite build`) and `npx oxlint src` with no new warnings.
- The project is not a git repository. There are no commit steps. Run the build at the end of each task instead.

## Background (read first)

Facts collected on 2026-10-06 against the local n8n (`http://localhost:5678`, workflow `b6h5J6Rd4wfIh9Zs`):

- Workflow `settings` = `{"executionOrder":"v1","binaryMode":"separate",...}`. There is **no** `saveExecutionProgress` key, so n8n does not write `runData` to the DB after each node.
- `.env` sets no `N8N_WEBHOOK_PATH`, so the app calls `/webhook-test/doc-agent`. Every recent execution has `mode: "manual"`.
- A canceled execution, read during the run, had `runData: {}` and `nodeExecutionStack: ["Webhook"]`. This is the stale snapshot the UI polls.
- Real node order and timing of successful execution 402 (about 42 s total):
  ```
  Webhook > Validate & Extract GitHub URL > Valid GitHub URL? > List Repository Files
  > Filter Directories > Loop Over Items <-> List Directory Files (loop, ~6 s)
  > Filter Relevant Files > Get File Contents (~11 s) > Decode File Contents
  > Remove Empty Files > Group Files > Repository Analysis Agent (~13 s; sub-nodes:
  Simple Memory, Groq Chat Model, Google Gemini Chat Model) > Prepare Markdown
  > Extract Mermaid Diagrams > Split Out > Build Mermaid URL > Render Mermaid Diagram (~11 s)
  > Prepare Validation Result > If > [Repair Mermaid Diagram > Prepare Repaired Mermaid
  > Build Mermaid URL1] > Combine Diagrams > Insert Diagrams into Markdown > Return Documentation
  ```
- n8n `runData` shape: `Record<nodeName, TaskData[]>`. Each `TaskData` holds one run of the node: `{ startTime: number (epoch ms), executionTime: number (ms), executionStatus?: string, error?: { message: string } }`. A node inside a loop has several entries.
- `data.executionData.nodeExecutionStack[0].node.name` is the node n8n runs next or now.

## Review Focus

- **Progress saving still off** (user skips Task 1, or n8n ignores it): the run lasts over 10 s and the node list stays empty. Expected: a visible hint tells the user to turn on "Save execution progress". Pinned in Task 3, Step 3 (`showProgressHint`), with a test in Task 2.
- **Loop nodes run many times** (`Loop Over Items`, `List Directory Files`): expected one row per node with a `×N` run count that grows, not duplicate rows. Pinned in Task 2 tests.
- **Run fails mid-way** (bad URL, LLM error): expected the failing node shows as error, and the list stops there. Pinned in Task 2 (`error` test) and Task 3 (final fetch also runs on error).
- **Run ends between two polls**: expected the list shows every node, including the last ones. Pinned in Task 3 by the final `getProgress('')` call after `callWorkflow` settles.
- **Big repository makes each poll slow** (`includeData=true` carries file contents): expected no overlapping requests and no UI freeze. The existing `polling` guard covers this. Keep it unchanged in Task 3.

---

### Task 1: Turn on n8n execution progress and prove live data

**Files:**
- Create (temporary, deleted in Step 5): `watch-execution.mjs` (project root)
- No app code changes.

**Interfaces:**
- Consumes: `.env` keys `N8N_URL`, `N8N_API_KEY`, `N8N_WORKFLOW_ID` (same file `vite.config.ts` reads).
- Produces: workflow setting "Save execution progress" = on. Tasks 2 and 3 rely on `runData` growing during a run.

- [ ] **Step 1: Turn on progress saving in n8n**

In the n8n editor, open the "Doc Agent" workflow. Open **⋯ menu > Settings**. Set **Save execution progress** to **Save**. Click **Save**, then save the workflow.

(Alternative for all workflows: set env var `EXECUTIONS_DATA_SAVE_ON_PROGRESS=true` on the n8n process and restart it. Do only one of the two.)

- [ ] **Step 2: Confirm the setting through the API**

Create `watch-execution.mjs`:

```js
// Temporary diagnostic: prints the live state of the running execution every 2 s.
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
)
const base = env.N8N_URL || 'http://localhost:5678'
const wf = env.N8N_WORKFLOW_ID || 'b6h5J6Rd4wfIh9Zs'
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY }

const w = await (await fetch(`${base}/api/v1/workflows/${wf}`, { headers })).json()
console.log('saveExecutionProgress =', w.settings?.saveExecutionProgress)

for (;;) {
  const r = await (await fetch(`${base}/api/v1/executions?workflowId=${wf}&status=running&limit=1&includeData=true`, { headers })).json()
  const e = r.data?.[0]
  if (e) {
    const nodes = Object.keys(e.data?.resultData?.runData ?? {})
    const next = e.data?.executionData?.nodeExecutionStack?.[0]?.node?.name
    console.log(new Date().toISOString().slice(11, 19), `#${e.id}`, `${nodes.length} nodes done`, 'now:', next)
  } else console.log(new Date().toISOString().slice(11, 19), 'no running execution')
  await new Promise((ok) => setTimeout(ok, 2000))
}
```

Run: `node watch-execution.mjs`
Expected first line: `saveExecutionProgress = true`. If it prints `undefined`, Step 1 did not save. If you chose the env var path, `undefined` is fine. Step 3 is the real proof either way.

- [ ] **Step 3: Watch a real run**

Keep the script running. In n8n click **Execute workflow** so the test webhook listens. Start `npm run dev`, open the app, and generate docs for any public repo.

Expected: the `N nodes done` count rises during the run (for example 0, 4, 7, 12, 13, …), and `now:` changes name.
Failure: the count stays at `0` with `now: Webhook`. Then progress saving is still off. Return to Step 1 and do not start Task 2.

- [ ] **Step 4: Stop the script**

Press Ctrl+C.

- [ ] **Step 5: Delete the temporary script**

Run: `rm watch-execution.mjs`

---

### Task 2: Pure `timeline()` function with tests

**Files:**
- Modify: `src/api.ts` (the `Execution` type, `getProgress`, and new `NodeRun` and `timeline` exports)
- Create: `src/api.test.ts`
- Modify: `tsconfig.app.json` (exclude test files from the app build)
- Modify: `package.json` (add `test` script)

**Interfaces:**
- Consumes: nothing from earlier tasks (Task 1 only changes n8n behavior).
- Produces:
  ```ts
  export type NodeRun = { name: string; status: 'done' | 'running' | 'error'; runs: number; ms: number }
  export function timeline(runData: Record<string, TaskData[]>, running: string | null): NodeRun[]
  export type Progress = { id: string; nodes: NodeRun[] }
  export async function getProgress(query?: string): Promise<Progress | null>  // default query 'status=running'
  export const showProgressHint: (elapsed: number, nodes: NodeRun[]) => boolean
  ```
  `currentStep(doneNodes: Set<string>)` keeps its signature.

- [ ] **Step 1: Write the failing test**

Create `src/api.test.ts`:

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { currentStep, showProgressHint, timeline } from './api.ts'

test('orders nodes by first start time', () => {
  const t = timeline({ B: [{ startTime: 20, executionTime: 5 }], A: [{ startTime: 10, executionTime: 3 }] }, null)
  assert.deepEqual(t.map((n) => n.name), ['A', 'B'])
  assert.deepEqual(t.map((n) => n.status), ['done', 'done'])
})

test('loop node becomes one row with run count and summed time', () => {
  const t = timeline({ Loop: [{ startTime: 1, executionTime: 4 }, { startTime: 9, executionTime: 3 }] }, null)
  assert.deepEqual(t, [{ name: 'Loop', status: 'done', runs: 2, ms: 7 }])
})

test('running node not yet in runData is appended as running', () => {
  const t = timeline({ A: [{ startTime: 1, executionTime: 2 }] }, 'Get File Contents')
  assert.deepEqual(t.at(-1), { name: 'Get File Contents', status: 'running', runs: 0, ms: 0 })
})

test('running node already in runData (next loop pass) is marked running, not duplicated', () => {
  const t = timeline({ Loop: [{ startTime: 1, executionTime: 4 }] }, 'Loop')
  assert.equal(t.length, 1)
  assert.equal(t[0].status, 'running')
})

test('node with an error is marked error', () => {
  const t = timeline({ Agent: [{ startTime: 1, executionTime: 2, error: { message: 'quota' } }] }, null)
  assert.equal(t[0].status, 'error')
})

test('empty runData and no running node gives an empty list', () => {
  assert.deepEqual(timeline({}, null), [])
})

test('progress hint shows only after 10 s with no finished nodes', () => {
  const running = [{ name: 'Webhook', status: 'running' as const, runs: 0, ms: 0 }]
  assert.equal(showProgressHint(5, []), false)
  assert.equal(showProgressHint(12, []), true)
  assert.equal(showProgressHint(12, running), true)
  assert.equal(showProgressHint(12, [{ name: 'Webhook', status: 'done', runs: 1, ms: 1 }]), false)
})

test('currentStep still maps finished nodes to coarse steps', () => {
  assert.equal(currentStep(new Set()), 0)
  assert.equal(currentStep(new Set(['Valid GitHub URL?', 'Group Files'])), 2)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/api.test.ts`
Expected: FAIL with `SyntaxError: The requested module './api.ts' does not provide an export named 'showProgressHint'` (or `timeline`).

- [ ] **Step 3: Write minimal implementation**

In `src/api.ts`, replace the `Execution` type with:

```ts
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
```

Replace everything from `export type Progress` to the end of the file with:

```ts
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
```

In `tsconfig.app.json`, add `"exclude"` next to `"include"`:

```json
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
```

In `package.json` `scripts`, add:

```json
    "test": "node --test src/*.test.ts",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS, `# pass 8`, `# fail 0`.

- [ ] **Step 5: Confirm the app still type-checks**

Run: `npm run build`
Expected: FAIL in `src/App.tsx`, because `p.node` and `p.nodes` (a `Set`) no longer exist. Task 3 fixes this. Continue straight to Task 3. Do not stop here with a broken build.

---

### Task 3: Render the live node timeline in the Run card

**Files:**
- Modify: `src/App.tsx` (imports, `Generate` state, polling effect, `generate()`, Run card markup)

**Interfaces:**
- Consumes from Task 2: `NodeRun`, `getProgress(query?)`, `showProgressHint(elapsed, nodes)`, `currentStep(Set<string>)`, `STEPS`.
- Produces: UI only.

- [ ] **Step 1: Update imports**

Change the lucide import line to:

```ts
import { Check, CircleX, Download, FileText, Loader2, Moon, RefreshCw, Sun } from 'lucide-react'
```

Change the `./api` import line to:

```ts
import {
  STEPS,
  URL_PLACEHOLDER,
  callWorkflow,
  currentStep,
  getHistory,
  getProgress,
  showProgressHint,
  type NodeRun,
  type Progress,
  type Result,
  type Run,
} from './api'
```

Add below the `clock` helper:

```ts
const duration = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`)
```

- [ ] **Step 2: Replace node state and polling with the timeline**

In `Generate`, replace `const [node, setNode] = useState<string | null>(null)` with:

```ts
  const [nodes, setNodes] = useState<NodeRun[]>([])
```

Add this function inside `Generate`, above the `useEffect`:

```ts
  function applyProgress(p: Progress | null) {
    if (!p) return
    setRunId(p.id)
    setNodes(p.nodes)
    setStep(currentStep(new Set(p.nodes.filter((n) => n.status !== 'running').map((n) => n.name))))
  }
```

In the polling effect, replace the `.then((p) => { ... })` block with:

```ts
          .then(applyProgress)
```

Keep the `polling` guard and the `.catch(() => {})` exactly as they are.

In `generate()`, replace `setNode(null)` with `setNodes([])`. Then replace the `try { ... } catch { ... }` block with:

```ts
    try {
      setResult(await callWorkflow(url))
      setPhase('done')
      onFinished()
    } catch (e) {
      setError((e as Error).message)
      setPhase('error')
    }
    // The run may end between polls: fetch the latest execution once more so the list ends on the final node.
    // ponytail: assumes the latest execution is ours (single local user); match on runId if several people share n8n
    getProgress('').then(applyProgress).catch(() => {})
```

- [ ] **Step 3: Replace the Run card body**

Inside the Run card's `<CardContent className="space-y-4">`, delete the `{phase === 'running' && ( ... n8n node ... )}` block. Then delete the whole `<ol className="space-y-2.5"> ... </ol>` STEPS checklist. Keep the "`{completed} of {STEPS.length} steps`" row and the `<Progress>` bar. Put this after `<Progress ... />`:

```tsx
            {phase === 'running' && showProgressHint(elapsed, nodes) && (
              <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                n8n is not reporting live progress. In n8n, open this workflow's Settings and set "Save execution
                progress" to Save.
              </p>
            )}
            {nodes.length > 0 && (
              <ol className="divide-y rounded-md border text-sm">
                {nodes.map((n) => (
                  <li key={n.name} className="flex items-center gap-3 px-3 py-2">
                    {n.status === 'running' ? (
                      <Loader2 className="size-4 shrink-0 animate-spin text-warning" />
                    ) : n.status === 'error' ? (
                      <CircleX className="size-4 shrink-0 text-destructive" />
                    ) : (
                      <Check className="size-4 shrink-0 text-success" />
                    )}
                    <span className={cn('truncate font-mono', n.status === 'running' && 'font-medium')}>{n.name}</span>
                    {n.runs > 1 && <Badge variant="secondary">×{n.runs}</Badge>}
                    <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                      {n.status === 'running' ? 'running…' : duration(n.ms)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
```

- [ ] **Step 4: Build, lint, test**

Run: `npm run build && npx oxlint src && npm test`
Expected: build succeeds. oxlint shows only the existing `only-export-components` warnings in `src/components/ui/*` and the existing `set-state-in-effect` warning on the history refresh. Tests show `# pass 8`.

If `tsc` reports `'Check' is declared but never used` or similar, remove only the named unused import.

- [ ] **Step 5: Verify in the real app**

1. In n8n click **Execute workflow** (the test webhook listens for one call).
2. Run `npm run dev` and open the printed URL.
3. Generate docs for a public repo.

Expected while running: node rows appear in this order: `Webhook`, `Validate & Extract GitHub URL`, `Valid GitHub URL?`, `List Repository Files`, … The current node has a spinner. `List Directory Files` shows a growing `×N` badge. The coarse progress bar moves past "Reading repository files" once `Group Files` finishes.
Expected when done: the last row is `Return Documentation` with a check, and the badge shows `Success`.
Expected with a bad URL (`https://example.com/x`): the list ends at `Valid GitHub URL?` / `Respond to Webhook`, and the error text shows under the input.
Expected with "Save execution progress" turned off again (optional check): after 10 s the amber hint appears.
