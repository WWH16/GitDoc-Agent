import { Download, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useModal, ZoomableArticle } from '@/components/zoomable-article'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

type Section = { id: string; text: string; sub: boolean }

/** The generated docs full screen: a contents sidebar that follows your reading, the rendered page or its Markdown
 *  source, and Download. Images still open their zoom viewer on top. Escape or Close returns to the app. */
export function DocViewer({
  html,
  markdown,
  proseClass,
  onDownload,
  onClose,
}: {
  html: string
  markdown: string
  proseClass: string
  onDownload: () => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<'preview' | 'source'>('preview')
  const [active, setActive] = useState('')
  const [source, setSource] = useState('')

  // Sections from the rendered HTML (src/lib/markdown.ts gives h2 and h3 their ids)
  const [sections] = useState<Section[]>(() =>
    [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('h2[id], h3[id]')].map((h) => ({
      id: h.id,
      text: h.textContent ?? '',
      sub: h.tagName === 'H3',
    })),
  )

  useModal(dialog)

  // The section being read: the last heading that has passed the top quarter of the viewer
  useEffect(() => {
    if (view !== 'preview') return
    const box = scroller.current!
    const heads = sections.map((s) => box.querySelector(`[id="${CSS.escape(s.id)}"]`)).filter((h): h is Element => !!h)
    const io = new IntersectionObserver(
      () => {
        const top = box.getBoundingClientRect().top + box.clientHeight * 0.25
        const passed = heads.filter((h) => h.getBoundingClientRect().top <= top)
        setActive(passed.at(-1)?.id ?? heads[0]?.id ?? '')
      },
      { root: box, rootMargin: '0px 0px -75% 0px', threshold: [0, 1] },
    )
    heads.forEach((h) => io.observe(h))
    return () => io.disconnect()
  }, [view, sections])

  // The Markdown source, highlighted, on first look
  useEffect(() => {
    if (view !== 'source' || source) return
    import('highlight.js/lib/common').then(({ default: hljs }) => setSource(hljs.highlight(markdown, { language: 'markdown' }).value))
  }, [view, source, markdown])

  // Searched inside the viewer: the page behind holds the same doc, so its headings share these ids
  function jump(id: string) {
    scroller.current?.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'start' })
  }

  return (
    <dialog
      ref={dialog}
      aria-label="DOCUMENTATION.md, full view"
      onClose={onClose}
      className="fixed inset-0 m-0 size-full max-h-none max-w-none bg-background p-0 text-foreground backdrop:bg-transparent"
    >
      <div className="flex h-full flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4 sm:px-6">
          <p className="min-w-0 truncate font-mono text-sm font-medium">DOCUMENTATION.md</p>
          <Tabs value={view} onValueChange={(v) => setView(v as 'preview' | 'source')} className="ml-auto">
            <TabsList>
              <TabsTrigger value="preview">Preview</TabsTrigger>
              <TabsTrigger value="source">Markdown</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="outline" size="sm" onClick={onDownload} aria-label="Download .md">
            <Download />
            <span className="hidden sm:inline">Download .md</span>
          </Button>
          <Button variant="ghost" size="icon" aria-label="Close full view" onClick={() => dialog.current?.close()}>
            <X />
          </Button>
        </header>

        <div className="flex min-h-0 flex-1">
          {view === 'preview' && sections.length > 0 && (
            <nav aria-label="Contents" className="hidden w-72 shrink-0 overflow-y-auto border-r px-4 py-6 lg:block">
              <p className="px-2 pb-2 text-sm font-medium">Contents</p>
              <ol className="space-y-0.5 text-sm">
                {sections.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => jump(s.id)}
                      aria-current={active === s.id ? 'location' : undefined}
                      className={cn(
                        'block w-full truncate rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent hover:text-foreground',
                        s.sub && 'pl-5',
                        active === s.id ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {s.text}
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
          )}

          <div ref={scroller} className="min-w-0 flex-1 overflow-y-auto">
            {view === 'preview' ? (
              // Below lg the sidebar is hidden, so the article's own contents list stands in for it
              <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-12 lg:[&>details]:hidden">
                <ZoomableArticle html={html} outline className={proseClass} />
              </div>
            ) : (
              <pre className="mx-auto max-w-5xl px-4 py-8 font-mono text-sm leading-relaxed break-words whitespace-pre-wrap sm:px-8">
                {source ? <code dangerouslySetInnerHTML={{ __html: source }} /> : <code>{markdown}</code>}
              </pre>
            )}
          </div>
        </div>
      </div>
    </dialog>
  )
}
