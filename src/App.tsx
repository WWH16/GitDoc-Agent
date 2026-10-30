import { ArrowUp, Check, ChevronDown, CircleX, CloudOff, CloudUpload, Download, FileCode, FileText, Loader2, Monitor, Moon, RefreshCw, SquarePen, Sun } from 'lucide-react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AccountDialog, AccountMenu, useAccount, type AccountStart } from '@/components/account-dialog'
import { linkError } from '@/lib/session'
import { GitHubIcon } from '@/components/github-icon'
import { Logo } from '@/components/logo'
import { ZoomableArticle } from '@/components/zoomable-article'
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
  getProgress,
  repoKey,
  type Result,
  type Turn,
} from './api'
import { deleteChat, loadChat, saveChat, type Message } from './lib/chats'
import { listGenerations, loadGeneration, saveGeneration, type Generation } from './lib/history'
import { showProgressHint, type NodeRun, type Progress as RunProgress } from './progress'

// partial: docs came back, but the execution failed later (Ask indexing)
type Phase = 'idle' | 'running' | 'done' | 'partial' | 'error'
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
  partial: 'warning',
}

const FAILED = new Set(['error', 'crashed', 'canceled'])

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const duration = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`)

// Rendered markdown (docs preview and chat answers) reads at body size; inline code drops the backticks
const PROSE =
  'prose prose-base prose-neutral max-w-none break-words dark:prose-invert prose-headings:tracking-tight prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-img:mx-auto prose-pre:border prose-pre:bg-muted prose-pre:text-foreground prose-code:before:content-none prose-code:after:content-none prose-table:block prose-table:overflow-x-auto'

// The page column (46rem) inside the wide documentation card: text starts on the same left edge as the form and run
// card above and stops at a 70ch measure; diagrams, code and tables break out to the card's full width.
// (Class names are written out in full: Tailwind only finds literal strings.)
// From 1280px the docs sit in their own pane, so text starts at the pane's edge instead.
const WIDE_PROSE =
  '[&>*]:ml-[max(0px,calc((100%-46rem)/2))] xl:[&>*]:ml-0 [&>*]:max-w-[70ch] [&>p:has(>img)]:ml-0 [&>p:has(>img)]:max-w-none [&>pre]:ml-0 [&>pre]:max-w-none [&>table]:ml-0 [&>table]:max-w-none'

// Markdown libs (~25 KB gzip) load on first use. DOMPurify keeps data: URLs on <img>, so rendered diagrams survive.
async function renderMarkdown(md: string) {
  const [{ marked }, { default: DOMPurify }] = await Promise.all([import('marked'), import('dompurify')])
  return DOMPurify.sanitize(marked.parse(md, { async: false }))
}

// localStorage helpers: the repo, last docs and Ask chat survive leaving the app (e.g. for the landing page) or a reload.
// Failures are ignored: private mode, blocked storage, or very large docs over the ~5 MB quota just aren't saved.
function load<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null
  } catch {
    return null
  }
}

function save(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

function useSavedState<T>(key: string, initial: () => T) {
  const [value, setValue] = useState<T>(() => load<T>(key) ?? initial())
  useEffect(() => save(key, value), [key, value])
  return [value, setValue] as const
}

type RepoProps = { repo: string; setRepo: (v: string) => void }

// The landing page's form links here as /app/?repo=<url>; that beats the saved repo
const LANDING_REPO = new URLSearchParams(location.search).get('repo')
if (LANDING_REPO) save('gitdoc:repo', LANDING_REPO)
// Docs used to be kept in this browser (up to a few MB); they live in Run history now
save('gitdoc:last-run', null)
// Ask chats used to be kept here too; each repository has its own saved chat now
save('gitdoc:ask-messages', null)
save('gitdoc:ask-session', null)

export default function App() {
  const [repo, setRepo] = useSavedState('gitdoc:repo', () => '')
  const [tab, setTab] = useState('generate')
  const [generations, setGenerations] = useState<Generation[] | null>(null)
  const [historyError, setHistoryError] = useState('')
  // Docs reopened from History; the Generate tab shows them
  const [opened, setOpened] = useState<Generation | null>(null)
  // A run in progress keeps the Generate tab, so History cannot open other docs into it meanwhile
  const [running, setRunning] = useState(false)
  const { user, saved, needsPassword, recovering } = useAccount()
  const accountDialog = useRef<HTMLDialogElement>(null)
  const [accountStart, setAccountStart] = useState<AccountStart>({ mode: 'save', step: 'form' })
  const [accountOpens, setAccountOpens] = useState(0)

  function openAccount(start: AccountStart) {
    setAccountStart(start)
    setAccountOpens((n) => n + 1)
    if (!accountDialog.current?.open) accountDialog.current?.showModal()
  }

  // Save history picks up where it stands: a link already sent reopens on "Check your email"
  const saveHistory = () => openAccount({ mode: 'save', step: user?.new_email ? 'sent' : 'form' })

  // An email link brought the user back, or this tab saw the email confirmed elsewhere: carry on with the next step
  useEffect(() => {
    if (needsPassword) openAccount({ mode: 'save', step: 'password' })
  }, [needsPassword])
  useEffect(() => {
    if (recovering) openAccount({ mode: 'signin', step: 'password', recovery: true })
  }, [recovering])
  useEffect(() => {
    const message = linkError(location.href)
    if (!message) return
    history.replaceState(null, '', location.pathname)
    openAccount({ mode: 'save', step: 'form', message })
  }, [])

  const refresh = useCallback(async () => {
    try {
      setGenerations(await listGenerations())
      setHistoryError('')
    } catch (e) {
      setHistoryError(`Couldn't load your history: ${(e as Error).message}`)
    }
  }, [])

  function changeTab(value: string) {
    setTab(value)
    if (value === 'history') refresh()
  }

  function open(g: Generation) {
    setOpened(g)
    setRepo(g.repo)
    setTab('generate')
  }

  return (
    <Tabs value={tab} onValueChange={changeTab} className="min-h-screen gap-0">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-2 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] sm:h-14 sm:gap-4 xl:max-w-[88rem]">
          <a href="/" className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <Logo />
          </a>
          <div className="flex items-center gap-1 sm:gap-2">
            <TabsList>
              <TabsTrigger value="generate" className="sm:px-3">Generate</TabsTrigger>
              <TabsTrigger value="ask" className="sm:px-3">Ask</TabsTrigger>
              <TabsTrigger value="history" className="sm:px-3">History</TabsTrigger>
            </TabsList>
            <AccountMenu user={user} saved={saved} onOpen={openAccount} />
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Up to 1280px every tab is one 48rem column; on big screens the shell widens and each tab picks its own width */}
      <main className="mx-auto w-full max-w-3xl pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] py-6 sm:py-10 xl:max-w-[88rem]">
        {/* forceMount keeps every tab mounted: results, chat and a running generation survive tab switches */}
        <TabsContent value="generate" forceMount className="data-[state=inactive]:hidden">
          <Generate
            repo={repo}
            setRepo={setRepo}
            opened={opened}
            onFinished={refresh}
            onRunningChange={setRunning}
            unsaved={!saved}
            onSave={saveHistory}
          />
        </TabsContent>
        <TabsContent value="ask" forceMount className="mx-auto w-full max-w-3xl data-[state=inactive]:hidden 2xl:max-w-4xl">
          <Ask repo={repo} setRepo={setRepo} />
        </TabsContent>
        <TabsContent value="history" forceMount className="mx-auto w-full max-w-3xl space-y-6 data-[state=inactive]:hidden sm:space-y-8 xl:max-w-5xl">
          <History
            generations={generations}
            error={historyError}
            onRefresh={refresh}
            onOpen={open}
            running={running}
            unsaved={!saved}
            onSave={saveHistory}
            onGenerate={() => setTab('generate')}
          />
        </TabsContent>
      </main>
      <AccountDialog dialog={accountDialog} start={accountStart} opens={accountOpens} user={user} />
    </Tabs>
  )
}

