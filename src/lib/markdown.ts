// Markdown to safe HTML for the docs preview and Ask answers. After sanitizing: code is highlighted and gets a bar with
// its language and a copy button, tables are framed so wide ones scroll on their own, and headings get ids for the
// contents list. The libraries (~70 KB gzip) load on first use. DOMPurify keeps data: URLs on <img>, so rendered
// diagrams survive.

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

export async function renderMarkdown(md: string): Promise<string> {
  const [{ marked }, { default: DOMPurify }, { default: hljs }] = await Promise.all([
    import('marked'),
    import('dompurify'),
    import('highlight.js/lib/common'),
  ])
  const doc = new DOMParser().parseFromString(DOMPurify.sanitize(marked.parse(md, { async: false })), 'text/html')

  doc.querySelectorAll('pre > code').forEach((code) => {
    const given = /language-([\w-]+)/.exec(code.className)?.[1]
    // A language highlight.js doesn't know (mermaid, say) stays plain; no language at all is guessed
    if (!given || hljs.getLanguage(given)) hljs.highlightElement(code as HTMLElement)
    const lang = given ?? /language-([\w-]+)/.exec(code.className)?.[1]

    const box = wrap(code.parentElement!, 'md-code')
    box.insertAdjacentHTML('afterbegin', '<div class="md-code-bar"><span></span><button type="button" data-copy>Copy</button></div>')
    box.querySelector('span')!.textContent = lang ?? 'code'
  })

  // Focusable, so a wide table can be scrolled from the keyboard
  doc.querySelectorAll('table').forEach((table) => {
    const box = wrap(table, 'md-table')
    box.tabIndex = 0
    box.setAttribute('role', 'region')
    box.setAttribute('aria-label', 'Table')
  })

  const used = new Set<string>()
  doc.querySelectorAll('h2, h3').forEach((h) => {
    let id = slug(h.textContent ?? '')
    for (let n = 2; used.has(id); n++) id = `${slug(h.textContent ?? '')}-${n}`
    used.add(id)
    h.id = id
  })

  return doc.body.innerHTML
}
