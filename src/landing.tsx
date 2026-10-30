import { Check, Copy } from 'lucide-react'
import { StrictMode, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { GitHubIcon } from '@/components/github-icon'
import { Logo } from '@/components/logo'
import { ThemeToggle, useDark } from '@/components/theme-toggle'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { STEPS, URL_PLACEHOLDER } from './api'
import './landing.css'

// Everything here is true of the product today: no testimonials, numbers or pricing (see PRODUCT.md).
// The screenshots are the running app documenting this very repository (public/landing).
const REPO_URL = 'https://github.com/WWH16/GitDoc-Agent'
const APP_URL = '/app/'
const LEAD = 'max-w-[52ch] text-lead leading-[1.45] text-pretty text-muted-foreground'
const CODE = 'rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.85em]'
const QUICK = 'duration-200 ease-out-quart motion-reduce:transition-none'

const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)')

// A media query's live answer: resizing or switching the OS setting re-renders at once
function useMedia(m: MediaQueryList) {
  return useSyncExternalStore(
    (onChange) => (m.addEventListener('change', onChange), () => m.removeEventListener('change', onChange)),
    () => m.matches,
  )
}

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
        <AskSection />
        <Private />
        <Cache />
        <Limits />
        <RunIt />
      </main>
      <Footer />
    </>
  )
}

const NAV = [
  ['How it works', '#how'],
  ['Limits', '#limits'],
  ['Run it', '#run'],
] as const