const THEMES = ['light', 'dark', 'system'] as const

// index.html applies the saved theme before first paint; this cycles light, dark, system
function ThemeToggle() {
  const [theme, setTheme] = useState<(typeof THEMES)[number]>(() => {
    try {
      const t = localStorage.getItem('theme')
      return THEMES.find((x) => x === t) ?? 'system'
    } catch {
      return 'system'
    }
  })
  const Icon = { light: Sun, dark: Moon, system: Monitor }[theme]

  function cycle() {
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]
    setTheme(next)
    const dark = next === 'dark' || (next === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.classList.toggle('dark', dark)
    try {
      localStorage.setItem('theme', next)
    } catch {}
  }

  return (
    <Button variant="ghost" size="icon" aria-label={`Theme: ${theme}. Change theme`} title={`Theme: ${theme}`} onClick={cycle}>
      <Icon />
    </Button>
  )
}

type GenerateProps = RepoProps & {
  opened: Generation | null
  onFinished: () => void
  onRunningChange: (running: boolean) => void
  /** The history lives in this browser only, so finished docs come with a prompt to save it */
  unsaved: boolean
  onSave: () => void
}

function Generate({ repo, setRepo, opened, onFinished, onRunningChange, unsaved, onSave }: GenerateProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [step, setStep] = useState<number | null>(null)
  const [nodes, setNodes] = useState<NodeRun[]>([])
  const [runId, setRunId] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [result, setResult] = useState<Result | null>(null)
  const [html, setHtml] = useState('')
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')
  // The docs came from the shared cache: the repository had not changed since they were generated, so nothing ran
  const [cached, setCached] = useState(false)

  // Docs opened from Run history replace what this tab shows, unless a run is going (it keeps the tab)
  useEffect(() => {
    if (!opened || phase === 'running') return
    let current = true
    renderMarkdown(opened.preview).then((h) => {
      if (!current) return
      setPhase('idle')
      setNodes([])
      setRunId('')
      setError('')
      setSaveError('')
      setCached(false)
      setResult({ markdown: opened.markdown, preview: opened.preview })
      setHtml(h)
    })
    return () => {
      current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a newly opened generation should replace the docs
  }, [opened])

  useEffect(() => onRunningChange(phase === 'running'), [phase, onRunningChange])

  // The id this browser gave its current run (not n8n's execution id, which `runId` shows)
  const myRun = useRef('')

  function applyProgress(p: RunProgress | null) {
    if (!p) return
    setRunId(p.id)
    setNodes(p.nodes)
    setStep(currentStep(new Set(p.nodes.filter((n) => n.status !== 'running').map((n) => n.name))))
  }

  // A run in progress can't be restored, so the browser asks before leaving, reloading or closing the tab
  useEffect(() => {
    if (phase !== 'running') return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    addEventListener('beforeunload', warn)
    return () => removeEventListener('beforeunload', warn)
  }, [phase])

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
        getProgress(myRun.current)
          .then(applyProgress)
          .catch(() => {})
          .finally(() => (polling = false))
      }
    }, 1000)
    return () => clearInterval(id)
  }, [phase])

  async function generate(fresh = false) {
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
    setSaveError('')
    setCached(false)
    setResult(null)
    // A random id for this run: the server finds our execution by it, and nobody else knows it
    const run = (myRun.current = crypto.randomUUID())
    let res: Result & { cached: boolean }
    try {
      res = await callWorkflow(url, run, fresh)
      setHtml(await renderMarkdown(res.preview))
      setResult(res)
      setCached(res.cached)
    } catch (e) {
      setError((e as Error).message)
      setPhase('error')
      // The run may end between polls: read it once more so the list ends on the final node.
      getProgress(run).then(applyProgress).catch(() => {})
      return
    }
    // "Return Documentation" answers before the last node runs, so wait for the execution to end. Cached docs had no run.
    let p: RunProgress | null = null
    for (let i = 0; i < 100 && !res.cached; i++) {
      p = await getProgress(run).catch(() => null)
      if (p && p.status !== 'running') break
      await new Promise((r) => setTimeout(r, 3000))
    }
    applyProgress(p)
    let status = 'success'
    if (p && FAILED.has(p.status)) {
      setError(p.error || `n8n marked execution #${p.id} as ${p.status}.`)
      setPhase('partial')
      status = 'partial'
    } else setPhase('done')
    // The docs stay on screen either way; only the history entry is missing if this fails
    await saveGeneration({ repo: url, status, markdown: res.markdown, preview: res.preview, executionId: p?.id ?? '' }).then(
      onFinished,
      () => setSaveError("Couldn't save this run to your history."),
    )
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

  const status = { idle: 'idle', running: 'running', done: 'success', partial: 'partial', error: 'failed' }[phase]

  // Steps finished so far; all of them once done
  const finished = phase === 'done' || phase === 'partial'
  const completed = finished ? STEPS.length : (step ?? 0)
  const stepText = finished ? 'Complete' : `Step ${completed + 1} of ${STEPS.length}: ${STEPS[completed][0]}`

  // From 1280px a run gets two panes: the form and progress in a sticky rail, the docs beside it
  const showDocs = !!result && phase !== 'error'
  const split = showDocs || phase === 'running'

  return (
    <div
      className={cn(
        'mx-auto w-full max-w-3xl space-y-6 sm:space-y-8',
        split && 'xl:grid xl:max-w-none xl:grid-cols-[24rem_minmax(0,1fr)] xl:items-start xl:gap-10 xl:space-y-0',
      )}
    >
    <div className={cn('space-y-6 sm:space-y-8', split && 'xl:sticky xl:top-[5.5rem]')}>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Generate documentation</h1>
        <p className="text-sm text-muted-foreground">Turn any GitHub repository into readable docs with diagrams.</p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          generate()
        }}
        className="space-y-2"
      >
        <label htmlFor="repo" className="block text-sm font-medium">
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
          className={cn(
            'text-sm',
            phase === 'error' ? 'text-destructive' : phase === 'partial' ? 'text-warning' : 'text-muted-foreground',
          )}
          role={phase === 'error' || phase === 'partial' ? 'alert' : undefined}
          aria-live="polite"
        >
          {phase === 'idle' &&
            (result ? 'Opened from History. Generate again for the latest version.' : 'Paste a public GitHub URL and press Enter.')}
          {phase === 'running' && 'This usually takes a few minutes. Keep this tab open.'}
          {phase === 'done' && (cached ? 'Documentation loaded from cache.' : `Documentation generated in ${clock(elapsed)}.`)}
          {phase === 'partial' && `Documentation generated in ${clock(elapsed)}, but the run failed after that, so Ask may not know this repo. ${error}`}
          {phase === 'error' && error}
        </p>
        {saveError && (
          <p className="text-sm text-warning" role="alert">
            {saveError}
          </p>
        )}
        {/* Asked right after the docs arrive, when they are worth keeping; a line, never a popup */}
        {finished && unsaved && !saveError && (
          <p className="text-sm text-muted-foreground">
            Kept in this browser only.{' '}
            <button type="button" onClick={onSave} className="rounded-sm font-medium text-foreground underline underline-offset-4 outline-none hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50">
              Save history
            </button>{' '}
            to open these docs on any device.
          </p>
        )}
      </form>

      {phase !== 'idle' && (
        <Card>
          <CardHeader>
            <CardTitle>Run</CardTitle>
            <CardDescription>
              {cached ? 'Cached docs, no workflow run' : runId ? `Execution #${runId}` : 'Waiting for execution ID…'}
            </CardDescription>
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
              <p className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                n8n is not reporting live progress. In n8n, open this workflow's Settings and set "Save execution
                progress" to Save.
              </p>
            )}
            {nodes.length > 0 && (
              // In the sticky rail the node list scrolls on its own, so the rail never runs past the screen
              <ol className={cn('divide-y rounded-xl border text-sm', split && 'xl:max-h-[calc(100dvh-32rem)] xl:min-h-32 xl:overflow-y-auto')}>
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
    </div>

      {showDocs ? (
        // Below 1280px: breaks out of the 48rem column so diagrams get room. From 1280px: fills the pane beside the
        // rail, with the header sticky under the app header so Download stays in reach on long docs.
        <Card className="ml-[calc(50%-min(38rem,50vw-1rem))] w-[min(76rem,calc(100vw-2rem))] xl:ml-0 xl:w-auto">
          {/* Side padding puts the title and Download button on the page column's edges, like the cards above */}
          <CardHeader className="border-b sm:px-[max(1.5rem,calc((100%-46rem)/2))] xl:sticky xl:top-14 xl:z-[1] xl:-mt-6 xl:rounded-t-2xl xl:bg-card xl:px-6 xl:pt-6">
            <CardTitle>Documentation</CardTitle>
            <CardDescription>
              {cached && <span className="block font-medium text-foreground">Loaded from cache</span>}
              {cached
                ? 'The repository has not changed since these docs were made. Regenerate for a fresh run.'
                : 'Preview of the generated DOCUMENTATION.md. Select a diagram to enlarge it.'}
            </CardDescription>
            <CardAction className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => generate(true)} disabled={phase === 'running' || !repo.trim()}>
                <RefreshCw />
                <span className="sr-only sm:not-sr-only">Regenerate</span>
              </Button>
              <Button variant="outline" size="sm" onClick={download}>
                <Download />
                Download .md
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <ZoomableArticle html={html} className={cn(PROSE, WIDE_PROSE)} />
          </CardContent>
        </Card>
      ) : (
        phase === 'running' && (
          <div className="hidden min-h-[60vh] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed p-8 text-center xl:flex">
            <FileText className="size-6 text-muted-foreground" />
            <p className="font-medium">Your documentation appears here</p>
            <p className="max-w-xs text-sm text-muted-foreground">{stepText}</p>
          </div>
        )
      )}
    </div>
  )
}

