import { Download, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Contents, sectionsOf, useActiveSection, useModal, ZoomableArticle } from '@/components/zoomable-article'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

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
  const [source, setSource] = useState('')
  const sections = useMemo(() => sectionsOf(html), [html])
  const active = useActiveSection(view === 'preview' ? sections : [], scroller, scroller)

  useModal(dialog)

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
            <Contents
              sections={sections}
              active={active}
              onJump={jump}
              className="hidden w-72 shrink-0 overflow-y-auto border-r px-4 py-6 lg:block"
            />
          )}

          <div ref={scroller} className="min-w-0 flex-1 overflow-y-auto">
            {view === 'preview' ? (
              // Below lg the sidebar is hidden, so the article's own contents list stands in for it
              <div className="mx-auto max-w-4xl px-4 py-8 [--heading-offset:1.5rem] sm:px-8 sm:py-12">
                <ZoomableArticle html={html} outline="lg:hidden" className={proseClass} />
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
