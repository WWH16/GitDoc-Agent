import { Check, CircleX, Download, FileText, Loader2, Moon, Plus, RefreshCw, Send, Sun } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import {
  MAX_QUESTION,
  STEPS,
  URL_PLACEHOLDER,
  askRepo,
  callWorkflow,
  currentStep,
  getHistory,
  getProgress,
  showProgressHint,
  type NodeRun,
  type Progress as RunProgress,
  type Result,
  type Run,
} from './api'

type Phase = 'idle' | 'running' | 'done' | 'error'
type Tone = 'success' | 'destructive' | 'warning' | 'neutral'

const TONE: Record<Tone, string> = {
  success: 'border-success/30 bg-success/10 text-success',
  destructive: 'border-destructive/30 bg-destructive/10 text-destructive',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  neutral: 'text-muted-foreground',
}

const STATUS_TONE: Record<string, Tone> = {
  success: 'success',
  failed: 'destructive',
  error: 'destructive',
  crashed: 'destructive',
  canceled: 'destructive',
  running: 'warning',
  waiting: 'warning',
  new: 'warning',
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const duration = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`)

const PROSE =
  'prose prose-sm prose-neutral max-w-none dark:prose-invert prose-headings:tracking-tight prose-img:mx-auto prose-pre:border prose-pre:bg-muted prose-pre:text-foreground'

// Markdown libs (~25 KB gzip) load on first use. DOMPurify keeps data: URLs on <img>, so rendered diagrams survive.
async function renderMarkdown(md: string) {
  const [{ marked }, { default: DOMPurify }] = await Promise.all([import('marked'), import('dompurify')])
  return DOMPurify.sanitize(marked.parse(md, { async: false }))
}

type RepoProps = { repo: string; setRepo: (v: string) => void }

export default function App() {
  const [repo, setRepo] = useState('')
  const [runs, setRuns] = useState<Run[] | null>(null)
  const [historyError, setHistoryError] = useState('')

  const refresh = useCallback(async () => {
    try {
      setRuns(await getHistory())
      setHistoryError('')
    } catch (e) {
      setHistoryError(`Could not load run history: ${(e as Error).message}`)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <Tabs defaultValue="generate" className="min-h-screen gap-0">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-2 font-semibold">
            <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
              <FileText className="size-4" />
            </span>
            GitDoc Agent
          </div>
          <div className="flex items-center gap-2">
            <TabsList>
              <TabsTrigger value="generate" className="px-3">Generate</TabsTrigger>
              <TabsTrigger value="ask" className="px-3">Ask</TabsTrigger>
              <TabsTrigger value="history" className="px-3">Run history</TabsTrigger>
            </TabsList>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        {/* forceMount keeps every tab mounted: results, chat and a running generation survive tab switches */}
        <TabsContent value="generate" forceMount className="space-y-6 data-[state=inactive]:hidden">
          <Generate repo={repo} setRepo={setRepo} onFinished={refresh} />
        </TabsContent>
        <TabsContent value="ask" forceMount className="space-y-6 data-[state=inactive]:hidden">
          <Ask repo={repo} setRepo={setRepo} />
        </TabsContent>
        <TabsContent value="history" forceMount className="space-y-6 data-[state=inactive]:hidden">
          <History runs={runs} error={historyError} onRefresh={refresh} />
        </TabsContent>
      </main>
    </Tabs>
  )
}

// index.html applies the saved or system theme before first paint; this only flips it
function ThemeToggle() {
  function toggle() {
    const dark = document.documentElement.classList.toggle('dark')
    try {
      localStorage.setItem('theme', dark ? 'dark' : 'light')
    } catch {}
  }

  return (
    <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={toggle}>
      <Sun className="scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
      <Moon className="absolute scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
    </Button>
  )
}

function Generate({ repo, setRepo, onFinished }: RepoProps & { onFinished: () => void }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [step, setStep] = useState<number | null>(null)
  const [nodes, setNodes] = useState<NodeRun[]>([])
  const [runId, setRunId] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [result, setResult] = useState<Result | null>(null)
  const [html, setHtml] = useState('')
  const [error, setError] = useState('')

  function applyProgress(p: RunProgress | null) {
    if (!p) return
    setRunId(p.id)
    setNodes(p.nodes)
    setStep(currentStep(new Set(p.nodes.filter((n) => n.status !== 'running').map((n) => n.name))))
  }

  // Tick every second while generating; poll n8n every 3 seconds (best-effort, errors ignored)
  useEffect(() => {
    if (phase !== 'running') return
    const started = Date.now()
    let polling = false
    const id = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000)
      setElapsed(s)
      if (s % 3 === 0 && !polling) {
        polling = true
        getProgress()
          .then(applyProgress)
          .catch(() => {})
          .finally(() => (polling = false))
      }
    }, 1000)
    return () => clearInterval(id)
  }, [phase])

  async function generate(e: FormEvent) {
    e.preventDefault()
    const url = repo.trim()
    if (!url) {
      setPhase('error')
      setError('Enter a repository URL first.')
      return
    }
    setPhase('running')
    setStep(null)
    setNodes([])
    setRunId('')
    setElapsed(0)
    setError('')
    try {
      const res = await callWorkflow(url)
      setHtml(await renderMarkdown(res.preview))
      setResult(res)
      setPhase('done')
      onFinished()
    } catch (e) {
      setError((e as Error).message)
      setPhase('error')
    }
    // The run may end between polls: fetch the latest execution once more so the list ends on the final node.
    // ponytail: assumes the latest execution is ours (single local user); match on runId if several people share n8n
    getProgress('').then(applyProgress).catch(() => {})
  }

  function download() {
    if (!result) return
    const blob = new Blob([result.markdown], { type: 'text/markdown' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'DOCUMENTATION.md'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const status = { idle: 'idle', running: 'running', done: 'success', error: 'failed' }[phase]

  // Steps finished so far; all of them once done
  const completed = phase === 'done' ? STEPS.length : (step ?? 0)
  const stepText = phase === 'done' ? 'Complete' : `Step ${completed + 1} of ${STEPS.length}: ${STEPS[completed][0]}`

  return (
    <>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Generate documentation</h1>
        <p className="text-sm text-muted-foreground">Turn any GitHub repository into readable docs with diagrams.</p>
      </div>

      <Card>
        <CardContent>
          <form onSubmit={generate} className="space-y-3">
            <label htmlFor="repo" className="text-sm font-medium">
              Repository URL
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <RepoInput
                id="repo"
                value={repo}
                onChange={setRepo}
                disabled={phase === 'running'}
                invalid={phase === 'error'}
              />
              <Button type="submit" disabled={phase === 'running'}>
                {phase === 'running' && <Loader2 className="animate-spin" />}
                {phase === 'running' ? 'Generating…' : 'Generate'}
              </Button>
            </div>
            <p
              className={cn('text-sm', phase === 'error' ? 'text-destructive' : 'text-muted-foreground')}
              role={phase === 'error' ? 'alert' : undefined}
              aria-live="polite"
            >
              {phase === 'idle' && 'Paste a public GitHub URL and press Enter.'}
              {phase === 'running' && 'This usually takes a few minutes. Keep this tab open.'}
              {phase === 'done' && `Documentation generated in ${clock(elapsed)}.`}
              {phase === 'error' && error}
            </p>
          </form>
        </CardContent>
      </Card>

      {phase !== 'idle' && (
        <Card>
          <CardHeader>
            <CardTitle>Run</CardTitle>
            <CardDescription>{runId ? `Execution #${runId}` : 'Waiting for execution ID…'}</CardDescription>
            <CardAction>
              <Badge variant="outline" className={cn('capitalize', TONE[STATUS_TONE[status] ?? 'neutral'])}>{status}</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{stepText}</span>
              <span className="font-medium tabular-nums">{clock(elapsed)}</span>
            </div>
            <Progress value={(completed / STEPS.length) * 100} />
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
          </CardContent>
        </Card>
      )}

      {phase === 'done' && result && (
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Documentation</CardTitle>
            <CardDescription>Preview of the generated DOCUMENTATION.md</CardDescription>
            <CardAction>
              <Button variant="outline" size="sm" onClick={download}>
                <Download />
                Download .md
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <article
              className="prose prose-sm prose-neutral max-w-none dark:prose-invert prose-headings:tracking-tight prose-img:mx-auto prose-pre:border prose-pre:bg-muted prose-pre:text-foreground"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </CardContent>
        </Card>
      )}
    </>
  )
}

