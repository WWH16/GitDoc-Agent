import { ArrowRight, ArrowUp, Check, ChevronUp, Circle, Copy, Download, FileCode, FileText, Loader2, RotateCcw } from 'lucide-react'
import { Fragment, StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { GitHubIcon } from '@/components/github-icon'
import { Logo } from '@/components/logo'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { STEPS, URL_PLACEHOLDER } from './api'
import './landing.css'

// Everything here is true of the product today: no testimonials, numbers or pricing (see PRODUCT.md).
const REPO_URL = 'https://github.com/WWH16/GitDoc-Agent'
const APP_URL = '/app/'
const CONTAINER = 'mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8'
const SECTION = 'scroll-mt-16 border-t py-20 sm:py-28'
const H2 = 'font-display text-3xl font-semibold tracking-[-0.025em] text-balance sm:text-4xl'
const LEAD = 'mt-4 max-w-xl text-lg text-pretty text-muted-foreground'
// Mock-ups are decorative copies of the real app UI: hidden from screen readers and skipped by the keyboard
const MOCK =
  'min-w-0 rounded-2xl border bg-card text-card-foreground shadow-[0_24px_64px_-28px_rgb(0_0_0/0.3)] dark:shadow-[0_24px_64px_-28px_rgb(0_0_0/0.9)]'
const CODE = 'rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.85em]'
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches

function Landing() {
  return (
    <>
      <a
        href="#main"
        className="sr-only rounded-full bg-background px-4 py-2 text-sm shadow focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
      >
        Skip to content
      </a>
      <Header />
      <main id="main">
        <Hero />
        <HowItWorks />
        <Features />
        <UnderTheHood />
        <RunLocally />
        <FinalCta />
      </main>
      <Footer />
    </>
  )
}

const NAV = [
  ['How it works', '#how'],
  ['Features', '#features'],
  ['Run it locally', '#run'],
] as const

function Header() {
  return (
    <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
      <div className={cn(CONTAINER, 'flex h-16 items-center gap-8')}>
        <a href="#top" className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <Logo />
        </a>
        <nav aria-label="Page sections" className="hidden gap-6 text-sm md:flex">
          {NAV.map(([label, href]) => (
            <a key={href} href={href} className="text-muted-foreground transition-colors hover:text-foreground">
              {label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <a href={REPO_URL} aria-label="GitDoc Agent on GitHub" className={buttonVariants({ variant: 'ghost', size: 'icon' })}>
            <GitHubIcon className="size-5" />
          </a>
          <a href={APP_URL} className={buttonVariants()}>
            Open the app
          </a>
        </div>
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section id="top" className="relative isolate overflow-hidden">
      {/* Faint grid of commit dots behind the demo */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(var(--border)_1.5px,transparent_1.5px)] bg-[size:22px_22px] [mask-image:radial-gradient(ellipse_60%_70%_at_75%_45%,black,transparent)]"
      />
      <div className={cn(CONTAINER, 'grid items-center gap-14 pt-14 pb-24 sm:pt-20 lg:grid-cols-[1fr_1.05fr] lg:gap-12 lg:pt-24 lg:pb-32')}>
        <div>
          <h1 className="font-display text-5xl leading-[1.02] font-semibold tracking-[-0.035em] text-balance sm:text-6xl lg:text-7xl">
            Paste a repo. Get its docs<span className="text-brand">.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-pretty text-muted-foreground sm:text-xl">
            GitDoc Agent reads a GitHub repository, writes its documentation with diagrams, and answers your questions about the
            code, showing the files each answer came from.
          </p>
          {/* Plain GET form: the app reads ?repo= and fills in the field */}
          <form action={APP_URL} method="get" className="mt-10 max-w-xl space-y-2">
            <label htmlFor="hero-repo" className="block text-sm font-medium">
              Repository URL
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <GitHubIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="hero-repo" name="repo" type="url" required placeholder={URL_PLACEHOLDER} className="pl-9" />
              </div>
              <Button type="submit">
                Generate docs
                <ArrowRight />
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">Opens the app with this repository filled in. Works with public repositories.</p>
          </form>
        </div>
        <HeroDemo />
      </div>
    </section>
  )
}

// The workflow's real n8n nodes, in order
const NODES = ['Valid GitHub URL?', 'Group Files', 'Repository Analysis Agent', 'Combine Diagrams', 'Return Documentation']
// How long each node "runs" in the demo, in ms; the agent step takes longest, as in a real run
const NODE_MS = [900, 1100, 2200, 1300, 900]

// Replays a run the way the Generate tab shows it. With reduced motion it starts on the finished state.
function HeroDemo() {
  const [done, setDone] = useState(REDUCED_MOTION ? NODES.length : 0)
  const finished = done === NODES.length
  const step = Math.min(done, STEPS.length - 1)

  useEffect(() => {
    if (finished) return
    const id = setTimeout(() => setDone((d) => d + 1), NODE_MS[done])
    return () => clearTimeout(id)
  }, [done, finished])

  return (
    // min-w-0 lets the grid column shrink below the mock's natural width on phones
    <div className="relative min-w-0">
      <div aria-hidden inert className={cn(MOCK, 'overflow-hidden')}>
        <div className="flex h-12 items-center justify-between gap-3 border-b px-4">
          <Logo />
          <div className="flex rounded-full bg-muted p-[3px] text-xs font-medium text-muted-foreground">
            <span className="rounded-full bg-background px-2.5 py-1 text-foreground shadow-xs dark:bg-input/30">Generate</span>
            <span className="px-2.5 py-1">Ask</span>
            <span className="px-2.5 py-1">Run history</span>
          </div>
        </div>
        <div className="space-y-4 p-4 sm:p-5">
          <div className="flex gap-2">
            <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full border px-3 text-sm">
              <GitHubIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{REPO_URL}</span>
            </div>
            <span className={cn(buttonVariants({ size: 'sm' }), 'h-9 sm:h-9', !finished && 'opacity-50')}>
              {!finished && <Loader2 className="animate-spin" />}
              {finished ? 'Generate' : 'Generating…'}
            </span>
          </div>
          <div className="space-y-3 rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold">Run</span>
              <Badge
                variant="outline"
                className={finished ? 'border-success/30 bg-success/10 text-success' : 'border-warning/30 bg-warning/10 text-warning'}
              >
                {finished ? 'success' : 'running'}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {finished ? 'Complete' : `Step ${step + 1} of ${STEPS.length}: ${STEPS[step][0]}`}
            </p>
            <Progress value={(done / NODES.length) * 100} />
            <ol className="divide-y rounded-lg border text-sm">
              {NODES.map((name, i) => (
                <li key={name} className={cn('flex items-center gap-3 px-3 py-2 transition-opacity', i > done && 'opacity-40')}>
                  {i < done ? (
                    <Check className="size-4 shrink-0 text-success" />
                  ) : i === done ? (
                    <Loader2 className="size-4 shrink-0 animate-spin text-warning" />
                  ) : (
                    <Circle className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className={cn('truncate font-mono', i === done && 'font-medium')}>{name}</span>
                  {i === done && <span className="ml-auto shrink-0 text-muted-foreground">running…</span>}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      {/* The finished DOCUMENTATION.md slides in over the corner */}
      <div
        aria-hidden
        className={cn(
          MOCK,
          'absolute -right-3 -bottom-14 hidden w-72 p-4 transition duration-500 ease-out sm:block lg:-right-8',
          finished ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
        )}
      >
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <FileText className="size-4" />
          DOCUMENTATION.md
          <span className="ml-auto size-2 rounded-full bg-brand" />
        </div>
        <p className="mt-3 text-lg font-semibold tracking-tight">GitDoc Agent</p>
        <p className="mt-1 text-xs text-muted-foreground">A web app for an n8n workflow that documents GitHub repositories.</p>
        <Flow className="mt-3 text-[11px]" />
      </div>

      {/* Always rendered so the page doesn't shift when it appears */}
      {!REDUCED_MOTION && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDone(0)}
          disabled={!finished}
          className={cn('mt-3 text-muted-foreground', !finished && 'invisible')}
        >
          <RotateCcw />
          Replay
        </Button>
      )}
    </div>
  )
}

const FLOW = ['Browser', 'Vite dev proxy', 'n8n workflow', 'Gemini + Pinecone']

function Flow({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5 font-mono', className)}>
      {FLOW.map((box, i) => (
        <Fragment key={box}>
          {i > 0 && <ArrowRight className="size-3 shrink-0 text-muted-foreground" />}
          <span className="rounded-md border bg-background px-2 py-1">{box}</span>
        </Fragment>
      ))}
    </div>
  )
}

const STEP_NOTES = [
  'Makes sure the link is a GitHub repository the workflow can read.',
  'Fetches the code and groups the files for the agent.',
  'The Repository Analysis Agent reads the code and writes the docs.',
  'Diagrams are drawn and combined into the document.',
  'The finished Markdown comes back to the app.',
]

// Drawn like a git graph: commits on one line, then a branch, as in the logo
const GRAPH_LINE = 'absolute left-[11px] w-0.5 bg-muted-foreground/40'

function HowItWorks() {
  return (
    <section id="how" className={SECTION}>
      <div className={cn(CONTAINER, 'grid gap-12 lg:grid-cols-[1fr_1.15fr] lg:gap-16')}>
        <div className="lg:sticky lg:top-28 lg:self-start">
          <h2 className={H2}>One repository in, two things out</h2>
          <p className={LEAD}>
            Every run goes through the same five steps in an n8n workflow. It usually takes a few minutes, and the app shows which
            step is running the whole time.
          </p>
        </div>
        <div>
          <ol className="relative">
            <span aria-hidden className={cn(GRAPH_LINE, 'top-3 bottom-0')} />
            {STEPS.map(([label], i) => (
              <li key={label} className="relative pb-9 pl-11">
                <span aria-hidden className="absolute top-0.5 left-0 size-6 rounded-full border-[3px] border-foreground bg-background" />
                <h3 className="font-display text-lg font-semibold">{label}</h3>
                <p className="mt-1 text-muted-foreground">{STEP_NOTES[i]}</p>
              </li>
            ))}
          </ol>
          {/* Docs return first, then the Ask indexing branch runs */}
          <div className="relative grid gap-8 sm:grid-cols-2 sm:gap-6">
            <span aria-hidden className={cn(GRAPH_LINE, 'top-0 bottom-8 sm:hidden')} />
            <span
              aria-hidden
              className="absolute -top-6 left-[11px] hidden h-[26px] w-[calc(50%+0.75rem+2px)] rounded-tr-xl border-t-2 border-r-2 border-muted-foreground/40 sm:block"
            />
            <Output name="DOCUMENTATION.md" text="Preview it in the app, then download it." />
            <Output name="Ask index" text="The source goes into Pinecone, so Ask can answer questions about it." />
          </div>
        </div>
      </div>
    </section>
  )
}

// Orange marks the agent's work, as the orange commit does in the logo
function Output({ name, text }: { name: string; text: string }) {
  return (
    <div className="relative pl-11">
      <span aria-hidden className="absolute top-0 left-0 size-6 rounded-full bg-brand" />
      <h3 className="font-mono text-base font-semibold">{name}</h3>
      <p className="mt-1 text-muted-foreground">{text}</p>
    </div>
  )
}

function Features() {
  return (
    <section id="features" className={SECTION}>
      <div className={cn(CONTAINER, 'space-y-24 sm:space-y-32')}>
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <h2 className={H2}>Docs you can read, with diagrams</h2>
            <p className={LEAD}>
              The agent writes a Markdown document from the code and draws diagrams into it. Preview it in the browser, then download
              it as <code className={CODE}>DOCUMENTATION.md</code>.
            </p>
          </div>
          <DocsMock />
        </div>
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="lg:order-2">
            <h2 className={H2}>Ask, and see where the answer came from</h2>
            <p className={LEAD}>
              After a run, the repository's source is indexed. Ask about it in plain language and follow up in the same chat. Each
              answer lists the files it used, so you can check it.
            </p>
          </div>
          <AskMock />
        </div>
      </div>
    </section>
  )
}

const TREE = `src/
├─ App.tsx        Generate, Ask and Run history
├─ api.ts         calls to the n8n workflow
└─ components/    shared UI
vite.config.ts    dev proxy that adds the n8n keys`

function DocsMock() {
  return (
    <div aria-hidden inert className={MOCK}>
      <div className="flex items-center gap-3 border-b px-5 py-4">
        <div className="min-w-0">
          <p className="font-semibold">Documentation</p>
          <p className="truncate text-sm text-muted-foreground">Preview of the generated DOCUMENTATION.md</p>
        </div>
        <span className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'ml-auto h-8 sm:h-8')}>
          <Download />
          Download .md
        </span>
      </div>
      <div className="space-y-4 p-5 text-sm">
        <p className="text-2xl font-semibold tracking-tight">GitDoc Agent</p>
        <p className="text-muted-foreground">
          A React web app for an n8n workflow that turns a GitHub repository into documentation and answers questions about its
          code.
        </p>
        <p className="pt-1 text-lg font-semibold tracking-tight">How a request flows</p>
        <Flow className="text-xs" />
        <p className="pt-1 text-lg font-semibold tracking-tight">Project structure</p>
        <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs leading-relaxed">{TREE}</pre>
      </div>
    </div>
  )
}

function AskMock() {
  return (
    <div aria-hidden inert className={cn(MOCK, 'space-y-6 p-5 text-sm sm:p-6')}>
      <p className="ml-auto w-fit max-w-[85%] rounded-2xl bg-muted px-4 py-2.5">Where are the n8n keys added to requests?</p>
      <div className="space-y-3">
        <p className="leading-relaxed">
          In the Vite dev proxy. <code className={CODE}>vite.config.ts</code> reads <code className={CODE}>N8N_WEBHOOK_TOKEN</code>{' '}
          and <code className={CODE}>N8N_API_KEY</code> from <code className={CODE}>.env</code> and adds them as headers on the{' '}
          <code className={CODE}>/api</code> routes, so the browser never sees them.
        </p>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          2 sources
          <ChevronUp className="size-3.5" />
        </p>
        <ul className="flex flex-wrap gap-1.5">
          {['vite.config.ts', 'src/api.ts'].map((src) => (
            <li key={src} className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground">
              <FileCode className="size-3.5" />
              <code className="font-mono">{src}</code>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex items-center gap-2 rounded-2xl border p-2 pl-4 shadow-xs">
        <span className="flex-1 text-muted-foreground">Ask anything about the code</span>
        <span className="grid size-9 place-items-center rounded-full bg-primary text-primary-foreground opacity-50">
          <ArrowUp className="size-4" />
        </span>
      </div>
    </div>
  )
}

const STACK = [
  ['n8n', 'Runs the workflow and saves each step, so the app can show live progress.'],
  ['Gemini', 'The model behind the agent that writes the docs and answers questions.'],
  ['Pinecone', 'Holds the indexed source code that Ask searches.'],
  ['Vite dev proxy', 'Adds your n8n keys to each request, so they never reach the browser.'],
] as const

function UnderTheHood() {
  return (
    <section className={SECTION}>
      <div className={cn(CONTAINER, 'grid gap-12 lg:grid-cols-[1fr_1.4fr] lg:gap-16')}>
        <div>
          <h2 className={H2}>An AI agent inside an n8n workflow</h2>
          <p className={LEAD}>The workflow does the work. The web app starts runs, shows their progress and hosts the chat.</p>
        </div>
        <dl className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
          {STACK.map(([name, text]) => (
            <div key={name} className="border-t pt-4">
              <dt className="font-medium">{name}</dt>
              <dd className="mt-1 text-muted-foreground">{text}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}

function RunLocally() {
  return (
    <section id="run" className={SECTION}>
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
        <h2 className={H2}>Run it locally</h2>
        <p className={LEAD}>GitDoc Agent isn't hosted yet. It runs on your machine, next to n8n.</p>
        <ol className="mt-12 space-y-10">
          <li>
            <h3 className="font-display text-lg font-semibold">1. Clone and install</h3>
            <CodeBlock code={`git clone ${REPO_URL}.git\ncd GitDoc-Agent\nnpm install`} />
          </li>
          <li>
            <h3 className="font-display text-lg font-semibold">2. Add your n8n keys</h3>
            <p className="mt-1 text-muted-foreground">
              Create a <code className={CODE}>.env</code> file in the project folder.
            </p>
            <CodeBlock code={'N8N_WEBHOOK_TOKEN=your-webhook-token\nN8N_API_KEY=your-n8n-api-key'} />
          </li>
          <li>
            <h3 className="font-display text-lg font-semibold">3. Start the app</h3>
            <CodeBlock code="npm run dev" />
            <p className="mt-3 text-muted-foreground">
              Then open <code className={CODE}>http://localhost:5173/app/</code>. n8n must be running on port 5678 with the GitDoc Agent
              workflow. For live step progress, turn on <span className="font-medium text-foreground">Save execution progress</span> in
              the workflow's settings.
            </p>
          </li>
        </ol>
      </div>
    </section>
  )
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)

  return (
    // The button sits beside the scrolling code, so long lines never run under it
    <div className="mt-3 flex items-start rounded-xl border bg-muted/50">
      <pre className="min-w-0 flex-1 overflow-x-auto p-4 font-mono text-sm leading-relaxed">
        <code>{code}</code>
      </pre>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Copy to clipboard"
        className="m-1.5"
        // Where the clipboard is blocked, select the text instead so Ctrl+C still works
        onClick={(e) => {
          const pre = e.currentTarget.previousElementSibling!
          navigator.clipboard
            .writeText(code)
            .then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            })
            .catch(() => getSelection()?.selectAllChildren(pre))
        }}
      >
        {copied ? <Check className="text-success" /> : <Copy />}
      </Button>
      <span aria-live="polite" className="sr-only">
        {copied ? 'Copied' : ''}
      </span>
    </div>
  )
}

function FinalCta() {
  return (
    <section className={cn(CONTAINER, 'pb-20 sm:pb-28')}>
      <div className="flex flex-col items-start gap-8 rounded-3xl border bg-card p-8 sm:p-12 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className={H2}>Document your next repository</h2>
          <p className="mt-3 text-lg text-muted-foreground">Paste a URL and let the agent write the first draft.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <a href={APP_URL} className={buttonVariants({ size: 'lg' })}>
            Open the app
            <ArrowRight />
          </a>
          <a href={REPO_URL} className={buttonVariants({ variant: 'outline', size: 'lg' })}>
            <GitHubIcon className="size-4" />
            View on GitHub
          </a>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t">
      <div className={cn(CONTAINER, 'flex flex-col gap-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between')}>
        <span className="text-foreground">
          <Logo />
        </span>
        <p>Not affiliated with or endorsed by GitHub.</p>
        <a href={REPO_URL} className="transition-colors hover:text-foreground">
          Source on GitHub
        </a>
      </div>
    </footer>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Landing />
  </StrictMode>,
)