// A slab: one solid full-width bar in the other theme's palette (index.css), the same bar as the app's header
function Header() {
  return (
    <header className="slab sticky top-0 z-20 bg-background text-foreground">
      <div className="container flex h-16 items-center gap-8">
        <a href="#top" aria-label="GitDoc Agent, back to top" className="rounded-md">
          <Logo />
        </a>
        <nav aria-label="Page sections" className="hidden gap-6 text-sm md:flex">
          {NAV.map(([label, href]) => (
            <a key={href} href={href} className={cn('rounded-sm text-foreground/75 transition-colors hover:text-foreground', QUICK)}>
              {label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <a
            href={REPO_URL}
            aria-label="GitDoc Agent on GitHub"
            className={buttonVariants({ variant: 'ghost', size: 'icon' })}
          >
            <GitHubIcon className="size-5" />
          </a>
          <ThemeToggle />
          <a href={APP_URL} className={cn(buttonVariants(), 'active:translate-y-px')}>
            Open the app
          </a>
        </div>
      </div>
    </header>
  )
}

// Pixel sizes of the 2x captures in public/landing: a 1440 x 900 screen, a 390 x 844 phone
const SCREEN = [2880, 1800] as const
const PHONE_SIZE = [780, 1688] as const

/** A whole screenshot of the running app, never cropped or zoomed. Below 40rem the browser swaps in the `phone`
 *  capture itself (<picture>), live as the window resizes. */
function Shot({
  name,
  alt,
  size = SCREEN,
  phone,
  priority = false,
  className,
}: {
  name: string
  alt: string
  size?: readonly [number, number]
  phone?: string
  priority?: boolean
  className?: string
}) {
  // The captures follow the theme: toggling it swaps in the matching set
  const dark = useDark()
  const src = (file: string) => `/landing/${file}-${dark ? 'dark' : 'light'}.webp`
  return (
    <figure className={cn('shot', className)}>
      <picture>
        {phone && <source media="(max-width: 40rem)" srcSet={src(phone)} width={PHONE_SIZE[0]} height={PHONE_SIZE[1]} />}
        <img
          src={src(name)}
          alt={alt}
          width={size[0]}
          height={size[1]}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
        />
      </picture>
    </figure>
  )
}

// Stage: the head beside the whole Generate screen, centred in the first screen
function Hero() {
  return (
    <section id="top" className="pt-16 pb-[var(--section-gap-s)] lg:flex lg:min-h-[calc(100dvh-4rem)] lg:items-center lg:py-16">
      <div className="container grid items-center gap-x-16 gap-y-12 lg:grid-cols-[11fr_13fr]">
        <div className="min-w-0">
          {/* One sentence a line: each stays whole at every width from 320px */}
          <h1>
            <span className="block sm:whitespace-nowrap">Paste a repo.</span>
            <span className="block sm:whitespace-nowrap">
              Get its docs<span className="text-brand">.</span>
            </span>
          </h1>
          <p className={cn(LEAD, 'mt-6')}>Readable docs with diagrams, then answers about the code, with sources.</p>
          {/* Plain GET form: the app reads ?repo= and fills in the field */}
          <form action={APP_URL} method="get" className="mt-10 max-w-xl space-y-2">
            <label htmlFor="hero-repo" className="block text-sm font-medium">
              Repository URL
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <GitHubIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="hero-repo"
                  name="repo"
                  type="url"
                  required
                  placeholder={URL_PLACEHOLDER}
                  className="h-12 border-muted-foreground pl-9 sm:h-12"
                />
              </div>
              <Button type="submit" className="h-12 px-6 active:translate-y-px sm:h-12">
                Generate docs
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">Opens the app with this repository filled in. No account needed.</p>
          </form>
        </div>
        <Shot
          name="generate"
          alt="The documentation GitDoc Agent wrote for its own repository, fresh from a run"
          phone="generate-phone"
          priority
          className="min-w-0"
        />
      </div>
    </section>
  )
}

// The run drawn as a git graph, as in the logo: five commits in a line, then a branch into the two things a run makes.
// Scrolling fills the line at the speed you scroll; stop and it carries on by itself. Reduced motion shows it filled.
const NOTES = [
  'Checks it is a public GitHub repo.',
  'Fetches and groups the files.',
  'The agent writes the docs.',
  'Diagrams go into the document.',
  'The Markdown comes back.',
]
const TRACK = 'bg-muted-foreground/25'
const STEP_MS = 700
const IDLE_MS = 400
const FOLLOW_MS = 120
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

function HowItWorks() {
  const reduced = useMedia(REDUCED_MOTION)
  const graph = useRef<HTMLDivElement>(null)
  const fills = useRef<(HTMLSpanElement | null)[]>([])
  const [progress, setProgress] = useState(0)
  const done = reduced ? STEPS.length : progress
  const finished = done === STEPS.length

  // One rAF loop while the graph is on screen; each fill's --fill is written straight to the DOM every frame
  useEffect(() => {
    if (reduced) return
    const N = STEPS.length
    const el = graph.current!
    let p = 0
    let auto = 0
    let lastScroll = -Infinity
    let last = 0
    let raf = 0
    const scrollTarget = () => {
      const r = el.getBoundingClientRect()
      const start = innerHeight * 0.85
      const end = innerHeight * 0.6
      return clamp01((start - r.top) / (start - end + r.height)) * N
    }
    const frame = (now: number) => {
      const dt = last ? Math.min(now - last, 100) : 16
      last = now
      if (now - lastScroll > IDLE_MS) auto = Math.max(auto, p) + dt / STEP_MS
      const goal = Math.min(N, Math.max(p, scrollTarget(), auto))
      p = goal - p < 0.001 ? goal : p + (goal - p) * (1 - Math.exp(-dt / FOLLOW_MS))
      fills.current.forEach((f, i) => f?.style.setProperty('--fill', String(clamp01(p - i))))
      setProgress(Math.floor(p + 1e-6))
      raf = p < N ? requestAnimationFrame(frame) : 0
    }
    const onScroll = () => (lastScroll = performance.now())
    const io = new IntersectionObserver(([e]) => {
      cancelAnimationFrame(raf)
      last = 0
      if (e.isIntersecting && p < N) raf = requestAnimationFrame(frame)
    })
    io.observe(el)
    addEventListener('scroll', onScroll, { passive: true })
    return () => {
      io.disconnect()
      cancelAnimationFrame(raf)
      removeEventListener('scroll', onScroll)
    }
  }, [reduced])

  const line = (on: boolean) => (on ? 'bg-foreground' : TRACK)

  return (
    <section id="how" className="scroll-mt-16 border-t py-[var(--section-gap)]">
      <div className="container">
        <div className="max-w-3xl">
          <h2>What happens when I paste a repo?</h2>
          <p className={cn(LEAD, 'mt-5')}>
            An AI agent in one n8n workflow: five steps, then a branch.
          </p>
        </div>

        <div ref={graph} className="mt-16">
          <ol className="grid lg:grid-cols-5 lg:gap-x-8">
            {STEPS.map(([label], i) => (
              <li key={label} className="relative pb-9 pl-11 lg:pt-11 lg:pb-0">
                {/* Down to the next commit on phones, across on wide screens; the last one runs on into the branch */}
                <span
                  aria-hidden
                  className={cn(
                    'absolute top-6 -bottom-0.5 left-[11px] w-0.5',
                    TRACK,
                    i < STEPS.length - 1
                      ? 'lg:top-[11px] lg:right-[-2rem] lg:bottom-auto lg:left-6 lg:h-0.5 lg:w-auto'
                      : 'lg:bottom-0',
                  )}
                >
                  <span
                    ref={(f) => {
                      fills.current[i] = f
                    }}
                    style={{ '--fill': reduced ? 1 : 0 } as CSSProperties}
                    className={cn(
                      'block size-full origin-top bg-foreground [transform:scaleY(var(--fill))]',
                      i < STEPS.length - 1 && 'lg:origin-left lg:[transform:scaleX(var(--fill))]',
                    )}
                  />
                </span>
                <span
                  aria-hidden
                  className={cn(
                    'absolute top-0.5 left-0 grid size-6 place-items-center rounded-full border-[3px] transition-[background-color,border-color,box-shadow] lg:top-0',
                    QUICK,
                    i < done
                      ? 'border-foreground bg-foreground text-background'
                      : i === done
                        ? 'border-foreground bg-background ring-4 ring-foreground/10'
                        : 'border-muted-foreground/40 bg-background',
                  )}
                >
                  {i < done && <Check strokeWidth={3} className="size-3.5" />}
                </span>
                <h3 className={cn('transition-colors lg:text-xl', QUICK, i > done && 'text-muted-foreground')}>{label}</h3>
                <p className="mt-2 text-muted-foreground">{NOTES[i]}</p>
              </li>
            ))}
          </ol>

          {/* The branch: under the last commit on wide screens, after the line on phones */}
          <div className="relative grid gap-8 sm:grid-cols-2 sm:gap-6 lg:mt-16 lg:grid-cols-5 lg:gap-x-8">
            <span aria-hidden className={cn('absolute top-0 bottom-8 left-[11px] w-0.5 transition-colors sm:hidden', QUICK, line(finished))} />
            <span
              aria-hidden
              className={cn(
                'absolute -top-6 left-[11px] hidden h-[26px] w-[calc(50%+0.75rem+2px)] rounded-tr-xl border-t-2 border-r-2 transition-colors sm:block lg:hidden',
                QUICK,
                finished ? 'border-foreground' : 'border-muted-foreground/25',
              )}
            />
            <Output
              on={finished}
              name="Ask index"
              text="Gemini embeds the code into Supabase for Ask."
              className="lg:col-start-4"
              connector={
                <span
                  aria-hidden
                  className={cn(
                    'absolute top-[-2rem] left-[11px] hidden h-[34px] w-[calc(100%+2rem)] rounded-tl-xl border-t-2 border-l-2 transition-colors lg:block',
                    QUICK,
                    finished ? 'border-foreground' : 'border-muted-foreground/25',
                  )}
                />
              }
            />
            <Output
              on={finished}
              name="DOCUMENTATION.md"
              text="Preview it, then download it."
              className="lg:col-start-5"
              connector={
                <span
                  aria-hidden
                  className={cn('absolute -top-16 left-[11px] hidden h-16 w-0.5 transition-colors lg:block', QUICK, line(finished))}
                />
              }
            />
          </div>
        </div>
      </div>
    </section>
  )
}

// Orange marks the agent's work, as the orange commit does in the logo
function Output({ on, name, text, className, connector }: { on: boolean; name: string; text: string; className?: string; connector: ReactNode }) {
  return (
    <div className={cn('relative pl-11 lg:pt-11', className)}>
      {connector}
      <span
        aria-hidden
        className={cn(
          'absolute top-0 left-0 size-6 rounded-full border-[3px] transition-[background-color,border-color,scale]',
          QUICK,
          on ? 'scale-100 border-brand bg-brand' : 'scale-75 border-muted-foreground/40 bg-background',
        )}
      />
      <h3 className={cn('font-mono text-base font-semibold tracking-normal transition-colors', QUICK, !on && 'text-muted-foreground')}>{name}</h3>
      <p className="mt-2 text-muted-foreground">{text}</p>
    </div>
  )
}

// Showcase: the head, then the Ask tab across the whole width
function AskSection() {
  return (
    <section className="border-t py-[var(--section-gap-l)]">
      <div className="container">
        <div className="max-w-3xl">
          <h2>Can I ask about the code?</h2>
          <p className={cn(LEAD, 'mt-5')}>Yes. Each answer lists the files it came from, so you can check it.</p>
        </div>
        <Shot
          name="ask"
          alt="The Ask tab answering where the n8n keys are added to requests, with vite.config.ts as its source"
          phone="ask-phone"
          className="mt-16"
        />
      </div>
    </section>
  )
}

// Split, the picture on the left this once
function Private() {
  return (
    <section className="border-t py-[var(--section-gap)]">
      <div className="container grid items-center gap-x-16 gap-y-10 lg:grid-cols-[6fr_6fr]">
        <Shot
          name="signup"
          alt="The Create an account dialog, offering to keep this browser's one doc on any device"
          size={[832, 624]}
          className="mx-auto w-full max-w-[34rem] min-w-0"
        />
        <div className="min-w-0">
          <h2>Who can see my docs?</h2>
          <p className={cn(LEAD, 'mt-5')}>Only you. You start without an account, and this browser keeps your docs and chats.</p>
          <p className="mt-4 max-w-[52ch] text-muted-foreground">
            Sign up with an email to open them on any device.{' '}
            <a href={APP_URL} className="font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground">
              Open the app
            </a>
          </p>
        </div>
      </div>
    </section>
  )
}

// Statement: the answer set large
function Cache() {
  return (
    <section className="border-t py-[var(--section-gap-s)]">
      <div className="container">
        <h2 className="text-title tracking-[-0.015em] text-muted-foreground">Does the same repo run twice?</h2>
        <p className="mt-6 max-w-[24ch] font-display text-display-s leading-[1.08] font-semibold tracking-[-0.03em] text-balance">
          No. If its code has not changed, the docs come back at once.
        </p>
        <p className="mt-6 text-muted-foreground">Press Regenerate when you want a fresh run.</p>
      </div>
    </section>
  )
}

const LIMITS = [
  ['Repositories', 'Public GitHub repositories.'],
  ['Generate', '5 runs an hour and 15 a day, for each account.'],
  ['Ask', '30 questions an hour, for each account.'],
  ['Waiting', 'A run usually takes a few minutes; an answer, up to two.'],
  ['Hosting', 'Not hosted yet. It runs on your machine, next to n8n.'],
] as const

// Rows: the head beside a table of plain facts (the limits are the ones the API enforces, server/guard.ts)
function Limits() {
  return (
    <section id="limits" className="scroll-mt-16 border-t py-[var(--section-gap)]">
      <div className="container grid gap-x-8 gap-y-10 lg:grid-cols-12">
        <h2 className="lg:col-span-4">How many runs do I get?</h2>
        <dl className="lg:col-span-8">
          {LIMITS.map(([term, detail]) => (
            <div key={term} className="grid gap-1 border-t py-6 first:border-t-0 first:pt-0 sm:grid-cols-[12rem_1fr] sm:gap-8">
              <dt className="font-display text-title font-semibold tracking-[-0.015em]">{term}</dt>
              <dd className="text-lead text-muted-foreground">{detail}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}

const RUN_STEPS: { title: string; note: ReactNode; code: string }[] = [
  { title: 'Clone and install', note: null, code: `git clone ${REPO_URL}.git\ncd GitDoc-Agent\nnpm install` },
  {
    title: 'Add your keys',
    note: (
      <>
        In a <code className={CODE}>.env</code> file in the project folder. The secret key never gets a{' '}
        <code className={CODE}>VITE_</code> prefix.
      </>
    ),
    code:
      'N8N_WEBHOOK_TOKEN=your-webhook-token\nN8N_API_KEY=your-n8n-api-key\nVITE_SUPABASE_URL=https://your-project.supabase.co\nVITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...\nSUPABASE_SERVICE_ROLE_KEY=sb_secret_...',
  },
  {
    title: 'Set up Supabase',
    note: 'Run both files in the SQL Editor, then turn on anonymous sign-ins under Authentication.',
    code: 'docs/supabase-setup.sql\ndocs/supabase-app.sql',
  },
  {
    title: 'Start it',
    note: (
      <>
        Then open <code className={CODE}>localhost:5173/app/</code>. n8n runs on port 5678 with the GitDoc Agent workflows; turn
        on <span className="font-medium text-foreground">Save execution progress</span> for live steps.
      </>
    ),
    code: 'npm run dev',
  },
]

// Rows again, each step's command beside it: the page closes on the thing a developer does next
function RunIt() {
  return (
    <section id="run" className="scroll-mt-16 border-t py-[var(--section-gap)]">
      <div className="container">
        <div className="max-w-3xl">
          <h2>How do I connect my n8n?</h2>
          <p className={cn(LEAD, 'mt-5')}>Run the app on your machine, next to n8n, in four steps.</p>
        </div>
        <ol className="mt-16">
          {RUN_STEPS.map((s, i) => (
            <li key={s.title} className="grid gap-x-8 gap-y-3 border-t py-8 lg:grid-cols-12">
              <div className="lg:col-span-4">
                <h3>
                  <span className="text-muted-foreground tabular-nums">{i + 1}.</span> {s.title}
                </h3>
                {s.note && <p className="mt-2 max-w-[40ch] text-muted-foreground">{s.note}</p>}
              </div>
              <div className="min-w-0 lg:col-span-8">
                <CodeBlock code={s.code} />
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)

  return (
    // The button sits beside the scrolling code, so long lines never run under it
    <div className="flex items-start rounded-xl border bg-muted/50">
      <pre className="min-w-0 flex-1 overflow-x-auto p-4 font-mono text-sm leading-relaxed">
        <code>{code}</code>
      </pre>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Copy to clipboard"
        className="m-1.5 active:translate-y-px"
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

// A statement footer: one closing sentence, the links beneath
function Footer() {
  return (
    <footer className="border-t py-[var(--section-gap-s)]">
      <div className="container">
        <p className="max-w-[30ch] font-display text-section leading-[1.08] font-semibold tracking-[-0.025em] text-balance">
          Every screen on this page is GitDoc Agent documenting itself.
        </p>
        <div className="mt-12 flex flex-col gap-6 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="text-foreground">
            <Logo />
          </span>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
            <a href={APP_URL} className="underline-offset-4 hover:underline">
              Open the app
            </a>
            <a href={REPO_URL} className="underline-offset-4 hover:underline">
              Source on GitHub
            </a>
            <a href="#run" className="underline-offset-4 hover:underline">
              Run it locally
            </a>
          </nav>
          <p className="text-muted-foreground">Not affiliated with or endorsed by GitHub.</p>
        </div>
      </div>
    </footer>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Landing />
  </StrictMode>,
)