const toTurn = (m: Message): Turn =>
  m.role === 'user'
    ? { role: 'user', text: m.text }
    : { role: 'assistant', text: m.text ?? new DOMParser().parseFromString(m.html, 'text/html').body.textContent ?? '' }

const SUGGESTIONS = ['What does this project do?', 'Where is authentication handled?', 'Explain the database models']

// A question that got no answer: kept so it can be asked again without retyping
type Failure = { question: string; message: string; cancelled: boolean }

// Answers can take minutes on the free tier; the wait message changes so a long wait never looks stuck
const waitMessage = (s: number) =>
  s < 30
    ? 'Searching the code…'
    : s < 150
      ? 'Still working. Answers can take a couple of minutes on the free tier.'
      : 'This is taking longer than usual. Keep waiting, or stop and try again.'

function Ask({ repo, setRepo }: RepoProps) {
  // One chat per repository, saved for this user; its sessionId keeps the conversation's context in the backend
  const key = repoKey(repo)
  const [sessionId, setSessionId] = useState<string>(() => crypto.randomUUID())
  const [messages, setMessages] = useState<Message[]>([])
  // The repo key whose chat is on screen. Until it matches `key`, the chat is loading and nothing can be sent.
  const [shown, setShown] = useState<string | null>(null)
  const shownRef = useRef(shown)
  shownRef.current = shown
  const [question, setQuestion] = useState('')
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [failed, setFailed] = useState<Failure | null>(null)
  const [saveError, setSaveError] = useState('')
  const abort = useRef<AbortController | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const refocus = useRef(false)
  const end = useRef<HTMLDivElement>(null)
  const pending = startedAt !== null
  const noRepo = !key
  const ready = shown === key
  const waited = pending ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0

  // Load the repo's chat when the URL settles (400 ms), not on every keystroke. A failed load starts an empty chat.
  useEffect(() => {
    let current = true
    const id = setTimeout(async () => {
      const chat = key ? await loadChat(key).catch(() => null) : null
      if (!current) return
      setSessionId(chat?.sessionId ?? crypto.randomUUID())
      setMessages(chat?.messages ?? [])
      setFailed(null)
      setSaveError('')
      setShown(key)
    }, 400)
    return () => {
      current = false
      clearTimeout(id)
    }
  }, [key])

  // Tick once a second while waiting, for the elapsed time and wait message
  useEffect(() => {
    if (!pending) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [pending])

  // Keep the newest message (or the waiting indicator) in view. Sending can unmount what had focus (a starter question,
  // or the first composer), so focus goes back to the question box.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' })
    if (refocus.current) {
      refocus.current = false
      input.current?.focus({ preventScroll: true })
    }
  }, [messages, startedAt])

  async function send(text: string, retry = false) {
    const q = text.trim()
    if (!q || noRepo || pending || !ready) return
    // A retry asks the question that already ends the chat: it is not added again, nor sent as history
    const prior = retry ? messages.slice(0, -1) : messages
    const asked: Message[] = retry ? messages : [...messages, { role: 'user', text: q }]
    if (!retry) {
      setMessages(asked)
      setQuestion('')
    }
    setFailed(null)
    setNow(Date.now())
    setStartedAt(Date.now())
    // On phones only keep focus where the person was typing, so the keyboard doesn't pop up after a tap
    refocus.current = document.activeElement === input.current || matchMedia('(pointer: fine)').matches
    const ctrl = new AbortController()
    abort.current = ctrl
    try {
      const { answer, sources } = await askRepo(repo.trim(), q, sessionId, prior.map(toTurn), ctrl.signal)
      const html = await renderMarkdown(answer)
      const chat: Message[] = [...asked, { role: 'assistant', html, text: answer, sources }]
      // The answer belongs to the repo it was asked about, even if the URL changed while waiting
      if (shownRef.current === key) setMessages(chat)
      // A failed save (e.g. a chat over the 1 MB limit) leaves the chat on screen but not after a reload, so say so
      saveChat(key, sessionId, chat).then(
        () => setSaveError(''),
        () => setSaveError("Couldn't save this chat. Its newest messages will be gone after a reload."),
      )
    } catch (e) {
      const cancelled = ctrl.signal.aborted
      // A late failure for a repo no longer on screen would show under another repo's chat
      if (shownRef.current === key) setFailed({ question: q, message: cancelled ? 'You stopped waiting for this answer.' : (e as Error).message, cancelled })
    } finally {
      abort.current = null
      setStartedAt(null)
    }
  }

  async function newChat() {
    // Only clear the screen once the saved chat is gone, or it would come back on the next visit
    try {
      await deleteChat(key)
    } catch {
      setSaveError("Couldn't start a new chat. Try again.")
      return
    }
    setSaveError('')
    setMessages([])
    setFailed(null)
    setSessionId(crypto.randomUUID())
  }

  const empty = messages.length === 0

  const composer = (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        send(question)
      }}
      className="flex items-end gap-2 rounded-2xl border bg-card p-2 pl-4 shadow-xs transition-colors focus-within:border-ring"
    >
      {/* field-sizing grows the textarea with its content, up to max-h. It stays enabled while waiting, so focus
          never drops and the next question can be drafted; only sending waits for the answer. */}
      <textarea
        ref={input}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            send(question)
          }
        }}
        placeholder={noRepo ? 'Enter a repo URL above first' : 'Ask anything about the code'}
        aria-label="Question"
        rows={1}
        maxLength={MAX_QUESTION}
        className="max-h-48 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-base outline-none [field-sizing:content] placeholder:text-muted-foreground"
      />
      <Button
        type="submit"
        size="icon"
        className="rounded-full"
        disabled={pending || noRepo || !ready || !question.trim()}
        aria-label="Send"
      >
        <ArrowUp />
      </Button>
    </form>
  )

  return (
    // Fills the viewport below the header (height + 1px border) and main's padding, without overflowing
    <div className="flex min-h-[calc(100dvh-7rem-1px)] flex-col sm:min-h-[calc(100dvh-8.5rem-1px)]">
      {/* Sticks just under the app header (h-16, sm:h-14, plus its 1px border) so the repo and New chat stay in reach */}
      <div className="sticky top-[calc(4rem+1px)] z-[2] -my-2 flex items-center gap-2 bg-background py-2 sm:top-[calc(3.5rem+1px)]">
        <div className="max-w-sm flex-1">
          <label htmlFor="ask-repo" className="sr-only">
            Repository URL
          </label>
          <RepoInput id="ask-repo" value={repo} onChange={setRepo} />
        </div>
        {/* Disabled while waiting, so a late answer never lands in the new chat */}
        <Button variant="ghost" size="sm" onClick={newChat} disabled={pending || !ready || messages.length === 0} className="ml-auto">
          <SquarePen />
          New chat
        </Button>
      </div>

      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 pt-8 pb-16">
          <h1 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">What do you want to know?</h1>
          <div className="w-full">{composer}</div>
          <div className="flex flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((s) => (
              <Button
                key={s}
                variant="outline"
                size="sm"
                className="rounded-full font-normal text-muted-foreground"
                disabled={noRepo || !ready}
                onClick={() => send(s)}
              >
                {s}
              </Button>
            ))}
          </div>
          <p className="text-center text-sm text-muted-foreground">
            {noRepo ? 'Generate docs for a repository once so it gets indexed, then ask here.' : 'Answers come from the indexed source of the repository.'}
          </p>
        </div>
      ) : (
        <>
          <h1 className="sr-only">Ask the repo</h1>
          <div className="flex-1 space-y-8 py-8">
            <MessageList messages={messages} />

            {/* Outside the message list's live region, so the ticking timer is never read out; the message is */}
            {pending && (
              <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <Loader2 className="size-4 shrink-0 motion-safe:animate-spin" />
                <span className="flex-1">{waitMessage(waited)}</span>
                <span className="tabular-nums" aria-hidden>
                  {clock(waited)}
                </span>
                <Button variant="ghost" size="sm" onClick={() => abort.current?.abort()}>
                  Stop waiting
                </Button>
              </div>
            )}

            {saveError && (
              <p role="alert" className="text-sm text-warning">
                {saveError}
              </p>
            )}

            {failed && (
              <div
                role={failed.cancelled ? 'status' : 'alert'}
                className={cn(
                  'flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border px-4 py-3 text-sm',
                  failed.cancelled ? 'text-muted-foreground' : 'border-destructive/30 bg-destructive/10 text-destructive',
                )}
              >
                <p className="min-w-0 flex-1 break-words">{failed.message}</p>
                <Button variant="outline" size="sm" onClick={() => send(failed.question, true)} disabled={noRepo}>
                  <RefreshCw />
                  Try again
                </Button>
              </div>
            )}
          </div>
          {/* scroll-margin keeps the newest message clear of the sticky composer */}
          <div ref={end} className="scroll-mb-40" />

          <div className="sticky bottom-0 bg-background pb-[max(1rem,env(safe-area-inset-bottom))]">
            {composer}
          </div>
        </>
      )}
    </div>
  )
}

