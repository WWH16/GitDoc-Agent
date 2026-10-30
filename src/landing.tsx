import { ArrowUp, Check } from 'lucide-react'
import { StrictMode, useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
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
const QUICK = 'duration-200 ease-out-quart motion-reduce:transition-none'
// The page's one load moment, in the hero only: the run graph below already moves as you scroll, and the rest stays still.
// Reduced motion shows everything at once.
const ENTER = 'animate-in fade-in slide-in-from-bottom-3 fill-mode-both duration-700 ease-out-quart motion-reduce:animate-none'

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
        <GetBack />
      </main>
      <Footer />
      <BackToTop />
    </>
  )
}

// Shows once the hero has scrolled away; the page's scroll-smooth (off under reduced motion) carries it up
const PAST_HERO = () => scrollY > innerHeight
function BackToTop() {
  const shown = useSyncExternalStore(
    (onChange) => (addEventListener('scroll', onChange, { passive: true }), () => removeEventListener('scroll', onChange)),
    PAST_HERO,
  )
  return (
    <a
      href="#top"
      aria-label="Back to top"
      tabIndex={shown ? 0 : -1}
      className={cn(
        // Solid ink like the header slab, so it stands off any section it floats over
        buttonVariants(),
        'fixed right-[max(1.5rem,env(safe-area-inset-right))] bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-20 size-12 p-0 shadow-lg ring-4 ring-background transition-[opacity,visibility,translate] sm:size-14',
        QUICK,
        shown ? 'visible opacity-100' : 'invisible translate-y-2 opacity-0',
      )}
    >
      <ArrowUp className="size-5" strokeWidth={2.5} />
    </a>
  )
}

const NAV = [
  ['How it works', '#how'],
  ['Limits', '#limits'],
  ['What you get', '#get'],
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

// The orange full stop is the agent's pen: it lands at the start of the line, glides right writing "Get its docs" out
// behind it, and comes to rest as the full stop. Plays once the first line is in; hover the dot to run it again.
// The text is in the DOM throughout (only clipped), so screen readers read it whole. Reduced motion: both simply sit there.
const PEN_IN = 200
const WRITE = 750
// Fast off the mark, easing into the full stop; the dot and the words share it so the pen stays on the edge of the ink
const WRITE_EASE = 'cubic-bezier(0.55, 0, 0.25, 1)'
function AgentLine({ text }: { text: string }) {
  const line = useRef<HTMLSpanElement>(null)
  const dot = useRef<HTMLSpanElement>(null)
  const run = useCallback(() => {
    const words = line.current!
    const el = dot.current!
    if (REDUCED_MOTION.matches || el.getAnimations().length) return
    const start = `${-words.getBoundingClientRect().width}px 0`
    el.style.opacity = '1'
    words.style.clipPath = ''
    // Pen down: the dot drops onto the start of the line
    el.animate(
      [
        { translate: start, opacity: 0, scale: 1.8 },
        { translate: start, opacity: 1, scale: 1 },
      ],
      { duration: PEN_IN, easing: 'ease-out' },
    )
    // Writing: the dot glides right and the words appear exactly up to it
    const writing = { delay: PEN_IN, duration: WRITE, easing: WRITE_EASE, fill: 'backwards' } as const
    el.animate([{ translate: start }, { translate: '0 0' }], writing)
    words.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], writing).finished.then(
      () => (words.style.clipPath = 'none'),
      () => {},
    )
    // Pen up: a small settle into the full stop
    el.animate([{ scale: 1.3 }, { scale: 1 }], { delay: PEN_IN + WRITE, duration: 220, easing: 'ease-out' })
  }, [])
  useEffect(() => {
    // Wait for the display font (the line's width) and for the first line's entrance
    const timer = setTimeout(() => document.fonts.ready.then(run), 500)
    return () => clearTimeout(timer)
  }, [run])
  // Both start hidden, so nothing shows in place before the agent writes it
  return (
    <>
      <span ref={line} className="motion-safe:[clip-path:inset(0_100%_0_0)]">
        {text}
      </span>
      <span ref={dot} onPointerEnter={run} className="inline-block text-brand motion-safe:opacity-0">
        .
      </span>
    </>
  )
}

