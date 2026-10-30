import { Minus, Plus, Scan, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { useDark } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { drawDiagram } from '@/lib/diagrams'
import { cn } from '@/lib/utils'

type View = { scale: number; x: number; y: number }
// themed: drawn in the page's light or dark theme (src/lib/diagrams.ts), not on white like the workflow's drawings
type Shown = { src: string; alt: string; w: number; h: number; themed: boolean }

const MIN = 0.1
const MAX = 8
// Free space around a fitted diagram: room for the label and toolbar above and below, less at the sides on phones
const PAD_Y = 64
const padX = (width: number) => (width < 640 ? 12 : 48)
const clamp = (v: number) => Math.min(MAX, Math.max(MIN, v))

/** Size the diagram was drawn at. Mermaid SVGs use width="100%", so read the viewBox instead of naturalWidth. */
function intrinsicSize(img: HTMLImageElement) {
  const m = /^data:image\/svg\+xml;base64,(.+)$/.exec(img.src)
  if (m) {
    try {
      const box = /viewBox="[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)"/.exec(atob(m[1]))
      if (box) return { w: +box[1], h: +box[2] }
    } catch {
      // not decodable: fall through to the rendered size
    }
  }
  const r = img.getBoundingClientRect()
  return { w: img.naturalWidth || r.width, h: img.naturalHeight || r.height }
}

/** Makes an image in the docs open the viewer from the keyboard, at the size it was drawn. */
function prepare(img: HTMLImageElement, label: string) {
  img.tabIndex = 0
  img.setAttribute('role', 'button')
  img.setAttribute('aria-label', `Enlarge ${label}`)
  // Mermaid SVGs are width="100%" and would stretch to any container. Show them at the size they were drawn,
  // never wider than the column and never taller than 70% of the screen; the viewer is there for detail.
  const { w, h } = intrinsicSize(img)
  if (w > 0 && h > 0) img.style.width = `min(100%, ${w}px, ${(70 * w) / h}vh)`
}

// Open full-screen dialogs. Counted, not saved and restored: a diagram viewer inside the docs viewer can close in
// either order and the page still scrolls again after the last one.
let locks = 0

/** Opens a full-screen <dialog> as a modal on mount; the page behind does not scroll while any is open. */
export function useModal(dialog: RefObject<HTMLDialogElement | null>) {
  useEffect(() => {
    dialog.current?.showModal()
    if (locks++ === 0) document.documentElement.style.overflow = 'hidden'
    return () => {
      if (--locks === 0) document.documentElement.style.overflow = ''
    }
  }, [dialog])
}

export type Section = { id: string; text: string; sub: boolean }

/** A doc's sections and their subsections: h2 and h3, or h3 and h4 when the doc has no h2 (ids from markdown.ts). */
export function sectionsOf(html: string): Section[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const [top, sub] = doc.querySelector('h2[id]') ? ['H2', 'H3'] : ['H3', 'H4']
  return [...doc.querySelectorAll(`${top}[id], ${sub}[id]`)].map((h) => ({
    id: h.id,
    text: h.textContent ?? '',
    sub: h.tagName === sub,
  }))
}

/** The section being read: the last one whose heading has passed the top quarter of `scroller` (the window when
 *  null), or the last section once the bottom is reached, since a short last section never gets that high. */
export function useActiveSection(sections: Section[], within: RefObject<HTMLElement | null>, scroller?: RefObject<HTMLElement | null>) {
  const [active, setActive] = useState('')
  useEffect(() => {
    const box = scroller?.current ?? null
    const target: HTMLElement | Window = box ?? window
    let frame = 0
    const update = () => {
      frame = 0
      const heads = sections
        .map((s) => within.current?.querySelector(`[id="${CSS.escape(s.id)}"]`))
        .filter((h): h is Element => !!h)
      const top = box ? box.getBoundingClientRect().top + box.clientHeight / 4 : innerHeight / 4
      const atEnd = box
        ? box.scrollTop + box.clientHeight >= box.scrollHeight - 2
        : scrollY + innerHeight >= document.documentElement.scrollHeight - 2
      const passed = heads.filter((h) => h.getBoundingClientRect().top <= top)
      setActive((atEnd ? heads.at(-1) : (passed.at(-1) ?? heads[0]))?.id ?? '')
    }
    const onScroll = () => {
      frame ||= requestAnimationFrame(update)
    }
    update()
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      target.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [sections, within, scroller])
  return active
}

/** The contents list: subsections indented, titles wrap rather than cut off, only the section being read is filled. */
export function Contents({
  sections,
  active,
  onJump,
  className,
}: {
  sections: Section[]
  active: string
  onJump: (id: string) => void
  className?: string
}) {
  // A list that scrolls on its own keeps the section being read in view (by hand: scrollIntoView would move the page)
  const nav = useRef<HTMLElement>(null)
  useEffect(() => {
    const item = nav.current?.querySelector('[aria-current]')
    if (!nav.current || !item) return
    const box = nav.current.getBoundingClientRect()
    const at = item.getBoundingClientRect()
    // The first section brings the list back to its top, label included
    if (item === nav.current.querySelector('button')) nav.current.scrollTop = 0
    else if (at.top < box.top) nav.current.scrollTop -= box.top - at.top
    else if (at.bottom > box.bottom) nav.current.scrollTop += at.bottom - box.bottom
  }, [active])

  return (
    <nav ref={nav} aria-label="Contents" className={className}>
      <p className="px-2 pb-2 text-sm font-medium">Contents</p>
      <ol className="space-y-0.5 text-sm">
        {sections.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onJump(s.id)}
              aria-current={active === s.id ? 'location' : undefined}
              className={cn(
                'block w-full rounded-md px-2 py-1.5 text-left leading-snug transition-colors',
                s.sub && 'pl-5',
                active === s.id ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {s.text}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}

/** Rendered Markdown (src/lib/markdown.ts) whose images open in an in-page viewer with zoom and pan, and whose code
 *  blocks copy. With `outline`, a doc of three or more sections opens with a contents list; `outline` holds its extra
 *  classes, such as hiding it where a <Contents> sidebar takes over. */
export function ZoomableArticle({ html, className, outline }: { html: string; className?: string; outline?: string }) {
  const article = useRef<HTMLElement>(null)
  const [shown, setShown] = useState<Shown | null>(null)
  const top = useMemo(() => (outline === undefined ? [] : sectionsOf(html).filter((s) => !s.sub)), [html, outline])
  // Searched inside this article: a full view of the same doc may share these ids
  const jump = (id: string) => article.current?.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'start' })

  // Images come from sanitized HTML, so make them reachable by keyboard here
  useEffect(() => {
    article.current?.querySelectorAll('img').forEach((img, i) => prepare(img, img.alt || `image ${i + 1}`))
  }, [html])

  // Diagrams (marked by markdown.ts) are drawn in the current theme, and again when it changes. One that can't be
  // drawn shows the workflow's drawing if there is one, else its code.
  const dark = useDark()
  useEffect(() => {
    let current = true
    article.current?.querySelectorAll<HTMLElement>('.md-mermaid').forEach((box, i) => {
      const show = (src: string, themed = false) => {
        if (!current) return
        const img = box.querySelector('img') ?? box.insertAdjacentElement('afterbegin', document.createElement('img'))
        if (!(img instanceof HTMLImageElement)) return
        img.src = src
        img.alt = `Diagram ${i + 1}`
        img.toggleAttribute('data-themed', themed)
        prepare(img, img.alt)
        box.dataset.state = 'drawn'
      }
      drawDiagram(box.querySelector('code')?.textContent ?? '', dark).then((src) => show(src, true), () => {
        if (box.dataset.fallback) return show(box.dataset.fallback)
        if (!current) return
        box.dataset.state = 'failed'
        box.querySelector('.md-mermaid-note')!.textContent = 'This diagram could not be drawn, so its code is shown instead.'
      })
    })
    return () => {
      current = false
    }
  }, [html, dark])

  function open(target: EventTarget) {
    if (!(target instanceof HTMLImageElement)) return
    setShown({ src: target.src, alt: target.alt || 'Diagram', themed: target.hasAttribute('data-themed'), ...intrinsicSize(target) })
  }

  // The copy buttons come from the HTML, so one listener on the article serves them all
  function copy(target: EventTarget) {
    const button = target instanceof Element ? target.closest<HTMLButtonElement>('[data-copy]') : null
    const code = button?.closest('.md-code')?.querySelector('code')
    if (!button || !code) return
    navigator.clipboard.writeText(code.textContent ?? '').then(
      () => {
        button.textContent = 'Copied'
        setTimeout(() => (button.textContent = 'Copy'), 1500)
      },
      // Clipboard blocked: select the code so Ctrl+C still works
      () => getSelection()?.selectAllChildren(code),
    )
  }

  return (
    <>
      {top.length >= 3 && (
        // Lines up with the docs' text column (WIDE_PROSE in App.tsx)
        <details
          className={cn(
            'mb-6 ml-[max(0px,calc((100%-46rem)/2))] max-w-[70ch] rounded-xl border px-4 py-3 text-sm xl:ml-0 [&[open]>summary]:mb-2',
            outline,
          )}
        >
          <summary className="cursor-pointer font-medium select-none">Contents, {top.length} sections</summary>
          <ol className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
            {top.map((s) => (
              <li key={s.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => jump(s.id)}
                  className="block w-full rounded-sm text-left text-muted-foreground hover:text-foreground"
                >
                  {s.text}
                </button>
              </li>
            ))}
          </ol>
        </details>
      )}
      <article
        ref={article}
        className={cn(
          '[&_img]:mx-auto [&_img]:block [&_img]:h-auto [&_img]:cursor-zoom-in [&_img]:rounded-xl [&_img]:outline-offset-4 [&_img:hover]:outline-2 [&_img:hover]:outline-border [&_img:focus-visible]:outline-2 [&_img:focus-visible]:outline-ring',
          className,
        )}
        onClick={(e) => {
          open(e.target)
          copy(e.target)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            if (e.target instanceof HTMLImageElement) e.preventDefault()
            open(e.target)
          }
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {shown && <Viewer shown={shown} onClose={() => setShown(null)} />}
    </>
  )
}

function Viewer({ shown, onClose }: { shown: Shown; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 })
  const [fit, setFit] = useState(1)
  // Active pointers: one drags, two pinch-zoom
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const [dragging, setDragging] = useState(false)

  // Scale and offset that show the whole diagram, centred
  function fitted(): View {
    const s = stage.current?.getBoundingClientRect()
    if (!s) return { scale: 1, x: 0, y: 0 }
    const scale = clamp(Math.min((s.width - padX(s.width) * 2) / shown.w, (s.height - PAD_Y * 2) / shown.h))
    return { scale, x: (s.width - shown.w * scale) / 2, y: (s.height - shown.h * scale) / 2 }
  }

  function reset() {
    const v = fitted()
    setFit(v.scale)
    setView(v)
  }

  // Zoom around a point of the stage (the cursor, or the centre for buttons and keys)
  function zoomBy(factor: number, cx?: number, cy?: number) {
    const s = stage.current?.getBoundingClientRect()
    if (!s) return
    const px = cx ?? s.width / 2
    const py = cy ?? s.height / 2
    setView((v) => {
      const scale = clamp(v.scale * factor)
      const k = scale / v.scale
      return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k }
    })
  }

  useModal(dialog)
  useEffect(() => {
    reset()
    window.addEventListener('resize', reset)
    return () => window.removeEventListener('resize', reset)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per opened image
  }, [shown])

  // React's onWheel is passive, so preventDefault needs a native listener
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- zoomBy only reads refs and setView
  }, [])

  function down(e: ReactPointerEvent) {
    if (e.button !== 0) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // the pointer was already released: track it without capture
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    setDragging(true)
  }
  function move(e: ReactPointerEvent) {
    const ps = pointers.current
    const prev = ps.get(e.pointerId)
    if (!prev) return
    const before = [...ps.values()]
    ps.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const after = [...ps.values()]
    const r = e.currentTarget.getBoundingClientRect()
    if (after.length >= 2) {
      // Pinch: scale by the change in finger distance, around the point between the fingers
      const [a0, b0] = before
      const [a1, b1] = after
      const factor = Math.hypot(a1.x - b1.x, a1.y - b1.y) / Math.hypot(a0.x - b0.x, a0.y - b0.y)
      if (Number.isFinite(factor) && factor > 0) zoomBy(factor, (a1.x + b1.x) / 2 - r.left, (a1.y + b1.y) / 2 - r.top)
    } else {
      setView((v) => ({ ...v, x: v.x + e.clientX - prev.x, y: v.y + e.clientY - prev.y }))
    }
  }
  const up = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size === 0) setDragging(false)
  }

  const zoomedIn = view.scale > fit * 1.05

  return (
    <dialog
      ref={dialog}
      aria-label={`${shown.alt} viewer`}
      onClose={onClose}
      onKeyDown={(e) => {
        if (e.key === '+' || e.key === '=') zoomBy(1.25)
        else if (e.key === '-') zoomBy(0.8)
        else if (e.key === '0') reset()
      }}
      className="fixed inset-0 m-0 size-full max-h-none max-w-none bg-muted p-0 text-foreground backdrop:bg-transparent motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95"
    >
      <div
        ref={stage}
        className={cn('absolute inset-0 touch-none overflow-hidden select-none', dragging ? 'cursor-grabbing' : 'cursor-grab')}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onDoubleClick={(e) => {
          if (zoomedIn) return reset()
          const r = e.currentTarget.getBoundingClientRect()
          zoomBy(2, e.clientX - r.left, e.clientY - r.top)
        }}
      >
        {/* White paper keeps the diagram's own colours readable in dark mode */}
        <img
          src={shown.src}
          alt={shown.alt}
          draggable={false}
          style={{
            width: shown.w,
            height: shown.h,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          }}
          className={cn(
            'absolute top-0 left-0 max-w-none origin-top-left rounded-xl p-4 shadow-sm ring-1 ring-border',
            shown.themed ? 'bg-card' : 'bg-white',
          )}
        />
      </div>

      <p className="pointer-events-none absolute top-4 left-4 rounded-full bg-background/80 px-3 py-1 text-sm font-medium backdrop-blur">
        {shown.alt}
      </p>
      <Button
        variant="outline"
        size="icon"
        aria-label="Close viewer"
        className="absolute top-3 right-3 rounded-full bg-background/80 backdrop-blur"
        onClick={() => dialog.current?.close()}
      >
        <X />
      </Button>

      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border bg-background/90 p-1 shadow-sm backdrop-blur">
        <Button variant="ghost" size="icon" aria-label="Zoom out" className="rounded-full" onClick={() => zoomBy(0.8)}>
          <Minus />
        </Button>
        <span className="w-14 text-center text-sm tabular-nums" aria-live="polite">
          {Math.round((view.scale / fit) * 100)}%
        </span>
        <Button variant="ghost" size="icon" aria-label="Zoom in" className="rounded-full" onClick={() => zoomBy(1.25)}>
          <Plus />
        </Button>
        <Button variant="ghost" size="sm" className="rounded-full" onClick={reset}>
          <Scan />
          Fit
        </Button>
        <span className="hidden pr-3 pl-1 text-xs text-muted-foreground sm:inline">Scroll to zoom, drag to move</span>
      </div>
    </dialog>
  )
}