// Memoized: typing a question re-renders Ask, but the chat itself only changes when a message is added
const MessageList = memo(function MessageList({ messages }: { messages: Message[] }) {
  return (
    <ol className="space-y-8" aria-live="polite">
      {messages.map((m, i) => (
        <li key={i} data-role={m.role}>
          {m.role === 'user' ? (
            <p className="ml-auto w-fit max-w-[85%] rounded-2xl bg-muted px-4 py-2.5 break-words whitespace-pre-wrap">
              <span className="sr-only">You: </span>
              {m.text}
            </p>
          ) : (
            <div className="space-y-3">
              <p className="sr-only">Answer:</p>
              <ZoomableArticle html={m.html} className={PROSE} />
              {m.sources.length > 0 && (
                <details className="group">
                  {/* 44px tall on phones, compact from sm, like the buttons */}
                  <summary className="-ml-2 inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-full px-3 py-1 text-xs text-muted-foreground transition-colors select-none hover:bg-muted hover:text-foreground sm:min-h-0 sm:px-2 [&::-webkit-details-marker]:hidden">
                    {m.sources.length} {m.sources.length === 1 ? 'source' : 'sources'}
                    <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
                  </summary>
                  <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Sources">
                    {m.sources.map((src, j) => (
                      <li
                        key={j}
                        className="flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground"
                      >
                        <FileCode className="size-3.5 shrink-0" />
                        <code className="truncate font-mono">{src}</code>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </li>
      ))}
    </ol>
  )
})

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

// sv-SE formats as YYYY-MM-DD HH:MM in local time
const localTime = (iso: string) => new Date(iso).toLocaleString('sv-SE').slice(0, 16)
const repoName = (url: string) => url.replace(/^https?:\/\/(www\.)?github\.com\//, '').replace(/\.git$/, '')

function History({
  generations,
  error,
  onRefresh,
  onOpen,
  running,
  unsaved,
  onSave,
  onGenerate,
}: {
  generations: Generation[] | null
  error: string
  onRefresh: () => Promise<void>
  onOpen: (g: Generation) => void
  running: boolean
  unsaved: boolean
  onSave: () => void
  onGenerate: () => void
}) {
  const [refreshing, setRefreshing] = useState(false)
  const [opening, setOpening] = useState('')
  const [openError, setOpenError] = useState('')

  async function open(id: string) {
    setOpening(id)
    setOpenError('')
    try {
      onOpen(await loadGeneration(id))
    } catch (e) {
      setOpenError(`Could not open these docs: ${(e as Error).message}`)
    } finally {
      setOpening('')
    }
  }

  return (
    <>
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">History</h1>
          <p className="text-sm text-muted-foreground">Your 20 most recent docs. Only you can see them.</p>
        </div>
        <Button variant="outline" size="sm" onClick={async () => { setRefreshing(true); await onRefresh(); setRefreshing(false) }}
          disabled={refreshing} aria-label="Refresh" className="shrink-0">
          <RefreshCw className={cn(refreshing && 'motion-safe:animate-spin')} />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>

      {/* The docs are on screen, so this is where losing them means something */}
      {unsaved && !!generations?.length && (
        <div className="flex flex-col gap-3 rounded-2xl border bg-muted/40 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
          <CloudOff className="hidden size-5 shrink-0 text-muted-foreground sm:block" aria-hidden />
          <p className="flex-1 text-sm">
            <span className="font-medium">Only this browser has these docs.</span>{' '}
            <span className="text-muted-foreground">Clearing its data or switching devices loses them.</span>
          </p>
          <Button size="sm" onClick={onSave} className="self-start sm:self-auto">
            <CloudUpload />
            Save history
          </Button>
        </div>
      )}

      {openError && (
        <p className="text-sm text-destructive" role="alert">
          {openError}
        </p>
      )}

      <Card className="overflow-hidden py-0">
        {error ? (
          <p className="px-6 py-10 text-center text-sm text-destructive" role="alert">{error}</p>
        ) : generations === null ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : generations.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <FileText className="size-6 text-muted-foreground" aria-hidden />
            <p className="font-medium">No docs yet</p>
            <p className="max-w-xs text-sm text-muted-foreground">Docs you generate show up here, ready to open again.</p>
            <Button size="sm" className="mt-2" onClick={onGenerate}>
              Generate docs
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="pl-4">Repository</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Created</TableHead>
                <TableHead className="pr-4">
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {generations.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="pl-4 font-medium">
                    <span className="block max-w-[11rem] truncate sm:max-w-xs" title={g.repo}>
                      {repoName(g.repo)}
                    </span>
                    <span className="block text-xs font-normal tabular-nums text-muted-foreground sm:hidden">{localTime(g.createdAt)}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn('capitalize', TONE[STATUS_TONE[g.status] ?? 'neutral'])}>
                      {g.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden tabular-nums text-muted-foreground sm:table-cell">{localTime(g.createdAt)}</TableCell>
                  <TableCell className="pr-4 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => open(g.id)}
                      disabled={!!opening || running}
                      title={running ? 'Available when the current run finishes' : undefined}
                      aria-label={`Open docs for ${repoName(g.repo)}`}
                    >
                      {opening === g.id && <Loader2 className="animate-spin" />}
                      Open
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  )
}