// Plain GET form: the app reads ?repo= and fills in the field. In the hero and again at the close of the page.
function RepoForm({ id, className }: { id: string; className?: string }) {
  return (
    <form action={APP_URL} method="get" className={cn('max-w-xl space-y-2', className)}>
      <label htmlFor={id} className="block text-sm font-medium">
        Repository URL
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <GitHubIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input id={id} name="repo" type="url" required placeholder={URL_PLACEHOLDER} className="h-12 border-muted-foreground pl-9 sm:h-12" />
        </div>
        <Button type="submit" className="h-12 px-6 active:translate-y-px sm:h-12">
          Generate docs
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">Opens the app with this repository filled in. No account needed.</p>
    </form>
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
            <span className={cn('block sm:whitespace-nowrap', ENTER)}>Paste a repo.</span>
            <span className="block sm:whitespace-nowrap">
              <AgentLine text="Get its docs" />
            </span>
          </h1>
          <p className={cn(LEAD, 'mt-6 delay-200', ENTER)}>Readable docs with diagrams, then answers about the code, with sources.</p>
          <RepoForm id="hero-repo" className={cn('mt-10 delay-300', ENTER)} />
        </div>
        <Shot
          name="generate"
          alt="The documentation GitDoc Agent wrote for its own repository, fresh from a run"
          phone="generate-phone"
          priority
          className="min-w-0 animate-in fade-in slide-in-from-bottom-6 fill-mode-both delay-300 duration-1000 ease-out-quart motion-reduce:animate-none"
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
        <div className="reveal max-w-3xl">
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
        <div className="reveal max-w-3xl">
          <h2>Can I ask about the code?</h2>
          <p className={cn(LEAD, 'mt-5')}>Yes. Every answer lists the files it came from, so you can check it.</p>
          {/* True by construction: the app reads public repos with no GitHub sign-in, and Ask only searches the code a run indexed */}
          <p className="mt-4 max-w-[52ch] text-muted-foreground">
            Ask has read-only access. It cannot open pull requests or modify your code. Its answers come only from a copy of
            the code saved when your documentation was generated.
          </p>
          {/* The indexer skips .env files; the Ask workflow's Guardrails node and system prompt do the rest */}
          <p className="mt-4 max-w-[52ch] text-muted-foreground">
            Your secrets remain protected. Ask does not disclose passwords, keys or other credentials, files that contain them
            are never stored, and attempts to manipulate it, whether in a question or hidden in the code, are ignored.
          </p>
        </div>
        <Shot
          name="ask"
          alt="The Ask tab answering what this project does, with src/App.tsx, src/landing.tsx and a plan document as its sources"
          size={[1440, 1140]}
          phone="ask-phone"
          className="reveal mt-16"
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
          // The capture is the dialog alone, its corners cut clear: it brings its own rounded border, so no shot frame
          className="reveal mx-auto w-full max-w-[34rem] min-w-0 rounded-none bg-transparent after:hidden"
        />
        <div className="reveal min-w-0">
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
      <div className="reveal container">
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
        <h2 className="reveal lg:col-span-4">How many runs do I get?</h2>
        <dl className="lg:col-span-8">
          {LIMITS.map(([term, detail]) => (
            <div key={term} className="reveal grid gap-1 border-t py-6 first:border-t-0 first:pt-0 sm:grid-cols-[12rem_1fr] sm:gap-8">
              <dt className="font-display text-title font-semibold tracking-[-0.015em]">{term}</dt>
              <dd className="text-lead text-muted-foreground">{detail}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}

// What the docs are for, in the words of the pitch that started the project. A draft to start from, never a claim
// that it understands the code better than the people who wrote it.
const USES = [
  ['Start from a draft', 'Hours of writing an architecture overview become minutes of reading and fixing one.'],
  ['Bring someone new in', 'A new teammate reads how the parts fit together before touching the code.'],
  ['Come back months later', 'Pick up where you left off without retracing the whole codebase.'],
  ['Show a client', 'Hand over an overview of what the system does and how it is used.'],
] as const

// Closes the page: what a run hands back and why it helps, then the form again, the thing a visitor does next
function GetBack() {
  return (
    <section id="get" className="scroll-mt-16 border-t py-[var(--section-gap)]">
      <div className="container">
        <div className="reveal max-w-3xl">
          <h2>What do I get back?</h2>
          <p className={cn(LEAD, 'mt-5')}>
            One <span className="font-mono text-[0.9em] text-foreground">DOCUMENTATION.md</span>: a module overview, the data
            models and how they relate, the API, and how the front end talks to the back end. ER and sequence diagrams are in it too.
          </p>
          <p className="mt-4 max-w-[52ch] text-muted-foreground">It is a first draft, not a replacement for knowing your code. Read it, fix it, keep it.</p>
          {/* Every GitHub call in the n8n workflows is a GET; the file filter drops .env files, and the prompt writes <redacted> for secrets */}
          <p className="mt-4 max-w-[52ch] text-muted-foreground">
            Your repository is only read. Nothing in it is changed, added or removed. Your secrets stay out of it too: files that
            hold passwords and keys are skipped, and any secret found in the code is hidden in the docs.
          </p>
        </div>
        <ul className="mt-16 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {USES.map(([title, text]) => (
            <li key={title} className="reveal border-t pt-6">
              <h3>{title}</h3>
              <p className="mt-2 text-muted-foreground">{text}</p>
            </li>
          ))}
        </ul>
        <RepoForm id="close-repo" className="reveal mt-20" />
      </div>
    </section>
  )
}

// A statement footer: one closing sentence, the links beneath
function Footer() {
  return (
    <footer className="border-t py-[var(--section-gap-s)]">
      <div className="container">
        <p className="reveal max-w-[30ch] font-display text-section leading-[1.08] font-semibold tracking-[-0.025em] text-balance">
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
            <a href={`${REPO_URL}#readme`} className="underline-offset-4 hover:underline">
              Run it locally
            </a>
          </nav>
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