type Message = { role: 'user'; text: string } | { role: 'assistant'; html: string; sources: string[] }

const SUGGESTIONS = ['What does this project do?', 'Where is authentication handled?', 'Explain the database models']

function Ask({ repo, setRepo }: RepoProps) {
  // One sessionId per chat, so the backend keeps the conversation's context
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID())
  const [messages, setMessages] = useState<Message[]>([])
  const [question, setQuestion] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const noRepo = !repo.trim()

  // Keep the newest message (or the waiting indicator) in view
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' })
  }, [messages, pending])

  async function send(text: string) {
    const q = text.trim()
    if (!q || noRepo || pending) return
    setMessages((m) => [...m, { role: 'user', text: q }])
    setQuestion('')
    setError('')
    setPending(true)
    try {
      const { answer, sources } = await askRepo(repo.trim(), q, sessionId)
      const html = await renderMarkdown(answer)
      setMessages((m) => [...m, { role: 'assistant', html, sources }])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPending(false)
    }
  }

  function newChat() {
    setMessages([])
    setError('')
    setSessionId(crypto.randomUUID())
  }

  return (
    <>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Ask the Repo</h1>
        <p className="text-sm text-muted-foreground">Answers come from the indexed source of the repository.</p>
      </div>

      <Card>
        <CardContent className="space-y-3">
          <label htmlFor="ask-repo" className="text-sm font-medium">
            Repository URL
          </label>
          <RepoInput id="ask-repo" value={repo} onChange={setRepo} />
          {noRepo && (
            <p className="text-sm text-muted-foreground">
              Enter a repository URL first. Generate docs for it once so it gets indexed.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Chat</CardTitle>
          <CardAction>
            {/* Disabled while waiting, so a late answer never lands in the new chat */}
            <Button variant="outline" size="sm" onClick={newChat} disabled={pending || messages.length === 0}>
              <Plus />
              New chat
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          {messages.length === 0 ? (
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <Button key={s} variant="secondary" size="sm" disabled={noRepo || pending} onClick={() => send(s)}>
                  {s}
                </Button>
              ))}
            </div>
          ) : (
            <ol className="space-y-4" aria-live="polite">
              {messages.map((m, i) => (
                <li key={i} data-role={m.role} className="space-y-2">
                  {m.role === 'user' && <p className="text-sm font-medium whitespace-pre-wrap">{m.text}</p>}
                  {m.role === 'assistant' && (
                    <>
                      <article className={PROSE} dangerouslySetInnerHTML={{ __html: m.html }} />
                      {m.sources.length > 0 && (
                        <div className="text-sm">
                          <p className="font-medium text-muted-foreground">Sources</p>
                          <ul>
                            {m.sources.map((src, j) => (
                              <li key={j}>
                                <code className="font-mono text-xs">{src}</code>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ol>
          )}

          {pending && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin" />
              Searching the code…
            </p>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <div ref={end} />

          <form
            onSubmit={(e) => {
              e.preventDefault()
              send(question)
            }}
            className="flex gap-2"
          >
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask a question about the code"
              aria-label="Question"
              maxLength={MAX_QUESTION}
              disabled={pending}
            />
            <Button type="submit" disabled={pending || noRepo || !question.trim()}>
              <Send />
              Ask
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  )
}

function RepoInput({
  id,
  value,
  onChange,
  disabled,
  invalid,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  invalid?: boolean
}) {
  return (
    <div className="relative flex-1">
      <GitHubIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={URL_PLACEHOLDER}
        disabled={disabled}
        aria-invalid={invalid}
        className="pl-9"
      />
    </div>
  )
}

function History({ runs, error, onRefresh }: { runs: Run[] | null; error: string; onRefresh: () => void }) {
  return (
    <>
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Run history</h1>
          <p className="text-sm text-muted-foreground">The 20 most recent workflow executions.</p>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw />
          Refresh
        </Button>
      </div>

      <Card className="overflow-hidden py-0">
        {error ? (
          <p className="px-6 py-10 text-center text-sm text-destructive" role="alert">{error}</p>
        ) : runs === null ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : runs.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">No runs yet. Generate docs to see them here.</p>
        ) : (
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="pl-4">ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead className="pr-4">Finished</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="pl-4 font-medium tabular-nums">#{r.id}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn('capitalize', TONE[STATUS_TONE[r.status] ?? 'neutral'])}>
                      {r.status || 'unknown'}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{r.started || '—'}</TableCell>
                  <TableCell className="pr-4 tabular-nums text-muted-foreground">{r.finished || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  )
}

// lucide-react no longer ships brand icons
function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}
