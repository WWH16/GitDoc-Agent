// Markdown to safe HTML for the docs preview and Ask answers. After sanitizing: code is highlighted and gets a bar with
// its language and a copy button, tables are framed so wide ones scroll on their own, and headings get ids for the
// contents list. The libraries (~70 KB gzip) load on first use. DOMPurify keeps data: URLs on <img>, so rendered
// diagrams survive.

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '') || 'section'

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

    const pre = code.parentElement!
    const box = doc.createElement('div')
    box.className = 'md-code'
    const bar = doc.createElement('div')
    bar.className = 'md-code-bar'
    const label = doc.createElement('span')
    label.textContent = lang ?? 'code'
    const copy = doc.createElement('button')
    copy.type = 'button'
    copy.dataset.copy = ''
    copy.textContent = 'Copy'
    bar.append(label, copy)
    pre.replaceWith(box)
    box.append(bar, pre)
  })

  // Focusable, so a wide table can be scrolled from the keyboard
  doc.querySelectorAll('table').forEach((table) => {
    const box = doc.createElement('div')
    box.className = 'md-table'
    box.tabIndex = 0
    box.setAttribute('role', 'region')
    box.setAttribute('aria-label', 'Table')
    table.replaceWith(box)
    box.append(table)
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
