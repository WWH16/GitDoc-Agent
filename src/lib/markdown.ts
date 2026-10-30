// Markdown to safe HTML for the docs preview and Ask answers. After sanitizing: code is highlighted and gets a bar with
// its language and a copy button, tables are framed so wide ones scroll on their own, and headings get ids for the
// contents list. The libraries (~70 KB gzip) load on first use. Mermaid blocks are marked for drawing in the browser.

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '') || 'section'

// Puts `el` inside a new div of class `className` and returns the div
function wrap(el: Element, className: string) {
  const box = el.ownerDocument.createElement('div')
  box.className = className
  el.replaceWith(box)
  box.append(el)
  return box
}

/** The workflow's drawing of each diagram in `preview` (its `![Diagram n](...)` images), by diagram number. */
export function workflowDrawings(preview: string): Map<number, string> {
  const re = /!\[Diagram (\d+)\]\((data:image\/svg\+xml;base64,[\w+/=]+|https:\/\/mermaid\.ink\/svg\/[\w-]+)\)/g
  return new Map([...preview.matchAll(re)].map((m) => [Number(m[1]), m[2]]))
}

/** `preview`, the workflow's version of the same docs with diagrams as images, is the fallback for a diagram the
 *  browser can't draw (src/lib/diagrams.ts). */
export async function renderMarkdown(md: string, preview = ''): Promise<string> {
  const [{ marked }, { default: DOMPurify }, { default: hljs }] = await Promise.all([
    import('marked'),
    import('dompurify'),
    import('highlight.js/lib/common'),
  ])
  const doc = new DOMParser().parseFromString(DOMPurify.sanitize(marked.parse(md, { async: false })), 'text/html')
  const fallbacks = workflowDrawings(preview)
  let diagrams = 0

  doc.querySelectorAll('pre > code').forEach((code) => {
    const given = /language-([\w-]+)/.exec(code.className)?.[1]
    // A language highlight.js doesn't know (mermaid, say) stays plain; no language at all is guessed
    if (!given || hljs.getLanguage(given)) hljs.highlightElement(code as HTMLElement)
    const lang = given ?? /language-([\w-]+)/.exec(code.className)?.[1]

    const box = wrap(code.parentElement!, 'md-code')
    box.insertAdjacentHTML('afterbegin', '<div class="md-code-bar"><span></span><button type="button" data-copy>Copy</button></div>')
    box.querySelector('span')!.textContent = lang ?? 'code'

    // A diagram: ZoomableArticle draws it in place of its code, which shows again only if drawing fails
    if (given === 'mermaid') {
      const figure = wrap(box, 'md-mermaid')
      figure.dataset.state = 'pending'
      const fallback = fallbacks.get(++diagrams)
      if (fallback) figure.dataset.fallback = fallback
      figure.insertAdjacentHTML('afterbegin', '<p class="md-mermaid-note">Drawing diagram…</p>')
    }
  })

  // Focusable, so a wide table can be scrolled from the keyboard
  doc.querySelectorAll('table').forEach((table) => {
    const box = wrap(table, 'md-table')
    box.tabIndex = 0
    box.setAttribute('role', 'region')
    box.setAttribute('aria-label', 'Table')
  })

  const used = new Set<string>()
  doc.querySelectorAll('h2, h3, h4').forEach((h) => {
    let id = slug(h.textContent ?? '')
    for (let n = 2; used.has(id); n++) id = `${slug(h.textContent ?? '')}-${n}`
    used.add(id)
    h.id = id
  })

  return doc.body.innerHTML
}
